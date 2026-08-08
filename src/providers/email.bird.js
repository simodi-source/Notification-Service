const { env } = require("../config/env");

/** @type {Promise<import("@messagebird/sdk").BirdClient> | null} */
let clientPromise = null;

function ensureConfigured() {
  if (!env.BIRD_API_KEY || !env.MAIL_FROM) {
    throw new Error("Bird is not configured (BIRD_API_KEY, MAIL_FROM)");
  }
}

async function getClient() {
  ensureConfigured();
  if (!clientPromise) {
    clientPromise = (async () => {
      const { BirdClient } = await import("@messagebird/sdk");
      /** @type {ConstructorParameters<typeof BirdClient>[0]} */
      const options = { apiKey: env.BIRD_API_KEY };
      // Optional override; when unset, the SDK infers the region from the bk_{region}_ key prefix.
      if (env.BIRD_API_BASE_URL) {
        options.baseUrl = env.BIRD_API_BASE_URL.replace(/\/$/, "");
      }
      return new BirdClient(options);
    })();
  }
  return clientPromise;
}

/**
 * @typedef {{
 *   content: Buffer,
 *   filename: string,
 *   type?: string,
 *   disposition?: "attachment" | "inline",
 *   contentId?: string,
 * }} EmailAttachmentInput
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
  const bird = await getClient();

  const attachmentInputs = Array.isArray(params.attachments) ? params.attachments : [];

  /** @type {Record<string, unknown>} */
  const message = {
    from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME },
    to: [params.to],
    subject: params.subject,
    html: params.html,
    // Trade/OTP mail must not be treated as marketing.
    category: "transactional",
  };

  if (params.text) {
    message.text = params.text;
  }

  if (attachmentInputs.length > 0) {
    // Wire fields are snake_case per Bird SDK / API.
    // @see https://bird.com/en-us/docs/guides/email/attachments
    message.attachments = attachmentInputs.map((att) => {
      const content = Buffer.isBuffer(att.content)
        ? att.content.toString("base64")
        : String(att.content || "");
      if (!content) {
        throw new Error(`Bird attachment "${att.filename}" has empty content`);
      }
      const mapped = {
        content,
        filename: att.filename,
        content_type: att.type || "application/pdf",
      };
      if (att.contentId) {
        mapped.content_id = att.contentId;
      }
      return mapped;
    });
  }

  const msg = await bird.email.send(message);
  const returnedAttachments = Array.isArray(msg?.attachments) ? msg.attachments : [];

  if (attachmentInputs.length > 0 && returnedAttachments.length === 0) {
    console.error(
      JSON.stringify({
        level: "warn",
        msg: "bird accepted email but returned no attachment metadata",
        providerMessageId: msg?.id || null,
        sentAttachmentCount: attachmentInputs.length,
        sentFilenames: attachmentInputs.map((a) => a.filename),
      }),
    );
  }

  return {
    providerMessageId: msg?.id || null,
    attachmentCount: returnedAttachments.length || attachmentInputs.length,
  };
}

module.exports = { send };
