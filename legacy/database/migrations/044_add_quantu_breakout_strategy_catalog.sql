INSERT INTO `strategy_catalog`
  (`strategyCategory`, `strategyName`, `signalName`, `allowedSymbolsJson`, `allowedTimeframesJson`, `permissionMode`, `allowedMemberIdsJson`, `isActive`, `notes`)
VALUES
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
  )
ON DUPLICATE KEY UPDATE
  `strategyName` = VALUES(`strategyName`),
  `allowedSymbolsJson` = VALUES(`allowedSymbolsJson`),
  `allowedTimeframesJson` = VALUES(`allowedTimeframesJson`),
  `permissionMode` = VALUES(`permissionMode`),
  `allowedMemberIdsJson` = VALUES(`allowedMemberIdsJson`),
  `isActive` = VALUES(`isActive`),
  `notes` = VALUES(`notes`);
