"use strict";

const db = require("./database/connect/config");

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const buildIssue = ({ code, label, action }) => ({ code, label, action });

const getAccountReadiness = async (uid) => {
  const [[memberRows], [snapshotRows]] = await Promise.all([
    db.query(
      `SELECT id, appKey, appSecret, tradeAccessMode
         FROM admin_member
        WHERE id = ?
        LIMIT 1`,
      [uid]
    ),
    db.query(
      `SELECT
          available_balance AS availableBalance,
          total_wallet_balance AS totalWalletBalance,
          total_unrealized_profit AS totalUnrealizedProfit,
          position_count AS positionCount,
          account_mode AS accountMode,
          risk_level AS riskLevel,
          created_at AS createdAt
        FROM account_risk_snapshot
       WHERE uid = ?
       ORDER BY id DESC
       LIMIT 1`,
      [uid]
    ),
  ]);

  const member = memberRows[0] || {};
  const snapshot = snapshotRows[0] || null;
  const issues = [];
  const hasApiKey = Boolean(member.appKey && member.appSecret);
  const futuresBalanceUsdt = snapshot ? toNumber(snapshot.availableBalance) : null;

  if (!hasApiKey) {
    issues.push(
      buildIssue({
        code: "API_KEY_MISSING",
        label: "API Key가 등록되어 있지 않습니다.",
        action: "My Page에서 Binance API Key와 Secret Key를 등록해주세요.",
      })
    );
  }

  if (!snapshot) {
    issues.push(
      buildIssue({
        code: "ACCOUNT_SNAPSHOT_MISSING",
        label: "최근 선물 지갑 동기화 데이터가 없습니다.",
        action: "API 연결을 확인하고 새로고침해주세요.",
      })
    );
  } else if (!(futuresBalanceUsdt > 0)) {
    issues.push(
      buildIssue({
        code: "FUTURES_BALANCE_USDT_EMPTY",
        label: "선물 지갑에 사용 가능한 USDT가 없습니다.",
        action: "Binance에서 현물 지갑 -> 선물 지갑으로 USDT를 이동한 뒤 다시 운용을 켜주세요.",
      })
    );
  }

  const canTradeFutures = hasApiKey && snapshot && futuresBalanceUsdt > 0;
  const readinessStatus = issues.length === 0 ? "READY" : hasApiKey ? "ACTION_REQUIRED" : "BLOCKED";

  return {
    readinessStatus,
    apiConnection: hasApiKey ? "OK" : "MISSING",
    apiPermission: hasApiKey ? "CHECK_RUNTIME_HEALTH" : "MISSING",
    futuresBalanceUsdt,
    canTradeFutures,
    positionMode: "HEDGE_MODE_REQUIRED",
    assetMode: "SUPPORTED_FUTURES_USDT",
    lastSyncedAt: snapshot?.createdAt || null,
    accountMode: snapshot?.accountMode || null,
    riskLevel: snapshot?.riskLevel || null,
    issues,
    generatedAt: new Date().toISOString(),
  };
};

module.exports = {
  getAccountReadiness,
};
