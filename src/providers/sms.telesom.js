const crypto = require("crypto");

const { env } = require("../config/env");

const DEFAULT_TIMEOUT_MS = 15_000;

const MAX_RAW_BODY_CHARS = 4_000;

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
 * Telesom support payload: keep their fields, mask recipient MSISDNs, never include SMS text.
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeTelesomPayload(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTelesomPayload(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    const keyLower = key.toLowerCase();
    if (keyLower === "message" || keyLower === "text" || keyLower === "body") {
      continue;
    }
    if (keyLower === "to" || keyLower === "msisdn" || keyLower === "phone" || keyLower === "recipient") {
      if (Array.isArray(nested)) {
        out[key] = nested.map((item) => (typeof item === "string" ? maskPhone(item) : sanitizeTelesomPayload(item)));
      } else if (typeof nested === "string") {
        out[key] = maskPhone(nested);
      } else {
        out[key] = sanitizeTelesomPayload(nested);
      }
      continue;
    }
    out[key] = sanitizeTelesomPayload(nested);
  }
  return out;
}

/**
 * Fields Telesom can use to look up the failed send. No credentials or OTP text.
 * @param {{
 *   httpStatus: number,
 *   timestamp: string,
 *   clientRef: string,
 *   to: string,
 *   messageLength: number,
 *   parsed: unknown,
 *   rawBody?: string,
 * }} params
 */
function logTelesomHttpError(params) {
  const parsed = params.parsed && typeof params.parsed === "object" ? params.parsed : null;
  const top = parsed ? /** @type {Record<string, unknown>} */ (parsed) : {};
  const results = Array.isArray(top.results) ? top.results : [];
  const firstResult = results[0] && typeof results[0] === "object" ? /** @type {Record<string, unknown>} */ (results[0]) : {};

  console.error(
    JSON.stringify({
      level: "error",
      msg: "telesom_sms_http_error",
      shareWithTelesom: true,
      httpStatus: params.httpStatus,
      url: env.TELESOM_SMS_URL,
      senderId: env.TELESOM_SENDER_ID,
      xTimestamp: params.timestamp,
      client_ref: params.clientRef,
      type: "text",
      to: maskPhone(params.to),
      messageLength: params.messageLength,
      telesomStatus: top.status != null ? String(top.status) : "",
      request_id: top.request_id != null ? String(top.request_id) : undefined,
      error: top.error != null ? top.error : undefined,
      message: top.message != null ? String(top.message) : undefined,
      descriptions:
        firstResult.descriptions != null
          ? String(firstResult.descriptions)
          : firstResult.description != null
            ? String(firstResult.description)
            : top.descriptions != null
              ? String(top.descriptions)
              : top.description != null
                ? String(top.description)
                : undefined,
      resultStatus: firstResult.status != null ? String(firstResult.status) : undefined,
      message_id: firstResult.message_id != null ? String(firstResult.message_id) : undefined,
      telesomResponse: parsed ? sanitizeTelesomPayload(parsed) : undefined,
      rawBody:
        params.rawBody && !parsed
          ? params.rawBody.slice(0, MAX_RAW_BODY_CHARS)
          : undefined,
    }),
  );
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

  let rawBody = "";
  try {
    rawBody = await response.text();
  } catch {
    rawBody = "";
  }

  let parsed;
  if (rawBody) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    logTelesomHttpError({
      httpStatus: response.status,
      timestamp,
      clientRef,
      to,
      messageLength: body.length,
      parsed,
      rawBody,
    });
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
        shareWithTelesom: true,
        httpStatus: response.status,
        url: env.TELESOM_SMS_URL,
        senderId: env.TELESOM_SENDER_ID,
        xTimestamp: timestamp,
        client_ref: clientRef,
        type: "text",
        to: maskPhone(to),
        messageLength: body.length,
        request_id: err && typeof err === "object" ? /** @type {any} */ (err).requestId : undefined,
        message_id: err && typeof err === "object" ? /** @type {any} */ (err).messageId : undefined,
        code: err && typeof err === "object" ? /** @type {any} */ (err).code : undefined,
        error: err instanceof Error ? err.message : String(err),
        telesomResponse: parsed ? sanitizeTelesomPayload(parsed) : undefined,
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
