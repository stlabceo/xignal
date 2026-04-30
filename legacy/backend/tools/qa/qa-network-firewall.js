const http = require("http");
const https = require("https");
const { truthy } = require("../../binance-write-guard");

let installed = false;

const normalizeRequestTarget = (input, options = {}) => {
  const result = {
    host: "",
    method: "GET",
    href: "",
  };

  if (typeof input === "string" || input instanceof URL) {
    const url = new URL(String(input));
    result.host = url.hostname;
    result.href = url.href;
  } else if (input && typeof input === "object") {
    result.host = input.hostname || input.host || "";
    result.method = input.method || result.method;
  }

  if (options && typeof options === "object") {
    result.host = options.hostname || options.host || result.host;
    result.method = options.method || result.method;
  }

  result.host = String(result.host || "").replace(/:\d+$/, "").toLowerCase();
  result.method = String(result.method || "GET").trim().toUpperCase();
  return result;
};

const shouldBlock = (target) => {
  const host = String(target.host || "").toLowerCase();
  const method = String(target.method || "GET").toUpperCase();
  return (
    (truthy(process.env.QA_REPLAY_MODE) || truthy(process.env.QA_DISABLE_BINANCE_WRITES)) &&
    host.includes("binance.com") &&
    ["POST", "DELETE", "PUT", "PATCH"].includes(method)
  );
};

const wrapRequest = (originalRequest, protocol) =>
  function guardedRequest(input, options, callback) {
    const target = normalizeRequestTarget(input, options);
    if (shouldBlock(target)) {
      const error = new Error(`QA_REPLAY_BINANCE_NETWORK_WRITE_BLOCKED:${target.method}:${target.host}`);
      error.code = "QA_REPLAY_BINANCE_NETWORK_WRITE_BLOCKED";
      error.target = target;
      throw error;
    }
    return originalRequest.call(this, input, options, callback);
  };

const installQaReplayNetworkFirewall = () => {
  if (installed) {
    return { installed: true, alreadyInstalled: true };
  }

  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  http.request = wrapRequest(originalHttpRequest, "http");
  https.request = wrapRequest(originalHttpsRequest, "https");
  installed = true;
  return { installed: true, alreadyInstalled: false };
};

module.exports = {
  installQaReplayNetworkFirewall,
  normalizeRequestTarget,
  shouldBlock,
};
