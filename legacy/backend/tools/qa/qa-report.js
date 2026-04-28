const repeat = (value, count) => new Array(count + 1).join(value);

const normalizeCell = (value) => {
  if (value == null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
};

const toMarkdownTable = (rows = [], columns = []) => {
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => {
    const cells = columns.map((column) => normalizeCell(row[column]));
    return `| ${cells.join(" | ")} |`;
  });
  return [header, divider, ...body].join("\n");
};

const printTitle = (title) => {
  console.log(`\n## ${title}`);
};

const printTable = (title, rows, columns) => {
  printTitle(title);
  console.log(toMarkdownTable(rows, columns));
};

const buildOutcomeLabel = (scenarios = []) =>
  scenarios.every((scenario) => scenario.pass) ? "PASS" : "FAIL";

const printQaSummary = ({
  mode,
  target = {},
  scenarios = [],
  ledgerSummary = [],
  snapshotSummary = [],
  rowSummary = [],
  reservationSummary = [],
  binanceSummary = [],
} = {}) => {
  const passLabel = buildOutcomeLabel(scenarios);
  console.log(`\nQA mode: ${mode}`);
  console.log(
    `Target: uid=${target.uid || 0}, pid=${target.pid || 0}, strategy=${target.strategyCategory || "-"}, symbol=${target.symbol || "-"}`
  );
  console.log(`Scenarios: ${scenarios.map((scenario) => scenario.scenario).join(", ")}`);

  if (ledgerSummary.length > 0) {
    printTable("Ledger Result", ledgerSummary, Object.keys(ledgerSummary[0]));
  }
  if (snapshotSummary.length > 0) {
    printTable("Snapshot Result", snapshotSummary, Object.keys(snapshotSummary[0]));
  }
  if (rowSummary.length > 0) {
    printTable("Grid/Signal Row Result", rowSummary, Object.keys(rowSummary[0]));
  }
  if (reservationSummary.length > 0) {
    printTable("Reservation Result", reservationSummary, Object.keys(reservationSummary[0]));
  }
  if (binanceSummary.length > 0) {
    printTable("Binance Read-only Result", binanceSummary, Object.keys(binanceSummary[0]));
  }

  printTable(
    "Scenario Summary",
    scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      invariant: scenario.invariant,
      status: scenario.status,
      failures: scenario.failures.length > 0 ? scenario.failures.join(" ; ") : "",
    })),
    ["scenario", "invariant", "status", "failures"]
  );

  console.log(`\nPASS/FAIL: ${passLabel}`);
  if (passLabel === "FAIL") {
    console.log(
      `Failure Reasons: ${scenarios
        .filter((scenario) => !scenario.pass)
        .flatMap((scenario) => scenario.failures)
        .join(" | ")}`
    );
  } else {
    console.log("Failure Reasons: none");
  }
  console.log(
    `Canonical Invariants: ${scenarios.map((scenario) => scenario.invariant).filter(Boolean).join(" | ")}`
  );
};

module.exports = {
  normalizeCell,
  toMarkdownTable,
  printTable,
  printQaSummary,
};
