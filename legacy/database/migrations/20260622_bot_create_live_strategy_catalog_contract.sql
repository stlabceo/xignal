INSERT INTO `strategy_catalog`
  (`strategyCategory`, `strategyName`, `signalName`, `allowedSymbolsJson`, `allowedTimeframesJson`, `permissionMode`, `allowedMemberIdsJson`, `isActive`, `notes`)
VALUES
  (
    'signal',
    'ATF+VIXFIX',
    'ATF+VIXFIX',
    JSON_ARRAY('BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT', 'DOGEUSDT', 'PUMPUSDT'),
    JSON_ARRAY('1MIN', '3MIN', '5MIN', '10MIN', '15MIN', '30MIN', '1H'),
    'ALL',
    NULL,
    'Y',
    'Bot create live catalog contract: liveCode=ATF_VIXFIX_V1; instrument=PERP/USD_M_FUTURES'
  ),
  (
    'grid',
    'NYBOX 50/50',
    'NY_BOX_GRID_50_50',
    JSON_ARRAY('HBARUSDT', 'AVAXUSDT', 'XRPUSDT'),
    JSON_ARRAY('15MIN'),
    'ALL',
    NULL,
    'Y',
    'Bot create live catalog contract: liveCode=NYBOX_GRID_50_50_V1; variant=50_50; instrument=PERP/USD_M_FUTURES'
  ),
  (
    'grid',
    'NYBOX 35/65',
    'NY_BOX_GRID_35_65',
    JSON_ARRAY('HBARUSDT', 'AVAXUSDT', 'XRPUSDT'),
    JSON_ARRAY('15MIN'),
    'ALL',
    NULL,
    'Y',
    'Bot create live catalog contract: liveCode=NYBOX_GRID_35_65_V1; variant=35_65; instrument=PERP/USD_M_FUTURES'
  )
ON DUPLICATE KEY UPDATE
  `strategyName` = VALUES(`strategyName`),
  `allowedSymbolsJson` = VALUES(`allowedSymbolsJson`),
  `allowedTimeframesJson` = VALUES(`allowedTimeframesJson`),
  `permissionMode` = VALUES(`permissionMode`),
  `allowedMemberIdsJson` = VALUES(`allowedMemberIdsJson`),
  `isActive` = VALUES(`isActive`),
  `notes` = VALUES(`notes`);
