const { env } = require("../config/env");

/**
 * Phase 5 stub — wire Twilio Programmable SMS when credentials are ready.
 * @param {{ to: string, body: string }} _params
 */
async function send(_params) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_SMS_FROM) {
    throw new Error("Twilio SMS is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM)");
  }
  throw new Error("SMS channel not implemented yet — configure Twilio and implement sms.twilio.js");
}

module.exports = { send };
