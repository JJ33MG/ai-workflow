ALTER TABLE "Listing" ADD COLUMN "supplier" TEXT NOT NULL DEFAULT 'printful';
ALTER TABLE "Listing" ADD COLUMN "printifyProductId" TEXT;
CREATE UNIQUE INDEX "Listing_printifyProductId_key" ON "Listing"("printifyProductId");
