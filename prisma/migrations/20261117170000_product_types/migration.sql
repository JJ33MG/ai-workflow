-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "productType" TEXT NOT NULL DEFAULT 'mug',
ADD COLUMN     "variants" JSONB;
