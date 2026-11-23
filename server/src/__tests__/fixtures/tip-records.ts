// 시험용 팁 검수 기록(총괄 ORDERS 11/22 18:4x — summaryCheck·vetReview). 사육 사실 아님 — 시험 픽스처 전용 값.
//   실제 시드(server/seed/budget-tips.json)는 사람이 대조·검수한 사실이 없어 두 필드가 null(팁 전부 비노출, 의도된 결과).
//   이 헬퍼는 노출 경로 시험을 유지하려고 시험용 팁에만 기록을 채운다. 키가 이미 있으면(null 포함) 그대로 둔다 — 변이 시험용.
import type { BudgetTipRec, TipSummaryCheck, TipVetReview } from '../../engine/index.js';

export const TEST_CHECKED_BY = '시험 운영자';
export const TEST_VET_SOURCE = '시험 수의 문헌';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** summaryCheck = 이 행 references[].url 전부 · checkedAt = 참조 확인일 중 가장 늦은 날(없으면 fallbackDay). */
export function testSummaryCheck(t: Pick<BudgetTipRec, 'references'>, fallbackDay = '2026-11-20'): TipSummaryCheck {
  const refs = Array.isArray(t.references) ? t.references : [];
  const urls = [...new Set(refs.map((r) => (r && typeof r === 'object' ? r.url : undefined)).filter((u): u is string => typeof u === 'string'))];
  const days = refs.map((r) => (r && typeof r === 'object' ? r.checkedAt : undefined)).filter((d): d is string => typeof d === 'string' && ISO.test(d)).sort();
  return { sources: urls, checkedAt: days.at(-1) ?? fallbackDay, checkedBy: TEST_CHECKED_BY };
}

export function testVetReview(day: string): TipVetReview {
  return { reviewerType: 'VET', reviewedAt: day, source: TEST_VET_SOURCE };
}

/** summaryCheck·vetReview 키를 뺀 사본(실시드 null → withTipChecks 로 다시 채우는 시험·「기록 없음」 빌드용). */
export function stripTipChecks<T extends BudgetTipRec>(t: T): T {
  const out: T = { ...t };
  delete out.summaryCheck;
  delete out.vetReview;
  return out;
}

/** summaryCheck·vetReview 키가 없을 때만 시험용 기록을 채운다(키가 있으면 null 이어도 그대로 — 숨김 변이). */
export function withTipChecks<T extends BudgetTipRec>(t: T): T {
  const out: T = { ...t };
  const sc = testSummaryCheck(t);
  if (!Object.hasOwn(t, 'summaryCheck')) out.summaryCheck = sc;
  if (!Object.hasOwn(t, 'vetReview')) out.vetReview = testVetReview(sc.checkedAt);
  return out;
}
