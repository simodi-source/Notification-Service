/**
 * Writes sample Sales Invoice + Purchase Voucher PDFs for visual QA.
 *
 * Usage (from notification-service):
 *   node scripts/generate-sample-invoices.js
 */
const fs = require("fs");
const path = require("path");
const { buildInvoicePdf, safeFilename } = require("../src/services/invoice.service");

const outDir = path.join(__dirname, "..", "tmp-samples");

const sampleCustomer = {
  customerName: "Abdallah",
  customerEmail: "abdallah@example.com",
  customerPhone: "+971 50 123 4567",
};

const samples = [
  {
    side: "buy",
    referenceCode: "SAL00000001",
    metal: "gold",
    gramsExact: "1.250000",
    quoteCurrency: "AED",
    priceAedPerGramMajor: 312.21,
    totalAedMajor: 390.26,
    executedAt: "2026-06-02T10:30:00.000Z",
    ...sampleCustomer,
  },
  {
    side: "sell",
    referenceCode: "PUR00000001",
    metal: "gold",
    gramsExact: "30.0000",
    quoteCurrency: "USD",
    priceUsdPerGramMajor: 142.0,
    totalUsdMajor: 4260.0,
    executedAt: "2026-06-02T10:30:00.000Z",
    ...sampleCustomer,
  },
];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const input of samples) {
    const pdf = await buildInvoicePdf(input);
    const filename = safeFilename(input.referenceCode, input.side === "sell");
    const dest = path.join(outDir, filename);
    fs.writeFileSync(dest, pdf);
    console.log(`Wrote ${dest} (${pdf.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
