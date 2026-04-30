"use strict";

const db = require("./database/connect/config");

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const truthy = (value) => ["1", "true", "y", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const buildIssue = ({ code, label, action }) => ({ code, label, action });

const normalizeRuntimeError = (runtimeHealth = {}) => {
  const code = String(runtimeHealth.lastErrorCode || runtimeHealth.errorCode || "").trim();
  const message = String(runtimeHealth.lastErrorMessage || runtimeHealth.errorMessage || runtimeHealth.message || "").trim();
  const combined = `${code} ${message}`.toUpperCase();

  if (!combined) {
    return null;
  }

  if (combined.includes("IP") || combined.includes("-2015")) {
    return {
      code: "API_IP_RESTRICTION",
      label: "Binance API IP 허용 목록 확인이 필요합니다.",
      action: "서버 IP가 Binance API 허용 목록에 포함되어 있는지 확인해주세요.",
    };
  }

  if (combined.includes("PERMISSION") || combined.includes("FUTURES") || combined.includes("INVALID API-KEY")) {
    return {
      code: "API_PERMISSION",
      label: "Binance Futures API 권한 확인이 필요합니다.",
      action: "Futures 읽기 권한과 주문 권한 설정을 확인해주세요.",
    };
  }

  return null;
};

const derivePositionMode = (runtimeHealth = {}) => {
  if (runtimeHealth.lastHedgeMode === true || runtimeHealth.hedgeMode === true) {
    return "HEDGE";
  }
  if (runtimeHealth.lastHedgeMode === false || runtimeHealth.hedgeMode === false) {
    return "ONE_WAY";
  }
  return "UNKNOWN";
};

const getAccountReadiness = async (uid, { runtimeHealth = null } = {}) => {
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
  const runtimeIssue = normalizeRuntimeError(runtimeHealth || {});
  const positionMode = derivePositionMode(runtimeHealth || {});
  const writeDisabled = truthy(process.env.QA_DISABLE_BINANCE_WRITES);

  if (!hasApiKey) {
    issues.push(
      buildIssue({
        code: "API_KEY_MISSING",
        label: "Binance API Key가 등록되어 있지 않습니다.",
        action: "My Page에서 Binance API Key와 Secret Key를 등록해주세요.",
      })
    );
  }

  if (runtimeIssue) {
    issues.push(runtimeIssue);
  }

  if (!snapshot) {
    issues.push(
      buildIssue({
        code: "ACCOUNT_SNAPSHOT_MISSING",
        label: "최근 선물 지갑 동기화 데이터가 없습니다.",
        action: "API 연결 상태를 확인하고 새로고침해주세요.",
      })
    );
  } else if (!(futuresBalanceUsdt > 0)) {
    issues.push(
      buildIssue({
        code: "FUTURES_BALANCE_USDT_EMPTY",
        label: "투자 가능 USDT가 없습니다.",
        action: "Binance 현물 지갑에서 선물 지갑으로 USDT를 이동해야 합니다.",
      })
    );
  }

  const apiConnection = hasApiKey && !runtimeIssue ? "OK" : hasApiKey ? "ACTION_REQUIRED" : "MISSING";
  const apiPermission = runtimeIssue ? "ACTION_REQUIRED" : hasApiKey ? "READ_OK_ORDER_PERMISSION_UNVERIFIED" : "MISSING";
  const canTradeFutures = hasApiKey && snapshot && futuresBalanceUsdt > 0 && !runtimeIssue;
  const readinessStatus = issues.length === 0 ? "READY" : hasApiKey ? "ACTION_REQUIRED" : "BLOCKED";

  return {
    readinessStatus,
    apiConnection,
    apiConnectionLabel:
      apiConnection === "OK" ? "연결 정상" : apiConnection === "MISSING" ? "API Key 등록 필요" : "연결 확인 필요",
    apiPermission,
    apiPermissionLabel:
      apiPermission === "READ_OK_ORDER_PERMISSION_UNVERIFIED"
        ? "읽기 연결 정상 / 주문 권한은 실거래 전 확인"
        : apiPermission === "ACTION_REQUIRED"
          ? "권한 확인 필요"
          : "API Key 등록 필요",
    futuresBalanceUsdt,
    futuresBalanceLabel: "투자 가능 잔고",
    canTradeFutures,
    positionMode,
    positionModeLabel:
      positionMode === "HEDGE" ? "헤지 모드" : positionMode === "ONE_WAY" ? "단방향 모드" : "확인 불가",
    hedgeMode: {
      status: positionMode,
      label: positionMode === "HEDGE" ? "헤지 모드" : positionMode === "ONE_WAY" ? "단방향 모드" : "확인 불가",
      endpoint: "/admin/account/ensure-hedge-mode",
      actionAvailable: true,
      blockedByWriteGuard: writeDisabled,
      actionLabel: "헤지 모드 자동 설정",
      message: writeDisabled
        ? "현재는 read-only 모드라 설정 변경이 차단되어 있습니다."
        : "live-write 승인 상태에서만 자동 설정할 수 있습니다.",
    },
    assetMode: "SUPPORTED_FUTURES_USDT",
    assetModeLabel: "USDT 선물 지원",
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
