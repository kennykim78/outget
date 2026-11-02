// 검색 공급자 레지스트리(258 §0, PRD US-012) — 순수 상수·순수 함수. 시계·난수·I/O·네트워크 0.
//   search    = 검색 결과 페이지 딥링크(base?param=검색어). null 이면 링크를 만들지 않는다.
//   affiliate = 공식 제휴 링크(운영자가 공급자 웹 UI 에서 직접 만든 코드 → prefix + code). null 이면 제휴 없음.
//   제휴 여부는 링크 href 형식만 바꾼다 — 노출·순서·추천 자격(불변식 ③)과 무관하다.
//   이 파일은 exposure·spec-check·resolve·rules·expr·catalog·domain·search-keyword 에서 import 하지 않는다(compliance C10-AFF-IMPORT).
//   수수료율·가격·상품 필드 자리 없음(불변식 ④). ALIEXPRESS·AMAZON 은 자리만(search·affiliate 모두 null — 링크 0).

/** 지금 링크를 만드는 공급자(렌더 순서 = SEARCH_PROVIDER_ORDER). */
export type SearchProvider = 'COUPANG' | 'NAVER';
/** 레지스트리 키 전체(자리만 있는 공급자 포함). */
export type ProviderId = SearchProvider | 'ALIEXPRESS' | 'AMAZON';

export interface ProviderSearch {
  readonly base: string;
  readonly param: string;
}

export interface ProviderAffiliate {
  /** 제휴 링크 고정 접두(https, 끝 '/'). href = prefix + code 로만 만든다. */
  readonly prefix: string;
  /** 운영자 코드 형식(258 K8: 실제 단축 URL 확인 전 잠정값). 통과 못 하면 일반 검색 링크로 폴백. */
  readonly codeRe: RegExp;
  /** 고지 문구 키(prerender copy.ts COPY.affiliate.*). */
  readonly disclosureCopyKey: 'affiliate.coupang';
}

export interface ProviderEntry {
  readonly id: ProviderId;
  readonly search: ProviderSearch | null;
  readonly affiliate: ProviderAffiliate | null;
}

/** 잠정 쿠팡 단축 코드 형식(K8 전). 영숫자 4~16자 — '/'·'?'·'@'·공백·'.'·':' 불가. */
export const COUPANG_AFFILIATE_CODE_RE = /^[A-Za-z0-9]{4,16}$/;
export const COUPANG_AFFILIATE_PREFIX = 'https://link.coupang.com/a/';

export const PROVIDERS: Readonly<Record<ProviderId, ProviderEntry>> = Object.freeze({
  COUPANG: Object.freeze({
    id: 'COUPANG',
    search: Object.freeze({ base: 'https://www.coupang.com/np/search', param: 'q' }),
    affiliate: Object.freeze({ prefix: COUPANG_AFFILIATE_PREFIX, codeRe: COUPANG_AFFILIATE_CODE_RE, disclosureCopyKey: 'affiliate.coupang' }),
  }),
  NAVER: Object.freeze({
    id: 'NAVER',
    search: Object.freeze({ base: 'https://search.shopping.naver.com/search/all', param: 'query' }),
    affiliate: null,
  }),
  ALIEXPRESS: Object.freeze({ id: 'ALIEXPRESS', search: null, affiliate: null }),
  AMAZON: Object.freeze({ id: 'AMAZON', search: null, affiliate: null }),
}) as Readonly<Record<ProviderId, ProviderEntry>>;

/** 링크 렌더 순서 고정(COUPANG → NAVER). 제휴 여부로 바뀌지 않는다. */
export const SEARCH_PROVIDER_ORDER: readonly SearchProvider[] = Object.freeze(['COUPANG', 'NAVER'] as const);

/** 제휴 코드가 이 공급자의 형식인가(자체 문자열·codeRe 통과). 제휴 없는 공급자는 false. */
export function isAffiliateCode(provider: ProviderId, code: unknown): code is string {
  const aff = Object.prototype.hasOwnProperty.call(PROVIDERS, provider) ? PROVIDERS[provider].affiliate : null;
  return aff !== null && typeof code === 'string' && aff.codeRe.test(code);
}

/** 제휴 href(prefix + code) — 코드 형식이 아니면 null. */
export function affiliateHref(provider: ProviderId, code: unknown): string | null {
  if (!isAffiliateCode(provider, code)) return null;
  return `${(PROVIDERS[provider].affiliate as ProviderAffiliate).prefix}${code}`;
}

/** affiliateHref 역함수 — prefix 로 시작하고 나머지가 codeRe 를 통과할 때만 code, 아니면 null. */
export function affiliateCodeFromHref(provider: ProviderId, href: unknown): string | null {
  const aff = Object.prototype.hasOwnProperty.call(PROVIDERS, provider) ? PROVIDERS[provider].affiliate : null;
  if (aff === null || typeof href !== 'string' || !href.startsWith(aff.prefix)) return null;
  const code = href.slice(aff.prefix.length);
  return aff.codeRe.test(code) ? code : null;
}
