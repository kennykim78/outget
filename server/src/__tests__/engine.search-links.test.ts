// buildSearchLinks(PRD US-012) — 검색 결과 딥링크만, 제휴·추적 파라미터 없음.
import { describe, expect, it } from 'vitest';
import { buildSearchLinks } from '../engine/index.js';

describe('buildSearchLinks', () => {
  it('쿠팡·네이버 검색 URL 2개, 키워드는 percent-encode', () => {
    const links = buildSearchLinks('골든햄스터 쳇바퀴 30cm 무소음');
    const q = encodeURIComponent('골든햄스터 쳇바퀴 30cm 무소음');
    expect(links).toEqual([
      { provider: 'COUPANG', href: `https://www.coupang.com/np/search?q=${q}` },
      { provider: 'NAVER', href: `https://search.shopping.naver.com/search/all?query=${q}` },
    ]);
  });

  it('쿼리 파라미터는 검색어 하나뿐(제휴·추적 0)', () => {
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
  });

  it('&·#·? 가 URL 구조를 깨지 않는다', () => {
    const [c] = buildSearchLinks('a&b=c#d?e');
    expect(new URL(c.href).searchParams.get('q')).toBe('a&b=c#d?e');
  });
});
