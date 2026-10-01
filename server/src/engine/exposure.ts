// 노출 판정 — 엔진에서 노출을 결정하는 유일한 모듈(불변식 3·7, A-6). 엔진 계산 자체는 상태 무관.
//   VERIFIED 만 노출, AI_DRAFT 는 VERIFIED 로 표시돼 있어도 노출하지 않는다(validate V01 이 별도로 막는다).
import type { ContentMeta, CuratedProductRec, EngineCatalog, ResolvedRequirement, TestimonialRec, VetClinicSeedRec } from './types.js';

export function isVerified(m: Pick<ContentMeta, 'reviewStatus' | 'reviewerType'>): boolean {
  return m.reviewStatus === 'VERIFIED' && m.reviewerType !== 'AI_DRAFT';
}

/** AnimalType ACTIVE ∧ requirement·SupplyItem·CareProfile 모두 검수 완료. */
export function isRequirementExposable(cat: EngineCatalog, r: ResolvedRequirement): boolean {
  const at = cat.animalTypes.get(r.animalTypeId);
  if (!at || at.status !== 'ACTIVE') return false;
  return isVerified(r.review.requirement) && isVerified(r.review.item) && isVerified(r.review.careProfile);
}

/** 규격(meetsMinSpec=true) → 검수(VERIFIED) → 상태(ACTIVE). 선호·좋아요는 보지 않는다. */
export function isProductExposable(
  p: Pick<CuratedProductRec, 'status' | 'meetsMinSpec' | 'reviewStatus' | 'reviewerType'>,
): boolean {
  return p.meetsMinSpec === true && isVerified(p) && p.status === 'ACTIVE';
}

/** 후기: APPROVED ∧ verifiedUsage. */
export function isTestimonialExposable(t: Pick<TestimonialRec, 'status' | 'verifiedUsage'>): boolean {
  return t.status === 'APPROVED' && t.verifiedUsage === true;
}

/** 병원: 전화 확인(VERIFIED)된 곳만 목록에. */
export function isVetListed(v: Pick<VetClinicSeedRec, 'verification'>): boolean {
  return v.verification?.status === 'VERIFIED';
}
