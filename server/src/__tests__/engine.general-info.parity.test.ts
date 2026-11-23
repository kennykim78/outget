// 356 M6 패리티 — 엔진(general-info.ts·exposure.ts → projectSite) ↔ 독립 재구현(scripts/lib/seed-exposure.mjs).
//   GENERAL_INFO 행 판정·코드 고정 6종·체인 노출 집합이 같아야 한다. 실시드는 메모리에서만 바꾼다(디스크 0 변경).
//   주입 값(draftedAt·crossCheck·자리표시 요구사항 행)은 테스트 전용 — 사육 사실 아님.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GENERAL_INFO_MAX_AGE_DAYS, GENERAL_INFO_TYPE_IDS, isGeneralInfoMeta, isoDayNumber, type SeedBundle } from '../engine/index.js';
import { SEED_FILES } from '../seed/common.js';
import { projectSite } from '../prerender/project.js';
import { FIXTURE_AS_OF, patch, realSeed, type Row } from './fixtures/prerender-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mjs = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'seed-exposure.mjs')).href)) as {
  GENERAL_INFO_TYPE_IDS: readonly string[];
  GENERAL_INFO_MAX_AGE_DAYS: number;
  generalInfoRowOk: (row: unknown, asOfDay: number) => boolean;
  computeExposure: (seed: Record<string, unknown[]>, asOf: string) => { ids: Record<string, Set<string>> };
};

const AS_OF = FIXTURE_AS_OF; // 2026-11-22
const DRAFTED = '2026-11-20';
const CC = { tool: 'CODEX_DISCUSS', checkedAt: '2026-11-21', result: 'AGREE' };
const GI = (extra: Row = {}): Row => ({
  reviewStatus: 'GENERAL_INFO', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, reviewBasis: null, draftedAt: DRAFTED, ...extra,
});

const rawOf = (seed: SeedBundle): Record<string, unknown[]> =>
  Object.fromEntries(Object.keys(SEED_FILES).map((k) => [k, seed[k as keyof SeedBundle] as unknown[]]));

function engineIds(seed: SeedBundle) {
  const m = projectSite(seed, AS_OF);
  return {
    animalTypes: m.types.map((t) => t.id).sort(),
    supplyRequirements: m.types.flatMap((t) => t.requirements.map((r) => r.requirementId)).sort(),
    careProfiles: m.catalog.careProfiles.map((p) => p.id).sort(),
    supplyItems: m.catalog.supplyItems.map((i) => i.id).sort(),
    curatedProducts: [...new Set(m.types.flatMap((t) => t.requirements.flatMap((r) => r.products.map((p) => p.id))))].sort(),
    setupBundles: [...new Set(m.types.flatMap((t) => t.bundles.map((b) => b.id)))].sort(),
    compatibilityRules: m.catalog.compatibilityRules.map((c) => c.id).sort(),
  };
}
function mjsIds(seed: SeedBundle) {
  const ex = mjs.computeExposure(rawOf(seed), AS_OF);
  const s = (k: string): string[] => [...ex.ids[k]].sort();
  return {
    animalTypes: s('animalTypes'),
    supplyRequirements: s('supplyRequirements'),
    careProfiles: s('careProfiles'),
    supplyItems: s('supplyItems'),
    curatedProducts: s('curatedProducts'),
    setupBundles: s('setupBundles'),
    compatibilityRules: s('compatibilityRules'),
  };
}

describe('상수 패리티', () => {
  it('GENERAL_INFO_TYPE_IDS·최대 나이 동일', () => {
    expect([...mjs.GENERAL_INFO_TYPE_IDS]).toEqual([...GENERAL_INFO_TYPE_IDS]);
    expect(mjs.GENERAL_INFO_MAX_AGE_DAYS).toBe(GENERAL_INFO_MAX_AGE_DAYS);
  });
});

describe('행 판정 패리티 — engine isGeneralInfoMeta ↔ mjs generalInfoRowOk', () => {
  const base: Row = { reviewStatus: 'GENERAL_INFO', reviewerType: 'AI_DRAFT', contentKind: 'CARE', draftedAt: DRAFTED };
  const variants: Row[] = [
    {},
    { contentKind: 'SPEC' }, { contentKind: 'LEGAL' }, { contentKind: 'OTHER' }, { contentKind: undefined },
    { reviewStatus: 'VERIFIED' }, { reviewStatus: 'DRAFT' }, { reviewStatus: 'general_info' },
    { reviewerType: 'VET' }, { reviewerType: 'HUMAN' }, { reviewerType: null },
    { draftedAt: AS_OF }, { draftedAt: '2026-05-26' }, { draftedAt: '2026-05-25' }, { draftedAt: '2026-11-23' },
    { draftedAt: null }, { draftedAt: '2026-02-30' }, { draftedAt: '' }, { draftedAt: '2026-11-20T00:00' },
    { contentKind: 'FOOD' }, { contentKind: 'HEALTH' },
    { contentKind: 'FOOD', crossCheck: CC }, { contentKind: 'HEALTH', crossCheck: { ...CC, result: 'REVISED' } },
    { contentKind: 'FOOD', crossCheck: null }, { contentKind: 'FOOD', crossCheck: { ...CC, tool: 'X' } },
    { contentKind: 'FOOD', crossCheck: { ...CC, result: 'DISAGREE' } }, { contentKind: 'FOOD', crossCheck: { ...CC, extra: 1 } },
    { contentKind: 'FOOD', crossCheck: { tool: CC.tool, result: CC.result } }, { contentKind: 'FOOD', crossCheck: { ...CC, checkedAt: '2026-11-19' } },
    { contentKind: 'FOOD', crossCheck: { ...CC, checkedAt: '2026-11-23' } }, { contentKind: 'FOOD', crossCheck: { ...CC, checkedAt: '2026-11-31' } },
    { contentKind: 'FOOD', crossCheck: [CC] }, { contentKind: 'CARE', crossCheck: { ...CC, tool: 'X' } },
  ];
  const day = isoDayNumber(AS_OF) as number;
  it.each(variants.map((v) => [JSON.stringify(v), v] as const))('%s', (_n, v) => {
    const row = { ...base, ...v };
    expect(mjs.generalInfoRowOk(row, day)).toBe(isGeneralInfoMeta(row as never, AS_OF));
  });
  it('null·배열·원시값', () => {
    for (const r of [null, undefined, [], 'x', 1]) expect(mjs.generalInfoRowOk(r, day)).toBe(isGeneralInfoMeta(r as never, AS_OF));
  });
});

/** 실시드(디스크) 사본에 저빌 ACTIVE. */
function gerbilActive(): SeedBundle {
  const s = structuredClone(realSeed());
  patch(s, 'animalTypes', 'gerbil-mongolian', { status: 'ACTIVE' });
  return s;
}

/** 실시드 사본 + 사랑앵무 ACTIVE·cp-parrot-small·bird-cage GENERAL_INFO + 자리표시 요구사항 1행. */
function budgieActive(): SeedBundle {
  const s = structuredClone(realSeed());
  patch(s, 'animalTypes', 'budgie', { status: 'ACTIVE', ...GI({ contentKind: 'CARE' }) });
  patch(s, 'careProfiles', 'cp-parrot-small', GI({ contentKind: 'CARE' }));
  patch(s, 'supplyItems', 'bird-cage', GI({ contentKind: 'SPEC' }));
  const src = s.supplyRequirements.find((r) => r.id === 'req-gerbil-cage');
  if (!src) throw new Error('fixture: req-gerbil-cage 없음');
  s.supplyRequirements.push({
    ...structuredClone(src),
    id: 'req-fixture-parrot-cage',
    careProfileId: 'cp-parrot-small',
    supplyItemId: 'bird-cage',
    minSpec: { rules: [] },
    recommendedSpec: { rules: [] },
    ...GI({ contentKind: 'SPEC' }),
  } as typeof src);
  return s;
}

describe('체인 노출 패리티(실시드 메모리 주입)', () => {
  it('디스크 그대로: 양쪽 같음', () => {
    const s = realSeed();
    expect(engineIds(s)).toEqual(mjsIds(s));
  });

  it('저빌 ACTIVE + req-gerbil-food GENERAL_INFO(FOOD) + crossCheck → 양쪽 모두 사료 행 노출', () => {
    const s = gerbilActive();
    patch(s, 'supplyRequirements', 'req-gerbil-food', GI({ crossCheck: CC }));
    const e = engineIds(s);
    expect(e).toEqual(mjsIds(s));
    expect(e.animalTypes).toContain('gerbil-mongolian');
    expect(e.supplyRequirements).toContain('req-gerbil-food');
  });

  it('저빌 사료 GENERAL_INFO 인데 crossCheck 없음 → 양쪽 모두 사료 행만 비노출', () => {
    const s = gerbilActive();
    patch(s, 'supplyRequirements', 'req-gerbil-food', GI());
    const e = engineIds(s);
    expect(e).toEqual(mjsIds(s));
    expect(e.animalTypes).toContain('gerbil-mongolian');
    expect(e.supplyRequirements).not.toContain('req-gerbil-food');
    expect(e.supplyRequirements).toContain('req-gerbil-cage');
  });

  it('사랑앵무 GENERAL_INFO 체인 → 양쪽 모두 타입·프로필·용품·요구사항 노출', () => {
    const s = budgieActive();
    const e = engineIds(s);
    expect(e).toEqual(mjsIds(s));
    expect(e.animalTypes).toContain('budgie');
    expect(e.careProfiles).toContain('cp-parrot-small');
    expect(e.supplyItems).toContain('bird-cage');
    expect(e.supplyRequirements).toContain('req-fixture-parrot-cage');
  });

  it.each([
    ['프로필 draftedAt 181일', (s: SeedBundle) => patch(s, 'careProfiles', 'cp-parrot-small', { draftedAt: '2026-05-25' })],
    ['타입 draftedAt 없음', (s: SeedBundle) => patch(s, 'animalTypes', 'budgie', { draftedAt: null })],
    ['용품 LEGAL', (s: SeedBundle) => patch(s, 'supplyItems', 'bird-cage', { contentKind: 'LEGAL' })],
  ] as const)('사랑앵무 체인 무효(%s) → 양쪽 모두 사랑앵무 비노출', (_n, inject) => {
    const s = budgieActive();
    inject(s);
    const e = engineIds(s);
    expect(e).toEqual(mjsIds(s));
    expect(e.animalTypes).not.toContain('budgie');
  });

  it('목록 밖 타입(골든·드워프·저빌 공유 용품 cage)을 GENERAL_INFO 로 → 골든·드워프 cage 행 비노출, 저빌 cage 는 노출(양쪽 동일)', () => {
    const s = gerbilActive();
    patch(s, 'supplyItems', 'cage', GI({ contentKind: 'SPEC' }));
    const e = engineIds(s);
    expect(e).toEqual(mjsIds(s));
    expect(e.supplyRequirements).not.toContain('req-syrian-cage');
    expect(e.supplyRequirements).toContain('req-gerbil-cage');
    expect(e.supplyItems).toContain('cage');
  });

  it('PLANNED 6종은 GENERAL_INFO 체인이어도 양쪽 모두 비노출', () => {
    const s = budgieActive();
    patch(s, 'animalTypes', 'budgie', { status: 'PLANNED' });
    const e = engineIds(s);
    expect(e).toEqual(mjsIds(s));
    expect(e.animalTypes).not.toContain('budgie');
  });
});
