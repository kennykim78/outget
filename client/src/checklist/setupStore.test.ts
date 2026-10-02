// checklist/setupStore — 계약 C-1 ws.setup.{typeId}: 스키마 v1, migrate(미지 v·깨진 JSON → null + .bak), 전이, useSetup.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage, type WsStorage } from '../lib/storage';
import {
  applyAnswer,
  applyReached100,
  applyToggle,
  migrateSetup,
  readSetup,
  setupKey,
  useSetup,
  writeSetup,
  type SetupV1,
} from './setupStore';

const T0 = '2026-10-02T00:00:00.000Z';
const T1 = '2026-10-02T00:05:00.000Z';

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

function base(over: Partial<SetupV1> = {}): SetupV1 {
  return { v: 1, firstTime: null, owned: [], answeredAt: null, startedAt: T0, checks: {}, reached100At: null, ...over };
}

let backend: Storage;
let store: WsStorage;
beforeEach(() => {
  backend = memBackend();
  store = createStorage(() => backend);
});

describe('migrateSetup', () => {
  it('v1 정상 → 정규화(알 수 없는 키 제거, 잘못된 check 행 제거)', () => {
    const raw = {
      ...base({ checks: { cage: { source: 'OWNED', at: T0 }, bad: { source: 'NOPE' as never, at: T0 } } }),
      extra: 1,
    };
    const m = migrateSetup(raw);
    expect(m).toEqual(base({ checks: { cage: { source: 'OWNED', at: T0 } } }));
    expect(Object.keys(m as object)).not.toContain('extra');
  });

  it('v 없음 · v=99 · 형태 깨짐 → null', () => {
    const { v: _omit, ...noV } = base();
    void _omit;
    expect(migrateSetup(noV)).toBeNull();
    expect(migrateSetup({ ...base(), v: 99 })).toBeNull();
    expect(migrateSetup({ ...base(), startedAt: 5 })).toBeNull();
    expect(migrateSetup({ ...base(), owned: 'cage' })).toBeNull();
    expect(migrateSetup(null)).toBeNull();
    expect(migrateSetup([])).toBeNull();
  });
});

describe('readSetup / writeSetup', () => {
  it('왕복', () => {
    const s = base({ owned: ['cage'], answeredAt: T0, firstTime: true });
    writeSetup(store, 'hamster-golden', s);
    expect(backend.getItem('ws.setup.hamster-golden')).toBe(JSON.stringify(s));
    expect(readSetup(store, 'hamster-golden')).toEqual(s);
  });

  it('없는 키 → null, .bak 없음', () => {
    expect(readSetup(store, 'hamster-golden')).toBeNull();
    expect(backend.getItem('ws.setup.hamster-golden.bak')).toBeNull();
  });

  it.each([
    ['깨진 JSON', '{"v":1,'],
    ['v 없음', JSON.stringify({ firstTime: null })],
    ['v=99', JSON.stringify({ ...base(), v: 99 })],
  ])('%s → null + 원본 .bak 보존(본 키 제거)', (_label, raw) => {
    backend.setItem('ws.setup.hamster-golden', raw);
    expect(readSetup(store, 'hamster-golden')).toBeNull();
    expect(backend.getItem('ws.setup.hamster-golden.bak')).toBe(raw);
    expect(backend.getItem('ws.setup.hamster-golden')).toBeNull();
  });

  it('.bak 은 최신 원본 1개만', () => {
    backend.setItem('ws.setup.a', 'x1');
    readSetup(store, 'a');
    backend.setItem('ws.setup.a', 'x2');
    readSetup(store, 'a');
    expect(backend.getItem('ws.setup.a.bak')).toBe('x2');
  });

  it('잘못된 typeId 키는 만들지 않는다', () => {
    expect(() => setupKey('../x')).toThrow();
    expect(() => setupKey('')).toThrow();
    expect(setupKey('hamster-golden')).toBe('ws.setup.hamster-golden');
  });

  it('불변식 ⑧: 저장된 JSON 에 lat/lng/coords/latitude/longitude/region·이메일 키 0', () => {
    let s = applyAnswer(null, { firstTime: false, owned: ['cage', 'wheel'] }, T0);
    s = applyToggle(s, 'bedding', T1);
    s = applyReached100(s, T1);
    writeSetup(store, 'hamster-golden', s);
    const json = backend.getItem('ws.setup.hamster-golden') as string;
    const keys = new Set<string>();
    JSON.parse(json, (k, v) => {
      keys.add(k);
      return v;
    });
    for (const banned of ['lat', 'lng', 'coords', 'latitude', 'longitude', 'region', 'email', 'token', 'query']) {
      expect(keys.has(banned)).toBe(false);
    }
    expect(json).not.toMatch(/@/);
  });
});

describe('전이', () => {
  it('applyAnswer: 보유 항목 → OWNED ✓, answeredAt·firstTime 기록, startedAt 유지', () => {
    const s0 = applyToggle(null, 'bedding', T0);
    const s1 = applyAnswer(s0, { firstTime: false, owned: ['cage', 'cage', 'wheel'] }, T1);
    expect(s1.startedAt).toBe(T0);
    expect(s1.answeredAt).toBe(T1);
    expect(s1.firstTime).toBe(false);
    expect(s1.owned).toEqual(['cage', 'wheel']);
    expect(s1.checks.cage).toEqual({ source: 'OWNED', at: T1 });
    expect(s1.checks.bedding).toEqual({ source: 'UNKNOWN', at: T0 });
  });

  it('applyAnswer 재설정: 빠진 보유 항목의 OWNED ✓ 만 해제(수동 체크는 유지)', () => {
    const s1 = applyAnswer(null, { firstTime: false, owned: ['cage', 'wheel'] }, T0);
    const s2 = applyToggle(s1, 'bedding', T0);
    const s3 = applyAnswer(s2, { firstTime: false, owned: ['cage'] }, T1);
    expect(Object.keys(s3.checks).sort()).toEqual(['bedding', 'cage']);
    expect(s3.checks.cage.at).toBe(T0); // 이미 보유 ✓ 는 그대로
  });

  it('applyToggle: 없으면 UNKNOWN 추가, 있으면 키 삭제(해제), setup 없으면 L3 전 상태로 생성', () => {
    const s1 = applyToggle(null, 'cage', T0);
    expect(s1).toEqual(base({ checks: { cage: { source: 'UNKNOWN', at: T0 } } }));
    const s2 = applyToggle(s1, 'cage', T1);
    expect(s2.checks).toEqual({});
    expect(s1.checks.cage).toBeDefined(); // 입력 불변
  });

  it('applyReached100: 한 번만 기록', () => {
    const s1 = applyReached100(base(), T0);
    expect(s1.reached100At).toBe(T0);
    expect(applyReached100(s1, T1)).toBe(s1);
  });
});

describe('useSetup', () => {
  afterEach(() => vi.useRealTimers());

  it('answer·toggle 즉시 저장, 재마운트 후 유지, 같은 typeId 훅끼리 동기', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(T0));
    const a = renderHook(() => useSetup('hamster-golden', { storage: store }));
    const b = renderHook(() => useSetup('hamster-golden', { storage: store }));
    expect(a.result.current.setup).toBeNull();
    act(() => a.result.current.answer({ firstTime: true, owned: ['cage'] }));
    expect(b.result.current.setup?.checks.cage?.source).toBe('OWNED');
    act(() => b.result.current.toggle('wheel'));
    expect(a.result.current.setup?.checks.wheel?.source).toBe('UNKNOWN');
    a.unmount();
    b.unmount();
    const c = renderHook(() => useSetup('hamster-golden', { storage: store }));
    expect(c.result.current.setup?.answeredAt).toBe(T0);
    expect(Object.keys(c.result.current.setup?.checks ?? {}).sort()).toEqual(['cage', 'wheel']);
    act(() => c.result.current.reset());
    expect(c.result.current.setup).toBeNull();
    expect(backend.getItem('ws.setup.hamster-golden')).toBeNull();
  });

  it('markReached100: 처음만 true(해제·재도달 재발화 없음)', () => {
    const h = renderHook(() => useSetup('hamster-golden', { storage: store }));
    let first = false;
    let second = true;
    let none = true;
    act(() => {
      none = h.result.current.markReached100(); // setup 없음 → 기록할 것 없음
    });
    expect(none).toBe(false);
    act(() => h.result.current.toggle('cage'));
    act(() => {
      first = h.result.current.markReached100();
    });
    act(() => {
      second = h.result.current.markReached100();
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('start: 없을 때만 L3 전 상태 생성, 있으면 그대로', () => {
    const h = renderHook(() => useSetup('hamster-golden', { storage: store }));
    act(() => h.result.current.start());
    expect(h.result.current.setup).toMatchObject({ v: 1, answeredAt: null, checks: {} });
    act(() => h.result.current.toggle('cage'));
    act(() => h.result.current.start());
    expect(h.result.current.setup?.checks.cage).toBeDefined();
  });

  it('저장 불가(메모리 폴백)에서도 동작', () => {
    const broken = createStorage(() => {
      throw new Error('blocked');
    });
    const notice = vi.fn();
    broken.onUnavailable(notice);
    const h = renderHook(() => useSetup('hamster-golden', { storage: broken }));
    act(() => h.result.current.toggle('cage'));
    expect(h.result.current.setup?.checks.cage).toBeDefined();
    expect(notice).toHaveBeenCalledTimes(1);
  });

  it('잘못된 typeId → setup null, 동작 무시', () => {
    const h = renderHook(() => useSetup('../evil', { storage: store }));
    act(() => h.result.current.toggle('cage'));
    expect(h.result.current.setup).toBeNull();
    expect(backend.length).toBe(0);
  });
});
