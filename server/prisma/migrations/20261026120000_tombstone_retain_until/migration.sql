-- 101 MED-2: ErasureTombstone.retainUntil(ISO, 정리 기준). 컬럼 1개 추가.
--   기존 행(옛 백업 복원 후 migrate deploy 포함)은 erasedAt + 7일(= 이전 규칙의 만료 시각)로 채운다 — 보존 기간이 줄지도 늘지도 않는다.
--   SQLite 는 NOT NULL 컬럼을 기본값 없이 ADD COLUMN 할 수 없어 Prisma 표준 방식(테이블 재정의)으로 옮긴다.
--   strftime 이 해석하지 못하는 erasedAt(코드상 생기지 않음)은 erasedAt 원문으로 — NOT NULL 위반으로 기동이 막히지 않게.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ErasureTombstone" (
    "emailSha256" TEXT NOT NULL PRIMARY KEY,
    "erasedAt" TEXT NOT NULL,
    "retainUntil" TEXT NOT NULL
);
INSERT INTO "new_ErasureTombstone" ("emailSha256", "erasedAt", "retainUntil") SELECT "emailSha256", "erasedAt", COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', "erasedAt", '+7 days'), "erasedAt") FROM "ErasureTombstone";
DROP TABLE "ErasureTombstone";
ALTER TABLE "new_ErasureTombstone" RENAME TO "ErasureTombstone";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
