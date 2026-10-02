// animal/selection — 계약 C-1 ws.animalType(원시 typeId, data.types 에 없으면 무시) + species_selected 이벤트.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage, type WsStorage } from '../lib/storage';
import { setTrackerForTest, type Tracker } from '../events/track';
import { ANIMAL_TYPE_KEY, useAnimalSelection } from './selection';

const TYPES = [
  { id: 'hamster-golden', group: 'SMALL_MAMMAL' as const },
  { id: 'budgie', group: 'PARROT' as const },
];

function memBackend(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  } as Storage;
}

let backend: Storage;
let storage: WsStorage;
let calls: Array<[string, Record<string, unknown>]>;

beforeEach(() => {
  backend = memBackend();
  storage = createStorage(() => backend);
  calls = [];
  const fake: Tracker = {
    track: (n, p) => void calls.push([n, p]),
    flush: () => undefined,
    dispose: () => undefined,
  };
  setTrackerForTest(fake);
});
afterEach(() => setTrackerForTest(null));

describe('useAnimalSelection', () => {
  it('저장 없음 → null', () => {
    const h = renderHook(() => useAnimalSelection(TYPES, { storage }));
    expect(h.result.current.typeId).toBeNull();
  });

  it('저장된 값이 data.types 에 없으면 무시(null), 지우지는 않는다', () => {
    backend.setItem(ANIMAL_TYPE_KEY, 'gerbil');
    const h = renderHook(() => useAnimalSelection(TYPES, { storage }));
    expect(h.result.current.typeId).toBeNull();
    expect(backend.getItem(ANIMAL_TYPE_KEY)).toBe('gerbil');
  });

  it('select → 원시 typeId 저장 + species_selected{animalTypeId, group, via} 1회, 다른 훅도 갱신', () => {
    const a = renderHook(() => useAnimalSelection(TYPES, { storage }));
    const b = renderHook(() => useAnimalSelection(TYPES, { storage }));
    act(() => a.result.current.select('budgie', 'alias'));
    expect(backend.getItem(ANIMAL_TYPE_KEY)).toBe('budgie');
    expect(b.result.current.typeId).toBe('budgie');
    expect(calls).toEqual([['species_selected', { animalTypeId: 'budgie', group: 'PARROT', via: 'alias' }]]);
  });

  it('types 에 없는 id 선택은 저장·이벤트 0', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = renderHook(() => useAnimalSelection(TYPES, { storage }));
    act(() => h.result.current.select('gerbil', 'picker'));
    expect(backend.getItem(ANIMAL_TYPE_KEY)).toBeNull();
    expect(calls).toEqual([]);
    warn.mockRestore();
  });

  it('types 생략 시: 읽기는 형식만 검증, select 는 저장·이벤트 0(그룹을 모름)', () => {
    backend.setItem(ANIMAL_TYPE_KEY, 'gerbil');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = renderHook(() => useAnimalSelection(undefined, { storage }));
    expect(h.result.current.typeId).toBe('gerbil');
    act(() => h.result.current.select('budgie', 'picker'));
    expect(backend.getItem(ANIMAL_TYPE_KEY)).toBe('gerbil');
    expect(calls).toEqual([]);
    warn.mockRestore();
  });

  it('형식이 깨진 저장값(JSON·경로)은 무시', () => {
    backend.setItem(ANIMAL_TYPE_KEY, '{"id":"x"}');
    const h = renderHook(() => useAnimalSelection(undefined, { storage }));
    expect(h.result.current.typeId).toBeNull();
  });

  it('via=url 은 같은 값이면 저장·이벤트 생략(재방문마다 발화하지 않음)', () => {
    const h = renderHook(() => useAnimalSelection(TYPES, { storage }));
    act(() => h.result.current.select('hamster-golden', 'url'));
    act(() => h.result.current.select('hamster-golden', 'url'));
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ via: 'url' });
  });
});
