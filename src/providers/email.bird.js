const { env } = require("../config/env");

/** @type {Promise<import("@messagebird/sdk").BirdClient> | null} */
let clientPromise = null;

function ensureConfigured() {
  if (!env.BIRD_API_KEY || !env.MAIL_FROM) {
    throw new Error("Bird is not configured (BIRD_API_KEY, MAIL_FROM)");
  }
}

/**
 * Lazy-load the ESM-only @messagebird/sdk from this CommonJS worker.
 * @see https://bird.com/en-us/docs/sdks/typescript
 */
async function getClient() {
  ensureConfigured();
  if (!clientPromise) {
    clientPromise = (async () => {
      const { BirdClient } = await import("@messagebird/sdk");
      /** @type {ConstructorParameters<typeof BirdClient>[0]} */
      const options = { apiKey: env.BIRD_API_KEY };
      // Optional override; when unset, the SDK infers region from the bk_{region}_ key prefix.
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

  /** @type {Record<string, unknown>} */
  const message = {
    from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME },
    to: [params.to],
    subject: params.subject,
    html: params.html,
  };

  if (params.text) {
    message.text = params.text;
  }

  if (Array.isArray(params.attachments) && params.attachments.length > 0) {
    // Wire fields are snake_case per Bird SDK. Upstream keeps raw Buffer objects.
    message.attachments = params.attachments.map((att) => {
      const mapped = {
        content: Buffer.isBuffer(att.content)
          ? att.content.toString("base64")
          : String(att.content || ""),
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
  return { providerMessageId: msg?.id || null };
}

module.exports = { send };
