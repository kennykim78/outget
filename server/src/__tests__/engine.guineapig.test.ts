// 기니피그 S9·S10 — 실제 시드(요구사항 16행, 전부 DRAFT·AI_DRAFT) 위 엔진 경계 고정.
//   값은 105 §4 출처 + Kenny 2026-10-27 결정(케이지 1마리 기준 106×61×46 막힌 바닥, playpen 권장 183×100 min 없음,
//   쳇바퀴·비타민 C 행 없음, 발톱깎이 권장/적응 후, 빗 선택, 알팔파 = 건초 권장 + caution 병원 문의) 그대로이며,
//   이 테스트는 그 값의 엔진 동작을 고정할 뿐 새 사실 주장이 아니다. 엔진 계산은 상태 무관(guinea-pig 은 디스크 PLANNED).
import { describe, expect, it } from 'vitest';
import {
  buildSearchKeyword,
  checkAnimalMinSpec,
  checkProfileMinSpec,
  createCatalog,
  requirementCompat,
  resolveRequirement,
} from '../engine/index.js';
import type { SeedBundle, SpecValues } from '../engine/index.js';
import { realSeed } from './fixtures/prerender-seed.js';
import { lintText } from '../seed/lint.js';

const seed: SeedBundle = realSeed();
const cat = createCatalog(seed);
const G = 'guinea-pig';
const CP = 'cp-guineapig';
const gpRows = seed.supplyRequirements.filter((r) => r.careProfileId === CP);
const omit = (v: Record<string, string | number | boolean>, key: string): SpecValues =>
  Object.fromEntries(Object.entries(v).filter(([k]) => k !== key));
const at = (item: string, v: SpecValues) => {
  const r = checkAnimalMinSpec(cat, G, item, v);
  return [r.meets, r.verdict] as const;
};

describe('S9 요구사항 16행 — 구성·검수 상태(불변식 7)', () => {
  it('16행: wheel·sand-bath·sand-bath-box·saucer 없음, vitamin-c 용품 없음', () => {
    expect(gpRows.map((r) => r.supplyItemId).sort()).toEqual(
      ['bedding', 'brush', 'cage', 'carrier', 'chew', 'food', 'food-bowl', 'hay', 'hay-rack', 'hideout', 'nail-clipper', 'playpen', 'scale', 'thermo', 'tubes', 'water'].sort(),
    );
    expect(seed.supplyItems.some((i) => i.id.startsWith('vitamin'))).toBe(false);
  });
  it('전부 DRAFT · AI_DRAFT · reviewBasis null · verifiedBy/At null', () => {
    for (const r of gpRows) {
      expect([r.id, r.reviewStatus, r.reviewerType, r.reviewBasis, r.verifiedBy, r.verifiedAt]).toEqual([r.id, 'DRAFT', 'AI_DRAFT', null, null, null]);
    }
  });
  it('Kenny 결정 priority·orderHint(playpen 권장, 발톱깎이 권장/적응 후, 빗 선택)', () => {
    const p = Object.fromEntries(gpRows.map((r) => [r.supplyItemId, `${r.priority}/${r.orderHint}`]));
    expect(p.cage).toBe('REQUIRED/BEFORE_ARRIVAL');
    expect(p.playpen).toBe('RECOMMENDED/BEFORE_ARRIVAL');
    expect(p['nail-clipper']).toBe('RECOMMENDED/AFTER_ADAPTATION');
    expect(p.brush.startsWith('OPTIONAL/')).toBe(true);
    expect(p.hay).toBe('REQUIRED/BEFORE_ARRIVAL');
    expect(p.food).toBe('REQUIRED/BEFORE_ARRIVAL');
  });
  it('Kenny 확정 caution 문구(cage 1마리 기준, hay 알팔파 병원 문의) 그대로', () => {
    const c = Object.fromEntries(gpRows.map((r) => [r.supplyItemId, r.caution]));
    expect(c.cage).toBe('이 크기는 1마리 기준이에요. 2마리 이상 함께 지내니 한 마리 늘 때마다 넓혀요.');
    expect(c.hay).toBe('6개월 미만·임신 중이면 알팔파가 필요할 수 있어 병원에 문의해요.');
  });
  it('playpen 은 최소 규칙 0(권장 크기만), hay 도 최소 0(알팔파는 권장으로)', () => {
    const byItem = Object.fromEntries(gpRows.map((r) => [r.supplyItemId, r]));
    expect(byItem.playpen.minSpec.rules).toEqual([]);
    expect(byItem.hay.minSpec.rules).toEqual([]);
  });
  it('FOOD 행은 서로 다른 도메인 출처 2+ 와 국내(.kr) 출처 1+', () => {
    for (const r of gpRows.filter((x) => x.contentKind === 'FOOD')) {
      const hosts = new Set(r.source.map((s) => new URL(s.url).hostname.split('.').slice(-2).join('.')));
      expect(hosts.size).toBeGreaterThanOrEqual(2);
      expect(r.source.some((s) => new URL(s.url).hostname.endsWith('.kr'))).toBe(true);
    }
  });
  it('문구: 금지어 0, 불변식 ② 경계 문구 없음, why ≤50자 · caution ≤40자(cage Kenny 문구만 예외)', () => {
    for (const r of gpRows) {
      for (const t of [r.why, r.caution, r.avoid].filter((x): x is string => typeof x === 'string')) {
        expect(lintText(t).filter((h) => h.rule === 'L01')).toEqual([]);
        expect(t.includes('짝을 정해')).toBe(false);
      }
      expect([r.id, [...(r.why ?? '')].length <= 50]).toEqual([r.id, true]);
      if (r.supplyItemId !== 'cage') expect([r.id, [...(r.caution ?? '')].length <= 40]).toEqual([r.id, true]);
    }
  });
  it('검색 키워드 덮어쓰기(110 위험 A·B): 은신처 출입구, 건초 급여기, 펠릿', () => {
    const kw = (item: string) => {
      const r = resolveRequirement(cat, G, item);
      if (!r) throw new Error(item);
      return buildSearchKeyword({ displayName: '기니피그' }, r);
    };
    expect(kw('hideout')).toBe('기니피그 은신처 출입구 2개');
    expect(kw('hay-rack')).toBe('기니피그 건초 급여기');
    expect(kw('food')).toBe('기니피그 펠릿 비타민C');
    expect(kw('cage')).toBe('기니피그 대형 케이지');
  });
});

describe('S10 cage 경계 — 1마리 기준 106×61×46 · 막힌 바닥 · 유리 수조 제외', () => {
  const ok = { type: 'LIVING_BOX', floorType: 'SOLID', floorWcm: 106, floorDcm: 61, heightCm: 46 };
  it('106×61×46 SOLID → 최소 충족, 권장 높이 50 미달(BELOW_RECOMMENDED)', () => {
    expect(at('cage', ok)).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('106×61×50 SOLID → OK', () => {
    expect(at('cage', { ...ok, heightCm: 50 })).toEqual([true, 'OK']);
  });
  it('가로 105.9 · 세로 60.9 · 높이 45.9 → 각각 BELOW_MIN', () => {
    expect(at('cage', { ...ok, floorWcm: 105.9 })).toEqual([false, 'BELOW_MIN']);
    expect(at('cage', { ...ok, floorDcm: 60.9 })).toEqual([false, 'BELOW_MIN']);
    expect(at('cage', { ...ok, heightCm: 45.9 })).toEqual([false, 'BELOW_MIN']);
  });
  it('바닥 MESH → BELOW_MIN(floorType 규칙)', () => {
    const r = checkAnimalMinSpec(cat, G, 'cage', { ...ok, heightCm: 50, floorType: 'MESH' });
    expect([r.meets, r.verdict]).toEqual([false, 'BELOW_MIN']);
    expect(r.reasons.map((x) => x.key)).toEqual(['floorType']);
  });
  it('바닥 형태 값 없음 → CHECK · 미충족(fail-closed) — checkAnimalMinSpec·checkProfileMinSpec 모두', () => {
    const noFloor = omit({ ...ok, heightCm: 50 }, 'floorType');
    expect(at('cage', noFloor)).toEqual([false, 'CHECK']);
    const p = checkProfileMinSpec(cat, CP, 'cage', noFloor);
    expect([p.meets, p.verdict]).toEqual([false, 'CHECK']);
    expect(p.reasons.some((x) => x.kind === 'INPUT' && x.key === 'floorType')).toBe(true);
  });
  it('GLASS_TANK → BELOW_MIN, ACRYLIC·WIRE·GRID_PANEL(막힌 바닥) → 충족(아크릴 벽은 RSPCA 가 허용 — 110 위험 D)', () => {
    expect(at('cage', { ...ok, heightCm: 50, type: 'GLASS_TANK' })).toEqual([false, 'BELOW_MIN']);
    for (const type of ['ACRYLIC', 'WIRE', 'GRID_PANEL', 'OTHER']) expect(at('cage', { ...ok, heightCm: 50, type })).toEqual([true, 'OK']);
  });
  it('골든·드워프 cage 는 floorType 규칙이 없다(값 없어도 OK — 퇴행 0)', () => {
    const golden = checkAnimalMinSpec(cat, 'hamster-golden', 'cage', { type: 'LIVING_BOX', floorWcm: 100, floorDcm: 50, heightCm: 50 });
    expect(golden.verdict).not.toBe('CHECK');
    expect(golden.meets).toBe(true);
  });
  it('기니피그 호환 규칙 없음 → requirementCompat NONE', () => {
    expect(requirementCompat(cat, G, 'cage').verdict).toBe('NONE');
  });
});

describe('S10 playpen · hay · hay-rack', () => {
  it('playpen 183×100 → OK, 182.9 → 권장 미달(최소 0이라 충족)', () => {
    expect(at('playpen', { floorWcm: 183, floorDcm: 100 })).toEqual([true, 'OK']);
    expect(at('playpen', { floorWcm: 182.9, floorDcm: 100 })).toEqual([true, 'BELOW_RECOMMENDED']);
    expect(at('playpen', { floorWcm: 183, floorDcm: 99.9 })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('hay TIMOTHY·ORCHARD·MEADOW → OK, ALFALFA·OTHER → 권장 미달(충족)', () => {
    for (const hayType of ['TIMOTHY', 'ORCHARD', 'MEADOW']) expect(at('hay', { hayType })).toEqual([true, 'OK']);
    for (const hayType of ['ALFALFA', 'OTHER']) expect(at('hay', { hayType })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('hay-rack: INSIDE 덮개 있음 OK · 없음 권장 미달 · 값 없음 CHECK, OUTSIDE 는 덮개 무관 OK', () => {
    expect(at('hay-rack', { mount: 'INSIDE', covered: true })).toEqual([true, 'OK']);
    expect(at('hay-rack', { mount: 'INSIDE', covered: false })).toEqual([true, 'BELOW_RECOMMENDED']);
    expect(at('hay-rack', { mount: 'INSIDE' })).toEqual([false, 'CHECK']);
    expect(at('hay-rack', { mount: 'OUTSIDE' })).toEqual([true, 'OK']);
  });
});

describe('S10 food — 곡물 혼합 제외 · 기니피그용 · 비타민 C 첨가(최소), 목초 기반(권장)', () => {
  const ok = { form: 'PELLET', forSpecies: 'GUINEA_PIG', vitaminC: true, baseType: 'GRASS' };
  it('PELLET · GUINEA_PIG · 비타민 C · GRASS → OK', () => {
    expect(at('food', ok)).toEqual([true, 'OK']);
  });
  it('MIX → BELOW_MIN, MIXED → 충족', () => {
    expect(at('food', { ...ok, form: 'MIX' })).toEqual([false, 'BELOW_MIN']);
    expect(at('food', { ...ok, form: 'MIXED' })).toEqual([true, 'OK']);
  });
  it('RABBIT·HAMSTER·MULTI → BELOW_MIN', () => {
    for (const forSpecies of ['RABBIT', 'HAMSTER', 'MULTI']) expect(at('food', { ...ok, forSpecies })).toEqual([false, 'BELOW_MIN']);
  });
  it('비타민 C 없음(false) → BELOW_MIN(vitaminC 규칙)', () => {
    const r = checkAnimalMinSpec(cat, G, 'food', { ...ok, vitaminC: false });
    expect([r.meets, r.verdict]).toEqual([false, 'BELOW_MIN']);
    expect(r.reasons.map((x) => x.key)).toEqual(['vitaminC']);
  });
  it('비타민 C·대상 동물 값 없음 → CHECK · 미충족(fail-closed, checkProfileMinSpec 도)', () => {
    const noVit = omit(ok, 'vitaminC');
    const noSp = omit(ok, 'forSpecies');
    expect(at('food', noVit)).toEqual([false, 'CHECK']);
    expect(at('food', noSp)).toEqual([false, 'CHECK']);
    const p = checkProfileMinSpec(cat, CP, 'food', noVit);
    expect([p.meets, p.verdict]).toEqual([false, 'CHECK']);
  });
  it('ALFALFA 기반 → 권장 미달(충족)', () => {
    expect(at('food', { ...ok, baseType: 'ALFALFA' })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('골든 사료는 forSpecies·vitaminC 를 요구하지 않는다(퇴행 0)', () => {
    expect(checkAnimalMinSpec(cat, 'hamster-golden', 'food', { form: 'PELLET' }).reasons.some((x) => x.key === 'vitaminC' || x.key === 'forSpecies')).toBe(false);
  });
});

describe('S10 bedding · hideout · tubes · chew · food-bowl · nail-clipper', () => {
  it('bedding CEDAR_PINE·FLUFFY → BELOW_MIN, PAPER·HAY·FLEECE + 무분진 → OK, 무분진 false → 권장 미달', () => {
    for (const material of ['CEDAR_PINE', 'FLUFFY']) expect(at('bedding', { material, scented: false, dustFree: true })).toEqual([false, 'BELOW_MIN']);
    for (const material of ['PAPER', 'HAY', 'FLEECE', 'WOOD_SHAVINGS']) expect(at('bedding', { material, scented: false, dustFree: true })).toEqual([true, 'OK']);
    expect(at('bedding', { material: 'PAPER', scented: false, dustFree: false })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('bedding 무분진 값 없음 → CHECK(권장 규칙도 값 없으면 판단 불가 — fail-closed)', () => {
    expect(at('bedding', { material: 'PAPER', scented: false })).toEqual([false, 'CHECK']);
  });
  it('hideout 출입구 2 → OK, 1 → 권장 미달', () => {
    expect(at('hideout', { material: 'WOOD', entrances: 2 })).toEqual([true, 'OK']);
    expect(at('hideout', { material: 'WOOD', entrances: 1 })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('tubes 13 → OK, 12.9 → 권장 미달', () => {
    expect(at('tubes', { innerDiameterCm: 13 })).toEqual([true, 'OK']);
    expect(at('tubes', { innerDiameterCm: 12.9 })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('chew UNTREATED_WOOD → OK, MINERAL·OTHER → BELOW_MIN', () => {
    expect(at('chew', { material: 'UNTREATED_WOOD' })).toEqual([true, 'OK']);
    for (const material of ['MINERAL', 'OTHER']) expect(at('chew', { material })).toEqual([false, 'BELOW_MIN']);
  });
  it('food-bowl CERAMIC → OK, PLASTIC → 권장 미달', () => {
    expect(at('food-bowl', { material: 'CERAMIC' })).toEqual([true, 'OK']);
    expect(at('food-bowl', { material: 'PLASTIC' })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('nail-clipper SMALL_ANIMAL·HUMAN → OK, OTHER → 권장 미달', () => {
    for (const type of ['SMALL_ANIMAL', 'HUMAN']) expect(at('nail-clipper', { type })).toEqual([true, 'OK']);
    expect(at('nail-clipper', { type: 'OTHER' })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('규칙 없는 행(water·carrier·thermo·scale·brush) → 규격 기준 없음 OK', () => {
    expect(at('water', { kind: 'BOTTLE', mount: 'HANG' })).toEqual([true, 'OK']);
    expect(at('brush', { type: 'SOFT_BRUSH' })).toEqual([true, 'OK']);
  });
});
