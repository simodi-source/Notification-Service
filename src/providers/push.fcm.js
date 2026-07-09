const path = require("path");
const admin = require("firebase-admin");
const { env } = require("../config/env");
const { resolvePushActionFromRoute } = require("./push-routes");

let initialized = false;

function ensureFirebase() {
  if (initialized) return;
  if (!env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    throw new Error("FCM is not configured (FIREBASE_SERVICE_ACCOUNT_PATH)");
  }
  const accountPath = path.resolve(env.FIREBASE_SERVICE_ACCOUNT_PATH);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const serviceAccount = require(accountPath);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  initialized = true;
}

function stringifyData(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

function resolvePushImageUrl(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const base = env.PUBLIC_UPLOADS_BASE_URL?.replace(/\/+$/, "");
  if (!base) return null;

  const objectPath = trimmed.replace(/^\/+/, "");
  return `${base}/${objectPath}`;
}

/** Rich admin broadcast — one stable shape for iOS/Android (matches mobile FCM contract). */
function buildRichCampaignMessage(params, category, data) {
  const image = resolvePushImageUrl(params.imageUrl);

  const aps = {
    ...(category ? { category } : {}),
    ...(image ? { "mutable-content": 1 } : {}),
  };

  const apns = {
    headers: {
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    payload: { aps },
    ...(image ? { fcmOptions: { image } } : {}),
  };

  const android = {
    priority: "high",
    ...(image ? { notification: { image } } : {}),
  };

  return {
    tokens: params.tokens,
    notification: { title: params.title, body: params.body },
    data,
    android,
    apns,
  };
}

/** Trade / wallet / KYC pushes — alert + sound in APNS. */
function buildStandardMessage(params, data, category) {
  const apns = {
    headers: {
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    payload: {
      aps: {
        alert: {
          title: params.title,
          body: params.body,
        },
        sound: "default",
        ...(category ? { category } : {}),
      },
    },
  };

  return {
    tokens: params.tokens,
    notification: { title: params.title, body: params.body },
    data,
    android: { priority: "high" },
    apns,
  };
}

function resolveRichCampaignData(params) {
  const actionRoute =
    params.actionRoute ??
    params.data?.action_route ??
    params.data?.route ??
    null;
  const resolvedAction = resolvePushActionFromRoute(actionRoute, params.actionType);

  const data = {
    action_type: resolvedAction.actionType,
  };
  if (resolvedAction.actionRoute) {
    data.action_route = resolvedAction.actionRoute;
  }
  if (resolvedAction.actionButton) {
    data.action_button = resolvedAction.actionButton;
  }
  if (params.data?.type) {
    data.type = String(params.data.type);
  }
  if (params.data?.campaignId) {
    data.campaignId = String(params.data.campaignId);
  }

  return {
    data: stringifyData(data),
    category: resolvedAction.actionType,
  };
}

/**
 * @param {{ tokens: string[], title: string, body: string, data?: Record<string, string>, imageUrl?: string | null, actionRoute?: string | null, actionType?: string, actionButton?: string | null, richCampaign?: boolean }} params
 * @returns {Promise<{ providerMessageId?: string, invalidTokens: string[] }>}
 */
async function send(params) {
  ensureFirebase();
  const tokens = params.tokens.filter(Boolean);
  if (tokens.length === 0) {
    throw new Error("No FCM tokens to send to");
  }

  const sendParams = { ...params, tokens };

  let message;
  if (params.richCampaign === true) {
    const resolved = resolveRichCampaignData(params);
    message = buildRichCampaignMessage(sendParams, resolved.category, resolved.data);
  } else {
    message = buildStandardMessage(sendParams, stringifyData(params.data), params.actionType || null);
  }

  console.log(JSON.stringify(message, null, 2));
  const res = await admin.messaging().sendEachForMulticast(message);

  const invalidTokens = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        invalidTokens.push(tokens[i]);
      }
    }
  });

  return {
    providerMessageId: res.responses.find((r) => r.messageId)?.messageId,
    invalidTokens,
  };
}

module.exports = { send };
