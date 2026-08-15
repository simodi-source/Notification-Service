const { mongoose } = require("./db/mongo");
const { UserModel, writeLog } = require("./db/notification-log");
const { EVENT_CHANNELS, renderTemplate } = require("./templates");
const emailProvider = require("./providers/email.bird");
const pushProvider = require("./providers/push.fcm");
const smsTwilioProvider = require("./providers/sms.twilio");
const smsTelesomProvider = require("./providers/sms.telesom");
const whatsappProvider = require("./providers/whatsapp.twilio");
const { buildCertificatePdf, safeFilename: certificateFilename } = require("./services/certificate.service");
const { buildInvoicePdf, safeFilename: invoiceFilename } = require("./services/invoice.service");
const { validateNotificationJob } = require("./queue/job-contract");

/** OTP / transactional SMS must send even when user prefs.sms is false. */
const FORCE_SMS_EVENTS = new Set(["mobile_money.otp"]);

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
    recipientPhone,
    locale: jobLocale,
  } = job.data;

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
  const forceSms = FORCE_SMS_EVENTS.has(event);
  const enabledChannels = channels.filter((ch) => {
    if (ch === "sms" && forceSms) return true;
    return prefs[ch] !== false;
  });

  // For trade confirmations, backfill price/total/date/reference from Mongo before
  // render so the branded email body matches the certificate attachment.
  let templatePayload = payload;
  if (templateCode === "trade_executed") {
    templatePayload = await enrichTradeCertificateDescriptor({
      ...payload,
      tradeId: payload.tradeId ? String(payload.tradeId) : null,
    });
  }

  const locale = jobLocale || user?.preferredLanguage || "en";
  const rendered = renderTemplate(templateCode, templatePayload, user || {}, locale);
  const userOid = user?._id || (userId && mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : null);

  const errors = [];
  /** @type {{ requestId?: string, messageId?: string, status?: string } | null} */
  let smsDeliveryResult = null;

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
        const attachments = await materializeAttachments(emailContent.attachments, user);
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
        const phoneFromUser =
          user?.countryCode && user?.mobile ? `${user.countryCode}${user.mobile}` : null;
        const phone = (recipientPhone && String(recipientPhone).trim()) || phoneFromUser;
        if (!phone) throw new Error("No mobile number for SMS");
        const body =
          rendered.sms?.body ||
          rendered.push?.body ||
          rendered.email?.subject ||
          "Simodi notification";
        let smsResult;
        if (event === "mobile_money.otp") {
          smsResult = await smsTelesomProvider.send({ to: phone, body });
        } else {
          smsResult = await smsTwilioProvider.send({ to: phone, body });
        }

        await writeLog({
          userId: userOid,
          event,
          templateCode,
          channel,
          status: "sent",
          idempotencyKey: channelKey,
          providerMessageId: smsResult?.providerMessageId || smsResult?.messageId,
        });

        if (smsResult && (smsResult.requestId || smsResult.messageId || smsResult.status)) {
          smsDeliveryResult = {
            requestId: smsResult.requestId,
            messageId: smsResult.messageId,
            status: smsResult.status || "queued",
          };
        }
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

  return smsDeliveryResult;
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
async function materializeAttachments(descriptors, user) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) return [];
  const out = [];
  const customer = customerFromUser(user);
  for (const desc of descriptors) {
    if (!desc || typeof desc !== "object") continue;
    if (desc.type === "trade_certificate") {
      const enriched = await enrichTradeCertificateDescriptor(desc);
      const pdf = await buildCertificatePdf(enriched);
      if (!Buffer.isBuffer(pdf) || pdf.length === 0) {
        throw new Error("Certificate PDF render returned empty buffer");
      }
      out.push({
        content: pdf,
        filename: certificateFilename(enriched.referenceCode || enriched.tradeId),
        type: "application/pdf",
      });
    } else if (desc.type === "trade_invoice") {
      const enriched = await enrichTradeCertificateDescriptor({ ...desc, ...customer });
      const pdf = await buildInvoicePdf(enriched);
      if (!Buffer.isBuffer(pdf) || pdf.length === 0) {
        throw new Error("Invoice PDF render returned empty buffer");
      }
      out.push({
        content: pdf,
        filename: invoiceFilename(enriched.referenceCode, enriched.side === "sell"),
        type: "application/pdf",
      });
    }
  }
  return out;
}

function customerFromUser(user) {
  if (!user) {
    return { customerName: "Customer", customerEmail: "", customerPhone: "" };
  }
  const fullName = [user.firstName || "", user.lastName || ""]
    .map((s) => String(s).trim())
    .filter(Boolean)
    .join(" ");
  const phone = [user.countryCode || "", user.mobile || ""]
    .map((s) => String(s).trim())
    .filter(Boolean)
    .join(" ");
  return {
    customerName: fullName || "Customer",
    customerEmail: user.email ? String(user.email) : "",
    customerPhone: phone,
  };
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
      side: desc.side || order.side || null,
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

module.exports = { handleNotificationJob };
