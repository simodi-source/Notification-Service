/**
 * Trade confirmation email — visual sibling of the Certificate of Investment PDF
 * (`certificate.service.js`) and the trade-confirmed design mockup.
 *
 * Layout (top → bottom):
 *   1. Full-width header image (hosted S3 URL)
 *   2. Gold body fill with headline + greeting
 *   3. Detail / Value table (dark header row)
 *   4. App note, disclaimer chip, sign-off, footer rule
 *
 * Email-client constraints: table layout, inline styles, solid gold fill
 * (no CSS gradients / background-image watermarks — unreliable in clients).
 */

/** Public S3 URL for the trade-confirmed header banner. */
const TRADE_HEADER_IMAGE_URL =
  "https://simodi-gold-bucket.s3.ap-south-1.amazonaws.com/uploads/profile_avatar/admin/6a3114a9c0774fb883089dc9/2cb3f5db-62bc-46e9-8363-64f70b9a5b38.png";

// Match certificate.service.js palette.
const COLOR_BODY = "#E1BD67";
const COLOR_TEXT = "#1f1a13";
const COLOR_MUTED = "#5a5040";
const COLOR_DISCLAIMER_BG = "#f5edd8";
const COLOR_TABLE_HEADER = "#1a1610";
const COLOR_ROW_BORDER = "#b89645";
const COLOR_FOOTER = "#6b634f";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatGrams(input) {
  const exact = input.gramsExact != null && input.gramsExact !== ""
    ? Number(input.gramsExact)
    : null;
  const fallback = toNumber(input.grams);
  const n = Number.isFinite(exact) ? exact : fallback;
  if (n === null) return "0.0000";
  return n.toFixed(4);
}

function formatMoney(amount, currency) {
  const n = toNumber(amount);
  if (n === null) return "";
  const fixed = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${fixed}`;
}

function formatDate(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "numeric",
    year: "numeric",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const day = get("day");
  const monthIdx = Math.max(0, Math.min(11, Number(get("month")) - 1));
  const year = get("year");
  return `${day} ${MONTHS_SHORT[monthIdx]} ${year}`;
}

function resolveCurrency(input) {
  if (input.quoteCurrency === "USD") return "USD";
  if (input.quoteCurrency === "AED") return "AED";
  return "AED";
}

function resolvePricePerGram(input, currency) {
  if (currency === "USD" && toNumber(input.priceUsdPerGramMajor) !== null) {
    return Number(input.priceUsdPerGramMajor);
  }
  if (toNumber(input.priceAedPerGramMajor) !== null) {
    return Number(input.priceAedPerGramMajor);
  }
  return null;
}

function resolveTotalMajor(input, currency) {
  if (currency === "USD" && toNumber(input.totalUsdMajor) !== null) {
    return Number(input.totalUsdMajor);
  }
  if (toNumber(input.totalAedMajor) !== null) {
    return Number(input.totalAedMajor);
  }
  return null;
}

/**
 * Treats Mongo ObjectId-shaped strings as missing so emails never leak an
 * internal id into the customer-visible trade reference row.
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeReferenceCode(value) {
  if (value === null || value === undefined) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  if (/^[a-f0-9]{24}$/i.test(trimmed)) return "";
  return trimmed;
}

/**
 * @param {string} headerSrc  cid: URL for send, or file/data URI for preview
 */
function headerHtml(headerSrc) {
  return `<img src="${escapeHtml(headerSrc)}" alt="SIMODI GOLD — Trade Confirmed" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;outline:none;text-decoration:none;margin:0;padding:0;vertical-align:bottom;" />`;
}

/**
 * @param {Array<{ label: string, value: string }>} rows
 */
function detailsTable(rows) {
  const body = rows
    .map(
      (r, i) => {
        const border = i < rows.length - 1
          ? `border-bottom:1px solid ${COLOR_ROW_BORDER};`
          : "";
        return `<tr>
          <td style="padding:11px 14px;font-size:13px;color:${COLOR_TEXT};${border}">${escapeHtml(r.label)}</td>
          <td style="padding:11px 14px;font-size:13px;font-weight:600;color:${COLOR_TEXT};text-align:right;${border}">${escapeHtml(r.value)}</td>
        </tr>`;
      },
    )
    .join("");

  return `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 22px;">
    <tr>
      <th align="left" style="background:${COLOR_TABLE_HEADER};color:#ffffff;font-size:12px;font-weight:600;letter-spacing:0.04em;padding:11px 14px;text-align:left;">Detail</th>
      <th align="right" style="background:${COLOR_TABLE_HEADER};color:#ffffff;font-size:12px;font-weight:600;letter-spacing:0.04em;padding:11px 14px;text-align:right;">Value</th>
    </tr>
    ${body}
  </table>`;
}

/**
 * @param {{
 *   name: string,
 *   isBuy: boolean,
 *   metal: "gold" | "silver" | string,
 *   side?: "buy" | "sell" | string,
 *   grams?: number,
 *   gramsExact?: string | number,
 *   quoteCurrency?: "AED" | "USD" | string,
 *   priceAedPerGramMajor?: number,
 *   priceUsdPerGramMajor?: number | null,
 *   totalAedMajor?: number,
 *   totalUsdMajor?: number | null,
 *   referenceCode?: string | null,
 *   executedAt?: string | Date,
 *   headerSrc?: string,
 * }} input
 * @returns {{ subject: string, html: string, text: string }}
 */
function buildTradeConfirmationEmail(input) {
  const metalKey = input.metal === "silver" ? "silver" : "gold";
  const metalLabel = metalKey === "silver" ? "Silver" : "Gold";
  const isBuy = input.isBuy !== false && input.side !== "sell";
  const sideLabel = isBuy ? "Bought" : "Sold";
  const grams = formatGrams(input);
  const currency = resolveCurrency(input);
  const unitPriceRaw = resolvePricePerGram(input, currency);
  const totalRaw = resolveTotalMajor(input, currency);
  const unitPrice = unitPriceRaw !== null
    ? `${formatMoney(unitPriceRaw, currency)} / g`
    : "";
  const total = totalRaw !== null ? formatMoney(totalRaw, currency) : "";
  const referenceCode = sanitizeReferenceCode(input.referenceCode);
  const tradeDate = formatDate(input.executedAt);
  const physicalMetal = `Physical ${metalLabel}`;
  const headline = `${sideLabel} ${grams}g ${physicalMetal}`;
  const subject = `Simodi — ${sideLabel} ${metalLabel}`;
  const introMetal = metalLabel.toLowerCase();
  const headerSrc = input.headerSrc || TRADE_HEADER_IMAGE_URL;

  const rows = [
    { label: "Side", value: sideLabel },
    { label: "Metal", value: metalLabel },
    { label: "Grams", value: `${grams} g` },
  ];
  if (unitPrice) rows.push({ label: "Unit price", value: unitPrice });
  if (total) rows.push({ label: "Total", value: total });
  if (referenceCode) rows.push({ label: "Trade reference", value: referenceCode });
  if (tradeDate) rows.push({ label: "Date", value: tradeDate });

  const appNote = isBuy
    ? "Your sales invoice and ownership certificate are attached to this email. You can also view this trade and your updated metal balance in the SIMODI app."
    : "Your purchase voucher is attached to this email. You can also view this trade and your updated metal balance in the SIMODI app.";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#ece6d8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLOR_TEXT};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ece6d8;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;width:100%;border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;">
          <!-- Header + body share one gold cell so no white gap under the image -->
          <tr>
            <td bgcolor="${COLOR_BODY}" style="background:${COLOR_BODY};padding:0;margin:0;border:0;">
              <div style="line-height:0;font-size:0;mso-line-height-rule:exactly;">
                ${headerHtml(headerSrc)}
              </div>
              <div style="padding:28px 28px 32px;font-size:15px;line-height:1.55;color:${COLOR_TEXT};">
              <p style="margin:0 0 18px;font-size:22px;font-weight:700;color:${COLOR_TEXT};line-height:1.3;">${escapeHtml(headline)}</p>
              <p style="margin:0 0 6px;font-size:15px;line-height:1.55;color:${COLOR_TEXT};">Hi ${escapeHtml(input.name)},</p>
              <p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:${COLOR_TEXT};">Your physical ${escapeHtml(introMetal)} trade has been executed successfully.</p>
              ${detailsTable(rows)}
              <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:${COLOR_MUTED};">${escapeHtml(appNote)}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:${COLOR_DISCLAIMER_BG};padding:12px 14px;font-size:11px;line-height:1.5;color:${COLOR_MUTED};">
                    Trade Confirmation Only. Not An Investment Product, Financial Security, Token, Deposit, Or Guarantee Of Profit.
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:${COLOR_TEXT};">Warm regards,<br /><strong>The SIMODI GOLD Team</strong></p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-top:1px solid ${COLOR_TABLE_HEADER};padding-top:14px;font-size:11px;line-height:1.5;color:${COLOR_FOOTER};text-align:center;">
                    Generated by SIMODI GOLD. This document is a transaction record only.
                  </td>
                </tr>
              </table>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines = [
    "TRADE CONFIRMED — Physical precious metal trade",
    "",
    headline,
    "",
    `Hi ${input.name},`,
    `Your physical ${introMetal} trade has been executed successfully.`,
    "",
    ...rows.map((r) => `${r.label}: ${r.value}`),
    "",
    appNote,
    "",
    "Trade Confirmation Only. Not An Investment Product, Financial Security, Token, Deposit, Or Guarantee Of Profit.",
    "",
    "Warm regards,",
    "The SIMODI GOLD Team",
    "",
    "Generated by SIMODI GOLD. This document is a transaction record only.",
  ];

  return {
    subject,
    html,
    text: textLines.join("\n"),
  };
}

module.exports = {
  buildTradeConfirmationEmail,
  TRADE_HEADER_IMAGE_URL,
  formatGrams,
  formatMoney,
  formatDate,
  sanitizeReferenceCode,
};
