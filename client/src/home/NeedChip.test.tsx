// F2-3 칩·행 규격 "{값}{단위} 이상"(스펙33 §0 F3 · DR #38): 엔진 chipSpecText 단일 소스, "↑" 0, neutral(L3 전) 규격 0(D-4).
import { render, screen } from '@testing-library/react';
import type { PublicRequirement, SpecSchema } from '@ws/engine';
import { describe, expect, it } from 'vitest';
import ChecklistRow, { rowSpecText } from '../checklist/ChecklistRow';
import { req } from '../test/fixtures';
import NeedChip, { needChipSpec } from './NeedChip';

const WHEEL: SpecSchema = { fields: [{ key: 'diameterCm', label: '지름(cm)', type: 'number', min: 5, max: 60 }] };
const CAGE: SpecSchema = {
  fields: [
    { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
    { key: 'floorDcm', label: '바닥 세로(cm)', type: 'number', min: 20, max: 120 },
    { key: 'barGapMm', label: '철망 간격(mm)', type: 'number', min: 3, max: 30, optional: true },
  ],
};
const MIXED: SpecSchema = {
  fields: [
    { key: 'volumeMl', label: '용량(ml)', type: 'number', min: 10, max: 1000 },
    { key: 'heightCm', label: '높이(cm)', type: 'number', min: 1, max: 50 },
  ],
};
const ENUM_ONLY: SpecSchema = {
  fields: [{ key: 'surface', label: '바닥면', type: 'enum', options: ['SOLID'], optionLabels: { SOLID: '막힌 판' } }],
};

function withSpec(id: string, specSchema: SpecSchema, rules: PublicRequirement['minSpec']['rules'], priority: PublicRequirement['priority'] = 'REQUIRED'): PublicRequirement {
  const base = req(id, priority, `합성 ${id}`);
  return { ...base, minSpec: { rules }, item: { ...base.item, specSchema } };
}

const wheel = withSpec('wheel', WHEEL, [{ key: 'diameterCm', op: 'gte', value: 28, reason: 'r' }]);
const cage = withSpec('cage', CAGE, [
  { key: 'floorWcm', op: 'gte', value: 60, reason: 'r' },
  { key: 'floorDcm', op: 'gte', value: 40, reason: 'r' },
  { key: 'barGapMm', op: 'lte', value: 10, reason: 'r' },
]);
const water = withSpec('water', MIXED, [
  { key: 'volumeMl', op: 'gte', value: 100, reason: 'r' },
  { key: 'heightCm', op: 'gte', value: 10, reason: 'r' },
]);
const bedding = withSpec('bed', ENUM_ONLY, [{ key: 'surface', op: 'eq', value: 'SOLID', reason: 'r' }]);

describe('규격 요약 텍스트(chipSpecText)', () => {
  it.each([
    ['단일 숫자', wheel, '28cm 이상'],
    ['같은 단위 × 연결(lte 제외)', cage, '60×40cm 이상'],
    ['단위 섞이면 첫 규칙 하나', water, '100ml 이상'],
    ['숫자 gte 없음 → null', bedding, null],
  ])('%s', (_l, r, want) => {
    expect(needChipSpec(r)).toBe(want);
    expect(rowSpecText(r)).toBe(want);
  });
});

describe('NeedChip', () => {
  it('상태 칩은 이름 + 규격("↑" 0)', () => {
    render(
      <ul>
        <NeedChip itemId="cage" name="케이지" state="first" href="/x" spec={needChipSpec(cage)} />
      </ul>,
    );
    const a = screen.getByRole('link');
    expect(a).toHaveTextContent('케이지');
    expect(a).toHaveTextContent('60×40cm 이상');
    expect(a.textContent).not.toContain('↑');
  });

  it('neutral(L3 전)은 글리프 없음 + 규격은 표시(DR M-1 — 프리렌더 "60×40cm 이상" 이 하이드레이션 후에도 유지)', () => {
    render(
      <ul>
        <NeedChip itemId="cage" name="케이지" state="neutral" href="/x" spec="60×40cm 이상" />
      </ul>,
    );
    const a = screen.getByRole('link');
    expect(a).toHaveTextContent('60×40cm 이상');
    expect(a).toHaveAttribute('data-ws-state', 'neutral');
    expect(a.querySelector('.ws-glyph, [data-ws-glyph]')).toBeNull();
    expect(a.childElementCount).toBe(2); // 이름 + 규격(글리프 0)
  });

  it('spec 없으면 이름만', () => {
    render(
      <ul>
        <NeedChip itemId="bed" name="베딩" state="check" href="/x" spec={needChipSpec(bedding)} />
      </ul>,
    );
    expect(screen.getByRole('link').querySelector('.ws-need-spec')).toBeNull();
  });
});

describe('ChecklistRow 규격 줄', () => {
  const row = (r: PublicRequirement) => ({ requirement: r, state: 'FIRST' as const, source: null, compat: null });
  it('행 이름 아래 "{값}{단위} 이상", NOT_NOW 행은 이유만', () => {
    const notNow = { ...withSpec('ball', WHEEL, [{ key: 'diameterCm', op: 'gte', value: 20, reason: 'r' }], 'NOT_NOW'), notNowReason: '합성 이유' };
    render(
      <ul>
        <ChecklistRow row={row(wheel)} href="/a" onToggle={() => undefined} />
        <ChecklistRow row={row(notNow)} href="/b" onToggle={() => undefined} />
      </ul>,
    );
    const [w, b] = screen.getAllByRole('checkbox');
    expect(w).toHaveTextContent('28cm 이상');
    expect(b).not.toHaveTextContent('20cm 이상');
    expect(b).toHaveTextContent('합성 이유');
  });
});
