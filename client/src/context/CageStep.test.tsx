// context/CageStep — 형태 옵션 = schema.options ∩ CAGE_TYPES (L6 저장 계약 밖 값은 노출·저장 시도 안 함).
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { SpecSchema } from '@ws/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wsStorage } from '../lib/storage';

vi.mock('../ui/layer/Layer', () => ({
  useLayerChrome: () => ({ setTitle: () => {}, setBack: () => {} }),
  LayerBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LayerFoot: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import CageStep from './CageStep';
import { cageKey, CAGE_TYPES } from './cageStore';

const TYPE_ID = 'hamster-golden';
const LABELS = {
  LIVING_BOX: '리빙박스',
  WIRE: '철망',
  ACRYLIC: '아크릴 케이지',
  GLASS_TANK: '유리 수조',
  GRID_PANEL: '그리드 패널',
  OTHER: '기타',
};
const SCHEMA: SpecSchema = {
  fields: [
    {
      key: 'type',
      label: '형태',
      type: 'enum',
      options: ['LIVING_BOX', 'WIRE', 'ACRYLIC', 'GLASS_TANK', 'GRID_PANEL', 'OTHER'],
      optionLabels: LABELS,
    },
    { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
    { key: 'floorDcm', label: '바닥 세로(cm)', type: 'number', min: 20, max: 120 },
    { key: 'heightCm', label: '높이(cm)', type: 'number', min: 15, max: 100 },
    { key: 'barGapMm', label: '철망 간격(mm)', type: 'number', min: 3, max: 30, optional: true },
  ],
};

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

function setup() {
  const onBack = vi.fn();
  const utils = render(<CageStep typeId={TYPE_ID} schema={SCHEMA} backLabel="뒤로" onBack={onBack} />);
  return { onBack, ...utils };
}

describe('CageStep type 옵션', () => {
  it('schema 에 GLASS_TANK·GRID_PANEL 이 있어도 L6 에는 노출하지 않는다', () => {
    setup();
    const values = screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value);
    expect(values).toEqual([...CAGE_TYPES]);
    expect(values).not.toContain('GLASS_TANK');
    expect(values).not.toContain('GRID_PANEL');
    expect(screen.queryByText(LABELS.GLASS_TANK)).toBeNull();
    expect(screen.queryByText(LABELS.GRID_PANEL)).toBeNull();
  });

  it.each([...CAGE_TYPES])('기존 옵션 %s 는 저장에 성공한다', (type) => {
    const { onBack } = setup();
    fireEvent.click(screen.getByDisplayValue(type));
    const fill = (name: RegExp, v: string) => fireEvent.change(screen.getByLabelText(name), { target: { value: v } });
    fill(/바닥 가로/, '80');
    fill(/바닥 세로/, '50');
    fill(/높이/, '40');
    if (type === 'WIRE') fill(/철망 간격/, '9');
    const save = screen.getAllByRole('button').find((b) => !(b as HTMLButtonElement).disabled && /저장/.test(b.textContent ?? ''));
    expect(save).toBeDefined();
    fireEvent.click(save as HTMLElement);
    expect(onBack).toHaveBeenCalled();
    const stored = JSON.parse(wsStorage.get(cageKey(TYPE_ID)) ?? 'null') as { type: string } | null;
    expect(stored?.type).toBe(type);
  });

  it('계약 밖 값은 저장 시도되지 않는다', () => {
    setup();
    expect(screen.queryByDisplayValue('GLASS_TANK')).toBeNull();
    expect(screen.queryByDisplayValue('GRID_PANEL')).toBeNull();
    expect(wsStorage.get(cageKey(TYPE_ID))).toBeNull();
  });
});
