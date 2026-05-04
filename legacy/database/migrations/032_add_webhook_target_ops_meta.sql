SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'webhook_event_target_log' AND column_name = 'severity') = 0,
  'ALTER TABLE `webhook_event_target_log` ADD COLUMN `severity` varchar(20) NOT NULL DEFAULT ''low'' AFTER `result_code`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'webhook_event_target_log' AND column_name = 'ops_status') = 0,
  'ALTER TABLE `webhook_event_target_log` ADD COLUMN `ops_status` varchar(20) NOT NULL DEFAULT ''OPEN'' AFTER `severity`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'webhook_event_target_log' AND column_name = 'ops_note') = 0,
  'ALTER TABLE `webhook_event_target_log` ADD COLUMN `ops_note` text NULL AFTER `ops_status`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'webhook_event_target_log' AND column_name = 'ops_updated_by') = 0,
  'ALTER TABLE `webhook_event_target_log` ADD COLUMN `ops_updated_by` int(11) unsigned NULL AFTER `ops_note`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'webhook_event_target_log' AND column_name = 'ops_updated_at') = 0,
  'ALTER TABLE `webhook_event_target_log` ADD COLUMN `ops_updated_at` datetime NULL AFTER `ops_updated_by`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'webhook_event_target_log' AND index_name = 'idx_webhook_event_target_ops') = 0,
  'ALTER TABLE `webhook_event_target_log` ADD INDEX `idx_webhook_event_target_ops` (`severity`, `ops_status`, `uid`, `created_at`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE webhook_event_target_log
   SET severity = CASE UPPER(result_code)
     WHEN 'ENTRY_REJECTED' THEN 'high'
     WHEN 'REVERSE_SIGNAL_CLOSE' THEN 'medium'
     WHEN 'REVERSE_SIGNAL_CANCEL' THEN 'medium'
     WHEN 'RUNTIME_NOT_READY' THEN 'medium'
     ELSE 'low'
   END
 WHERE severity IS NULL OR severity = '';

UPDATE webhook_event_target_log
   SET ops_status = 'OPEN'
 WHERE ops_status IS NULL OR ops_status = '';
