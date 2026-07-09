require("dotenv").config();

function required(name, value) {
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  REDIS_URL: required("REDIS_URL", process.env.REDIS_URL),
  MONGODB_URI: required("MONGODB_URI", process.env.MONGODB_URI),
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || "",
  MAIL_FROM: process.env.MAIL_FROM || "",
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
  WORKER_CONCURRENCY: Number.parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || "5", 10),
  OTP_RATE_LIMIT_MAX: Number.parseInt(process.env.OTP_RATE_LIMIT_MAX || "3", 10),
  OTP_RATE_LIMIT_WINDOW_MS: Number.parseInt(process.env.OTP_RATE_LIMIT_WINDOW_MS || "900000", 10),
};

module.exports = { env };
