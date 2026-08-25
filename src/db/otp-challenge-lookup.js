const { mongoose } = require("./mongo");

const MOBILE_MONEY_OTP_PREFIX = "mobile-money-otp:";

/**
 * Job idempotencyKey is `mobile-money-otp:{userId}:{challengeId}`.
 * @param {unknown} idempotencyKey
 * @returns {string | null}
 */
function parseChallengeId(idempotencyKey) {
  const key = String(idempotencyKey || "");
  if (!key.startsWith(MOBILE_MONEY_OTP_PREFIX)) return null;
  const rest = key.slice(MOBILE_MONEY_OTP_PREFIX.length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon < 0) return null;
  const challengeId = rest.slice(lastColon + 1).trim();
  if (!challengeId || !mongoose.isValidObjectId(challengeId)) return null;
  return challengeId;
}

/**
 * Read-only lookup of otp_challenges.purpose. Never projects codeHash.
 * @param {unknown} idempotencyKey
 * @returns {Promise<string | null>}
 */
async function findOtpChallengePurpose(idempotencyKey) {
  const challengeId = parseChallengeId(idempotencyKey);
  if (!challengeId) return null;
  const doc = await mongoose.connection.collection("otp_challenges").findOne(
    { _id: new mongoose.Types.ObjectId(challengeId) },
    { projection: { purpose: 1 } },
  );
  const purpose = doc && doc.purpose != null ? String(doc.purpose) : "";
  return purpose || null;
}

/**
 * Map stored OTP purpose to SMS carrier. Unknown/missing → Telesom (Waafi-safe).
 * @param {unknown} idempotencyKey
 * @returns {Promise<{ smsProvider: "telesom" | "somtel", gateway: "waafi" | "edahab" | null, purpose: string | null }>}
 */
async function resolveMobileMoneySmsRoute(idempotencyKey) {
  let purpose = null;
  try {
    purpose = await findOtpChallengePurpose(idempotencyKey);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "otp_challenge_purpose_lookup_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { smsProvider: "telesom", gateway: null, purpose: null };
  }

  if (purpose === "mobile_money_edahab") {
    return { smsProvider: "somtel", gateway: "edahab", purpose };
  }
  if (purpose === "mobile_money_waafi") {
    return { smsProvider: "telesom", gateway: "waafi", purpose };
  }
  return { smsProvider: "telesom", gateway: null, purpose };
}

module.exports = {
  parseChallengeId,
  findOtpChallengePurpose,
  resolveMobileMoneySmsRoute,
};
