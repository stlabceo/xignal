const SIGNAL_RUNTIME_TYPE_MAX_LENGTH = 10;

const normalizeSignalName = (value) => String(value || "").trim();

const normalizeAliasKey = (value) =>
  normalizeSignalName(value)
    .toUpperCase()
    .replace(/\s+/g, "");

const SIGNAL_STRATEGY_IDENTITIES = [
  {
    displayName: "SQZ+GRID+BREAKOUT",
    strategyCode: "SQZGBRK",
    aliases: ["SQZ+GRID+BREAKOUT", "SQZGBRK"],
  },
  {
    displayName: "ATF+VIXFIX",
    strategyCode: "ATF+VIXFIX",
    aliases: ["ATF+VIXFIX", "NP_ATF+VIXFIX", "ATF_VIXFIX", "ATFVIXFIX"],
  },
];

const identityByAlias = new Map();
for (const identity of SIGNAL_STRATEGY_IDENTITIES) {
  for (const alias of identity.aliases) {
    identityByAlias.set(normalizeAliasKey(alias), identity);
  }
}

const resolveSignalStrategyIdentity = (value, fallbackDisplayName = null) => {
  const raw = normalizeSignalName(value);
  const identity = identityByAlias.get(normalizeAliasKey(raw));
  if (identity) {
    return {
      displayName: identity.displayName,
      strategyCode: identity.strategyCode,
      aliases: identity.aliases.slice(),
    };
  }

  const fallback = normalizeSignalName(fallbackDisplayName);
  return {
    displayName: fallback || raw,
    strategyCode: raw,
    aliases: raw ? [raw] : [],
  };
};

const normalizeSignalStrategyCode = (value) =>
  resolveSignalStrategyIdentity(value).strategyCode;

const normalizeSignalStrategyKey = (value) =>
  normalizeSignalStrategyCode(value).toLowerCase();

module.exports = {
  SIGNAL_RUNTIME_TYPE_MAX_LENGTH,
  SIGNAL_STRATEGY_IDENTITIES,
  normalizeSignalName,
  normalizeSignalStrategyCode,
  normalizeSignalStrategyKey,
  resolveSignalStrategyIdentity,
};
