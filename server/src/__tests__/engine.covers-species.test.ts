// 154 B안(보안 144 LOW-2) — 겸용(MULTI) 사료는 포장 대상에 '이 동물'이 표기돼야만 저빌 최소 규격 충족(fail-closed).
//   food.specSchema.coversThisAnimal(boolean·optional·ruleScoped) + req-gerbil-food minSpec when 규칙 1행.
//   엔진 소스 무변경 — 기존 boolean·eq·when 경로가 판정한다. 시드 사실(상품 값·증빙)은 넣지 않는다:
//   노출 경로 검사는 메모리 복제본만 승격한다(실제 시드 DRAFT·AI_DRAFT 그대로).
import { describe, expect, it } from 'vitest';
import {
  checkAnimalMinSpec,
  checkProfileMinSpec,
  createCatalog,
  isProductExposable,
  listResolvedRequirements,
  visibleSpecFields,
} from '../engine/index.js';
import type { ContentMeta, CuratedProductRec, SeedBundle, SpecValues } from '../engine/index.js';
import { realSeed } from './fixtures/prerender-seed.js';

const seed: SeedBundle = realSeed();
const cat = createCatalog(seed);
const G = 'gerbil-mongolian';
const CP = 'cp-gerbil-mongolian';
const base = { form: 'PELLET', proteinPct: 18 };

const judge = (v: SpecValues) => {
  const a = checkAnimalMinSpec(cat, G, 'food', v);
  const p = checkProfileMinSpec(cat, CP, 'food', v);
  return { animal: [a.meets, a.verdict] as const, profile: [p.meets, p.verdict] as const, reasons: a.reasons.map((r) => r.key) };
};

describe('시드 정의 — food.coversThisAnimal 필드와 req-gerbil-food when 규칙', () => {
  it('food.specSchema: forSpecies 바로 뒤에 boolean·optional·ruleScoped, 라벨에 괄호 없음', () => {
    const fields = seed.supplyItems.find((i) => i.id === 'food')!.specSchema.fields;
    const i = fields.findIndex((f) => f.key === 'forSpecies');
    expect(fields[i + 1]).toEqual({ key: 'coversThisAnimal', label: '포장 대상에 이 동물 표기', type: 'boolean', optional: true, ruleScoped: true });
  });
  it('req-gerbil-food minSpec 2행(forSpecies in + coversThisAnimal eq true when forSpecies=MULTI), GENERAL_INFO·AI_DRAFT 유지', () => {
    const r = seed.supplyRequirements.find((x) => x.id === 'req-gerbil-food')!;
    expect(r.minSpec.rules).toHaveLength(2);
    expect(r.minSpec.rules[1]).toEqual({
      key: 'coversThisAnimal',
      op: 'eq',
      value: true,
      when: [{ key: 'forSpecies', op: 'eq', value: 'MULTI' }],
      reason: '여러 동물용이면 포장 대상에 저빌이 적혀 있어야 해요',
    });
    // 356: 저빌은 GENERAL_INFO 6종 — DRAFT → GENERAL_INFO. AI_DRAFT 는 VERIFIED 불가(불변식 7).
    expect([r.reviewStatus, r.reviewerType]).toEqual(['GENERAL_INFO', 'AI_DRAFT']);
  });
  it('시드 상품 어디에도 coversThisAnimal 값이 없다(사실 값은 검수자 몫)', () => {
    for (const p of seed.curatedProducts) expect([p.id, 'coversThisAnimal' in (p.specValues ?? {})]).toEqual([p.id, false]);
  });
});

describe('판정 표(저빌, 조단백 18) — 동물 판정 = 프로필 재계산(P01 단일 지점)', () => {
  const table: Array<[string, SpecValues, boolean, string]> = [
    ['GERBIL · 없음', { ...base, forSpecies: 'GERBIL' }, true, 'OK'],
    ['GERBIL · false', { ...base, forSpecies: 'GERBIL', coversThisAnimal: false }, true, 'OK'],
    ['GERBIL · true', { ...base, forSpecies: 'GERBIL', coversThisAnimal: true }, true, 'OK'],
    ['MULTI · true', { ...base, forSpecies: 'MULTI', coversThisAnimal: true }, true, 'BELOW_RECOMMENDED'],
    ['MULTI · 없음', { ...base, forSpecies: 'MULTI' }, false, 'CHECK'],
    ['MULTI · false', { ...base, forSpecies: 'MULTI', coversThisAnimal: false }, false, 'BELOW_MIN'],
    ['HAMSTER · true', { ...base, forSpecies: 'HAMSTER', coversThisAnimal: true }, false, 'BELOW_MIN'],
    ['GUINEA_PIG · 없음', { ...base, forSpecies: 'GUINEA_PIG' }, false, 'BELOW_MIN'],
    ['대상 없음 · true', { ...base, coversThisAnimal: true }, false, 'CHECK'],
  ];
  for (const [name, v, meets, verdict] of table) {
    it(`${name} → ${verdict} · meets=${String(meets)}`, () => {
      const r = judge(v);
      expect(r.animal).toEqual([meets, verdict]);
      expect(r.profile).toEqual(r.animal);
    });
  }
  it('MULTI · false 의 미달 사유 key = coversThisAnimal', () => {
    expect(judge({ ...base, forSpecies: 'MULTI', coversThisAnimal: false }).reasons).toContain('coversThisAnimal');
  });
});

describe('노출 경로(불변식 3) — 메모리 승격 복제본의 합성 ACTIVE·VERIFIED MULTI 사료', () => {
  const AS_OF = '2026-10-01';
  const V: Pick<ContentMeta, 'reviewStatus' | 'reviewerType' | 'verifiedBy' | 'verifiedAt'> = {
    reviewStatus: 'VERIFIED',
    reviewerType: 'EXPERIENCED_KEEPER',
    verifiedBy: 'keeper-test',
    verifiedAt: '2026-09-30',
  };
  const promoted = () => {
    const s = structuredClone(seed);
    const at = s.animalTypes.find((x) => x.id === G)!;
    Object.assign(at, V, { status: 'ACTIVE' });
    Object.assign(s.careProfiles.find((x) => x.id === CP)!, V);
    Object.assign(s.supplyRequirements.find((x) => x.id === 'req-gerbil-food')!, V);
    Object.assign(s.supplyItems.find((x) => x.id === 'food')!, V);
    return createCatalog(s);
  };
  const product = (specValues: SpecValues): CuratedProductRec =>
    ({ id: 'cp-test-multi', status: 'ACTIVE', meetsMinSpec: true, ...V, supplyItemId: 'food', careProfileIds: [CP], specValues }) as unknown as CuratedProductRec;

  it('coversThisAnimal 없음 → 노출 안 됨(meetsMinSpec=true 로 속여도 엔진 재판정이 막는다)', () => {
    expect(isProductExposable(promoted(), G, product({ ...base, forSpecies: 'MULTI' }), AS_OF)).toBe(false);
  });
  it('coversThisAnimal false → 노출 안 됨', () => {
    expect(isProductExposable(promoted(), G, product({ ...base, forSpecies: 'MULTI', coversThisAnimal: false }), AS_OF)).toBe(false);
  });
  it('coversThisAnimal true → 노출(승격 경로가 살아 있음을 함께 확인)', () => {
    expect(isProductExposable(promoted(), G, product({ ...base, forSpecies: 'MULTI', coversThisAnimal: true }), AS_OF)).toBe(true);
    expect(isProductExposable(promoted(), G, product({ ...base, forSpecies: 'GERBIL' }), AS_OF)).toBe(true);
  });
});

describe('L5 표시 — coversThisAnimal 은 저빌 사료에만(ruleScoped)', () => {
  const foodFields = (typeId: string) => {
    const r = listResolvedRequirements(cat, typeId).find((x) => x.supplyItemId === 'food');
    return r ? visibleSpecFields(r.item.specSchema, r.minSpec, r.recommendedSpec).map((f) => f.key) : null;
  };
  it('저빌: forSpecies 다음에 coversThisAnimal', () => {
    const keys = foodFields(G)!;
    expect(keys.indexOf('coversThisAnimal')).toBe(keys.indexOf('forSpecies') + 1);
  });
  for (const typeId of ['hamster-golden', 'hamster-dwarf', 'guinea-pig']) {
    it(`${typeId}: 사료 L5 에 coversThisAnimal 없음`, () => {
      const keys = foodFields(typeId);
      expect(keys).not.toBeNull();
      expect(keys).not.toContain('coversThisAnimal');
    });
  }
});
