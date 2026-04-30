CREATE TABLE IF NOT EXISTS strategy_stats_raw (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source VARCHAR(32) NOT NULL,
  category VARCHAR(32) NOT NULL,
  strategyCode VARCHAR(32) NOT NULL,
  strategyDisplayName VARCHAR(128) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(16) NOT NULL,
  calcMode VARCHAR(32) NOT NULL,
  payloadHash CHAR(64) NOT NULL,
  rawJson JSON NOT NULL,
  receivedAt DATETIME NOT NULL,
  validationStatus VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_strategy_stats_raw_payload_hash (payloadHash),
  KEY ix_strategy_stats_raw_lookup (category, strategyCode, symbol, timeframe, receivedAt)
);

CREATE TABLE IF NOT EXISTS strategy_stats_metric (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rawId BIGINT NOT NULL,
  category VARCHAR(32) NOT NULL,
  strategyCode VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(16) NOT NULL,
  periodKey VARCHAR(16) NOT NULL,
  tp DECIMAL(8,4) NOT NULL,
  winRate DECIMAL(10,4) NOT NULL,
  netProfit DECIMAL(18,8) NOT NULL,
  source VARCHAR(32) NOT NULL,
  calculatedAt DATETIME NOT NULL,
  UNIQUE KEY uq_strategy_stats_metric_cell (rawId, periodKey, tp),
  KEY ix_strategy_stats_metric_rank (category, strategyCode, symbol, timeframe, periodKey, netProfit),
  CONSTRAINT fk_strategy_stats_metric_raw
    FOREIGN KEY (rawId) REFERENCES strategy_stats_raw (id)
);

CREATE TABLE IF NOT EXISTS strategy_stats_bestcase (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rawId BIGINT NOT NULL,
  category VARCHAR(32) NOT NULL,
  strategyCode VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(16) NOT NULL,
  periodKey VARCHAR(16) NOT NULL,
  bestTp DECIMAL(8,4) NOT NULL,
  bestWinRate DECIMAL(10,4) NOT NULL,
  bestNetProfit DECIMAL(18,8) NOT NULL,
  source VARCHAR(32) NOT NULL,
  calculatedAt DATETIME NOT NULL,
  UNIQUE KEY uq_strategy_stats_bestcase_period (rawId, periodKey),
  KEY ix_strategy_stats_bestcase_lookup (category, strategyCode, symbol, timeframe, periodKey, calculatedAt),
  CONSTRAINT fk_strategy_stats_bestcase_raw
    FOREIGN KEY (rawId) REFERENCES strategy_stats_raw (id)
);

CREATE TABLE IF NOT EXISTS landing_strategy_rank_cache (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(32) NOT NULL,
  periodKey VARCHAR(16) NOT NULL,
  rankNo INT NOT NULL DEFAULT 0,
  strategyCode VARCHAR(32) NOT NULL,
  strategyDisplayName VARCHAR(128) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(16) NOT NULL,
  score DECIMAL(18,8) NOT NULL,
  bestTp DECIMAL(8,4) NULL,
  netProfit DECIMAL(18,8) NOT NULL,
  winRate DECIMAL(10,4) NOT NULL,
  source VARCHAR(32) NOT NULL,
  updatedAt DATETIME NOT NULL,
  UNIQUE KEY uq_landing_rank_strategy (category, periodKey, strategyCode, symbol, timeframe),
  KEY ix_landing_rank_period_score (category, periodKey, score, winRate)
);
