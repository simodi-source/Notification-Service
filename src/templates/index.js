const { env } = require("../config/env");

const OTP_EXPIRY_MINUTES = 5;

/** Default channels per event when job.channels is omitted. */
const EVENT_CHANNELS = {
  "auth.otp": ["email"],
  "auth.password_reset": ["email"],
  "wallet.withdrawal_otp": ["email"],
  "kyc.approved": ["email", "push"],
  "kyc.rejected": ["email", "push"],
  "trade.executed": ["email", "push"],
  "wallet.deposit_approved": ["email", "push"],
  "mart.order.confirmed": ["email", "push"],
  "mart.order.packed": ["email", "push"],
  "mart.order.shipped": ["email", "push"],
  "mart.order.delivered": ["email", "push"],
  "mart.order.cancelled": ["email", "push"],
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

function logoBlock() {
  const logoUrl = env.MAIL_BRAND_LOGO_URL;
  if (logoUrl) {
    return `<img src="${escapeHtml(logoUrl)}" alt="Simodi" width="120" style="display:block;margin:0 0 20px;" />`;
  }
  return `<p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#1a1a1a;letter-spacing:-0.02em;">
         <span style="color:#B8941E;">Simodi</span>
       </p>`;
}

function otpCallout(code) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;width:100%;">
    <tr>
      <td style="background:#f7f7f7;border:1px dashed #d0d0d0;padding:16px 20px;text-align:center;">
        <p style="margin:0 0 6px;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:0.04em;">Your OTP Code</p>
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(params.title)}</title>
</head>
<body style="margin:0;padding:32px 16px;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#242424;">
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

/**
 * @param {string} templateCode
 * @param {Record<string, unknown>} payload
 * @param {{ firstName?: string }} user
 */
function renderTemplate(templateCode, payload, user) {
  const name = (payload.recipientName && String(payload.recipientName).trim()) || user?.firstName?.trim() || "there";

  switch (templateCode) {
    case "auth_otp": {
      const title = "Simodi — Login OTP";
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Login verification",
            heading: "Your one-time code",
            name,
            intro: "We received a login request for your Simodi account. Use the code below to continue.",
            callout: otpCallout(String(payload.otpCode || "")),
            footnote: `This code is valid for ${OTP_EXPIRY_MINUTES} minutes. If you did not request this, please ignore this email.`,
          }),
        },
        push: null,
      };
    }
    case "auth_password_reset": {
      const title = "Simodi — Password reset request";
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Password reset",
            heading: "Reset your Simodi password",
            name,
            intro:
              "We received a request to reset the password on your Simodi account. Enter the verification code below in the app to set a new password.",
            callout: otpCallout(String(payload.otpCode || "")),
            paragraphs: [
              `This code expires in ${OTP_EXPIRY_MINUTES} minutes and can be used only once.`,
            ],
            footnote:
              "If you did not request a password reset, you can safely ignore this email — your password will remain unchanged. For your security, never share this code with anyone, including Simodi staff.",
          }),
        },
        push: null,
      };
    }
    case "wallet_withdrawal_otp": {
      const title = "Simodi — Withdrawal verification";
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Withdrawal verification",
            heading: "Confirm your withdrawal request",
            name,
            intro:
              "We received a request to withdraw funds from your Simodi wallet. Enter the verification code below in the app to submit your withdrawal.",
            callout: otpCallout(String(payload.otpCode || "")),
            paragraphs: [
              `This code expires in ${OTP_EXPIRY_MINUTES} minutes and can be used only once.`,
            ],
            footnote:
              "If you did not request a withdrawal, please ignore this email and contact our support team immediately. Never share this code with anyone, including Simodi staff.",
          }),
        },
        push: null,
      };
    }
    case "kyc_approved": {
      const title = "Simodi — Identity verification approved";
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "KYC update",
            heading: "Your identity has been verified",
            name,
            intro:
              "Your identity verification has been approved. You now have full access to deposits, withdrawals, and trading on Simodi.",
            footnote: "Open the Simodi app to start trading gold and silver.",
          }),
        },
        push: {
          title: "Identity verified",
          body: "Your KYC is complete. You can now trade and withdraw.",
          data: { type: "kyc.approved" },
        },
      };
    }
    case "kyc_rejected": {
      const title = "Simodi — Identity verification update";
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "KYC update",
            heading: "Action required on your verification",
            name,
            intro:
              "We were unable to approve your identity verification at this time.",
            paragraphs: [
              "Please open the Simodi app and retry the verification, making sure your documents are clear and your selfie is well lit. If you need help, our support team is available.",
            ],
            footnote: "Until verification is complete, deposits and trading remain limited.",
          }),
        },
        push: {
          title: "KYC update required",
          body: "Please retry identity verification in the app.",
          data: { type: "kyc.rejected" },
        },
      };
    }
    case "trade_executed": {
      const metal = payload.metal === "silver" ? "Silver" : "Gold";
      const isBuy = payload.side !== "sell";
      const side = isBuy ? "Bought" : "Sold";
      const grams = String(payload.gramsExact || payload.grams || "");
      const pushSummary = `You ${side.toLowerCase()} ${grams}g ${metal}.`;
      const title = `Simodi — ${side} ${metal}`;
      // Reference label for the EMAIL body only — never fall back to the Mongo
      // ObjectId here. The certificate's reference code is a separate field;
      // see attachments below, where we forward `referenceCode` untouched so
      // the worker's enrichment step can hydrate it from Mongo when missing.
      const humanReferenceCode = sanitizeHumanReference(payload.referenceCode);
      const rows = [
        { label: "Side", value: side },
        { label: "Metal", value: metal },
        { label: "Grams", value: `${grams} g` },
      ];
      if (humanReferenceCode) rows.push({ label: "Trade reference", value: humanReferenceCode });

      const footnote = isBuy
        ? "Your investment certificate is attached to this email. You can also view this trade and your updated holdings in the Simodi app."
        : "You can view this trade and your updated holdings in the Simodi app.";

      // Buy-side trades ship with a Certificate of Investment PDF the worker
      // renders just before dispatch (so the rendered file isn't kept in Redis).
      // We pass the raw tradeId so the worker can look the order up in Mongo
      // when the producing backend hasn't sent the enriched fields.
      const attachments = isBuy
        ? [
            {
              type: "trade_certificate",
              referenceCode: humanReferenceCode || null,
              tradeId: payload.tradeId ? String(payload.tradeId) : null,
              metal: payload.metal,
              grams: payload.grams,
              gramsExact: payload.gramsExact,
              quoteCurrency: payload.quoteCurrency,
              priceAedPerGramMajor: payload.priceAedPerGramMajor,
              priceUsdPerGramMajor: payload.priceUsdPerGramMajor,
              totalAedMajor: payload.totalAedMajor,
              totalUsdMajor: payload.totalUsdMajor,
              executedAt: payload.executedAt,
            },
          ]
        : [];

      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Trade confirmed",
            heading: `${side} ${grams}g ${metal}`,
            name,
            intro: "Your trade has been executed successfully. Here are the details:",
            callout: detailsCallout(rows),
            footnote,
          }),
          attachments,
        },
        push: {
          title: "Trade executed",
          body: pushSummary,
          data: { type: "trade.executed", tradeId: String(payload.tradeId || "") },
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
    case "mart_order_confirmed": {
      const orderCode = payload.orderCode ? String(payload.orderCode) : "";
      const title = "Simodi — Order confirmed";
      const rows = [];
      if (orderCode) rows.push({ label: "Order", value: orderCode });
      return {
        email: {
          subject: title,
          html: brandedEmail({
            title,
            eyebrow: "Order update",
            heading: "Your order is confirmed",
            name,
            intro: `Thank you for your purchase. Your order ${orderCode} has been confirmed and is now being prepared.`,
            callout: detailsCallout(rows),
            footnote: "You can track your order status anytime in the Simodi app.",
          }),
        },
        push: {
          title: "Order confirmed",
          body: orderCode ? `Order ${orderCode} is confirmed and being prepared.` : "Your order is confirmed and being prepared.",
          data: { type: "mart.order.confirmed", orderId: String(payload.orderId || ""), orderCode },
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
      const title = "Simodi — Order delivered";
      const rows = [];
      if (orderCode) rows.push({ label: "Order", value: orderCode });
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
            footnote: "Thank you for shopping with Simodi.",
          }),
        },
        push: {
          title: "Order delivered",
          body: orderCode ? `Order ${orderCode} has been delivered.` : "Your order has been delivered.",
          data: { type: "mart.order.delivered", orderId: String(payload.orderId || ""), orderCode },
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
    default:
      throw new Error(`Unknown template: ${templateCode}`);
  }
}

module.exports = { EVENT_CHANNELS, renderTemplate };
