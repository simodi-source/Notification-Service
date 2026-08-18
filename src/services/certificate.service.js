/**
 * Gold / Silver Ownership Certificate PDF (PDFKit).
 *
 * Layout matches the Simodi GOLD ownership certificate design:
 *   gold page border, centered logo, title block, certificate info bar,
 *   certified owner, ownership detail grid, confirmation + authentication,
 *   legal footer.
 */
const https = require("https");
const http = require("http");
const PDFDocument = require("pdfkit");

const CERTIFICATE_LOGO_URL =
  "https://simodi-gold-bucket.s3.ap-south-1.amazonaws.com/uploads/profile_avatar/admin/6a3114a9c0774fb883089dc9/8be3ddef-d1dc-4ca2-ae82-b01c242ce6bf.png";
const CERTIFICATE_WATERMARK_URL =
  "https://simodi-gold-bucket.s3.ap-south-1.amazonaws.com/uploads/profile_avatar/admin/6a3114a9c0774fb883089dc9/2d5ea3bf-6857-4fd8-b1f2-d1005bc14980.png";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 22;
const BORDER_INSET = 14;

const COLOR_GOLD = "#B8941E";
const COLOR_GOLD_LIGHT = "#E8D5A3";
const COLOR_GOLD_FILL = "#FBF6EA";
const COLOR_TEXT = "#1a1a1a";
const COLOR_MUTED = "#666666";

const MONTHS_FULL = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

const METAL_LABEL = { gold: "Gold", silver: "Silver" };
const PURITY_LABEL = { gold: ".999 fine", silver: ".999 fine" };

/** @type {Map<string, Buffer>} */
const imageCache = new Map();

function assertCertificateAssets() {
  // Assets are fetched from S3 at render time; no local files required.
}

function fetchBuffer(url, redirectCount = 0) {
  if (redirectCount > 4) return Promise.reject(new Error("Too many redirects fetching certificate asset"));
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("http://") ? http : https;
    const req = lib.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchBuffer(res.headers.location, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume();
        reject(new Error(`Certificate asset fetch failed (${res.statusCode})`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error("Certificate asset fetch timed out"));
    });
  });
}

async function loadImage(url) {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const buf = await fetchBuffer(url);
  imageCache.set(url, buf);
  return buf;
}

function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatGrams(input) {
  const exact = input.gramsExact ? Number(input.gramsExact) : null;
  const fallback = toNumber(input.grams);
  const n = Number.isFinite(exact) ? exact : fallback;
  if (n === null) return "0.000";
  return n.toFixed(3);
}

function formatMoney(amount, currency) {
  const n = toNumber(amount);
  if (n === null) return "—";
  const fixed = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${fixed}`;
}

function formatDateLong(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dubai",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const day = get("day");
  const monthIdx = Math.max(0, Math.min(11, Number(get("month")) - 1));
  const year = get("year");
  return `${day} ${MONTHS_FULL[monthIdx]} ${year}`;
}

function formatDateCompact(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}

function resolveCurrency(input) {
  if (input.quoteCurrency === "USD") return "USD";
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

function sanitizeReferenceCode(value) {
  if (value === null || value === undefined) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  if (/^[a-f0-9]{24}$/i.test(trimmed)) return "";
  return trimmed;
}

function buildCertificateNo(input) {
  const ref = sanitizeReferenceCode(input.referenceCode);
  if (ref) return ref;
  const grams = formatGrams(input).replace(".", "");
  return `SG-${formatDateCompact(input.executedAt)}-${grams}G`;
}

function safeFilename(referenceCode) {
  const cleaned = String(referenceCode || "trade").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `Simodi-Ownership-Certificate-${cleaned}.pdf`;
}

function drawGoldBorder(doc, x, y, w, h) {
  doc.save();
  doc.rect(x, y, w, h).lineWidth(2).strokeColor(COLOR_GOLD).stroke();
  doc.restore();
}

function drawLabel(doc, text, x, y, width, align = "left") {
  doc.font("Helvetica-Bold").fontSize(7).fillColor(COLOR_GOLD).text(text, x, y, {
    width,
    align,
    characterSpacing: 0.8,
  });
}

function drawValue(doc, text, x, y, width, opts = {}) {
  doc
    .font(opts.bold === false ? "Helvetica" : "Helvetica-Bold")
    .fontSize(opts.size || 11)
    .fillColor(opts.color || COLOR_TEXT)
    .text(text, x, y, { width, align: opts.align || "left", lineBreak: false });
}

function drawDetailBox(doc, x, y, w, h, label, value, valueOpts = {}) {
  doc.save();
  doc.roundedRect(x, y, w, h, 6).lineWidth(0.8).strokeColor("#D8D8D8").stroke();
  drawLabel(doc, label, x + 10, y + 10, w - 20);
  drawValue(doc, value, x + 10, y + 24, w - 20, valueOpts);
  doc.restore();
}

function drawAuthBox(doc, x, y, w, h, label, value) {
  doc.save();
  doc.roundedRect(x, y, w, h, 4).lineWidth(0.8).strokeColor("#D0D0D0").stroke();
  drawLabel(doc, label, x + 8, y + 8, w - 16, "center");
  const display = value && String(value).trim() ? String(value) : "…………………………";
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLOR_TEXT)
    .text(display, x + 8, y + 24, { width: w - 16, align: "center", lineBreak: false });
  doc.restore();
}

/**
 * @param {{
 *   referenceCode?: string,
 *   tradeId?: string,
 *   metal: "gold" | "silver",
 *   grams?: number,
 *   gramsExact?: string,
 *   quoteCurrency?: "AED" | "USD",
 *   priceAedPerGramMajor?: number,
 *   priceUsdPerGramMajor?: number | null,
 *   totalAedMajor?: number,
 *   totalUsdMajor?: number | null,
 *   executedAt?: string | Date,
 *   customerName?: string,
 *   customerEmail?: string,
 *   customerPhone?: string,
 * }} input
 * @returns {Promise<Buffer>}
 */
async function buildCertificatePdf(input) {
  const [logoBuf, watermarkBuf] = await Promise.all([
    loadImage(CERTIFICATE_LOGO_URL),
    loadImage(CERTIFICATE_WATERMARK_URL),
  ]);

  const metalKey = input.metal === "silver" ? "silver" : "gold";
  const metalLabel = METAL_LABEL[metalKey];
  const titleMetal = metalLabel.toUpperCase();
  const grams = formatGrams(input);
  const currency = resolveCurrency(input);
  const pricePerGram = formatMoney(resolvePricePerGram(input, currency), currency);
  const totalPaid = formatMoney(resolveTotalMajor(input, currency), currency);
  const certificateNo = buildCertificateNo(input);
  const transactionRef = sanitizeReferenceCode(input.referenceCode) || certificateNo;
  const dateLong = formatDateLong(input.executedAt);
  const ownerName = String(input.customerName || "Customer").trim() || "Customer";
  const ownerEmail = String(input.customerEmail || "").trim() || "Not provided";
  const ownerPhone = String(input.customerPhone || "").trim() || "Not provided";

  const confirmationText =
    `This certifies that ${ownerName} has purchased and owns ${grams} grams of ${metalLabel.toLowerCase()} ` +
    `(purity ${PURITY_LABEL[metalKey]}) through SIMODI GOLD. The metal is held in pooled third-party custody ` +
    "and represents an undivided beneficial interest in the underlying physical commodity.";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: `${titleMetal} Ownership Certificate ${certificateNo}`,
        Author: "SIMODI GOLD",
        Subject: "Gold Ownership Certificate",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.rect(0, 0, PAGE_W, PAGE_H).fill("#ffffff");

    const frameX = MARGIN;
    const frameY = MARGIN;
    const frameW = PAGE_W - MARGIN * 2;
    const frameH = PAGE_H - MARGIN * 2;
    drawGoldBorder(doc, frameX, frameY, frameW, frameH);

    const contentX = frameX + BORDER_INSET;
    const contentY = frameY + BORDER_INSET;
    const contentW = frameW - BORDER_INSET * 2;

    doc.save();
    doc.opacity(0.12);
    const wmSize = pngSize(watermarkBuf);
    const wmW = 260;
    const wmH = wmSize && wmSize.width > 0 ? (wmW * wmSize.height) / wmSize.width : wmW;
    try {
      doc.image(watermarkBuf, contentX - 40, contentY - 20, { width: wmW, height: wmH });
    } catch {
      // Watermark is decorative; continue without it.
    }
    doc.restore();

    const logoSize = pngSize(logoBuf);
    const logoW = 120;
    const logoH = logoSize && logoSize.width > 0 ? (logoW * logoSize.height) / logoSize.width : 48;
    let y = contentY + 8;
    try {
      doc.image(logoBuf, contentX + (contentW - logoW) / 2, y, { width: logoW, height: logoH });
    } catch {
      doc.font("Helvetica-Bold").fontSize(16).fillColor(COLOR_GOLD).text("SIMODI GOLD", contentX, y, {
        width: contentW,
        align: "center",
      });
    }
    y += logoH + 14;

    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor(COLOR_TEXT)
      .text(`${titleMetal} OWNERSHIP CERTIFICATE`, contentX, y, {
        width: contentW,
        align: "center",
        characterSpacing: 1,
      });
    y += 24;
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(COLOR_GOLD)
      .text("PHYSICAL COMMODITY PURCHASE AND CUSTODY RECORD", contentX, y, {
        width: contentW,
        align: "center",
        characterSpacing: 1.2,
      });
    y += 22;

    const infoH = 34;
    doc.save();
    doc.roundedRect(contentX, y, contentW, infoH, 4).fill(COLOR_GOLD_FILL);
    doc.roundedRect(contentX, y, contentW, infoH, 4).lineWidth(0.8).strokeColor(COLOR_GOLD_LIGHT).stroke();
    doc.restore();
    drawLabel(doc, "CERTIFICATE NO.", contentX + 16, y + 8, contentW / 2 - 24);
    drawValue(doc, certificateNo, contentX + 16, y + 18, contentW / 2 - 24, { size: 10 });
    drawLabel(doc, "DATE", contentX + contentW / 2 + 8, y + 8, contentW / 2 - 24, "right");
    drawValue(doc, dateLong, contentX + contentW / 2 + 8, y + 18, contentW / 2 - 24, {
      size: 10,
      align: "right",
    });
    y += infoH + 18;

    drawLabel(doc, "CERTIFIED OWNER", contentX, y, contentW);
    y += 14;
    drawValue(doc, ownerName, contentX, y, contentW * 0.55, { size: 14 });
    drawLabel(doc, "PHONE NUMBER", contentX + contentW * 0.55, y - 2, contentW * 0.45, "right");
    drawValue(doc, ownerPhone, contentX + contentW * 0.55, y + 10, contentW * 0.45, {
      size: 10,
      align: "right",
    });
    y += 22;
    doc.font("Helvetica").fontSize(9).fillColor(COLOR_MUTED).text(ownerEmail, contentX, y, {
      width: contentW * 0.6,
    });
    y += 24;

    const gap = 10;
    const boxW = (contentW - gap * 2) / 3;
    const boxH = 52;
    const row1Y = y;
    drawDetailBox(doc, contentX, row1Y, boxW, boxH, "METAL", metalLabel);
    drawDetailBox(doc, contentX + boxW + gap, row1Y, boxW, boxH, "PURITY", PURITY_LABEL[metalKey]);
    drawDetailBox(doc, contentX + (boxW + gap) * 2, row1Y, boxW, boxH, "WEIGHT OWNED", `${grams} grams`, {
      color: COLOR_GOLD,
      size: 12,
    });

    const row2Y = row1Y + boxH + gap;
    drawDetailBox(doc, contentX, row2Y, boxW, boxH, "PRICE PER GRAM", pricePerGram);
    drawDetailBox(doc, contentX + boxW + gap, row2Y, boxW, boxH, "TOTAL PAID", totalPaid);
    drawDetailBox(doc, contentX + (boxW + gap) * 2, row2Y, boxW, boxH, "STORAGE", "Pooled custody");
    y = row2Y + boxH + 16;

    const confirmH = 78;
    doc.save();
    doc.roundedRect(contentX, y, contentW, confirmH, 4).lineWidth(1).strokeColor(COLOR_GOLD).stroke();
    doc.restore();
    drawLabel(doc, "OWNERSHIP CONFIRMATION", contentX + 12, y + 10, contentW - 24);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(COLOR_TEXT)
      .text(confirmationText, contentX + 12, y + 24, {
        width: contentW - 24,
        lineGap: 2,
      });
    y += confirmH + 16;

    drawLabel(doc, "AUTHENTICATION", contentX, y, contentW);
    y += 12;
    const authW = (contentW - gap * 2) / 3;
    const authH = 52;
    drawAuthBox(doc, contentX, y, authW, authH, "TRANSACTION REFERENCE", transactionRef);
    drawAuthBox(doc, contentX + authW + gap, y, authW, authH, "VERIFICATION REFERENCE / QR", transactionRef);
    drawAuthBox(doc, contentX + (authW + gap) * 2, y, authW, authH, "AUTHORIZED SIGNATURE", "Digitally signed by SIMODI GOLD");
    y += authH + 18;

    const footerY = frameY + frameH - BORDER_INSET - 52;
    doc
      .font("Helvetica")
      .fontSize(6.5)
      .fillColor(COLOR_MUTED)
      .text(
        "SIMODI GOLD FZCO is a DMCC-licensed precious-metals trader and is not acting as an investment fund or investment manager. This certificate records ownership of physical gold; it is not a security, deposit, managed investment or guarantee of value. Issued solely by SIMODI GOLD FZCO and not issued, approved or guaranteed by DMCC or any UAE financial regulator. Subject to the SIMODI GOLD Customer Agreement.",
        contentX,
        footerY,
        { width: contentW, align: "center", lineGap: 1 },
      );

    const bottomY = frameY + frameH - BORDER_INSET - 18;
    doc.font("Helvetica").fontSize(7).fillColor(COLOR_MUTED);
    doc.text("SIMODI GOLD FZCO | Dubai, United Arab Emirates", contentX, bottomY, {
      width: contentW / 2,
      align: "left",
    });
    doc.text("info@simodigold.com | www.simodigold.com", contentX + contentW / 2, bottomY, {
      width: contentW / 2,
      align: "right",
    });

    doc.end();
  });
}

module.exports = {
  buildCertificatePdf,
  safeFilename,
  assertCertificateAssets,
  CERTIFICATE_LOGO_URL,
  CERTIFICATE_WATERMARK_URL,
};
