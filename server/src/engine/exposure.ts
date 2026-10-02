// 노출 판정 — 엔진에서 노출을 결정하는 유일한 모듈(불변식 3·7, A-6). 엔진 계산 자체는 상태 무관.
//   VERIFIED 만 노출, AI_DRAFT 는 VERIFIED 로 표시돼 있어도 노출하지 않는다(validate V01 이 별도로 막는다).
//   검수자 유형은 허용 목록(rank ≥ OPERATOR, L3) — 알 수 없는 값은 노출하지 않는다(fail-closed).
//   contentKind 별 최소 등급(MIN_GRADE)은 validator 에만 있다(D15).
import { reviewerRank, type VetStatus } from './domain.js';
import { listResolvedRequirements, resolveRequirement } from './resolve.js';
import { checkAnimalMinSpec } from './spec-check.js';
import type {
  CompatibilityRuleRec,
  ContentMeta,
  CuratedProductRec,
  EngineCatalog,
  PhotoRec,
  Reason,
  ResolvedRequirement,
  SetupBundleRec,
  TestimonialRec,
  VetClinicSeedRec,
} from './types.js';

const MIN_EXPOSED_RANK = reviewerRank('OPERATOR');

/** VERIFIED ∧ 검수자 등급 ≥ OPERATOR(AI_DRAFT·알 수 없는 값 제외). */
export function isVerified(m: Pick<ContentMeta, 'reviewStatus' | 'reviewerType'>): boolean {
  return (
    m.reviewStatus === 'VERIFIED' &&
    typeof m.reviewerType === 'string' &&
    reviewerRank(m.reviewerType) >= MIN_EXPOSED_RANK
  );
}

/** AnimalType ACTIVE ∧ AnimalType·requirement·SupplyItem·CareProfile 모두 검수 완료(M1). */
export function isRequirementExposable(cat: EngineCatalog, r: ResolvedRequirement): boolean {
  const at = cat.animalTypes.get(r.animalTypeId);
  if (!at || at.status !== 'ACTIVE') return false;
  return (
    isVerified(r.review.animalType) &&
    isVerified(r.review.requirement) &&
    isVerified(r.review.item) &&
    isVerified(r.review.careProfile)
  );
}

/** 타입 페이지 노출: ACTIVE ∧ AnimalType VERIFIED ∧ CareProfile VERIFIED ∧ 노출 가능한 요구사항 ≥ 1(M1, D4). */
export function isAnimalTypeExposable(cat: EngineCatalog, animalTypeId: string): boolean {
  const at = cat.animalTypes.get(animalTypeId);
  if (!at || at.status !== 'ACTIVE' || !isVerified(at) || !at.careProfileId) return false;
  const profile = cat.careProfiles.get(at.careProfileId);
  if (!profile || !isVerified(profile)) return false;
  return listResolvedRequirements(cat, at.id).some((r) => isRequirementExposable(cat, r));
}

/**
 * 상품 노출(불변식 3, M2·M3) — 동물 타입 단위. 규격(meetsMinSpec=true ∧ 동물별 최소 규격 충족) → 검수(VERIFIED)
 *   → 상태(ACTIVE) ∧ 이 동물의 CareProfile 대상 ∧ 해당 요구사항 노출 가능. 선호·좋아요는 보지 않는다.
 */
export function isProductExposable(cat: EngineCatalog, animalTypeId: string, p: ProductForExposure): boolean {
  return exposedVerdict(cat, animalTypeId, p) !== null;
}

export type ProductForExposure = Pick<
  CuratedProductRec,
  'status' | 'meetsMinSpec' | 'reviewStatus' | 'reviewerType' | 'supplyItemId' | 'careProfileIds' | 'specValues'
>;

export interface ExposableProduct<P> {
  product: P;
  verdict: 'OK' | 'BELOW_RECOMMENDED';
  reasons: Reason[];
}

/** 노출 가능하면 동물별 판정, 아니면 null. isProductExposable·orderExposableProducts 의 단일 판정. */
function exposedVerdict(
  cat: EngineCatalog,
  animalTypeId: string,
  p: ProductForExposure,
): Omit<ExposableProduct<unknown>, 'product'> | null {
  if (p.status !== 'ACTIVE' || p.meetsMinSpec !== true || !isVerified(p)) return null;
  const at = cat.animalTypes.get(animalTypeId);
  if (!at || !at.careProfileId) return null;
  if (!Array.isArray(p.careProfileIds) || !p.careProfileIds.includes(at.careProfileId)) return null;
  const r = resolveRequirement(cat, animalTypeId, p.supplyItemId);
  if (!r || !isRequirementExposable(cat, r)) return null;
  const spec = checkAnimalMinSpec(cat, animalTypeId, p.supplyItemId, p.specValues);
  if (!spec.meets || (spec.verdict !== 'OK' && spec.verdict !== 'BELOW_RECOMMENDED')) return null;
  return { verdict: spec.verdict, reasons: spec.reasons };
}

const VERDICT_ORDER = { OK: 0, BELOW_RECOMMENDED: 1 } as const;

/**
 * 추천 영역 순서(노출 순서 규격 → 검수 → 선호 고정): 노출 가능한 것만, verdict OK → BELOW_RECOMMENDED,
 *   specVerifiedAt 최신 먼저(없으면 뒤), 같으면 입력(시드) 순서. 좋아요·반응 미사용. 입력은 바꾸지 않는다.
 */
export function orderExposableProducts<P extends ProductForExposure & Pick<CuratedProductRec, 'specVerifiedAt'>>(
  cat: EngineCatalog,
  animalTypeId: string,
  products: readonly P[],
): ExposableProduct<P>[] {
  const rows: Array<ExposableProduct<P> & { i: number }> = [];
  products.forEach((product, i) => {
    const v = exposedVerdict(cat, animalTypeId, product);
    if (v) rows.push({ product, ...v, i });
  });
  rows.sort(
    (x, y) =>
      VERDICT_ORDER[x.verdict] - VERDICT_ORDER[y.verdict] ||
      compareDateDesc(x.product.specVerifiedAt, y.product.specVerifiedAt) ||
      x.i - y.i,
  );
  return rows.map(({ product, verdict, reasons }) => ({ product, verdict, reasons }));
}

function compareDateDesc(a: string | null | undefined, b: string | null | undefined): number {
  const x = typeof a === 'string' ? a : '';
  const y = typeof b === 'string' ? b : '';
  if (x === y) return 0;
  return x < y ? 1 : -1;
}

/** 후기: APPROVED ∧ verifiedUsage. */
export function isTestimonialExposable(t: Pick<TestimonialRec, 'status' | 'verifiedUsage'>): boolean {
  return t.status === 'APPROVED' && t.verifiedUsage === true;
}

/** 병원 목록에 올라가는 유일한 상태(전화 확인). 리포지토리·Prisma where 가 이 상수를 쓴다. */
export const VET_LISTED_STATUS = 'VERIFIED' as const satisfies VetStatus;

/** 병원 상태 → 목록 노출 여부(REPORTED·BLINDED·SLOT·알 수 없는 값 제외). */
export function isVetStatusListed(status: unknown): boolean {
  return status === VET_LISTED_STATUS;
}

/** 병원(시드 레코드): 전화 확인(VERIFIED)된 곳만 목록에. */
export function isVetListed(v: Pick<VetClinicSeedRec, 'verification'>): boolean {
  return isVetStatusListed(v.verification?.status);
}

/**
 * 준비 세트 노출: 세트 VERIFIED ∧ 동물의 CareProfile 과 일치 ∧ 항목 ≥ 1 ∧ 모든 항목의 요구사항이 이 동물에서 노출 가능.
 */
export function isBundleExposable(
  cat: EngineCatalog,
  animalTypeId: string,
  b: Pick<SetupBundleRec, 'careProfileId' | 'itemIds' | 'reviewStatus' | 'reviewerType'>,
): boolean {
  if (!isVerified(b)) return false;
  const at = cat.animalTypes.get(animalTypeId);
  if (!at || !at.careProfileId || at.careProfileId !== b.careProfileId) return false;
  if (!Array.isArray(b.itemIds) || b.itemIds.length === 0) return false;
  return b.itemIds.every((itemId) => {
    const r = resolveRequirement(cat, animalTypeId, itemId);
    return r !== null && isRequirementExposable(cat, r);
  });
}

/** 호환 규칙(공개 카탈로그·클라 판정 입력): VERIFIED 만. */
export function isCompatRuleExposable(rule: Pick<CompatibilityRuleRec, 'reviewStatus' | 'reviewerType'>): boolean {
  return isVerified(rule);
}

const PHOTO_LICENSES: readonly string[] = ['CC0', 'CC_BY', 'CC_BY_SA', 'SITE_LICENSE', 'PERMISSION'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTTPS_URL = /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/;

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * 사진 사용 가능(불변식 1, I01·C6): 비SLOT ∧ 허용 라이선스 ∧ 출처·https 원본 URL·내려받은 날짜 기록 ∧ CC0 외엔 저작자.
 */
export function isPhotoUsable(
  p: Pick<PhotoRec, 'status' | 'license' | 'source' | 'sourceUrl' | 'downloadedAt' | 'author'>,
): boolean {
  if (p.status === 'SLOT') return false;
  if (typeof p.license !== 'string' || !PHOTO_LICENSES.includes(p.license)) return false;
  if (!nonEmpty(p.source)) return false;
  if (typeof p.sourceUrl !== 'string' || !HTTPS_URL.test(p.sourceUrl)) return false;
  if (typeof p.downloadedAt !== 'string' || !ISO_DATE.test(p.downloadedAt)) return false;
  return p.license === 'CC0' || nonEmpty(p.author);
}
