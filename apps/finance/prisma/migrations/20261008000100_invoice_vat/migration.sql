-- A VAT bill carries 13% inside its amount, with the supplier's PAN/VAT number. A bill without VAT often has no number.
ALTER TABLE "request_invoice" ADD COLUMN "vat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "request_invoice" ADD COLUMN "supplierTaxNo" VARCHAR(50);
ALTER TABLE "request_invoice" ALTER COLUMN "invoiceNumber" DROP NOT NULL;
