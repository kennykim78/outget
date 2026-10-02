// buildSearchLinks — 외부 검색 딥링크(PRD US-012). 순수 함수.
//   검색 결과 페이지로 가는 <a> href 만 만든다(새 탭, rel noopener). 가격·이미지·재고 수집 0, 제휴 태그 0(불변식 1·4).
//   키워드는 buildSearchKeyword 결과를 그대로 받는다. 공백 정리 후 비면 링크 없음.

export type SearchProvider = 'COUPANG' | 'NAVER';

export interface SearchLink {
  provider: SearchProvider;
  href: string;
}

const BASES: ReadonlyArray<readonly [SearchProvider, string, string]> = [
  ['COUPANG', 'https://www.coupang.com/np/search', 'q'],
  ['NAVER', 'https://search.shopping.naver.com/search/all', 'query'],
];

export function buildSearchLinks(keyword: string): SearchLink[] {
  const kw = typeof keyword === 'string' ? keyword.replace(/\s+/g, ' ').trim() : '';
  if (kw === '') return [];
  return BASES.map(([provider, base, param]) => ({ provider, href: `${base}?${param}=${encodeURIComponent(kw)}` }));
}
