const { env } = require("../config/env");

const SLACK_TIMEOUT_MS = 5000;

function ensureConfigured() {
  if (env.NODE_ENV !== "development") {
    throw new Error("Slack is disabled outside NODE_ENV=development");
  }
  if (!env.SLACK_WEBHOOK_URL) {
    throw new Error("Slack is not configured (SLACK_WEBHOOK_URL)");
  }
}

/**
 * Generic Slack Incoming Webhook sender. Message body comes from templates
 * (`rendered.slack`); this module does not know about OTP or other events.
 *
 * @param {{ text: string, blocks?: unknown[] }} params
 * @returns {Promise<{ providerMessageId: string }>}
 */
async function send({ text, blocks }) {
  ensureConfigured();
  const bodyText = typeof text === "string" && text.trim() ? text.trim() : "Simodi notification";
  const payload = { text: bodyText };
  if (Array.isArray(blocks) && blocks.length > 0) {
    payload.blocks = blocks;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);
  try {
    const res = await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const responseText = await res.text();
    if (!res.ok) {
      throw new Error(`Slack webhook failed: ${res.status} ${responseText || res.statusText}`);
    }
    return { providerMessageId: "ok" };
  } catch (err) {
    if (err && typeof err === "object" && err.name === "AbortError") {
      throw new Error(`Slack webhook timed out after ${SLACK_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * When a template has no `slack` payload, build a generic message so new
 * SLACK_EVENTS do not need a dedicated Slack template on day one.
 *
 * @param {{
 *   rendered: { slack?: { text?: string, blocks?: unknown[] }, email?: { subject?: string }, push?: { title?: string, body?: string }, sms?: { body?: string } },
 *   templateCode: string,
 *   payload: Record<string, unknown>,
 * }} input
 */
function contentFromTemplate({ rendered, templateCode, payload }) {
  if (rendered?.slack && (rendered.slack.text || (Array.isArray(rendered.slack.blocks) && rendered.slack.blocks.length))) {
    return rendered.slack;
  }

  const title = rendered?.email?.subject || rendered?.push?.title || templateCode;
  const extra = rendered?.sms?.body || rendered?.push?.body || "";
  const fieldLines = Object.entries(payload || {})
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .slice(0, 12)
    .map(([key, value]) => `*${key}:* ${String(value)}`);

  const text = [title, extra, ...fieldLines].filter(Boolean).join("\n");
  return { text: text || title };
}

module.exports = { send, contentFromTemplate };
