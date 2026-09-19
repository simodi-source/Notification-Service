const { env } = require("../config/env");

const SLACK_TIMEOUT_MS = 5000;
const SERVICE_NAME = "notification-service";

/**
 * @param {string} channel Logical channel name (e.g. admin_otp, engineering)
 * @returns {string}
 */
function webhookFor(channel) {
  const url = env.SLACK_WEBHOOKS?.[channel];
  if (!url || !String(url).trim()) {
    throw new Error(`Slack webhook not configured for channel "${channel}"`);
  }
  return String(url).trim();
}

/**
 * Generic Slack Incoming Webhook sender for a named channel.
 * Same Slack app can expose multiple webhooks (one per channel).
 *
 * @param {{ channel: string, text: string, blocks?: unknown[] }} params
 * @returns {Promise<{ providerMessageId: string }>}
 */
async function send({ channel, text, blocks }) {
  if (!channel || typeof channel !== "string") {
    throw new Error("Slack send requires a channel name");
  }
  const webhookUrl = webhookFor(channel);
  const bodyText = typeof text === "string" && text.trim() ? text.trim() : "Simodi notification";
  const payload = { text: bodyText };
  if (Array.isArray(blocks) && blocks.length > 0) {
    payload.blocks = blocks;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);
  try {
    const res = await fetch(webhookUrl, {
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
  if (
    rendered?.slack &&
    (rendered.slack.text || (Array.isArray(rendered.slack.blocks) && rendered.slack.blocks.length))
  ) {
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

/**
 * Best-effort Engineering incident from the notification worker.
 * Gated by ENGINEERING_SLACK_ALERTS_ENABLED + engineering webhook.
 *
 * @param {{ title: string, errorMessage: string, stack?: string }} input
 */
async function sendEngineeringIncident(input) {
  if (!env.ENGINEERING_SLACK_ALERTS_ENABLED) return;
  if (!env.SLACK_WEBHOOKS?.engineering) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "Engineering Slack skipped: webhook not configured",
      }),
    );
    return;
  }
  const timestamp = new Date().toISOString();
  const text = [
    input.title,
    `*Service:* ${SERVICE_NAME}`,
    `*Environment:* ${env.NODE_ENV}`,
    `*Timestamp:* ${timestamp}`,
    `*Error:* ${input.errorMessage}`,
  ].join("\n");
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: String(input.title).slice(0, 140), emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Service:*\n${SERVICE_NAME}` },
        { type: "mrkdwn", text: `*Environment:*\n${env.NODE_ENV}` },
        { type: "mrkdwn", text: `*Timestamp:*\n${timestamp}` },
        { type: "mrkdwn", text: `*Error:*\n${String(input.errorMessage).slice(0, 500)}` },
      ],
    },
  ];
  if (input.stack) {
    const snippet = String(input.stack).split("\n").slice(0, 15).join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `\`\`\`${snippet.slice(0, 2800)}\`\`\`` },
    });
  }
  try {
    await send({ channel: "engineering", text, blocks });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "Engineering Slack failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

module.exports = { send, contentFromTemplate, sendEngineeringIncident, webhookFor };
