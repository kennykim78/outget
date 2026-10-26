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

// BE92(2026-10-25, 85 재조사 + Kenny 결정): 골든 cage 최소 100×50×50·철망 간격 lte 9 when WIRE(권장 6),
//   wheel 최소 27(권장 30), 공용 cr-wheel-cage·cr-water-cage·골든 cr-tubes-cage 삭제(근거 없음) →
//   케이지↔쳇바퀴 높이는 골든 범위 CHECK 규칙 cr-syrian-wheel-cage-bedding(지름 + 베딩 25cm ≤ 높이) 1개만.
const WB = 'cr-syrian-wheel-cage-bedding';

describe('F1 golden fixture', () => {
  it('60x40x35 LIVING_BOX + 30cm STAND wheel => 제품 OK, 호환 CHECK (베딩 25cm 고려, cr-syrian-wheel-cage-bedding#0)', () => {
    const r = specCheck(cat, G, 'wheel', { diameterCm: 30, surface: 'SOLID', mount: 'STAND' }, {
      ownedItems: { cage: { type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35 } },
    });
    expect(r.product.verdict).toBe('OK');
    expect(r.compat.verdict).toBe('CHECK');
    expect(r.compat.checkedRuleIds).toEqual([WB]);
    expect(ruleIds(r.compat.reasons)).toEqual([`${WB}#0`]);
    expect(r.verdict).toBe('CHECK');
    expect(r.alternatives).toEqual([{ supplyItemId: 'saucer', name: '플라잉 소서' }]);
  });
});

describe('F2/F3 pins', () => {
  it('F2 WIRE 60x40x30 간격 10 cage + 28cm wheel => 제품 BELOW_MIN(가로·세로·높이·간격), 호환은 CHECK 뿐(BELOW_MIN 호환 규칙 없음)', () => {
    const r = specCheck(cat, G, 'cage', { type: 'WIRE', floorWcm: 60, floorDcm: 40, heightCm: 30, barGapMm: 10 }, {
      ownedItems: { wheel: { diameterCm: 28, surface: 'SOLID', mount: 'STAND' } },
    });
    expect(r.product.verdict).toBe('BELOW_MIN');
    expect(r.product.reasons.filter((x) => x.kind === 'MIN').map((x) => x.key)).toEqual(['floorWcm', 'floorDcm', 'heightCm', 'barGapMm']);
    expect(r.compat.verdict).toBe('CHECK');
    expect(ruleIds(r.compat.reasons)).toEqual([`${WB}#0`]);
    expect(r.verdict).toBe('BELOW_MIN');
  });

  it('F3 WIRE 100x50x50 간격 9 cage + 30cm wheel => 제품 BELOW_RECOMMENDED(권장 간격 6mm), 호환 CHECK(30+25>50)', () => {
    const r = specCheck(cat, G, 'cage', { type: 'WIRE', floorWcm: 100, floorDcm: 50, heightCm: 50, barGapMm: 9 }, {
      ownedItems: { wheel: { diameterCm: 30, surface: 'SOLID', mount: 'STAND' } },
    });
    expect(r.product.verdict).toBe('BELOW_RECOMMENDED');
    expect(r.product.reasons.map((x) => [x.kind, x.key])).toEqual([['RECOMMENDED', 'barGapMm']]);
    expect(r.compat.verdict).toBe('CHECK');
    expect(ruleIds(r.compat.reasons)).toEqual([`${WB}#0`]);
  });
});

describe('F4 wheel product stage', () => {
  it.each([
    [{ diameterCm: 25, surface: 'SOLID', mount: 'STAND' }, 'BELOW_MIN'],
    [{ diameterCm: 26.9, surface: 'SOLID', mount: 'STAND' }, 'BELOW_MIN'],
    [{ diameterCm: 27, surface: 'SOLID', mount: 'STAND' }, 'BELOW_RECOMMENDED'],
    [{ diameterCm: 28, surface: 'SOLID', mount: 'STAND' }, 'BELOW_RECOMMENDED'],
    [{ diameterCm: 30, surface: 'SOLID', mount: 'STAND' }, 'OK'],
    [{ diameterCm: 30, surface: 'MESH', mount: 'STAND' }, 'BELOW_MIN'],
  ])('%j → %s', (input, expected) => {
    expect(specCheck(cat, G, 'wheel', input).verdict).toBe(expected);
  });
});

describe('F5 cage 철망 간격은 WIRE 일 때만', () => {
  it('LIVING_BOX 100x50x50(간격 없음) → OK·meetsMinSpec true / 80x50x40 → BELOW_MIN(가로·높이)', () => {
    const ok = { type: 'LIVING_BOX', floorWcm: 100, floorDcm: 50, heightCm: 50 };
    expect(specCheck(cat, G, 'cage', ok).product.verdict).toBe('OK');
    expect(checkProfileMinSpec(cat, PROFILE, 'cage', ok).meets).toBe(true);
    const small = { type: 'LIVING_BOX', floorWcm: 80, floorDcm: 50, heightCm: 40 };
    const r = specCheck(cat, G, 'cage', small);
    expect(r.product.verdict).toBe('BELOW_MIN');
    expect(r.product.reasons.map((x) => x.key)).toEqual(['floorWcm', 'heightCm']);
    expect(checkProfileMinSpec(cat, PROFILE, 'cage', small).meets).toBe(false);
  });
  it('WIRE: 간격 미입력 → CHECK(INPUT), 6 → OK, 9.5 → BELOW_MIN', () => {
    const base = { type: 'WIRE', floorWcm: 100, floorDcm: 50, heightCm: 50 };
    const none = specCheck(cat, G, 'cage', base);
    expect(none.product.verdict).toBe('CHECK');
    expect(none.product.reasons.map((x) => [x.kind, x.key])).toEqual([['INPUT', 'barGapMm']]);
    expect(specCheck(cat, G, 'cage', { ...base, barGapMm: 6 }).product.verdict).toBe('OK');
    expect(specCheck(cat, G, 'cage', { ...base, barGapMm: 9.5 }).product.verdict).toBe('BELOW_MIN');
  });
});

describe('F6 걸이형 쳇바퀴 — 장착 규칙 삭제(85 근거 없음), 높이 규칙만', () => {
  it('HANG 30cm + LIVING_BOX h55 → OK (30+25 ≤ 55)', () => {
    const r = specCheck(cat, G, 'wheel', { diameterCm: 30, surface: 'SOLID', mount: 'HANG' }, {
      ownedItems: { cage: { type: 'LIVING_BOX', floorWcm: 100, floorDcm: 50, heightCm: 55 } },
    });
    expect(r.compat.verdict).toBe('OK');
    expect(r.compat.checkedRuleIds).toEqual([WB]);
    expect(r.verdict).toBe('OK');
  });
});

describe('F7 tubes', () => {
  it('최소 규격·호환 규칙 없음, 권장 7cm: 6.9 → BELOW_RECOMMENDED, 7 → OK, 케이지와 호환 판정 NONE', () => {
    expect(specCheck(cat, G, 'tubes', { innerDiameterCm: 5.9 }).verdict).toBe('BELOW_RECOMMENDED');
    expect(specCheck(cat, G, 'tubes', { innerDiameterCm: 6.9 }).verdict).toBe('BELOW_RECOMMENDED');
    expect(specCheck(cat, G, 'tubes', { innerDiameterCm: 7 }).verdict).toBe('OK');
    const cage = { type: 'LIVING_BOX', floorWcm: 100, floorDcm: 50, heightCm: 50 };
    const r = specCheck(cat, G, 'tubes', { innerDiameterCm: 5.9 }, { ownedItems: { cage } });
    expect(r.compat.verdict).toBe('NONE');
    expect(r.compat.checkedRuleIds).toEqual([]);
  });
});

describe('F8 meetsMinSpec recompute over curated specValues', () => {
  it('전부 true (BE92: cp-003·cp-004 목표 규격 100×50×50)', () => {
    const out = Object.fromEntries(
      curated.map((p) => [
        p.id,
        p.careProfileIds.every((cp) => checkProfileMinSpec(cat, cp, p.supplyItemId, p.specValues).meets),
      ]),
    );
    expect(out).toEqual({
      'cp-001': true,
      'cp-002': true,
      'cp-003': true,
      'cp-004': true,
      'cp-005': true,
      'cp-006': true,
      'cp-007': true,
      'cp-008': true,
      'cp-009': true,
      'cp-010': true,
      // R7-B: 드워프 상품 17행(v0.3 5장) — 엔진 재계산 전부 충족(패킷 기대값과 일치)
      ...Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`cp-dw-${String(i + 1).padStart(3, '0')}`, i !== 8])), // cp-dw-009: 무향 근거 소멸로 scented 제거 → CHECK(false)
    });
  });
});

describe('F9 golden REQUIRED search keywords', () => {
  const golden = bundle.animalTypes.find((a) => a.id === G)!;
  const required = listResolvedRequirements(cat, G).filter((r) => r.priority === 'REQUIRED');
  const keywords = required.map((r) => buildSearchKeyword(golden, r));

  it('snapshot (BE92: 사료 그릇 RECOMMENDED 로 빠짐, 케이지 검색어 100x50)', () => {
    expect(keywords).toEqual([
      '골든햄스터 대형 케이지 100x50',
      '골든햄스터 쳇바퀴 30cm 무소음',
      '골든햄스터 종이 베딩 무향 대용량',
      '골든햄스터 급수기 스탠드형',
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
      ...specCheck(cat, G, 'wheel', { diameterCm: 30, surface: 'SOLID' }, { ownedItems: { cage: { type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35 } } }).reasons,
    ].map((x) => x.message);
    for (const m of msgs) for (const re of banned) expect(m).not.toMatch(re);
  });
});

describe('G-2 requirementCompat — 최소 규격 제품 기준(스펙33 K-4 가정, 현재 시드 수치 동작 고정)', () => {
  const box35 = { ownedItems: { cage: { type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35 } } };
  it('wheel 최소 기준값 = 지름 27 + 막힌 판', () => {
    expect(minSpecBaseline(resolveRequirement(cat, G, 'wheel')!)).toEqual({ diameterCm: 27, surface: 'SOLID' });
  });
  it('LIVING_BOX h35 + wheel min 27 → CHECK via cr-syrian-wheel-cage-bedding#0(27+25>35)', () => {
    const c = requirementCompat(cat, G, 'wheel', box35);
    expect(c.verdict).toBe('CHECK');
    expect(c.checkedRuleIds).toEqual([WB]);
    expect(ruleIds(c.reasons)).toEqual([`${WB}#0`]);
  });
  it('경계: h52 → OK, h51 → CHECK (27+25=52), BELOW_MIN 호환 없음', () => {
    const at = (h: number) => requirementCompat(cat, G, 'wheel', { ownedItems: { cage: { ...box35.ownedItems.cage, heightCm: h } } });
    expect(at(52).verdict).toBe('OK');
    expect(at(51).verdict).toBe('CHECK');
    expect(at(20).verdict).toBe('CHECK');
  });
  it('컨텍스트 없음 → NONE; 급수기는 호환 규칙 자체가 없어 NONE', () => {
    expect(requirementCompat(cat, G, 'wheel').verdict).toBe('NONE');
    const water = requirementCompat(cat, G, 'water', box35);
    expect(water).toEqual({ verdict: 'NONE', reasons: [], checkedRuleIds: [] });
  });
  it('결정적 — 같은 입력 같은 결과, 입력 불변', () => {
    const ctx = JSON.parse(JSON.stringify(box35));
    expect(requirementCompat(cat, G, 'wheel', ctx)).toEqual(requirementCompat(cat, G, 'wheel', ctx));
    expect(ctx).toEqual(box35);
  });
  it('specCheck(minSpecBaseline) 와 같은 규칙에서 같은 CHECK 이유(판정된 항목 한정)', () => {
    const full = specCheck(cat, G, 'wheel', { ...minSpecBaseline(resolveRequirement(cat, G, 'wheel')!), mount: 'STAND' }, box35);
    expect(ruleIds(full.compat.reasons)).toEqual([`${WB}#0`]);
  });
});
