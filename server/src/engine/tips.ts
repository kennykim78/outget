// 저렴 대체 팁(budget-tips.json, kind=REFERENCE) — 외부 글 참조 규칙의 단일 출처(Kenny 2026-11-22, 302 r2 O-4).
//   순수 모듈. 노출 판정 자체는 exposure.ts isBudgetTipExposable(이 모듈의 규칙을 쓴다).
//   scripts/lib/seed-exposure.mjs 가 독립 재구현(패리티 테스트 tips.parity) — 둘 중 하나만 바꾸면 시험이 깨진다.
import { STALE_DAYS, isoDayNumber } from './domain.js';
import type { SupplyCategory } from './domain.js';
import type { TipReference } from './types.js';

/**
 * /tips 화면 섹션 순서(302 §3) — 이 밖의 카테고리(TOY·ETC·BATH 등) 팁은 1차 미표시(validate W-TIP-CAT).
 *   Kenny 11/22 지시 범위 = 케이지·은신처·급수·바닥재 4종(309 m-2·310 LOW-3 — TOY 제거). 늘리려면 PM 결정 행.
 */
export const TIP_SECTION_CATEGORIES: readonly SupplyCategory[] = ['CAGE', 'HIDE', 'WATER', 'BEDDING'];

export function isTipSectionCategory(c: unknown): c is SupplyCategory {
  return typeof c === 'string' && (TIP_SECTION_CATEGORIES as readonly string[]).includes(c);
}

/**
 * 원문 글 사이트 허용 목록(310 MED-2 — 1차 방어). 호스트(끝 점 제거 뒤) = 이 값이거나 `.이값` 으로 끝날 때만 허용(접미사 일치).
 *   이 밖의 호스트(단축 URL·리다이렉트·보관소·번역 프록시·제휴 중개·IP 리터럴 등)는 전부 V-TIP-0 ERROR + 노출 false(fail-closed).
 *   **호스트 추가는 PM 결정 행(_workspace/decisions.md)이 있어야 한다** — 글 페이지만 있는 사이트인지(판매·단축·리다이렉트 경로 없음) 확인 근거를 함께.
 *   scripts/lib/seed-exposure.mjs TIP_ARTICLE_HOSTS 와 같은 목록(패리티 시험이 동일성 확인).
 */
export const TIP_ARTICLE_HOSTS: readonly string[] = Object.freeze(['namu.wiki', 'brunch.co.kr', 'mirochuu.com', 'gall.dcinside.com', 'vegannews.co.kr']);

/** 허용 글 사이트인가(소문자·끝 점 제거 뒤 접미사 일치). */
export function isTipArticleHost(host: string): boolean {
  const h = stripTrailingDots(host.toLowerCase());
  return TIP_ARTICLE_HOSTS.some((x) => h === x || h.endsWith(`.${x}`));
}

/**
 * IP 리터럴 호스트인가(허용 목록과 별개로 거부 — 2차 방어). IPv6 `[..]`, 마지막 라벨이 숫자·0x 16진(WHATWG 가 IPv4 로 해석하는 형태).
 */
export function isIpLiteralHost(host: string): boolean {
  const h = stripTrailingDots(host.toLowerCase());
  if (h.startsWith('[') || h.includes(':')) return true;
  const last = h.slice(h.lastIndexOf('.') + 1);
  return /^(?:\d+|0x[0-9a-f]*)$/.test(last);
}

/**
 * 2차 방어(차단 목록): 판매처·상품·제휴·단축 URL 호스트(registrable 접미사 일치) — 원문은 글 페이지만(O-4). 306 D4: 단축 URL·쇼핑 호스트 보강.
 *   허용 목록(TIP_ARTICLE_HOSTS)이 1차라 지금은 이 목록에 걸릴 호스트가 허용 목록에 없다 — 허용 목록이 잘못 넓어질 때의 안전망.
 *   쿠팡 단축 도메인은 C10-AFF-HOST(제휴 호스트 리터럴은 providers.ts 만) 때문에 이 목록에 없다 — 시드에 들어오면
 *   compliance-scan C10-AFF-HOST(server/seed 는 허용 파일 밖)·C10-AFF-OUT(산출물)가 FAIL(scripts/__tests__/compliance-tips.test.mjs).
 *   호스트(끝 점 제거 뒤) = 이 값과 같거나 `.이값` 으로 끝나면 거부. scripts/lib/seed-exposure.mjs 와 같은 목록(시험이 동일성 확인).
 */
export const TIP_COMMERCE_HOSTS: readonly string[] = Object.freeze([
  // 오픈마켓·종합몰·가격 비교
  'coupang.com', 'gmarket.co.kr', '11st.co.kr', 'auction.co.kr', 'ssg.com', 'emart.com', 'lotteon.com', 'lotteimall.com',
  'wemakeprice.com', 'tmon.co.kr', 'interpark.com', 'kurly.com', 'musinsa.com', 'homeplus.co.kr', 'gsshop.com', 'cjonmall.com',
  'hmall.com', 'danawa.com', 'enuri.com',
  'smartstore.naver.com', 'shopping.naver.com', 'brand.naver.com', 'search.shopping.naver.com',
  'shop.kakao.com', 'store.kakao.com', 'gift.kakao.com',
  // 생활용품·가구·창고형
  'daiso.co.kr', 'daisomall.co.kr', 'ikea.com', 'ohou.se', 'costco.co.kr', 'costco.com',
  // 해외 직구
  'aliexpress.com', 'aliexpress.us', 'temu.com', 'amazon.com', 'amazon.co.jp', 'ebay.com', 'qoo10.com', 'qoo10.jp',
  'shopee.com', 'shopee.sg', 'shopee.tw', 'shopee.co.id', 'shopee.com.my', 'shopee.ph', 'shopee.vn', 'shopee.co.th',
  'iherb.com', 'taobao.com', 'tmall.com', '1688.com', 'rakuten.co.jp',
  // 반려동물 쇼핑
  'petfriends.co.kr', 'aboutpet.co.kr',
  // 단축 URL·링크 모음(목적지를 숨긴다)
  'ali.ski', 'amzn.to', 'link.naver.com', 'naver.me', 'bit.ly', 'han.gl', 'vo.la', 'tinyurl.com', 'me2.do', 'linktr.ee',
  'inpock.co.kr', 'goo.gl', 't.co', 'is.gd', 'cutt.ly', 'shorturl.at', 'rebrand.ly', 'buly.kr', 'url.kr', 'lrl.kr',
]);

/** 호스트 끝 점 제거(`a.com.` → `a.com`). */
export function stripTrailingDots(host: string): string {
  let h = host;
  while (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/** 판매처·단축 URL 호스트인가(소문자·끝 점 제거 뒤 접미사 일치 — 306 D2 `host.` 우회 차단). */
export function isTipCommerceHost(host: string): boolean {
  const h = stripTrailingDots(host.toLowerCase());
  return TIP_COMMERCE_HOSTS.some((x) => h === x || h.endsWith(`.${x}`));
}

/** 2단계 공개 접미사 — seed/hostname.ts MULTI_LABEL_SUFFIXES 와 같은 목록(엔진은 seed 를 import 하지 않는다 — 시험이 동일성 확인). */
export const TIP_MULTI_LABEL_SUFFIXES: readonly string[] = Object.freeze([
  'co.kr', 'or.kr', 'go.kr', 'ac.kr', 'ne.kr', 're.kr', 'pe.kr', 'ms.kr', 'hs.kr', 'es.kr', 'sc.kr', 'kg.kr', 'mil.kr',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'nhs.uk',
  'com.au', 'org.au', 'gov.au', 'edu.au',
  'co.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.cn',
  'co.nz', 'org.nz',
]);

/** 총괄 ②(b): 위험 태그가 있는 팁은 서로 다른 사이트 도메인 참조가 이 수 이상일 때만 노출(1곳이면 숨김 + validate W-TIP-REF2). */
export const TIP_HAZARD_MIN_DOMAINS = 2;

/** 제휴·추적 쿼리 키(대소문자 무시, utm_* 접두 포함). */
const AFF_QUERY_KEY = /^(?:aff|affiliate|aff_?id|aff_?code|ref|referrer|refer|partner|partner_?id|tracking|track|subid|sub_?id|clickid|click_?id|pid|ad|adid|ad_?id|lptag|itemid|vendoritemid|productid|goodsno|utm_[a-z0-9_]*)$/i;

/** 상품 상세 경로 조각(대소문자 무시) — 글 페이지가 아니다. */
const PRODUCT_PATH = /\/(?:products?|goods|vp\/products|item|items|itm|dp|gp\/product|shop|store|cart|deal|deals)(?:\/|$)/i;

/**
 * 원문 URL 문제(없으면 null). https ∧ 점 있는 호스트 ∧ userinfo·포트 없음 ∧ 원문 authority = hostname 그대로
 *   ∧ IP 리터럴 아님 ∧ 판매처·단축 URL 호스트 아님(2차) ∧ 허용 글 사이트(TIP_ARTICLE_HOSTS, 1차) ∧ 상품 경로 아님 ∧ 제휴·추적 쿼리 없음 ∧ 프래그먼트 없음.
 */
export function tipReferenceUrlProblem(url: unknown): string | null {
  if (typeof url !== 'string' || url.trim() !== url || url === '') return 'URL 문자열이 아니다';
  if (!/^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/.test(url)) return 'https URL(점 있는 호스트)이어야 한다';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'URL 파싱 실패';
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return 'https·userinfo/포트 없음이어야 한다';
  const rest = url.slice('https://'.length);
  const next = rest.charAt(u.hostname.length);
  if (!rest.startsWith(u.hostname) || !(next === '' || next === '/' || next === '?' || next === '#')) return '호스트 표기가 정규형이 아니다(대소문자·인코딩)';
  // 306 D2: WHATWG 는 끝 점(`host.`)을 hostname 에 남긴다 — 제거한 뒤 판매처 판정(우회 차단), 그 다음 비정규형으로도 거부(fail-closed).
  const host = stripTrailingDots(u.hostname);
  if (isIpLiteralHost(host)) return `IP 리터럴 호스트(${host}) — 글 사이트 도메인만`;
  if (isTipCommerceHost(host)) return `판매처·상품·단축 URL 호스트(${host}) — 글 페이지만`;
  if (!isTipArticleHost(host)) return `허용 글 사이트 밖 호스트(${host}) — TIP_ARTICLE_HOSTS 만(추가는 PM 결정 행)`;
  if (host !== u.hostname || !host.includes('.')) return '호스트 끝 점(.) 없이 정규형 호스트만';
  if (PRODUCT_PATH.test(u.pathname)) return '상품·판매 경로로 보인다 — 글 페이지만';
  for (const k of u.searchParams.keys()) if (AFF_QUERY_KEY.test(k)) return `제휴·추적 쿼리 키(${k}) — 원문 글 주소만`;
  if (u.hash !== '') return '프래그먼트(#) 없이 원문 글 주소만';
  return null;
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const REF_KEYS = ['title', 'url', 'siteName', 'checkedAt'];

/**
 * 참조 하나가 노출 가능한가: 키 정확히 4개 ∧ title·siteName 비지 않음 ∧ URL 규칙 ∧ checkedAt 달력 날짜 ∧ 0 ≤ asOf − checkedAt ≤ STALE_DAYS
 *   (링크 확인 나이 — 오래된 링크는 내용이 바뀌었을 수 있어 비노출, fail-closed).
 */
export function isTipReferenceValid(r: unknown, asOfDay: number): r is TipReference {
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return false;
  const rec = r as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.length !== REF_KEYS.length || !keys.every((k) => REF_KEYS.includes(k))) return false;
  if (!nonEmpty(rec.title) || !nonEmpty(rec.siteName)) return false;
  if (tipReferenceUrlProblem(rec.url) !== null) return false;
  const d = isoDayNumber(rec.checkedAt);
  if (d === null) return false;
  const age = asOfDay - d;
  return age >= 0 && age <= STALE_DAYS;
}

/** 참조 ≥ 1 ∧ 모두 유효. */
export function tipReferencesOk(refs: unknown, asOfDay: number): boolean {
  return Array.isArray(refs) && refs.length > 0 && refs.every((r) => isTipReferenceValid(r, asOfDay));
}

/**
 * 원문 URL → 사이트 도메인(registrable domain, 소문자 ASCII). URL 규칙(tipReferenceUrlProblem) 통과분만 값, 아니면 null.
 *   총괄 ②(b) 「서로 다른 도메인 2곳」 셈 — 서브도메인(m.a.com·blog.a.com)은 같은 곳.
 */
export function tipReferenceDomain(url: unknown): string | null {
  if (tipReferenceUrlProblem(url) !== null) return null;
  const labels = stripTrailingDots(new URL(url as string).hostname).split('.');
  const n = TIP_MULTI_LABEL_SUFFIXES.includes(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.length < n ? null : labels.slice(-n).join('.');
}

/** 참조들의 서로 다른 사이트 도메인 수(판정 불가 URL 은 세지 않는다 — fail-closed). */
export function tipDistinctDomainCount(refs: unknown): number {
  if (!Array.isArray(refs)) return 0;
  const ds = new Set<string>();
  for (const r of refs) {
    const d = typeof r === 'object' && r !== null ? tipReferenceDomain((r as Record<string, unknown>).url) : null;
    if (d !== null) ds.add(d);
  }
  return ds.size;
}

/** 위험 태그 팁의 참조 도메인 조건(총괄 ②(b)): 태그 없으면 true, 있으면 서로 다른 도메인 ≥ TIP_HAZARD_MIN_DOMAINS. */
export function tipHazardSourcesOk(hazards: unknown, refs: unknown): boolean {
  if (!Array.isArray(hazards) || hazards.length === 0) return true;
  return tipDistinctDomainCount(refs) >= TIP_HAZARD_MIN_DOMAINS;
}

// ── 총괄 결정 ORDERS 11/22 18:4x — 수의 검수 표시(vetReview)·요약 원문 대조 기록(summaryCheck) ─────────────
//   scripts/lib/seed-exposure.mjs 가 독립 재구현(패리티 시험). 둘 중 하나만 바꾸면 시험이 깨진다.

/**
 * ① 되돌리기 쉬운 플래그: true 면 HEALTH·섭취(독성) 위험 태그 팁은 유효한 vetReview 가 있을 때만 노출.
 *   false 로 바꾸면 vetReview 요구만 꺼진다(summaryCheck·나머지 조건은 그대로). seed-exposure.mjs TIP_VET_REVIEW_REQUIRED 와 같은 값.
 */
export const TIP_VET_REVIEW_REQUIRED = true;

/** vetReview.reviewerType 허용값 — 불변식 7 HEALTH 최소 등급(VET_PUBLISHED_SOURCE) 이상. AI_DRAFT·OPERATOR·EXPERIENCED_KEEPER 불가. */
export const TIP_VET_REVIEWER_TYPES: readonly string[] = Object.freeze(['VET_PUBLISHED_SOURCE', 'OFFICIAL_SOURCE', 'VET']);

const VET_REVIEW_KEYS = ['reviewerType', 'reviewedAt', 'source'];
const SUMMARY_CHECK_KEYS = ['sources', 'checkedAt', 'checkedBy'];

/** 수의 검수 표시가 필요한 팁인가: contentKind HEALTH ∨ 독성·섭취 위험 태그(TIP_HEALTH_HAZARDS — INGESTION 포함). */
export function tipNeedsVetReview(contentKind: unknown, hazards: unknown): boolean {
  if (contentKind === 'HEALTH') return true;
  return Array.isArray(hazards) && hazards.some((h) => h === 'TOXIC_MATERIAL' || h === 'INGESTION');
}

/** checkedBy 가 AI 초안 표지인가(대소문자·공백·하이픈 무시 — `ai draft`·`AI-DRAFT` 도 같다). */
export function isAiDraftMarker(v: unknown): boolean {
  // NFKC(전각→반각) 후 영문자 외 전부 제거 → AIDRAFT 포함이면 AI 초안 표지(AI__DRAFT·AI_DRAFT(검토)·ＡＩ_ＤＲＡＦＴ·폭 없는 문자 변형 포함). QA D1.
  return typeof v === 'string' && v.normalize('NFKC').toUpperCase().replace(/[^A-Z]/g, '').includes('AIDRAFT');
}

const exactKeys = (rec: Record<string, unknown>, keys: readonly string[]): boolean => {
  const ks = Object.keys(rec);
  return ks.length === keys.length && ks.every((k) => keys.includes(k));
};

const dayAgeOk = (v: unknown, asOfDay: number): boolean => {
  const d = isoDayNumber(v);
  if (d === null) return false;
  const age = asOfDay - d;
  return age >= 0 && age <= STALE_DAYS;
};

/**
 * vetReview 가 노출 근거로 유효한가: 객체 ∧ 키 정확히 {reviewerType, reviewedAt, source}
 *   ∧ reviewerType ∈ TIP_VET_REVIEWER_TYPES ∧ reviewedAt 달력 날짜 ∧ 0 ≤ asOf − reviewedAt ≤ STALE_DAYS ∧ source 비지 않은 문자열.
 */
export function isTipVetReviewValid(v: unknown, asOfDay: number): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  if (!exactKeys(rec, VET_REVIEW_KEYS)) return false;
  if (typeof rec.reviewerType !== 'string' || !TIP_VET_REVIEWER_TYPES.includes(rec.reviewerType)) return false;
  if (!nonEmpty(rec.source)) return false;
  return dayAgeOk(rec.reviewedAt, asOfDay);
}

/**
 * summaryCheck(AI 요약 원문 대조 기록)가 노출 근거로 유효한가 — 비었거나 형식이 틀리면 요약(=팁 본문) 비노출.
 *   객체 ∧ 키 정확히 {sources, checkedAt, checkedBy} ∧ sources 비지 않은 문자열 배열·중복 없음
 *   ∧ sources = 이 행 references[].url 집합(모든 참조를 대조했고, 참조 밖 주소 없음)
 *   ∧ checkedAt 달력 날짜 ∧ 0 ≤ asOf − checkedAt ≤ STALE_DAYS ∧ checkedBy 비지 않음 ∧ AI_DRAFT 아님.
 */
export function isTipSummaryCheckValid(sc: unknown, refs: unknown, asOfDay: number): boolean {
  if (typeof sc !== 'object' || sc === null || Array.isArray(sc)) return false;
  const rec = sc as Record<string, unknown>;
  if (!exactKeys(rec, SUMMARY_CHECK_KEYS)) return false;
  if (!nonEmpty(rec.checkedBy) || isAiDraftMarker(rec.checkedBy)) return false;
  if (!dayAgeOk(rec.checkedAt, asOfDay)) return false;
  const src = rec.sources;
  if (!Array.isArray(src) || src.length === 0 || !src.every((s) => nonEmpty(s))) return false;
  if (new Set(src).size !== src.length) return false;
  if (!Array.isArray(refs) || refs.length === 0) return false;
  const urls: string[] = [];
  for (const r of refs) {
    if (typeof r !== 'object' || r === null || typeof (r as Record<string, unknown>).url !== 'string') return false;
    urls.push((r as Record<string, unknown>).url as string);
  }
  const urlSet = new Set(urls);
  if (!(src.length === urlSet.size && src.every((s) => urlSet.has(s as string)))) return false;
  // QA D4: 대조일 ≥ 가장 늦은 참조 확인일 — 참조를 다시 확인(원문이 바뀌었을 수 있음)한 뒤엔 대조도 다시 해야 한다.
  const checked = isoDayNumber(rec.checkedAt);
  for (const r of refs) {
    const rd = isoDayNumber((r as Record<string, unknown>).checkedAt);
    if (rd === null || checked === null || checked < rd) return false;
  }
  return true;
}

/**
 * 총괄 ①② 검수 기록 조건(노출 판정의 일부): summaryCheck 유효 ∧ (수의 검수가 필요한 팁이면 TIP_VET_REVIEW_REQUIRED → vetReview 유효).
 */
export function tipReviewRecordsOk(
  tip: { contentKind?: unknown; hazards?: unknown; references?: unknown; vetReview?: unknown; summaryCheck?: unknown },
  asOfDay: number,
): boolean {
  if (!isTipSummaryCheckValid(tip.summaryCheck, tip.references, asOfDay)) return false;
  if (TIP_VET_REVIEW_REQUIRED && tipNeedsVetReview(tip.contentKind, tip.hazards) && !isTipVetReviewValid(tip.vetReview, asOfDay)) return false;
  return true;
}
