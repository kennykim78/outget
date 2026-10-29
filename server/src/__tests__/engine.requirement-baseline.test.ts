// requirementBaseline + requirementCompat 권장 채움(155 안 A, Kenny 확정 — 작업 178) 합성 단위 테스트.
//   값은 임의(실제 시드 사실과 무관). 실제 시드 전후 비교는 engine.requirement-compat-matrix.test.ts.
//   변이 표적: M1(권장 우선) M2(CHECK 상한 제거) M3(when 포함) M4(min 모순 채움) M7(usedRecommended 생략)
//             M8(CHECK 상한을 최소 키에도) M10(gte 최솟값) M11(컨텍스트 없음·미입력 CHECK) M12(보유품 근거 제거) M14(specCheck 경로).
//   182(의미 기반 판정): 최소 우선 평가 생략·보유품 근거 생략·CHECK 상한 제거·역방향 inputSide 고정(X3) 각각 fail.
import { describe, expect, it } from 'vitest';
import { createCatalog, minSpecBaseline, requirementBaseline, requirementCompat, resolveRequirement, specCheck } from '../engine/index.js';
import type { CompatibilityRuleRec, RuleSet, SpecRule, SupplyRequirementRec, UserContext } from '../engine/index.js';
import { META, makeBundle } from './fixtures/engine-catalog.js';

const rs = (...rules: SpecRule[]): RuleSet => ({ rules });
const gte = (key: string, value: number, extra: Partial<SpecRule> = {}): SpecRule => ({ key, op: 'gte', value, reason: '이유', ...extra });
const eq = (key: string, value: string | boolean): SpecRule => ({ key, op: 'eq', value, reason: '이유' });

describe('requirementBaseline — 가상 입력 조립', () => {
  it('최소 키는 최소 값 그대로, 권장 키로 덮지 않음(M1)', () => {
    const b = requirementBaseline({ minSpec: rs(gte('sizeCm', 20)), recommendedSpec: rs(gte('sizeCm', 25)) });
    expect(b).toEqual({ input: { sizeCm: 20 }, recommendedKeys: [] });
  });
  it('최소가 정하지 않은 키: 권장 gte 중 최댓값(M10), 단일 eq 채움', () => {
    const b = requirementBaseline({
      minSpec: rs(eq('face', 'FLAT')),
      recommendedSpec: rs(gte('sizeCm', 25), gte('sizeCm', 28), eq('quiet', true)),
    });
    expect(b).toEqual({ input: { face: 'FLAT', sizeCm: 28, quiet: true }, recommendedKeys: ['quiet', 'sizeCm'] });
  });
  it('when 있는 권장 규칙은 채우지 않음(M3)', () => {
    const b = requirementBaseline({
      minSpec: rs(),
      recommendedSpec: rs(gte('sizeCm', 40, { when: [{ key: 'mount', op: 'eq', value: 'CLIP' }] })),
    });
    expect(b).toEqual({ input: {}, recommendedKeys: [] });
  });
  it('같은 키 minSpec 규칙과 모순이면 채우지 않음(M4) — lte·not_in·when 달린 min 포함', () => {
    expect(
      requirementBaseline({ minSpec: rs({ key: 'sizeCm', op: 'lte', value: 20, reason: '이유' }), recommendedSpec: rs(gte('sizeCm', 25)) }),
    ).toEqual({ input: {}, recommendedKeys: [] });
    expect(
      requirementBaseline({ minSpec: rs({ key: 'face', op: 'not_in', value: ['GRID'], reason: '이유' }), recommendedSpec: rs(eq('face', 'GRID')) }),
    ).toEqual({ input: {}, recommendedKeys: [] });
    expect(
      requirementBaseline({
        minSpec: rs(gte('sizeCm', 30, { when: [{ key: 'mount', op: 'eq', value: 'CLIP' }] })),
        recommendedSpec: rs(gte('sizeCm', 25)),
      }),
    ).toEqual({ input: {}, recommendedKeys: [] });
  });
  it('min 의 when 조건부 gte 만 있으면 기준값 없음(최소·권장 모두)', () => {
    const r = { minSpec: rs(gte('sizeCm', 30, { when: [{ key: 'mount', op: 'eq', value: 'CLIP' }] })), recommendedSpec: rs() };
    expect(minSpecBaseline(r)).toEqual({});
    expect(requirementBaseline(r)).toEqual({ input: {}, recommendedKeys: [] });
  });
  it('min in:[20] 과 모순되는 권장 gte25 는 채우지 않음', () => {
    expect(
      requirementBaseline({ minSpec: rs({ key: 'sizeCm', op: 'in', value: [20], reason: '이유' }), recommendedSpec: rs(gte('sizeCm', 25)) }),
    ).toEqual({ input: {}, recommendedKeys: [] });
  });
  it('모순 없는 같은 키 min 규칙(lte 상한 안쪽)은 채움', () => {
    expect(
      requirementBaseline({ minSpec: rs({ key: 'sizeCm', op: 'lte', value: 40, reason: '이유' }), recommendedSpec: rs(gte('sizeCm', 25)) }),
    ).toEqual({ input: { sizeCm: 25 }, recommendedKeys: ['sizeCm'] });
  });
});

// ---- 합성 카탈로그: 프로필 pf-test 의 spinner 요구사항·호환 규칙만 갈아 끼운다 ----
function catalogWith(opts: {
  spinner: Pick<SupplyRequirementRec, 'minSpec' | 'recommendedSpec'>;
  rules: CompatibilityRuleRec['rules'];
  override?: Pick<SupplyRequirementRec, 'recommendedSpec'>;
  /** 기본 a=spinner(용품)·b=box(보유품). reverse 면 a=box·b=spinner(QA180 LOW-1). */
  reverse?: boolean;
}) {
  const b = makeBundle();
  b.supplyRequirements = b.supplyRequirements.map((r) =>
    r.careProfileId === 'pf-test' && r.supplyItemId === 'spinner' ? { ...r, ...opts.spinner } : r,
  );
  b.compatibilityRules = [
    opts.reverse
      ? { ...META, id: 'cx-t', a: 'box', b: 'spinner', rules: opts.rules }
      : { ...META, id: 'cx-t', a: 'spinner', b: 'box', rules: opts.rules },
  ];
  b.animalTypes = b.animalTypes.map((a) =>
    a.id === 'critter' ? { ...a, careOverrides: opts.override ? { requirements: { spinner: opts.override } } : {} } : a,
  );
  return createCatalog(b);
}
const box = (heightCm?: number): UserContext => ({ ownedItems: { box: heightCm === undefined ? {} : { heightCm } } });
const FIT = { expr: 'a.sizeCm + 5 <= b.heightCm', onFail: 'BELOW_MIN' as const, message: '회전판이 상자보다 커요.' };

describe('requirementCompat — 권장 채움 판정', () => {
  const recOnly = catalogWith({ spinner: { minSpec: rs(eq('face', 'FLAT')), recommendedSpec: rs(gte('sizeCm', 25)) }, rules: [FIT] });

  it('권장 키 참조 실패는 onFail BELOW_MIN 이어도 CHECK(M2), usedRecommended(M7)', () => {
    const c = requirementCompat(recOnly, 'critter-plain', 'spinner', box(20));
    expect([c.verdict, c.usedRecommended, c.reasons.map((r) => r.verdict)]).toEqual(['CHECK', true, ['CHECK']]);
    expect(c.checkedRuleIds).toEqual(['cx-t']);
  });
  it('권장 키로 통과 → OK + usedRecommended', () => {
    const c = requirementCompat(recOnly, 'critter-plain', 'spinner', box(30));
    expect([c.verdict, c.usedRecommended]).toEqual(['OK', true]);
  });
  it('컨텍스트 없음·높이 미입력 → NONE, usedRecommended 생략(M11)', () => {
    expect(requirementCompat(recOnly, 'critter-plain', 'spinner')).toEqual({ verdict: 'NONE', reasons: [], checkedRuleIds: [] });
    expect(requirementCompat(recOnly, 'critter-plain', 'spinner', box())).toEqual({ verdict: 'NONE', reasons: [], checkedRuleIds: [] });
  });
  it('최소 키 참조 실패는 BELOW_MIN 유지, usedRecommended 생략(M8)', () => {
    const minCat = catalogWith({ spinner: { minSpec: rs(gte('sizeCm', 20)), recommendedSpec: rs(gte('sizeCm', 25)) }, rules: [FIT] });
    const c = requirementCompat(minCat, 'critter-plain', 'spinner', box(20));
    expect(c.verdict).toBe('BELOW_MIN');
    expect('usedRecommended' in c).toBe(false);
  });
  it('보유품(b) 키를 참조하지 않는 항목은 판정하지 않음 → NONE(M12)', () => {
    const noB = catalogWith({
      spinner: { minSpec: rs(), recommendedSpec: rs(gte('sizeCm', 25)) },
      rules: [{ expr: 'a.sizeCm >= 25', onFail: 'CHECK', message: '지름 확인.' }],
    });
    expect(requirementCompat(noB, 'critter-plain', 'spinner', box(50))).toEqual({ verdict: 'NONE', reasons: [], checkedRuleIds: [] });
  });
  it('보유품 무관 실패 항목은 판정 유지(187): 최소 입력 실패 → onFail 등급, 권장 입력 실패 → CHECK 상한 + 표식', () => {
    const minFail = catalogWith({
      spinner: { minSpec: rs(gte('sizeCm', 20)), recommendedSpec: rs(eq('quiet', true)) },
      rules: [{ expr: 'a.sizeCm >= 25', onFail: 'BELOW_MIN', message: '지름 확인.' }, FIT],
    });
    const m = requirementCompat(minFail, 'critter-plain', 'spinner', box(30));
    expect([m.verdict, m.checkedRuleIds, m.reasons.map((r) => [r.ruleId, r.verdict])]).toEqual(['BELOW_MIN', ['cx-t'], [['cx-t#0', 'BELOW_MIN']]]);
    expect('usedRecommended' in m).toBe(false);
    const recFail = catalogWith({
      spinner: { minSpec: rs(eq('face', 'FLAT')), recommendedSpec: rs(gte('sizeCm', 25)) },
      rules: [{ expr: 'a.sizeCm >= 30', onFail: 'BELOW_MIN', message: '지름 확인.' }, FIT],
    });
    const r = requirementCompat(recFail, 'critter-plain', 'spinner', box(40));
    expect([r.verdict, r.usedRecommended, r.reasons.map((x) => [x.ruleId, x.verdict])]).toEqual(['CHECK', true, [['cx-t#0', 'CHECK']]]);
  });
  it('careOverrides 의 recommendedSpec 이 가상 입력을 결정(resolveRequirement 경유)', () => {
    const ov = catalogWith({
      spinner: { minSpec: rs(eq('face', 'FLAT')), recommendedSpec: rs(gte('sizeCm', 25)) },
      rules: [FIT],
      override: { recommendedSpec: rs(gte('sizeCm', 35)) },
    });
    expect(requirementBaseline(resolveRequirement(ov, 'critter', 'spinner')!).input).toEqual({ face: 'FLAT', sizeCm: 35 });
    expect(requirementCompat(ov, 'critter', 'spinner', box(38)).verdict).toBe('CHECK'); // 35+5 > 38
    expect(requirementCompat(ov, 'critter-plain', 'spinner', box(38)).verdict).toBe('OK'); // 25+5 ≤ 38
  });
  it('specCheck 실제 입력 경로는 불변: 지름 미입력 → 호환 CHECK, usedRecommended 없음(M14)', () => {
    const r = specCheck(recOnly, 'critter-plain', 'spinner', { face: 'FLAT', mount: 'FLOOR' }, box(20));
    expect(r.compat.verdict).toBe('CHECK');
    expect('usedRecommended' in r.compat).toBe(false);
    const low = specCheck(recOnly, 'critter-plain', 'spinner', { sizeCm: 25, face: 'FLAT', mount: 'FLOOR' }, box(20));
    expect(low.compat.verdict).toBe('BELOW_MIN');
  });
});

describe('requirementCompat — 실제 평가 경로 기준 판정(182, Codex 181 ⓐⓑ)', () => {
  const NONE = { verdict: 'NONE', reasons: [], checkedRuleIds: [] };
  // 최소 sizeCm 27·face FLAT, 권장 quiet true(합성 값).
  const minRec = { minSpec: rs(gte('sizeCm', 27), eq('face', 'FLAT')), recommendedSpec: rs(eq('quiet', true)) };

  it('ⓐ 선택되지 않은 분기의 권장 키는 등급·표식에 영향 없음 → BELOW_MIN, 표식 없음', () => {
    const cat = catalogWith({
      spinner: minRec,
      rules: [{ expr: "a.face == 'FLAT' ? a.sizeCm + 25 <= b.heightCm : a.quiet == true", onFail: 'BELOW_MIN', message: '공간 부족.' }],
    });
    const c = requirementCompat(cat, 'critter-plain', 'spinner', box(51));
    expect([c.verdict, c.reasons.map((r) => r.verdict)]).toEqual(['BELOW_MIN', ['BELOW_MIN']]);
    expect('usedRecommended' in c).toBe(false);
    const ok = requirementCompat(cat, 'critter-plain', 'spinner', box(52));
    expect(ok.verdict).toBe('OK');
    expect('usedRecommended' in ok).toBe(false);
  });
  it('ⓑ 선택되지 않은 분기의 보유품 참조는 근거가 아님 → NONE', () => {
    const cat = catalogWith({
      spinner: minRec,
      rules: [
        { expr: "a.face == 'FLAT' ? a.sizeCm >= 27 : a.quiet == true && b.heightCm >= 50", onFail: 'BELOW_MIN', message: '확인.' },
      ],
    });
    expect(requirementCompat(cat, 'critter-plain', 'spinner', box())).toEqual(NONE);
    expect(requirementCompat(cat, 'critter-plain', 'spinner', box(60))).toEqual(NONE);
  });
  it('권장값을 채웠지만 식이 참조하지 않음 → 최소 실패 BELOW_MIN, 표식 없음', () => {
    const cat = catalogWith({ spinner: { minSpec: rs(gte('sizeCm', 20)), recommendedSpec: rs(eq('quiet', true)) }, rules: [FIT] });
    const c = requirementCompat(cat, 'critter-plain', 'spinner', box(20));
    expect(c.verdict).toBe('BELOW_MIN');
    expect('usedRecommended' in c).toBe(false);
  });
  it('최소 실패 + 권장 실패 두 항목 → reasons [BELOW_MIN, CHECK], 최종 BELOW_MIN, 표식 있음', () => {
    const cat = catalogWith({
      spinner: { minSpec: rs(gte('sizeCm', 20)), recommendedSpec: rs(eq('quiet', true)) },
      rules: [FIT, { expr: 'a.quiet == true ? b.heightCm >= 30 : true', onFail: 'BELOW_MIN', message: '저소음 여유.' }],
    });
    const c = requirementCompat(cat, 'critter-plain', 'spinner', box(20));
    expect(c.reasons.map((r) => r.verdict)).toEqual(['BELOW_MIN', 'CHECK']);
    expect([c.verdict, c.usedRecommended]).toEqual(['BELOW_MIN', true]);
  });
  it('최소·권장 키를 함께 참조하는 식이라도 최소로 확정되는 실패는 BELOW_MIN 유지', () => {
    const cat = catalogWith({
      spinner: { minSpec: rs(gte('sizeCm', 20)), recommendedSpec: rs(eq('quiet', true)) },
      rules: [{ expr: 'a.sizeCm + 5 > b.heightCm ? false : a.quiet == true', onFail: 'BELOW_MIN', message: '공간 부족.' }],
    });
    const fail = requirementCompat(cat, 'critter-plain', 'spinner', box(20));
    expect(fail.verdict).toBe('BELOW_MIN');
    expect('usedRecommended' in fail).toBe(false);
    // 같은 식이 최소로 확정되지 않으면(권장 분기 선택) 권장 보충 → 통과 + 표식.
    const pass = requirementCompat(cat, 'critter-plain', 'spinner', box(40));
    expect([pass.verdict, pass.usedRecommended]).toEqual(['OK', true]);
  });
  it('엄격 3값: 최소 false && 권장 → 최소만으론 UNKNOWN 이라 권장 보충, CHECK 상한(보수적 하향 — 182 잔여 한계)', () => {
    const cat = catalogWith({
      spinner: { minSpec: rs(gte('sizeCm', 20)), recommendedSpec: rs(eq('quiet', true)) },
      rules: [{ expr: 'a.sizeCm + 5 <= b.heightCm && a.quiet == true', onFail: 'BELOW_MIN', message: '공간 부족.' }],
    });
    const c = requirementCompat(cat, 'critter-plain', 'spinner', box(20));
    expect([c.verdict, c.usedRecommended]).toEqual(['CHECK', true]);
  });
});

describe('requirementCompat — 역방향 규칙(rule.a=보유품, rule.b=용품; QA180 LOW-1·X3)', () => {
  const REV_FIT = { expr: 'b.sizeCm + 5 <= a.heightCm', onFail: 'BELOW_MIN' as const, message: '회전판이 상자보다 커요.' };
  it('권장 키 실패 → CHECK + 표식, 통과 → OK', () => {
    const cat = catalogWith({ spinner: { minSpec: rs(eq('face', 'FLAT')), recommendedSpec: rs(gte('sizeCm', 25)) }, rules: [REV_FIT], reverse: true });
    const c = requirementCompat(cat, 'critter-plain', 'spinner', box(20));
    expect([c.verdict, c.usedRecommended, c.checkedRuleIds]).toEqual(['CHECK', true, ['cx-t']]);
    expect(requirementCompat(cat, 'critter-plain', 'spinner', box(30)).verdict).toBe('OK');
  });
  it('최소 키 실패 → BELOW_MIN, 표식 없음', () => {
    const cat = catalogWith({ spinner: { minSpec: rs(gte('sizeCm', 20)), recommendedSpec: rs(gte('sizeCm', 25)) }, rules: [REV_FIT], reverse: true });
    const c = requirementCompat(cat, 'critter-plain', 'spinner', box(20));
    expect(c.verdict).toBe('BELOW_MIN');
    expect('usedRecommended' in c).toBe(false);
  });
  it('보유품(a) 키를 쓰지 않는 항목 → NONE', () => {
    const cat = catalogWith({
      spinner: { minSpec: rs(), recommendedSpec: rs(gte('sizeCm', 25)) },
      rules: [{ expr: 'b.sizeCm >= 25', onFail: 'CHECK', message: '지름 확인.' }],
      reverse: true,
    });
    expect(requirementCompat(cat, 'critter-plain', 'spinner', box(50))).toEqual({ verdict: 'NONE', reasons: [], checkedRuleIds: [] });
  });
});
