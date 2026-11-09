// 271(268 단계 5) — 앵무 새장 SupplyItem `bird-cage` 구조 착지 · specCheck 가 그 스키마를 받는지.
//   디스크 시드(실시드)에는 앵무 요구사항 행이 없다(사실값 0, 결정 ②) → specCheck 는 판정하지 않는다(EngineLookupError).
//   아래 합성 minSpec 의 숫자·선택값은 엔진 경로 시험용 임의값이다 — 앵무 사육·규격 기준이 아니다(불변식 ⑦, 매트릭스 4).
//   디스크 시드는 바꾸지 않는다(메모리 사본만).
import { describe, expect, it } from 'vitest';
import {
  EngineLookupError,
  createCatalog,
  isNoCriteria,
  sanitizeSpecValues,
  specCheck,
  type RuleSet,
  type SeedBundle,
  type SpecSchema,
  type SupplyRequirementRec,
} from '../engine/index.js';
import { realSeed } from './fixtures/prerender-seed.js';

const BIRD = 'budgie';
const CP = 'cp-parrot-small';

/** 엔진 경로 시험용 합성 규칙(임의값 — 사실 아님). heightCm gte · barGapMm lte · barOrientation in. */
const SYNTH_MIN: RuleSet = {
  rules: [
    { key: 'heightCm', op: 'gte', value: 111, reason: '합성 규칙 A' },
    { key: 'barGapMm', op: 'lte', value: 7, reason: '합성 규칙 B' },
    { key: 'barOrientation', op: 'in', value: ['VERTICAL'], reason: '합성 규칙 C' },
  ],
};

function withSynthRequirement(seed: SeedBundle, minSpec: RuleSet, recommendedSpec: RuleSet = { rules: [] }): SeedBundle {
  const base = seed.supplyRequirements[0];
  if (!base) throw new Error('fixture: 요구사항 행 없음');
  const r: SupplyRequirementRec = {
    ...structuredClone(base),
    id: 'req-synth-bird-cage',
    careProfileId: CP,
    supplyItemId: 'bird-cage',
    minSpec,
    recommendedSpec,
  };
  seed.supplyRequirements.push(r);
  return seed;
}

const schemaOf = (seed: SeedBundle): SpecSchema => {
  const it = seed.supplyItems.find((x) => x.id === 'bird-cage');
  if (!it) throw new Error('fixture: bird-cage 없음');
  return it.specSchema;
};

describe('bird-cage 디스크 구조(사실값 0)', () => {
  const seed = realSeed();
  it('CAGE · DRAFT/AI_DRAFT · 필드 = type·widthCm·depthCm·heightCm·barGapMm·barOrientation', () => {
    const it0 = seed.supplyItems.find((x) => x.id === 'bird-cage');
    expect(it0?.category).toBe('CAGE');
    expect([it0?.reviewStatus, it0?.reviewerType]).toEqual(['DRAFT', 'AI_DRAFT']);
    expect(schemaOf(seed).fields.map((f) => f.key)).toEqual(['type', 'widthCm', 'depthCm', 'heightCm', 'barGapMm', 'barOrientation']);
    const orient = schemaOf(seed).fields.find((f) => f.key === 'barOrientation');
    expect(orient?.type === 'enum' && orient.options).toEqual(['HORIZONTAL', 'VERTICAL', 'MIXED']);
  });
  it('기존 cage 와 분리(바닥 키 floorWcm·floorDcm 없음)', () => {
    const keys = schemaOf(seed).fields.map((f) => f.key);
    expect(keys.includes('floorWcm') || keys.includes('floorDcm')).toBe(false);
  });
  it('실시드엔 앵무 요구사항 행 0 → specCheck 는 판정하지 않는다(EngineLookupError)', () => {
    expect(seed.supplyRequirements.filter((r) => r.careProfileId.startsWith('cp-parrot-'))).toEqual([]);
    const cat = createCatalog(seed);
    expect(() => specCheck(cat, BIRD, 'bird-cage', { heightCm: 50 })).toThrow(EngineLookupError);
  });
});

describe('specCheck × bird-cage 스키마(합성 규칙, 메모리)', () => {
  const cat = createCatalog(withSynthRequirement(realSeed(), SYNTH_MIN));
  const full = { type: 'WIRE', widthCm: 50, depthCm: 40, heightCm: 120, barGapMm: 6, barOrientation: 'VERTICAL' };

  it('전부 충족 → OK', () => {
    const r = specCheck(cat, BIRD, 'bird-cage', full);
    expect(r.product.verdict).toBe('OK');
    expect(r.compat.verdict).toBe('NONE');
    expect(r.verdict).toBe('OK');
  });
  it('heightCm 미달 → BELOW_MIN', () => {
    expect(specCheck(cat, BIRD, 'bird-cage', { ...full, heightCm: 80 }).verdict).toBe('BELOW_MIN');
  });
  it('barGapMm 초과(lte) → BELOW_MIN', () => {
    expect(specCheck(cat, BIRD, 'bird-cage', { ...full, barGapMm: 9 }).verdict).toBe('BELOW_MIN');
  });
  it('barOrientation in 밖 → BELOW_MIN', () => {
    expect(specCheck(cat, BIRD, 'bird-cage', { ...full, barOrientation: 'HORIZONTAL' }).verdict).toBe('BELOW_MIN');
  });
  it('선택 필드 barOrientation 미입력 → CHECK(값이 없어 판정 불가)', () => {
    const rest = { ...full } as Partial<typeof full>;
    delete rest.barOrientation;
    const r = specCheck(cat, BIRD, 'bird-cage', rest);
    expect(r.verdict).toBe('CHECK');
    expect(r.reasons.some((x) => x.kind === 'INPUT' && x.key === 'barOrientation')).toBe(true);
  });
  it('스키마 밖 enum 값 → CHECK(무효 입력)', () => {
    expect(specCheck(cat, BIRD, 'bird-cage', { ...full, barOrientation: 'DIAGONAL' }).verdict).toBe('CHECK');
  });
  it('결정적: 같은 입력 → 같은 결과', () => {
    expect(specCheck(cat, BIRD, 'bird-cage', full)).toEqual(specCheck(cat, BIRD, 'bird-cage', full));
  });
});

describe('규칙 없음 → 판정 없음(「기준 없음」, arch-23 결정 ②)', () => {
  it('합성 요구사항이 있어도 minSpec·recommendedSpec 이 비면 CHECK + NO_CRITERIA 1건 · 호환 NONE · 대안 0', () => {
    const cat = createCatalog(withSynthRequirement(realSeed(), { rules: [] }));
    const r = specCheck(cat, BIRD, 'bird-cage', { heightCm: 20 });
    expect(r.product.reasons.map((x) => x.kind)).toEqual(['NO_CRITERIA']);
    expect(r.product.verdict).toBe('CHECK');
    expect(isNoCriteria(r.product)).toBe(true);
    expect(r.verdict).toBe('CHECK');
    expect(r.alternatives).toEqual([]); // D-3: 기준 없음 + 호환 NONE → 대안 없음
    expect(r.compat).toEqual({ verdict: 'NONE', reasons: [], checkedRuleIds: [] });
  });
});

describe('sanitizeSpecValues × bird-cage(입력 허용 범위 — 복지 기준 아님)', () => {
  const schema = schemaOf(realSeed());
  it('범위 안 값은 남기고, 범위 밖·형식 오류·스키마 밖 키는 버린다', () => {
    const out = sanitizeSpecValues(schema, {
      type: 'WIRE',
      widthCm: 19, // min 20 밖
      depthCm: 40,
      heightCm: 301, // max 300 밖
      barGapMm: 2, // min 3 밖
      barOrientation: 'MIXED',
      floorWcm: 60, // bird-cage 스키마에 없는 키
    });
    expect(out).toEqual({ type: 'WIRE', depthCm: 40, barOrientation: 'MIXED' });
  });
  it('경계값(min·max)은 남는다', () => {
    expect(sanitizeSpecValues(schema, { widthCm: 20, heightCm: 300, barGapMm: 50 })).toEqual({ widthCm: 20, heightCm: 300, barGapMm: 50 });
  });
});
