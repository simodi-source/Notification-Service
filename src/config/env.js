require("dotenv").config();

function required(name, value) {
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

/**
 * Read process.env, tolerating accidental leading/trailing spaces on .env keys
 * (e.g. ` BIRD_API_KEY=...` which otherwise leaves Bird unconfigured).
 */
function envVar(name) {
  if (Object.prototype.hasOwnProperty.call(process.env, name) && process.env[name] != null) {
    return process.env[name];
  }
  const match = Object.keys(process.env).find((k) => k.trim() === name);
  return match != null ? process.env[match] : undefined;
}

function parseEventList(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function parseBool(value, defaultValue) {
  if (value === undefined || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const s = String(value).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

/**
 * Parse SLACK_WEBHOOKS JSON map. Falls back to legacy SLACK_WEBHOOK_URL → admin_otp.
 * @returns {Record<string, string>}
 */
function parseSlackWebhooks() {
  /** @type {Record<string, string>} */
  const map = {};
  const raw = (envVar("SLACK_WEBHOOKS") || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string" && value.trim()) {
            map[String(key).trim()] = value.trim();
          }
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "Invalid SLACK_WEBHOOKS JSON; ignoring",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  const legacy = (envVar("SLACK_WEBHOOK_URL") || "").trim();
  if (legacy && !map.admin_otp) {
    map.admin_otp = legacy;
  }
  return map;
}

/** Default event → logical Slack channel name (same Slack app, different webhooks). */
const DEFAULT_EVENT_CHANNELS = {
  "admin.mfa_otp": "admin_otp",
  "ops.engineering_incident": "engineering",
};

/**
 * Optional JSON override: {"admin.mfa_otp":"admin_otp","ops.incident":"engineering"}
 * @returns {Record<string, string>}
 */
function parseSlackEventChannels() {
  const raw = (envVar("SLACK_EVENT_CHANNELS") || "").trim();
  if (!raw) return { ...DEFAULT_EVENT_CHANNELS };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...DEFAULT_EVENT_CHANNELS, ...parsed };
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "Invalid SLACK_EVENT_CHANNELS JSON; using defaults",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  return { ...DEFAULT_EVENT_CHANNELS };
}

const env = {
  NODE_ENV: envVar("NODE_ENV") || "development",
  REDIS_URL: required("REDIS_URL", envVar("REDIS_URL")),
  MONGODB_URI: required("MONGODB_URI", envVar("MONGODB_URI")),
  BIRD_API_KEY: (envVar("BIRD_API_KEY") || "").trim(),
  BIRD_API_BASE_URL: (envVar("BIRD_API_BASE_URL") || "").trim(),
  MAIL_FROM: (envVar("MAIL_FROM") || "").trim(),
  MAIL_FROM_NAME: envVar("MAIL_FROM_NAME") || "Simodi",
  MAIL_BRAND_LOGO_URL: (envVar("MAIL_BRAND_LOGO_URL") || "").trim(),
  /** Public S3/CDN origin for upload object keys in FCM rich-push images. */
  PUBLIC_UPLOADS_BASE_URL:
    envVar("PUBLIC_UPLOADS_BASE_URL") ||
    "https://simodi-gold-bucket.s3.ap-south-1.amazonaws.com",
  FIREBASE_SERVICE_ACCOUNT_PATH: envVar("FIREBASE_SERVICE_ACCOUNT_PATH") || "",
  TWILIO_ACCOUNT_SID: envVar("TWILIO_ACCOUNT_SID") || "",
  TWILIO_AUTH_TOKEN: envVar("TWILIO_AUTH_TOKEN") || "",
  TWILIO_SMS_FROM: envVar("TWILIO_SMS_FROM") || "",
  TWILIO_WHATSAPP_FROM: envVar("TWILIO_WHATSAPP_FROM") || "",
  /** Telesom Standard SMS API (OTP delivery). Never use Telesom OTP Messaging API. */
  TELESOM_SMS_URL:
    (envVar("TELESOM_SMS_URL") || "").trim() ||
    "https://sms.mytelesom.com/index.php/smsapi/v1/messages",
  TELESOM_SENDER_ID: (envVar("TELESOM_SENDER_ID") || "").trim(),
  TELESOM_USERNAME: (envVar("TELESOM_USERNAME") || "").trim(),
  TELESOM_PASSWORD: (envVar("TELESOM_PASSWORD") || "").trim(),
  TELESOM_SHARED_SECRET: (envVar("TELESOM_SHARED_SECRET") || "").trim(),
  /** Static client_ref sent on every Telesom Standard SMS request. */
  TELESOM_CLIENT_REF: (envVar("TELESOM_CLIENT_REF") || "").trim() || "SIMODI-OTP",
  /** Somtel SMS API (eDahab OTP). Optional at boot — fail at send time if unset. */
  SOMTEL_BASE_URL:
    (envVar("SOMTEL_BASE_URL") || "").trim() || "https://smsapi.somtelsomalia.com",
  SOMTEL_USERNAME: (envVar("SOMTEL_USERNAME") || "").trim(),
  SOMTEL_PASSWORD: (envVar("SOMTEL_PASSWORD") || "").trim(),
  SOMTEL_TOKEN_PATH: (envVar("SOMTEL_TOKEN_PATH") || "").trim() || "/token",
  SOMTEL_SEND_PATH: (envVar("SOMTEL_SEND_PATH") || "").trim() || "/api/SendSMS",

  /** Logical channel name → Incoming Webhook URL (one Slack app, many channels). */
  SLACK_WEBHOOKS: parseSlackWebhooks(),
  /** @deprecated Prefer SLACK_WEBHOOKS.admin_otp — kept for migration. */
  SLACK_WEBHOOK_URL: (envVar("SLACK_WEBHOOK_URL") || "").trim(),
  /**
   * Optional extra event allowlist. An event still needs an explicit
   * SLACK_EVENT_CHANNELS mapping and webhook — never dumped onto admin_otp.
   */
  SLACK_EVENTS: parseEventList(envVar("SLACK_EVENTS")),
  SLACK_EVENT_CHANNELS: parseSlackEventChannels(),
  /**
   * Toggle admin MFA OTP → Slack (`admin_otp` webhook).
   * Delivery is also hard-blocked when NODE_ENV=production.
   * NODE_ENV is still the environment label inside the Slack message.
   * Default: true when SLACK_EVENTS includes admin.mfa_otp.
   */
  SLACK_ADMIN_OTP_ENABLED: parseBool(
    envVar("SLACK_ADMIN_OTP_ENABLED"),
    parseEventList(envVar("SLACK_EVENTS")).has("admin.mfa_otp"),
  ),
  /**
   * Toggle Engineering incident Slack (`engineering` webhook).
   * NODE_ENV is only a label in the message, not a delivery gate.
   */
  ENGINEERING_SLACK_ALERTS_ENABLED: parseBool(envVar("ENGINEERING_SLACK_ALERTS_ENABLED"), false),
  WORKER_CONCURRENCY: Number.parseInt(envVar("NOTIFICATION_WORKER_CONCURRENCY") || "5", 10),
};

function isAdminOtpSlackEnv() {
  const n = String(env.NODE_ENV || "").toLowerCase();
  return n === "development" || n === "test";
}

/**
 * Slack is only:
 * - admin.mfa_otp → admin_otp webhook (admin panel login OTP; development/test only)
 * - ops.engineering_incident → engineering webhook (all NODE_ENV values; NODE_ENV is the label)
 * Anything else never posts to Slack.
 */
function slackEnabledFor(event) {
  if (event === "admin.mfa_otp") {
    return (
      isAdminOtpSlackEnv() &&
      env.SLACK_ADMIN_OTP_ENABLED &&
      Boolean(env.SLACK_WEBHOOKS.admin_otp)
    );
  }
  if (event === "ops.engineering_incident") {
    return env.ENGINEERING_SLACK_ALERTS_ENABLED && Boolean(env.SLACK_WEBHOOKS.engineering);
  }
  return false;
}

function slackChannelForEvent(event) {
  if (event === "admin.mfa_otp") return "admin_otp";
  if (event === "ops.engineering_incident") return "engineering";
  return null;
}

module.exports = { env, slackEnabledFor, slackChannelForEvent, isAdminOtpSlackEnv };
