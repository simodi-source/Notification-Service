/**
 * Certificate of Investment PDF generator.
 *
 * Builds a single-page A4 certificate using PDFKit (no Chromium needed).
 *
 * Layout (top → bottom):
 *   1. Full-width header strip (Simodi Gold logo on black with gold wave)
 *   2. Warm gold body fill behind the rest of the page
 *   3. Faint watermark swirl image (low opacity) sitting under the text
 *   4. "CERTIFICATE / OF INVESTMENT" serif title
 *   5. Trade reference code chip
 *   6. Bold grams + metal headline ("20.8300 Gram Gold")
 *   7. Description paragraph + bulleted Investment Details list
 *   8. DATE / SIGNATURE underscored lines at the bottom
 *
 * The two image assets (`certificate-header.png`, `certificate-watermark.png`)
 * live in `notification-service/src/assets/` and are embedded directly so the
 * PDF is portable (no external network fetches during render).
 */
const path = require("path");
const PDFDocument = require("pdfkit");

const ASSET_HEADER = path.join(__dirname, "..", "assets", "certificate-header.png");
const ASSET_WATERMARK = path.join(__dirname, "..", "assets", "certificate-watermark.png");

// A4 in PDF points (72dpi)
const PAGE_W = 595.28;
const PAGE_H = 841.89;

// Header asset is 1785 × 663 → scaled to full page width keeps its native aspect.
const HEADER_HEIGHT = (PAGE_W * 663) / 1785;

// Body uses a vertical gradient from a lighter gold at the top to a richer
// gold at the bottom — matches the values supplied by the design team.
const COLOR_BODY_TOP = "#E1BD67";
const COLOR_BODY_BOTTOM = "#C39E52";
const COLOR_TEXT = "#1f1a13"; // near-black brown
const COLOR_ACCENT = "#7a5d2e"; // muted gold for reference code
const COLOR_DIVIDER = "#2c2418"; // dark divider line

// English month abbreviations — `Intl.DateTimeFormat("en-GB")` returns
// "Sept" for September which doesn't match the design, so we format manually.
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const METAL_LABEL = { gold: "Gold", silver: "Silver" };
const ASSET_DESCRIPTION = {
  gold: "Physical Gold Bar (99.9% Purity)",
  silver: "Physical Silver Bar (99.9% Purity)",
};

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatGrams(input) {
  const exact = input.gramsExact ? Number(input.gramsExact) : null;
  const fallback = toNumber(input.grams);
  const n = Number.isFinite(exact) ? exact : fallback;
  if (n === null) return "0.0000";
  return n.toFixed(4);
}

function formatMoney(amount, currency) {
  const n = toNumber(amount);
  if (n === null) return "";
  // Always render with grouped thousands ("1,770.55") so the certificate matches
  // the design sample even for large purchases.
  const fixed = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (currency === "USD") return `$${fixed}`;
  return `${currency} ${fixed}`;
}

function formatDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  // Build the date in Asia/Dubai using the locale-agnostic parts API so we
  // can stitch "DD Mon YYYY" without locale quirks (e.g. en-GB → "Sept").
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

function drawBullet(doc, x, y) {
  doc.save();
  doc.circle(x, y, 1.6).fillColor(COLOR_TEXT).fill();
  doc.restore();
}

function safeFilename(referenceCode) {
  const cleaned = String(referenceCode || "trade").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `Simodi-Certificate-${cleaned}.pdf`;
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
 * }} input
 * @returns {Promise<Buffer>}
 */
function buildCertificatePdf(input) {
  const metalKey = input.metal === "silver" ? "silver" : "gold";
  const metalLabel = METAL_LABEL[metalKey];
  const grams = formatGrams(input);
  // ONLY the human-readable referenceCode is acceptable on the certificate;
  // we never fall back to the Mongo ObjectId (`tradeId`) so the chip can't
  // accidentally show a 24-char hash like `#6A157D21B3F5005386EC2B82`.
  const rawRef = (input.referenceCode || "").toString().trim();
  const refDisplay = rawRef ? `#${rawRef.toUpperCase()}` : "";
  const currency = resolveCurrency(input);
  const pricePerGram = formatMoney(resolvePricePerGram(input, currency), currency);
  const totalPrice = formatMoney(resolveTotalMajor(input, currency), currency);
  const transactionDate = formatDate(input.executedAt);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: `Simodi ${metalLabel} Certificate ${rawRef || ""}`.trim(),
        Author: "Simodi",
        Subject: "Certificate of Investment",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // 1. Body gold gradient (drawn first so the header strip overlays cleanly).
    //    Vertical linear gradient: lighter gold top → richer gold bottom.
    doc.save();
    const bodyGradient = doc.linearGradient(0, 0, 0, PAGE_H);
    bodyGradient.stop(0, COLOR_BODY_TOP).stop(1, COLOR_BODY_BOTTOM);
    doc.rect(0, 0, PAGE_W, PAGE_H).fill(bodyGradient);
    doc.restore();

    // 2. Watermark swirl anchored to the bottom-right corner only. The asset is
    //    white-on-transparent so we lift opacity to ~55% over the gold fill —
    //    that blends to a softer champagne tone, matching the reference where
    //    the swirl is a subtle corner accent rather than a full-body wash.
    doc.save();
    doc.opacity(0.55);
    const watermarkWidth = 320;
    const watermarkHeight = (watermarkWidth * 789) / 831;
    doc.image(
      ASSET_WATERMARK,
      PAGE_W - watermarkWidth + 40,
      PAGE_H - watermarkHeight + 30,
      { width: watermarkWidth },
    );
    doc.restore();

    // 3. Header artwork — transparent PNG with the SIMODI Gold logo and the
    //    gold curve wave. Drawn at full page width on top of the gradient so
    //    only the logo + curves are visible (no dark backdrop).
    doc.image(ASSET_HEADER, 0, 0, { width: PAGE_W });

    // 4. Title — "CERTIFICATE" serif headline
    let y = HEADER_HEIGHT + 70;
    doc
      .font("Times-Roman")
      .fillColor(COLOR_TEXT)
      .fontSize(40)
      .text("CERTIFICATE", 0, y, {
        align: "center",
        width: PAGE_W,
        characterSpacing: 3,
      });

    y += 52;
    doc.fontSize(14).text("O F   I N V E S T M E N T", 0, y, {
      align: "center",
      width: PAGE_W,
      characterSpacing: 4,
    });

    // 5. Reference code chip (small, gold) — only rendered when we have a
    //    real human-readable code; we never show the ObjectId here.
    y += 56;
    if (refDisplay) {
      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .fillColor(COLOR_ACCENT)
        .text(refDisplay, 0, y, {
          align: "center",
          width: PAGE_W,
          characterSpacing: 1.5,
        });
    }

    // 6. Headline grams + metal
    y += 22;
    doc
      .font("Helvetica-Bold")
      .fontSize(36)
      .fillColor(COLOR_TEXT)
      .text(`${grams} Gram ${metalLabel}`, 0, y, {
        align: "center",
        width: PAGE_W,
      });

    // 7. Divider line under headline
    y += 58;
    doc
      .moveTo(60, y)
      .lineTo(PAGE_W - 60, y)
      .lineWidth(1)
      .strokeColor(COLOR_DIVIDER)
      .stroke();

    // 8. Description paragraph
    y += 16;
    const descriptionText = refDisplay
      ? `This is to certify that the investment under reference ${refDisplay} has been successfully recorded in Simodi ${metalLabel} on the below mentioned date.`
      : `This is to certify that the investment has been successfully recorded in Simodi ${metalLabel} on the below mentioned date.`;
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(COLOR_TEXT)
      .text(descriptionText, 60, y, {
        width: PAGE_W - 120,
        align: "left",
        lineGap: 1,
      });

    // 9. Investment details block
    y += 42;
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(COLOR_TEXT)
      .text("Investment Details:", 60, y);

    y += 22;
    const detailRows = [
      ["Asset Type", ASSET_DESCRIPTION[metalKey]],
      ["Total Grams", `${grams}g`],
      ["Price per Gram", pricePerGram || "—"],
      ["Total Purchase Price", totalPrice ? `${totalPrice} (Total Price)` : "—"],
      ["Transaction Date", transactionDate || "—"],
      ["Storage Location", "Insured Simodi Vault"],
    ];

    for (const [label, value] of detailRows) {
      drawBullet(doc, 76, y + 5);
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(COLOR_TEXT)
        .text(`${label}: `, 88, y, { continued: true });
      doc.font("Helvetica").text(String(value ?? ""));
      y += 18;
    }

    // 10. Footer block: filled DATE line on the left, digital-signature stamp
    //     on the right (replaces the empty SIGNATURE underline), and a small
    //     verification disclaimer beneath both.
    const lineY = PAGE_H - 95;
    const lineWidth = 170;
    const padding = 60;

    // Left side — date written on the line, label below
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor(COLOR_TEXT)
      .text(
        transactionDate || "—",
        padding,
        lineY - 16,
        { width: lineWidth, align: "center" },
      );
    doc
      .moveTo(padding, lineY)
      .lineTo(padding + lineWidth, lineY)
      .lineWidth(1)
      .strokeColor(COLOR_DIVIDER)
      .stroke();
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(COLOR_TEXT)
      .text("DATE", padding, lineY + 6, {
        width: lineWidth,
        align: "center",
        characterSpacing: 2,
      });

    // Right side — digital signature stamp instead of an empty underline.
    // Uses a thin rounded rectangle so it visually reads as an official seal.
    const stampX = PAGE_W - padding - lineWidth;
    const stampY = lineY - 32;
    const stampH = 36;
    doc
      .save()
      .roundedRect(stampX, stampY, lineWidth, stampH, 4)
      .lineWidth(1)
      .strokeColor(COLOR_DIVIDER)
      .stroke();
    // Checkmark glyph + label inside the stamp
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(COLOR_TEXT)
      .text(
        "DIGITALLY SIGNED",
        stampX,
        stampY + 7,
        { width: lineWidth, align: "center", characterSpacing: 1.5 },
      );
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(COLOR_TEXT)
      .text(
        "by Simodi Gold",
        stampX,
        stampY + 21,
        { width: lineWidth, align: "center" },
      );
    doc.restore();
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(COLOR_TEXT)
      .text("SIGNATURE", stampX, lineY + 6, {
        width: lineWidth,
        align: "center",
        characterSpacing: 2,
      });

    // Bottom disclaimer + verification line for traceability. The verification
    // line is omitted entirely when no human-readable reference exists, so the
    // certificate never advertises a missing/blank trace ID.
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(COLOR_TEXT)
      .text(
        "This is a digitally generated certificate issued by Simodi Gold and does not require a physical signature.",
        padding,
        PAGE_H - 45,
        { width: PAGE_W - padding * 2, align: "center" },
      );
    if (refDisplay) {
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(COLOR_TEXT)
        .text(
          `Verification reference: ${refDisplay}   |   Issued: ${transactionDate || formatDate(new Date())}`,
          padding,
          PAGE_H - 30,
          { width: PAGE_W - padding * 2, align: "center", characterSpacing: 0.5 },
        );
    }

    doc.end();
  });
}

module.exports = { buildCertificatePdf, safeFilename };
