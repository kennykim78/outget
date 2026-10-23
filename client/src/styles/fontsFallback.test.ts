// 지표 맞춤 대체 글꼴(K-F1 (c)) — fonts-fallback.css face 형태 + --ws-font-sans 스택 순서 + 진입 import 순서.
import { describe, expect, it } from 'vitest';
import fallbackCss from './fonts-fallback.css?raw';
import tokensCss from './tokens.css?raw';
import mainSrc from '../main.tsx?raw';

const faces = (css: string) => css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
const desc = (face: string, name: string) => face.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1].trim();
const HANGUL_RANGE = 'U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7A3, U+D7B0-D7FF';

/** unicode-range 문자열 → [시작, 끝] 목록 */
const ranges = (r: string) =>
  r.split(',').map((p) => {
    const [a, b] = p.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)] as const;
  });

describe('fonts-fallback.css — local() 대체 face', () => {
  const all = faces(fallbackCss);

  it('face 4개: Noto·Malgun × Regular(100 599)·Bold(600 900)', () => {
    expect(all).toHaveLength(4);
    const got = all.map((f) => [desc(f, 'font-family'), desc(f, 'font-weight'), desc(f, 'size-adjust')]);
    expect(got).toEqual([
      ["'WS Fallback Noto'", '100 599', '93.94%'],
      ["'WS Fallback Noto'", '600 900', '93.94%'],
      ["'WS Fallback Malgun'", '100 599', '86.43%'],
      ["'WS Fallback Malgun'", '600 900', '86.43%'],
    ]);
  });

  it('src 는 local() 만 — url·외부 출처 0(불변식 ①)', () => {
    expect(fallbackCss).not.toMatch(/url\(/);
    for (const f of all) {
      const src = desc(f, 'src') ?? '';
      expect(src.split(/,\s*/).every((s) => /^local\('[^']+'\)$/.test(s))).toBe(true);
    }
  });

  it('unicode-range 는 한글 블록만 — 라틴·숫자·기호(U+0000-2FFF 중 자모 외)는 덮지 않는다', () => {
    for (const f of all) {
      const r = desc(f, 'unicode-range') ?? '';
      expect(r).toBe(HANGUL_RANGE);
      for (const cp of [0x41, 0x61, 0x30, 0x20, 0xb7, 0xd7, 0x2013, 0x203a]) {
        expect(ranges(r).some(([a, b]) => cp >= a && cp <= b)).toBe(false);
      }
      for (const ch of '가힣골든햄스터ㄱㅎ') {
        const cp = ch.codePointAt(0)!;
        expect(ranges(r).some(([a, b]) => cp >= a && cp <= b)).toBe(true);
      }
    }
  });
});

describe('--ws-font-sans 스택 순서', () => {
  const stack = tokensCss.match(/--ws-font-sans:\s*([^;]+);/)?.[1] ?? '';
  const fam = stack.split(',').map((s) => s.trim());

  it('Pretendard Variable → Pretendard → WS Fallback Noto → WS Fallback Malgun → 시스템 스택', () => {
    expect(fam.slice(0, 4)).toEqual(['"Pretendard Variable"', 'Pretendard', '"WS Fallback Noto"', '"WS Fallback Malgun"']);
    expect(fam.slice(4)).toEqual([
      '-apple-system',
      'BlinkMacSystemFont',
      '"Apple SD Gothic Neo"',
      '"Noto Sans KR"',
      'system-ui',
      'sans-serif',
    ]);
  });
});

describe('main.tsx 진입 CSS 순서', () => {
  it('fonts-first → fonts-fallback → tokens (모든 경로가 같은 진입 CSS)', () => {
    // 줄 시작 고정 — 주석 처리된 import 는 통과시키지 않는다(QA 64 D1)
    const first = mainSrc.search(/^import '\.\/styles\/fonts-first\.css';\r?$/m);
    const fb = mainSrc.search(/^import '\.\/styles\/fonts-fallback\.css';\r?$/m);
    const tok = mainSrc.search(/^import '\.\/styles\/tokens\.css';\r?$/m);
    expect(first).toBeGreaterThan(-1);
    expect(fb).toBeGreaterThan(first);
    expect(tok).toBeGreaterThan(fb);
    // dev 전용 분기 안이 아니다
    expect(mainSrc.slice(0, fb)).not.toMatch(/if\s*\(import\.meta\.env\.DEV\)\s*\{[^}]*$/);
  });
});
