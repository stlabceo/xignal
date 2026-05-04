INSERT INTO `strategy_catalog`
  (`strategyCategory`, `strategyName`, `signalName`, `allowedSymbolsJson`, `allowedTimeframesJson`, `permissionMode`, `allowedMemberIdsJson`, `isActive`, `notes`)
VALUES
  (
    'grid',
    'SQZ+GRID',
    'SQZ+GRID',
    JSON_ARRAY('PUMPUSDT'),
    JSON_ARRAY('5MIN'),
    'ALL',
    NULL,
    'Y',
    'QUANTU grid strategy catalog'
  )
ON DUPLICATE KEY UPDATE
  `strategyName` = VALUES(`strategyName`),
  `allowedSymbolsJson` = VALUES(`allowedSymbolsJson`),
  `allowedTimeframesJson` = VALUES(`allowedTimeframesJson`),
  `permissionMode` = VALUES(`permissionMode`),
  `allowedMemberIdsJson` = VALUES(`allowedMemberIdsJson`),
  `isActive` = VALUES(`isActive`),
  `notes` = VALUES(`notes`);
