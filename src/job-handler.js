const { mongoose } = require("./db/mongo");
const { UserModel, writeLog } = require("./db/notification-log");
const { EVENT_CHANNELS, renderTemplate } = require("./templates");
const emailProvider = require("./providers/email.bird");
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

  if (event === "auth.otp" || event === "auth.password_reset" || event === "wallet.withdrawal_otp") {
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

  // For trade confirmations, backfill price/total/date/reference from Mongo before
  // render so the branded email body matches the certificate attachment.
  let templatePayload = payload;
  if (templateCode === "trade_executed") {
    templatePayload = await enrichTradeCertificateDescriptor({
      ...payload,
      tradeId: payload.tradeId ? String(payload.tradeId) : null,
    });
  }

  const rendered = renderTemplate(templateCode, templatePayload, user || {});
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
        console.log("email result", result);
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
 * Buffer-backed shape the email provider expects. We render PDFs lazily here (rather than
 * during enqueue) so the worker can fail/retry without bloating Redis with
 * pre-encoded blobs.
 *
 * @param {Array<Record<string, unknown>> | undefined} descriptors
 * @returns {Promise<Array<{ content: Buffer, filename: string, type: string, disposition?: string, contentId?: string }>>}
 */
async function materializeAttachments(descriptors) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) return [];
  const out = [];
  for (const desc of descriptors) {
    if (!desc || typeof desc !== "object") continue;
    if (desc.type === "trade_certificate") {
      try {
        // Backfill any missing fields straight from Mongo so the certificate is
        // complete even when the producing backend predates the enriched payload.
        const enriched = await enrichTradeCertificateDescriptor(desc);
        const pdf = await buildCertificatePdf(enriched);
        out.push({
          content: pdf,
          filename: certificateFilename(enriched.referenceCode || enriched.tradeId),
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

/**
 * If the queue payload is missing any of the human-readable fields the
 * certificate needs (referenceCode, prices, totals, executedAt), we look the
 * trade order up in MongoDB directly and fill the gaps.
 *
 * Querying the raw `trade_orders` collection here (instead of declaring a full
 * mongoose model) keeps the notification-service decoupled from the backend's
 * schema definitions while still benefitting from the shared Mongo connection.
 *
 * @param {Record<string, any>} desc
 * @returns {Promise<Record<string, any>>}
 */
async function enrichTradeCertificateDescriptor(desc) {
  // A reference that *looks* like a Mongo ObjectId (24 hex chars) is treated
  // as missing — that protects us from older producers that accidentally sent
  // `referenceCode: tradeId` as a fallback. We always re-resolve in that case.
  const humanRef = looksLikeObjectId(desc.referenceCode) ? null : desc.referenceCode || null;

  const needsLookup =
    !humanRef ||
    desc.priceAedPerGramMajor == null ||
    desc.totalAedMajor == null ||
    !desc.executedAt;

  if (!needsLookup) return { ...desc, referenceCode: humanRef };
  if (!desc.tradeId || !mongoose.isValidObjectId(desc.tradeId)) {
    return { ...desc, referenceCode: humanRef };
  }

  try {
    const order = await mongoose.connection
      .collection("trade_orders")
      .findOne({ _id: new mongoose.Types.ObjectId(String(desc.tradeId)) });
    if (!order) return { ...desc, referenceCode: humanRef };

    const orderRef = looksLikeObjectId(order.referenceCode) ? null : order.referenceCode || null;
    const aedFils = Number(order.fiatAmountMinor || 0);
    const aedMajor = aedFils / 100;
    const fx = Number(order.fxRateUsed);
    const fxValid = Number.isFinite(fx) && fx > 0;
    const usdMajor = fxValid ? aedMajor / fx : null;
    const priceAed = Number(order.priceAedPerGram);
    const priceUsd =
      order.priceUsdPerGram !== null && order.priceUsdPerGram !== undefined
        ? Number(order.priceUsdPerGram)
        : fxValid && Number.isFinite(priceAed)
          ? priceAed / fx
          : null;

    return {
      ...desc,
      referenceCode: humanRef || orderRef || null,
      quoteCurrency: desc.quoteCurrency || order.quoteCurrency || "AED",
      priceAedPerGramMajor:
        desc.priceAedPerGramMajor != null
          ? desc.priceAedPerGramMajor
          : Number.isFinite(priceAed)
            ? priceAed
            : null,
      priceUsdPerGramMajor:
        desc.priceUsdPerGramMajor != null ? desc.priceUsdPerGramMajor : priceUsd,
      totalAedMajor:
        desc.totalAedMajor != null
          ? desc.totalAedMajor
          : Number.isFinite(aedMajor)
            ? aedMajor
            : null,
      totalUsdMajor: desc.totalUsdMajor != null ? desc.totalUsdMajor : usdMajor,
      executedAt:
        desc.executedAt ||
        (order.createdAt ? new Date(order.createdAt).toISOString() : null),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "warn",
        msg: "certificate enrichment lookup failed",
        tradeId: desc.tradeId,
        error: message,
      }),
    );
    return { ...desc, referenceCode: humanRef };
  }
}

/** 24 hex chars → looks like a Mongo ObjectId; should never appear on a certificate. */
function looksLikeObjectId(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  return /^[a-f0-9]{24}$/i.test(s);
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
