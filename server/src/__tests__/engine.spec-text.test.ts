// R5 B2-1·G-1(C-R5-8, D17): ruleText·specLine·chipSpecText 엔진 단일 소스.
import { describe, expect, it } from 'vitest';
import { SPEC_WORDS, chipSpecText, ruleText, specLine, type RuleSet, type SpecSchema } from '../engine/index.js';
import * as common from '../prerender/pages/common.js';
import { COPY } from '../prerender/copy.js';

const cage: SpecSchema = {
  fields: [
    { key: 'type', label: '형태', type: 'enum', options: ['LIVING_BOX', 'WIRE'], optionLabels: { LIVING_BOX: '리빙박스', WIRE: '철망' } },
    { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
    { key: 'floorDcm', label: '바닥 세로(cm)', type: 'number', min: 20, max: 120 },
    { key: 'heightCm', label: '높이(cm)', type: 'number', min: 15, max: 100 },
    { key: 'barGapMm', label: '철망 간격(mm)', type: 'number', min: 3, max: 30, optional: true },
  ],
};
const wheel: SpecSchema = {
  fields: [
    { key: 'diameterCm', label: '지름(cm)', type: 'number', min: 5, max: 60 },
    { key: 'surface', label: '바닥면', type: 'enum', options: ['SOLID', 'MESH'], optionLabels: { SOLID: '막힌 판' } },
    { key: 'silent', label: '무소음(베어링)', type: 'boolean', optional: true },
  ],
};
const rs = (rules: RuleSet['rules']): RuleSet => ({ rules });

describe('ruleText', () => {
  it('"{이름} {값}{단위} 이상" / 이하', () => {
    expect(ruleText(cage, { key: 'floorWcm', op: 'gte', value: 60, reason: 'r' })).toBe('바닥 가로 60cm 이상');
    expect(ruleText(cage, { key: 'barGapMm', op: 'lte', value: 10, reason: 'r' })).toBe('철망 간격 10mm 이하');
  });
  it('enum 라벨 · 라벨 없는 값이면 null(원시 코드 0)', () => {
    expect(ruleText(wheel, { key: 'surface', op: 'eq', value: 'SOLID', reason: 'r' })).toBe('바닥면 막힌 판');
    expect(ruleText(wheel, { key: 'surface', op: 'eq', value: 'MESH', reason: 'r' })).toBeNull();
    expect(ruleText(wheel, { key: 'surface', op: 'not_in', value: ['SOLID'], reason: 'r' })).toBe('바닥면 막힌 판 제외');
  });
  it('when 조건부 · when 의 라벨 없는 값이면 null', () => {
    const r = { key: 'barGapMm', op: 'lte' as const, value: 10, reason: 'r', when: [{ key: 'type', op: 'eq' as const, value: 'WIRE' }] };
    expect(ruleText(cage, r)).toBe('형태 철망일 때 — 철망 간격 10mm 이하');
    expect(ruleText(cage, { ...r, when: [{ key: 'type', op: 'eq', value: 'ACRYLIC' }] })).toBeNull();
  });
  it('boolean eq', () => {
    expect(ruleText(wheel, { key: 'silent', op: 'eq', value: true, reason: 'r' })).toBe('무소음');
    expect(ruleText(wheel, { key: 'silent', op: 'eq', value: false, reason: 'r' })).toBe('무소음 없음');
  });
});

describe('specLine', () => {
  it('스키마 순서, boolean true 만, 라벨 없는 enum 생략', () => {
    expect(specLine(wheel, { diameterCm: 30, surface: 'SOLID', silent: true })).toBe('지름 30cm · 바닥면 막힌 판 · 무소음');
    expect(specLine(wheel, { surface: 'MESH', silent: false, diameterCm: 25 })).toBe('지름 25cm');
    expect(specLine({ fields: [] }, { x: 1 })).toBe('');
  });
});

describe('chipSpecText(G-1)', () => {
  it('단일 → "28cm 이상"', () => {
    expect(chipSpecText(wheel, rs([{ key: 'diameterCm', op: 'gte', value: 28, reason: 'r' }, { key: 'surface', op: 'eq', value: 'SOLID', reason: 'r' }]))).toBe('28cm 이상');
  });
  it('같은 단위 → 스키마 필드 순서로 "×" 연결(규칙 순서 무관), "↑" 0', () => {
    const t = chipSpecText(cage, rs([
      { key: 'floorDcm', op: 'gte', value: 40, reason: 'r' },
      { key: 'floorWcm', op: 'gte', value: 60, reason: 'r' },
    ]));
    expect(t).toBe('60×40cm 이상');
    expect(t).not.toContain('↑');
  });
  it('최대 3값', () => {
    expect(chipSpecText({ fields: [...cage.fields, { key: 'extraCm', label: '여분(cm)', type: 'number', min: 1, max: 9 }] }, rs([
      { key: 'floorWcm', op: 'gte', value: 60, reason: 'r' },
      { key: 'floorDcm', op: 'gte', value: 40, reason: 'r' },
      { key: 'heightCm', op: 'gte', value: 30, reason: 'r' },
      { key: 'extraCm', op: 'gte', value: 5, reason: 'r' },
    ]))).toBe('60×40×30cm 이상');
  });
  it('단위가 섞이면 첫 규칙 하나', () => {
    expect(chipSpecText(cage, rs([
      { key: 'barGapMm', op: 'gte', value: 4, reason: 'r' },
      { key: 'heightCm', op: 'gte', value: 30, reason: 'r' },
    ]))).toBe('30cm 이상');
  });
  it('when 있는 규칙·lte·비숫자·스키마 밖 키 제외 → 없으면 null', () => {
    expect(chipSpecText(cage, rs([
      { key: 'floorWcm', op: 'gte', value: 60, reason: 'r', when: [{ key: 'type', op: 'eq', value: 'WIRE' }] },
      { key: 'barGapMm', op: 'lte', value: 10, reason: 'r' },
      { key: 'nope', op: 'gte', value: 3, reason: 'r' },
      { key: 'type', op: 'eq', value: 'WIRE', reason: 'r' },
    ]))).toBeNull();
    expect(chipSpecText(cage, rs([]))).toBeNull();
    expect(chipSpecText(cage, null)).toBeNull();
  });
});

describe('단일 소스', () => {
  it('prerender common 의 ruleText·specLine 은 엔진 함수 그 자체(re-export)', () => {
    expect(common.ruleText).toBe(ruleText);
    expect(common.specLine).toBe(specLine);
  });
  it('엔진 SPEC_WORDS = COPY.spec(어휘 표류 방지)', () => {
    expect({ ...SPEC_WORDS }).toEqual({ ...COPY.spec });
  });
});
