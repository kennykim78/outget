// E1–E6 — 규칙 집합 판정(부록 A minSpec/recommendedSpec). 합성 스키마만 사용.
import { describe, expect, it } from 'vitest';
import {
  VERDICT_SEVERITY,
  evaluateProductStage,
  evaluateRuleSet,
  isNoCriteria,
  worstVerdict,
} from '../engine/rules.js';
import type { RuleSet, SpecRule } from '../engine/types.js';
import { BOX_SCHEMA, SPINNER_SCHEMA } from './fixtures/engine-catalog.js';

const set = (...rules: SpecRule[]): RuleSet => ({ rules });
const r = (key: string, op: SpecRule['op'], value: SpecRule['value'], extra: Partial<SpecRule> = {}): SpecRule => ({
  key,
  op,
  value,
  reason: '테스트 사유',
  ...extra,
});

describe('E1 operators — pass / fail / boundary', () => {
  it.each([
    ['gte pass', r('widthCm', 'gte', 50), { widthCm: 60 }, 'OK'],
    ['gte boundary', r('widthCm', 'gte', 50), { widthCm: 50 }, 'OK'],
    ['gte fail', r('widthCm', 'gte', 50), { widthCm: 49.9 }, 'BELOW_MIN'],
    ['lte pass', r('gapMm', 'lte', 10), { gapMm: 9 }, 'OK'],
    ['lte boundary', r('gapMm', 'lte', 10), { gapMm: 10 }, 'OK'],
    ['lte fail', r('gapMm', 'lte', 10), { gapMm: 10.5 }, 'BELOW_MIN'],
    ['eq number pass', r('widthCm', 'eq', 50), { widthCm: 50 }, 'OK'],
    ['eq number fail', r('widthCm', 'eq', 50), { widthCm: 51 }, 'BELOW_MIN'],
    ['eq enum pass', r('type', 'eq', 'BOX'), { type: 'BOX' }, 'OK'],
    ['eq enum fail', r('type', 'eq', 'BOX'), { type: 'OTHER' }, 'BELOW_MIN'],
    ['eq boolean pass', r('lid', 'eq', false), { lid: false }, 'OK'],
    ['eq boolean fail', r('lid', 'eq', false), { lid: true }, 'BELOW_MIN'],
    ['in pass', r('type', 'in', ['BOX', 'MESH_BOX']), { type: 'MESH_BOX' }, 'OK'],
    ['in fail', r('type', 'in', ['BOX', 'MESH_BOX']), { type: 'OTHER' }, 'BELOW_MIN'],
    ['not_in pass', r('type', 'not_in', ['OTHER']), { type: 'BOX' }, 'OK'],
    ['not_in fail', r('type', 'not_in', ['OTHER']), { type: 'OTHER' }, 'BELOW_MIN'],
  ] as const)('%s (MIN)', (_name, rule, input, expected) => {
    expect(evaluateRuleSet(BOX_SCHEMA, set(rule), input, 'MIN').verdict).toBe(expected);
  });

  it('RECOMMENDED failure → BELOW_RECOMMENDED with kind RECOMMENDED', () => {
    const out = evaluateRuleSet(BOX_SCHEMA, set(r('widthCm', 'gte', 80)), { widthCm: 60 }, 'RECOMMENDED');
    expect(out.verdict).toBe('BELOW_RECOMMENDED');
    expect(out.reasons).toHaveLength(1);
    expect(out.reasons[0]).toMatchObject({
      stage: 'PRODUCT',
      kind: 'RECOMMENDED',
      verdict: 'BELOW_RECOMMENDED',
      key: 'widthCm',
      expected: 80,
      actual: 60,
    });
  });

  it('MIN failure reason carries key, expected, actual', () => {
    const out = evaluateRuleSet(BOX_SCHEMA, set(r('type', 'in', ['BOX'])), { type: 'OTHER' }, 'MIN');
    expect(out.reasons[0]).toMatchObject({ kind: 'MIN', verdict: 'BELOW_MIN', key: 'type', expected: ['BOX'], actual: 'OTHER' });
  });

  it('passing rules produce no reasons', () => {
    expect(evaluateRuleSet(BOX_SCHEMA, set(r('widthCm', 'gte', 50)), { widthCm: 90 }, 'MIN').reasons).toEqual([]);
  });
});

describe('E2 missing input key → CHECK', () => {
  it.each(['MIN', 'RECOMMENDED'] as const)('%s', (kind) => {
    const out = evaluateRuleSet(BOX_SCHEMA, set(r('gapMm', 'lte', 10)), { widthCm: 60 }, kind);
    expect(out.verdict).toBe('CHECK');
    expect(out.reasons[0]).toMatchObject({ kind: 'INPUT', verdict: 'CHECK', key: 'gapMm' });
  });

  it('optional schema field still CHECKs when a rule needs it', () => {
    expect(evaluateRuleSet(BOX_SCHEMA, set(r('gapMm', 'lte', 10)), {}, 'MIN').verdict).toBe('CHECK');
  });

  it('explicit undefined counts as missing', () => {
    expect(evaluateRuleSet(BOX_SCHEMA, set(r('widthCm', 'gte', 1)), { widthCm: undefined }, 'MIN').verdict).toBe('CHECK');
  });
});

describe('E3 when conditions', () => {
  const gated = r('gapMm', 'lte', 10, { when: [{ key: 'type', op: 'eq', value: 'MESH_BOX' }] });

  it('when false → rule not applicable (OK even without the gated key)', () => {
    const out = evaluateRuleSet(BOX_SCHEMA, set(gated), { type: 'BOX' }, 'MIN');
    expect(out).toEqual({ verdict: 'OK', reasons: [] });
  });

  it('when true → rule applies', () => {
    expect(evaluateRuleSet(BOX_SCHEMA, set(gated), { type: 'MESH_BOX', gapMm: 12 }, 'MIN').verdict).toBe('BELOW_MIN');
    expect(evaluateRuleSet(BOX_SCHEMA, set(gated), { type: 'MESH_BOX', gapMm: 8 }, 'MIN').verdict).toBe('OK');
  });

  it('when key missing → CHECK', () => {
    const out = evaluateRuleSet(BOX_SCHEMA, set(gated), { gapMm: 8 }, 'MIN');
    expect(out.verdict).toBe('CHECK');
    expect(out.reasons[0]).toMatchObject({ kind: 'INPUT', key: 'type' });
  });

  it('any definitively-false condition skips even if another condition key is missing (AND)', () => {
    const rule = r('gapMm', 'lte', 10, {
      when: [
        { key: 'type', op: 'eq', value: 'MESH_BOX' },
        { key: 'lid', op: 'eq', value: true },
      ],
    });
    expect(evaluateRuleSet(BOX_SCHEMA, set(rule), { type: 'BOX' }, 'MIN').verdict).toBe('OK');
  });
});

describe('E4 invalid input or rule → CHECK', () => {
  it.each([
    ['string for number', { widthCm: '60' }],
    ['below schema min', { widthCm: 5 }],
    ['above schema max', { widthCm: 500 }],
    ['NaN', { widthCm: Number.NaN }],
    ['Infinity', { widthCm: Number.POSITIVE_INFINITY }],
  ])('%s', (_n, input) => {
    const out = evaluateRuleSet(BOX_SCHEMA, set(r('widthCm', 'gte', 50)), input as never, 'MIN');
    expect(out.verdict).toBe('CHECK');
    expect(out.reasons[0]).toMatchObject({ kind: 'INPUT', key: 'widthCm' });
  });

  it('enum value not in options', () => {
    expect(evaluateRuleSet(BOX_SCHEMA, set(r('type', 'eq', 'BOX')), { type: 'BOXX' }, 'MIN').verdict).toBe('CHECK');
  });

  it('boolean given as string', () => {
    expect(evaluateRuleSet(BOX_SCHEMA, set(r('lid', 'eq', true)), { lid: 'true' } as never, 'MIN').verdict).toBe('CHECK');
  });

  it('rule key not in schema', () => {
    expect(evaluateRuleSet(BOX_SCHEMA, set(r('ghost', 'gte', 1)), { ghost: 3 }, 'MIN').verdict).toBe('CHECK');
  });

  it.each([
    ['gte with string value', r('widthCm', 'gte', '50')],
    ['gte on enum field', r('type', 'gte', 1)],
    ['in with scalar', r('type', 'in', 'BOX')],
    ['eq with array', r('type', 'eq', ['BOX'])],
    ['unknown op', r('widthCm', 'gt' as never, 1)],
  ])('malformed rule: %s', (_n, rule) => {
    const out = evaluateRuleSet(BOX_SCHEMA, set(rule), { widthCm: 60, type: 'BOX' }, 'MIN');
    expect(out.verdict).toBe('CHECK');
    expect(out.reasons[0].kind).toBe('RULE');
  });
});

describe('E5 precedence BELOW_MIN > CHECK > BELOW_RECOMMENDED > OK', () => {
  it('severity table', () => {
    expect(VERDICT_SEVERITY).toEqual({ OK: 0, BELOW_RECOMMENDED: 1, CHECK: 2, BELOW_MIN: 3 });
    expect(worstVerdict([])).toBe('OK');
    expect(worstVerdict(['OK', 'CHECK', 'BELOW_RECOMMENDED'])).toBe('CHECK');
    expect(worstVerdict(['CHECK', 'BELOW_MIN'])).toBe('BELOW_MIN');
  });

  it('MIN fail + CHECK in one set = BELOW_MIN', () => {
    const out = evaluateRuleSet(BOX_SCHEMA, set(r('widthCm', 'gte', 50), r('gapMm', 'lte', 10)), { widthCm: 20 }, 'MIN');
    expect(out.verdict).toBe('BELOW_MIN');
    expect(out.reasons.map((x) => x.verdict).sort()).toEqual(['BELOW_MIN', 'CHECK']);
  });

  it('product stage: MIN CHECK + REC fail = CHECK', () => {
    const out = evaluateProductStage(
      BOX_SCHEMA,
      set(r('gapMm', 'lte', 10)),
      set(r('widthCm', 'gte', 80)),
      { widthCm: 60 },
    );
    expect(out.verdict).toBe('CHECK');
  });

  it('product stage: MIN fail + REC CHECK = BELOW_MIN', () => {
    const out = evaluateProductStage(SPINNER_SCHEMA, set(r('sizeCm', 'gte', 20)), set(r('quiet', 'eq', true)), {
      sizeCm: 10,
    });
    expect(out.verdict).toBe('BELOW_MIN');
  });

  it('product stage: MIN ok + REC fail = BELOW_RECOMMENDED', () => {
    const out = evaluateProductStage(SPINNER_SCHEMA, set(r('sizeCm', 'gte', 20)), set(r('sizeCm', 'gte', 25)), {
      sizeCm: 22,
    });
    expect(out.verdict).toBe('BELOW_RECOMMENDED');
  });

  it('product stage dedupes INPUT reasons for the same missing key', () => {
    const out = evaluateProductStage(BOX_SCHEMA, set(r('gapMm', 'lte', 10)), set(r('gapMm', 'lte', 8)), {});
    expect(out.reasons.filter((x) => x.kind === 'INPUT')).toHaveLength(1);
  });
});

// arch-23 결정 ②·D-1: 단일 집합이 비면 OK + NO_CRITERIA(다른 쪽으로 판정, D-2). 제품 단계에서 둘 다 비면 「기준 없음」 =
//   CHECK + NO_CRITERIA(verdict CHECK) 1건 — OK 가 아니다(meets=false → 추천 제외).
describe('E6 empty rule-set — 단일 집합 OK + NO_CRITERIA, 제품 단계 둘 다 빔 → CHECK + NO_CRITERIA', () => {
  it('evaluateRuleSet(빈 집합 하나)은 그대로 OK + NO_CRITERIA(verdict OK)', () => {
    const out = evaluateRuleSet(BOX_SCHEMA, set(), {}, 'MIN');
    expect(out.verdict).toBe('OK');
    expect(out.reasons).toHaveLength(1);
    expect(out.reasons[0]).toMatchObject({ kind: 'NO_CRITERIA', verdict: 'OK', stage: 'PRODUCT' });
  });

  it('product stage with both empty → CHECK + single NO_CRITERIA(verdict CHECK)', () => {
    const out = evaluateProductStage(BOX_SCHEMA, set(), set(), {});
    expect(out).toEqual({
      verdict: 'CHECK',
      reasons: [{ stage: 'PRODUCT', kind: 'NO_CRITERIA', verdict: 'CHECK', message: '등록된 규격 기준이 없는 용품이에요.' }],
    });
    expect(isNoCriteria(out)).toBe(true);
  });

  it('both empty: 입력 값과 무관하게 같은 결과(예·아니오·빈 값·범위 밖)', () => {
    const empty = evaluateProductStage(BOX_SCHEMA, set(), set(), {});
    for (const input of [{ lid: true }, { lid: false }, { widthCm: 9999, type: 'NOPE' }]) {
      expect(evaluateProductStage(BOX_SCHEMA, set(), set(), input)).toEqual(empty);
    }
  });

  it('product stage with only REC rules → no NO_CRITERIA', () => {
    const out = evaluateProductStage(BOX_SCHEMA, set(), set(r('widthCm', 'gte', 80)), { widthCm: 90 });
    expect(out).toEqual({ verdict: 'OK', reasons: [] });
    expect(isNoCriteria(out)).toBe(false);
  });

  it('product stage with only MIN rules → MIN 으로 판정, NO_CRITERIA 0', () => {
    const out = evaluateProductStage(BOX_SCHEMA, set(r('widthCm', 'gte', 50)), set(), { widthCm: 40 });
    expect(out.verdict).toBe('BELOW_MIN');
    expect(out.reasons.map((x) => x.kind)).toEqual(['MIN']);
  });

  it('규칙 집합이 깨지면(rules 없음) 기존 RULE CHECK 그대로 — 기준 없음 아님(회귀 0)', () => {
    const out = evaluateProductStage(BOX_SCHEMA, {} as RuleSet, set(), {});
    expect(out.verdict).toBe('CHECK');
    expect(out.reasons.map((x) => x.kind)).toEqual(['RULE']);
    expect(isNoCriteria(out)).toBe(false);
  });
});

describe('isNoCriteria — 「기준 없음」 단일 판별(arch-23 D-1)', () => {
  it('정보 부족 CHECK(INPUT·RULE)·OK·BELOW_* 는 false', () => {
    expect(isNoCriteria(evaluateProductStage(BOX_SCHEMA, set(r('widthCm', 'gte', 50)), set(), {}))).toBe(false); // INPUT CHECK
    expect(isNoCriteria(evaluateProductStage(BOX_SCHEMA, set(r('nope', 'gte', 1)), set(), {}))).toBe(false); // RULE CHECK
    expect(isNoCriteria(evaluateProductStage(BOX_SCHEMA, set(r('widthCm', 'gte', 50)), set(), { widthCm: 60 }))).toBe(false); // OK
    expect(isNoCriteria(evaluateRuleSet(BOX_SCHEMA, set(), {}, 'MIN'))).toBe(false); // 단일 집합 OK + NO_CRITERIA(OK)
  });
  it('null·undefined·빈 사유 → false', () => {
    expect(isNoCriteria(null)).toBe(false);
    expect(isNoCriteria(undefined)).toBe(false);
    expect(isNoCriteria({ verdict: 'CHECK', reasons: [] })).toBe(false);
  });
});
