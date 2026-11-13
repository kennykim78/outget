// verdictView — 순수 표시 함수(스펙33 §3 표 · 286 U5b). 판정 계산은 엔진, 여기는 매핑·표시용 뺄셈만.
import { COPY, VERDICT_GLYPH, formatCopy } from '@ws/copy';
import type { Reason, RuleSet, SpecCheckResult, SpecSchema } from '@ws/engine';
import { describe, expect, it } from 'vitest';
import {
  cageSummary,
  compatMark,
  formFields,
  isProductNoCriteria,
  isSmallOnly,
  mineValue,
  minFigure,
  perRuleVerdicts,
  productMark,
  shortfalls,
  showOptionalMark,
  toSpecInput,
  verdictTitle,
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
const MIN27: RuleSet = { rules: [{ key: 'diameterCm', op: 'gte', value: 27, reason: 'r' }] };
const NAMES = { item: '쳇바퀴', animal: '골든햄스터' };

describe('verdictView', () => {
  it('제품 단 매핑(R4 fix 4상태): OK ○ 기준 충족 · 권장 미만 △ 확인 필요 · 최소 미달 ✕ · 값 누락 ? 입력 필요', () => {
    expect(productMark('OK')).toEqual({ glyph: VERDICT_GLYPH.ok, tone: 'ready', label: COPY.verdict.markOk });
    expect(productMark('BELOW_RECOMMENDED')).toEqual({ glyph: VERDICT_GLYPH.check, tone: 'check', label: COPY.verdict.markCheck });
    expect(productMark('BELOW_MIN')).toEqual({ glyph: VERDICT_GLYPH.fail, tone: 'fail', label: COPY.verdict.productBelowMin });
    expect(productMark('BELOW_MIN', false, true)).toEqual({ glyph: VERDICT_GLYPH.fail, tone: 'fail', label: COPY.verdict.markSmall });
    expect(productMark('CHECK')).toEqual({ glyph: VERDICT_GLYPH.input, tone: 'check', label: COPY.verdict.markInput });
    expect([VERDICT_GLYPH.ok, VERDICT_GLYPH.check, VERDICT_GLYPH.fail, VERDICT_GLYPH.none]).toEqual(['○', '△', '✕', '—']);
  });

  it('호환 단 매핑: NONE → null(단 생략), US-011 원문 판정어, 글리프 ○ △ ✕', () => {
    expect(compatMark('NONE')).toBeNull();
    expect(compatMark('OK')).toMatchObject({ glyph: VERDICT_GLYPH.ok, label: COPY.verdict.compatOk });
    expect(compatMark('CHECK')).toMatchObject({ glyph: VERDICT_GLYPH.check, label: COPY.verdict.compatCheck });
    expect(compatMark('BELOW_MIN')).toMatchObject({ glyph: VERDICT_GLYPH.fail, label: COPY.verdict.compatBelowMin });
  });

  it('호환 줄 가시성: 제품 최소 미달이면 숨김', () => {
    const mk = (verdict: string, product: string, compat: string) =>
      ({ verdict, product: { verdict: product, reasons: [] }, compat: { verdict: compat, reasons: [], checkedRuleIds: [] } }) as unknown as SpecCheckResult;
    expect(visibleCompatMark(mk('CHECK', 'OK', 'CHECK'))?.glyph).toBe(VERDICT_GLYPH.check);
    expect(visibleCompatMark(mk('OK', 'OK', 'OK'))?.glyph).toBe(VERDICT_GLYPH.ok);
    expect(visibleCompatMark(mk('BELOW_MIN', 'BELOW_MIN', 'OK'))).toBeNull();
  });

  it('arch-23 기준 없음: CHECK+NO_CRITERIA → — 기준 없음(○ 아님, 「충족」 문구 없음) · 정보 부족 CHECK 는 ? 입력 필요', () => {
    const noCrit = {
      verdict: 'CHECK',
      reasons: [{ stage: 'PRODUCT', kind: 'NO_CRITERIA', verdict: 'CHECK', message: '등록된 규격 기준이 없는 용품이에요.' }],
    } as unknown as SpecCheckResult['product'];
    const missing = {
      verdict: 'CHECK',
      reasons: [{ stage: 'PRODUCT', kind: 'INPUT', verdict: 'CHECK', key: 'diameterCm', message: '값이 필요해요' }],
    } as unknown as SpecCheckResult['product'];
    expect(isProductNoCriteria(noCrit)).toBe(true);
    expect(isProductNoCriteria(missing)).toBe(false);
    const m = productMark('CHECK', true);
    expect(m).toEqual({ glyph: VERDICT_GLYPH.none, tone: 'none', label: COPY.verdict.markNone });
    expect(m.glyph).not.toBe(VERDICT_GLYPH.ok);
    expect(m.label).not.toMatch(/충족|문제 없음|사용 가능/);
    expect(productMark('CHECK', false)).toMatchObject({ glyph: VERDICT_GLYPH.input, label: COPY.verdict.markInput });
    expect(minFigure(SCHEMA, noCrit, { rules: [] })).toBeNull();
    expect(verdictTitle(SCHEMA, noCrit, { rules: [] }, NAMES)).toBe('골든햄스터 기준값이 없는 용품이에요');
    expect(verdictTitle(SCHEMA, missing, MIN27, NAMES)).toBe(COPY.verdict.productCheck);
  });

  it('CHECK 표시 분리: INPUT 사유가 있을 때만 「입력 필요」(?), 기준·규칙 사유뿐이면 「확인 필요」(△)', () => {
    const input = [{ stage: 'PRODUCT', kind: 'INPUT', verdict: 'CHECK', key: 'diameterCm', message: 'm' }] as unknown as Reason[];
    const rule = [{ stage: 'PRODUCT', kind: 'RULE', verdict: 'CHECK', message: 'm' }] as unknown as Reason[];
    expect(productMark('CHECK', false, false, input)).toMatchObject({ glyph: VERDICT_GLYPH.input, label: COPY.verdict.markInput });
    expect(productMark('CHECK', false, false, rule)).toEqual({ glyph: VERDICT_GLYPH.check, tone: 'check', label: COPY.verdict.markCheck });
    expect(productMark('CHECK', false, false, [...rule, ...input])).toMatchObject({ label: COPY.verdict.markInput });
  });

  it('제목: 제품 OK·권장 미만 + 호환 CHECK/BELOW_MIN 이면 성공 문장이 아니라 호환을 반영한 문장', () => {
    const ok: SpecCheckResult['product'] = { verdict: 'OK', reasons: [] };
    const rec: SpecCheckResult['product'] = { verdict: 'BELOW_RECOMMENDED', reasons: [] };
    expect(verdictTitle(SCHEMA, ok, MIN27, NAMES, 'OK')).toBe('쳇바퀴 기준을 충족해요');
    expect(verdictTitle(SCHEMA, ok, MIN27, NAMES, 'NONE')).toBe('쳇바퀴 기준을 충족해요');
    expect(verdictTitle(SCHEMA, ok, MIN27, NAMES, 'CHECK')).toBe('쳇바퀴 크기는 충족해요, 케이지와는 확인이 필요해요');
    expect(verdictTitle(SCHEMA, ok, MIN27, NAMES, 'BELOW_MIN')).toBe('쳇바퀴 크기는 충족해요, 케이지와는 맞지 않는 조건이 있어요');
    expect(verdictTitle(SCHEMA, rec, MIN27, NAMES, 'CHECK')).toBe('최소 기준은 충족해요, 케이지와는 확인이 필요해요');
    expect(verdictTitle(SCHEMA, rec, MIN27, NAMES, 'BELOW_MIN')).toBe('최소 기준은 충족해요, 케이지와는 맞지 않는 조건이 있어요');
    expect(verdictTitle(SCHEMA, rec, MIN27, NAMES, 'OK')).toBe(COPY.verdict.titleBelowRecommended);
  });

  describe('결과 숫자(U5b) — 값은 minSpec·Reason.expected/actual 에서만, 차이 = 뺄셈 표시', () => {
    const below = (actual: number): SpecCheckResult['product'] => ({
      verdict: 'BELOW_MIN',
      reasons: [{ stage: 'PRODUCT', kind: 'MIN', verdict: 'BELOW_MIN', key: 'diameterCm', expected: 27, actual, message: 'm' }],
    });

    it('min 27 · 입력 26 → 「최소 지름 27 cm 이상」, 내 값 26, 차이 1cm, ✕ 「조금 작아요」, 제목 「쳇바퀴 크기가 최소 기준보다 작아요」', () => {
      const p = below(26);
      expect(minFigure(SCHEMA, p, MIN27)).toEqual({ label: '최소 지름', value: '27', unit: 'cm', suffix: '이상', keys: ['diameterCm'] });
      expect(mineValue(minFigure(SCHEMA, p, MIN27), { diameterCm: 26 })).toBe('26');
      expect(shortfalls(SCHEMA, p, MIN27)).toEqual([{ name: '지름', n: 1, unit: 'cm' }]);
      expect(formatCopy(COPY.verdict.shortBy, { name: '지름', n: 1, unit: 'cm' })).toBe('최소 지름보다 1cm 작아요');
      expect(isSmallOnly(SCHEMA, p, MIN27)).toBe(true);
      expect(verdictTitle(SCHEMA, p, MIN27, NAMES)).toBe('쳇바퀴 크기가 최소 기준보다 작아요');
    });

    it('BELOW_MIN 인데 gte 미달이 없으면(lte 미달 + 충족한 gte 규칙) 큰 숫자 영역 생략', () => {
      const p: SpecCheckResult['product'] = {
        verdict: 'BELOW_MIN',
        reasons: [{ stage: 'PRODUCT', kind: 'MIN', verdict: 'BELOW_MIN', key: 'diameterCm', expected: 40, actual: 45, message: 'm' }],
      };
      const min: RuleSet = {
        rules: [
          { key: 'diameterCm', op: 'gte', value: 27, reason: 'r' },
          { key: 'diameterCm', op: 'lte', value: 40, reason: 'r' },
        ],
      };
      expect(minFigure(SCHEMA, p, min)).toBeNull();
    });

    it('소수 차이는 부동소수 잔차 없이(26.7 → 0.3)', () => {
      expect(shortfalls(SCHEMA, below(26.7), MIN27)).toEqual([{ name: '지름', n: 0.3, unit: 'cm' }]);
    });

    it('숫자 아닌 미달(enum)이 섞이면 단어 「최소 규격 미달」, 차이 줄은 숫자 항목만', () => {
      const p: SpecCheckResult['product'] = {
        verdict: 'BELOW_MIN',
        reasons: [
          { stage: 'PRODUCT', kind: 'MIN', verdict: 'BELOW_MIN', key: 'surface', expected: 'SOLID', actual: 'MESH', message: 'm1' },
          { stage: 'PRODUCT', kind: 'MIN', verdict: 'BELOW_MIN', key: 'diameterCm', expected: 27, actual: 25, message: 'm2' },
        ],
      };
      const min: RuleSet = { rules: [...MIN27.rules, { key: 'surface', op: 'eq', value: 'SOLID', reason: 'r' }] };
      expect(isSmallOnly(SCHEMA, p, min)).toBe(false);
      expect(shortfalls(SCHEMA, p, min)).toEqual([{ name: '지름', n: 2, unit: 'cm' }]);
      expect(verdictTitle(SCHEMA, p, min, NAMES)).toBe('쳇바퀴 최소 기준에 맞지 않는 항목이 있어요');
    });

    it('lte 규칙 미달은 차이 줄 없음(「작아요」 아님), 큰 숫자는 gte 규칙에서만', () => {
      const p: SpecCheckResult['product'] = {
        verdict: 'BELOW_MIN',
        reasons: [{ stage: 'PRODUCT', kind: 'MIN', verdict: 'BELOW_MIN', key: 'diameterCm', expected: 40, actual: 45, message: 'm' }],
      };
      const min: RuleSet = { rules: [{ key: 'diameterCm', op: 'lte', value: 40, reason: 'r' }] };
      expect(shortfalls(SCHEMA, p, min)).toEqual([]);
      expect(isSmallOnly(SCHEMA, p, min)).toBe(false);
      expect(minFigure(SCHEMA, p, min)).toBeNull();
    });

    it('OK·권장 미만: 큰 숫자 = 해석된 minSpec gte 값(같은 단위 여러 값은 × · 「최소 규격」), 숫자 규칙 없으면 null', () => {
      const ok: SpecCheckResult['product'] = { verdict: 'OK', reasons: [] };
      expect(minFigure(SCHEMA, ok, MIN27)?.value).toBe('27');
      expect(verdictTitle(SCHEMA, ok, MIN27, NAMES)).toBe('쳇바퀴 기준을 충족해요');
      expect(verdictTitle(SCHEMA, { verdict: 'BELOW_RECOMMENDED', reasons: [] }, MIN27, NAMES)).toBe(COPY.verdict.titleBelowRecommended);
      const CAGE: SpecSchema = {
        fields: [
          { key: 'w', label: '바닥 가로(cm)', type: 'number', min: 1, max: 300 },
          { key: 'd', label: '바닥 세로(cm)', type: 'number', min: 1, max: 300 },
        ],
      };
      const cageMin: RuleSet = {
        rules: [
          { key: 'w', op: 'gte', value: 100, reason: 'r' },
          { key: 'd', op: 'gte', value: 50, reason: 'r' },
        ],
      };
      const f = minFigure(CAGE, ok, cageMin);
      expect(f).toEqual({ label: COPY.verdict.minSpecLabel, value: '100×50', unit: 'cm', suffix: '이상', keys: ['w', 'd'] });
      expect(mineValue(f, { w: 100, d: 60 })).toBe('100×60');
      expect(mineValue(f, { w: 100 })).toBeNull();
      expect(minFigure(SCHEMA, ok, { rules: [] })).toBeNull();
    });
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
