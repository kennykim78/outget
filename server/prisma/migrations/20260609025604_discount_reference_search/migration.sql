-- AlterTable
ALTER TABLE "DiscountPost" ADD COLUMN "referenceBasePrice" INTEGER;
ALTER TABLE "DiscountPost" ADD COLUMN "referenceLowestPrice" INTEGER;
ALTER TABLE "DiscountPost" ADD COLUMN "referenceProductId" TEXT;
