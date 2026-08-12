const crypto = require("crypto");

const { env } = require("../config/env");

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Mask phone for logs: +252******7928
 * @param {string} phone
 */
function maskPhone(phone) {
  const s = String(phone || "");
  if (s.length <= 6) return "****";
  return `${s.slice(0, 4)}******${s.slice(-4)}`;
}

/**
 * YYYY-MM-DD — must match the value sent as X-Timestamp.
 * @returns {string}
 */
function generateTimestamp() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * X-Auth-Key = Base64(HMAC-SHA256(SenderID + Timestamp + Username + Password, sharedSecret))
 * No separators between concatenated fields.
 * @param {string} timestamp
 * @returns {string}
 */
function generateAuthKey(timestamp) {
  const senderId = env.TELESOM_SENDER_ID;
  const username = env.TELESOM_USERNAME;
  const password = env.TELESOM_PASSWORD;
  const sharedSecret = env.TELESOM_SHARED_SECRET;
  if (!senderId || !username || !password || !sharedSecret) {
    const err = new Error("Telesom SMS is not configured");
    err.code = "SMS_PROVIDER_UNAVAILABLE";
    throw err;
  }
  const data = `${senderId}${timestamp}${username}${password}`;
  const digest = crypto.createHmac("sha256", sharedSecret).update(data, "utf8").digest();
  return digest.toString("base64");
}

/**
 * @param {unknown} body
 * @param {string} to
 */
function assertQueuedResult(body, to) {
  if (!body || typeof body !== "object") {
    const err = new Error("Unexpected Telesom response");
    err.code = "SMS_SEND_FAILED";
    throw err;
  }
  const top = /** @type {Record<string, unknown>} */ (body);
  const requestId = top.request_id != null ? String(top.request_id) : undefined;
  const topStatus = String(top.status || "").toLowerCase();

  if (topStatus === "rejected") {
    const err = new Error("Telesom rejected SMS request");
    err.code = "SMS_SEND_FAILED";
    err.requestId = requestId;
    throw err;
  }

  const results = Array.isArray(top.results) ? top.results : [];
  const match =
    results.find((r) => r && typeof r === "object" && String(/** @type {any} */ (r).to) === to) ||
    results[0];

  if (!match || typeof match !== "object") {
    const err = new Error("Telesom response missing results");
    err.code = "SMS_SEND_FAILED";
    err.requestId = requestId;
    throw err;
  }

  const row = /** @type {Record<string, unknown>} */ (match);
  const resultStatus = String(row.status || "").toLowerCase();
  const descriptions = String(row.descriptions || row.description || "");
  const messageId = row.message_id != null ? String(row.message_id) : undefined;

  if (resultStatus === "queued" && topStatus === "accepted") {
    return {
      requestId,
      messageId,
      status: "queued",
      providerMessageId: messageId || requestId,
    };
  }

  const descLower = descriptions.toLowerCase();
  if (descLower.includes("invalid_phone") || descLower.includes("invalid phone")) {
    const err = new Error("Invalid phone number for SMS");
    err.code = "INVALID_PHONE_NUMBER";
    err.requestId = requestId;
    err.messageId = messageId;
    throw err;
  }

  const err = new Error(descriptions || `Telesom SMS status: ${resultStatus || "unknown"}`);
  err.code = "SMS_SEND_FAILED";
  err.requestId = requestId;
  err.messageId = messageId;
  throw err;
}

/**
 * Send via Telesom Standard SMS Messaging API only (not OTP Messaging API).
 * `client_ref` comes from `TELESOM_CLIENT_REF` env (static).
 *
 * @param {{ to: string, body: string }} params
 * @returns {Promise<{ requestId?: string, messageId?: string, status: string, providerMessageId?: string }>}
 */
async function send(params) {
  const to = String(params.to || "").trim();
  const body = String(params.body || "");
  const clientRef = env.TELESOM_CLIENT_REF;

  if (!to) {
    const err = new Error("SMS recipient is required");
    err.code = "INVALID_PHONE_NUMBER";
    throw err;
  }
  if (!clientRef) {
    const err = new Error("TELESOM_CLIENT_REF is not configured");
    err.code = "SMS_PROVIDER_UNAVAILABLE";
    throw err;
  }
  if (!env.TELESOM_SENDER_ID || !env.TELESOM_USERNAME || !env.TELESOM_PASSWORD || !env.TELESOM_SHARED_SECRET) {
    const err = new Error("Telesom SMS is not configured");
    err.code = "SMS_PROVIDER_UNAVAILABLE";
    throw err;
  }

  const timestamp = generateTimestamp();
  const authKey = generateAuthKey(timestamp);

  const requestBody = {
    to: [to],
    message: body,
    type: "text",
    client_ref: clientRef,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(env.TELESOM_SMS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        SenderID: env.TELESOM_SENDER_ID,
        "X-Timestamp": timestamp,
        Username: env.TELESOM_USERNAME,
        Password: env.TELESOM_PASSWORD,
        "X-Auth-Key": authKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (networkErr) {
    const aborted = networkErr && typeof networkErr === "object" && /** @type {any} */ (networkErr).name === "AbortError";
    const err = new Error(aborted ? "Telesom SMS request timed out" : "Telesom SMS network error");
    err.code = "SMS_PROVIDER_UNAVAILABLE";
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let parsed;
  try {
    parsed = await response.json();
  } catch {
    const err = new Error(`Telesom SMS HTTP ${response.status}`);
    err.code = response.ok ? "SMS_SEND_FAILED" : "SMS_PROVIDER_UNAVAILABLE";
    throw err;
  }

  if (!response.ok) {
    const topStatus = parsed && typeof parsed === "object" ? String(parsed.status || "") : "";
    console.error(
      JSON.stringify({
        level: "error",
        msg: "telesom_sms_http_error",
        httpStatus: response.status,
        telesomStatus: topStatus,
        client_ref: clientRef,
        to: maskPhone(to),
      }),
    );
    const err = new Error(`Telesom SMS HTTP ${response.status}`);
    err.code = "SMS_PROVIDER_UNAVAILABLE";
    throw err;
  }

  try {
    const result = assertQueuedResult(parsed, to);
    console.log(
      JSON.stringify({
        level: "info",
        msg: "telesom_sms_queued",
        client_ref: clientRef,
        request_id: result.requestId,
        message_id: result.messageId,
        to: maskPhone(to),
        status: result.status,
      }),
    );
    return result;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "telesom_sms_failed",
        client_ref: clientRef,
        request_id: err && typeof err === "object" ? /** @type {any} */ (err).requestId : undefined,
        message_id: err && typeof err === "object" ? /** @type {any} */ (err).messageId : undefined,
        to: maskPhone(to),
        code: err && typeof err === "object" ? /** @type {any} */ (err).code : undefined,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    throw err;
  }
}

module.exports = {
  send,
  generateTimestamp,
  generateAuthKey,
  maskPhone,
};
