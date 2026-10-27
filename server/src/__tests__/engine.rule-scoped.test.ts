// 기니피그 S3·S5(계획 107) — ruleScoped 필드 · visibleSpecFields · W-RULESCOPED · L5 폼 필드 스냅샷.
//   골든·드워프 L5 필드 목록은 S3 스키마 확장 전후 동일해야 한다(새 ruleScoped 필드 미노출).
//   cage.type·bedding.material 옵션 증가는 의도(라벨 전부 — 필드 숨김 위험 R2 방지).
//   메모리 주입 규칙은 표지 검증용 자리표시일 뿐 사육 사실이 아니다(디스크 시드 불변).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCatalog,
  hasCompleteOptionLabels,
  isFieldOptionalForDisplay,
  listResolvedRequirements,
  referencedSpecKeys,
  visibleSpecFields,
  type RuleSet,
  type SpecSchema,
} from '../engine/index.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { readSeedDirRaw } from '../seed/read.js';
import { validateSeed } from '../seed/validate.js';
import type { Rec } from '../seed/common.js';
import { DWARF_PREVIEW_AS_OF, SEED_DIR, dwarfPreview, realSeed } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(here, '..', '..', '..', 'client', 'index.html'), 'utf8');
const build = (seed = dwarfPreview()): SiteBuild =>
  buildSite(seed, { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), indexable: true, asOf: DWARF_PREVIEW_AS_OF });

const SCHEMA: SpecSchema = {
  fields: [
    { key: 'type', label: '형태', type: 'enum', options: ['A', 'B'], optionLabels: { A: '가', B: '나' } },
    { key: 'scoped', label: '바닥 형태', type: 'enum', options: ['S', 'M'], optional: true, ruleScoped: true, optionLabels: { S: '막힘', M: '망' } },
    { key: 'w', label: '가로(cm)', type: 'number', min: 1, max: 100 },
    { key: 'flag', label: '무분진', type: 'boolean', optional: true, ruleScoped: true },
    { key: 'plain', label: '다중 방', type: 'boolean', optional: true, ruleScoped: false },
  ],
};
const EMPTY: RuleSet = { rules: [] };
const keys = (min: RuleSet, rec: RuleSet = EMPTY): string[] => visibleSpecFields(SCHEMA, min, rec).map((f) => f.key);

describe('visibleSpecFields(schema, minSpec, recommendedSpec)', () => {
  it('참조 0 → ruleScoped 필드만 숨김, 나머지는 스키마 순서 그대로(ruleScoped:false 는 일반 필드)', () => {
    expect(keys(EMPTY)).toEqual(['type', 'w', 'plain']);
  });
  it('minSpec 규칙 key 참조 → 표시', () => {
    expect(keys({ rules: [{ key: 'scoped', op: 'eq', value: 'S', reason: 'r' }] })).toEqual(['type', 'scoped', 'w', 'plain']);
  });
  it('recommendedSpec 규칙 key 참조 → 표시', () => {
    expect(keys(EMPTY, { rules: [{ key: 'flag', op: 'eq', value: true, reason: 'r' }] })).toEqual(['type', 'w', 'flag', 'plain']);
  });
  it('when key 참조만으로도 표시(규칙 본 key 는 다른 필드)', () => {
    const min: RuleSet = { rules: [{ key: 'w', op: 'gte', value: 10, reason: 'r', when: [{ key: 'scoped', op: 'eq', value: 'M' }] }] };
    expect(keys(min)).toEqual(['type', 'scoped', 'w', 'plain']);
  });
  it('형태가 깨진 규칙 집합·조건은 참조 0 으로(throw 0)', () => {
    const bad = [
      { rules: null },
      { rules: [null, 3, { key: 7 }, { key: 'w', when: 'scoped' }, { key: 'w', when: [null, { key: 1 }] }] },
      null,
      undefined,
    ] as unknown as RuleSet[];
    for (const b of bad) expect(keys(b, b)).toEqual(['type', 'w', 'plain']);
  });
  it('스키마가 깨졌으면 빈 배열', () => {
    expect(visibleSpecFields(null as unknown as SpecSchema, EMPTY, EMPTY)).toEqual([]);
    expect(visibleSpecFields({ fields: 'x' } as unknown as SpecSchema, EMPTY, EMPTY)).toEqual([]);
  });
  it('입력을 바꾸지 않는다(순수) · 같은 입력 같은 출력', () => {
    const before = JSON.stringify(SCHEMA);
    const min: RuleSet = { rules: [{ key: 'scoped', op: 'in', value: ['S'], reason: 'r' }] };
    expect(visibleSpecFields(SCHEMA, min, EMPTY)).toEqual(visibleSpecFields(SCHEMA, min, EMPTY));
    expect(JSON.stringify(SCHEMA)).toBe(before);
  });
  it('referencedSpecKeys: 규칙 key + when key 합집합', () => {
    const min: RuleSet = { rules: [{ key: 'a', op: 'eq', value: 1, reason: 'r', when: [{ key: 'b', op: 'eq', value: 2 }] }] };
    expect([...referencedSpecKeys(min, { rules: [{ key: 'c', op: 'eq', value: 3, reason: 'r' }] })].sort()).toEqual(['a', 'b', 'c']);
  });
});

/** S3 전(HEAD d1c554f) 골든·드워프 해석 요구사항별 L5 필드 키(hasCompleteOptionLabels 통과분) — 고정 스냅샷. */
const L5_BEFORE: Record<string, Record<string, string[]>> = {
  'hamster-golden': {
    cage: ['type', 'floorWcm', 'floorDcm', 'heightCm', 'barGapMm'],
    wheel: ['diameterCm', 'surface', 'mount', 'silent'],
    bedding: ['material', 'scented', 'volumeL'],
    water: ['kind', 'mount', 'capacityMl'],
    food: ['form', 'proteinPct', 'fatPct'],
    hideout: ['material', 'multiChamber'],
    'food-bowl': ['material'],
    'sand-bath': ['sandType'],
    chew: ['material'],
    carrier: ['ventilated'],
    thermo: ['digital'],
    scale: ['resolutionG'],
    tubes: ['innerDiameterCm'],
    saucer: ['diameterCm'],
  },
  'hamster-dwarf': {
    cage: ['type', 'floorWcm', 'floorDcm', 'heightCm', 'barGapMm'],
    wheel: ['diameterCm', 'surface', 'mount', 'silent'],
    bedding: ['material', 'scented', 'volumeL'],
    water: ['kind', 'mount', 'capacityMl'],
    food: ['form', 'proteinPct', 'fatPct'],
    hideout: ['material', 'multiChamber'],
    'sand-bath': ['sandType'],
    'sand-bath-box': ['shortSideCm'],
    'food-bowl': ['material'],
    thermo: ['digital'],
    chew: ['material'],
    carrier: ['ventilated'],
    scale: ['resolutionG'],
    tubes: ['innerDiameterCm'],
    saucer: ['diameterCm'],
  },
};

describe('L5 폼 필드 스냅샷 — S3 전후 동일(새 ruleScoped 필드 미노출)', () => {
  const cat = createCatalog(realSeed());
  for (const typeId of Object.keys(L5_BEFORE)) {
    it(`${typeId}: 해석 요구사항별 visibleSpecFields ∩ 라벨 완전 = S3 전 목록`, () => {
      const got: Record<string, string[]> = {};
      for (const r of listResolvedRequirements(cat, typeId)) {
        got[r.supplyItemId] = visibleSpecFields(r.item.specSchema, r.minSpec, r.recommendedSpec)
          .filter(hasCompleteOptionLabels)
          .map((f) => f.key);
      }
      expect(got).toEqual(L5_BEFORE[typeId]);
    });
  }

  it('스키마 자체엔 ruleScoped 7필드가 있다(S8 playpen.floorType +1)(라벨 완전 — 숨김 사유는 ruleScoped 하나뿐)', () => {
    const scoped = realSeed().supplyItems.flatMap((i) => i.specSchema.fields.filter((f) => f.ruleScoped === true).map((f) => [`${i.id}.${f.key}`, hasCompleteOptionLabels(f), f.optional === true]));
    expect(scoped).toEqual([
      ['cage.floorType', true, true],
      ['bedding.dustFree', true, true],
      ['food.forSpecies', true, true],
      ['food.baseType', true, true],
      ['food.vitaminC', true, true],
      ['hideout.entrances', true, true],
      ['playpen.floorType', true, true],
    ]);
  });

  it('cage.type·bedding.material 옵션 증가(의도) — 전부 라벨, OTHER 마지막', () => {
    const items = realSeed().supplyItems;
    const f = (id: string, k: string) => items.find((i) => i.id === id)?.specSchema.fields.find((x) => x.key === k);
    const cageType = f('cage', 'type');
    const material = f('bedding', 'material');
    expect(cageType?.type === 'enum' && cageType.options).toEqual(['LIVING_BOX', 'WIRE', 'ACRYLIC', 'GLASS_TANK', 'GRID_PANEL', 'OTHER']);
    expect(material?.type === 'enum' && material.options).toEqual(['PAPER', 'ASPEN', 'HEMP', 'CEDAR_PINE', 'HAY', 'FLEECE', 'WOOD_SHAVINGS', 'STRAW', 'FLUFFY', 'OTHER']);
    expect(cageType && hasCompleteOptionLabels(cageType)).toBe(true);
    expect(material && hasCompleteOptionLabels(material)).toBe(true);
    expect(f('cage', 'floorDcm')).toMatchObject({ type: 'number', min: 20, max: 200 });
  });

  const l5Names = (b: SiteBuild, path: string): string[] => {
    const p = b.pages.find((x) => x.route.path === path);
    if (!p) throw new Error(`페이지 없음: ${path}`);
    const s = p.html.slice(p.html.indexOf('data-ws-layer="L5"'));
    const body = s.slice(0, s.indexOf('</aside>'));
    return [...body.matchAll(/name="([^"]+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);
  };

  it('드워프 미리보기 프리렌더 L5 HTML 필드 = S3 전 목록(저울은 비노출이라 없음) · cage 형태 select 6옵션', () => {
    const b = build();
    const checks = b.pages.filter((p) => p.route.path.startsWith('/hamster/dwarf/check/')).map((p) => p.route.path.slice('/hamster/dwarf/check/'.length));
    const expected = Object.fromEntries(checks.map((id) => [id, L5_BEFORE['hamster-dwarf'][id]]));
    expect(Object.fromEntries(checks.map((id) => [id, l5Names(b, `/hamster/dwarf/check/${id}`)]))).toEqual(expected);
    const cage = b.pages.find((x) => x.route.path === '/hamster/dwarf/check/cage')?.html ?? '';
    const select = /<select id="ws-f-type" name="type">(.*?)<\/select>/.exec(cage)?.[1] ?? '';
    expect([...select.matchAll(/<option value="([^"]*)">/g)].map((m) => m[1])).toEqual(['', 'LIVING_BOX', 'WIRE', 'ACRYLIC', 'GLASS_TANK', 'GRID_PANEL', 'OTHER']);
  });

  it('프리렌더 L5: 요구사항 규칙이 ruleScoped 필드를 참조하면 그 필드를 렌더(메모리 자리표시 규칙)', () => {
    const s = dwarfPreview();
    const req = s.supplyRequirements.find((r) => r.id === 'req-dwarf-cage');
    if (!req) throw new Error('fixture: req-dwarf-cage 없음');
    req.recommendedSpec = { rules: [...req.recommendedSpec.rules, { key: 'floorType', op: 'eq', value: 'SOLID', reason: '픽스처 자리표시' }] };
    const b = build(s);
    expect(l5Names(b, '/hamster/dwarf/check/cage')).toEqual(['type', 'floorType', 'floorWcm', 'floorDcm', 'heightCm', 'barGapMm']);
    expect(l5Names(b, '/hamster/dwarf/check/bedding')).toEqual(L5_BEFORE['hamster-dwarf'].bedding);
  });
});

// 114 FE-gp-schema: '· 선택' 표시 단일 판정(오케스트레이터 결정 2026-10-27 be-gp-schema(113) 행) — client SpecForm 과 공용.
describe("isFieldOptionalForDisplay(field, minSpec) — '· 선택' 표시", () => {
  const f = (k: string) => SCHEMA.fields.find((x) => x.key === k)!;
  it('optional 아님 → false, optional ∧ minSpec 미참조 → true', () => {
    expect(isFieldOptionalForDisplay(f('type'), EMPTY)).toBe(false);
    expect(isFieldOptionalForDisplay(f('plain'), EMPTY)).toBe(true);
    expect(isFieldOptionalForDisplay(f('flag'), null)).toBe(true);
  });
  it('minSpec 규칙 key 또는 when key 가 참조하면 false(판정 필수 값), recommendedSpec 은 무관', () => {
    const byKey: RuleSet = { rules: [{ key: 'flag', op: 'eq', value: true, reason: 'r' }] };
    const byWhen: RuleSet = { rules: [{ key: 'w', op: 'gte', value: 10, reason: 'r', when: [{ key: 'plain', op: 'eq', value: true }] }] };
    expect(isFieldOptionalForDisplay(f('flag'), byKey)).toBe(false);
    expect(isFieldOptionalForDisplay(f('plain'), byWhen)).toBe(false);
    expect(isFieldOptionalForDisplay(f('plain'), byKey)).toBe(true);
  });
  it('깨진 minSpec 은 참조 0 — optional 표시 그대로', () => {
    expect(isFieldOptionalForDisplay(f('plain'), { rules: 'x' } as unknown as RuleSet)).toBe(true);
    expect(isFieldOptionalForDisplay(f('plain'), [{ key: 'plain' }] as unknown as RuleSet)).toBe(true);
  });
  it("실시드 골든·드워프: '선택' 을 잃는 optional 필드는 cage.barGapMm 하나(minSpec 참조) — 프리렌더 HTML 에서도 같다", () => {
    const cat = createCatalog(realSeed());
    const lost: string[] = [];
    for (const typeId of ['hamster-golden', 'hamster-dwarf'])
      for (const r of listResolvedRequirements(cat, typeId))
        for (const x of visibleSpecFields(r.item.specSchema, r.minSpec, r.recommendedSpec).filter(hasCompleteOptionLabels))
          if (x.optional === true && !isFieldOptionalForDisplay(x, r.minSpec)) lost.push(`${typeId}.${r.supplyItemId}.${x.key}`);
    expect(lost).toEqual(['hamster-golden.cage.barGapMm', 'hamster-dwarf.cage.barGapMm']);
    const b = build();
    const html = (path: string): string => {
      const p = b.pages.find((x) => x.route.path === path)?.html ?? '';
      const s = p.slice(p.indexOf('data-ws-layer="L5"'));
      return s.slice(0, s.indexOf('</aside>'));
    };
    const fieldOf = (body: string, key: string): string =>
      [...body.matchAll(/<div class="ws-field">([\s\S]*?)<\/div>/g)].map((m) => m[1]).find((x) => x.includes(`name="${key}"`)) ?? '';
    expect(fieldOf(html('/hamster/dwarf/check/cage'), 'barGapMm')).not.toContain('ws-optional');
    expect(fieldOf(html('/hamster/dwarf/check/cage'), 'barGapMm')).not.toBe('');
    expect(fieldOf(html('/hamster/dwarf/check/wheel'), 'silent')).toContain('ws-optional');
  });
});

describe('seed:validate — W-RULESCOPED · S05 ruleScoped', () => {
  const NOW = '2026-10-27';
  const fresh = () => structuredClone(readSeedDirRaw(SEED_DIR).raw);
  const find = (arr: unknown[] | undefined, id: string): Rec => {
    const r = (arr ?? []).find((x) => (x as Rec).id === id);
    if (!r) throw new Error(`fixture: ${id} 없음`);
    return r as Rec;
  };
  // 메커니즘 테스트용: S9 기니피그 요구사항(참조 6필드)을 뺀 시드 — 참조 0 상태에서 해소 경로를 본다.
  const withoutGp = () => {
    const raw = fresh();
    raw.supplyRequirements = (raw.supplyRequirements ?? []).filter((x) => (x as Rec).careProfileId !== 'cp-guineapig');
    return raw;
  };
  const scopedWarns = (raw: ReturnType<typeof fresh>) =>
    validateSeed(raw, { now: NOW }).warnings.filter((i) => i.rule === 'W-RULESCOPED').map((i) => `${i.id}.${i.path}`);

  it('실시드: S9 요구사항 착지 후 playpen.floorType 1필드만 WARN(ERROR 아님)', () => {
    const res = validateSeed(fresh(), { now: NOW });
    expect(res.errors).toEqual([]);
    expect(scopedWarns(fresh())).toEqual(['playpen.specSchema.floorType']);
  });
  it('기니피그 요구사항을 빼면 7필드 전부 WARN(S9 가 6필드 경고를 해소한 출처)', () => {
    expect(scopedWarns(withoutGp())).toHaveLength(7);
  });

  it('요구사항 행의 when key 가 참조하면 그 필드 경고 해소', () => {
    const raw = withoutGp();
    const req = find(raw.supplyRequirements, 'req-syrian-cage') as { recommendedSpec: RuleSet };
    req.recommendedSpec = { rules: [...req.recommendedSpec.rules, { key: 'heightCm', op: 'gte', value: 30, reason: '픽스처', when: [{ key: 'floorType', op: 'eq', value: 'MESH' }] }] };
    expect(scopedWarns(raw)).not.toContain('cage.specSchema.floorType');
    expect(scopedWarns(raw)).toHaveLength(6); // playpen.floorType 은 별도 SupplyItem 이라 남는다
  });

  it('AnimalType.careOverrides 의 규칙만 참조해도 해소(해석 후 규칙 기준)', () => {
    const raw = withoutGp();
    expect(scopedWarns(raw)).toContain('hideout.specSchema.entrances');
    const at = find(raw.animalTypes, 'hamster-golden') as { careOverrides: Record<string, unknown> };
    at.careOverrides = { requirements: { hideout: { recommendedSpec: { rules: [{ key: 'entrances', op: 'gte', value: 2, reason: '픽스처' }] } } } };
    expect(scopedWarns(raw)).not.toContain('hideout.specSchema.entrances');
  });

  it('S05: ruleScoped 가 boolean 이 아니면 ERROR', () => {
    const raw = fresh();
    const cage = find(raw.supplyItems, 'cage') as { specSchema: { fields: Array<Record<string, unknown>> } };
    const f = cage.specSchema.fields.find((x) => x.key === 'floorType');
    if (!f) throw new Error('fixture: floorType 없음');
    f.ruleScoped = 'yes';
    expect(validateSeed(raw, { now: NOW }).errors.filter((i) => i.rule === 'S05').map((i) => i.id)).toEqual(['cage']);
  });
});
