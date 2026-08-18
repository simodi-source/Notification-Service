/**
 * Writes a sample Gold Ownership Certificate PDF for visual QA.
 *
 * Usage (from notification-service):
 *   node scripts/generate-sample-certificate.js
 */
const fs = require("fs");
const path = require("path");
const { buildCertificatePdf, safeFilename } = require("../src/services/certificate.service");

const outDir = path.join(__dirname, "..", "tmp-samples");

const sample = {
  referenceCode: "SAL00000001",
  metal: "gold",
  gramsExact: "10.000",
  quoteCurrency: "AED",
  priceAedPerGramMajor: 500,
  totalAedMajor: 5000,
  executedAt: "2026-08-14T10:30:00.000Z",
  customerName: "Abdallah Osman",
  customerEmail: "siimodi@gmail.com",
  customerPhone: "",
};

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const pdf = await buildCertificatePdf(sample);
  const filename = safeFilename(sample.referenceCode);
  const dest = path.join(outDir, filename);
  fs.writeFileSync(dest, pdf);
  console.log(`Wrote ${dest} (${pdf.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
