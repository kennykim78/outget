// 노출 판정 — 엔진에서 노출을 결정하는 유일한 모듈(불변식 3·7, A-6). 엔진 계산 자체는 상태 무관.
//   VERIFIED 만 노출, AI_DRAFT 는 VERIFIED 로 표시돼 있어도 노출하지 않는다(validate V01 이 별도로 막는다).
//   검수자 유형은 허용 목록(rank ≥ OPERATOR, L3) — 알 수 없는 값은 노출하지 않는다(fail-closed).
//   contentKind 별 최소 등급(MIN_GRADE)은 validator 에만 있다(D15).
//   M-1(R4 D5): 검수 나이 — 모든 노출 함수는 필수 asOf(YYYY-MM-DD)를 받고, 체인의 모든 ContentMeta 에
//   isVerified ∧ isFresh(verifiedAt + STALE_DAYS ≥ asOf)를 요구한다. 시계를 읽지 않는다(호출자가 기준일을 넣는다).
import { STALE_DAYS, isoDayNumber, reviewerRank, type VetStatus } from './domain.js';
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

/** VERIFIED ∧ 검수자 등급 ≥ OPERATOR(AI_DRAFT·알 수 없는 값 제외). 날짜는 보지 않는다(isFresh 가 따로). */
export function isVerified(m: Pick<ContentMeta, 'reviewStatus' | 'reviewerType'>): boolean {
  return (
    m.reviewStatus === 'VERIFIED' &&
    typeof m.reviewerType === 'string' &&
    reviewerRank(m.reviewerType) >= MIN_EXPOSED_RANK
  );
}

/** asOf 일 번호 — 필수 인자, YYYY-MM-DD 가 아니면 RangeError(기본값·조용한 통과 없음). */
function asOfDay(asOf: string): number {
  const n = isoDayNumber(asOf);
  if (n === null) throw new RangeError(`exposure: asOf 는 YYYY-MM-DD 여야 한다 (${String(asOf)})`);
  return n;
}

function freshAt(m: Pick<ContentMeta, 'verifiedAt'>, day: number): boolean {
  const v = isoDayNumber(m.verifiedAt);
  if (v === null) return false;
  const age = day - v;
  return age >= 0 && age <= STALE_DAYS;
}

/**
 * 검수 유효(M-1): verifiedAt 이 달력상 날짜이고 0 ≤ (asOf − verifiedAt) ≤ STALE_DAYS.
 *   누락·형식 오류·기준일 이후 날짜는 false(fail-closed). asOf 가 YYYY-MM-DD 가 아니면 RangeError.
 */
export function isFresh(m: Pick<ContentMeta, 'verifiedAt'>, asOf: string): boolean {
  return freshAt(m, asOfDay(asOf));
}

/** 노출 가능한 검수 기록: isVerified ∧ isFresh. */
function okMeta(m: Pick<ContentMeta, 'reviewStatus' | 'reviewerType' | 'verifiedAt'>, day: number): boolean {
  return isVerified(m) && freshAt(m, day);
}

function requirementOk(cat: EngineCatalog, r: ResolvedRequirement, day: number): boolean {
  const at = cat.animalTypes.get(r.animalTypeId);
  if (!at || at.status !== 'ACTIVE') return false;
  return (
    okMeta(r.review.animalType, day) &&
    okMeta(r.review.requirement, day) &&
    okMeta(r.review.item, day) &&
    okMeta(r.review.careProfile, day)
  );
}

/** AnimalType ACTIVE ∧ AnimalType·requirement·SupplyItem·CareProfile 모두 검수 완료 ∧ 유효(M1, M-1). */
export function isRequirementExposable(cat: EngineCatalog, r: ResolvedRequirement, asOf: string): boolean {
  return requirementOk(cat, r, asOfDay(asOf));
}

function animalTypeOk(cat: EngineCatalog, animalTypeId: string, day: number): boolean {
  const at = cat.animalTypes.get(animalTypeId);
  if (!at || at.status !== 'ACTIVE' || !okMeta(at, day) || !at.careProfileId) return false;
  const profile = cat.careProfiles.get(at.careProfileId);
  if (!profile || !okMeta(profile, day)) return false;
  return listResolvedRequirements(cat, at.id).some((r) => requirementOk(cat, r, day));
}

/** 타입 페이지 노출: ACTIVE ∧ AnimalType·CareProfile 검수·유효 ∧ 노출 가능한 요구사항 ≥ 1(M1, D4, M-1). */
export function isAnimalTypeExposable(cat: EngineCatalog, animalTypeId: string, asOf: string): boolean {
  return animalTypeOk(cat, animalTypeId, asOfDay(asOf));
}

/**
 * 상품 노출(불변식 3, M2·M3) — 동물 타입 단위. 규격(meetsMinSpec=true ∧ 동물별 최소 규격 충족) → 검수(VERIFIED ∧ 유효)
 *   → 상태(ACTIVE) ∧ 이 동물의 CareProfile 대상 ∧ 해당 요구사항 노출 가능. 선호·좋아요는 보지 않는다.
 */
export function isProductExposable(cat: EngineCatalog, animalTypeId: string, p: ProductForExposure, asOf: string): boolean {
  return exposedVerdict(cat, animalTypeId, p, asOfDay(asOf)) !== null;
}

export type ProductForExposure = Pick<
  CuratedProductRec,
  'status' | 'meetsMinSpec' | 'reviewStatus' | 'reviewerType' | 'verifiedAt' | 'supplyItemId' | 'careProfileIds' | 'specValues'
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
  day: number,
): Omit<ExposableProduct<unknown>, 'product'> | null {
  if (p.status !== 'ACTIVE' || p.meetsMinSpec !== true || !okMeta(p, day)) return null;
  const at = cat.animalTypes.get(animalTypeId);
  if (!at || !at.careProfileId) return null;
  if (!Array.isArray(p.careProfileIds) || !p.careProfileIds.includes(at.careProfileId)) return null;
  const r = resolveRequirement(cat, animalTypeId, p.supplyItemId);
  if (!r || !requirementOk(cat, r, day)) return null;
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
  asOf: string,
): ExposableProduct<P>[] {
  const day = asOfDay(asOf);
  const rows: Array<ExposableProduct<P> & { i: number }> = [];
  products.forEach((product, i) => {
    const v = exposedVerdict(cat, animalTypeId, product, day);
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

/** 후기 레코드 자체: APPROVED ∧ verifiedUsage(불변식 7). 공개 노출 판정은 isTestimonialPublic(동물 타입까지). */
export function isTestimonialExposable(t: Pick<TestimonialRec, 'status' | 'verifiedUsage'>): boolean {
  return t.status === 'APPROVED' && t.verifiedUsage === true;
}

/**
 * 후기 공개 노출(디자인 리뷰 F5, fail-closed): isTestimonialExposable ∧ 대상 animalTypeId 가 노출 타입(isAnimalTypeExposable).
 *   비노출(PLANNED·미검수·강등) 동물의 후기는 ws-data·HTML 어디에도 나가지 않는다. 프리렌더·클라이언트 공용.
 */
export function isTestimonialPublic(
  cat: EngineCatalog,
  t: Pick<TestimonialRec, 'status' | 'verifiedUsage' | 'animalTypeId'>,
  asOf: string,
): boolean {
  const day = asOfDay(asOf);
  return isTestimonialExposable(t) && typeof t.animalTypeId === 'string' && animalTypeOk(cat, t.animalTypeId, day);
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
 * 준비 세트 노출: 세트 VERIFIED·유효 ∧ 동물의 CareProfile 과 일치 ∧ 항목 ≥ 1 ∧ 모든 항목의 요구사항이 이 동물에서 노출 가능.
 */
export function isBundleExposable(
  cat: EngineCatalog,
  animalTypeId: string,
  b: Pick<SetupBundleRec, 'careProfileId' | 'itemIds' | 'reviewStatus' | 'reviewerType' | 'verifiedAt'>,
  asOf: string,
): boolean {
  const day = asOfDay(asOf);
  if (!okMeta(b, day)) return false;
  const at = cat.animalTypes.get(animalTypeId);
  if (!at || !at.careProfileId || at.careProfileId !== b.careProfileId) return false;
  if (!Array.isArray(b.itemIds) || b.itemIds.length === 0) return false;
  return b.itemIds.every((itemId) => {
    const r = resolveRequirement(cat, animalTypeId, itemId);
    return r !== null && requirementOk(cat, r, day);
  });
}

/** 호환 규칙(공개 카탈로그·클라 판정 입력): VERIFIED ∧ 유효만. */
export function isCompatRuleExposable(
  rule: Pick<CompatibilityRuleRec, 'reviewStatus' | 'reviewerType' | 'verifiedAt'>,
  asOf: string,
): boolean {
  return okMeta(rule, asOfDay(asOf));
}

const PHOTO_LICENSES: readonly string[] = ['CC0', 'CC_BY', 'CC_BY_SA', 'SITE_LICENSE', 'PERMISSION'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTTPS_URL = /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/;

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** CC 라이선스 증서 URL 허용목록(S1 M-3): 호스트 creativecommons.org 정확, https, 경로 형식 고정. */
const CC_LICENSE_URL = /^https:\/\/creativecommons\.org\/(licenses\/(by|by-sa)\/(2\.0|2\.5|3\.0|4\.0)|publicdomain\/zero\/(1\.0))\/(?:deed\.[a-z]{2}(?:-[a-z]{2,4})?)?$/;

export interface CcLicenseRef {
  /** 시드 license 값과 대응: CC_BY ↔ by, CC_BY_SA ↔ by-sa, CC0 ↔ zero. */
  license: 'CC_BY' | 'CC_BY_SA' | 'CC0';
  version: string;
  /** 표시명 "CC BY 4.0" · "CC BY-SA 4.0" · "CC0 1.0". */
  name: string;
}

/** licenseUrl → CC 라이선스(허용목록 밖·형식 오류는 null). */
export function parseCcLicenseUrl(url: unknown): CcLicenseRef | null {
  if (typeof url !== 'string') return null;
  const m = CC_LICENSE_URL.exec(url);
  if (!m) return null;
  if (m[4]) return { license: 'CC0', version: m[4], name: `CC0 ${m[4]}` };
  return m[2] === 'by'
    ? { license: 'CC_BY', version: m[3], name: `CC BY ${m[3]}` }
    : { license: 'CC_BY_SA', version: m[3], name: `CC BY-SA ${m[3]}` };
}

/**
 * 사진 상태 허용목록(S-R4 L-E): 운영자가 사용권을 확인해 쓸 수 있게 한 사진만. SLOT(빈 자리)·알 수 없는 값은 사용 불가.
 *   시드 초안의 상태는 SLOT 뿐이고, 사용 가능 상태 이름은 'READY'(이미지-소싱 절차의 "준비 완료"). validate I01 이 같은 집합을 강제한다.
 */
export const PHOTO_USABLE_STATUSES = ['READY'] as const;

/**
 * 사진 사용 가능(불변식 1, I01·I02·C6): status ∈ PHOTO_USABLE_STATUSES ∧ 허용 라이선스 ∧ 출처·https 원본 URL(점 있는 호스트)
 *   ·내려받은 날짜(달력상 YYYY-MM-DD) 기록 ∧ CC0 외엔 저작자
 *   ∧ CC_BY·CC_BY_SA 는 같은 종류의 creativecommons.org 증서 licenseUrl(M-3 — 없으면 표기 불가 → 사용 불가).
 *   scripts/lib/seed-exposure.mjs isPhotoUsableRow 와 정확히 같은 판정(패리티 테스트).
 */
export function isPhotoUsable(
  p: Pick<PhotoRec, 'status' | 'license' | 'source' | 'sourceUrl' | 'downloadedAt' | 'author' | 'licenseUrl'>,
): boolean {
  if (!(PHOTO_USABLE_STATUSES as readonly unknown[]).includes(p.status)) return false;
  if ((p.license === 'CC_BY' || p.license === 'CC_BY_SA') && parseCcLicenseUrl(p.licenseUrl)?.license !== p.license) return false;
  if (typeof p.license !== 'string' || !PHOTO_LICENSES.includes(p.license)) return false;
  if (!nonEmpty(p.source)) return false;
  if (typeof p.sourceUrl !== 'string' || !HTTPS_URL.test(p.sourceUrl)) return false;
  if (typeof p.downloadedAt !== 'string' || !ISO_DATE.test(p.downloadedAt) || isoDayNumber(p.downloadedAt) === null) return false;
  return p.license === 'CC0' || nonEmpty(p.author);
}
