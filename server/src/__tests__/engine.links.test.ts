// R5 BE2 후속: 네이버 지도 웹 검색 딥링크 단일 헬퍼(불변식 ① — 링크만, SDK 아님). C1-SDK 허용 파일은 engine/links.ts 하나.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { naverMapSearchUrl } from '../engine/index.js';

describe('naverMapSearchUrl', () => {
  it('고정 접두사 + encodeURIComponent(query)', () => {
    expect(naverMapSearchUrl('하늘 동물병원 서울 마포구 1')).toBe(
      `https://map.naver.com/p/search/${encodeURIComponent('하늘 동물병원 서울 마포구 1')}`,
    );
  });
  it('한글·공백·슬래시·?#& 는 경로 밖으로 새지 않게 인코딩', () => {
    const u = naverMapSearchUrl('병원 A/B ?x=1#y&z');
    expect(u).toBe('https://map.naver.com/p/search/%EB%B3%91%EC%9B%90%20A%2FB%20%3Fx%3D1%23y%26z');
    const tail = u.slice('https://map.naver.com/p/search/'.length);
    expect(tail).not.toMatch(/[ /?#&가-힣]/);
  });
  it('결정적·순수', () => {
    expect(naverMapSearchUrl('a')).toBe(naverMapSearchUrl('a'));
    expect(naverMapSearchUrl('')).toBe('https://map.naver.com/p/search/');
  });
});

describe('지도 호스트 문자열은 server/src 에서 engine/links.ts 하나(SDK 허용 경로 spa.ts 제외)', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
  it('비테스트 server/src 파일', () => {
    const hits = walk(SRC)
      .map((f) => relative(SRC, f).split('\\').join('/'))
      .filter((rel) => !rel.startsWith('__tests__/') && rel !== 'middleware/spa.ts')
      .filter((rel) => /map\.naver\.com/.test(readFileSync(join(SRC, rel), 'utf8')));
    expect(hits).toEqual(['engine/links.ts']);
  });
});
