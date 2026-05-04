const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { toMarkdownTable } = require("./qa-report");

const QA_DIR = __dirname;
const REPORTS_DIR = path.join(QA_DIR, "reports");

const ACCEPTANCE_META = {
  "same PID duplicate grid entry": {
    expectedResult: "one grid entry ledger application, no duplicate qty increase, duplicate ignored audit",
  },
  "same PID duplicate signal entry": {
    expectedResult: "one signal entry ledger application, no duplicate qty increase, duplicate ignored audit",
  },
  "duplicate exit": {
    expectedResult: "one close application, no negative openQty, no double pnl",
  },
  "different PID same symbol/side": {
    expectedResult: "separate ledgers and snapshots per PID, no cross-PID dedupe",
  },
  "partial fill under same orderId with distinct tradeIds": {
    expectedResult: "distinct tradeIds create distinct ledger rows and cumulative openQty",
  },
  "split TP / partial close": {
    expectedResult: "distinct exit fills remain distinct rows and realizedPnl sums once",
  },
  "signal market entry recovery with partial fills": {
    expectedResult: "REST recovery restores each partial fill as a distinct ledger row, syncs snapshot/signal row, and reaches protection sync path",
  },
  "grid webhook timeframe alias normalization": {
    expectedResult: "60/60MIN/1H -> 1H, 120/2H -> 2H, minute aliases stay exact, and each payload resolves to one expected PID",
  },
  "signal strategy alias internal code mapping": {
    expectedResult: "SQZ+GRID+BREAKOUT display alias stores and matches through SQZGBRK without breaking ATF+VIXFIX aliases",
  },
  "exchange flat / local OPEN with recovered close": {
    expectedResult: "recovered close converges local state to CLOSED/READY or IDLE without stale loop",
  },
  "exchange flat / local OPEN with recovered close (grid)": {
    expectedResult: "recovered close converges grid state to CLOSED/IDLE without stale loop",
  },
  "exchange flat / local OPEN without recovered close": {
    expectedResult: "local stale state flattens via correction event with zero extra pnl",
  },
  "exchange flat / local OPEN without recovered close (grid)": {
    expectedResult: "grid local stale state flattens via correction event with zero extra pnl",
  },
  "orphan flatten": {
    expectedResult: "orphan close correction flattens qty without deleting prior ledger rows",
  },
  "correction event PnL": {
    expectedResult: "correction row realizedPnl stays zero and total realizedPnl is unchanged",
  },
  "live read-only API connectivity": {
    expectedResult: "signed GET endpoints succeed without mutating exchange or local state",
  },
  "live read-only aggregate comparison": {
    expectedResult: "aggregate mismatch is reported, not patched",
  },
  "live read-only protection comparison": {
    expectedResult: "local reservations are compared against Binance active protection orders",
  },
  "live read-only strategy observe": {
    expectedResult: "strategy/local/exchange state is observed without mutation",
  },
  "live execution preflight for SIGNAL": {
    expectedResult: "preflight fails closed unless target row, exchange state, and guard conditions are safe",
  },
  "live execution preflight for GRID": {
    expectedResult: "preflight fails closed unless target row, exchange state, and guard conditions are safe",
  },
};

const ensureReportsDir = () => {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  return REPORTS_DIR;
};

const buildTimestampSlug = (value = new Date()) =>
  new Date(value)
    .toISOString()
    .replace(/[:.]/g, "-");

const safeJsonStringify = (value) =>
  JSON.stringify(value, null, 2);

const getGitMeta = () => {
  try {
    const branch = execFileSync("git", ["-C", path.resolve(QA_DIR, "../../../.."), "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const commit = execFileSync("git", ["-C", path.resolve(QA_DIR, "../../../.."), "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { branch, commit };
  } catch (error) {
    return {
      branch: null,
      commit: null,
    };
  }
};

const getDbMeta = () => ({
  host: process.env.MYSQL_HOST || null,
  database: process.env.MYSQL_DB || null,
});

const buildRangeLabel = (values = []) => {
  const numbers = values
    .map((value) => Number(value || 0))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (numbers.length === 0) {
    return "";
  }
  if (numbers.length === 1) {
    return String(numbers[0]);
  }
  return `${numbers[0]}-${numbers[numbers.length - 1]}`;
};

const normalizeScenarioReport = (scenario = {}) => ({
  scenario: scenario.scenario || "",
  canonicalInvariant: scenario.invariant || "",
  expectedResult: ACCEPTANCE_META[scenario.scenario]?.expectedResult || "",
  actualResult: scenario.pass
    ? "PASS"
    : (scenario.failures || []).join(" ; "),
  status: scenario.status || (scenario.pass ? "PASS" : "FAIL"),
  failures: [].concat(scenario.failures || []),
  scriptName: scenario.scriptName || "",
  target: {
    uid: Number(scenario.uid || 0),
    pid: scenario.pid || 0,
    symbol: scenario.symbol || null,
    strategyCategory: scenario.strategyCategory || null,
  },
  cleanupPids: [].concat(scenario.cleanupPids || []),
  rowCountsBefore: scenario.rowCountsBefore || null,
  rowCountsAfterRun: scenario.rowCountsAfterRun || null,
  rowCountsAfterCleanup: scenario.rowCountsAfterCleanup || null,
  cleanup: scenario.cleanup || null,
});

const runNodeChecks = (targets = []) => {
  const results = [];
  for (const target of targets) {
    try {
      execFileSync(process.execPath, ["--check", target], {
        cwd: path.resolve(QA_DIR, "../../../.."),
        stdio: ["ignore", "ignore", "pipe"],
      });
      results.push({
        file: target,
        status: "PASS",
        error: "",
      });
    } catch (error) {
      results.push({
        file: target,
        status: "FAIL",
        error: String(error?.stderr || error?.message || error).trim(),
      });
    }
  }
  return results;
};

const runGuardScript = ({ configPath = null } = {}) => {
  const scriptPath = path.join(QA_DIR, "live-execution-trigger-webhook.js");
  if (!fs.existsSync(scriptPath)) {
    return {
      exitCode: 0,
      blocked: true,
      notImplemented: true,
      output: "LIVE_EXECUTION_TRIGGER_SCRIPT_NOT_PRESENT_FAIL_CLOSED",
    };
  }

  const args = [scriptPath, "--dry-run"];
  if (configPath) {
    args.push("--config", configPath);
  }
  const result = spawnSync(process.execPath, args, {
    cwd: path.resolve(QA_DIR, "../../../.."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      QA_DISABLE_BINANCE_WRITES: "1",
      QA_REPLAY_MODE: process.env.QA_REPLAY_MODE || "1",
    },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  return {
    exitCode: Number(result.status || 0),
    blocked: Number(result.status || 0) !== 0 || /BLOCK|DISABLE|DRY_RUN|NO_MATCH|GUARD/i.test(output),
    notImplemented: false,
    output,
  };
};

const writeReportFiles = ({ reportType, runId, report }) => {
  ensureReportsDir();
  const timestamp = buildTimestampSlug(report.finishedAt || report.startedAt || new Date());
  const jsonPath = path.join(REPORTS_DIR, `${reportType}-report-${timestamp}.json`);
  const mdPath = path.join(REPORTS_DIR, `${reportType}-report-${timestamp}.md`);
  fs.writeFileSync(jsonPath, safeJsonStringify({
    runId,
    ...report,
  }), "utf8");
  fs.writeFileSync(mdPath, buildMarkdownReport({
    reportType,
    runId,
    report,
  }), "utf8");
  return {
    jsonPath,
    mdPath,
  };
};

const buildMarkdownReport = ({ reportType, runId, report }) => {
  const lines = [
    `# QA Report`,
    ``,
    `- reportType: ${reportType}`,
    `- runId: ${runId}`,
    `- startedAt: ${report.startedAt || ""}`,
    `- finishedAt: ${report.finishedAt || ""}`,
    `- branch: ${report.git?.branch || ""}`,
    `- commit: ${report.git?.commit || ""}`,
    `- dbHost: ${report.db?.host || ""}`,
    `- dbName: ${report.db?.database || ""}`,
    `- finalStatus: ${report.finalStatus || ""}`,
    ``,
  ];

  if ((report.syntaxChecks || []).length > 0) {
    lines.push("## Node Check");
    lines.push(toMarkdownTable(report.syntaxChecks, ["file", "status", "error"]));
    lines.push("");
  }

  if ((report.scenarios || []).length > 0) {
    lines.push("## Scenario Result");
    lines.push(
      toMarkdownTable(
        report.scenarios.map((scenario) => ({
          scenario: scenario.scenario,
          canonicalInvariant: scenario.canonicalInvariant,
          expectedResult: scenario.expectedResult,
          actualResult: scenario.actualResult,
          status: scenario.status,
        })),
        ["scenario", "canonicalInvariant", "expectedResult", "actualResult", "status"]
      )
    );
    lines.push("");
  }

  if ((report.cleanup || []).length > 0) {
    lines.push("## Cleanup Result");
    lines.push(
      toMarkdownTable(
        report.cleanup.map((item) => ({
          scenario: item.scenario,
          tempPidRange: item.tempPidRange,
          before: JSON.stringify(item.before || {}),
          afterRun: JSON.stringify(item.afterRun || {}),
          afterCleanup: JSON.stringify(item.afterCleanup || {}),
          cleanupStatus: item.cleanupStatus,
        })),
        ["scenario", "tempPidRange", "before", "afterRun", "afterCleanup", "cleanupStatus"]
      )
    );
    lines.push("");
  }

  if ((report.readOnly || []).length > 0) {
    lines.push("## Live Read-only");
    lines.push(toMarkdownTable(report.readOnly, Object.keys(report.readOnly[0])));
    lines.push("");
  }

  if ((report.guardChecks || []).length > 0) {
    lines.push("## Guard Check");
    lines.push(toMarkdownTable(report.guardChecks, Object.keys(report.guardChecks[0])));
    lines.push("");
  }

  if ((report.notes || []).length > 0) {
    lines.push("## Notes");
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  return lines.join("\n");
};

module.exports = {
  ACCEPTANCE_META,
  REPORTS_DIR,
  ensureReportsDir,
  buildTimestampSlug,
  getGitMeta,
  getDbMeta,
  buildRangeLabel,
  normalizeScenarioReport,
  runNodeChecks,
  runGuardScript,
  writeReportFiles,
};
