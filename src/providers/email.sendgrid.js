const sgMail = require("@sendgrid/mail");
const { env } = require("../config/env");

let configured = false;

function ensureConfigured() {
  if (!env.SENDGRID_API_KEY || !env.MAIL_FROM) {
    throw new Error("SendGrid is not configured (SENDGRID_API_KEY, MAIL_FROM)");
  }
  if (!configured) {
    sgMail.setApiKey(env.SENDGRID_API_KEY);
    configured = true;
  }
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string }} params
 */
async function send(params) {
  ensureConfigured();
  const [result] = await sgMail.send({
    to: params.to,
    from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME },
    subject: params.subject,
    html: params.html,
    text: params.text,
  });
  const messageId = result?.headers?.["x-message-id"] || null;
  return { providerMessageId: messageId };
}

module.exports = { send };
