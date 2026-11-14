-- D9 ②(Kenny 2026-11-14 K2·K3·K5·K6): SupplyRequirement.whyShort — 이유 한 줄(선택, 6~30자·한 문장, 시드 validate W01·W02).
--   추가형 nullable 컬럼 1개. 기존 행은 NULL(= 미작성 → 화면은 firstSentence(why) 폴백). 다른 테이블 변경 0, 데이터 갱신 0.
--   되돌리기: 코드 revert + 시드에서 whyShort 키 제거로 충분(열은 남아도 무해). 열까지 지우려면
--   ALTER TABLE "SupplyRequirement" DROP COLUMN "whyShort"; (SQLite 3.35+) 를 새 마이그레이션으로.
-- AlterTable
ALTER TABLE "SupplyRequirement" ADD COLUMN "whyShort" TEXT;
