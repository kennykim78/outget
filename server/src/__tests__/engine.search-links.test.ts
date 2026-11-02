// buildSearchLinks(PRD US-012) — 검색 결과 딥링크만, 추적 파라미터 없음. 259: 레지스트리(providers.ts) + 선택 제휴 코드.
import { describe, expect, it } from 'vitest';
import {
  COUPANG_AFFILIATE_PREFIX,
  PROVIDERS,
  SEARCH_PROVIDER_ORDER,
  affiliateCodeFromHref,
  affiliateHref,
  buildSearchLinks,
  hasAffiliateLink,
  type SearchLink,
} from '../engine/index.js';

/** HEAD 7ba51a1 의 buildSearchLinks 구현 그대로(기준). */
function headBuildSearchLinks(keyword: string): Array<{ provider: string; href: string }> {
  const kw = typeof keyword === 'string' ? keyword.replace(/\s+/g, ' ').trim() : '';
  if (kw === '') return [];
  return (
    [
      ['COUPANG', 'https://www.coupang.com/np/search', 'q'],
      ['NAVER', 'https://search.shopping.naver.com/search/all', 'query'],
    ] as const
  ).map(([provider, base, param]) => ({ provider, href: `${base}?${param}=${encodeURIComponent(kw)}` }));
}
const withoutKind = (ls: SearchLink[]) => ls.map(({ provider, href }) => ({ provider, href }));
const KWS = ['골든햄스터 쳇바퀴 30cm 무소음', 'a', '  a \n b  ', 'a&b=c#d?e', '   ', '', '%20/?#', '기니피그 건초 1kg'];

describe('buildSearchLinks', () => {
  it('쿠팡·네이버 검색 URL 2개, 키워드는 percent-encode, kind SEARCH', () => {
    const links = buildSearchLinks('골든햄스터 쳇바퀴 30cm 무소음');
    const q = encodeURIComponent('골든햄스터 쳇바퀴 30cm 무소음');
    expect(links).toEqual([
      { provider: 'COUPANG', kind: 'SEARCH', href: `https://www.coupang.com/np/search?q=${q}` },
      { provider: 'NAVER', kind: 'SEARCH', href: `https://search.shopping.naver.com/search/all?query=${q}` },
    ]);
  });

  it('쿼리 파라미터는 검색어 하나뿐(추적 0)', () => {
    for (const l of buildSearchLinks('a')) {
      const u = new URL(l.href);
      expect([...u.searchParams.keys()]).toHaveLength(1);
      expect(u.protocol).toBe('https:');
    }
  });

  it('공백 정리, 빈 키워드는 링크 없음', () => {
    expect(buildSearchLinks('  a \n b  ')[0].href.endsWith('q=a%20b')).toBe(true);
    expect(buildSearchLinks('   ')).toEqual([]);
    expect(buildSearchLinks(undefined as unknown as string)).toEqual([]);
    expect(buildSearchLinks('   ', { COUPANG: 'FAKE0001' })).toEqual([]);
  });

  it('&·#·? 가 URL 구조를 깨지 않는다', () => {
    const [c] = buildSearchLinks('a&b=c#d?e');
    expect(new URL(c.href).searchParams.get('q')).toBe('a&b=c#d?e');
  });
});

describe('259 단계 1 — 레지스트리·AFFILIATE', () => {
  it('(a) aff 없음·null·{} → kind 를 뺀 결과가 HEAD 출력과 같다', () => {
    for (const kw of KWS) {
      const head = headBuildSearchLinks(kw);
      expect(withoutKind(buildSearchLinks(kw))).toEqual(head);
      expect(withoutKind(buildSearchLinks(kw, null))).toEqual(head);
      expect(withoutKind(buildSearchLinks(kw, {}))).toEqual(head);
      expect(buildSearchLinks(kw).every((l) => l.kind === 'SEARCH')).toBe(true);
    }
  });

  it('(b) 유효 코드 → https://link.coupang.com/a/FAKE0001, kind AFFILIATE, 네이버는 SEARCH 그대로', () => {
    const kw = '골든햄스터 쳇바퀴 30cm 무소음';
    const ls = buildSearchLinks(kw, { COUPANG: 'FAKE0001' });
    expect(ls).toEqual([
      { provider: 'COUPANG', kind: 'AFFILIATE', href: 'https://link.coupang.com/a/FAKE0001' },
      { provider: 'NAVER', kind: 'SEARCH', href: headBuildSearchLinks(kw)[1].href },
    ]);
    expect(hasAffiliateLink(ls)).toBe(true);
    expect(hasAffiliateLink(buildSearchLinks(kw))).toBe(false);
  });

  it('(c) codeRe 위반 코드 → SEARCH 폴백(HEAD 링크와 같음)', () => {
    const bad = ['', 'abc', 'A'.repeat(17), 'FAKE/0001', 'FAKE?x=1', 'a@b.cd', 'FAKE 001', 'FAKE.001', 'javascript:x', '../FAKE', 'FAKE0001\n', 'ＦＡＫＥ0001'];
    for (const code of bad) {
      const ls = buildSearchLinks('a', { COUPANG: code });
      expect(withoutKind(ls)).toEqual(headBuildSearchLinks('a'));
      expect(hasAffiliateLink(ls)).toBe(false);
    }
    for (const code of [1234, null, {}, ['FAKE0001']] as unknown[]) {
      expect(hasAffiliateLink(buildSearchLinks('a', { COUPANG: code as string }))).toBe(false);
    }
  });

  it('(d) NAVER 에 코드를 줘도 SEARCH(제휴 없는 공급자)', () => {
    const ls = buildSearchLinks('a', { NAVER: 'FAKE0001' } as never);
    expect(withoutKind(ls)).toEqual(headBuildSearchLinks('a'));
    expect(PROVIDERS.NAVER.affiliate).toBeNull();
  });

  it('(e) 순서 COUPANG → NAVER, 개수 2 — 제휴 여부와 무관', () => {
    for (const aff of [undefined, { COUPANG: 'FAKE0001' }, { COUPANG: 'x' }]) {
      expect(buildSearchLinks('a', aff).map((l) => l.provider)).toEqual(['COUPANG', 'NAVER']);
    }
    expect(SEARCH_PROVIDER_ORDER).toEqual(['COUPANG', 'NAVER']);
  });

  it('(f) ALIEXPRESS·AMAZON 은 자리만 — 링크 0', () => {
    expect(PROVIDERS.ALIEXPRESS).toEqual({ id: 'ALIEXPRESS', search: null, affiliate: null });
    expect(PROVIDERS.AMAZON).toEqual({ id: 'AMAZON', search: null, affiliate: null });
    const ls = buildSearchLinks('a', { ALIEXPRESS: 'FAKE0001', AMAZON: 'FAKE0001' } as never);
    expect(ls.map((l) => l.provider)).toEqual(['COUPANG', 'NAVER']);
    expect(ls.some((l) => /aliexpress|amazon/i.test(l.href))).toBe(false);
  });

  it('프로토타입 키·상속 코드는 읽지 않는다', () => {
    const inherited = Object.create({ COUPANG: 'FAKE0001' }) as Record<string, string>;
    expect(hasAffiliateLink(buildSearchLinks('a', inherited))).toBe(false);
    const polluted = JSON.parse('{"__proto__":{"COUPANG":"FAKE0001"}}') as Record<string, string>;
    expect(hasAffiliateLink(buildSearchLinks('a', polluted))).toBe(false);
  });

  it('레지스트리는 얼어 있고 href 는 prefix + code 로만', () => {
    expect(Object.isFrozen(PROVIDERS)).toBe(true);
    expect(Object.isFrozen(PROVIDERS.COUPANG)).toBe(true);
    expect(COUPANG_AFFILIATE_PREFIX).toBe('https://link.coupang.com/a/');
    expect(affiliateHref('COUPANG', 'FAKE0001')).toBe('https://link.coupang.com/a/FAKE0001');
    expect(affiliateHref('NAVER', 'FAKE0001')).toBeNull();
    expect(affiliateCodeFromHref('COUPANG', 'https://link.coupang.com/a/FAKE0001')).toBe('FAKE0001');
    for (const h of ['https://link.coupang.com/a/FAKE0001/x', 'https://evil.link.coupang.com/a/FAKE0001', 'http://link.coupang.com/a/FAKE0001', 'https://link.coupang.com/b/FAKE0001']) {
      expect(affiliateCodeFromHref('COUPANG', h)).toBeNull();
    }
  });
});
