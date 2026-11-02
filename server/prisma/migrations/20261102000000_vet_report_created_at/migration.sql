-- 264(Kenny ORDERS §41): 병원 제보 보존 180일의 기준 시각 + 이벤트 일일 상한 복원·보존 정리용 인덱스.
--   VetClinic.createdAt(ISO, 기본 '') 컬럼 1개 + EventLog(receivedDate) 인덱스 1개. 다른 테이블 변경 0.
--   이미 있던 사용자 제보(source USER_REPORT, 접수 시각 미상)는 이 마이그레이션 시각으로 채운다 — 첫 정리에서 바로 지워지지 않고
--   운영자 확인 대기열이 남는다(최대 보존 = 마이그레이션 시각 + 180일). 시드 행은 '' 그대로(정리 대상 아님).
-- AlterTable
ALTER TABLE "VetClinic" ADD COLUMN "createdAt" TEXT NOT NULL DEFAULT '';
UPDATE "VetClinic" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE "source" = 'USER_REPORT';

-- CreateIndex
CREATE INDEX "EventLog_receivedDate_idx" ON "EventLog"("receivedDate");
