const { env } = require("../config/env");

/**
 * Phase 5 stub — wire Twilio WhatsApp Business when credentials are ready.
 * @param {{ to: string, body: string }} _params
 */
async function send(_params) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM) {
    throw new Error(
      "Twilio WhatsApp is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM)",
    );
  }
  throw new Error("WhatsApp channel not implemented yet — configure Twilio and implement whatsapp.twilio.js");
}

module.exports = { send };
