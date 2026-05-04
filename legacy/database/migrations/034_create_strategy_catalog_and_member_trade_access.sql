CREATE TABLE IF NOT EXISTS `strategy_catalog` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `strategyCategory` varchar(20) NOT NULL,
  `strategyName` varchar(120) NOT NULL,
  `signalName` varchar(120) NOT NULL,
  `allowedSymbolsJson` json DEFAULT NULL,
  `allowedTimeframesJson` json DEFAULT NULL,
  `permissionMode` varchar(20) NOT NULL DEFAULT 'ALL',
  `allowedMemberIdsJson` json DEFAULT NULL,
  `isActive` char(1) NOT NULL DEFAULT 'Y',
  `notes` text,
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_strategy_catalog_category_signal` (`strategyCategory`, `signalName`),
  KEY `idx_strategy_catalog_active` (`isActive`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'admin_member' AND column_name = 'tradeAccessMode') = 0,
  'ALTER TABLE `admin_member` ADD COLUMN `tradeAccessMode` varchar(20) NOT NULL DEFAULT ''DEMO_ONLY'' AFTER `appSecret`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `admin_member`
SET `tradeAccessMode` = CASE
  WHEN COALESCE(TRIM(`appKey`), '') <> '' AND COALESCE(TRIM(`appSecret`), '') <> '' THEN 'LIVE_DEMO'
  ELSE 'DEMO_ONLY'
END;

INSERT INTO `strategy_catalog`
  (`strategyCategory`, `strategyName`, `signalName`, `allowedSymbolsJson`, `allowedTimeframesJson`, `permissionMode`, `allowedMemberIdsJson`, `isActive`, `notes`)
VALUES
  (
    'signal',
    'ATF+VIXFIX',
    'ATF+VIXFIX',
    JSON_ARRAY('BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT', 'DOGEUSDT', 'PUMPUSDT'),
    JSON_ARRAY('1MIN', '3MIN', '5MIN', '10MIN', '15MIN'),
    'ALL',
    NULL,
    'Y',
    'Default signal strategy catalog'
  ),
  (
    'signal',
    'SQZ+GRID+BREAKOUT',
    'SQZGBRK',
    JSON_ARRAY('PUMPUSDT'),
    JSON_ARRAY('5MIN'),
    'ALL',
    NULL,
    'Y',
    'QUANTU signal breakout strategy; displayName=SQZ+GRID+BREAKOUT; runtimeCode=SQZGBRK'
  ),
  (
    'grid',
    'SQZ+GRID',
    'SQZ+GRID',
    JSON_ARRAY('PUMPUSDT'),
    JSON_ARRAY('5MIN'),
    'ALL',
    NULL,
    'Y',
    'Default grid strategy catalog'
  )
ON DUPLICATE KEY UPDATE
  `strategyName` = VALUES(`strategyName`),
  `allowedSymbolsJson` = VALUES(`allowedSymbolsJson`),
  `allowedTimeframesJson` = VALUES(`allowedTimeframesJson`),
  `permissionMode` = VALUES(`permissionMode`),
  `allowedMemberIdsJson` = VALUES(`allowedMemberIdsJson`),
  `isActive` = VALUES(`isActive`),
  `notes` = VALUES(`notes`);
