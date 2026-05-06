CREATE TABLE IF NOT EXISTS `live_position_bucket_owner` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `uid` int(11) unsigned NOT NULL,
  `symbol` varchar(30) NOT NULL,
  `positionSide` varchar(10) NOT NULL,
  `ownerPid` int(11) unsigned NOT NULL,
  `ownerStrategyCategory` varchar(20) NOT NULL,
  `ownerSignalType` varchar(20) DEFAULT NULL,
  `ownerStrategyName` varchar(120) DEFAULT NULL,
  `ownerState` varchar(30) NOT NULL DEFAULT 'RESERVED',
  `sourceClientOrderId` varchar(80) DEFAULT NULL,
  `sourceOrderId` varchar(40) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `ownedQty` decimal(30,12) NOT NULL DEFAULT 0,
  `reservedCloseQty` decimal(30,12) NOT NULL DEFAULT 0,
  `status` varchar(20) NOT NULL DEFAULT 'OPEN',
  `version` int(11) NOT NULL DEFAULT 0,
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_live_position_bucket_owner_member`
    (`uid`,`symbol`,`positionSide`,`ownerPid`,`ownerStrategyCategory`),
  KEY `idx_live_position_bucket_owner_pid` (`ownerPid`,`ownerStrategyCategory`),
  KEY `idx_live_position_bucket_owner_status` (`status`,`updatedAt`),
  KEY `idx_live_position_bucket_owner_updated` (`updatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `live_position_bucket_owner` ADD COLUMN `ownedQty` decimal(30,12) NOT NULL DEFAULT 0 AFTER `note`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'live_position_bucket_owner'
    AND column_name = 'ownedQty'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `live_position_bucket_owner` ADD COLUMN `reservedCloseQty` decimal(30,12) NOT NULL DEFAULT 0 AFTER `ownedQty`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'live_position_bucket_owner'
    AND column_name = 'reservedCloseQty'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `live_position_bucket_owner` ADD COLUMN `status` varchar(20) NOT NULL DEFAULT ''OPEN'' AFTER `reservedCloseQty`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'live_position_bucket_owner'
    AND column_name = 'status'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `live_position_bucket_owner` ADD COLUMN `version` int(11) NOT NULL DEFAULT 0 AFTER `status`',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'live_position_bucket_owner'
    AND column_name = 'version'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE `live_position_bucket_owner` DROP INDEX `uk_live_position_bucket_owner_bucket`',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'live_position_bucket_owner'
    AND index_name = 'uk_live_position_bucket_owner_bucket'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `live_position_bucket_owner` ADD UNIQUE KEY `uk_live_position_bucket_owner_member` (`uid`,`symbol`,`positionSide`,`ownerPid`,`ownerStrategyCategory`)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'live_position_bucket_owner'
    AND index_name = 'uk_live_position_bucket_owner_member'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `live_position_bucket_owner` ADD KEY `idx_live_position_bucket_owner_status` (`status`,`updatedAt`)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'live_position_bucket_owner'
    AND index_name = 'idx_live_position_bucket_owner_status'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
