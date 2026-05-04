SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'live_grid_strategy_list' AND column_name = 'regimeEndReason') = 0,
  'ALTER TABLE `live_grid_strategy_list` ADD COLUMN `regimeEndReason` varchar(40) DEFAULT NULL AFTER `regimeStatus`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'live_grid_strategy_list' AND column_name = 'longStopOrderId') = 0,
  'ALTER TABLE `live_grid_strategy_list` ADD COLUMN `longStopOrderId` varchar(64) DEFAULT NULL AFTER `longExitOrderId`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'live_grid_strategy_list' AND column_name = 'shortStopOrderId') = 0,
  'ALTER TABLE `live_grid_strategy_list` ADD COLUMN `shortStopOrderId` varchar(64) DEFAULT NULL AFTER `shortExitOrderId`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'test_grid_strategy_list' AND column_name = 'regimeEndReason') = 0,
  'ALTER TABLE `test_grid_strategy_list` ADD COLUMN `regimeEndReason` varchar(40) DEFAULT NULL AFTER `regimeStatus`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'test_grid_strategy_list' AND column_name = 'longStopOrderId') = 0,
  'ALTER TABLE `test_grid_strategy_list` ADD COLUMN `longStopOrderId` varchar(64) DEFAULT NULL AFTER `longExitOrderId`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'test_grid_strategy_list' AND column_name = 'shortStopOrderId') = 0,
  'ALTER TABLE `test_grid_strategy_list` ADD COLUMN `shortStopOrderId` varchar(64) DEFAULT NULL AFTER `shortExitOrderId`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
