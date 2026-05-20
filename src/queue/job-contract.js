const { NOTIFICATIONS_QUEUE } = require("./names");

/** Mirrors backend/src/types/notification.ts — keep in sync when changing the contract. */
const NOTIFICATION_JOB_DEFAULTS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: true,
  removeOnFail: false,
};

/**
 * @param {unknown} data
 * @returns {asserts data is import('./job-contract').NotificationJobPayload}
 */
function validateNotificationJob(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid job: payload must be an object");
  }
  const job = /** @type {Record<string, unknown>} */ (data);
  if (typeof job.event !== "string" || !job.event) {
    throw new Error("Invalid job: event is required");
  }
  if (typeof job.templateCode !== "string" || !job.templateCode) {
    throw new Error("Invalid job: templateCode is required");
  }
  if (typeof job.idempotencyKey !== "string" || !job.idempotencyKey) {
    throw new Error("Invalid job: idempotencyKey is required");
  }
  if (!job.userId && !job.recipientEmail) {
    throw new Error("Invalid job: userId or recipientEmail is required");
  }
  if (job.payload !== undefined && (typeof job.payload !== "object" || job.payload === null)) {
    throw new Error("Invalid job: payload must be an object when provided");
  }
}

module.exports = {
  NOTIFICATIONS_QUEUE,
  NOTIFICATION_JOB_DEFAULTS,
  validateNotificationJob,
};
