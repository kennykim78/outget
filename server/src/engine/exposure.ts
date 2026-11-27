// 노출 판정 — 엔진에서 노출을 결정하는 유일한 모듈(불변식 3·7, A-6). 엔진 계산 자체는 상태 무관.
//   VERIFIED 만 노출, AI_DRAFT 는 VERIFIED 로 표시돼 있어도 노출하지 않는다(validate V01 이 별도로 막는다).
//   검수자 유형은 허용 목록(rank ≥ OPERATOR, L3) — 알 수 없는 값은 노출하지 않는다(fail-closed).
//   contentKind 별 최소 등급(MIN_GRADE)은 validator 에만 있다(D15).
//   M-1(R4 D5): 검수 나이 — 모든 노출 함수는 필수 asOf(YYYY-MM-DD)를 받고, 체인의 모든 ContentMeta 에
//   isVerified ∧ isFresh(verifiedAt + STALE_DAYS ≥ asOf)를 요구한다. 시계를 읽지 않는다(호출자가 기준일을 넣는다).
//   356 예외 2(Kenny 2026-11-23): 코드 고정 6종(general-info.ts)의 체인 메타 네 개(type·requirement·item·careProfile)는
//   isGeneralInfoMeta 로도 통과(okChainMeta). 상품·구성안·호환·Taxon·후기 자기 메타는 VERIFIED 만(okMeta 그대로).
import { STALE_DAYS, TIP_HEALTH_HAZARDS, isTipHazard, isoDayNumber, reviewerRank, type VetStatus } from './domain.js';
import { listResolvedRequirements, resolveRequirement } from './resolve.js';
import { checkAnimalMinSpec } from './spec-check.js';
import { isTipSectionCategory, tipHazardSourcesOk, tipReferencesOk, tipReviewRecordsOk } from './tips.js';
import { PHOTO_AI_LICENSE, PHOTO_ASSET_RE, isAiPhotoRecordOk } from './photo-ai.js';
import { generalInfoOkAt, isGeneralInfoTypeId } from './general-info.js';
import {
  COMBINING_MARK_RE,
  DEFAULT_IGNORABLE_RE,
  FEED_AVOID_WORDS,
  FEED_CLOCK_SKEW_MS,
  FEED_TITLE_DENY,
  compareFeedRows,
  feedFreshAt,
  feedStage,
  feedTitleHasPriceOrDate,
  parseFeedInstant,
  type FeedBadge, type FeedPrice, type FeedProvider, type FeedRowIn } from './feed-types.js';
import { parseTitleSpec, titleEnumPattern } from './title-spec.js';
import { evaluateRuleSet, readSpecValue, referencedSpecKeys } from './rules.js';
import { buildSearchKeyword } from './search-keyword.js';
import type {
  SpecValue,
  BudgetTipRec,
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

/** 노출 가능한 검수 기록: isVerified ∧ isFresh. 상품·구성안·호환·Taxon 은 이것만(356 M5 — GENERAL_INFO 불가). */
function okMeta(m: Pick<ContentMeta, 'reviewStatus' | 'reviewerType' | 'verifiedAt'>, day: number): boolean {
  return isVerified(m) && freshAt(m, day);
}

/**
 * 356 M3~M4: 체인 메타(AnimalType·SupplyRequirement·SupplyItem·CareProfile) 노출 판정 — okMeta ∨
 *   (체인의 animalTypeId 가 코드 고정 6종 ∧ isGeneralInfoMeta). 6종 밖 타입의 체인에 GENERAL_INFO 행(공유 용품 등)이 끼면 그 체인은 비노출.
 */
function okChainMeta(m: ContentMeta, animalTypeId: string, day: number): boolean {
  return okMeta(m, day) || (isGeneralInfoTypeId(animalTypeId) && generalInfoOkAt(m, day));
}

/**
 * Taxon(LEGAL) 내용 노출 조건: taxonId 존재 ∧ VERIFIED ∧ ≠AI_DRAFT ∧ 유효. 타입·요구사항 노출 게이트가 아니다
 *   — Kenny 2026-10-24 K-4 되돌림. 산출물에 Taxon 참조·법 정보를 실을 때만 쓴다(불변식 7).
 *   LEGAL 의 정확 등급(OFFICIAL_SOURCE)은 validator MIN_GRADE(V03)가 강제(D15).
 */
function taxonOk(cat: EngineCatalog, taxonId: string | null | undefined, day: number): boolean {
  if (typeof taxonId !== 'string' || taxonId === '') return false;
  const taxon = cat.taxa.get(taxonId);
  return taxon !== undefined && okMeta(taxon, day);
}

/** Taxon 내용·참조 공개 가능(VERIFIED ∧ ≠AI_DRAFT ∧ 유효). 노출 타입이라도 이것이 false 면 taxonId·legal 을 싣지 않는다. */
export function isTaxonExposable(cat: EngineCatalog, taxonId: string | null | undefined, asOf: string): boolean {
  return taxonOk(cat, taxonId, asOfDay(asOf));
}

function requirementOk(cat: EngineCatalog, r: ResolvedRequirement, day: number): boolean {
  const at = cat.animalTypes.get(r.animalTypeId);
  if (!at || at.status !== 'ACTIVE') return false;
  return (
    okChainMeta(r.review.animalType, at.id, day) &&
    okChainMeta(r.review.requirement, at.id, day) &&
    okChainMeta(r.review.item, at.id, day) &&
    okChainMeta(r.review.careProfile, at.id, day)
  );
}

/** AnimalType ACTIVE ∧ AnimalType·requirement·SupplyItem·CareProfile 모두 검수 완료 ∧ 유효(M1, M-1). */
export function isRequirementExposable(cat: EngineCatalog, r: ResolvedRequirement, asOf: string): boolean {
  return requirementOk(cat, r, asOfDay(asOf));
}

function animalTypeOk(cat: EngineCatalog, animalTypeId: string, day: number): boolean {
  const at = cat.animalTypes.get(animalTypeId);
  if (!at || at.status !== 'ACTIVE' || !okChainMeta(at, at.id, day) || !at.careProfileId) return false;
  const profile = cat.careProfiles.get(at.careProfileId);
  if (!profile || !okChainMeta(profile, at.id, day)) return false;
  return listResolvedRequirements(cat, at.id).some((r) => requirementOk(cat, r, day));
}

/** 타입 페이지 노출: ACTIVE ∧ AnimalType·CareProfile 검수·유효(Taxon 은 보지 않음 — K-4 되돌림) ∧ 노출 가능한 요구사항 ≥ 1(M1, D4, M-1). */
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

/**
 * 356r M1(불변식 3·7): 상품 판정용 체인 — 체인 메타 네 개 모두 okMeta(VERIFIED ∧ 유효). GENERAL_INFO(AI 초안 minSpec)
 *   체인에 연결된 상품은 meetsMinSpec 이 AI 초안 규격으로 판정된 것이라 추천 영역에 내지 않는다. validate V13 이 같은 연결을 ERROR 로 막는다.
 *   scripts/lib/seed-exposure.mjs computeExposure 의 productStrictChain 과 같은 조건(패리티 시험).
 */
function strictChainOk(r: ResolvedRequirement, day: number): boolean {
  return (
    okMeta(r.review.animalType, day) &&
    okMeta(r.review.requirement, day) &&
    okMeta(r.review.item, day) &&
    okMeta(r.review.careProfile, day)
  );
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
  if (!r || !requirementOk(cat, r, day) || !strictChainOk(r, day)) return null;
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

// ── 상품 피드(362 N5, 353 §3.1) ─────────────────────────────────
/** 피드 제외 범주(D-3/C5, 불변식 5·7): 사료·건강 품목은 피드 블록 자체가 없다. */
export const FEED_EXCLUDED_CATEGORIES: readonly string[] = Object.freeze(['FOOD', 'HEALTH']);

export interface SelectedFeedRow {
  provider: FeedProvider;
  rank: number;
  title: string;
  url: string;
  imageUrl: string | null;
  /** showPrice=false 면 null(가격 줄 제거 — 72h 초과). */
  price: FeedPrice | null;
  fetchedAt: string;
  /** LISTED_PASS 블록의 제품 단계 판정. CHECK_NEEDED 블록은 null. */
  verdict: 'OK' | 'BELOW_RECOMMENDED' | null;
  /** 제목에서 읽은 규격 값(규격 한 줄용). CHECK_NEEDED 블록은 null. */
  specValues: Record<string, SpecValue> | null;
}

export interface FeedSelection {
  badge: FeedBadge;
  /** 398(불변식 7): GENERAL_INFO 체인은 블록 자체가 없다(selectFeedRows null) — 항상 false. 공개 JSON 키 호환용. */
  generalInfo: false;
  showPrice: boolean;
  rows: SelectedFeedRow[];
}

export interface FeedSelectOptions {
  asOf: string;
  /** 빌드 시각(ms). 엔진은 시계를 읽지 않는다. */
  buildAtMs: number;
  generatedAt: string | null;
  /** 콘텐츠 린트 금지어(seed/lint.ts lintText 적중 ≥1 → true). 엔진이 seed 를 import 하지 않도록 주입. */
  isTitleBanned: (title: string) => boolean;
}

const feedNorm = (s: string): { spaced: string; stripped: string } => {
  // 373 D5: \uAE30\uBCF8 \uBB34\uC2DC \uBB38\uC790 \uC804\uBD80(NFKC \uC55E\uB4A4 \u2014 NFKC \uAC00 \uB9CC\uB4DC\uB294 \uCC44\uC6C0 \uBB38\uC790\uAE4C\uC9C0) \uC81C\uAC70 \u2014 seed/lint.ts normalizeLintText \uC640 \uAC19\uC740 \uBC94\uC704.
  const spaced = s
    .replace(DEFAULT_IGNORABLE_RE, '')
    .normalize('NFKC')
    .replace(COMBINING_MARK_RE, '') // 374 N3
    .replace(DEFAULT_IGNORABLE_RE, '')
    .replace(/\s+/g, ' ');
  return { spaced, stripped: spaced.replace(/ /g, '') };
};

/** avoid 문장에 있는 사전어가 제목에 있으면 true — 바로 앞이 「무」(무도색 등 부정)인 자리는 세지 않는다. */
function hitsAvoidWord(avoid: string | null, stripped: string): boolean {
  if (typeof avoid !== 'string' || avoid.trim() === '') return false;
  const avoidStripped = feedNorm(avoid).stripped;
  for (const w of FEED_AVOID_WORDS) {
    const word = w.replace(/\s+/g, '');
    if (!avoidStripped.includes(word)) continue;
    for (let i = stripped.indexOf(word); i !== -1; i = stripped.indexOf(word, i + 1)) {
      if (i === 0 || stripped[i - 1] !== '무') return true;
    }
  }
  return false;
}

/** minSpec·recommendedSpec 의 not_in 값에 대응하는 긍정어가 제목에 있으면 true(「소나무 베딩」). */
function hitsNotInWord(r: ResolvedRequirement, title: string): boolean {
  for (const rs of [r.minSpec, r.recommendedSpec]) {
    for (const rule of Array.isArray(rs?.rules) ? rs.rules : []) {
      if (rule?.op !== 'not_in' || !Array.isArray(rule.value)) continue;
      for (const v of rule.value) {
        const re = titleEnumPattern(r.supplyItemId, rule.key, v);
        if (re && re.test(title)) return true;
      }
    }
  }
  return false;
}

/**
 * 「많이 찾는 상품」 피드 노출 결정 — 피드는 여기 한 곳에서만 고른다(불변식 3·5·7, D-1~D-7). 순수·결정론, 입력 불변.
 *   null(블록 없음): 타입·요구사항 비노출 ∨ GENERAL_INFO 체인 ∨ 품목 FOOD·HEALTH ∨ generatedAt 없음·168h 초과.
 *   행 버림(개작 0): 타입·품목 불일치 ∨ keyword ≠ buildSearchKeyword ∨ 금지어(주입) ∨ 제목 가격·날짜(373 D2) ∨ 형식 밖·미래 fetchedAt(D3)
 *     ∨ 의료 효능어 ∨ avoid·not_in 사전어. 단계 기준 시각 = feedFreshAt(generatedAt, rows)(D4 — 가장 오래된 fetchedAt 쪽).
 *   minSpec 규칙 0 → CHECK_NEEDED(모든 행). 규칙 ≥1 → 제목에서 minSpec 이 참조하는 키 전부(규칙·when)를 범위 안 값으로
 *     읽어야 하고 MIN 판정 OK 여야 남는다(못 읽으면 버림, D-1). 권장 판정으로 verdict(OK/BELOW_RECOMMENDED).
 *   398(불변식 7 — 362 D-7 「△만」 폐기): 체인 메타 중 하나라도 GENERAL_INFO(strictChainOk 거짓) → null(블록·JSON·L4·홈 레일 0).
 *   정렬 compareFeedRows(verdict → 공급자 고정순 → rank) — 가격은 정렬 입력이 아니다. 72h 초과면 price null.
 */
export function selectFeedRows(
  cat: EngineCatalog,
  animalTypeId: string,
  supplyItemId: string,
  rows: readonly FeedRowIn[],
  opts: FeedSelectOptions,
): FeedSelection | null {
  const day = asOfDay(opts.asOf);
  if (!animalTypeOk(cat, animalTypeId, day)) return null;
  const at = cat.animalTypes.get(animalTypeId);
  const r = resolveRequirement(cat, animalTypeId, supplyItemId);
  if (!at || !r || !requirementOk(cat, r, day)) return null;
  if (!strictChainOk(r, day)) return null; // 398: GENERAL_INFO 체인에 연결된 상품은 노출하지 않는다(불변식 7)
  if (FEED_EXCLUDED_CATEGORIES.includes(r.item.category)) return null;
  // 373 D4: 단계 기준 = generatedAt·행 fetchedAt 중 가장 오래된 값(feedFreshAt — buildFeedOutputs manifest 와 같은 값). D3: 미래 → nofeed.
  const stage = feedStage(opts.buildAtMs, feedFreshAt(opts.generatedAt, rows));
  if (stage === 'nofeed') return null;
  const showPrice = stage === 'full';
  const minRules = Array.isArray(r.minSpec?.rules) ? r.minSpec.rules : [];
  const ruled = minRules.length > 0;
  const badge: FeedBadge = ruled ? 'LISTED_PASS' : 'CHECK_NEEDED';
  const needKeys = [...referencedSpecKeys(r.minSpec)];
  const keyword = buildSearchKeyword(at, r);

  const out: SelectedFeedRow[] = [];
  for (const row of rows) {
    if (!row || row.animalTypeId !== animalTypeId || row.supplyItemId !== supplyItemId || row.keyword !== keyword) continue;
    if (typeof row.title !== 'string') continue;
    const { spaced, stripped } = feedNorm(row.title);
    if (opts.isTitleBanned(row.title)) continue;
    if (feedTitleHasPriceOrDate(row.title)) continue; // 373 D2: 제목 안 가격·날짜(noprice 변형에도 남는다) → 싣지 않음
    const fAt = parseFeedInstant(row.fetchedAt);
    if (fAt === null || fAt > opts.buildAtMs + FEED_CLOCK_SKEW_MS) continue; // 373 D3: 형식 밖·미래 fetchedAt 행 버림
    if (FEED_TITLE_DENY.test(spaced) || FEED_TITLE_DENY.test(stripped)) continue;
    if (hitsAvoidWord(r.avoid, stripped) || hitsNotInWord(r, row.title)) continue;
    let verdict: SelectedFeedRow['verdict'] = null;
    let specValues: Record<string, SpecValue> | null = null;
    if (ruled) {
      const parsed = parseTitleSpec(supplyItemId, row.title);
      if (parsed === null) continue;
      if (!needKeys.every((k) => readSpecValue(r.item.specSchema, parsed, k).ok)) continue;
      if (evaluateRuleSet(r.item.specSchema, r.minSpec, parsed, 'MIN').verdict !== 'OK') continue;
      const rec = evaluateRuleSet(r.item.specSchema, r.recommendedSpec, parsed, 'RECOMMENDED').verdict;
      verdict = rec === 'OK' ? 'OK' : 'BELOW_RECOMMENDED';
      specValues = { ...parsed };
    }
    out.push({
      provider: row.provider,
      rank: row.rank,
      title: row.title,
      url: row.url,
      imageUrl: row.imageUrl,
      price: showPrice && row.price ? { amount: row.price.amount, currency: 'KRW' } : null,
      fetchedAt: row.fetchedAt,
      verdict,
      specValues,
    });
  }
  out.sort(compareFeedRows);
  return { badge, generalInfo: false, showPrice, rows: out };
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

export type BudgetTipForExposure = Pick<
  BudgetTipRec,
  'kind' | 'careProfileId' | 'supplyItemId' | 'animalTypeIds' | 'references' | 'hazards' | 'contentKind' | 'vetReview' | 'summaryCheck'
>;

/**
 * 저렴 대체 팁 노출 — REFERENCE 전용 별도 경로(Kenny 2026-11-22: 사람 검수·서명·VERIFIED 없이 노출, 불변식 7 의 명시 예외).
 *   reviewStatus·reviewerType·verifiedAt 를 보지 않는다(okMeta 미사용). 그 밖의 콘텐츠 노출 함수는 이 경로를 쓰지 않는다.
 *   조건(전부, fail-closed): kind === 'REFERENCE' ∧ 참조 ≥ 1 모두 유효(tipReferencesOk — 글 페이지 URL·확인 나이)
 *     ∧ 동물 타입 노출(ACTIVE ∧ 검수 체인 — animalTypeOk) ∧ 타입 careProfileId = 팁 careProfileId ∧ animalTypeIds 없음 또는 포함
 *     ∧ (타입, 용품) 요구사항 노출(resolveRequirement + requirementOk) ∧ 용품 카테고리가 /tips 섹션(ETC·BATH 등 미표시)
 *     ∧ 독성·섭취 위험 태그면 contentKind HEALTH(V-TIP-1 과 같은 조건)
 *     ∧ 위험 태그 ≥ 1 이면 참조 사이트 도메인 서로 다른 2곳 이상(총괄 ②(b), tipHazardSourcesOk — 1곳이면 숨김 + validate W-TIP-REF2). 고정 면책 문구 동반은 렌더러(renderTipsPage)·compliance C9-TIPS 가 강제.
 *     ∧ 총괄 ORDERS 11/22 18:4x(tipReviewRecordsOk): summaryCheck(AI 요약 원문 대조 기록) 유효 — 비면 요약=팁 본문이라 행 전체 숨김
 *       ∧ (HEALTH ∨ 독성·섭취 태그) 이면 vetReview(수의 검수 표시) 유효(TIP_VET_REVIEW_REQUIRED 플래그). 둘 다 validate W-TIP-SC·W-TIP-VET 경고.
 */
export function isBudgetTipExposable(cat: EngineCatalog, animalTypeId: string, tip: BudgetTipForExposure, asOf: string): boolean {
  const day = asOfDay(asOf);
  if (tip === null || typeof tip !== 'object' || tip.kind !== 'REFERENCE') return false;
  if (!tipReferencesOk(tip.references, day)) return false;
  if (!Array.isArray(tip.hazards) || !tip.hazards.every((h) => isTipHazard(h))) return false;
  if (tip.hazards.some((h) => TIP_HEALTH_HAZARDS.includes(h)) && tip.contentKind !== 'HEALTH') return false;
  if (!tipHazardSourcesOk(tip.hazards, tip.references)) return false;
  if (!tipReviewRecordsOk(tip, day)) return false;
  if (tip.animalTypeIds !== undefined && !(Array.isArray(tip.animalTypeIds) && tip.animalTypeIds.includes(animalTypeId))) return false;
  if (!animalTypeOk(cat, animalTypeId, day)) return false;
  const at = cat.animalTypes.get(animalTypeId);
  if (!at || at.careProfileId !== tip.careProfileId) return false;
  const item = cat.supplyItems.get(tip.supplyItemId);
  if (!item || !isTipSectionCategory(item.category)) return false;
  const r = resolveRequirement(cat, animalTypeId, tip.supplyItemId);
  return r !== null && requirementOk(cat, r, day);
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
 * 사진 출처 코드 → 원본 URL 호스트 허용목록(SEC-2 M-1, R5 B3-1). 호스트는 정확 일치(소문자, 하위 도메인 와일드카드 없음).
 *   이미지-소싱.md §1 의 무료 라이선스 출처 4종만. OWN·SELLER·AFFILIATE 는 사진(photos.json) 쪽 증빙 필드 규칙이
 *   문서에 없어 사용 불가(fail-closed) — 규칙이 정해지면 여기·seed-exposure.mjs·validate-people.ts 를 함께 바꾼다.
 *   scripts/lib/seed-exposure.mjs PHOTO_SOURCE_HOSTS · seed/validate-people.ts PHOTO_SOURCE_HOSTS 와 같다(패리티 테스트).
 */
export const PHOTO_SOURCE_HOSTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  WIKIMEDIA: Object.freeze(['commons.wikimedia.org', 'upload.wikimedia.org']),
  UNSPLASH: Object.freeze(['unsplash.com', 'images.unsplash.com']),
  PEXELS: Object.freeze(['www.pexels.com', 'pexels.com', 'images.pexels.com']),
  PIXABAY: Object.freeze(['pixabay.com', 'cdn.pixabay.com']),
});

/** https://<authority>[/?#…] 의 authority(userinfo·포트 포함 원문). */
const HTTPS_AUTHORITY = /^https:\/\/([^\s/?#]+)(?:[/?#]\S*)?$/;

/**
 * 원본 URL 이 출처 코드의 허용 호스트인가(M-1): https ∧ authority 가 허용 호스트와 정확히 같다
 *   (userinfo '@'·포트·대문자·끝 점·백슬래시·퍼센트 인코딩은 authority 가 달라져 거부). 알 수 없는 출처 코드는 false.
 */
export function isPhotoSourceUrlAllowed(source: unknown, sourceUrl: unknown): boolean {
  if (typeof source !== 'string' || typeof sourceUrl !== 'string') return false;
  if (!Object.prototype.hasOwnProperty.call(PHOTO_SOURCE_HOSTS, source)) return false;
  const m = HTTPS_AUTHORITY.exec(sourceUrl);
  if (!m) return false;
  return PHOTO_SOURCE_HOSTS[source].includes(m[1]);
}

/**
 * CC BY-SA 를 쓸 수 있는 슬롯(L8, 이미지-소싱 §1 "히어로·합성 이미지에는 쓰지 않음, 원본 그대로 쓰는 카드에만").
 *   허용목록 — 현재 장면 리스트의 카드 슬롯만. 새 슬롯(hero 등)은 목록에 추가되기 전까지 CC BY-SA 불가(fail-closed).
 */
export const CC_BY_SA_CARD_SLOT_RE = /^(?:intro-[1-9]|group-[a-z0-9]+(?:-[a-z0-9]+)*|review-side|l4-[a-z0-9]+(?:-[a-z0-9]+)*|vet-empty|done)$/;

/** CC BY-SA 사진 배치 조건: 원본 그대로(modified === false) ∧ 카드 슬롯. 다른 라이선스는 true. */
export function isCcBySaPlacementOk(p: { license?: unknown; slot?: unknown; modified?: unknown }): boolean {
  if (p.license !== 'CC_BY_SA') return true;
  return p.modified === false && typeof p.slot === 'string' && CC_BY_SA_CARD_SLOT_RE.test(p.slot);
}

/**
 * 사진 사용 가능(불변식 1, I01·I02·I03·C6): status ∈ PHOTO_USABLE_STATUSES ∧ 허용 라이선스 ∧ 출처·https 원본 URL(점 있는 호스트)
 *   ·내려받은 날짜(달력상 YYYY-MM-DD) 기록 ∧ CC0 외엔 저작자
 *   ∧ CC_BY·CC_BY_SA 는 같은 종류의 creativecommons.org 증서 licenseUrl(M-3 — 없으면 표기 불가 → 사용 불가)
 *   ∧ 출처 코드별 원본 호스트 허용목록·userinfo 거부(M-1) ∧ CC_BY_SA 는 원본 그대로·카드 슬롯(L8).
 *   354(Kenny 2026-11-23): license === AI_GENERATED 는 별도 분기 — 원본 URL·호스트·저작자 대신 생성 기록 전부
 *   (source CODEX|AGY · generatedAt · promptPath · asset · 사람 speciesCheck, photo-ai.ts isAiPhotoRecordOk). 하나라도 빠지면 사용 불가.
 *   scripts/lib/seed-exposure.mjs isPhotoUsableRow 와 정확히 같은 판정(패리티 테스트).
 */
export function isPhotoUsable(
  p: Pick<PhotoRec, 'status' | 'license' | 'source' | 'sourceUrl' | 'downloadedAt' | 'author' | 'licenseUrl'> &
    Partial<Pick<PhotoRec, 'slot' | 'modified' | 'asset' | 'promptPath' | 'generatedAt' | 'speciesCheck' | 'scope'>>,
): boolean {
  if (!(PHOTO_USABLE_STATUSES as readonly unknown[]).includes(p.status)) return false;
  if (p.license === PHOTO_AI_LICENSE) return isAiPhotoRecordOk(p as unknown as Record<string, unknown>);
  // 실사(비 AI) 행의 asset 은 선택이지만, 있으면 같은 경로 형식(빈 칸·외부 경로 금지).
  if (p.asset !== undefined && p.asset !== null && (typeof p.asset !== 'string' || !PHOTO_ASSET_RE.test(p.asset))) return false;
  if ((p.license === 'CC_BY' || p.license === 'CC_BY_SA') && parseCcLicenseUrl(p.licenseUrl)?.license !== p.license) return false;
  if (typeof p.license !== 'string' || !PHOTO_LICENSES.includes(p.license)) return false;
  if (!nonEmpty(p.source)) return false;
  if (typeof p.sourceUrl !== 'string' || !HTTPS_URL.test(p.sourceUrl)) return false;
  if (!isPhotoSourceUrlAllowed(p.source, p.sourceUrl)) return false;
  if (!isCcBySaPlacementOk(p)) return false;
  if (typeof p.downloadedAt !== 'string' || !ISO_DATE.test(p.downloadedAt) || isoDayNumber(p.downloadedAt) === null) return false;
  return p.license === 'CC0' || nonEmpty(p.author);
}
