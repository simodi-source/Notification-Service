const { env } = require("../config/env");

const DEFAULT_TIMEOUT_MS = 15_000;
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000;
const SOMALIA_DIAL_CODE = "252";
/** Somtel accepts 62, 65, 66 only (not 76). */
const SOMTEL_LOCAL_PATTERN = /^(62|65|66)\d{7}$/;

const SOMTEL_STATUS = {
  SUCCESS: 200,
  AUTH_FAILED: 201,
  INVALID_SENDER_ID: 203,
  ZERO_BALANCE: 204,
  INSUFFICIENT_BALANCE: 205,
  MESSAGE_PARTS_EXCEEDED: 206,
  WRONG_MOBILE: 207,
  BAD_REQUEST: 400,
  UNKNOWN_ERROR: 500,
};

/** @type {{ token: string, expiresAt: number } | null} */
let tokenCache = null;
/** @type {Promise<string> | null} */
let pendingTokenFetch = null;

/**
 * Mask phone for logs: 62******4567
 * @param {string} phone
 */
function maskPhone(phone) {
  const s = String(phone || "");
  if (s.length <= 6) return "****";
  return `${s.slice(0, 4)}******${s.slice(-4)}`;
}

/**
 * @param {string} base
 * @param {string} path
 */
function joinUrl(base, path) {
  const b = String(base || "").replace(/\/+$/, "");
  const p = String(path || "").startsWith("/") ? String(path) : `/${path}`;
  return `${b}${p}`;
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

/**
 * Convert E.164 / international input to Somtel local 9-digit mobile (62|65|66).
 * @param {string} to
 * @returns {string | null}
 */
function toSomtelMobile(to) {
  let digits = digitsOnly(to);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith(SOMALIA_DIAL_CODE) && digits.length > SOMALIA_DIAL_CODE.length) {
    digits = digits.slice(SOMALIA_DIAL_CODE.length);
  }
  return SOMTEL_LOCAL_PATTERN.test(digits) ? digits : null;
}

function assertConfigured() {
  if (!env.SOMTEL_USERNAME || !env.SOMTEL_PASSWORD || !env.SOMTEL_BASE_URL) {
    const err = new Error("Somtel SMS is not configured");
    err.code = "SMS_PROVIDER_UNAVAILABLE";
    throw err;
  }
}

/**
 * @param {string} url
 * @param {RequestInit} init
 */
async function fetchJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (networkErr) {
    const aborted =
      networkErr && typeof networkErr === "object" && /** @type {any} */ (networkErr).name === "AbortError";
    const err = new Error(aborted ? "Somtel SMS request timed out" : "Somtel SMS network error");
    err.code = "SMS_PROVIDER_UNAVAILABLE";
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { response, parsed };
}

/**
 * Read JWT `exp` without verifying the signature. Used only to cache the token.
 * @param {string} token
 * @returns {number | null} expiry in ms, or null
 */
function jwtExpiryMs(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length < 2) return null;
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json);
    if (typeof payload.exp === "number" && payload.exp > 0) {
      return payload.exp * 1000;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Token body: `{ accessToken, message: "You Welcome" }`
 * @param {unknown} body
 * @returns {{ token: string, expiresAt: number } | null}
 */
function parseTokenBody(body) {
  if (!body || typeof body !== "object") return null;
  const top = /** @type {Record<string, unknown>} */ (body);
  const tokenRaw = top.accessToken ?? top.access_token ?? top.AccessToken ?? top.token;
  if (tokenRaw == null || String(tokenRaw).trim() === "") return null;
  const token = String(tokenRaw).trim();
  const jwtExp = jwtExpiryMs(token);
  const expiresAt = jwtExp && jwtExp > Date.now() ? jwtExp : Date.now() + DEFAULT_TOKEN_TTL_MS;
  return { token, expiresAt };
}

async function fetchAccessToken() {
  assertConfigured();
  const url = joinUrl(env.SOMTEL_BASE_URL, env.SOMTEL_TOKEN_PATH);
  const { response, parsed } = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Username: env.SOMTEL_USERNAME,
      Password: env.SOMTEL_PASSWORD,
    }),
  });

  if (!response.ok) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "somtel_token_http_error",
        httpStatus: response.status,
      }),
    );
    const err = new Error(`Somtel token HTTP ${response.status}`);
    err.code = "SMS_PROVIDER_UNAVAILABLE";
    throw err;
  }

  const parsedToken = parseTokenBody(parsed);
  if (!parsedToken) {
    const err = new Error("Somtel token response missing accessToken");
    err.code = "SMS_PROVIDER_UNAVAILABLE";
    throw err;
  }

  const ttl = Math.max(parsedToken.expiresAt - Date.now() - TOKEN_EXPIRY_BUFFER_MS, 30_000);
  tokenCache = { token: parsedToken.token, expiresAt: Date.now() + ttl };
  return parsedToken.token;
}

/**
 * @param {boolean} forceRefresh
 * @returns {Promise<string>}
 */
async function getAccessToken(forceRefresh) {
  if (!forceRefresh && tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  if (pendingTokenFetch) return pendingTokenFetch;
  pendingTokenFetch = fetchAccessToken().finally(() => {
    pendingTokenFetch = null;
  });
  return pendingTokenFetch;
}

function invalidateToken() {
  tokenCache = null;
}

/**
 * @param {unknown} body
 * @returns {number | null}
 */
function readSomtelStatus(body) {
  if (!body || typeof body !== "object") return null;
  const n = Number(/** @type {Record<string, unknown>} */ (body).status);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} body
 * @returns {string}
 */
function readSomtelErrorMessage(body) {
  if (!body || typeof body !== "object") return "";
  const top = /** @type {Record<string, unknown>} */ (body);
  const value = top.error ?? top.statusDetail ?? top.message ?? top.Message;
  return value != null ? String(value) : "";
}

/**
 * Somtel send body:
 * success `{ status: 200, messageID, statusDetail }`
 * error   `{ status: 207, error: "..." }`
 *
 * @param {unknown} body
 * @param {number} httpStatus
 */
function assertSendResult(body, httpStatus) {
  const apiStatus = readSomtelStatus(body) ?? (httpStatus >= 400 ? httpStatus : null);
  const detail = readSomtelErrorMessage(body);
  const top = body && typeof body === "object" ? /** @type {Record<string, unknown>} */ (body) : {};
  const messageIdRaw = top.messageID ?? top.MessageID ?? top.messageId ?? top.message_id;
  const messageId = messageIdRaw != null && String(messageIdRaw).trim() !== "" ? String(messageIdRaw) : undefined;

  if (apiStatus === SOMTEL_STATUS.SUCCESS || (apiStatus == null && httpStatus >= 200 && httpStatus < 300 && messageId)) {
    return {
      requestId: messageId,
      messageId,
      status: "queued",
      providerMessageId: messageId,
    };
  }

  if (apiStatus === SOMTEL_STATUS.WRONG_MOBILE) {
    const err = new Error(detail || "Invalid phone number for SMS");
    err.code = "INVALID_PHONE_NUMBER";
    err.messageId = messageId;
    err.somtelStatus = apiStatus;
    throw err;
  }

  if (apiStatus === SOMTEL_STATUS.AUTH_FAILED) {
    const err = new Error(detail || "Somtel authentication failed");
    err.code = "SMS_PROVIDER_UNAVAILABLE";
    err.somtelStatus = apiStatus;
    throw err;
  }

  if (
    apiStatus === SOMTEL_STATUS.ZERO_BALANCE ||
    apiStatus === SOMTEL_STATUS.INSUFFICIENT_BALANCE ||
    apiStatus === SOMTEL_STATUS.UNKNOWN_ERROR
  ) {
    const err = new Error(detail || `Somtel SMS status: ${apiStatus}`);
    err.code = "SMS_PROVIDER_UNAVAILABLE";
    err.messageId = messageId;
    err.somtelStatus = apiStatus;
    throw err;
  }

  const err = new Error(detail || `Somtel SMS status: ${apiStatus ?? httpStatus ?? "unknown"}`);
  err.code =
    apiStatus === SOMTEL_STATUS.UNKNOWN_ERROR || httpStatus >= 500
      ? "SMS_PROVIDER_UNAVAILABLE"
      : "SMS_SEND_FAILED";
  err.messageId = messageId;
  err.somtelStatus = apiStatus;
  throw err;
}

/**
 * @param {string} accessToken
 * @param {string} mobile
 * @param {string} message
 */
async function postSendSms(accessToken, mobile, message) {
  const url = joinUrl(env.SOMTEL_BASE_URL, env.SOMTEL_SEND_PATH);
  return fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mobile,
      message,
    }),
  });
}

function isAuthFailure(httpStatus, parsed) {
  return httpStatus === 401 || readSomtelStatus(parsed) === SOMTEL_STATUS.AUTH_FAILED;
}

/**
 * Send via Somtel SMS API (eDahab OTP).
 *
 * @param {{ to: string, body: string }} params
 * @returns {Promise<{ requestId?: string, messageId?: string, status: string, providerMessageId?: string }>}
 */
async function send(params) {
  const to = String(params.to || "").trim();
  const body = String(params.body || "");
  const mobile = toSomtelMobile(to);

  if (!to) {
    const err = new Error("SMS recipient is required");
    err.code = "INVALID_PHONE_NUMBER";
    throw err;
  }
  if (!mobile) {
    const err = new Error("Invalid phone number for SMS");
    err.code = "INVALID_PHONE_NUMBER";
    throw err;
  }
  assertConfigured();

  let accessToken = await getAccessToken(false);
  let { response, parsed } = await postSendSms(accessToken, mobile, body);

  if (isAuthFailure(response.status, parsed)) {
    invalidateToken();
    accessToken = await getAccessToken(true);
    ({ response, parsed } = await postSendSms(accessToken, mobile, body));
  }

  if (isAuthFailure(response.status, parsed)) {
    const err = new Error("Somtel SMS unauthorized");
    err.code = "SMS_PROVIDER_UNAVAILABLE";
    throw err;
  }

  const apiStatus = readSomtelStatus(parsed);
  if (!response.ok || (apiStatus != null && apiStatus !== SOMTEL_STATUS.SUCCESS)) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "somtel_sms_http_error",
        httpStatus: response.status,
        somtelStatus: apiStatus,
        to: maskPhone(mobile),
      }),
    );
  }

  try {
    const result = assertSendResult(parsed, response.status);
    console.log(
      JSON.stringify({
        level: "info",
        msg: "somtel_sms_queued",
        message_id: result.messageId,
        to: maskPhone(mobile),
        status: result.status,
        somtelStatus: SOMTEL_STATUS.SUCCESS,
        smsProvider: "somtel",
        gateway: "edahab",
      }),
    );
    return result;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "somtel_sms_failed",
        message_id: err && typeof err === "object" ? /** @type {any} */ (err).messageId : undefined,
        to: maskPhone(mobile),
        code: err && typeof err === "object" ? /** @type {any} */ (err).code : undefined,
        somtelStatus: err && typeof err === "object" ? /** @type {any} */ (err).somtelStatus : undefined,
        error: err instanceof Error ? err.message : String(err),
        smsProvider: "somtel",
        gateway: "edahab",
      }),
    );
    throw err;
  }
}

module.exports = {
  send,
  maskPhone,
  toSomtelMobile,
  SOMTEL_STATUS,
};
