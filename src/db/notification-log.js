const { mongoose } = require("./mongo");

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    event: { type: String, required: true },
    templateCode: { type: String, required: true },
    channel: { type: String, required: true, enum: ["email", "push", "sms", "whatsapp"] },
    status: { type: String, required: true, enum: ["queued", "sent", "failed"] },
    idempotencyKey: { type: String, index: true },
    providerMessageId: { type: String },
    error: { type: String },
  },
  { timestamps: true, collection: "notifications" },
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ idempotencyKey: 1, channel: 1 }, { unique: true, sparse: true });

const NotificationModel = mongoose.models.Notification || mongoose.model("Notification", notificationSchema);

const userSchema = new mongoose.Schema(
  {
    email: { type: String, lowercase: true, trim: true },
    countryCode: String,
    mobile: String,
    firstName: String,
    lastName: String,
    preferredLanguage: String,
    fcmTokens: [
      {
        token: { type: String, required: true },
        platform: { type: String, enum: ["ios", "android", "web"], default: "android" },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    notificationPreferences: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
  },
  // Shared backend collection — keep flexible so new user fields aren't stripped.
  { collection: "users", strict: false },
);

const UserModel = mongoose.models.User || mongoose.model("User", userSchema);

/**
 * Load a notification recipient from the shared `users` collection.
 * Uses the native driver so we never depend on schema casting for email / FCM tokens.
 *
 * @param {string | import("mongoose").Types.ObjectId} userId
 * @returns {Promise<Record<string, any> | null>}
 */
async function findNotificationUser(userId) {
  if (!userId || !mongoose.isValidObjectId(userId)) return null;
  const oid = new mongoose.Types.ObjectId(String(userId));
  const doc = await mongoose.connection.collection("users").findOne(
    { _id: oid },
    {
      projection: {
        email: 1,
        countryCode: 1,
        mobile: 1,
        firstName: 1,
        lastName: 1,
        preferredLanguage: 1,
        fcmTokens: 1,
        notificationPreferences: 1,
      },
    },
  );
  return doc;
}

async function writeLog(entry) {
  const filter = entry.idempotencyKey
    ? { idempotencyKey: entry.idempotencyKey, channel: entry.channel }
    : { _id: new mongoose.Types.ObjectId() };

  await NotificationModel.findOneAndUpdate(
    filter,
    {
      $set: {
        userId: entry.userId || undefined,
        event: entry.event,
        templateCode: entry.templateCode,
        channel: entry.channel,
        status: entry.status,
        idempotencyKey: entry.idempotencyKey,
        providerMessageId: entry.providerMessageId,
        error: entry.error,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
}

module.exports = { NotificationModel, UserModel, writeLog, findNotificationUser };
