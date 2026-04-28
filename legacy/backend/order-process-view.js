const normalizeStageState = (stage = {}) =>
  String(stage?.state || "")
    .trim()
    .toUpperCase();

const toBinaryStageLabel = (stage = {}) => {
  const state = normalizeStageState(stage);
  if (state === "ABNORMAL") {
    return "비정상";
  }
  if (state === "NORMAL" || state === "ACTIVE") {
    return "정상";
  }
  return "";
};

const combineBinaryStageLabel = (...stages) => {
  const normalizedStages = stages.filter(Boolean);
  if (normalizedStages.some((stage) => normalizeStageState(stage) === "ABNORMAL")) {
    return "비정상";
  }
  if (
    normalizedStages.some((stage) => {
      const state = normalizeStageState(stage);
      return state === "NORMAL" || state === "ACTIVE";
    })
  ) {
    return "정상";
  }
  return "";
};

const normalizeDateMs = (value) => {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const toIsoDateTime = (value) => {
  const parsedMs = normalizeDateMs(value);
  return parsedMs ? new Date(parsedMs).toISOString() : null;
};

const getLatestMs = (values = []) =>
  values
    .map((value) => normalizeDateMs(value))
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || null;

const buildLifecycleTimes = ({
  createdAt,
  ledgerRows = [],
  reservationRows = [],
  snapshotRows = [],
  binanceRows = [],
} = {}) => {
  const latestExitMs = getLatestMs([
    ...ledgerRows.map((row) => row.tradeTime || row.createdAt),
    ...reservationRows.map((row) => row.updatedAt || row.createdAt),
    ...snapshotRows.map((row) => row.lastExitAt || row.updatedAt || row.createdAt),
  ]);

  const latestAnyMs = getLatestMs([
    ...binanceRows.map((row) => row.createdAt),
    ...ledgerRows.map((row) => row.tradeTime || row.createdAt),
    ...reservationRows.map((row) => row.updatedAt || row.createdAt),
    ...snapshotRows.map((row) => row.lastEntryAt || row.lastExitAt || row.updatedAt || row.createdAt),
    createdAt,
  ]);

  return {
    latestExitAt: latestExitMs ? new Date(latestExitMs).toISOString() : null,
    latestAnyAt: latestAnyMs ? new Date(latestAnyMs).toISOString() : null,
  };
};

const buildCommonProjection = ({
  processKind,
  processKindLabel,
  createdAt,
  completed,
  isAbnormal,
  problemDetail,
  ledgerRows = [],
  reservationRows = [],
  snapshotRows = [],
  binanceRows = [],
} = {}) => {
  const lifecycleTimes = buildLifecycleTimes({
    createdAt,
    ledgerRows,
    reservationRows,
    snapshotRows,
    binanceRows,
  });

  return {
    processKind,
    processKindLabel,
    overallResultLabel: completed ? "완료" : "진행중",
    summaryStatusLabel: isAbnormal ? "비정상" : "정상",
    summaryText: isAbnormal ? `비정상 / ${problemDetail || "원인 미상"}` : "정상",
    webhookOccurredAt: toIsoDateTime(createdAt),
    completedAt: completed ? lifecycleTimes.latestExitAt || lifecycleTimes.latestAnyAt || toIsoDateTime(createdAt) : null,
    abnormalAt: isAbnormal ? lifecycleTimes.latestAnyAt || toIsoDateTime(createdAt) : null,
  };
};

const buildAlgorithmProcessView = ({
  createdAt,
  completed,
  isAbnormal,
  problemDetail,
  webhookStage,
  waitingStage,
  entryStage,
  exitPendingStage,
  exitStage,
  ledgerRows = [],
  reservationRows = [],
  snapshotRows = [],
  binanceRows = [],
} = {}) => ({
  ...buildCommonProjection({
    processKind: "algorithm",
    processKindLabel: "알고리즘",
    createdAt,
    completed,
    isAbnormal,
    problemDetail,
    ledgerRows,
    reservationRows,
    snapshotRows,
    binanceRows,
  }),
  algorithmProcess: {
    webhook: toBinaryStageLabel(webhookStage),
    exactWait: toBinaryStageLabel(waitingStage),
    entry: toBinaryStageLabel(entryStage),
    exit: combineBinaryStageLabel(exitPendingStage, exitStage),
  },
});

const buildGridProcessView = ({
  createdAt,
  completed,
  isAbnormal,
  problemStage,
  problemDetail,
  webhookStage,
  waitingStage,
  entryStage,
  exitPendingStage,
  exitStage,
  ledgerRows = [],
  reservationRows = [],
  snapshotRows = [],
  binanceRows = [],
} = {}) => {
  let finishStageLabel = "";
  if (completed) {
    const finishIsAbnormal =
      normalizeStageState(exitPendingStage) === "ABNORMAL" ||
      normalizeStageState(exitStage) === "ABNORMAL" ||
      ["종료", "청산대기", "청산"].includes(String(problemStage || "").trim());
    finishStageLabel = finishIsAbnormal ? "비정상" : "정상";
  }

  return {
    ...buildCommonProjection({
      processKind: "grid",
      processKindLabel: "그리드",
      createdAt,
      completed,
      isAbnormal,
      problemDetail,
      ledgerRows,
      reservationRows,
      snapshotRows,
      binanceRows,
    }),
    gridProcess: {
      webhook: toBinaryStageLabel(webhookStage),
      gridding: combineBinaryStageLabel(waitingStage, entryStage, exitPendingStage, completed ? null : exitStage),
      finish: finishStageLabel,
    },
  };
};

const buildOrderProcessView = (payload = {}) => {
  const category = String(payload.strategyCategory || "")
    .trim()
    .toLowerCase();

  if (category === "grid") {
    return buildGridProcessView(payload);
  }

  return buildAlgorithmProcessView(payload);
};

module.exports = {
  toBinaryStageLabel,
  combineBinaryStageLabel,
  buildAlgorithmProcessView,
  buildGridProcessView,
  buildOrderProcessView,
};
