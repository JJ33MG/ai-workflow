-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "board" TEXT,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPost_businessId_createdAt_idx" ON "SocialPost"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_platform_refId_key" ON "SocialPost"("platform", "refId");
