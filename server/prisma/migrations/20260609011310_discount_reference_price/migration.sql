-- AlterTable
ALTER TABLE "DiscountPost" ADD COLUMN "referenceFetchedAt" TEXT;
ALTER TABLE "DiscountPost" ADD COLUMN "referencePrice" INTEGER;
ALTER TABLE "DiscountPost" ADD COLUMN "referenceQuery" TEXT;
ALTER TABLE "DiscountPost" ADD COLUMN "referenceSource" TEXT;
