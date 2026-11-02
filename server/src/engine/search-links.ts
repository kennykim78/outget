// buildSearchLinks — 외부 검색 딥링크(PRD US-012). 순수 함수.
//   검색 결과 페이지로 가는 <a> href 만 만든다(새 탭, rel noopener). 가격·이미지·재고 수집 0(불변식 1), 수수료 데이터 0(불변식 4).
//   키워드는 buildSearchKeyword 결과를 그대로 받는다. 공백 정리 후 비면 링크 없음.
//   aff(선택, 259): 공급자별 운영자 제휴 코드 — 레지스트리(providers.ts) affiliate.codeRe 를 통과할 때만 그 공급자 링크를
//   kind AFFILIATE(href = prefix + code)로 바꾼다. 형식 위반·제휴 없는 공급자·aff 없음 → kind SEARCH(지금과 같은 href).
//   링크 개수·순서(COUPANG → NAVER)는 aff 와 무관하다(불변식 ③).
import { PROVIDERS, SEARCH_PROVIDER_ORDER, affiliateHref, type SearchProvider } from './providers.js';

export type { SearchProvider } from './providers.js';

export type SearchLinkKind = 'SEARCH' | 'AFFILIATE';

export interface SearchLink {
  provider: SearchProvider;
  /** buildSearchLinks 는 항상 채운다. 없으면 SEARCH 로 읽는다(구 ws-data v1·클라 픽스처 호환). */
  kind?: SearchLinkKind;
  href: string;
}

/** 공급자 → 운영자 제휴 코드(자체 키만 읽는다). */
export type AffiliateCodes = Readonly<Partial<Record<SearchProvider, string>>>;

export function buildSearchLinks(keyword: string, aff?: AffiliateCodes | null): SearchLink[] {
  const kw = typeof keyword === 'string' ? keyword.replace(/\s+/g, ' ').trim() : '';
  if (kw === '') return [];
  const codes = typeof aff === 'object' && aff !== null ? aff : null;
  const out: SearchLink[] = [];
  for (const provider of SEARCH_PROVIDER_ORDER) {
    const search = PROVIDERS[provider].search;
    if (search === null) continue;
    const code = codes !== null && Object.prototype.hasOwnProperty.call(codes, provider) ? codes[provider] : undefined;
    const affHref = code === undefined ? null : affiliateHref(provider, code);
    out.push(
      affHref !== null
        ? { provider, kind: 'AFFILIATE', href: affHref }
        : { provider, kind: 'SEARCH', href: `${search.base}?${search.param}=${encodeURIComponent(kw)}` },
    );
  }
  return out;
}

/** 이 링크 목록에 제휴 링크가 있는가(고지 렌더 조건 — 111 트리거). */
export function hasAffiliateLink(links: readonly SearchLink[]): boolean {
  return links.some((l) => l.kind === 'AFFILIATE');
}
