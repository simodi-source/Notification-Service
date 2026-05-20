const { env } = require("../config/env");

const OTP_EXPIRY_MINUTES = 5;

/** Default channels per event when job.channels is omitted. */
const EVENT_CHANNELS = {
  "auth.otp": ["email"],
  "auth.password_reset": ["email"],
  "kyc.approved": ["email", "push"],
  "kyc.rejected": ["email", "push"],
  "trade.executed": ["email", "push"],
  "wallet.deposit_approved": ["email", "push"],
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
      const side = payload.side === "sell" ? "Sold" : "Bought";
      const grams = String(payload.gramsExact || payload.grams || "");
      const pushSummary = `You ${side.toLowerCase()} ${grams}g ${metal}.`;
      const title = `Simodi — ${side} ${metal}`;
      const rows = [
        { label: "Side", value: side },
        { label: "Metal", value: metal },
        { label: "Grams", value: `${grams} g` },
      ];
      if (payload.tradeId) rows.push({ label: "Trade reference", value: String(payload.tradeId) });
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
            footnote: "You can view this trade and your updated holdings in the Simodi app.",
          }),
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
    default:
      throw new Error(`Unknown template: ${templateCode}`);
  }
}

module.exports = { EVENT_CHANNELS, renderTemplate };
