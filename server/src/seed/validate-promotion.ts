// 승격 무결성 규칙 V06·V07 (R7 A3, 계획 _workspace/58_architect_r7_dwarf_plan.md) — VERIFIED 로 올라간 Taxon·CareProfile 이
//   "빈 껍데기"로 노출되지 않게 한다. 기준은 raw reviewStatus === 'VERIFIED'(V02 와 동일 — AI_DRAFT 결합은 V01 이 따로 막는다).
//   노출 판정은 하지 않는다(engine/exposure.ts 단일). 사실 값의 옳고 그름도 보지 않는다 — 형태(존재·타입)만.
import { asRec, isNonEmptyStr, type Rec } from './common.js';
import type { Ctx } from './context.js';

/**
 * V06: VERIFIED Taxon 의 legal 불리언 키 — 형태만 본다(값이 있으면 true/false/null). 필수 아님(280, Kenny ORDERS §47:
 *   법 상태는 공개 조건이 아니다 — legal 은 정보용 메모). null·누락도 통과한다. 문자열 "false" 같은 엉뚱한 타입만 막는다.
 */
export const TAXON_LEGAL_BOOLEAN_KEYS = ['animalProtectionAct6', 'cites', 'designatedWildlifeWhitelist'] as const;

/**
 * V07: VERIFIED CareProfile.facts 필수 키.
 * 출처: PRD v1.3.1 부록 A/B 에 facts 키 정의가 없다(제품기획 §5 의 axes/care 는 다른 형태) →
 *   골든햄스터 시드(cp-hamster-syrian)의 키를 기준으로 쓴다. 문서에 정의가 생기면 이 목록을 그쪽으로 옮긴다.
 *   2026-10-25: humidityPct 제외(5키) — Kenny 결정(85 재조사: 반려 사육용 습도 수치 출처 없음 → 골든 facts 에서 삭제).
 */
export const CARE_FACT_KEYS = ['social', 'activity', 'adultLengthCm', 'tempC', 'lifespanYears'] as const;
export const CARE_FACT_KEYS_SOURCE = 'golden-seed(cp-hamster-syrian) — PRD 부록 A/B 에 facts 키 정의 없음';

const isVerifiedRow = (r: Rec): boolean => r.reviewStatus === 'VERIFIED';

function checkTaxon(ctx: Ctx, id: string, r: Rec): void {
  if (!isNonEmptyStr(r.scientificName)) {
    ctx.out.error('V06', 'taxa', id, 'scientificName', 'VERIFIED Taxon 은 학명이 비어 있으면 안 된다');
  }
  const legal = asRec(r.legal);
  if (!legal) {
    ctx.out.error('V06', 'taxa', id, 'legal', 'VERIFIED Taxon 은 legal 객체 필요');
    return;
  }
  for (const k of TAXON_LEGAL_BOOLEAN_KEYS) {
    const v = legal[k];
    if (v !== undefined && v !== null && typeof v !== 'boolean') {
      ctx.out.error('V06', 'taxa', id, `legal.${k}`, `Taxon legal.${k} 는 true/false/null 이어야 한다(정보용 메모 — 필수 아님, 280)`);
    }
  }
}

function checkCareProfile(ctx: Ctx, id: string, r: Rec): void {
  const facts = asRec(r.facts);
  for (const k of CARE_FACT_KEYS) {
    const v = facts?.[k];
    if (v === undefined || v === null) {
      ctx.out.error('V07', 'careProfiles', id, `facts.${k}`, `VERIFIED CareProfile 은 facts.${k} 필요(키 기준: ${CARE_FACT_KEYS_SOURCE})`);
    }
  }
  const notes = Array.isArray(r.careNotes) ? r.careNotes.filter(isNonEmptyStr) : [];
  if (notes.length < 1) {
    ctx.out.error('V07', 'careProfiles', id, 'careNotes', 'VERIFIED CareProfile 은 비어 있지 않은 careNotes 1개 이상 필요');
  }
}

export function checkPromotion(ctx: Ctx): void {
  for (const { rec, id } of ctx.rows.taxa) if (isVerifiedRow(rec)) checkTaxon(ctx, id, rec);
  for (const { rec, id } of ctx.rows.careProfiles) if (isVerifiedRow(rec)) checkCareProfile(ctx, id, rec);
}
