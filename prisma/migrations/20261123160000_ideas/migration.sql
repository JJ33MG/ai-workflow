CREATE TABLE "Idea" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "whyNow" TEXT NOT NULL,
    "money" TEXT NOT NULL,
    "cost" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "firstStep" TEXT NOT NULL,
    "risks" TEXT NOT NULL,
    "outsideBox" BOOLEAN NOT NULL DEFAULT false,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "origin" TEXT NOT NULL DEFAULT 'daily',
    "status" TEXT NOT NULL DEFAULT 'new',
    "feedback" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Idea_status_createdAt_idx" ON "Idea"("status", "createdAt");
