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
 * @typedef {{ content: Buffer, filename: string, type?: string, disposition?: "attachment" | "inline" }} EmailAttachmentInput
 *
 * @param {{
 *   to: string,
 *   subject: string,
 *   html: string,
 *   text?: string,
 *   attachments?: EmailAttachmentInput[],
 * }} params
 */
async function send(params) {
  ensureConfigured();
  const message = {
    to: params.to,
    from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME },
    subject: params.subject,
    html: params.html,
    text: params.text,
  };

  if (Array.isArray(params.attachments) && params.attachments.length > 0) {
    // SendGrid requires base64-encoded content. We convert Buffers here so the
    // upstream code can keep raw Buffer objects without provider knowledge.
    message.attachments = params.attachments.map((att) => ({
      content: Buffer.isBuffer(att.content)
        ? att.content.toString("base64")
        : String(att.content || ""),
      filename: att.filename,
      type: att.type || "application/pdf",
      disposition: att.disposition || "attachment",
    }));
  }

  const [result] = await sgMail.send(message);
  const messageId = result?.headers?.["x-message-id"] || null;
  return { providerMessageId: messageId };
}

module.exports = { send };
