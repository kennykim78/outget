// context/cageStore — 계약 C-R5-1 ws.context.{typeId}.cage v1: 값 범위 = cage specSchema(@ws/engine sanitizeSpecValues),
//   barGapMm 은 WIRE 만(D7), 삭제 = 키 삭제, 엔진 UserContext 변환, useCage, Saveable(C-R5-9).
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpecSchema } from '@ws/engine';
import { createStorage, type WsStorage } from '../lib/storage';
import type { CageV1 } from '../save/contract';
import {
  cageKey,
  createCageSaveable,
  readCage,
  removeCage,
  toUserContext,
  useCage,
  validateCage,
  writeCage,
} from './cageStore';

// server/seed/supply-items.json cage.specSchema 와 같은 모양(범위는 시드 값).
const SCHEMA: SpecSchema = {
  fields: [
    {
      key: 'type',
      label: '형태',
      type: 'enum',
      options: ['LIVING_BOX', 'WIRE', 'ACRYLIC', 'OTHER'],
      optionLabels: { LIVING_BOX: '리빙박스', WIRE: '철망', ACRYLIC: '아크릴 케이지', OTHER: '기타' },
    },
    { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
    { key: 'floorDcm', label: '바닥 세로(cm)', type: 'number', min: 20, max: 120 },
    { key: 'heightCm', label: '높이(cm)', type: 'number', min: 15, max: 100 },
    { key: 'barGapMm', label: '철망 간격(mm)', type: 'number', min: 3, max: 30, optional: true },
  ],
};

const T0 = '2026-10-02T00:00:00.000Z';
const T1 = '2026-10-02T00:05:00.000Z';
const HG = 'hamster-golden';

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

const BOX = { type: 'LIVING_BOX', floorWcm: 80, floorDcm: 50, heightCm: 40 } as const;
const WIRE = { type: 'WIRE', floorWcm: 60, floorDcm: 40, heightCm: 35, barGapMm: 9 } as const;

let backend: Storage;
let store: WsStorage;
beforeEach(() => {
  backend = memBackend();
  store = createStorage(() => backend);
});

describe('validateCage', () => {
  it('정상 값 통과(알려진 필드만)', () => {
    expect(validateCage({ ...BOX, extra: 1 }, SCHEMA)).toEqual(BOX);
    expect(validateCage(WIRE, SCHEMA)).toEqual(WIRE);
  });

  it('경계값(min·max) 통과', () => {
    expect(validateCage({ type: 'OTHER', floorWcm: 20, floorDcm: 120, heightCm: 15 }, SCHEMA)).not.toBeNull();
    expect(validateCage({ ...WIRE, barGapMm: 3 }, SCHEMA)).not.toBeNull();
    expect(validateCage({ ...WIRE, floorWcm: 200, barGapMm: 30 }, SCHEMA)).not.toBeNull();
  });

  it.each([
    ['floorWcm 최소 미만', { ...BOX, floorWcm: 19.9 }],
    ['floorWcm 최대 초과', { ...BOX, floorWcm: 201 }],
    ['floorDcm 최대 초과', { ...BOX, floorDcm: 121 }],
    ['heightCm 최소 미만', { ...BOX, heightCm: 14 }],
    ['음수', { ...BOX, heightCm: -40 }],
    ['NaN', { ...BOX, floorWcm: Number.NaN }],
    ['Infinity', { ...BOX, floorWcm: Number.POSITIVE_INFINITY }],
    ['문자열 숫자', { ...BOX, floorWcm: '80' }],
    ['필수 누락', { type: 'LIVING_BOX', floorWcm: 80, floorDcm: 50 }],
    ['형태 밖', { ...BOX, type: 'GLASS' }],
    ['WIRE barGapMm 범위 밖', { ...WIRE, barGapMm: 31 }],
    ['WIRE barGapMm 최소 미만', { ...WIRE, barGapMm: 2 }],
  ])('%s → null(범위 밖 거부)', (_l, input) => {
    expect(validateCage(input, SCHEMA)).toBeNull();
  });

  it('WIRE 가 아니면 barGapMm 은 버린다(D7)', () => {
    expect(validateCage({ ...BOX, barGapMm: 9 }, SCHEMA)).toEqual(BOX);
    expect(validateCage({ ...BOX, barGapMm: 999 }, SCHEMA)).toEqual(BOX);
  });

  it('WIRE barGapMm 생략 허용', () => {
    const { barGapMm: _b, ...noGap } = WIRE;
    void _b;
    expect(validateCage(noGap, SCHEMA)).toEqual(noGap);
  });

  it('스키마에 없는 필드는 통과 못 한다(범위는 스키마가 결정)', () => {
    const narrow: SpecSchema = { fields: SCHEMA.fields.filter((f) => f.key !== 'heightCm') };
    expect(validateCage(BOX, narrow)).toBeNull();
    const tighter: SpecSchema = {
      fields: SCHEMA.fields.map((f) => (f.key === 'floorWcm' && f.type === 'number' ? { ...f, max: 70 } : f)),
    };
    expect(validateCage(BOX, tighter)).toBeNull();
  });

  it('비객체 → null', () => {
    expect(validateCage(null, SCHEMA)).toBeNull();
    expect(validateCage([], SCHEMA)).toBeNull();
    expect(validateCage('x', SCHEMA)).toBeNull();
  });
});

describe('writeCage / readCage / removeCage', () => {
  it('키 = ws.context.{typeId}.cage, 잘못된 typeId throw', () => {
    expect(cageKey(HG)).toBe('ws.context.hamster-golden.cage');
    expect(() => cageKey('../x')).toThrow();
  });

  it('쓰기 → v1 + updatedAt, 왕복', () => {
    const c = writeCage(store, HG, WIRE, SCHEMA, T0);
    expect(c).toEqual({ v: 1, ...WIRE, updatedAt: T0 });
    expect(JSON.parse(backend.getItem(cageKey(HG)) as string)).toEqual(c);
    expect(readCage(store, HG, SCHEMA)).toEqual(c);
    expect(readCage(store, HG)).toEqual(c);
  });

  it('범위 밖 → null, 저장 0(기존 값 유지)', () => {
    writeCage(store, HG, BOX, SCHEMA, T0);
    expect(writeCage(store, HG, { ...BOX, floorWcm: 500 }, SCHEMA, T1)).toBeNull();
    expect(readCage(store, HG, SCHEMA)?.floorWcm).toBe(80);
    expect(writeCage(store, 'gerbil-mongolian', { ...BOX, heightCm: 1 }, SCHEMA, T1)).toBeNull();
    expect(backend.getItem(cageKey('gerbil-mongolian'))).toBeNull();
  });

  it('삭제 = 키 삭제', () => {
    writeCage(store, HG, BOX, SCHEMA, T0);
    removeCage(store, HG);
    expect(backend.getItem(cageKey(HG))).toBeNull();
    expect(readCage(store, HG, SCHEMA)).toBeNull();
  });

  it.each([
    ['깨진 JSON', '{"v":1,'],
    ['v=99', JSON.stringify({ v: 99, ...BOX, updatedAt: T0 })],
    ['v 없음', JSON.stringify({ ...BOX, updatedAt: T0 })],
    ['updatedAt 없음', JSON.stringify({ v: 1, ...BOX })],
    ['숫자 아님', JSON.stringify({ v: 1, ...BOX, floorWcm: 'x', updatedAt: T0 })],
  ])('%s → null + .bak 보존(본 키 제거)', (_l, raw) => {
    backend.setItem(cageKey(HG), raw);
    expect(readCage(store, HG)).toBeNull();
    expect(backend.getItem(`${cageKey(HG)}.bak`)).toBe(raw);
    expect(backend.getItem(cageKey(HG))).toBeNull();
  });

  it('스키마를 주면 저장된 값도 범위 검사(밖이면 null + .bak)', () => {
    const raw = JSON.stringify({ v: 1, ...BOX, floorWcm: 999, updatedAt: T0 });
    backend.setItem(cageKey(HG), raw);
    expect(readCage(store, HG, SCHEMA)).toBeNull();
    expect(backend.getItem(`${cageKey(HG)}.bak`)).toBe(raw);
  });

  it('저장된 비-WIRE 값의 barGapMm 은 읽을 때 버린다', () => {
    backend.setItem(cageKey(HG), JSON.stringify({ v: 1, ...BOX, barGapMm: 9, updatedAt: T0 }));
    expect(readCage(store, HG, SCHEMA)).toEqual({ v: 1, ...BOX, updatedAt: T0 });
  });
});

describe('toUserContext', () => {
  it('엔진 UserContext{ownedItems:{cage}} — v·updatedAt 제외, barGapMm 은 있을 때만', () => {
    const w: CageV1 = { v: 1, ...WIRE, updatedAt: T0 };
    expect(toUserContext(w)).toEqual({ ownedItems: { cage: { ...WIRE } } });
    const b: CageV1 = { v: 1, ...BOX, updatedAt: T0 };
    const ctx = toUserContext(b);
    expect(ctx).toEqual({ ownedItems: { cage: { ...BOX } } });
    expect(Object.keys(ctx?.ownedItems.cage ?? {})).not.toContain('barGapMm');
    expect(toUserContext(null)).toBeUndefined();
  });
});

describe('useCage', () => {
  afterEach(() => vi.useRealTimers());

  it('save → 즉시 반영·저장(updatedAt = 지금), 범위 밖 false, remove → null', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(T1));
    const a = renderHook(() => useCage(HG, { schema: SCHEMA, storage: store }));
    const b = renderHook(() => useCage(HG, { schema: SCHEMA, storage: store }));
    expect(a.result.current.cage).toBeNull();
    let ok = false;
    act(() => {
      ok = a.result.current.save(WIRE);
    });
    expect(ok).toBe(true);
    expect(b.result.current.cage).toEqual({ v: 1, ...WIRE, updatedAt: T1 });
    act(() => {
      ok = a.result.current.save({ ...WIRE, heightCm: 0 });
    });
    expect(ok).toBe(false);
    expect(a.result.current.cage?.heightCm).toBe(35);
    act(() => a.result.current.remove());
    expect(b.result.current.cage).toBeNull();
    expect(backend.getItem(cageKey(HG))).toBeNull();
  });

  it('스키마 없으면 저장 불가(false), 읽기는 형태만 검사', () => {
    backend.setItem(cageKey(HG), JSON.stringify({ v: 1, ...BOX, updatedAt: T0 }));
    const h = renderHook(() => useCage(HG, { schema: null, storage: store }));
    expect(h.result.current.cage?.floorWcm).toBe(80);
    let ok = true;
    act(() => {
      ok = h.result.current.save(BOX);
    });
    expect(ok).toBe(false);
  });

  it('잘못된 typeId → null, 동작 무시', () => {
    const h = renderHook(() => useCage('../x', { schema: SCHEMA, storage: store }));
    let ok = true;
    act(() => {
      ok = h.result.current.save(BOX);
    });
    expect(ok).toBe(false);
    expect(h.result.current.cage).toBeNull();
    expect(backend.length).toBe(0);
  });
});

describe('Saveable(cages)', () => {
  it('export: ws.context.*.cage 만, 깨진 값·.bak 제외', () => {
    writeCage(store, HG, WIRE, SCHEMA, T0);
    backend.setItem(cageKey('budgie'), '{bad');
    backend.setItem(`${cageKey('gerbil-mongolian')}.bak`, 'x');
    backend.setItem('ws.setup.hamster-golden', '{}');
    const sv = createCageSaveable(store, () => SCHEMA);
    expect(sv.key).toBe('cages');
    expect(sv.export()).toEqual({ [HG]: { v: 1, ...WIRE, updatedAt: T0 } });
  });

  it('import: 범위 안 레코드만(updatedAt 보존), 범위 밖·잘못된 typeId·금지 키 섞인 레코드는 정리/거부', () => {
    const sv = createCageSaveable(store, () => SCHEMA);
    sv.import({
      [HG]: { v: 1, ...BOX, updatedAt: T1, email: 'a@b.c', lat: 37.5 } as unknown as CageV1,
      'gerbil-mongolian': { v: 1, ...BOX, floorWcm: 5, updatedAt: T1 },
      '../x': { v: 1, ...BOX, updatedAt: T1 },
      budgie: { v: 1, ...BOX, updatedAt: 3 } as unknown as CageV1,
    });
    const raw = backend.getItem(cageKey(HG)) as string;
    expect(JSON.parse(raw)).toEqual({ v: 1, ...BOX, updatedAt: T1 });
    expect(raw).not.toMatch(/@|lat/);
    expect(backend.getItem(cageKey('gerbil-mongolian'))).toBeNull();
    expect(backend.getItem(cageKey('budgie'))).toBeNull();
    expect(store.keys()).toEqual([cageKey(HG)]);
  });

  it('import: 스키마를 아직 모르면 형태 검사만(값은 읽기·쓰기 시 스키마로 다시 거른다)', () => {
    const sv = createCageSaveable(store, () => null);
    sv.import({ [HG]: { v: 1, ...BOX, updatedAt: T1 } });
    expect(readCage(store, HG)).toEqual({ v: 1, ...BOX, updatedAt: T1 });
  });

  it('subscribe: 훅 저장·import·다른 탭 이벤트에 호출, 해제 후 0', () => {
    const sv = createCageSaveable(store, () => SCHEMA);
    const fn = vi.fn();
    const off = sv.subscribe(fn);
    const h = renderHook(() => useCage(HG, { schema: SCHEMA, storage: store }));
    act(() => {
      h.result.current.save(BOX);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    sv.import({ budgie: { v: 1, ...BOX, updatedAt: T0 } });
    expect(fn).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent('storage', { key: cageKey('gerbil-mongolian') }));
    expect(fn).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new StorageEvent('storage', { key: 'ws.setup.hamster-golden' }));
    expect(fn).toHaveBeenCalledTimes(3);
    off();
    act(() => h.result.current.remove());
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('케이지 삭제 tombstone(서버 병합 부활 방지)', () => {
  it('removeCage(있던 케이지) → 삭제 시각 기록, 다시 저장하면 지운다, 없던 케이지 삭제는 기록 0', () => {
    const sv = createCageSaveable(store, () => SCHEMA);
    removeCage(store, HG);
    expect(sv.tombstones?.()).toEqual({});
    writeCage(store, HG, BOX, SCHEMA, T0);
    removeCage(store, HG);
    const t = sv.tombstones?.() ?? {};
    expect(Object.keys(t)).toEqual([HG]);
    expect(Number.isFinite(Date.parse(t[HG]))).toBe(true);
    expect(sv.export()).toEqual({});
    writeCage(store, HG, BOX, SCHEMA, T1);
    expect(sv.tombstones?.()).toEqual({});
  });

  it('import: 삭제 뒤보다 새 서버 케이지는 받고(tombstone 해제), 삭제 시각 이하의 옛 케이지는 받지 않는다', () => {
    const sv = createCageSaveable(store, () => SCHEMA);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T00:00:00.000Z'));
    writeCage(store, HG, BOX, SCHEMA, T0);
    removeCage(store, HG);
    vi.useRealTimers();
    sv.import({ [HG]: { v: 1, ...BOX, updatedAt: T1 } });
    expect(sv.export()).toEqual({});
    sv.import({ [HG]: { v: 1, ...BOX, updatedAt: '2026-10-06T00:00:00.000Z' } });
    expect(Object.keys(sv.export())).toEqual([HG]);
    expect(sv.tombstones?.()).toEqual({});
  });
});
