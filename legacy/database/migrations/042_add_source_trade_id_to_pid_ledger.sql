SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'live_pid_position_ledger' AND column_name = 'sourceTradeId') = 0,
  'ALTER TABLE `live_pid_position_ledger` ADD COLUMN `sourceTradeId` varchar(100) DEFAULT NULL AFTER `sourceOrderId`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
