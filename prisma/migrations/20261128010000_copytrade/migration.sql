-- CreateTable
CREATE TABLE "CopyAlert" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceUsd" DOUBLE PRECISION,
    "liquidityUsd" DOUBLE PRECISION,
    "note" TEXT,

    CONSTRAINT "CopyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyTrader" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "pnlUsd" DOUBLE PRECISION NOT NULL,
    "trades" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopyTrader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyPosition" (
    "id" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "stakeEur" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPrice" DOUBLE PRECISION,
    "lastPriceAt" TIMESTAMP(3),
    "exitPrice" DOUBLE PRECISION,
    "closedAt" TIMESTAMP(3),
    "exitReason" TEXT,

    CONSTRAINT "CopyPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CopyAlert_eventId_key" ON "CopyAlert"("eventId");

-- CreateIndex
CREATE INDEX "CopyAlert_receivedAt_idx" ON "CopyAlert"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CopyTrader_day_window_userId_key" ON "CopyTrader"("day", "window", "userId");

-- CreateIndex
CREATE INDEX "CopyPosition_strategy_closedAt_idx" ON "CopyPosition"("strategy", "closedAt");

-- CreateIndex
CREATE INDEX "CopyPosition_userId_tokenAddress_idx" ON "CopyPosition"("userId", "tokenAddress");

