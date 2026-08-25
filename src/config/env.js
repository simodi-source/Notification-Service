require("dotenv").config();

function required(name, value) {
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  REDIS_URL: required("REDIS_URL", process.env.REDIS_URL),
  MONGODB_URI: required("MONGODB_URI", process.env.MONGODB_URI),
  BIRD_API_KEY: (process.env.BIRD_API_KEY || "").trim(),
  BIRD_API_BASE_URL: (process.env.BIRD_API_BASE_URL || "").trim(),
  MAIL_FROM: (process.env.MAIL_FROM || "").trim(),
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME || "Simodi",
  MAIL_BRAND_LOGO_URL: process.env.MAIL_BRAND_LOGO_URL || "",
  /** Public S3/CDN origin for upload object keys in FCM rich-push images. */
  PUBLIC_UPLOADS_BASE_URL:
    process.env.PUBLIC_UPLOADS_BASE_URL ||
    "https://simodi-gold-bucket.s3.ap-south-1.amazonaws.com",
  FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "",
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || "",
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || "",
  TWILIO_SMS_FROM: process.env.TWILIO_SMS_FROM || "",
  TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM || "",
  /** Telesom Standard SMS API (OTP delivery). Never use Telesom OTP Messaging API. */
  TELESOM_SMS_URL:
    (process.env.TELESOM_SMS_URL || "").trim() ||
    "https://sms.mytelesom.com/index.php/smsapi/v1/messages",
  TELESOM_SENDER_ID: (process.env.TELESOM_SENDER_ID || "").trim(),
  TELESOM_USERNAME: (process.env.TELESOM_USERNAME || "").trim(),
  TELESOM_PASSWORD: (process.env.TELESOM_PASSWORD || "").trim(),
  TELESOM_SHARED_SECRET: (process.env.TELESOM_SHARED_SECRET || "").trim(),
  /** Static client_ref sent on every Telesom Standard SMS request. */
  TELESOM_CLIENT_REF: (process.env.TELESOM_CLIENT_REF || "").trim() || "SIMODI-OTP",
  /** Somtel SMS API (eDahab OTP). Optional at boot — fail at send time if unset. */
  SOMTEL_BASE_URL:
    (process.env.SOMTEL_BASE_URL || "").trim() || "https://smsapi.somtelsomalia.com",
  SOMTEL_USERNAME: (process.env.SOMTEL_USERNAME || "").trim(),
  SOMTEL_PASSWORD: (process.env.SOMTEL_PASSWORD || "").trim(),
  SOMTEL_TOKEN_PATH: (process.env.SOMTEL_TOKEN_PATH || "").trim() || "/token",
  SOMTEL_SEND_PATH: (process.env.SOMTEL_SEND_PATH || "").trim() || "/api/SendSMS",
  WORKER_CONCURRENCY: Number.parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || "5", 10),
};

module.exports = { env };
