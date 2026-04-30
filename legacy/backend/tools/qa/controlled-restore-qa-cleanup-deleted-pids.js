"use strict";

const fs = require("fs");
const path = require("path");
const qaDb = require("./qa-db");
const { getPositionRisk, getOpenOrders, getOpenAlgoOrders } = require("./qa-binance");

const TARGET_UID = 147;
const TARGET_PIDS = Object.freeze([
  991744,
  991745,
  991746,
  991747,
  991748,
  991749,
  991750,
  991751,
  991752,
  991753,
]);
const TARGET_SYMBOLS = Object.freeze(["PUMPUSDT", "XRPUSDT"]);
const APPROVAL_PHRASE = "APPROVE_CONTROLLED_RESTORE_QA_CLEANUP_COLLISION_PIDS_991744_991753";
const RESTORE_ACTION_CODE = "CONTROLLED_RESTORE_QA_CLEANUP";
const FULL_RESTORE_REASON = "SYSTEM_CONTROLLED_RESTORE_QA_CLEANUP_COLLISION";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const REPORTS_DIR = path.join(__dirname, "reports");
const SOURCE_STATE_REPORT = path.join(REPORTS_DIR, "tmp-liveqa-full-window-current-state-20260428.json");
const SOURCE_PREFLIGHT_REPORT = path.join(
  REPORTS_DIR,
  "qa-breakout-created-pid-preflight-liveqa-readiness-2026-04-26T16-28-08+09-00.json"
);
const FORENSIC_REPORT = path.join(
  REPORTS_DIR,
  "qa-pid-disappearance-forensic-display-recalibration-20260429-1535.json"
);

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toSqlDateTime = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
};

const readJsonIfExists = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const normalizePidList = (values = []) =>
  Array.from(new Set([].concat(values || []).map((value) => Number(value || 0)).filter((value) => value > 0)));

const ensureTargetWhitelist = (pids = TARGET_PIDS) => {
  const requested = normalizePidList(pids);
  const allowed = new Set(TARGET_PIDS);
  const outside = requested.filter((pid) => !allowed.has(pid));
  if (outside.length) {
    throw new Error(`RESTORE_TARGET_NOT_WHITELISTED:${outside.join(",")}`);
  }
  return requested.length ? requested : TARGET_PIDS.slice();
};

const loadSourceSignalRows = () => {
  const stateReport = readJsonIfExists(SOURCE_STATE_REPORT);
  const rows = stateReport?.local?.signalRows || [];
  const byPid = new Map();
  for (const row of rows) {
    const pid = Number(row?.id || 0);
    if (TARGET_PIDS.includes(pid)) {
      byPid.set(pid, row);
    }
  }
  return byPid;
};

const loadForensicEvidence = () => {
  const report = readJsonIfExists(FORENSIC_REPORT);
  const evidence = report?.directRootCause?.evidence || [];
  const classification = report?.directRootCause?.classification || report?.finalClassification || "";
  return {
    reportLoaded: Boolean(report),
    classification,
    evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
    hasCleanupCollisionEvidence:
      String(classification || "").includes("QA_CLEANUP") &&
      Array.isArray(evidence) &&
      evidence.some((item) => {
        const beforeSignal = Number(item?.before?.live_play_list || 0);
        const afterSignal = Number(item?.afterCleanup?.live_play_list || 0);
        return beforeSignal > 0 && afterSignal === 0;
      }),
  };
};

const buildRestoreRow = (sourceRow = {}) => ({
  id: Number(sourceRow.id),
  uid: TARGET_UID,
  live_ST: "Y",
  a_name: String(sourceRow.a_name || "").trim(),
  type: "SQZGBRK",
  symbol: String(sourceRow.symbol || "").trim().toUpperCase(),
  bunbong: String(sourceRow.bunbong || "").trim(),
  signalType: String(sourceRow.signalType || "").trim().toUpperCase(),
  enabled: "N",
  status: "READY",
  st: "STOP",
  autoST: "N",
  marginType: "cross",
  AI_ST: "neutral",
  repeatConfig: "N",
  profitTradeType: sourceRow.profitTradeType || "per",
  profitFixValue: sourceRow.profitFixValue || null,
  profitAbsValue: sourceRow.profitAbsValue ?? null,
  lossTradeType: sourceRow.lossTradeType || "per",
  lossFixValue: sourceRow.lossFixValue || null,
  lossAbsValue: sourceRow.lossAbsValue ?? null,
  limitST: "N",
  enter: 0,
  cancel: 0,
  profit: toNumber(sourceRow.profit),
  stopLoss: toNumber(sourceRow.stopLoss),
  splitTakeProfitEnabled: String(sourceRow.splitTakeProfitEnabled || "N").trim().toUpperCase() === "Y" ? "Y" : "N",
  splitTakeProfitCount: toNumber(sourceRow.splitTakeProfitCount),
  splitTakeProfitGap: toNumber(sourceRow.splitTakeProfitGap, 0.2),
  splitTakeProfitConfigJson: sourceRow.splitTakeProfitConfigJson || null,
  leverage: toNumber(sourceRow.leverage),
  margin: toNumber(sourceRow.margin),
  minimumOrderST: "N",
  m_cancelStopLoss: 0,
  m_profit: 0,
  trendOrderST: "N",
  t_cancelStopLoss: 0,
  t_profit: 0,
  t_chase: 0,
  t_ST: "N",
  t_autoST: "N",
  t_direct: "N",
  alarmSignalST: "N",
  alarmResultST: "N",
  orderSize: toNumber(sourceRow.orderSize, 1),
  direct1ST: "N",
  direct2ST: "N",
  detailTap: "B",
  selectST: "Y",
  created_at: toSqlDateTime(sourceRow.created_at || new Date()),
  r_tid: null,
  r_oid: null,
  r_m_st: "N",
  r_t_st: "N",
  r_t_tick: 0,
  r_t_cnt: 0,
  r_tempPrice: null,
  r_signalType: null,
  r_signalPrice: null,
  r_signalTime: null,
  r_exactPrice: null,
  r_exactTime: null,
  r_profitPrice: null,
  r_profitTime: null,
  r_stopPrice: null,
  r_stopTime: null,
  r_endPrice: 0,
  r_endTime: null,
  r_exact_cnt: 0,
  r_profit_cnt: 0,
  r_profit_tick: 0,
  r_stop_cnt: 0,
  r_stop_tick: 0,
  r_forcing_cnt: 0,
  r_forcing_tick: 0,
  r_real_tick: null,
  r_pol_tick: 0,
  r_charge: 0,
  r_t_charge: null,
  r_pol_sum: 0,
  r_minQty: null,
  r_qty: 0,
  r_margin: null,
  r_splitEntryQty: 0,
  r_splitStageIndex: 0,
  r_splitRealizedQty: 0,
  r_splitRealizedPnl: 0,
  r_splitRealizedCharge: 0,
  r_win: toNumber(sourceRow.r_win),
  r_loss: toNumber(sourceRow.r_loss),
});

const validateRestoreCandidate = ({ pid, sourceRow, auditRows = [], forensicEvidence }) => {
  const failures = [];
  if (!sourceRow) {
    failures.push("SOURCE_ROW_MISSING");
  }
  if (sourceRow && String(sourceRow.type || "").trim().toUpperCase() !== "SQZGBRK") {
    failures.push("SOURCE_TYPE_NOT_SQZGBRK");
  }
  if (sourceRow && !["PUMPUSDT", "XRPUSDT"].includes(String(sourceRow.symbol || "").trim().toUpperCase())) {
    failures.push("SOURCE_SYMBOL_UNEXPECTED");
  }
  if (sourceRow && !["BUY", "SELL"].includes(String(sourceRow.signalType || "").trim().toUpperCase())) {
    failures.push("SOURCE_SIDE_MISSING");
  }
  if (!auditRows.some((row) => String(row.actionCode || "").trim().toUpperCase() === "CREATE")) {
    failures.push("CREATE_AUDIT_MISSING");
  }
  if (auditRows.some((row) => String(row.actionCode || "").trim().toUpperCase() === "USER_DELETE_STRATEGY")) {
    failures.push("USER_DELETE_STRATEGY_AUDIT_FOUND");
  }
  if (!forensicEvidence?.hasCleanupCollisionEvidence) {
    failures.push("QA_CLEANUP_COLLISION_EVIDENCE_MISSING");
  }
  return {
    pid,
    confidence: failures.length === 0 ? "HIGH" : "LOW",
    failures,
    restoreRow: failures.length === 0 ? buildRestoreRow(sourceRow) : null,
    evidenceSource: [
      path.relative(REPO_ROOT, SOURCE_STATE_REPORT).replace(/\\/g, "/"),
      path.relative(REPO_ROOT, SOURCE_PREFLIGHT_REPORT).replace(/\\/g, "/"),
      path.relative(REPO_ROOT, FORENSIC_REPORT).replace(/\\/g, "/"),
      "strategy_control_audit",
    ],
  };
};

const loadAuditRows = async (pids = TARGET_PIDS) => {
  const placeholders = pids.map(() => "?").join(",");
  return await qaDb.query(
    `SELECT *
       FROM strategy_control_audit
      WHERE targetUserId = ?
        AND strategyCategory = 'signal'
        AND strategyMode = 'live'
        AND pid IN (${placeholders})
      ORDER BY pid ASC, createdAt ASC, id ASC`,
    [TARGET_UID, ...pids]
  );
};

const buildRestoreCandidates = async (pids = TARGET_PIDS) => {
  const targetPids = ensureTargetWhitelist(pids);
  const sourceRows = loadSourceSignalRows();
  const forensicEvidence = loadForensicEvidence();
  const auditRows = await loadAuditRows(targetPids);
  const auditByPid = new Map();
  for (const row of auditRows) {
    const pid = Number(row.pid || 0);
    if (!auditByPid.has(pid)) {
      auditByPid.set(pid, []);
    }
    auditByPid.get(pid).push(row);
  }
  return targetPids.map((pid) =>
    validateRestoreCandidate({
      pid,
      sourceRow: sourceRows.get(pid),
      auditRows: auditByPid.get(pid) || [],
      forensicEvidence,
    })
  );
};

const checkBinanceCleanGate = async (uid = TARGET_UID) => {
  const [positions, openOrders, openAlgoOrders] = await Promise.all([
    getPositionRisk(uid),
    getOpenOrders(uid),
    getOpenAlgoOrders(uid),
  ]);
  const targetPositions = (positions || [])
    .filter((row) => TARGET_SYMBOLS.includes(String(row.symbol || "").trim().toUpperCase()))
    .map((row) => ({
      symbol: row.symbol,
      positionSide: row.positionSide || (Number(row.positionAmt || 0) >= 0 ? "LONG" : "SHORT"),
      qty: Math.abs(Number(row.positionAmt || 0)),
    }));
  return {
    positions: targetPositions,
    openOrdersCount: Array.isArray(openOrders) ? openOrders.length : 0,
    openAlgoOrdersCount: Array.isArray(openAlgoOrders) ? openAlgoOrders.length : 0,
    pass:
      targetPositions.every((row) => row.qty === 0) &&
      (!Array.isArray(openOrders) || openOrders.length === 0) &&
      (!Array.isArray(openAlgoOrders) || openAlgoOrders.length === 0),
  };
};

const checkLocalRestoreGate = async (pids = TARGET_PIDS) => {
  const targetPids = ensureTargetWhitelist(pids);
  const placeholders = targetPids.map(() => "?").join(",");
  const params = [TARGET_UID, ...targetPids];
  const [liveRows, testRows, snapshots, activeReservations, ledgerRows, deleteAudits] = await Promise.all([
    qaDb.query(
      `SELECT id, uid, a_name, symbol, bunbong, type, signalType, enabled, status, r_qty
         FROM live_play_list
        WHERE uid = ?
          AND id IN (${placeholders})
        ORDER BY id ASC`,
      params
    ),
    qaDb.query(
      `SELECT id, uid, a_name, symbol, bunbong, type, signalType, enabled, status
         FROM test_play_list
        WHERE uid = ?
          AND id IN (${placeholders})
        ORDER BY id ASC`,
      params
    ),
    qaDb.query(
      `SELECT pid, status, symbol, positionSide, openQty
         FROM live_pid_position_snapshot
        WHERE uid = ?
          AND pid IN (${placeholders})
          AND (status = 'OPEN' OR COALESCE(openQty, 0) > 0)
        ORDER BY pid ASC`,
      params
    ),
    qaDb.query(
      `SELECT pid, status, symbol, positionSide, clientOrderId, actualOrderId
         FROM live_pid_exit_reservation
        WHERE uid = ?
          AND pid IN (${placeholders})
          AND status IN ('ACTIVE', 'PARTIAL', 'CANCEL_REQUESTED', 'CANCEL_PENDING', 'UNKNOWN_CANCEL_STATE')
        ORDER BY pid ASC, id ASC`,
      params
    ),
    qaDb.query(
      `SELECT pid, COUNT(*) AS rowCount, MAX(createdAt) AS latestCreatedAt
         FROM live_pid_position_ledger
        WHERE uid = ?
          AND pid IN (${placeholders})
        GROUP BY pid
        ORDER BY pid ASC`,
      params
    ),
    qaDb.query(
      `SELECT pid, actionCode, createdAt, note
         FROM strategy_control_audit
        WHERE targetUserId = ?
          AND strategyCategory = 'signal'
          AND strategyMode = 'live'
          AND pid IN (${placeholders})
          AND actionCode = 'USER_DELETE_STRATEGY'
        ORDER BY pid ASC, createdAt ASC`,
      params
    ),
  ]);
  const safeExistingRows = liveRows.filter((row) =>
    TARGET_PIDS.includes(Number(row.id || 0)) &&
    String(row.type || "").trim().toUpperCase() === "SQZGBRK" &&
    String(row.enabled || "").trim().toUpperCase() === "N" &&
    String(row.status || "").trim().toUpperCase() === "READY" &&
    Math.abs(Number(row.r_qty || 0)) === 0 &&
    TARGET_SYMBOLS.includes(String(row.symbol || "").trim().toUpperCase())
  );
  const unsafeExistingRows = liveRows.filter(
    (row) => !safeExistingRows.some((safeRow) => Number(safeRow.id) === Number(row.id))
  );
  return {
    liveRows,
    safeExistingRows,
    unsafeExistingRows,
    testRows,
    snapshots,
    activeReservations,
    ledgerRows,
    deleteAudits,
    pass:
      unsafeExistingRows.length === 0 &&
      testRows.length === 0 &&
      snapshots.length === 0 &&
      activeReservations.length === 0 &&
      deleteAudits.length === 0,
  };
};

const insertRestoreRow = async (conn, row) => {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(",");
  const values = columns.map((column) => row[column]);
  const [result] = await conn.query(
    `INSERT INTO live_play_list (${columns.join(",")}) VALUES (${placeholders})`,
    values
  );
  return result;
};

const insertRestoreAudit = async (conn, { pid, restoreRow, approval }) => {
  const metadata = {
    reason: FULL_RESTORE_REASON,
    approval,
    restoreScope: "live_play_list only",
    noLedgerSnapshotReservationMutation: true,
    sourceReports: [
      path.relative(REPO_ROOT, SOURCE_STATE_REPORT).replace(/\\/g, "/"),
      path.relative(REPO_ROOT, SOURCE_PREFLIGHT_REPORT).replace(/\\/g, "/"),
      path.relative(REPO_ROOT, FORENSIC_REPORT).replace(/\\/g, "/"),
    ],
    restoredFields: {
      id: restoreRow.id,
      a_name: restoreRow.a_name,
      symbol: restoreRow.symbol,
      bunbong: restoreRow.bunbong,
      type: restoreRow.type,
      signalType: restoreRow.signalType,
      enabled: restoreRow.enabled,
      status: restoreRow.status,
      r_qty: restoreRow.r_qty,
    },
  };
  const [result] = await conn.query(
    `INSERT INTO strategy_control_audit
      (
        actorUserId,
        targetUserId,
        strategyCategory,
        strategyMode,
        pid,
        actionCode,
        previousEnabled,
        nextEnabled,
        requestIp,
        note,
        metadataJson
      )
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      TARGET_UID,
      TARGET_UID,
      "signal",
      "live",
      pid,
      RESTORE_ACTION_CODE,
      "N",
      "N",
      "system:controlled-restore",
      "controlled restore after QA cleanup numeric PID collision",
      JSON.stringify(metadata),
    ]
  );
  return Number(result?.insertId || 0);
};

const executeRestore = async ({ approval, dryRun = true, pids = TARGET_PIDS, checkBinance = true } = {}) => {
  const targetPids = ensureTargetWhitelist(pids);
  const startedAt = new Date().toISOString();
  const candidates = await buildRestoreCandidates(targetPids);
  const localGate = await checkLocalRestoreGate(targetPids);
  const binanceGate = checkBinance ? await checkBinanceCleanGate(TARGET_UID) : { pass: true, skipped: true };
  const blockedCandidates = candidates.filter((candidate) => candidate.confidence !== "HIGH");
  const approvalOk = approval === APPROVAL_PHRASE;
  const safetyGatePass =
    localGate.pass &&
    binanceGate.pass &&
    blockedCandidates.length === 0;
  const gatePass = safetyGatePass && (dryRun || approvalOk);
  const result = {
    reportType: "controlled-restore-qa-cleanup-deleted-pids",
    startedAt,
    finishedAt: null,
    uid: TARGET_UID,
    targetPids,
    dryRun: Boolean(dryRun),
    approvalPhraseDetected: approvalOk,
    gates: {
      local: localGate,
      binance: binanceGate,
      restoreSource: {
        pass: blockedCandidates.length === 0,
        blocked: blockedCandidates.map((candidate) => ({
          pid: candidate.pid,
          confidence: candidate.confidence,
          failures: candidate.failures,
        })),
      },
    },
    candidates: candidates.map((candidate) => ({
      pid: candidate.pid,
      confidence: candidate.confidence,
      failures: candidate.failures,
      restorePreview: candidate.restoreRow
        ? {
            id: candidate.restoreRow.id,
            a_name: candidate.restoreRow.a_name,
            symbol: candidate.restoreRow.symbol,
            bunbong: candidate.restoreRow.bunbong,
            type: candidate.restoreRow.type,
            signalType: candidate.restoreRow.signalType,
            enabled: candidate.restoreRow.enabled,
            status: candidate.restoreRow.status,
            margin: candidate.restoreRow.margin,
            leverage: candidate.restoreRow.leverage,
            profit: candidate.restoreRow.profit,
            stopLoss: candidate.restoreRow.stopLoss,
            splitTakeProfitEnabled: candidate.restoreRow.splitTakeProfitEnabled,
          }
        : null,
      evidenceSource: candidate.evidenceSource,
    })),
    rows: [],
    finalStatus: "PENDING",
  };

  if (!gatePass || dryRun) {
    result.finalStatus = dryRun && safetyGatePass ? "DRY_RUN_PASS" : "BLOCKED";
    result.finishedAt = new Date().toISOString();
    return result;
  }

  const conn = await qaDb.db.getConnection();
  try {
    await conn.beginTransaction();
    for (const candidate of candidates) {
      const pid = candidate.pid;
      const [existingRows] = await conn.query(
        `SELECT id, enabled, status, r_qty
           FROM live_play_list
          WHERE uid = ?
            AND id = ?
          LIMIT 1`,
        [TARGET_UID, pid]
      );
      if (existingRows.length > 0) {
        const auditId = await insertRestoreAudit(conn, {
          pid,
          restoreRow: candidate.restoreRow,
          approval,
        });
        result.rows.push({
          pid,
          action: "RESTORE_SKIPPED_EXISTS",
          before: existingRows[0],
          after: existingRows[0],
          auditId,
          status: "SKIPPED",
        });
        continue;
      }
      await insertRestoreRow(conn, candidate.restoreRow);
      const [afterRows] = await conn.query(
        `SELECT id, uid, a_name, symbol, bunbong, type, signalType, enabled, status, r_qty
           FROM live_play_list
          WHERE uid = ?
            AND id = ?
          LIMIT 1`,
        [TARGET_UID, pid]
      );
      const auditId = await insertRestoreAudit(conn, {
        pid,
        restoreRow: candidate.restoreRow,
        approval,
      });
      result.rows.push({
        pid,
        action: "RESTORE_INSERTED",
        before: null,
        after: afterRows[0] || null,
        auditId,
        status: afterRows.length ? "PASS" : "FAIL",
      });
    }
    await conn.commit();
    result.finalStatus = result.rows.every((row) => row.status === "PASS" || row.status === "SKIPPED")
      ? "RESTORE_PASS"
      : "RESTORE_PARTIAL";
  } catch (error) {
    await conn.rollback();
    result.finalStatus = "RESTORE_FAILED_ROLLED_BACK";
    result.error = error?.stack || error?.message || String(error);
  } finally {
    conn.release();
  }
  result.finishedAt = new Date().toISOString();
  return result;
};

const writeRestoreReport = (report) => {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const timestamp = new Date(report.finishedAt || report.startedAt || new Date())
    .toISOString()
    .replace(/[:.]/g, "-");
  const jsonPath = path.join(REPORTS_DIR, `controlled-restore-qa-cleanup-deleted-pids-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  return jsonPath;
};

const parseArgs = (argv = []) => {
  const args = { dryRun: true, approval: null, uid: TARGET_UID };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--approve") {
      args.approval = argv[i + 1] || "";
      args.dryRun = false;
      i += 1;
    } else if (token === "--uid") {
      args.uid = Number(argv[i + 1] || TARGET_UID);
      i += 1;
    } else if (token === "--skip-binance-gate") {
      args.checkBinance = false;
    }
  }
  return args;
};

const runCli = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (Number(args.uid || TARGET_UID) !== TARGET_UID) {
    throw new Error(`RESTORE_UID_NOT_ALLOWED:${args.uid}`);
  }
  const report = await executeRestore({
    approval: args.approval,
    dryRun: args.dryRun,
    checkBinance: args.checkBinance !== false,
  });
  const reportPath = writeRestoreReport(report);
  console.log(JSON.stringify({
    finalStatus: report.finalStatus,
    dryRun: report.dryRun,
    approvalPhraseDetected: report.approvalPhraseDetected,
    restoredCount: report.rows.filter((row) => row.action === "RESTORE_INSERTED" && row.status === "PASS").length,
    skippedCount: report.rows.filter((row) => row.action === "RESTORE_SKIPPED_EXISTS").length,
    blockedCount: report.gates.restoreSource.blocked.length,
    reportPath,
  }, null, 2));
  if (!["DRY_RUN_PASS", "RESTORE_PASS"].includes(report.finalStatus)) {
    process.exitCode = 1;
  }
};

if (require.main === module) {
  runCli()
    .catch((error) => {
      console.error(error?.stack || error?.message || error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await qaDb.closePool();
      process.exit(process.exitCode || 0);
    });
}

module.exports = {
  TARGET_UID,
  TARGET_PIDS,
  TARGET_SYMBOLS,
  APPROVAL_PHRASE,
  RESTORE_ACTION_CODE,
  FULL_RESTORE_REASON,
  SOURCE_STATE_REPORT,
  FORENSIC_REPORT,
  ensureTargetWhitelist,
  loadSourceSignalRows,
  loadForensicEvidence,
  buildRestoreRow,
  validateRestoreCandidate,
  buildRestoreCandidates,
  checkLocalRestoreGate,
  checkBinanceCleanGate,
  executeRestore,
};
