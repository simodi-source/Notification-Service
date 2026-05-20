const path = require("path");
const admin = require("firebase-admin");
const { env } = require("../config/env");

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

/**
 * @param {{ tokens: string[], title: string, body: string, data?: Record<string, string> }} params
 * @returns {Promise<{ providerMessageId?: string, invalidTokens: string[] }>}
 */
async function send(params) {
  ensureFirebase();
  const tokens = params.tokens.filter(Boolean);
  if (tokens.length === 0) {
    throw new Error("No FCM tokens to send to");
  }

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: params.title, body: params.body },
    data: params.data || {},
  });

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
