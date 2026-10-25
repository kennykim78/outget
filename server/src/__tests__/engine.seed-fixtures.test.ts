// 실제 시드(server/seed/*.json) 위 엔진 결과 고정(R2 계획 §E F1–F9).
//   F2/F3 는 현재 시드 수치의 동작을 고정한 것이지 사실 주장이 아니다(05 precheck §3-1, Kenny 항목 1).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSearchKeyword,
  checkProfileMinSpec,
  createCatalog,
  listResolvedRequirements,
  minSpecBaseline,
  requirementCompat,
  resolveRequirement,
  specCheck,
} from '../engine/index.js';
import type {
  AnimalTypeRec,
  CareProfileRec,
  CompatibilityRuleRec,
  CuratedProductRec,
  Reason,
  SupplyItemRec,
  SupplyRequirementRec,
} from '../engine/index.js';

const SEED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed');
const read = <T>(f: string): T[] => JSON.parse(readFileSync(join(SEED, f), 'utf8')) as T[];

const bundle = {
  animalTypes: read<AnimalTypeRec>('animal-types.json'),
  careProfiles: read<CareProfileRec>('care-profiles.json'),
  supplyItems: read<SupplyItemRec>('supply-items.json'),
  supplyRequirements: read<SupplyRequirementRec>('supply-requirements.json'),
  compatibilityRules: read<CompatibilityRuleRec>('compatibility-rules.json'),
};
const curated = read<CuratedProductRec>('curated-products.json');
const cat = createCatalog(bundle);
const G = 'hamster-golden';
const PROFILE = 'cp-hamster-syrian';
const ruleIds = (rs: Reason[]) => rs.map((r) => r.ruleId);

describe('F1 golden fixture', () => {
  it('60x40x35 LIVING_BOX + 30cm STAND wheel => CHECK (cr-wheel-cage#1)', () => {
    const r = specCheck(cat, G, 'wheel', { diameterCm: 30, surface: 'SOLID', mount: 'STAND' }, {
      ownedItems: { cage: { type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35 } },
    });
    expect(r.product.verdict).toBe('OK');
    expect(r.compat.verdict).toBe('CHECK');
    expect(r.compat.checkedRuleIds).toEqual(['cr-wheel-cage']);
    expect(ruleIds(r.compat.reasons)).toEqual(['cr-wheel-cage#1']);
    expect(r.verdict).toBe('CHECK');
    expect(r.alternatives).toEqual([{ supplyItemId: 'saucer', name: '플라잉 소서' }]);
  });
});

describe('F2/F3 pins', () => {
  it('F2 WIRE h30 cage + 28cm wheel => compat BELOW_MIN #0 (32>30) — current-data behavior, not a fact claim (05 precheck §3-1)', () => {
    const r = specCheck(cat, G, 'cage', { type: 'WIRE', floorWcm: 60, floorDcm: 40, heightCm: 30, barGapMm: 10 }, {
      ownedItems: { wheel: { diameterCm: 28, surface: 'SOLID', mount: 'STAND' } },
    });
    expect(r.compat.verdict).toBe('BELOW_MIN');
    expect(ruleIds(r.compat.reasons)).toContain('cr-wheel-cage#0');
    expect(r.compat.reasons.find((x) => x.ruleId === 'cr-wheel-cage#0')!.verdict).toBe('BELOW_MIN');
    expect(r.verdict).toBe('BELOW_MIN');
  });

  it('F3 WIRE 80x50x40 cage + 30cm wheel => CHECK #1 — current-data behavior, not a fact claim (05 precheck §3-1)', () => {
    const r = specCheck(cat, G, 'cage', { type: 'WIRE', floorWcm: 80, floorDcm: 50, heightCm: 40, barGapMm: 9 }, {
      ownedItems: { wheel: { diameterCm: 30, surface: 'SOLID', mount: 'STAND' } },
    });
    expect(r.product.verdict).toBe('OK');
    expect(r.compat.verdict).toBe('CHECK');
    expect(ruleIds(r.compat.reasons)).toEqual(['cr-wheel-cage#1']);
  });
});

describe('F4 wheel product stage', () => {
  it.each([
    [{ diameterCm: 25, surface: 'SOLID', mount: 'STAND' }, 'BELOW_MIN'],
    [{ diameterCm: 28, surface: 'SOLID', mount: 'STAND' }, 'BELOW_RECOMMENDED'],
    [{ diameterCm: 27.9, surface: 'SOLID', mount: 'STAND' }, 'BELOW_MIN'],
    [{ diameterCm: 30, surface: 'MESH', mount: 'STAND' }, 'BELOW_MIN'],
  ])('%j → %s', (input, expected) => {
    expect(specCheck(cat, G, 'wheel', input).verdict).toBe(expected);
  });
});

describe('F5 cage without barGapMm', () => {
  it('LIVING_BOX 80x50x40 → product CHECK; meetsMinSpec false', () => {
    const input = { type: 'LIVING_BOX', floorWcm: 80, floorDcm: 50, heightCm: 40 };
    const r = specCheck(cat, G, 'cage', input);
    expect(r.product.verdict).toBe('CHECK');
    expect(r.product.reasons.map((x) => [x.kind, x.key])).toEqual([['INPUT', 'barGapMm']]);
    expect(checkProfileMinSpec(cat, PROFILE, 'cage', input).meets).toBe(false);
  });
});

describe('F6 hanging wheel', () => {
  const hang = { diameterCm: 30, surface: 'SOLID', mount: 'HANG' };
  it('LIVING_BOX h50 → CHECK #2', () => {
    const r = specCheck(cat, G, 'wheel', hang, {
      ownedItems: { cage: { type: 'LIVING_BOX', floorWcm: 80, floorDcm: 50, heightCm: 50 } },
    });
    expect(r.compat.verdict).toBe('CHECK');
    expect(ruleIds(r.compat.reasons)).toEqual(['cr-wheel-cage#2']);
  });
  it('WIRE h50 → OK', () => {
    const r = specCheck(cat, G, 'wheel', hang, {
      ownedItems: { cage: { type: 'WIRE', floorWcm: 80, floorDcm: 50, heightCm: 50, barGapMm: 9 } },
    });
    expect(r.compat.verdict).toBe('OK');
    expect(r.verdict).toBe('OK');
  });
});

describe('F7 tubes', () => {
  it('5.9 → BELOW_MIN, 6 → OK (product and cr-tubes-cage)', () => {
    expect(specCheck(cat, G, 'tubes', { innerDiameterCm: 5.9 }).verdict).toBe('BELOW_MIN');
    expect(specCheck(cat, G, 'tubes', { innerDiameterCm: 6 }).verdict).toBe('OK');
    const cage = { type: 'WIRE', floorWcm: 80, floorDcm: 50, heightCm: 40, barGapMm: 9 };
    const small = specCheck(cat, G, 'tubes', { innerDiameterCm: 5.9 }, { ownedItems: { cage } });
    expect(small.compat.verdict).toBe('BELOW_MIN');
    expect(ruleIds(small.compat.reasons)).toEqual(['cr-tubes-cage#0']);
    expect(specCheck(cat, G, 'tubes', { innerDiameterCm: 6 }, { ownedItems: { cage } }).compat.verdict).toBe('OK');
  });
});

describe('F8 meetsMinSpec recompute over curated specValues', () => {
  it('cp-003 false, others true', () => {
    const out = Object.fromEntries(
      curated.map((p) => [
        p.id,
        p.careProfileIds.every((cp) => checkProfileMinSpec(cat, cp, p.supplyItemId, p.specValues).meets),
      ]),
    );
    expect(out).toEqual({
      'cp-001': true,
      'cp-002': true,
      'cp-003': false,
      'cp-004': true,
      'cp-005': true,
      'cp-006': true,
      'cp-007': true,
      'cp-008': true,
      'cp-009': true,
      'cp-010': true,
      // R7-B: 드워프 상품 17행(v0.3 5장) — 엔진 재계산 전부 충족(패킷 기대값과 일치)
      ...Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`cp-dw-${String(i + 1).padStart(3, '0')}`, true])),
    });
  });
});

describe('F9 golden REQUIRED search keywords', () => {
  const golden = bundle.animalTypes.find((a) => a.id === G)!;
  const required = listResolvedRequirements(cat, G).filter((r) => r.priority === 'REQUIRED');
  const keywords = required.map((r) => buildSearchKeyword(golden, r));

  it('snapshot', () => {
    expect(keywords).toEqual([
      '골든햄스터 리빙박스 대형 케이지 80x50',
      '골든햄스터 쳇바퀴 30cm 무소음',
      '골든햄스터 종이 베딩 무향 대용량',
      '골든햄스터 급수기 스탠드형',
      '골든햄스터 도자기 사료 그릇',
      '골든햄스터 사료 주식',
      '골든햄스터 다중 은신처 나무',
    ]);
  });

  it('each has ≥1 token beyond displayName + item.name (US-012)', () => {
    required.forEach((r, i) => {
      const rest = keywords[i].replace(golden.displayName, ' ').replace(r.item.name, ' ').trim();
      expect(rest.length, keywords[i]).toBeGreaterThan(0);
    });
  });

  it('every engine message on the seed passes the banned-word lint', () => {
    const banned = [/괜찮다/, /안전하다/, /최저가/, /판매순/, /베스트/, /정확도/, /전문가\s*\d+\s*명/, /회원가입/, /구매/];
    const msgs = [
      ...specCheck(cat, G, 'cage', { type: 'OTHER', floorWcm: 10, heightCm: 20 }).reasons,
      ...specCheck(cat, G, 'bedding', { material: 'CEDAR_PINE', scented: true }).reasons,
      ...specCheck(cat, G, 'water', {}).reasons,
    ].map((x) => x.message);
    for (const m of msgs) for (const re of banned) expect(m).not.toMatch(re);
  });
});

describe('G-2 requirementCompat — 최소 규격 제품 기준(스펙33 K-4 가정, 현재 시드 수치 동작 고정)', () => {
  const box35 = { ownedItems: { cage: { type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35 } } };
  it('wheel 최소 기준값 = 지름 28 + 막힌 판', () => {
    expect(minSpecBaseline(resolveRequirement(cat, G, 'wheel')!)).toEqual({ diameterCm: 28, surface: 'SOLID' });
  });
  it('LIVING_BOX h35 + wheel min 28 → CHECK via cr-wheel-cage#1(28+15>35), mount 미정 항목(#2)은 건너뜀', () => {
    const c = requirementCompat(cat, G, 'wheel', box35);
    expect(c.verdict).toBe('CHECK');
    expect(c.checkedRuleIds).toEqual(['cr-wheel-cage']);
    expect(ruleIds(c.reasons)).toEqual(['cr-wheel-cage#1']);
  });
  it('h45 → OK, h30 → BELOW_MIN(#0)', () => {
    const at = (h: number) => requirementCompat(cat, G, 'wheel', { ownedItems: { cage: { ...box35.ownedItems.cage, heightCm: h } } });
    expect(at(45).verdict).toBe('OK');
    const low = at(30);
    expect(low.verdict).toBe('BELOW_MIN');
    expect(ruleIds(low.reasons)).toContain('cr-wheel-cage#0');
  });
  it('컨텍스트 없음 → NONE; 판정 가능한 항목이 없는 규칙(급수기 mount 미정)은 NONE', () => {
    expect(requirementCompat(cat, G, 'wheel').verdict).toBe('NONE');
    const water = requirementCompat(cat, G, 'water', box35);
    expect(water).toEqual({ verdict: 'NONE', reasons: [], checkedRuleIds: [] });
  });
  it('결정적 — 같은 입력 같은 결과, 입력 불변', () => {
    const ctx = JSON.parse(JSON.stringify(box35));
    expect(requirementCompat(cat, G, 'wheel', ctx)).toEqual(requirementCompat(cat, G, 'wheel', ctx));
    expect(ctx).toEqual(box35);
  });
  it('specCheck(minSpecBaseline) 와 같은 규칙에서 같은 BELOW_MIN/CHECK 이유(판정된 항목 한정)', () => {
    const full = specCheck(cat, G, 'wheel', { ...minSpecBaseline(resolveRequirement(cat, G, 'wheel')!), mount: 'STAND' }, box35);
    expect(ruleIds(full.compat.reasons)).toEqual(['cr-wheel-cage#1']);
  });
});
