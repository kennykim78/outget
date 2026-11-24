// 엔진 순수성(PRD US-021, R2 계획 §E Purity) — src/engine/*.ts 는 './x.js' 상대 import 만,
//   fs·node:·@prisma·process.·Date·Math.random·eval·Function 금지. 클라이언트·프리렌더가 같은 소스를 쓴다.
//   R4 B1: src/shared/*.ts(이벤트 계약 — 클라이언트 @ws/events)도 같은 규칙 + DOM 전역 금지.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'engine');
const SHARED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared');
const files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.ts'));
const sharedFiles = readdirSync(SHARED_DIR).filter((f) => f.endsWith('.ts'));

const FORBIDDEN: Array<[string, RegExp]> = [
  ['process.', /\bprocess\s*\./],
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['new Date(', /\bnew\s+Date\s*\(/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['eval(', /\beval\s*\(/],
  ['Function(', /\bFunction\s*\(/],
  ['require(', /\brequire\s*\(/],
  ['fetch(', /\bfetch\s*\(/],
  ['globalThis', /\bglobalThis\b/],
  ['setTimeout', /\bset(?:Timeout|Interval)\s*\(/],
];

// shared/ 는 Node·DOM 양쪽에서 import 된다 — 어느 한쪽 전역에도 기대지 않는다.
const FORBIDDEN_SHARED: Array<[string, RegExp]> = [
  ...FORBIDDEN,
  ['window', /\bwindow\b/],
  ['document', /\bdocument\b/],
  ['navigator', /\bnavigator\b/],
  ['localStorage', /\b(?:local|session)Storage\b/],
  ['crypto', /\bcrypto\b/],
  ['TextEncoder', /\bText(?:En|De)coder\b/],
  ['Buffer', /\bBuffer\b/],
  ['Date', /\bDate\b/],
];

function specifiersOf(src: string): string[] {
  return [
    ...src.matchAll(/\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g),
    ...src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
    ...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
  ].map((m) => m[1]);
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('engine purity', () => {
  it('has the planned modules', () => {
    expect(files.sort()).toEqual(
      [
        'catalog.ts',
        'domain.ts',
        'exposure.ts',
        'expr.ts',
        // 356 M1~M10: GENERAL_INFO 등급 판정(6종 코드 고정 체인, 순수).
        'general-info.ts',
        // 286 U3c~e: 홈 A 설명 섹션 데이터 선택(프리렌더·클라 공용 단일 규칙, 순수 함수).
        'home-a.ts',
        'index.ts',
        'links.ts',
        // 354: 생성 이미지 기록 판정·종·품목 단위 사진 고르기(순수·결정론).
        'photo-ai.ts',
        'photo-resolve.ts',
        'providers.ts',
        'public.ts',
        'resolve.ts',
        'rules.ts',
        'search-keyword.ts',
        'search-links.ts',
        'spec-check.ts',
        'spec-text.ts',
        // 301: 저렴 대체 팁 참조 규칙(REFERENCE — URL·참조 유효성, 순수).
        'tips.ts',
        'types.ts',
        'ws-wire.ts',
      ].sort(),
    );
  });

  it.each(files)('%s imports only ./x.js siblings', (file) => {
    const src = readFileSync(join(ENGINE_DIR, file), 'utf8');
    const specifiers = [
      ...src.matchAll(/\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g),
      ...src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
      ...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ].map((m) => m[1]);
    for (const s of specifiers) expect(s, `${file}: ${s}`).toMatch(/^\.\/[a-z][a-z-]*\.js$/);
    expect(src).not.toMatch(/['"](?:node:|fs['"/]|@prisma)/);
  });

  it.each(files)('%s uses no impure globals', (file) => {
    const code = readFileSync(join(ENGINE_DIR, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const [name, re] of FORBIDDEN) expect(code, `${file} uses ${name}`).not.toMatch(re);
  });
});

describe('shared purity (R4 B1 — @ws/events)', () => {
  it('has the planned modules', () => {
    // R-1: forbidden-keys.ts(금지 키 단일 소스, 클라 @ws/forbidden-keys) 추가 — 아래 순수성 검사도 같이 받는다.
    // R6 C1: save-validate.ts(SaveV1 검증기, 클라 @ws/save-validate) 추가 — 같은 순수성 검사를 받는다.
    expect(sharedFiles.sort()).toEqual(['event-contract.ts', 'forbidden-keys.ts', 'save-validate.ts']);
  });

  it.each(sharedFiles)('%s imports only ./x.js siblings', (file) => {
    const src = readFileSync(join(SHARED_DIR, file), 'utf8');
    for (const s of specifiersOf(src)) expect(s, `${file}: ${s}`).toMatch(/^\.\/[a-z][a-z-]*\.js$/);
    expect(src).not.toMatch(/['"](?:node:|fs['"/]|@prisma|express)/);
  });

  it.each(sharedFiles)('%s uses no Node/DOM/impure globals', (file) => {
    const code = stripComments(readFileSync(join(SHARED_DIR, file), 'utf8'));
    for (const [name, re] of FORBIDDEN_SHARED) expect(code, `${file} uses ${name}`).not.toMatch(re);
  });
});
