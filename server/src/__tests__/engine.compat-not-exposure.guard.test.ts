// 가드(155 계획 6절 4단계, 작업 178 — 불변식 3·6): requirementCompat 의 권장 채움은 체크리스트 △·L4 안내 전용.
//   ① 노출(exposure.ts)·시드 검증/적재(src/seed/**)·프리렌더 투영·정렬(src/prerender/**)·부팅 코드는
//      requirementCompat / requirementBaseline / minSpecBaseline / productCageCompat(작업 185, L7 표시 전용) 을 import·호출하지 않는다(소스 스캔, 주석 제외).
//   ② CuratedProduct 최소 규격 판정(checkProfileMinSpec = meetsMinSpec, checkAnimalMinSpec = 노출 규격)은
//      레거시 계산(evaluateProductStage 직접 호출)과 모든 시드 상품 × 모든 해당 동물에서 같다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkAnimalMinSpec, checkProfileMinSpec, createCatalog, evaluateProductStage, resolveRequirement } from '../engine/index.js';
import type { SpecValues } from '../engine/index.js';
import { realSeed } from './fixtures/prerender-seed.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|mts|js|mjs)$/.test(n) ? [p] : [];
  });
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const FORBIDDEN = /\b(requirementCompat|requirementBaseline|minSpecBaseline|productCageCompat)\b/;

const GUARDED = [
  join(SRC, 'engine', 'exposure.ts'),
  join(SRC, 'index.ts'),
  join(SRC, 'boot', 'known-ids.ts'),
  ...walk(join(SRC, 'seed')),
  ...walk(join(SRC, 'prerender')),
];

describe('가드 ①: 노출·검증·프리렌더 경로는 호환 가상 입력을 쓰지 않는다', () => {
  it('대상 파일 집합 전제(핵심 파일 포함)', () => {
    const rel = GUARDED.map((p) => relative(SRC, p).replace(/\\/g, '/'));
    for (const must of ['engine/exposure.ts', 'seed/validate-products.ts', 'seed/validate-engine.ts', 'seed/cli-load.ts', 'prerender/project.ts']) {
      expect(rel).toContain(must);
    }
  });
  it('requirementCompat·requirementBaseline·minSpecBaseline·productCageCompat 참조 0', () => {
    const hits = GUARDED.filter((p) => FORBIDDEN.test(stripComments(readFileSync(p, 'utf8')))).map((p) => relative(SRC, p));
    expect(hits).toEqual([]);
  });
  it('스캐너 자체 점검: 엔진 spec-check.ts 에서는 잡힌다', () => {
    expect(FORBIDDEN.test(stripComments(readFileSync(join(SRC, 'engine', 'spec-check.ts'), 'utf8')))).toBe(true);
  });
});

describe('가드 ②: 시드 상품 최소 규격 판정 = 레거시 계산', () => {
  const seed = realSeed();
  const cat = createCatalog(seed);
  const products = seed.curatedProducts;

  it('시드 상품이 있다(빈 격자 방지)', () => {
    expect(products.length).toBeGreaterThan(0);
  });

  it('checkProfileMinSpec(meetsMinSpec 단일 지점) — 프로필 기본 요구사항 제품 단계와 같다', () => {
    let n = 0;
    for (const p of products) {
      for (const cp of p.careProfileIds) {
        const base = cat.requirementsByProfile.get(cp)?.get(p.supplyItemId);
        const item = cat.supplyItems.get(p.supplyItemId);
        if (!base || !item) continue;
        const legacy = evaluateProductStage(item.specSchema, base.minSpec, base.recommendedSpec, p.specValues as SpecValues);
        const now = checkProfileMinSpec(cat, cp, p.supplyItemId, p.specValues as SpecValues);
        expect([p.id, cp, now]).toEqual([
          p.id,
          cp,
          { meets: legacy.verdict === 'OK' || legacy.verdict === 'BELOW_RECOMMENDED', verdict: legacy.verdict, reasons: legacy.reasons },
        ]);
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('checkAnimalMinSpec(노출 규격) — resolveRequirement 제품 단계와 같다(모든 해당 동물)', () => {
    let n = 0;
    for (const p of products) {
      for (const at of seed.animalTypes.filter((a) => a.careProfileId !== null && p.careProfileIds.includes(a.careProfileId))) {
        const r = resolveRequirement(cat, at.id, p.supplyItemId);
        if (!r) continue;
        const legacy = evaluateProductStage(r.item.specSchema, r.minSpec, r.recommendedSpec, p.specValues as SpecValues);
        const now = checkAnimalMinSpec(cat, at.id, p.supplyItemId, p.specValues as SpecValues);
        expect([p.id, at.id, now]).toEqual([
          p.id,
          at.id,
          { meets: legacy.verdict === 'OK' || legacy.verdict === 'BELOW_RECOMMENDED', verdict: legacy.verdict, reasons: legacy.reasons },
        ]);
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});
