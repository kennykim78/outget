// verdictView — 순수 표시 함수(스펙33 §3 표). 판정 계산은 엔진, 여기는 매핑만.
import { COPY, GLYPH } from '@ws/copy';
import type { RuleSet, SpecCheckResult, SpecSchema } from '@ws/engine';
import { describe, expect, it } from 'vitest';
import {
  cageSummary,
  compatMark,
  formFields,
  overallMark,
  perRuleVerdicts,
  productHeadline,
  productMark,
  showOptionalMark,
  toSpecInput,
  visibleCompatMark,
  yearMonth,
} from './verdictView';

const SCHEMA: SpecSchema = {
  fields: [
    { key: 'diameterCm', label: '지름(cm)', type: 'number', min: 5, max: 60 },
    { key: 'surface', label: '바닥면', type: 'enum', options: ['SOLID', 'MESH'], optionLabels: { SOLID: '막힌 판', MESH: '망형' } },
    { key: 'raw', label: '라벨 없음', type: 'enum', options: ['A', 'B'], optionLabels: { A: '에이' } },
    { key: 'silent', label: '무소음', type: 'boolean', optional: true },
  ],
};

describe('verdictView', () => {
  it('제품 단 매핑: OK ✓ · 권장 미만 △ · 최소 미달 ✕ · CHECK ?(D-42)', () => {
    expect(productMark('OK')).toEqual({ glyph: GLYPH.ready, tone: 'ready', label: COPY.verdict.productOk });
    expect(productMark('BELOW_RECOMMENDED')).toMatchObject({ glyph: GLYPH.check, tone: 'check' });
    expect(productMark('BELOW_MIN')).toMatchObject({ glyph: GLYPH.fail, tone: 'fail' });
    expect(productMark('CHECK')).toMatchObject({ glyph: GLYPH.unknown, tone: 'check', label: COPY.verdict.productCheck });
  });

  it('호환 단 매핑: NONE → null(단 생략), US-011 원문', () => {
    expect(compatMark('NONE')).toBeNull();
    expect(compatMark('OK')?.label).toBe(COPY.verdict.compatOk);
    expect(compatMark('CHECK')).toMatchObject({ glyph: GLYPH.check, label: COPY.verdict.compatCheck });
    expect(compatMark('BELOW_MIN')).toMatchObject({ glyph: GLYPH.fail, label: COPY.verdict.compatBelowMin });
  });

  it('종합 마크·호환 줄 가시성', () => {
    const mk = (verdict: string, product: string, compat: string) =>
      ({ verdict, product: { verdict: product, reasons: [] }, compat: { verdict: compat, reasons: [], checkedRuleIds: [] } }) as unknown as SpecCheckResult;
    // 제품 OK + 호환 CHECK → 종합 △ + 호환 확인 문구(? 아님)
    const a = mk('CHECK', 'OK', 'CHECK');
    expect(overallMark(a)).toMatchObject({ glyph: GLYPH.check, label: COPY.verdict.compatCheck });
    expect(visibleCompatMark(a)?.glyph).toBe(GLYPH.check);
    // 제품 OK + 호환 OK → ✓
    const b = mk('OK', 'OK', 'OK');
    expect(overallMark(b).glyph).toBe(GLYPH.ready);
    expect(visibleCompatMark(b)?.glyph).toBe(GLYPH.ready);
    // 제품 미달 + 호환 OK → 종합 ✕, 호환 줄 없음
    const c = mk('BELOW_MIN', 'BELOW_MIN', 'OK');
    expect(overallMark(c).glyph).toBe(GLYPH.fail);
    expect(visibleCompatMark(c)).toBeNull();
    // 값 누락(제품 CHECK) → ?
    const d = mk('CHECK', 'CHECK', 'NONE');
    expect(overallMark(d)).toMatchObject({ glyph: GLYPH.unknown, label: COPY.verdict.productCheck });
  });

  it('헤드라인: 숫자 Reason 만, 같은 등급 첫 번째', () => {
    const product: SpecCheckResult['product'] = {
      verdict: 'BELOW_MIN',
      reasons: [
        { stage: 'PRODUCT', kind: 'MIN', verdict: 'BELOW_MIN', key: 'surface', expected: 'SOLID', actual: 'MESH', message: 'm1' },
        { stage: 'PRODUCT', kind: 'MIN', verdict: 'BELOW_MIN', key: 'diameterCm', expected: 28, actual: 25, message: 'm2' },
      ],
    };
    expect(productHeadline(SCHEMA, product)).toBe('최소 28cm · 입력 25cm');
    expect(productHeadline(SCHEMA, { verdict: 'OK', reasons: [] })).toBeNull();
  });

  it('perRuleVerdicts: 규칙마다 그 규칙 이유의 최악, 이유 없으면 OK', () => {
    const compat: SpecCheckResult['compat'] = {
      verdict: 'BELOW_MIN',
      checkedRuleIds: ['r1', 'r2', 'r3'],
      reasons: [
        { stage: 'COMPAT', kind: 'RULE', verdict: 'CHECK', ruleId: 'r1#1', message: 'a' },
        { stage: 'COMPAT', kind: 'RULE', verdict: 'BELOW_MIN', ruleId: 'r1#0', message: 'b' },
        { stage: 'COMPAT', kind: 'RULE', verdict: 'CHECK', ruleId: 'r3#0', message: 'c' },
      ],
    };
    expect(perRuleVerdicts(compat)).toEqual([
      { ruleId: 'r1', verdict: 'BELOW_MIN' },
      { ruleId: 'r2', verdict: 'OK' },
      { ruleId: 'r3', verdict: 'CHECK' },
    ]);
  });

  it('toSpecInput: 빈 값 생략, 숫자·예/아니오·선택지 변환, 라벨 불완전 enum·선택지 밖 버림', () => {
    expect(toSpecInput(SCHEMA, { diameterCm: ' 28,5 ', surface: 'SOLID', raw: 'A', silent: 'false' })).toEqual({
      diameterCm: 28.5,
      surface: 'SOLID',
      silent: false,
    });
    expect(toSpecInput(SCHEMA, { diameterCm: '', surface: 'GLASS', silent: 'maybe' })).toEqual({});
  });

  // 기니피그 S5(계획 107) — 폼 필드 = 프리렌더 L5 와 같은 목록(visibleSpecFields → 라벨 완전성), '· 선택' = 엔진 isFieldOptionalForDisplay.
  describe('ruleScoped · 선택 표시(be-gp-schema 113 결정)', () => {
    const RS: SpecSchema = {
      fields: [
        { key: 'lengthCm', label: '길이(cm)', type: 'number', min: 1, max: 100 },
        { key: 'scoped', label: '종 전용', type: 'boolean', optional: true, ruleScoped: true },
        { key: 'scopedWhen', label: '조건 전용', type: 'enum', options: ['X', 'Y'], optionLabels: { X: '엑스', Y: '와이' }, optional: true, ruleScoped: true },
        { key: 'scopedRec', label: '권장 전용', type: 'number', min: 0, max: 10, optional: true, ruleScoped: true },
        { key: 'opt', label: '부가', type: 'number', min: 0, max: 10, optional: true },
      ],
    };
    const EMPTY: RuleSet = { rules: [] };
    const MIN: RuleSet = {
      rules: [
        { key: 'scoped', op: 'eq', value: true, reason: 'r' },
        { key: 'lengthCm', op: 'gte', value: 10, reason: 'r', when: [{ key: 'scopedWhen', op: 'eq', value: 'X' }] },
      ],
    } as RuleSet;
    const REC: RuleSet = { rules: [{ key: 'scopedRec', op: 'gte', value: 3, reason: 'r' }] } as RuleSet;
    const keys = (rules?: { minSpec?: RuleSet; recommendedSpec?: RuleSet }) => formFields(RS, rules).map((f) => f.key);

    it('규칙 없음(L6·기본) → ruleScoped 전부 숨김, 일반 필드는 스키마 순서 그대로', () => {
      expect(keys()).toEqual(['lengthCm', 'opt']);
      expect(keys({ minSpec: EMPTY, recommendedSpec: EMPTY })).toEqual(['lengthCm', 'opt']);
    });

    it('minSpec key·when key·recommendedSpec key 가 참조하면 표시(스키마 순서 유지)', () => {
      expect(keys({ minSpec: MIN, recommendedSpec: EMPTY })).toEqual(['lengthCm', 'scoped', 'scopedWhen', 'opt']);
      expect(keys({ minSpec: EMPTY, recommendedSpec: REC })).toEqual(['lengthCm', 'scopedRec', 'opt']);
      expect(keys({ minSpec: MIN, recommendedSpec: REC })).toEqual(['lengthCm', 'scoped', 'scopedWhen', 'scopedRec', 'opt']);
    });

    it('toSpecInput 은 숨긴 ruleScoped 필드 값을 엔진에 넘기지 않는다(폼과 같은 목록)', () => {
      const raw = { lengthCm: '12', scoped: 'true', scopedWhen: 'X', scopedRec: '4', opt: '1' };
      expect(toSpecInput(RS, raw)).toEqual({ lengthCm: 12, opt: 1 });
      expect(toSpecInput(RS, raw, { minSpec: MIN, recommendedSpec: EMPTY })).toEqual({ lengthCm: 12, scoped: true, scopedWhen: 'X', opt: 1 });
    });

    it("'· 선택': optional 이고 minSpec(key·when key)이 참조하지 않을 때만 — recommendedSpec 참조는 선택 유지", () => {
      const f = (k: string) => RS.fields.find((x) => x.key === k)!;
      const rules = { minSpec: MIN, recommendedSpec: REC };
      expect(showOptionalMark(f('lengthCm'), rules)).toBe(false); // optional 아님
      expect(showOptionalMark(f('scoped'), rules)).toBe(false); // minSpec key 참조
      expect(showOptionalMark(f('scopedWhen'), rules)).toBe(false); // minSpec when key 참조
      expect(showOptionalMark(f('scopedRec'), rules)).toBe(true); // 권장만 참조 — 판정 필수 아님
      expect(showOptionalMark(f('opt'), rules)).toBe(true);
      expect(showOptionalMark(f('scoped'))).toBe(true); // 규칙 없음 → optional 그대로
    });
  });

  it('cageSummary · yearMonth', () => {
    const cageSchema: SpecSchema = {
      fields: [
        { key: 'type', label: '형태', type: 'enum', options: ['LIVING_BOX'], optionLabels: { LIVING_BOX: '리빙박스' } },
        { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
      ],
    };
    const cage = { v: 1 as const, type: 'LIVING_BOX' as const, floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: 'x' };
    expect(cageSummary(cage, cageSchema)).toBe('60×40×35cm · 리빙박스');
    expect(cageSummary(cage, null)).toBe('60×40×35');
    expect(yearMonth('2026-09-30')).toBe('2026.09');
    expect(yearMonth('bad')).toBeNull();
  });
});
