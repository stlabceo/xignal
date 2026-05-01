"use strict";

const db = require("./database/connect/config");

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const truthy = (value) =>
  ["1", "true", "y", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const buildIssue = ({ code, label, action }) => ({ code, label, action });

const derivePositionMode = (runtimeHealth = {}) => {
  if (runtimeHealth.lastHedgeMode === true || runtimeHealth.hedgeMode === true) {
    return "HEDGE";
  }
  if (runtimeHealth.lastHedgeMode === false || runtimeHealth.hedgeMode === false) {
    return "ONE_WAY";
  }
  return "UNKNOWN";
};

const normalizeApiValidationIssue = (apiValidation = null) => {
  if (!apiValidation || apiValidation.ok) {
    return null;
  }

  const code = String(apiValidation.code || apiValidation.errorCode || "").trim();
  const action = String(apiValidation.action || "").trim();
  const message = String(apiValidation.messageKo || apiValidation.message || "").trim();
  const combined = `${code} ${action} ${message}`.toUpperCase();

  if (combined.includes("-2015") || combined.includes("IP")) {
    return buildIssue({
      code: "API_IP_RESTRICTION_OR_KEY_INVALID",
      label: "Binance API Key 또는 IP 허용 목록 확인이 필요합니다.",
      action: "API Key 활성 상태, Secret Key, 서버 IP 허용 목록을 확인해 주세요.",
    });
  }

  if (combined.includes("PERMISSION") || combined.includes("FUTURES")) {
    return buildIssue({
      code: "API_PERMISSION",
      label: "Binance Futures API 권한 확인이 필요합니다.",
      action:
        "Futures 읽기 권한과 IP 허용 목록을 확인해 주세요. 주문 권한은 live-write preflight에서만 최종 확인합니다.",
    });
  }

  if (combined.includes("TIMEOUT") || combined.includes("ECONNABORTED")) {
    return buildIssue({
      code: "BINANCE_API_TIMEOUT",
      label: "Binance API 연결 검증 요청이 시간 초과되었습니다.",
      action: "잠시 후 다시 시도해 주세요.",
    });
  }

  return buildIssue({
    code: code ? `BINANCE_API_${code}` : "BINANCE_API_VALIDATION_FAILED",
    label: "Binance API 연결 검증에 실패했습니다.",
    action: message || "API Key, Secret Key, Binance 계정 권한을 확인해 주세요.",
  });
};

const normalizeRuntimeError = (runtimeHealth = {}) => {
  const code = String(runtimeHealth.lastErrorCode || runtimeHealth.errorCode || "").trim();
  const message = String(
    runtimeHealth.lastErrorMessage || runtimeHealth.errorMessage || runtimeHealth.message || ""
  ).trim();
  const combined = `${code} ${message}`.toUpperCase();

  if (!combined) {
    return null;
  }

  if (combined.includes("IP") || combined.includes("-2015")) {
    return buildIssue({
      code: "API_IP_RESTRICTION",
      label: "Binance API IP 허용 목록 확인이 필요합니다.",
      action: "서버 IP가 Binance API 허용 목록에 포함되어 있는지 확인해 주세요.",
    });
  }

  if (combined.includes("PERMISSION") || combined.includes("FUTURES") || combined.includes("INVALID API-KEY")) {
    return buildIssue({
      code: "API_PERMISSION",
      label: "Binance Futures API 권한 확인이 필요합니다.",
      action: "Futures 읽기 권한과 IP 허용 목록을 확인해 주세요.",
    });
  }

  return null;
};

const getRuntimeStatus = (runtimeHealth = {}) => String(runtimeHealth?.status || "").trim().toUpperCase();

const isUserStreamAuthError = (runtimeHealth = {}) => {
  const code = String(runtimeHealth.lastErrorCode || runtimeHealth.errorCode || "").trim();
  const message = String(
    runtimeHealth.lastErrorMessage || runtimeHealth.errorMessage || runtimeHealth.message || ""
  ).trim();
  const combined = `${code} ${message}`.toUpperCase();
  return (
    combined.includes("-2015") ||
    combined.includes("INVALID API-KEY") ||
    combined.includes("PERMISSION") ||
    combined.includes("FUTURES") ||
    combined.includes("IP")
  );
};

const buildUserStreamReadiness = ({
  hasApiKey,
  apiReadOk,
  runtimeHealth,
  writeDisabled,
  liveWriteEnabled,
  enabledSignalCount,
  enabledGridCount,
}) => {
  const runtimeStatus = getRuntimeStatus(runtimeHealth || {});
  const connected = Boolean(runtimeHealth?.connected) || Number(runtimeHealth?.wsReadyState) === 1;
  const enabledStrategyCount = Number(enabledSignalCount || 0) + Number(enabledGridCount || 0);
  const liveWriteCapable = !writeDisabled && liveWriteEnabled;
  const requiredNow = Boolean(hasApiKey && apiReadOk && liveWriteCapable && enabledStrategyCount > 0);
  const base = {
    connected,
    requiredNow,
    enabledSignalCount: Number(enabledSignalCount || 0),
    enabledGridCount: Number(enabledGridCount || 0),
    rawRuntimeStatus: runtimeStatus || "UNKNOWN",
    lastConnectedAt: runtimeHealth?.lastReadyAt || runtimeHealth?.lastMessageAt || null,
    lastKeepaliveAt: runtimeHealth?.lastKeepAliveAt || null,
    lastMessageAt: runtimeHealth?.lastMessageAt || null,
    listenKeyPresent: Boolean(runtimeHealth?.listenKey),
  };

  if (!hasApiKey) {
    return {
      ...base,
      status: "API_KEY_MISSING",
      label: "API 등록 후 확인",
      severity: "INFO",
      reason: "API_KEY_MISSING",
      nextAction: "API Key와 Secret Key를 등록하면 수신 상태를 확인합니다.",
      abnormalCounted: false,
    };
  }

  if (writeDisabled) {
    return {
      ...base,
      status: "STREAM_NOT_REQUIRED_READONLY",
      label: "read-only 모드: 수신 대기",
      severity: "INFO",
      requiredNow: false,
      reason: "READ_ONLY_WRITE_DISABLED",
      nextAction: "자동매매 시작 시 실시간 주문 이벤트 수신을 연결합니다.",
      abnormalCounted: false,
    };
  }

  if (!apiReadOk) {
    return {
      ...base,
      status: "STREAM_AUTH_ERROR",
      label: "API 권한 확인 필요",
      severity: "CRITICAL",
      requiredNow: false,
      reason: "API_READ_NOT_READY",
      nextAction: "API Key, Secret Key, Futures 읽기 권한 또는 IP 허용 목록을 확인해 주세요.",
      abnormalCounted: true,
    };
  }

  if (!liveWriteCapable || enabledStrategyCount === 0) {
    return {
      ...base,
      status: "API_READ_OK_LIVE_DISABLED",
      label: "실거래 시작 전 대기",
      severity: "INFO",
      requiredNow: false,
      reason: !liveWriteCapable ? "LIVE_WRITE_DISABLED" : "NO_ENABLED_STRATEGY",
      nextAction: "자동매매 시작 시 실시간 주문 이벤트 수신을 연결합니다.",
      abnormalCounted: false,
    };
  }

  if (connected || runtimeStatus === "CONNECTED") {
    return {
      ...base,
      status: "STREAM_CONNECTED",
      label: "연결 정상",
      severity: "OK",
      reason: "CONNECTED",
      nextAction: "",
      abnormalCounted: false,
    };
  }

  if (isUserStreamAuthError(runtimeHealth || {})) {
    return {
      ...base,
      status: "STREAM_AUTH_ERROR",
      label: "API 권한 확인 필요",
      severity: "CRITICAL",
      reason: "LISTEN_KEY_AUTH_ERROR",
      nextAction: "listenKey 생성/유지에 필요한 Binance API 권한과 IP 허용 목록을 확인해 주세요.",
      abnormalCounted: true,
    };
  }

  if (runtimeHealth?.retryAt || runtimeHealth?.disabledUntil || ["CONNECTING", "ERROR"].includes(runtimeStatus)) {
    return {
      ...base,
      status: "STREAM_RECONNECTING",
      label: "재연결 중",
      severity: "WARN",
      reason: runtimeStatus || "RECONNECTING",
      nextAction: "잠시 후 자동 재연결 상태를 다시 확인해 주세요.",
      abnormalCounted: true,
    };
  }

  return {
    ...base,
    status: "STREAM_DISCONNECTED_REQUIRED",
    label: "실시간 주문 이벤트 수신 끊김",
    severity: "CRITICAL",
    reason: runtimeStatus || "DISCONNECTED",
    nextAction: "실거래 가능 상태에서 User Stream 연결이 필요합니다. runtime 상태를 확인해 주세요.",
    abnormalCounted: true,
  };
};

const getAccountReadiness = async (uid, { runtimeHealth = null } = {}) => {
  const [[memberRows], [snapshotRows], [enabledSignalRows], [enabledGridRows]] = await Promise.all([
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
    db.query(
      `SELECT COUNT(*) AS cnt
         FROM live_play_list
        WHERE uid = ?
          AND enabled = 'Y'`,
      [uid]
    ),
    db.query(
      `SELECT COUNT(*) AS cnt
         FROM live_grid_strategy_list
        WHERE uid = ?
          AND enabled = 'Y'`,
      [uid]
    ),
  ]);

  const member = memberRows[0] || {};
  const snapshot = snapshotRows[0] || null;
  const enabledSignalCount = Number(enabledSignalRows?.[0]?.cnt || 0);
  const enabledGridCount = Number(enabledGridRows?.[0]?.cnt || 0);
  const issues = [];
  const hasApiKey = Boolean(member.appKey && member.appSecret);
  const futuresBalanceUsdt = snapshot ? toNumber(snapshot.availableBalance) : null;
  const apiValidation = runtimeHealth?.apiValidation || null;
  const runtimeIssue = normalizeApiValidationIssue(apiValidation) || normalizeRuntimeError(runtimeHealth || {});
  const positionMode = derivePositionMode(runtimeHealth || {});
  const writeDisabled = truthy(process.env.QA_DISABLE_BINANCE_WRITES);
  const liveWriteEnabled = truthy(process.env.BINANCE_LIVE_WRITES_ENABLED);
  const runtimeExcluded = Boolean(runtimeHealth?.excluded);

  if (!hasApiKey) {
    issues.push(
      buildIssue({
        code: "API_KEY_MISSING",
        label: "Binance API Key가 등록되어 있지 않습니다.",
        action: "My Page에서 Binance API Key와 Secret Key를 등록해 주세요.",
      })
    );
  }

  if (runtimeIssue) {
    issues.push(runtimeIssue);
  }

  if (hasApiKey && runtimeExcluded) {
    issues.push(
      buildIssue({
        code: "RUNTIME_UID_EXCLUDED",
        label: "현재 UID가 runtime 연결 대상에서 제외되어 있습니다.",
        action: "Live QA 대상으로 사용하려면 별도 preflight에서 runtime 제외 설정을 해제해야 합니다.",
      })
    );
  }

  if (!snapshot) {
    issues.push(
      buildIssue({
        code: "ACCOUNT_SNAPSHOT_MISSING",
        label: "최근 선물 계정 동기화 데이터가 없습니다.",
        action: "API 연결 상태를 확인하고 새로고침해 주세요.",
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

  const apiReadOk = hasApiKey && (!apiValidation || apiValidation.ok) && !runtimeIssue;
  const apiConnection = apiReadOk ? "OK" : hasApiKey ? "ACTION_REQUIRED" : "MISSING";
  const apiPermission = runtimeIssue ? "ACTION_REQUIRED" : hasApiKey ? "READ_OK_ORDER_PERMISSION_UNVERIFIED" : "MISSING";
  const canTradeFutures = apiReadOk && snapshot && futuresBalanceUsdt > 0 && !runtimeExcluded;
  const userStream = buildUserStreamReadiness({
    hasApiKey,
    apiReadOk,
    runtimeHealth,
    writeDisabled,
    liveWriteEnabled,
    enabledSignalCount,
    enabledGridCount,
  });

  if (userStream.requiredNow && userStream.abnormalCounted) {
    issues.push(
      buildIssue({
        code: userStream.status,
        label: userStream.label,
        action: userStream.nextAction,
      })
    );
  }

  const readinessStatus = issues.length === 0 ? "READY" : hasApiKey ? "ACTION_REQUIRED" : "BLOCKED";

  return {
    readinessStatus,
    apiConnection,
    apiConnectionLabel:
      apiConnection === "OK" ? "연결 정상" : apiConnection === "MISSING" ? "API Key 등록 필요" : "연결 확인 필요",
    apiPermission,
    apiPermissionLabel:
      apiPermission === "READ_OK_ORDER_PERMISSION_UNVERIFIED"
        ? "읽기 연결 정상 / 주문 권한은 실거래 전 확인 예정"
        : apiPermission === "ACTION_REQUIRED"
          ? "권한 확인 필요"
          : "API Key 등록 필요",
    futuresBalanceUsdt,
    futuresBalanceLabel: "투자 가능 잔고",
    canTradeFutures,
    userStream,
    positionMode,
    positionModeLabel:
      positionMode === "HEDGE" ? "헤지 모드" : positionMode === "ONE_WAY" ? "원웨이 모드" : "검증 불가",
    hedgeMode: {
      status: positionMode,
      label: positionMode === "HEDGE" ? "헤지 모드" : positionMode === "ONE_WAY" ? "원웨이 모드" : "검증 불가",
      endpoint: "/user/api/account/ensure-hedge-mode",
      actionAvailable: true,
      blockedByWriteGuard: writeDisabled,
      actionLabel: "헤지 모드 자동 설정",
      message: writeDisabled
        ? "현재 read-only 모드라 설정 변경이 차단되어 있습니다."
        : "live-write 승인 상태에서만 자동 설정할 수 있습니다.",
    },
    assetMode: "SUPPORTED_FUTURES_USDT",
    assetModeLabel: "USDT 선물 지원",
    lastSyncedAt: snapshot?.createdAt || null,
    accountMode: snapshot?.accountMode || null,
    riskLevel: snapshot?.riskLevel || null,
    issues,
    apiValidation: apiValidation
      ? {
          ok: Boolean(apiValidation.ok),
          code: apiValidation.code || null,
          action: apiValidation.action || null,
        }
      : null,
    generatedAt: new Date().toISOString(),
  };
};

module.exports = {
  getAccountReadiness,
};
