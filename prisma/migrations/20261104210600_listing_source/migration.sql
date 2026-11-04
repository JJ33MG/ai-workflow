-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'agent';
