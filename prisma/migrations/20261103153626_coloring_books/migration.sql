-- CreateTable
CREATE TABLE "ColoringBook" (
    "id" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "ageRange" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "keywords" TEXT[],
    "categories" TEXT[],
    "pages" JSONB NOT NULL DEFAULT '[]',
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'drawing',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ColoringBook_pkey" PRIMARY KEY ("id")
);
