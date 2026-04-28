const fs = require("fs");
const path = require("path");

const QA_DIR = __dirname;
const EXAMPLE_CONFIG_PATH = path.join(QA_DIR, "qa-config.example.json");
const LOCAL_CONFIG_PATH = path.join(QA_DIR, "qa-config.local.json");

const DEFAULTS = {
  mode: "data-replay",
  uid: 0,
  strategyCategory: "SIGNAL",
  strategyId: 0,
  pid: 0,
  symbol: "BTCUSDT",
  positionSide: "LONG",
  maxNotional: 100,
  maxLoss: 10,
  webhookEndpoint: "",
  webhookPayload: {},
  expectedTpSl: {},
  splitTpConfig: {
    enabled: false,
    count: 0,
    gap: 0.2,
  },
  compareSymbols: [],
  qaRunLabel: "QA_DRY_RUN",
  killSwitch: {
    manualCloseProcedure: "",
  },
  dryRun: true,
  allowLiveOrders: false,
};

const normalizeUpper = (value, fallback = "") =>
  String(value || fallback)
    .trim()
    .toUpperCase();

const normalizeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const parseArgs = (argv = process.argv.slice(2)) => {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = String(argv[index] || "");
    if (!raw.startsWith("--")) {
      continue;
    }

    const key = raw.slice(2);
    const next = argv[index + 1];
    if (next && !String(next).startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = "true";
    }
  }
  return result;
};

const safeReadJson = (targetPath) => {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
};

const mergeConfig = (baseConfig = {}, overrideConfig = {}) => ({
  ...baseConfig,
  ...overrideConfig,
  webhookPayload: {
    ...(baseConfig.webhookPayload || {}),
    ...(overrideConfig.webhookPayload || {}),
  },
  expectedTpSl: {
    ...(baseConfig.expectedTpSl || {}),
    ...(overrideConfig.expectedTpSl || {}),
  },
  splitTpConfig: {
    ...(baseConfig.splitTpConfig || {}),
    ...(overrideConfig.splitTpConfig || {}),
  },
  killSwitch: {
    ...(baseConfig.killSwitch || {}),
    ...(overrideConfig.killSwitch || {}),
  },
});

const applyCliOverrides = (config, args = {}) => {
  const next = { ...config };
  if (args.mode) next.mode = args.mode;
  if (args.uid) next.uid = normalizeNumber(args.uid, next.uid);
  if (args.pid) next.pid = normalizeNumber(args.pid, next.pid);
  if (args.strategyId) next.strategyId = normalizeNumber(args.strategyId, next.strategyId);
  if (args.symbol) next.symbol = String(args.symbol).trim().toUpperCase();
  if (args.positionSide) next.positionSide = normalizeUpper(args.positionSide, next.positionSide);
  if (args.strategyCategory) next.strategyCategory = normalizeUpper(args.strategyCategory, next.strategyCategory);
  if (args.dryRun != null) next.dryRun = String(args.dryRun).trim().toLowerCase() !== "false";
  if (args.allowLiveOrders != null) {
    next.allowLiveOrders = String(args.allowLiveOrders).trim().toLowerCase() === "true";
  }
  if (args.qaRunLabel) next.qaRunLabel = String(args.qaRunLabel).trim();
  return next;
};

const finalizeConfig = (config = {}, meta = {}) => {
  const merged = mergeConfig(DEFAULTS, config || {});
  return {
    ...merged,
    uid: normalizeNumber(merged.uid, 0),
    pid: normalizeNumber(merged.pid, 0),
    strategyId: normalizeNumber(merged.strategyId, 0),
    symbol: String(merged.symbol || DEFAULTS.symbol).trim().toUpperCase(),
    positionSide: normalizeUpper(merged.positionSide, DEFAULTS.positionSide),
    strategyCategory: normalizeUpper(merged.strategyCategory, DEFAULTS.strategyCategory),
    maxNotional: normalizeNumber(merged.maxNotional, DEFAULTS.maxNotional),
    maxLoss: normalizeNumber(merged.maxLoss, DEFAULTS.maxLoss),
    dryRun: merged.dryRun !== false,
    allowLiveOrders: merged.allowLiveOrders === true,
    __meta: meta,
  };
};

const loadQaConfig = (options = {}) => {
  const args = parseArgs(options.argv);
  const explicitConfigPath = args.config
    ? path.resolve(process.cwd(), args.config)
    : null;
  const exampleConfig = safeReadJson(EXAMPLE_CONFIG_PATH) || {};
  const localConfig = explicitConfigPath
    ? safeReadJson(explicitConfigPath)
    : safeReadJson(LOCAL_CONFIG_PATH);
  const sourcePath = explicitConfigPath || (fs.existsSync(LOCAL_CONFIG_PATH) ? LOCAL_CONFIG_PATH : EXAMPLE_CONFIG_PATH);
  const merged = mergeConfig(exampleConfig, localConfig || {});
  const overridden = applyCliOverrides(merged, args);
  return finalizeConfig(overridden, {
    configPath: sourcePath,
    usedExampleOnly: !localConfig,
  });
};

module.exports = {
  DEFAULTS,
  EXAMPLE_CONFIG_PATH,
  LOCAL_CONFIG_PATH,
  loadQaConfig,
  parseArgs,
};
