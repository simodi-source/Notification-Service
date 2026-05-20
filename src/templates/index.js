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

function otpEmailHtml({ recipientName, otpCode, title, intro }) {
  const name = escapeHtml(recipientName || "there");
  const code = escapeHtml(otpCode);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:32px 16px;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#242424;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;">
    <tr>
      <td style="background:#ffffff;border-left:4px solid #B8941E;padding:32px 36px 36px;">
        ${logoBlock()}
        <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.06em;">Login verification</p>
        <p style="margin:0 0 28px;font-size:20px;font-weight:600;color:#111;line-height:1.3;">Your one-time code</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.65;">Hi ${name},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.65;">${escapeHtml(intro)}</p>
        <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;width:100%;">
          <tr>
            <td style="background:#f7f7f7;border:1px dashed #d0d0d0;padding:16px 20px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:0.04em;">Your OTP Code</p>
              <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:0.35em;font-family:ui-monospace,Consolas,monospace;color:#111;">${code}</p>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 28px;font-size:14px;line-height:1.65;color:#555;">
          This OTP is valid for ${OTP_EXPIRY_MINUTES} minutes. If you did not request this, please ignore this email.
        </p>
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
  const name = user?.firstName?.trim() || "there";

  switch (templateCode) {
    case "auth_otp":
      return {
        email: {
          subject: "Simodi — Login OTP",
          html: otpEmailHtml({
            recipientName: payload.recipientName || name,
            otpCode: payload.otpCode,
            title: "Simodi — Login OTP",
            intro: "We received a login request for your Simodi account. Please use the code below:",
          }),
        },
        push: null,
      };
    case "auth_password_reset":
      return {
        email: {
          subject: "Simodi — Password reset OTP",
          html: otpEmailHtml({
            recipientName: payload.recipientName || name,
            otpCode: payload.otpCode,
            title: "Simodi — Password reset",
            intro: "We received a password reset request. Please use the code below:",
          }),
        },
        push: null,
      };
    case "kyc_approved":
      return {
        email: {
          subject: "Simodi — Identity verification approved",
          html: simpleEmail(name, "Your identity verification has been approved. You can now use all Simodi features."),
        },
        push: {
          title: "KYC approved",
          body: "Your identity verification is complete.",
          data: { type: "kyc.approved" },
        },
      };
    case "kyc_rejected":
      return {
        email: {
          subject: "Simodi — Identity verification update",
          html: simpleEmail(
            name,
            "We could not approve your identity verification. Please open the app and try again or contact support.",
          ),
        },
        push: {
          title: "KYC update required",
          body: "Please review your identity verification in the app.",
          data: { type: "kyc.rejected" },
        },
      };
    case "trade_executed": {
      const metal = payload.metal === "silver" ? "Silver" : "Gold";
      const side = payload.side === "sell" ? "sold" : "bought";
      const grams = payload.gramsExact || payload.grams;
      const summary = `You ${side} ${grams}g ${metal}.`;
      return {
        email: {
          subject: `Simodi — Trade ${side}`,
          html: simpleEmail(name, `Your trade has been executed. ${summary}`),
        },
        push: {
          title: "Trade executed",
          body: summary,
          data: { type: "trade.executed", tradeId: payload.tradeId },
        },
      };
    }
    case "wallet_deposit_approved":
      return {
        email: {
          subject: "Simodi — Deposit approved",
          html: simpleEmail(name, "Your wallet deposit has been approved and credited to your account."),
        },
        push: {
          title: "Deposit approved",
          body: "Your wallet deposit has been credited.",
          data: { type: "wallet.deposit_approved", paymentId: payload.paymentId },
        },
      };
    default:
      throw new Error(`Unknown template: ${templateCode}`);
  }
}

function simpleEmail(name, body) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;">
    <p>Hi ${escapeHtml(name)},</p>
    <p>${escapeHtml(body)}</p>
    <p>Warm Regards,<br/><strong>The Simodi Team</strong></p>
  </body></html>`;
}

module.exports = { EVENT_CHANNELS, renderTemplate };
