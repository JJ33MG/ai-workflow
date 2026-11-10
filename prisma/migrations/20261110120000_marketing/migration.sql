-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "favorites" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "views" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MarketingPlay" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tactic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "input" JSONB,
    "baseline" JSONB,
    "result" JSONB,
    "verdict" TEXT,
    "liftPct" DOUBLE PRECISION,
    "note" TEXT,
    "copiedFrom" TEXT,
    "startedAt" TIMESTAMP(3),
    "measuredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPlay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingPlay_businessId_status_idx" ON "MarketingPlay"("businessId", "status");
