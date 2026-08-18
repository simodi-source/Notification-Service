/**
 * Trade Sales Invoice / Purchase Voucher PDF (PDFKit).
 *
 * Buy  → Tax Invoice header + sales invoice copy
 * Sell → Purchase Voucher header + purchase voucher copy
 *
 * Header banners are the same S3 images used by the backend HTML invoice.
 */
const https = require("https");
const http = require("http");
const PDFDocument = require("pdfkit");

const INVOICE_HEADER_IMAGE_URL_TAX =
  "https://simodi-gold-bucket.s3.ap-south-1.amazonaws.com/uploads/profile_avatar/admin/6a3114a9c0774fb883089dc9/8c0fe08d-156a-4a22-a931-ca4929f53777.png";
const INVOICE_HEADER_IMAGE_URL_PURCHASE =
  "https://simodi-gold-bucket.s3.ap-south-1.amazonaws.com/uploads/profile_avatar/admin/6a3114a9c0774fb883089dc9/68a595af-8227-4fcb-91c2-1d4a4a5a3061.png";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const COLOR_BODY = "#E1BD67";
const COLOR_TEXT = "#1f1a13";
const COLOR_MUTED = "#5a5040";
const COLOR_TABLE_HEADER = "#0d0d0d";
const COLOR_ROW_BORDER = "#c9a84a";

const SUPPLIER = {
  name: "SIMODI GOLD FZCO",
  addressLines: [
    "Office # 1902, The Dome Tower,",
    "Jumeirah Lakes Towers, Al Thanyah Fifth, Dubai,",
    "United Arab Emirates",
  ],
  trn: "105256026300003",
};

const DISCLAIMER =
  "This Invoice Is Not An Investment Product, Financial Security, Deposit, E-Money, Virtual Asset, Token, Or Guarantee Of Profit.";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** @type {Map<string, Buffer>} */
const headerImageCache = new Map();

function fetchBuffer(url, redirectCount = 0) {
  if (redirectCount > 4) return Promise.reject(new Error("Too many redirects fetching invoice header"));
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
        reject(new Error(`Invoice header fetch failed (${res.statusCode})`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error("Invoice header fetch timed out"));
    });
  });
}

async function loadHeaderImage(url) {
  const cached = headerImageCache.get(url);
  if (cached) return cached;
  const buf = await fetchBuffer(url);
  headerImageCache.set(url, buf);
  return buf;
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
  if (n === null) return "0.000000";
  return n.toFixed(6);
}

function formatMoney(amount, currency) {
  const n = toNumber(amount);
  if (n === null) return "—";
  return `${currency} ${n.toFixed(2)}`;
}

function formatUnitPrice(amount) {
  const n = toNumber(amount);
  if (n === null) return "—";
  return n.toFixed(2);
}

function formatDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
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
  return `${day} ${MONTHS_SHORT[monthIdx].toUpperCase()} ${year}`;
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

function safeFilename(referenceCode, isPurchaseVoucher) {
  const cleaned = String(referenceCode || "trade").replace(/[^a-zA-Z0-9._-]/g, "_");
  const kind = isPurchaseVoucher ? "PurchaseVoucher" : "SalesInvoice";
  return `${kind}-${cleaned}.pdf`;
}

function drawMetaRight(doc, label, value, x, y, width) {
  const text = value || "—";
  doc.font("Helvetica-Bold").fontSize(8).fillColor(COLOR_MUTED);
  const labelW = doc.widthOfString(`${label} `);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(COLOR_TEXT);
  const valueW = doc.widthOfString(text);
  const start = x + width - labelW - valueW;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(COLOR_MUTED);
  doc.text(`${label} `, start, y + 2, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(COLOR_TEXT);
  doc.text(text, start + labelW, y, { lineBreak: false });
  return y + 16;
}

function flowText(doc, str, x, y, width, opts = {}) {
  const options = { width, lineGap: 1, ...opts };
  doc.text(str, x, y, options);
  return doc.y + (opts.gap ?? 4);
}

function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function drawTableCell(doc, str, x, y, w, h, align) {
  doc.text(String(str), x + 5, y + 8, {
    width: w - 10,
    height: h - 10,
    align,
    lineBreak: false,
    ellipsis: true,
  });
}

/**
 * @param {{
 *   side?: string,
 *   referenceCode?: string,
 *   metal?: string,
 *   grams?: number,
 *   gramsExact?: string,
 *   quoteCurrency?: string,
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
async function buildInvoicePdf(input) {
  const isPurchaseVoucher = input.side === "sell";
  const headerUrl = isPurchaseVoucher
    ? INVOICE_HEADER_IMAGE_URL_PURCHASE
    : INVOICE_HEADER_IMAGE_URL_TAX;
  const headerBuf = await loadHeaderImage(headerUrl);

  const metalLabel = input.metal === "silver" ? "Silver" : "Gold";
  const purity = input.metal === "silver" ? "999" : "24k";
  const description = isPurchaseVoucher
    ? `Physical ${metalLabel} Purchase (${purity})`
    : `Physical ${metalLabel} Sale (${purity})`;
  const note = isPurchaseVoucher
    ? "This invoice records a commercial purchase of physical precious metal."
    : "This invoice records a commercial sale of physical precious metal.";
  const dateLabel = isPurchaseVoucher ? "DATE OF PURCHASE:" : "DATE OF SALE:";
  const ref = sanitizeReferenceCode(input.referenceCode);
  const currency = resolveCurrency(input);
  const grams = formatGrams(input);
  const unitPrice = formatUnitPrice(resolvePricePerGram(input, currency));
  const total = formatMoney(resolveTotalMajor(input, currency), currency);
  const dateIssued = formatDate(input.executedAt);
  const customerName = String(input.customerName || "Customer").trim() || "Customer";
  const customerEmail = String(input.customerEmail || "").trim();
  const customerPhone = String(input.customerPhone || "").trim();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: isPurchaseVoucher ? `Purchase Voucher ${ref}` : `Sales Invoice ${ref}`,
        Author: "SIMODI GOLD",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.rect(0, 0, PAGE_W, PAGE_H).fill(COLOR_BODY);

    const png = pngSize(headerBuf);
    const headerH = png && png.width > 0
      ? (PAGE_W * png.height) / png.width
      : 150;
    try {
      doc.image(headerBuf, 0, 0, { width: PAGE_W, height: headerH });
    } catch {
      doc.rect(0, 0, PAGE_W, headerH).fill("#000000");
    }

    const pad = 28;
    const leftW = 340;
    const rightW = 200;
    const rightX = PAGE_W - pad - rightW;
    let y = headerH + 16;

    doc.font("Helvetica-Bold").fontSize(13).fillColor(COLOR_TEXT);
    y = flowText(doc, "Supplier", pad, y, leftW, { gap: 4 });
    doc.font("Helvetica-Bold").fontSize(11);
    y = flowText(doc, SUPPLIER.name, pad, y, leftW, { gap: 5 });
    doc.font("Helvetica").fontSize(9).fillColor(COLOR_MUTED);
    for (const line of SUPPLIER.addressLines) {
      doc.text(line, pad, y, { width: leftW, lineBreak: false });
      y += 13;
    }
    doc.text(`TRN: ${SUPPLIER.trn}`, pad, y, { width: leftW, lineBreak: false });
    y += 13;

    let ry = headerH + 16;
    ry = drawMetaRight(doc, "VOUCHER NO.:", ref || "—", rightX, ry, rightW);
    ry = drawMetaRight(doc, "TRANSACTION REF.:", ref || "—", rightX, ry, rightW);
    ry = drawMetaRight(doc, dateLabel, dateIssued || "—", rightX, ry, rightW);
    ry = drawMetaRight(doc, "PAYMENT STATUS:", "PAID", rightX, ry, rightW);

    y = Math.max(y, ry) + 18;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(COLOR_TEXT);
    y = flowText(doc, "Customer", pad, y, leftW, { gap: 6 });
    doc.font("Helvetica-Bold").fontSize(11);
    y = flowText(doc, customerName, pad, y, leftW, { gap: 4 });
    doc.font("Helvetica").fontSize(9).fillColor(COLOR_MUTED);
    if (customerEmail) y = flowText(doc, customerEmail, pad, y, leftW, { gap: 2 });
    if (customerPhone) y = flowText(doc, customerPhone, pad, y, leftW, { gap: 2 });

    y += 16;
    const tableX = pad;
    const tableW = PAGE_W - pad * 2;
    const colWs = [32, 148, 68, 100, 42, 0];
    colWs[5] = tableW - colWs.slice(0, 5).reduce((a, b) => a + b, 0);
    const colAlign = ["center", "left", "center", "right", "center", "right"];
    const headers = [
      "Item",
      "Description",
      "Qty (g)",
      `Unit Price (${currency})`,
      "VAT",
      `Total (${currency})`,
    ];
    const headH = 26;
    const rowH = 28;

    doc.rect(tableX, y, tableW, headH).fill(COLOR_TABLE_HEADER);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#ffffff");
    let cx = tableX;
    headers.forEach((h, i) => {
      drawTableCell(doc, h, cx, y, colWs[i], headH, colAlign[i]);
      cx += colWs[i];
    });

    y += headH;
    const values = ["1", description, `${grams} g`, unitPrice, "-", total];
    doc.font("Helvetica").fontSize(8).fillColor(COLOR_TEXT);
    cx = tableX;
    values.forEach((v, i) => {
      drawTableCell(doc, v, cx, y, colWs[i], rowH, colAlign[i]);
      cx += colWs[i];
    });
    doc
      .moveTo(tableX, y + rowH)
      .lineTo(tableX + tableW, y + rowH)
      .strokeColor(COLOR_ROW_BORDER)
      .lineWidth(0.6)
      .stroke();

    y += rowH + 12;
    const totalsW = 230;
    const totalsX = PAGE_W - pad - totalsW;
    const drawTotalRow = (label, value, emphasize) => {
      const h = emphasize ? 26 : 20;
      if (emphasize) {
        doc.rect(totalsX, y, totalsW, h).fill(COLOR_TABLE_HEADER);
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff");
      } else {
        doc.font("Helvetica").fontSize(9).fillColor(COLOR_TEXT);
      }
      doc.text(label, totalsX + 10, y + 6, { width: 90, lineBreak: false });
      doc.font("Helvetica-Bold").text(value, totalsX + 100, y + 6, {
        width: totalsW - 112,
        align: "right",
        lineBreak: false,
      });
      y += h;
    };
    drawTotalRow("Sub Total", total, false);
    drawTotalRow("VAT", "-", false);
    drawTotalRow("TOTAL", total, true);

    y += 20;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLOR_TEXT);
    const noteLabel = "Note  ";
    const noteLabelW = doc.widthOfString(noteLabel);
    doc.text(noteLabel, pad, y, { lineBreak: false });
    doc.font("Helvetica").fillColor(COLOR_MUTED).text(note, pad + noteLabelW, y, {
      width: PAGE_W - pad * 2 - noteLabelW,
    });
    y = doc.y + 16;

    const boxX = pad + 36;
    const boxW = PAGE_W - pad * 2 - 72;
    const boxH = 44;
    doc.save();
    doc.rect(boxX, y, boxW, boxH).fill("#ffffff");
    doc.rect(boxX, y, boxW, boxH).lineWidth(0.8).strokeColor("#d0d0d0").stroke();
    doc.restore();
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(COLOR_MUTED)
      .text(DISCLAIMER, boxX + 12, y + 12, { width: boxW - 24, align: "center" });

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(COLOR_MUTED)
      .text(
        "Generated by SIMODI GOLD. This document is a transaction record only.",
        pad,
        PAGE_H - 28,
        { width: PAGE_W - pad * 2, align: "center" },
      );

    doc.end();
  });
}

module.exports = {
  buildInvoicePdf,
  safeFilename,
  INVOICE_HEADER_IMAGE_URL_TAX,
  INVOICE_HEADER_IMAGE_URL_PURCHASE,
};
