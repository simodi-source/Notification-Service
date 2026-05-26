const { mongoose } = require("./db/mongo");
const { UserModel, writeLog } = require("./db/notification-log");
const { EVENT_CHANNELS, renderTemplate } = require("./templates");
const emailProvider = require("./providers/email.sendgrid");
const pushProvider = require("./providers/push.fcm");
const smsProvider = require("./providers/sms.twilio");
const whatsappProvider = require("./providers/whatsapp.twilio");
const { buildCertificatePdf, safeFilename: certificateFilename } = require("./services/certificate.service");
const { env } = require("./config/env");
const { createRedisConnection } = require("./queue/connection");
const { validateNotificationJob } = require("./queue/job-contract");

const otpRateRedis = createRedisConnection();

/**
 * @param {import('bullmq').Job} job
 */
async function handleNotificationJob(job) {
  validateNotificationJob(job.data);
  const {
    event,
    userId,
    templateCode,
    payload = {},
    channels: requestedChannels,
    idempotencyKey,
    recipientEmail,
  } = job.data;

  if (event === "auth.otp" || event === "auth.password_reset") {
    await assertOtpRateLimit(userId, recipientEmail, idempotencyKey);
  }

  let user = null;
  if (userId && mongoose.isValidObjectId(userId)) {
    user = await UserModel.findById(userId).lean();
  }

  const prefs = user?.notificationPreferences || {
    email: true,
    push: true,
    sms: false,
    whatsapp: false,
  };

  const channels = (requestedChannels?.length ? requestedChannels : EVENT_CHANNELS[event]) || ["email"];
  const enabledChannels = channels.filter((ch) => prefs[ch] !== false);

  const rendered = renderTemplate(templateCode, payload, user || {});
  const userOid = user?._id || (userId && mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : null);

  const errors = [];

  for (const channel of enabledChannels) {
    const channelKey = `${idempotencyKey}:${channel}`;
    try {
      await writeLog({
        userId: userOid,
        event,
        templateCode,
        channel,
        status: "queued",
        idempotencyKey: channelKey,
      });

      if (channel === "email") {
        const to = user?.email || recipientEmail;
        if (!to) throw new Error("No email address for notification");
        const emailContent = rendered.email;
        if (!emailContent) throw new Error(`Template ${templateCode} has no email content`);
        const attachments = await materializeAttachments(emailContent.attachments);
        const result = await emailProvider.send({
          to,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          attachments,
        });
        await writeLog({
          userId: userOid,
          event,
          templateCode,
          channel,
          status: "sent",
          idempotencyKey: channelKey,
          providerMessageId: result.providerMessageId,
        });
      } else if (channel === "push") {
        const pushContent = rendered.push;
        if (!pushContent) continue;
        const tokens = (user?.fcmTokens || []).map((t) => t.token).filter(Boolean);
        if (tokens.length === 0) {
          await writeLog({
            userId: userOid,
            event,
            templateCode,
            channel,
            status: "failed",
            idempotencyKey: channelKey,
            error: "No FCM tokens registered",
          });
          continue;
        }
        const result = await pushProvider.send({ tokens, ...pushContent });
        if (result.invalidTokens?.length) {
          await UserModel.updateOne(
            { _id: user._id },
            { $pull: { fcmTokens: { token: { $in: result.invalidTokens } } } },
          );
        }
        await writeLog({
          userId: userOid,
          event,
          templateCode,
          channel,
          status: "sent",
          idempotencyKey: channelKey,
          providerMessageId: result.providerMessageId,
        });
      } else if (channel === "sms") {
        const phone = user?.countryCode && user?.mobile ? `${user.countryCode}${user.mobile}` : null;
        if (!phone) throw new Error("No mobile number for SMS");
        const body = rendered.push?.body || rendered.email?.subject || "Simodi notification";
        await smsProvider.send({ to: phone, body });
        await writeLog({
          userId: userOid,
          event,
          templateCode,
          channel,
          status: "sent",
          idempotencyKey: channelKey,
        });
      } else if (channel === "whatsapp") {
        const phone = user?.countryCode && user?.mobile ? `${user.countryCode}${user.mobile}` : null;
        if (!phone) throw new Error("No mobile number for WhatsApp");
        const body = rendered.push?.body || "Simodi notification";
        await whatsappProvider.send({ to: phone, body });
        await writeLog({
          userId: userOid,
          event,
          templateCode,
          channel,
          status: "sent",
          idempotencyKey: channelKey,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ level: "error", event, channel, userId, message }));
      await writeLog({
        userId: userOid,
        event,
        templateCode,
        channel,
        status: "failed",
        idempotencyKey: channelKey,
        error: message,
      });
      errors.push({ channel, message });
    }
  }

  if (errors.length > 0 && errors.length === enabledChannels.length) {
    throw new Error(`All channels failed: ${errors.map((e) => `${e.channel}: ${e.message}`).join("; ")}`);
  }
}

/**
 * Turns lightweight attachment descriptors emitted by templates into the
 * Buffer-backed shape SendGrid expects. We render PDFs lazily here (rather than
 * during enqueue) so the worker can fail/retry without bloating Redis with
 * pre-encoded blobs.
 *
 * @param {Array<Record<string, unknown>> | undefined} descriptors
 * @returns {Promise<Array<{ content: Buffer, filename: string, type: string }>>}
 */
async function materializeAttachments(descriptors) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) return [];
  const out = [];
  for (const desc of descriptors) {
    if (!desc || typeof desc !== "object") continue;
    if (desc.type === "trade_certificate") {
      try {
        const pdf = await buildCertificatePdf({
          referenceCode: desc.referenceCode,
          tradeId: desc.tradeId,
          metal: desc.metal,
          grams: desc.grams,
          gramsExact: desc.gramsExact,
          quoteCurrency: desc.quoteCurrency,
          priceAedPerGramMajor: desc.priceAedPerGramMajor,
          priceUsdPerGramMajor: desc.priceUsdPerGramMajor,
          totalAedMajor: desc.totalAedMajor,
          totalUsdMajor: desc.totalUsdMajor,
          executedAt: desc.executedAt,
        });
        out.push({
          content: pdf,
          filename: certificateFilename(desc.referenceCode || desc.tradeId),
          type: "application/pdf",
        });
      } catch (err) {
        // Don't block the email if the certificate render fails — log and
        // continue without the attachment. The customer still gets the trade
        // confirmation; ops can investigate the render failure separately.
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          JSON.stringify({
            level: "error",
            msg: "certificate render failed",
            referenceCode: desc.referenceCode || desc.tradeId,
            error: message,
          }),
        );
      }
    }
  }
  return out;
}

async function assertOtpRateLimit(userId, recipientEmail, idempotencyKey) {
  const keyBase = userId || recipientEmail || idempotencyKey;
  const redisKey = `otp-rate:${keyBase}`;
  const count = await otpRateRedis.incr(redisKey);
  if (count === 1) {
    await otpRateRedis.pexpire(redisKey, env.OTP_RATE_LIMIT_WINDOW_MS);
  }
  if (count > env.OTP_RATE_LIMIT_MAX) {
    throw new Error("OTP rate limit exceeded");
  }
}

module.exports = { handleNotificationJob };
