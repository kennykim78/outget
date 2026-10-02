// 엔진 순수성(PRD US-021, R2 계획 §E Purity) — src/engine/*.ts 는 './x.js' 상대 import 만,
//   fs·node:·@prisma·process.·Date·Math.random·eval·Function 금지. 클라이언트·프리렌더가 같은 소스를 쓴다.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'engine');
const files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.ts'));

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

describe('engine purity', () => {
  it('has the planned modules', () => {
    expect(files.sort()).toEqual(
      [
        'catalog.ts',
        'domain.ts',
        'exposure.ts',
        'expr.ts',
        'index.ts',
        'public.ts',
        'resolve.ts',
        'rules.ts',
        'search-keyword.ts',
        'search-links.ts',
        'spec-check.ts',
        'types.ts',
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
