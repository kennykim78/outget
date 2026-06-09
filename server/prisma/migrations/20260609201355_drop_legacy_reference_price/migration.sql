-- DropColumn (SQLite drop-column → table redefine; preserves all kept columns)
-- legacy referencePrice(미사용) 제거. base/lowest/productId/source/query/fetchedAt 는 유지.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DiscountPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorId" TEXT NOT NULL,
    "storeBrand" TEXT NOT NULL,
    "discountRate" INTEGER,
    "discountPrice" INTEGER,
    "listPrice" INTEGER,
    "unverifiedBase" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "photo" TEXT,
    "createdAt" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "referenceBasePrice" INTEGER,
    "referenceLowestPrice" INTEGER,
    "referenceProductId" TEXT,
    "referenceSource" TEXT,
    "referenceQuery" TEXT,
    "referenceFetchedAt" TEXT,
    "lat" REAL,
    "lng" REAL
);
INSERT INTO "new_DiscountPost" ("authorId", "createdAt", "discountPrice", "discountRate", "id", "lat", "listPrice", "lng", "photo", "referenceBasePrice", "referenceFetchedAt", "referenceLowestPrice", "referenceProductId", "referenceQuery", "referenceSource", "source", "status", "storeBrand", "unverifiedBase") SELECT "authorId", "createdAt", "discountPrice", "discountRate", "id", "lat", "listPrice", "lng", "photo", "referenceBasePrice", "referenceFetchedAt", "referenceLowestPrice", "referenceProductId", "referenceQuery", "referenceSource", "source", "status", "storeBrand", "unverifiedBase" FROM "DiscountPost";
DROP TABLE "DiscountPost";
ALTER TABLE "new_DiscountPost" RENAME TO "DiscountPost";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
