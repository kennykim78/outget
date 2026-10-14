// 승격 무결성 규칙 V06·V07 (R7 A3, 계획 _workspace/58_architect_r7_dwarf_plan.md) — VERIFIED 로 올라간 Taxon·CareProfile 이
//   "빈 껍데기"로 노출되지 않게 한다. 기준은 raw reviewStatus === 'VERIFIED'(V02 와 동일 — AI_DRAFT 결합은 V01 이 따로 막는다).
//   노출 판정은 하지 않는다(engine/exposure.ts 단일). 사실 값의 옳고 그름도 보지 않는다 — 형태(존재·타입)만.
import { asRec, isNonEmptyStr, type Rec } from './common.js';
import type { Ctx } from './context.js';

/** V06: VERIFIED Taxon 의 legal 에서 boolean(null 불가)이어야 하는 키. designatedWildlifeWhitelist 는 null 허용(골든 관례). */
export const TAXON_LEGAL_BOOLEAN_KEYS = ['animalProtectionAct6', 'cites'] as const;

/**
 * V07: VERIFIED CareProfile.facts 필수 키.
 * 출처: PRD v1.3.1 부록 A/B 에 facts 키 정의가 없다(제품기획 §5 의 axes/care 는 다른 형태) →
 *   골든햄스터 시드(cp-hamster-syrian)의 6키를 기준으로 쓴다. 문서에 정의가 생기면 이 목록을 그쪽으로 옮긴다.
 */
export const CARE_FACT_KEYS = ['social', 'activity', 'adultLengthCm', 'tempC', 'humidityPct', 'lifespanYears'] as const;
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
    if (typeof legal[k] !== 'boolean') {
      ctx.out.error('V06', 'taxa', id, `legal.${k}`, `VERIFIED Taxon 은 legal.${k} 가 true/false 여야 한다(null·누락 불가)`);
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
