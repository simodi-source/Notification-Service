const { env } = require("../config/env");
const { resolvePushActionFromRoute } = require("../providers/push-routes");
const { buildTradeConfirmationEmail } = require("./trade-confirmation-email");
const { catalog, resolveLocale } = require("./i18n");

const OTP_EXPIRY_MINUTES = 5;

/** Default channels per event when job.channels is omitted. */
const EVENT_CHANNELS = {
  "auth.otp": ["email"],
  "auth.password_reset": ["email"],
  "admin.mfa_otp": ["email"],
  "wallet.withdrawal_otp": ["email"],
  "mobile_money.otp": ["sms"],
  "kyc.approved": ["email", "push"],
  "kyc.rejected": ["email", "push"],
  "bank.verification.approved": ["email", "push"],
  "bank.verification.rejected": ["email", "push"],
  "trade.executed": ["email", "push"],
  "trade.failed": ["email", "push"],
  "wallet.deposit_requested": ["email", "push"],
  "wallet.deposit_approved": ["email", "push"],
  "wallet.deposit_rejected": ["email", "push"],
  "wallet.withdrawal_requested": ["email", "push"],
  "wallet.withdrawal_processing": ["email", "push"],
  "wallet.withdrawal_paid": ["email", "push"],
  "wallet.withdrawal_failed": ["email", "push"],
  "wallet.withdrawal_cancelled": ["email", "push"],
  "gift.sent": ["email", "push"],
  "gift.received": ["email", "push"],
  "mart.order.confirmed": ["email", "push"],
  "mart.order.packed": ["email", "push"],
  "mart.order.shipped": ["email", "push"],
  "mart.order.delivered": ["email", "push"],
  "mart.order.cancelled": ["email", "push"],
  "admin.push.broadcast": ["push"],
  "admin.ops.bank_verification_pending": ["email"],
  "admin.ops.wallet_deposit_pending": ["email"],
  "admin.ops.wallet_withdrawal_pending": ["email"],
  "admin.ops.mart_order_new": ["email"],
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Returns the value when it is a real human-readable trade reference
 * (e.g. "BUY00000123" or "SEL00000007"), and returns null when the value is
 * missing or shaped like a Mongo ObjectId (24 hex chars). We use this anywhere
 * a customer-visible string is rendered, so an upstream regression on the
 * backend can never leak an internal ObjectId into the email/certificate.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function sanitizeHumanReference(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^[a-f0-9]{24}$/i.test(trimmed)) return null;
  return trimmed;
}

function metalLabel(metal) {
  return metal === "silver" ? "Silver" : "Gold";
}

function formatPayoutMajor(amountMinor, currency) {
  if (amountMinor === null || amountMinor === undefined || !Number.isFinite(Number(amountMinor))) {
    return null;
  }
  const cur = currency ? String(currency).trim() : "AED";
  return `${cur} ${(Number(amountMinor) / 100).toFixed(2)}`;
}

function logoBlock() {
  const logoUrl = env.MAIL_BRAND_LOGO_URL;
  if (logoUrl) {
    return `<img src="${escapeHtml(logoUrl)}" alt="Simodi" width="120" style="display:block;margin:0 0 20px;" />`;
  }
  return `<p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#1a1a1a;letter-spacing:-0.02em;">
         <span style="color:#B8941E;">Simodi</span>
       </p>`;
}

function otpCallout(code, otpLabel = "Your OTP Code") {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;width:100%;">
    <tr>
      <td style="background:#f7f7f7;border:1px dashed #d0d0d0;padding:16px 20px;text-align:center;">
        <p style="margin:0 0 6px;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(otpLabel)}</p>
        <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:0.35em;font-family:ui-monospace,Consolas,monospace;color:#111;">${escapeHtml(code)}</p>
      </td>
    </tr>
  </table>`;
}

/**
 * Renders a key/value details table inside the email body.
 * @param {Array<{ label: string, value: string }>} rows
 */
function detailsCallout(rows) {
  if (!rows || rows.length === 0) return "";
  const body = rows
    .map(
      (r) => `<tr>
        <td style="padding:8px 0;font-size:13px;color:#666;width:40%;">${escapeHtml(r.label)}</td>
        <td style="padding:8px 0;font-size:14px;color:#111;font-weight:600;">${escapeHtml(r.value)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;width:100%;background:#f7f7f7;border-left:3px solid #B8941E;">
    <tr><td style="padding:12px 20px;">
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;">${body}</table>
    </td></tr>
  </table>`;
}

/**
 * Shared branded email shell. Every template should go through this so customer
 * sees a consistent layout across auth, KYC, trades, and wallet messages.
 *
 * @param {{
 *   eyebrow: string,         // small uppercase label above heading
 *   heading: string,         // main heading line
 *   name: string,            // recipient first name (already cleaned)
 *   title: string,           // <title> tag and used in subject line by caller
 *   intro?: string,          // first paragraph
 *   paragraphs?: string[],   // additional body paragraphs
 *   callout?: string,        // pre-rendered HTML block (OTP or details table)
 *   footnote?: string,       // small grey paragraph before signature
 * }} params
 */
function brandedEmail(params) {
  const intro = params.intro ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;">${escapeHtml(params.intro)}</p>` : "";
  const extraParagraphs = (params.paragraphs || [])
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;">${escapeHtml(p)}</p>`)
    .join("");
  const callout = params.callout || "";
  const footnote = params.footnote
    ? `<p style="margin:0 0 28px;font-size:13px;line-height:1.65;color:#777;">${escapeHtml(params.footnote)}</p>`
    : "";
  const lang = params.lang === "ar" ? "ar" : "en";
  const dir = lang === "ar" ? "rtl" : "ltr";
  const align = lang === "ar" ? "right" : "left";

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(params.title)}</title>
</head>
<body style="margin:0;padding:32px 16px;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#242424;direction:${dir};text-align:${align};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;">
    <tr>
      <td style="background:#ffffff;border-left:4px solid #B8941E;padding:32px 36px 36px;">
        ${logoBlock()}
        <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(params.eyebrow)}</p>
        <p style="margin:0 0 28px;font-size:20px;font-weight:600;color:#111;line-height:1.3;">${escapeHtml(params.heading)}</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.65;">Hi ${escapeHtml(params.name)},</p>
        ${intro}
        ${callout}
        ${extraParagraphs}
        ${footnote}
        <p style="margin:0;font-size:15px;line-height:1.65;">Warm Regards,<br /><strong>The Simodi Team</strong></p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function adminOpsEmail({ title, eyebrow, heading, name, intro, rows, reviewUrl }) {
  const cta = reviewUrl
    ? `<p style="margin:0 0 24px;"><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#B8941E;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;font-size:14px;">Review in admin panel</a></p>`
    : "";
  const html = brandedEmail({
    title,
    eyebrow,
    heading,
    name,
    intro,
    callout: detailsCallout(rows),
    footnote: "This is an automated operations alert. Sign in to the admin panel to take action.",
  }).replace(
    "<p style=\"margin:0;font-size:15px;line-height:1.65;\">Warm Regards,<br /><strong>The Simodi Team</strong></p>",
    `${cta}<p style="margin:0;font-size:15px;line-height:1.65;">Warm Regards,<br /><strong>The Simodi Team</strong></p>`,
  );
  return { subject: title, html };
}

/**
 * @param {string} templateCode
 * @param {Record<string, unknown>} payload
 * @param {{ firstName?: string }} user
 * @param {"en"|"ar"|undefined} locale
 */
function renderTemplate(templateCode, payload, user, locale) {
  const lang = resolveLocale(locale || user?.preferredLanguage);
  const i18n = catalog(lang);
  const name =
    (payload.recipientName && String(payload.recipientName).trim()) ||
    user?.firstName?.trim() ||
    i18n.greetingThere;
  const emailLang = { lang };

  switch (templateCode) {
    case "auth_otp": {
      const c = i18n.auth_otp;
      const title = c.subject;
      return {
        email: {
          subject: title,
          html: brandedEmail({
            ...emailLang,
            title,
            eyebrow: c.eyebrow,
            heading: c.heading,
            name,
            intro: c.intro,
            callout: otpCallout(String(payload.otpCode || ""), i18n.otpLabel),
            footnote: c.footnote(OTP_EXPIRY_MINUTES),
          }),
        },
        push: null,
      };
    }
    case "auth_password_reset": {
      const c = i18n.auth_password_reset;
      const title = c.subject;
      return {
        email: {
          subject: title,
          html: brandedEmail({
            ...emailLang,
            title,
            eyebrow: c.eyebrow,
            heading: c.heading,
            name,
            intro: c.intro,
            callout: otpCallout(String(payload.otpCode || ""), i18n.otpLabel),
            paragraphs: [c.expires(OTP_EXPIRY_MINUTES)],
            footnote: c.footnote,
          }),
        },
        push: null,
      };
    }
    case "admin_mfa_otp": {
      const c = i18n.admin_mfa_otp;
      const adminName = String(payload.adminName || "Admin");
      const adminEmail = String(payload.adminEmail || "");
      const adminRoles = String(payload.adminRoles || "Admin");
      const title = c.subject(adminName, adminRoles);
      return {
        email: {
          subject: title,
          html: brandedEmail({
            ...emailLang,
            title,
            eyebrow: c.eyebrow,
            heading: c.heading,
            name: "Super Admin",
            intro: c.intro(adminName, adminEmail, adminRoles),
            callout: otpCallout(String(payload.otpCode || ""), i18n.otpLabel),
            paragraphs: [c.expires(OTP_EXPIRY_MINUTES)],
            footnote: c.footnote,
          }),
        },
        push: null,
      };
    }
    case "wallet_withdrawal_otp": {
      const c = i18n.wallet_withdrawal_otp;
      const title = c.subject;
      return {
        email: {
          subject: title,
          html: brandedEmail({
            ...emailLang,
            title,
            eyebrow: c.eyebrow,
            heading: c.heading,
            name,
            intro: c.intro,
            callout: otpCallout(String(payload.otpCode || ""), i18n.otpLabel),
            paragraphs: [c.expires(OTP_EXPIRY_MINUTES)],
            footnote: c.footnote,
          }),
        },
        push: null,
      };
    }
    case "mobile_money_otp": {
      const otpCode = String(payload.otpCode || "");
      const smsBody = `Your Simodi verification code is ${otpCode}`;
      return {
        email: null,
        push: null,
        sms: { body: smsBody },
      };
    }
    case "kyc_approved": {
      const c = i18n.kyc_approved;
      const title = c.subject;
      return {
        email: {
          subject: title,
          html: brandedEmail({
            ...emailLang,
            title,
            eyebrow: c.eyebrow,
            heading: c.heading,
            name,
            intro: c.intro,
            footnote: c.footnote,
          }),
        },
        push: {
          title: c.pushTitle,
          body: c.pushBody,
          data: { type: "kyc.approved" },
        },
      };
    }
    case "kyc_rejected": {
      const c = i18n.kyc_rejected;
      const title = c.subject;
      return {
        email: {
          subject: title,
          html: brandedEmail({
            ...emailLang,
            title,
            eyebrow: c.eyebrow,
            heading: c.heading,
            name,
            intro: c.intro,
            paragraphs: [c.paragraph],
            footnote: c.footnote,
          }),
        },
        push: {
          title: c.pushTitle,
          body: c.pushBody,
          data: { type: "kyc.rejected" },
        },
      };
    }
    case "bank_verification_approved": {
      const bankName = payload.bankName ? String(payload.bankName) : "Bank account";
      const accountLast4 = payload.accountLast4 ? String(payload.accountLast4) : null;
      const title = "Simodi — Bank account verified";
      const rows = [{ label: "Bank", value: bankName }];
      if (accountLast4) rows.push({ label: "Account", value: `****${accountLast4}` });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Bank verification",
            heading: "Your bank account is verified",
            name,
            intro:
              "Your bank account details have been approved. You can now request wallet withdrawals to this account from the Simodi app.",
            callout: detailsCallout(rows),
            footnote: "Make sure the account remains in your name and matches your verified identity.",
          }),
        },
        push: {
          title: "Bank account verified",
          body: `${bankName} is verified. You can now request withdrawals.`,
          data: {
            type: "bank.verification.approved",
            bankVerificationId: String(payload.bankVerificationId || ""),
          },
        },
      };
    }
    case "bank_verification_rejected": {
      const bankName = payload.bankName ? String(payload.bankName) : "Bank account";
      const accountLast4 = payload.accountLast4 ? String(payload.accountLast4) : null;
      const reason = payload.reason ? String(payload.reason) : null;
      const title = "Simodi — Bank verification update";
      const rows = [{ label: "Bank", value: bankName }];
      if (accountLast4) rows.push({ label: "Account", value: `****${accountLast4}` });
      if (reason) rows.push({ label: "Reason", value: reason });
      const intro = reason
        ? `We were unable to approve the bank account you submitted: ${reason}. Please open the Simodi app, review your bank details and proof document, then resubmit for verification.`
        : "We were unable to approve the bank account you submitted. Please open the Simodi app, review your bank details and proof document, then resubmit for verification.";
      const pushBody = reason
        ? `We could not verify ${bankName}: ${reason}. Please review and resubmit in the app.`
        : `We could not verify ${bankName}. Please review and resubmit in the app.`;
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Bank verification",
            heading: "We could not verify your bank account",
            name,
            intro,
            callout: detailsCallout(rows),
            footnote: "Withdrawals require a verified bank account in your name.",
          }),
        },
        push: {
          title: "Bank verification update",
          body: pushBody,
          data: {
            type: "bank.verification.rejected",
            bankVerificationId: String(payload.bankVerificationId || ""),
          },
        },
      };
    }
    case "trade_executed": {
      const metal = payload.metal === "silver" ? "Silver" : "Gold";
      const isBuy = payload.side !== "sell";
      const side = isBuy ? "Bought" : "Sold";
      const grams = String(payload.gramsExact || payload.grams || "");
      const pushSummary = `You ${side.toLowerCase()} ${grams}g ${metal}.`;
      // Reference for the certificate attachment descriptor — never fall back to
      // the Mongo ObjectId. The email template also sanitizes independently.
      const humanReferenceCode = sanitizeHumanReference(payload.referenceCode);

      const tradeDoc = {
        referenceCode: humanReferenceCode || null,
        tradeId: payload.tradeId ? String(payload.tradeId) : null,
        side: isBuy ? "buy" : "sell",
        metal: payload.metal,
        grams: payload.grams,
        gramsExact: payload.gramsExact,
        quoteCurrency: payload.quoteCurrency,
        priceAedPerGramMajor: payload.priceAedPerGramMajor,
        priceUsdPerGramMajor: payload.priceUsdPerGramMajor,
        totalAedMajor: payload.totalAedMajor,
        totalUsdMajor: payload.totalUsdMajor,
        executedAt: payload.executedAt,
      };
      // Buy: certificate + sales invoice. Sell: purchase voucher only.
      const attachments = [
        { type: "trade_invoice", ...tradeDoc },
        ...(isBuy ? [{ type: "trade_certificate", ...tradeDoc }] : []),
      ];

      const email = buildTradeConfirmationEmail({
        name,
        isBuy,
        side: payload.side,
        metal: payload.metal,
        grams: payload.grams,
        gramsExact: payload.gramsExact,
        quoteCurrency: payload.quoteCurrency,
        priceAedPerGramMajor: payload.priceAedPerGramMajor,
        priceUsdPerGramMajor: payload.priceUsdPerGramMajor,
        totalAedMajor: payload.totalAedMajor,
        totalUsdMajor: payload.totalUsdMajor,
        referenceCode: humanReferenceCode,
        executedAt: payload.executedAt,
      });

      return {
        email: {
          subject: email.subject,
          html: email.html,
          text: email.text,
          attachments,
        },
        push: {
          title: "Trade executed",
          body: pushSummary,
          data: { type: "trade.executed", tradeId: String(payload.tradeId || "") },
        },
      };
    }
    case "trade_failed": {
      const metal = metalLabel(payload.metal);
      const side = payload.side === "sell" ? "sell" : "buy";
      const sideLabel = side === "sell" ? "Sell" : "Buy";
      const grams = String(payload.gramsExact || payload.grams || "");
      const reason = payload.reason ? String(payload.reason) : null;
      const title = `Simodi — ${sideLabel} ${metal} order failed`;
      const rows = [
        { label: "Side", value: sideLabel },
        { label: "Metal", value: metal },
        { label: "Grams", value: `${grams} g` },
      ];
      if (reason) rows.push({ label: "Reason", value: reason });
      const pushBody = reason
        ? `Your ${side} ${metal.toLowerCase()} order could not be completed: ${reason}.`
        : `Your ${side} ${metal.toLowerCase()} order could not be completed.`;
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Trade update",
            heading: `Your ${sideLabel.toLowerCase()} order could not be completed`,
            name,
            intro: reason
              ? `We were unable to complete your ${side} ${metal.toLowerCase()} order: ${reason}.`
              : `We were unable to complete your ${side} ${metal.toLowerCase()} order.`,
            callout: detailsCallout(rows),
            footnote: "No metal or wallet balance was changed. You can retry from the Simodi app.",
          }),
        },
        push: {
          title: "Trade failed",
          body: pushBody,
          data: { type: "trade.failed", tradeId: String(payload.tradeId || "") },
        },
      };
    }
    case "wallet_deposit_requested": {
      const title = "Simodi — Deposit requested";
      const rows = [];
      const humanRef = sanitizeHumanReference(payload.referenceCode);
      if (humanRef) rows.push({ label: "Reference", value: humanRef });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Wallet update",
            heading: "Your deposit request was received",
            name,
            intro:
              "Your wallet deposit request has been submitted. We will review your transfer and credit your wallet once it is confirmed.",
            callout: detailsCallout(rows),
            footnote: "You will receive another notification when your deposit is approved or if we need more information.",
          }),
        },
        push: {
          title: "Deposit requested",
          body: "Your wallet deposit request has been submitted and is pending review.",
          data: {
            type: "wallet.deposit_requested",
            paymentId: String(payload.paymentId || ""),
          },
        },
      };
    }
    case "wallet_deposit_approved": {
      const title = "Simodi — Deposit approved";
      const rows = [];
      if (payload.paymentId) rows.push({ label: "Reference", value: String(payload.paymentId) });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Wallet update",
            heading: "Your deposit has been credited",
            name,
            intro: "Your wallet deposit has been approved and the funds are now available in your Simodi wallet.",
            callout: detailsCallout(rows),
            footnote: "You can start buying gold or silver right away from the Simodi app.",
          }),
        },
        push: {
          title: "Deposit approved",
          body: "Your wallet deposit has been credited.",
          data: { type: "wallet.deposit_approved", paymentId: String(payload.paymentId || "") },
        },
      };
    }
    case "wallet_deposit_rejected": {
      const title = "Simodi — Deposit rejected";
      const reason = payload.reason ? String(payload.reason) : null;
      const rows = [];
      if (payload.paymentId) rows.push({ label: "Reference", value: String(payload.paymentId) });
      if (reason) rows.push({ label: "Reason", value: reason });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Wallet update",
            heading: "Your deposit was not approved",
            name,
            intro: reason
              ? `Your wallet deposit request was rejected: ${reason}.`
              : "Your wallet deposit request was rejected.",
            callout: detailsCallout(rows),
            footnote: "If you believe this is a mistake, please contact our support team with your deposit reference.",
          }),
        },
        push: {
          title: "Deposit rejected",
          body: reason ? `Your deposit was rejected: ${reason}.` : "Your deposit request was rejected.",
          data: {
            type: "wallet.deposit_rejected",
            paymentId: String(payload.paymentId || ""),
          },
        },
      };
    }
    case "wallet_withdrawal_requested": {
      const title = "Simodi — Withdrawal requested";
      const payout = formatPayoutMajor(payload.payoutAmountMinor, payload.payoutCurrency);
      const rows = [];
      const humanRef = sanitizeHumanReference(payload.referenceCode) || sanitizeHumanReference(payload.withdrawalId);
      if (humanRef) rows.push({ label: "Reference", value: humanRef });
      if (payout) rows.push({ label: "Amount", value: payout });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Wallet update",
            heading: "Your withdrawal request was received",
            name,
            intro:
              "Your withdrawal request has been submitted and is being processed. We will notify you once the payout is completed.",
            callout: detailsCallout(rows),
            footnote: "Funds have been reserved from your Simodi wallet while this request is reviewed.",
          }),
        },
        push: {
          title: "Withdrawal requested",
          body: payout
            ? `Your withdrawal of ${payout} has been submitted and is being processed.`
            : "Your withdrawal request has been submitted and is being processed.",
          data: {
            type: "wallet.withdrawal_requested",
            withdrawalId: String(payload.withdrawalId || ""),
          },
        },
      };
    }
    case "wallet_withdrawal_paid": {
      const title = "Simodi — Withdrawal paid";
      const payout = formatPayoutMajor(payload.payoutAmountMinor, payload.payoutCurrency);
      const rows = [];
      const humanRef = sanitizeHumanReference(payload.withdrawalId);
      if (humanRef) rows.push({ label: "Reference", value: humanRef });
      if (payout) rows.push({ label: "Amount", value: payout });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Wallet update",
            heading: "Your withdrawal has been paid",
            name,
            intro:
              "Your withdrawal has been processed and paid to your verified bank account.",
            callout: detailsCallout(rows),
            footnote: "It may take one to two business days for the funds to appear in your bank account.",
          }),
        },
        push: {
          title: "Withdrawal paid",
          body: payout
            ? `Your withdrawal of ${payout} has been paid to your bank account.`
            : "Your withdrawal has been paid to your verified bank account.",
          data: {
            type: "wallet.withdrawal_paid",
            withdrawalId: String(payload.withdrawalId || ""),
          },
        },
      };
    }
    case "wallet_withdrawal_processing": {
      const title = "Simodi — Your Withdrawal Request is Processing";
      const payout = formatPayoutMajor(payload.payoutAmountMinor, payload.payoutCurrency);
      const rows = [];
      const humanRef = sanitizeHumanReference(payload.withdrawalId);
      if (humanRef) rows.push({ label: "Reference", value: humanRef });
      if (payout) rows.push({ label: "Amount", value: payout });
      const body =
        "Your Withdrawal Request is Processing, the amount will be credited within 12-24 hours.";
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Wallet update",
            heading: "Your Withdrawal Request is Processing",
            name,
            intro: body,
            callout: detailsCallout(rows),
            footnote: "We will notify you once the payout is completed.",
          }),
        },
        push: {
          title: "Your Withdrawal Request is Processing",
          body,
          data: {
            type: "wallet.withdrawal_processing",
            withdrawalId: String(payload.withdrawalId || ""),
          },
        },
      };
    }
    case "wallet_withdrawal_failed": {
      const title = "Simodi — Withdrawal failed";
      const reason = payload.reason ? String(payload.reason) : null;
      const rows = [];
      const humanRef = sanitizeHumanReference(payload.withdrawalId);
      if (humanRef) rows.push({ label: "Reference", value: humanRef });
      if (reason) rows.push({ label: "Reason", value: reason });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Wallet update",
            heading: "Your withdrawal could not be completed",
            name,
            intro: reason
              ? `Your withdrawal could not be completed: ${reason}. The amount has been returned to your Simodi wallet.`
              : "Your withdrawal could not be completed. The amount has been returned to your Simodi wallet.",
            callout: detailsCallout(rows),
            footnote: "You can review your wallet balance and try again from the Simodi app.",
          }),
        },
        push: {
          title: "Withdrawal failed",
          body: reason
            ? `Your withdrawal could not be completed: ${reason}. Funds were returned to your wallet.`
            : "Your withdrawal could not be completed. Funds were returned to your wallet.",
          data: {
            type: "wallet.withdrawal_failed",
            withdrawalId: String(payload.withdrawalId || ""),
          },
        },
      };
    }
    case "wallet_withdrawal_cancelled": {
      const title = "Simodi — Withdrawal cancelled";
      const reason = payload.reason ? String(payload.reason) : null;
      const rows = [];
      const humanRef = sanitizeHumanReference(payload.withdrawalId);
      if (humanRef) rows.push({ label: "Reference", value: humanRef });
      if (reason) rows.push({ label: "Reason", value: reason });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Wallet update",
            heading: "Your withdrawal request was cancelled",
            name,
            intro: reason
              ? `Your withdrawal request was cancelled: ${reason}. The amount has been returned to your Simodi wallet.`
              : "Your withdrawal request was cancelled. The amount has been returned to your Simodi wallet.",
            callout: detailsCallout(rows),
            footnote: "You can review your wallet balance and try again from the Simodi app.",
          }),
        },
        push: {
          title: "Withdrawal cancelled",
          body: reason
            ? `Your withdrawal request was cancelled: ${reason}. Funds were returned to your wallet.`
            : "Your withdrawal request was cancelled. Funds were returned to your wallet.",
          data: {
            type: "wallet.withdrawal_cancelled",
            withdrawalId: String(payload.withdrawalId || ""),
          },
        },
      };
    }
    case "gift_sent": {
      const metal = metalLabel(payload.metal);
      const grams = String(payload.gramsExact || payload.grams || "");
      const recipientUserCode = payload.recipientUserCode ? String(payload.recipientUserCode) : "recipient";
      const giftRef = sanitizeHumanReference(payload.giftRef);
      const title = "Simodi — Gift sent";
      const rows = [
        { label: "Metal", value: metal },
        { label: "Amount", value: `${grams} g` },
        { label: "Recipient", value: recipientUserCode },
      ];
      if (giftRef) rows.push({ label: "Gift reference", value: giftRef });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Gift transfer",
            heading: `You sent ${grams}g ${metal}`,
            name,
            intro: `Your gift of ${grams}g ${metal} to ${recipientUserCode} has been sent successfully.`,
            callout: detailsCallout(rows),
            footnote: "The recipient can view the gift in their Simodi vault.",
          }),
        },
        push: {
          title: "Gift sent",
          body: `You sent ${grams}g ${metal} to ${recipientUserCode}.`,
          data: {
            type: "gift.sent",
            giftId: String(payload.giftId || ""),
            giftRef: giftRef || "",
          },
        },
      };
    }
    case "gift_received": {
      const metal = metalLabel(payload.metal);
      const grams = String(payload.gramsExact || payload.grams || "");
      const senderUserCode = payload.senderUserCode ? String(payload.senderUserCode) : "a Simodi user";
      const giftRef = sanitizeHumanReference(payload.giftRef);
      const title = "Simodi — Gift received";
      const rows = [
        { label: "Metal", value: metal },
        { label: "Amount", value: `${grams} g` },
        { label: "From", value: senderUserCode },
      ];
      if (giftRef) rows.push({ label: "Gift reference", value: giftRef });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Gift transfer",
            heading: `You received ${grams}g ${metal}`,
            name,
            intro: `You received ${grams}g ${metal} as a gift from ${senderUserCode}. It has been added to your vault.`,
            callout: detailsCallout(rows),
            footnote: "Open the Simodi app to view your updated holdings.",
          }),
        },
        push: {
          title: "Gift received",
          body: `You received ${grams}g ${metal} from ${senderUserCode}.`,
          data: {
            type: "gift.received",
            giftId: String(payload.giftId || ""),
            giftRef: giftRef || "",
          },
        },
      };
    }
    case "mart_order_confirmed": {
      const orderCode = payload.orderCode ? String(payload.orderCode) : "";
      const orderId = payload.orderId ? String(payload.orderId) : null;
      const isVaultStorage = payload.fulfillmentMode === "vault_storage";
      const title = "Simodi — Order confirmed";
      const rows = [];
      if (orderCode) rows.push({ label: "Order", value: orderCode });
      const attachments =
        isVaultStorage && orderId
          ? [
              {
                type: "mart_invoice",
                orderId,
                orderCode: orderCode || null,
                referenceCode: orderCode || null,
              },
              {
                type: "mart_certificate",
                orderId,
                orderCode: orderCode || null,
                referenceCode: orderCode || null,
              },
            ]
          : [];
      const intro = isVaultStorage
        ? `Thank you for your purchase. Your order ${orderCode} has been confirmed and your bars have been allocated to vault storage.`
        : `Thank you for your purchase. Your order ${orderCode} has been confirmed and is now being prepared.`;
      const footnote = isVaultStorage
        ? "Your sales invoice and ownership certificate are attached. You can view your stored bars anytime in the Simodi app."
        : "You can track your order status anytime in the Simodi app.";
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Order update",
            heading: isVaultStorage ? "Your order is stored in the vault" : "Your order is confirmed",
            name,
            intro,
            callout: detailsCallout(rows),
            footnote,
          }),
          attachments,
        },
        push: {
          title: isVaultStorage ? "Order stored in vault" : "Order confirmed",
          body: isVaultStorage
            ? orderCode
              ? `Order ${orderCode} is confirmed and stored in your vault.`
              : "Your order is confirmed and stored in your vault."
            : orderCode
              ? `Order ${orderCode} is confirmed and being prepared.`
              : "Your order is confirmed and being prepared.",
          data: { type: "mart.order.confirmed", orderId: orderId || "", orderCode },
        },
      };
    }
    case "mart_order_packed": {
      const orderCode = payload.orderCode ? String(payload.orderCode) : "";
      const title = "Simodi — Order packed";
      const rows = [];
      if (orderCode) rows.push({ label: "Order", value: orderCode });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Order update",
            heading: "Your order is packed",
            name,
            intro: `Good news — your order ${orderCode} has been packed and is ready to ship.`,
            callout: detailsCallout(rows),
            footnote: "We'll let you know as soon as it's on its way.",
          }),
        },
        push: {
          title: "Order packed",
          body: orderCode ? `Order ${orderCode} has been packed and is ready to ship.` : "Your order has been packed.",
          data: { type: "mart.order.packed", orderId: String(payload.orderId || ""), orderCode },
        },
      };
    }
    case "mart_order_shipped": {
      const orderCode = payload.orderCode ? String(payload.orderCode) : "";
      const courier = payload.courierName ? String(payload.courierName) : null;
      const tracking = payload.trackingNumber ? String(payload.trackingNumber) : null;
      const title = "Simodi — Order shipped";
      const rows = [];
      if (orderCode) rows.push({ label: "Order", value: orderCode });
      if (courier) rows.push({ label: "Courier", value: courier });
      if (tracking) rows.push({ label: "Tracking number", value: tracking });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Order update",
            heading: "Your order is on its way",
            name,
            intro: `Your order ${orderCode} has been shipped.`,
            callout: detailsCallout(rows),
            footnote: "Use the tracking details above to follow your delivery.",
          }),
        },
        push: {
          title: "Order shipped",
          body: tracking
            ? `Order ${orderCode} shipped${courier ? ` via ${courier}` : ""}. Tracking: ${tracking}.`
            : orderCode
              ? `Order ${orderCode} has been shipped.`
              : "Your order has been shipped.",
          data: {
            type: "mart.order.shipped",
            orderId: String(payload.orderId || ""),
            orderCode,
            courierName: courier || "",
            trackingNumber: tracking || "",
          },
        },
      };
    }
    case "mart_order_delivered": {
      const orderCode = payload.orderCode ? String(payload.orderCode) : "";
      const orderId = payload.orderId ? String(payload.orderId) : null;
      const title = "Simodi — Order delivered";
      const rows = [];
      if (orderCode) rows.push({ label: "Order", value: orderCode });
      const attachments = orderId
        ? [
            {
              type: "mart_invoice",
              orderId,
              orderCode: orderCode || null,
              referenceCode: orderCode || null,
            },
          ]
        : [];
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Order update",
            heading: "Your order has been delivered",
            name,
            intro: `Your order ${orderCode} has been delivered. We hope you love it.`,
            callout: detailsCallout(rows),
            footnote: "Your sales invoice is attached for your records. Thank you for shopping with Simodi.",
          }),
          attachments,
        },
        push: {
          title: "Order delivered",
          body: orderCode ? `Order ${orderCode} has been delivered.` : "Your order has been delivered.",
          data: { type: "mart.order.delivered", orderId: orderId || "", orderCode },
        },
      };
    }
    case "mart_order_cancelled": {
      const orderCode = payload.orderCode ? String(payload.orderCode) : "";
      const reason = payload.reason ? String(payload.reason) : null;
      const title = "Simodi — Order cancelled";
      const rows = [];
      if (orderCode) rows.push({ label: "Order", value: orderCode });
      if (reason) rows.push({ label: "Reason", value: reason });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Order update",
            heading: "Your order has been cancelled",
            name,
            intro: reason
              ? `Your order ${orderCode} has been cancelled: ${reason}.`
              : `Your order ${orderCode} has been cancelled.`,
            callout: detailsCallout(rows),
            footnote: "If you have any questions, our support team is here to help.",
          }),
        },
        push: {
          title: "Order cancelled",
          body: reason
            ? `Order ${orderCode} was cancelled: ${reason}.`
            : orderCode
              ? `Order ${orderCode} has been cancelled.`
              : "Your order has been cancelled.",
          data: { type: "mart.order.cancelled", orderId: String(payload.orderId || ""), orderCode },
        },
      };
    }
    case "admin_bank_verification_pending": {
      const title = "Simodi Admin — Bank verification pending";
      const rows = [
        { label: "Holder", value: String(payload.holderName || "—") },
        { label: "Bank", value: String(payload.bankName || "—") },
        { label: "Reference", value: String(payload.referenceCode || payload.bankVerificationId || "—") },
      ];
      return {
        email: adminOpsEmail({
          title,
          eyebrow: "Operations alert",
          heading: payload.resubmitted ? "Bank details resubmitted" : "New bank verification request",
          name,
          intro: "A customer bank account is awaiting your review in the admin panel.",
          rows,
          reviewUrl: payload.reviewUrl || null,
        }),
        push: null,
      };
    }
    case "admin_wallet_deposit_pending": {
      const title = "Simodi Admin — Deposit pending review";
      const amount =
        payload.amountMajor != null && payload.currency
          ? `${payload.currency} ${Number(payload.amountMajor).toFixed(2)}`
          : "—";
      const rows = [
        { label: "Reference", value: String(payload.referenceCode || payload.paymentId || "—") },
        { label: "Amount", value: amount },
      ];
      return {
        email: adminOpsEmail({
          title,
          eyebrow: "Operations alert",
          heading: "New wallet deposit request",
          name,
          intro: "A bank-transfer wallet deposit is awaiting admin approval.",
          rows,
          reviewUrl: payload.reviewUrl || null,
        }),
        push: null,
      };
    }
    case "admin_wallet_withdrawal_pending": {
      const title = "Simodi Admin — Withdrawal pending";
      const amount =
        payload.amountMajor != null && payload.currency
          ? `${payload.currency} ${Number(payload.amountMajor).toFixed(2)}`
          : "—";
      const rows = [
        { label: "Reference", value: String(payload.referenceCode || payload.withdrawalId || "—") },
        { label: "Amount", value: amount },
      ];
      return {
        email: adminOpsEmail({
          title,
          eyebrow: "Operations alert",
          heading: "New wallet withdrawal request",
          name,
          intro: "A customer withdrawal is awaiting payout processing in the admin panel.",
          rows,
          reviewUrl: payload.reviewUrl || null,
        }),
        push: null,
      };
    }
    case "admin_mart_order_new": {
      const title = "Simodi Admin — New mart order";
      const rows = [
        { label: "Order", value: String(payload.orderCode || "—") },
        {
          label: "Total",
          value:
            payload.totalMajor != null
              ? `${payload.currency || "AED"} ${Number(payload.totalMajor).toFixed(2)}`
              : "—",
        },
        { label: "Payment", value: String(payload.paymentMethod || "—") },
      ];
      return {
        email: adminOpsEmail({
          title,
          eyebrow: "Operations alert",
          heading: "New paid mart order",
          name,
          intro: "A new Simodi Mart order has been paid and is ready for fulfilment.",
          rows,
          reviewUrl: payload.reviewUrl || null,
        }),
        push: null,
      };
    }
    case "admin_push_broadcast": {
      const title = String(payload.title || "Simodi");
      const body = String(payload.body || "");
      const imageUrl = payload.imageUrl ? String(payload.imageUrl) : null;
      const actionRoute =
        payload.actionRoute != null
          ? String(payload.actionRoute)
          : payload.route != null
            ? String(payload.route)
            : payload.data?.action_route != null
              ? String(payload.data.action_route)
              : payload.data?.route != null
                ? String(payload.data.route)
                : "";
      const explicitCategory =
        payload.actionType != null
          ? String(payload.actionType)
          : payload.data?.action_type != null
            ? String(payload.data.action_type)
            : null;
      const resolvedAction = resolvePushActionFromRoute(actionRoute, explicitCategory);

      /** Mobile app contract: action_route + action_type + action_button (see FCM rich push). */
      const data = {
        type: "admin.push.broadcast",
        action_type: resolvedAction.actionType,
      };
      if (resolvedAction.actionRoute) data.action_route = resolvedAction.actionRoute;
      if (resolvedAction.actionButton) data.action_button = resolvedAction.actionButton;
      if (payload.data?.campaignId) data.campaignId = String(payload.data.campaignId);

      return {
        email: null,
        push: {
          title,
          body,
          data,
          imageUrl,
          actionRoute: resolvedAction.actionRoute,
          actionType: resolvedAction.actionType,
          actionButton: resolvedAction.actionButton,
          richCampaign: true,
        },
      };
    }
    default:
      throw new Error(`Unknown template: ${templateCode}`);
  }
}

module.exports = { EVENT_CHANNELS, renderTemplate };
