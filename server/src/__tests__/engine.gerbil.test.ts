// 저빌 126 S5·S6 — 실제 시드(요구사항 14행·호환 규칙 1, 전부 DRAFT·AI_DRAFT) 위 엔진 경계 고정.
//   값은 104 §3·§4 출처 + Kenny 2026-10-27 결정(케이지 2마리 기준 100×50×50 + 문장으로만 넓히기, 습도는 문장·온습도계만,
//   모래 최소 규칙 없음·친칠라용 권장, 사료 최소 = 저빌용 또는 겸용(MULTI)·권장 = 저빌용) + 오케스트레이터 판단(쳇바퀴 지름 30 최소,
//   물병 권장만) 그대로이며, 이 테스트는 그 값의 엔진 동작을 고정할 뿐 새 사실 주장이 아니다. gerbil-mongolian 은 디스크 PLANNED.
import { describe, expect, it } from 'vitest';
import {
  buildSearchKeyword,
  checkAnimalMinSpec,
  checkProfileMinSpec,
  createCatalog,
  requirementCompat,
  resolveRequirement,
  specCheck,
} from '../engine/index.js';
import type { SeedBundle, SpecValues } from '../engine/index.js';
import { REAL_SIGNED_AT, realSeed, realSignedTargets } from './fixtures/prerender-seed.js';
import { lintText } from '../seed/lint.js';

const seed: SeedBundle = realSeed();
const cat = createCatalog(seed);
const G = 'gerbil-mongolian';
const CP = 'cp-gerbil-mongolian';
const rows = seed.supplyRequirements.filter((r) => r.careProfileId === CP);
const omit = (v: Record<string, string | number | boolean>, key: string): SpecValues =>
  Object.fromEntries(Object.entries(v).filter(([k]) => k !== key));
const at = (item: string, v: SpecValues) => {
  const r = checkAnimalMinSpec(cat, G, item, v);
  return [r.meets, r.verdict] as const;
};
const cage = (heightCm: number) => ({ ownedItems: { cage: { type: 'GLASS_TANK', floorType: 'SOLID', floorWcm: 100, floorDcm: 50, heightCm } } });

describe('S5 요구사항 14행 — 구성·검수 상태(불변식 7)', () => {
  it('14행: saucer·scale·playpen·hay-rack·nail-clipper·brush 없음, 새 SupplyItem 0', () => {
    expect(rows.map((r) => r.supplyItemId).sort()).toEqual(
      ['bedding', 'cage', 'carrier', 'chew', 'food', 'food-bowl', 'hay', 'hideout', 'sand-bath', 'sand-bath-box', 'thermo', 'tubes', 'water', 'wheel'].sort(),
    );
    expect(seed.supplyItems).toHaveLength(27); // 271: 앵무 공통 용품 7(구조만, DRAFT)은 저빌과 무관 — 저빌 착지가 더한 SupplyItem 은 여전히 0
  });
  it('2026-11-16 서명 후: 18행 중 17행 VERIFIED(kenny·패킷 basis·reviewerType — Taxon OFFICIAL_SOURCE), 패킷 밖 req-gerbil-food(FOOD)만 DRAFT·AI_DRAFT, AnimalType 은 PLANNED (Taxon·CP·AnimalType·호환 규칙 포함)', () => {
    const metas = [
      ...rows,
      ...seed.taxa.filter((t) => t.id === 'meriones-unguiculatus'),
      ...seed.careProfiles.filter((c) => c.id === CP),
      ...seed.animalTypes.filter((t) => t.id === G),
      ...seed.compatibilityRules.filter((c) => c.careProfileId === CP),
    ];
    expect(metas).toHaveLength(14 + 4);
    const targets = realSignedTargets();
    const fileOf = (r: { id: string }): string =>
      rows.includes(r as never) ? 'supply-requirements.json' : r.id === 'meriones-unguiculatus' ? 'taxa.json' : r.id === CP ? 'care-profiles.json' : r.id === G ? 'animal-types.json' : 'compatibility-rules.json';
    for (const r of metas) {
      const t = targets.get(`${fileOf(r)}#${r.id}`);
      const want = t ? ['VERIFIED', t.reviewerType, t.basis, 'kenny', REAL_SIGNED_AT] : ['DRAFT', 'AI_DRAFT', null, null, null];
      expect([r.id, r.reviewStatus, r.reviewerType, r.reviewBasis, r.verifiedBy, r.verifiedAt]).toEqual([r.id, ...want]);
    }
    expect(metas.filter((r) => r.reviewStatus !== 'VERIFIED').map((r) => r.id)).toEqual(['req-gerbil-food']);
    expect(metas.filter((r) => r.reviewStatus === 'VERIFIED')).toHaveLength(17);
    expect(seed.taxa.find((t) => t.id === 'meriones-unguiculatus')?.reviewerType).toBe('OFFICIAL_SOURCE');
    expect(metas.filter((r) => r.reviewStatus === 'VERIFIED' && r.reviewerType === 'AI_DRAFT')).toEqual([]);
    expect(seed.animalTypes.find((t) => t.id === G)?.status).toBe('PLANNED');
  });
  it('priority·orderHint: 필수 7(cage·bedding·water·food·hideout·sand-bath·sand-bath-box), 쳇바퀴·건초는 권장', () => {
    const p = Object.fromEntries(rows.map((r) => [r.supplyItemId, `${r.priority}/${r.orderHint}`]));
    for (const id of ['cage', 'bedding', 'water', 'food', 'hideout', 'sand-bath', 'sand-bath-box']) expect([id, p[id]]).toEqual([id, 'REQUIRED/BEFORE_ARRIVAL']);
    expect(p.wheel).toBe('RECOMMENDED/FIRST_WEEK');
    expect(p.hay).toBe('RECOMMENDED/BEFORE_ARRIVAL');
    expect(p['food-bowl']).toBe('RECOMMENDED/BEFORE_ARRIVAL');
    expect(p.thermo).toBe('RECOMMENDED/BEFORE_ARRIVAL');
  });
  it('Kenny 결정 반영: cage caution 2마리 기준·넓히기(문장만), sand-bath 최소 0·친칠라 권장, water 최소 0·물병 권장', () => {
    const by = Object.fromEntries(rows.map((r) => [r.supplyItemId, r]));
    expect(by.cage.caution).toBe('2마리 기준 크기라 한 마리 늘 때마다 바닥을 넓히고, 수조형은 철망 뚜껑을 덮어요.');
    expect(by['sand-bath'].minSpec.rules).toEqual([]);
    expect(by['sand-bath'].recommendedSpec.rules.map((x) => [x.key, x.op, x.value])).toEqual([['sandType', 'eq', 'CHINCHILLA_SAND']]);
    expect(by.water.minSpec.rules).toEqual([]);
    expect(by.water.recommendedSpec.rules.map((x) => [x.key, x.value])).toEqual([['kind', 'BOTTLE'], ['mount', 'HANG']]);
    // R5(126 위험): 마릿수는 문장으로만 — 규격 규칙에 마릿수 키 0.
    for (const r of rows) for (const x of [...r.minSpec.rules, ...r.recommendedSpec.rules]) expect(/head|count|animals/i.test(x.key)).toBe(false);
    // 습도는 facts 에 없다(Kenny K-Q2 ①) — careNote·thermo why 로만.
    const cp = seed.careProfiles.find((c) => c.id === CP);
    expect(cp?.facts).toEqual({ social: 'GROUP', activity: 'CREPUSCULAR', adultLengthCm: [10, 12], tempC: [20, 24], lifespanYears: [3, 4], minHeadcount: 2 });
    expect(cp?.careNotes.some((n) => n.includes('습도 50% 이하'))).toBe(true);
    expect(by.thermo.why).toContain('습도 50% 이하');
  });
  it('최소 규격 행은 서로 다른 도메인 출처 2개 이상(104 방법론)', () => {
    const domain = (u: string) => new URL(u).hostname.split('.').slice(-2).join('.');
    for (const r of rows.filter((x) => x.minSpec.rules.length > 0)) {
      expect([r.id, new Set(r.source.map((s) => domain(s.url))).size >= 2]).toEqual([r.id, true]);
    }
  });
  it('문구: 금지어·어간 0, 불변식 ② 경계 문구 없음, why ≤50자 · caution ≤40자(cage Kenny 문장만 예외) · caution 1문장', () => {
    for (const r of rows) {
      const texts = [r.why, r.caution, r.avoid, ...r.minSpec.rules.map((x) => x.reason), ...r.recommendedSpec.rules.map((x) => x.reason)];
      for (const t of texts.filter((x): x is string => typeof x === 'string')) {
        expect([r.id, t, lintText(t)]).toEqual([r.id, t, []]);
        for (const w of ['분양', '입양', '짝', '교배', '번식']) expect([r.id, t.includes(w)]).toEqual([r.id, false]);
      }
      expect([r.id, [...(r.why ?? '')].length <= 50]).toEqual([r.id, true]);
      if (r.supplyItemId !== 'cage') expect([r.id, [...(r.caution ?? '')].length <= 40]).toEqual([r.id, true]);
    }
  });
  it('검색 키워드 14개 직접 지정({animal} 포함)', () => {
    const kw = (item: string) => {
      const r = resolveRequirement(cat, G, item);
      if (!r) throw new Error(item);
      return buildSearchKeyword({ displayName: '몽골리안저빌' }, r);
    };
    for (const r of rows) expect([r.id, typeof r.searchKeyword === 'string' && r.searchKeyword.includes('{animal}')]).toEqual([r.id, true]);
    expect(kw('cage')).toBe('몽골리안저빌 수조 100x50');
    expect(kw('food')).toBe('몽골리안저빌 전용 사료');
    expect(kw('sand-bath')).toBe('몽골리안저빌 목욕 모래 친칠라 샌드');
    expect(kw('wheel')).toBe('몽골리안저빌 쳇바퀴 30cm');
  });
});

describe('S6 cage 경계 — 2마리 기준 100×50×50 · 철망형 제외 · 막힌 바닥', () => {
  const ok = { type: 'GLASS_TANK', floorType: 'SOLID', floorWcm: 100, floorDcm: 50, heightCm: 50 };
  it('100×50×50 SOLID 수조 → 최소 충족, 권장 높이 80 미달(BELOW_RECOMMENDED) / 높이 80 → OK', () => {
    expect(at('cage', ok)).toEqual([true, 'BELOW_RECOMMENDED']);
    expect(at('cage', { ...ok, heightCm: 80 })).toEqual([true, 'OK']);
  });
  it('가로 99.9·99 · 세로 49.9·49 · 높이 49.9·49 → 각각 BELOW_MIN', () => {
    for (const v of [99.9, 99]) expect(at('cage', { ...ok, floorWcm: v })).toEqual([false, 'BELOW_MIN']);
    for (const v of [49.9, 49]) expect(at('cage', { ...ok, floorDcm: v })).toEqual([false, 'BELOW_MIN']);
    for (const v of [49.9, 49]) expect(at('cage', { ...ok, heightCm: v })).toEqual([false, 'BELOW_MIN']);
  });
  it('WIRE → BELOW_MIN(type 규칙만), MESH 바닥 → BELOW_MIN(floorType 규칙만)', () => {
    const w = checkAnimalMinSpec(cat, G, 'cage', { ...ok, heightCm: 80, type: 'WIRE' });
    expect([w.meets, w.verdict, w.reasons.map((x) => x.key)]).toEqual([false, 'BELOW_MIN', ['type']]);
    const m = checkAnimalMinSpec(cat, G, 'cage', { ...ok, heightCm: 80, floorType: 'MESH' });
    expect([m.meets, m.verdict, m.reasons.map((x) => x.key)]).toEqual([false, 'BELOW_MIN', ['floorType']]);
  });
  it('GLASS_TANK·LIVING_BOX·ACRYLIC·GRID_PANEL·OTHER(저빌리움) → 충족', () => {
    for (const type of ['GLASS_TANK', 'LIVING_BOX', 'ACRYLIC', 'GRID_PANEL', 'OTHER']) expect([type, ...at('cage', { ...ok, heightCm: 80, type })]).toEqual([type, true, 'OK']);
  });
  it('바닥 형태 값 없음 → CHECK · 미충족(fail-closed) — checkAnimalMinSpec·checkProfileMinSpec 모두', () => {
    const noFloor = omit({ ...ok, heightCm: 80 }, 'floorType');
    expect(at('cage', noFloor)).toEqual([false, 'CHECK']);
    const p = checkProfileMinSpec(cat, CP, 'cage', noFloor);
    expect([p.meets, p.verdict]).toEqual([false, 'CHECK']);
  });
  it('골든 cage 는 WIRE 를 막지 않는다(저빌 행에만 적용 — 126 위험 R9 연쇄 0)', () => {
    const golden = checkAnimalMinSpec(cat, 'hamster-golden', 'cage', { type: 'WIRE', floorWcm: 100, floorDcm: 50, heightCm: 50, barGapMm: 9 });
    expect([golden.meets, golden.reasons.some((x) => x.key === 'type')]).toEqual([true, false]);
  });
});

describe('S6 wheel · tubes — 막힌 판(최소) · 지름 30(권장, curator135 #2) · 터널 5', () => {
  const ok = { diameterCm: 30, surface: 'SOLID', mount: 'STAND', silent: true };
  it('지름 규칙은 권장에만 있다 — 최소는 surface 하나(T2 단독 최소 표현 → 독립 2출처 아님)', () => {
    const r = seed.supplyRequirements.find((x) => x.id === 'req-gerbil-wheel');
    expect(r?.minSpec.rules.map((x) => [x.key, x.op, x.value])).toEqual([['surface', 'eq', 'SOLID']]);
    expect(r?.recommendedSpec.rules.map((x) => [x.key, x.op, x.value])).toEqual([['diameterCm', 'gte', 30]]);
    // reason 은 S1 문장 범위(등이 U자로 굽으면 작다) — 숫자 문턱을 '최소'로 말하지 않는다.
    for (const t of [r?.recommendedSpec.rules[0]?.reason, r?.avoid, r?.why]) expect([t, /30\s*cm|미만|최소/.test(t ?? '')]).toEqual([t, false]);
    // curator135 #7: T2 'Hamsterkugel' 단락은 햄스터만 말한다 → 런닝볼 문구 없음.
    expect(r?.avoid).toBe('살대·망 바닥 쳇바퀴');
  });
  it('지름 30 SOLID → OK, 29.9·29 → 최소 충족 · 권장 미달(BELOW_RECOMMENDED)', () => {
    expect(at('wheel', ok)).toEqual([true, 'OK']);
    for (const d of [29.9, 29, 20]) expect([d, ...at('wheel', { ...ok, diameterCm: d })]).toEqual([d, true, 'BELOW_RECOMMENDED']);
  });
  it('BAR·MESH 판 → BELOW_MIN(surface 규칙)', () => {
    for (const surface of ['BAR', 'MESH']) {
      const r = checkAnimalMinSpec(cat, G, 'wheel', { ...ok, surface });
      expect([surface, r.meets, r.verdict, r.reasons.map((x) => x.key)]).toEqual([surface, false, 'BELOW_MIN', ['surface']]);
    }
  });
  it('tubes 5 → OK, 4.9 → BELOW_MIN', () => {
    expect(at('tubes', { innerDiameterCm: 5 })).toEqual([true, 'OK']);
    expect(at('tubes', { innerDiameterCm: 4.9 })).toEqual([false, 'BELOW_MIN']);
  });
});

describe('S6 food — 최소 저빌용·겸용(MULTI), 권장 저빌용·조단백 18~20% (Kenny K-Q4 ② 겸용 허용)', () => {
  const ok = { form: 'PELLET', forSpecies: 'GERBIL', proteinPct: 18 };
  it('GERBIL · 조단백 18·20 → OK', () => {
    expect(at('food', ok)).toEqual([true, 'OK']);
    expect(at('food', { ...ok, proteinPct: 20 })).toEqual([true, 'OK']);
  });
  it('MULTI(겸용) 단독 → 포장 대상 표기 확인 전 CHECK · 미충족(154 B안, fail-closed)', () => {
    const r = checkAnimalMinSpec(cat, G, 'food', { ...ok, forSpecies: 'MULTI' });
    expect([r.meets, r.verdict]).toEqual([false, 'CHECK']);
  });
  it('MULTI(겸용) + 포장 대상에 저빌 표기(coversThisAnimal=true) → 최소 충족 · 권장 미달(BELOW_RECOMMENDED)', () => {
    const r = checkAnimalMinSpec(cat, G, 'food', { ...ok, forSpecies: 'MULTI', coversThisAnimal: true });
    expect([r.meets, r.verdict]).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('HAMSTER·GUINEA_PIG·RABBIT → BELOW_MIN', () => {
    for (const forSpecies of ['HAMSTER', 'GUINEA_PIG', 'RABBIT']) expect([forSpecies, ...at('food', { ...ok, forSpecies })]).toEqual([forSpecies, false, 'BELOW_MIN']);
  });
  it('대상 동물 값 없음 → CHECK · 미충족(fail-closed)', () => {
    expect(at('food', omit(ok, 'forSpecies'))).toEqual([false, 'CHECK']);
  });
  it('조단백 17.9·20.1 → 권장 미달(최소는 충족)', () => {
    for (const proteinPct of [17.9, 20.1]) expect(at('food', { ...ok, proteinPct })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('형태(펠릿·혼합)는 판정하지 않는다(104 충돌 — 규칙 없음)', () => {
    for (const form of ['MIX', 'PELLET', 'MIXED']) expect([form, ...at('food', { ...ok, form })]).toEqual([form, true, 'OK']);
  });
  it('기니피그 사료는 GERBIL 을 받지 않는다(퇴행 0), 골든 사료는 forSpecies 를 요구하지 않는다', () => {
    expect(checkAnimalMinSpec(cat, 'guinea-pig', 'food', { form: 'PELLET', forSpecies: 'GERBIL', vitaminC: true, baseType: 'GRASS' }).verdict).toBe('BELOW_MIN');
    expect(checkAnimalMinSpec(cat, 'hamster-golden', 'food', { form: 'PELLET' }).reasons.some((x) => x.key === 'forSpecies')).toBe(false);
  });
});

describe('S6 bedding · hideout · sand-bath · water · food-bowl · chew · hay', () => {
  it('bedding CEDAR_PINE → BELOW_MIN, FLUFFY 는 판정 밖(피할 것 문장만 — curator135 #3), PAPER·HEMP·ASPEN 무향 → OK, 향 있음 → 권장 미달', () => {
    const r = seed.supplyRequirements.find((x) => x.id === 'req-gerbil-bedding');
    expect(r?.minSpec.rules.map((x) => [x.key, x.op, x.value])).toEqual([['material', 'not_in', ['CEDAR_PINE']]]);
    expect(r?.avoid).toContain('솜처럼 가닥이 갈라지거나 발이 엉키는 둥지재');
    expect(at('bedding', { material: 'CEDAR_PINE', scented: false })).toEqual([false, 'BELOW_MIN']);
    for (const material of ['PAPER', 'HEMP', 'ASPEN', 'FLUFFY']) expect([material, ...at('bedding', { material, scented: false })]).toEqual([material, true, 'OK']);
    expect(at('bedding', { material: 'PAPER', scented: true })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('hideout PLASTIC → BELOW_MIN, WOOD·CERAMIC 출입구 2 → OK, 1 → 권장 미달', () => {
    expect(at('hideout', { material: 'PLASTIC', entrances: 2 })).toEqual([false, 'BELOW_MIN']);
    for (const material of ['WOOD', 'CERAMIC', 'CARDBOARD']) expect([material, ...at('hideout', { material, entrances: 2 })]).toEqual([material, true, 'OK']);
    expect(at('hideout', { material: 'WOOD', entrances: 1 })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('sand-bath: 최소 규칙 없음(Kenny K-Q3 ①) — DUST·REPTILE_SAND 도 충족·권장 미달, CHINCHILLA_SAND → OK', () => {
    expect(at('sand-bath', { sandType: 'CHINCHILLA_SAND' })).toEqual([true, 'OK']);
    for (const sandType of ['DUST', 'REPTILE_SAND', 'OTHER']) expect([sandType, ...at('sand-bath', { sandType })]).toEqual([sandType, true, 'BELOW_RECOMMENDED']);
  });
  it('water: 최소 규칙 없음 — 그릇도 충족·권장 미달, 거는 물병 → OK', () => {
    expect(at('water', { kind: 'BOTTLE', mount: 'HANG' })).toEqual([true, 'OK']);
    expect(at('water', { kind: 'BOWL', mount: 'STAND' })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('food-bowl CERAMIC·METAL → OK, PLASTIC → 권장 미달 / chew UNTREATED_WOOD → OK, MINERAL → 권장 미달 / hay TIMOTHY·MEADOW → OK, ORCHARD → 권장 미달', () => {
    for (const material of ['CERAMIC', 'METAL']) expect(at('food-bowl', { material })).toEqual([true, 'OK']);
    expect(at('food-bowl', { material: 'PLASTIC' })).toEqual([true, 'BELOW_RECOMMENDED']);
    expect(at('chew', { material: 'UNTREATED_WOOD' })).toEqual([true, 'OK']);
    expect(at('chew', { material: 'MINERAL' })).toEqual([true, 'BELOW_RECOMMENDED']);
    for (const hayType of ['TIMOTHY', 'MEADOW']) expect(at('hay', { hayType })).toEqual([true, 'OK']);
    expect(at('hay', { hayType: 'ORCHARD' })).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('문구를 인용 범위로(curator135 #6·#8·#9): 급수기 매일 점검, 모래통은 예시, 표준 수조 뚜껑', () => {
    const by = Object.fromEntries(seed.supplyRequirements.filter((x) => x.careProfileId === CP).map((x) => [x.supplyItemId, x]));
    expect(by.water.caution).toBe('꼭지가 베딩에 묻히지 않게 높이 달고 매일 새거나 막히지 않았는지 봐요.');
    expect(by['sand-bath-box'].why).toBe('모래를 담아 둘 통이에요. 큰 유리나 도자기 그릇을 쓰기도 해요.');
    expect(by.cage.avoid).toBe('철망으로만 된 케이지 · 철망 선반 · 표준 수조 뚜껑');
  });
  it('규칙 없는 행(sand-bath-box·carrier·thermo) → 규격 기준 없음 CHECK(충족 아님 · arch-23 결정 ②)', () => {
    expect(at('sand-bath-box', { shortSideCm: 10 })).toEqual([false, 'CHECK']);
    expect(at('carrier', { ventilated: true })).toEqual([false, 'CHECK']);
    expect(at('thermo', { digital: true })).toEqual([false, 'CHECK']);
  });
});

describe('S6 호환 cr-gerbil-wheel-cage-bedding — 지름 + 베딩 20cm ≤ 케이지 높이', () => {
  const wheel = { diameterCm: 30, surface: 'SOLID', mount: 'STAND', silent: true };
  it('지름 30 · 높이 50 → OK, (30, 49) → CHECK(규칙 id 포함)', () => {
    expect(specCheck(cat, G, 'wheel', wheel, cage(50)).compat.verdict).toBe('OK');
    const r = specCheck(cat, G, 'wheel', wheel, cage(49));
    expect([r.product.verdict, r.compat.verdict, r.verdict]).toEqual(['OK', 'CHECK', 'CHECK']);
    expect(r.compat.reasons.map((x) => x.ruleId)).toContain('cr-gerbil-wheel-cage-bedding#0');
  });
  it('지름 31 · 높이 50 → CHECK / 지름 30 · 높이 80 → OK', () => {
    expect(specCheck(cat, G, 'wheel', { ...wheel, diameterCm: 31 }, cage(50)).compat.verdict).toBe('CHECK');
    expect(specCheck(cat, G, 'wheel', wheel, cage(80)).compat.verdict).toBe('OK');
  });
  it('requirementCompat: 지름이 최소 규격에 없어(curator135 #2) 권장 30cm 로 채움(155 안 A) → h50 OK · h49·h30 CHECK(△ 상한), usedRecommended', () => {
    for (const [h, v] of [[50, 'OK'], [49, 'CHECK'], [30, 'CHECK']] as const) {
      const c = requirementCompat(cat, G, 'wheel', cage(h));
      expect([h, c.verdict, c.usedRecommended]).toEqual([h, v, true]);
    }
  });
  it('requirementCompat: 케이지 없음·높이 미입력 → NONE 유지', () => {
    expect(requirementCompat(cat, G, 'wheel').verdict).toBe('NONE');
    const empty = requirementCompat(cat, G, 'wheel', { ownedItems: { cage: {} } });
    expect([empty.verdict, empty.usedRecommended]).toEqual(['NONE', undefined]);
  });
  it('골든·드워프 프로필에는 저빌 범위 규칙이 걸리지 않는다', () => {
    for (const t of ['hamster-golden', 'hamster-dwarf']) {
      const r = specCheck(cat, t, 'wheel', { diameterCm: 30, surface: 'SOLID', mount: 'STAND', silent: true }, cage(40));
      expect([t, r.compat.reasons.some((x) => x.ruleId.startsWith('cr-gerbil-'))]).toEqual([t, false]);
    }
  });
  it('필수 픽스처 그대로: 골든 + LIVING_BOX 60×40×35 + 쳇바퀴 30cm SOLID STAND ⇒ 제품 OK · 호환 CHECK', () => {
    const r = specCheck(cat, 'hamster-golden', 'wheel', { diameterCm: 30, surface: 'SOLID', mount: 'STAND', silent: true }, { ownedItems: { cage: { type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35 } } });
    expect([r.product.verdict, r.compat.verdict]).toEqual(['OK', 'CHECK']);
  });
});

describe('기존 상품 27쌍 판정 변화 0(불변식 ③ — 저빌 라운드 전 시드 스냅숏)', () => {
  // 2026-10-27 저빌 시드 반영 직전(HEAD 0e9bab3) 실시드로 계산한 값. 상품 × careProfileIds 마다 checkProfileMinSpec.
  //   arch-23 결정 ②(2026-11-10, 의도된 변경 4행): 최소·권장 규칙이 모두 빈 품목 = 「기준 없음」 → CHECK·meets false(추천 제외).
  //   cp-007(syrian water) · cp-008(syrian food) · cp-dw-016 · cp-dw-017(dwarf water) 만 true|OK → false|CHECK. 나머지 23행 불변.
  const BEFORE = [
    'cp-001|cp-hamster-syrian|true|OK', 'cp-002|cp-hamster-syrian|true|BELOW_RECOMMENDED', 'cp-003|cp-hamster-syrian|true|OK',
    'cp-004|cp-hamster-syrian|true|BELOW_RECOMMENDED', 'cp-005|cp-hamster-syrian|true|OK', 'cp-006|cp-hamster-syrian|true|BELOW_RECOMMENDED',
    'cp-007|cp-hamster-syrian|false|CHECK', 'cp-008|cp-hamster-syrian|false|CHECK', 'cp-009|cp-hamster-syrian|true|OK', 'cp-010|cp-hamster-syrian|true|OK',
    'cp-dw-001|cp-hamster-dwarf|true|OK', 'cp-dw-002|cp-hamster-dwarf|true|OK', 'cp-dw-003|cp-hamster-dwarf|true|OK', 'cp-dw-004|cp-hamster-dwarf|true|OK',
    'cp-dw-005|cp-hamster-dwarf|true|BELOW_RECOMMENDED', 'cp-dw-006|cp-hamster-dwarf|true|OK', 'cp-dw-007|cp-hamster-dwarf|true|OK',
    'cp-dw-008|cp-hamster-dwarf|true|OK', 'cp-dw-009|cp-hamster-dwarf|false|CHECK', 'cp-dw-010|cp-hamster-dwarf|true|OK',
    'cp-dw-011|cp-hamster-dwarf|true|OK', 'cp-dw-012|cp-hamster-dwarf|true|OK', 'cp-dw-013|cp-hamster-dwarf|true|OK',
    'cp-dw-014|cp-hamster-dwarf|true|OK', 'cp-dw-015|cp-hamster-dwarf|true|OK', 'cp-dw-016|cp-hamster-dwarf|false|CHECK', 'cp-dw-017|cp-hamster-dwarf|false|CHECK',
  ];
  it('27쌍 그대로 · 저빌 프로필 대상 상품 0', () => {
    const now = seed.curatedProducts.flatMap((p) =>
      p.careProfileIds.map((cp) => {
        const r = checkProfileMinSpec(cat, cp, p.supplyItemId, p.specValues);
        return `${p.id}|${cp}|${r.meets}|${r.verdict}`;
      }),
    );
    expect(now).toEqual(BEFORE);
    for (const p of seed.curatedProducts) expect([p.id, p.careProfileIds.includes(CP)]).toEqual([p.id, false]);
  });
});
