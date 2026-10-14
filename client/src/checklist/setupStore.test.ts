// checklist/setupStore — 계약 C-R5-1 ws.setup.{typeId}: 스키마 v2(updatedAt), migrate v1→v2(updatedAt = 기존 시각 최대),
//   미지 v·깨진 JSON → null + .bak, 전이(모든 변경 updatedAt 갱신, PURCHASED 쓰기), useSetup, Saveable(C-R5-9).
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage, type WsStorage } from '../lib/storage';
import {
  applyAnswer,
  applyPurchased,
  applyReached100,
  applyToggle,
  createSetupSaveable,
  migrateSetup,
  readSetup,
  setupKey,
  useSetup,
  writeSetup,
  type SetupV1,
  type SetupV2,
  type SetupV3,
} from './setupStore';

const T0 = '2026-10-02T00:00:00.000Z';
const T1 = '2026-10-02T00:05:00.000Z';
const T2 = '2026-10-02T00:09:00.000Z';

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

function v1(over: Partial<SetupV1> = {}): SetupV1 {
  return { v: 1, firstTime: null, owned: [], answeredAt: null, startedAt: T0, checks: {}, reached100At: null, ...over };
}

function base(over: Partial<SetupV3> = {}): SetupV3 {
  return {
    v: 3,
    firstTime: null,
    owned: [],
    answeredAt: null,
    startedAt: T0,
    checks: {},
    uncheckedAt: {},
    reached100At: null,
    updatedAt: T0,
    ...over,
  };
}

/** 저장된 v2(F 이전) — 승격 입력 전용. */
function v2(over: Partial<SetupV2> = {}): SetupV2 {
  return {
    v: 2,
    firstTime: null,
    owned: [],
    answeredAt: null,
    startedAt: T0,
    checks: {},
    reached100At: null,
    updatedAt: T0,
    ...over,
  };
}

let backend: Storage;
let store: WsStorage;
beforeEach(() => {
  backend = memBackend();
  store = createStorage(() => backend);
});

describe('migrateSetup', () => {
  it('v2 정상 → 정규화(알 수 없는 키 제거, 잘못된 check 행 제거)', () => {
    const raw = {
      ...base({ checks: { cage: { source: 'OWNED', at: T0 }, bad: { source: 'NOPE' as never, at: T0 } } }),
      extra: 1,
      email: 'a@b.c',
    };
    const m = migrateSetup(raw);
    expect(m).toEqual(base({ checks: { cage: { source: 'OWNED', at: T0 } } }));
    expect(Object.keys(m as object)).not.toContain('extra');
    expect(Object.keys(m as object)).not.toContain('email');
  });

  it('v1 → v2: updatedAt = max(startedAt, answeredAt, reached100At, checks[*].at)', () => {
    expect(migrateSetup(v1())).toEqual(base({ updatedAt: T0 }));
    expect(migrateSetup(v1({ answeredAt: T1 }))?.updatedAt).toBe(T1);
    expect(migrateSetup(v1({ answeredAt: T0, reached100At: T1 }))?.updatedAt).toBe(T1);
    const m = migrateSetup(
      v1({ answeredAt: T0, checks: { cage: { source: 'OWNED', at: T2 }, wheel: { source: 'UNKNOWN', at: T1 } } }),
    );
    expect(m?.v).toBe(3);
    expect(m?.updatedAt).toBe(T2);
    expect(m?.checks.cage).toEqual({ source: 'OWNED', at: T2 });
  });

  it('v1 → v2: 시각 비교는 문자열이 아니라 시간값(오프셋 표기 섞여도 최대)', () => {
    const late = '2026-10-02T09:30:00+09:00'; // = 00:30Z > T1
    // F1 서버는 Z 형식만 받는다 → 같은 순간의 Z 로 정규화.
    expect(migrateSetup(v1({ answeredAt: T1, reached100At: late }))?.updatedAt).toBe('2026-10-02T00:30:00.000Z');
  });

  it('v2 → v3: 필드 그대로 + uncheckedAt {}(키 순서 = 서버 계약, checks 다음)', () => {
    const m = migrateSetup(v2({ answeredAt: T1, checks: { cage: { source: 'OWNED', at: T1 } }, updatedAt: T1 }));
    expect(m).toEqual(base({ answeredAt: T1, checks: { cage: { source: 'OWNED', at: T1 } }, updatedAt: T1 }));
    expect(Object.keys(m as object)).toEqual([
      'v', 'firstTime', 'owned', 'answeredAt', 'startedAt', 'checks', 'uncheckedAt', 'reached100At', 'updatedAt',
    ]);
  });

  it('v3: uncheckedAt 없으면 null, 무효 tombstone 행(금지 키·비시각)은 버림, 오프셋 시각은 Z 로', () => {
    const { uncheckedAt: _x, ...noTomb } = base();
    void _x;
    expect(migrateSetup(noTomb)).toBeNull();
    expect(migrateSetup({ ...base(), uncheckedAt: [] })).toBeNull();
    const m = migrateSetup(base({ uncheckedAt: { q: T1, wheel: 'nope', cage: '2026-10-02T09:05:00+09:00' } }));
    expect(m?.uncheckedAt).toEqual({ cage: T1 });
  });

  it('v1 → v2: 해석 불가 시각은 무시(startedAt 기준)', () => {
    expect(migrateSetup(v1({ checks: { cage: { source: 'OWNED', at: 'not-a-date' } } }))?.updatedAt).toBe(T0);
  });

  it('v1 PURCHASED 행도 보존', () => {
    expect(migrateSetup(v1({ checks: { cage: { source: 'PURCHASED', at: T1 } } }))?.checks.cage.source).toBe('PURCHASED');
  });

  it('v 없음 · v=99 · v=0 · 형태 깨짐 · v2 updatedAt 없음 → null', () => {
    const { v: _omit, ...noV } = base();
    void _omit;
    expect(migrateSetup(noV)).toBeNull();
    expect(migrateSetup({ ...base(), v: 99 })).toBeNull();
    expect(migrateSetup({ ...base(), v: 0 })).toBeNull();
    expect(migrateSetup({ ...base(), v: '2' })).toBeNull();
    expect(migrateSetup({ ...base(), startedAt: 5 })).toBeNull();
    expect(migrateSetup({ ...base(), owned: 'cage' })).toBeNull();
    expect(migrateSetup({ ...v1(), owned: 'cage' })).toBeNull();
    const { updatedAt: _u, ...noUpdated } = base();
    void _u;
    expect(migrateSetup(noUpdated)).toBeNull();
    expect(migrateSetup(null)).toBeNull();
    expect(migrateSetup([])).toBeNull();
  });

  it('금지 키 이름의 check id 는 버린다(저장 거부로 상태가 깨지지 않게)', () => {
    const m = migrateSetup(base({ checks: { q: { source: 'OWNED', at: T0 }, cage: { source: 'OWNED', at: T0 } } }));
    expect(Object.keys(m?.checks ?? {})).toEqual(['cage']);
  });
});

describe('readSetup / writeSetup', () => {
  it('왕복', () => {
    const s = base({ owned: ['cage'], answeredAt: T0, firstTime: true });
    writeSetup(store, 'hamster-golden', s);
    expect(backend.getItem('ws.setup.hamster-golden')).toBe(JSON.stringify(s));
    expect(readSetup(store, 'hamster-golden')).toEqual(s);
  });

  it('저장된 v1 을 읽으면 v2 로 올려 돌려준다(원본은 다음 쓰기에서 v2 로)', () => {
    backend.setItem('ws.setup.hamster-golden', JSON.stringify(v1({ answeredAt: T1 })));
    expect(readSetup(store, 'hamster-golden')).toEqual(base({ answeredAt: T1, updatedAt: T1 }));
    expect(backend.getItem('ws.setup.hamster-golden.bak')).toBeNull();
  });

  it('없는 키 → null, .bak 없음', () => {
    expect(readSetup(store, 'hamster-golden')).toBeNull();
    expect(backend.getItem('ws.setup.hamster-golden.bak')).toBeNull();
  });

  it.each([
    ['깨진 JSON', '{"v":2,'],
    ['v 없음', JSON.stringify({ firstTime: null })],
    ['v=99', JSON.stringify({ ...base(), v: 99 })],
    ['깨진 v1', JSON.stringify({ ...v1(), checks: [] })],
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

  it('불변식 ⑧: 저장된 JSON 에 좌표·지역·이메일·토큰 키 0', () => {
    let s = applyAnswer(null, { firstTime: false, owned: ['cage', 'wheel'] }, T0);
    s = applyToggle(s, 'bedding', T1);
    s = applyPurchased(s, 'water', T1);
    s = applyReached100(s, T1);
    writeSetup(store, 'hamster-golden', s);
    const json = backend.getItem('ws.setup.hamster-golden') as string;
    const keys = new Set<string>();
    JSON.parse(json, (k, v) => {
      keys.add(k);
      return v;
    });
    for (const banned of ['lat', 'lng', 'coords', 'latitude', 'longitude', 'region', 'email', 'token', 'query', 'sid']) {
      expect(keys.has(banned)).toBe(false);
    }
    expect(json).not.toMatch(/@/);
  });
});

describe('전이(모든 변경 updatedAt 갱신)', () => {
  it('applyAnswer: 보유 항목 → OWNED ✓, answeredAt·firstTime·updatedAt 기록, startedAt 유지', () => {
    const s0 = applyToggle(null, 'bedding', T0);
    const s1 = applyAnswer(s0, { firstTime: false, owned: ['cage', 'cage', 'wheel'] }, T1);
    expect(s1.v).toBe(3);
    expect(s1.startedAt).toBe(T0);
    expect(s1.answeredAt).toBe(T1);
    expect(s1.updatedAt).toBe(T1);
    expect(s1.firstTime).toBe(false);
    expect(s1.owned).toEqual(['cage', 'wheel']);
    expect(s1.checks.cage).toEqual({ source: 'OWNED', at: T1 });
    expect(s1.checks.bedding).toEqual({ source: 'UNKNOWN', at: T0 });
  });

  it('applyAnswer 재설정: 빠진 보유 항목의 OWNED ✓ 만 해제(수동·PURCHASED 체크는 유지)', () => {
    const s1 = applyAnswer(null, { firstTime: false, owned: ['cage', 'wheel'] }, T0);
    const s2 = applyPurchased(applyToggle(s1, 'bedding', T0), 'water', T0);
    const s3 = applyAnswer(s2, { firstTime: false, owned: ['cage'] }, T1);
    expect(Object.keys(s3.checks).sort()).toEqual(['bedding', 'cage', 'water']);
    expect(s3.checks.cage.at).toBe(T0); // 이미 보유 ✓ 는 그대로
    expect(s3.uncheckedAt).toEqual({ wheel: T1 }); // 재답변으로 빠진 OWNED ✓ = tombstone(F 계약)
    const s4 = applyAnswer(s3, { firstTime: false, owned: ['cage', 'wheel'] }, T2);
    expect(s4.checks.wheel).toEqual({ source: 'OWNED', at: T2 });
    expect(s4.uncheckedAt).toEqual({}); // 다시 보유 = 더 새 체크 → tombstone 제거
  });

  it('applyToggle: 없으면 UNKNOWN 추가, 있으면 키 삭제(해제), setup 없으면 L3 전 상태로 생성', () => {
    const s1 = applyToggle(null, 'cage', T0);
    expect(s1).toEqual(base({ checks: { cage: { source: 'UNKNOWN', at: T0 } } }));
    const s2 = applyToggle(s1, 'cage', T1);
    expect(s2.checks).toEqual({});
    expect(s2.uncheckedAt).toEqual({ cage: T1 }); // 해제 = tombstone
    expect(s2.updatedAt).toBe(T1);
    expect(s1.checks.cage).toBeDefined(); // 입력 불변
    const s3 = applyToggle(s2, 'cage', T2);
    expect(s3.checks.cage).toEqual({ source: 'UNKNOWN', at: T2 });
    expect(s3.uncheckedAt).toEqual({});
    expect(s2.uncheckedAt).toEqual({ cage: T1 }); // 입력 불변
  });

  it('applyPurchased 는 같은 id 의 tombstone 을 지운다', () => {
    const s = applyPurchased(applyToggle(applyToggle(null, 'cage', T0), 'cage', T1), 'cage', T2);
    expect(s.checks.cage).toEqual({ source: 'PURCHASED', at: T2 });
    expect(s.uncheckedAt).toEqual({});
  });

  it('applyPurchased: 없으면 PURCHASED ✓(L4 [준비했어요]), 이미 ✓ 면 그대로(같은 객체)', () => {
    const s1 = applyPurchased(null, 'cage', T1);
    expect(s1.checks.cage).toEqual({ source: 'PURCHASED', at: T1 });
    expect(s1.updatedAt).toBe(T1);
    expect(s1.answeredAt).toBeNull();
    expect(applyPurchased(s1, 'cage', T2)).toBe(s1);
    const owned = applyAnswer(null, { firstTime: false, owned: ['wheel'] }, T0);
    expect(applyPurchased(owned, 'wheel', T2)).toBe(owned);
  });

  it('applyReached100: 한 번만 기록, updatedAt 은 건드리지 않는다(F 계약 — L2 열기만으로 새것 아님)', () => {
    const s1 = applyReached100(base(), T1);
    expect(s1.reached100At).toBe(T1);
    expect(s1.updatedAt).toBe(T0);
    expect(applyReached100(s1, T2)).toBe(s1);
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
    expect(c.result.current.setup?.v).toBe(3);
    expect(Object.keys(c.result.current.setup?.checks ?? {}).sort()).toEqual(['cage', 'wheel']);
    act(() => c.result.current.reset());
    expect(c.result.current.setup).toBeNull();
    expect(backend.getItem('ws.setup.hamster-golden')).toBeNull();
  });

  it('purchase: PURCHASED 저장, updatedAt = 지금', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(T2));
    const h = renderHook(() => useSetup('hamster-golden', { storage: store }));
    act(() => h.result.current.purchase('cage'));
    expect(h.result.current.setup?.checks.cage).toEqual({ source: 'PURCHASED', at: T2 });
    expect(JSON.parse(backend.getItem('ws.setup.hamster-golden') as string).updatedAt).toBe(T2);
    act(() => h.result.current.purchase('../x'));
    expect(Object.keys(h.result.current.setup?.checks ?? {})).toEqual(['cage']);
  });

  it('저장된 v1 을 읽어 표시, 다음 변경이 v3 로 기록', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(T2));
    backend.setItem('ws.setup.hamster-golden', JSON.stringify(v1({ checks: { cage: { source: 'OWNED', at: T1 } } })));
    const h = renderHook(() => useSetup('hamster-golden', { storage: store }));
    expect(h.result.current.setup?.updatedAt).toBe(T1);
    act(() => h.result.current.toggle('wheel'));
    const saved = JSON.parse(backend.getItem('ws.setup.hamster-golden') as string) as SetupV3;
    expect(saved.v).toBe(3);
    expect(saved.uncheckedAt).toEqual({});
    expect(saved.updatedAt).toBe(T2);
    expect(Object.keys(saved.checks).sort()).toEqual(['cage', 'wheel']);
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
    expect(h.result.current.setup).toMatchObject({ v: 3, answeredAt: null, checks: {}, uncheckedAt: {} });
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
    act(() => h.result.current.purchase('cage'));
    expect(h.result.current.setup).toBeNull();
    expect(backend.length).toBe(0);
  });
});

describe('Saveable(setups)', () => {
  it('export: 모든 ws.setup.* 를 v3 로(v1·v2 는 올려서), .bak·깨진 값·다른 키 제외', () => {
    writeSetup(store, 'hamster-golden', base({ updatedAt: T1 }));
    backend.setItem('ws.setup.syrian', JSON.stringify(v2({ updatedAt: T1 })));
    backend.setItem('ws.setup.gerbil-mongolian', JSON.stringify(v1({ answeredAt: T2 })));
    backend.setItem('ws.setup.budgie', '{broken');
    backend.setItem('ws.setup.x.bak', 'old');
    backend.setItem('ws.context.hamster-golden.cage', '{}');
    backend.setItem('ws.animalType', 'hamster-golden');
    const sv = createSetupSaveable(store);
    expect(sv.key).toBe('setups');
    const out = sv.export();
    expect(Object.keys(out).sort()).toEqual(['gerbil-mongolian', 'hamster-golden', 'syrian']);
    expect(out.syrian).toEqual(base({ updatedAt: T1 }));
    expect(out['gerbil-mongolian'].v).toBe(3);
    expect(out['gerbil-mongolian'].updatedAt).toBe(T2);
  });

  it('import: 검증된 레코드만 쓰기(알 수 없는·금지 키 제거), 무효 레코드·잘못된 typeId 건너뜀, 없는 레코드는 그대로', () => {
    writeSetup(store, 'budgie', base({ updatedAt: T0 }));
    const sv = createSetupSaveable(store);
    sv.import({
      'hamster-golden': { ...base({ updatedAt: T2 }), email: 'x@y.z', lat: 37.5 } as unknown as SetupV3,
      'gerbil-mongolian': { v: 99 } as unknown as SetupV3,
      '../evil': base(),
    });
    const hg = backend.getItem('ws.setup.hamster-golden') as string;
    expect(JSON.parse(hg)).toEqual(base({ updatedAt: T2 }));
    expect(hg).not.toMatch(/@|lat/);
    expect(backend.getItem('ws.setup.gerbil-mongolian')).toBeNull();
    expect(backend.getItem('ws.setup.budgie')).not.toBeNull();
    expect(sv.export()['hamster-golden']).toEqual(base({ updatedAt: T2 }));
  });

  it('import 는 null·배열 등 비객체 페이로드를 무시', () => {
    const sv = createSetupSaveable(store);
    sv.import(null as never);
    sv.import([] as never);
    expect(backend.length).toBe(0);
  });

  it('subscribe: 훅 변경·import·다른 탭 storage 이벤트에 호출, 해제 후 0', () => {
    const sv = createSetupSaveable(store);
    const fn = vi.fn();
    const off = sv.subscribe(fn);
    const h = renderHook(() => useSetup('hamster-golden', { storage: store }));
    act(() => h.result.current.toggle('cage'));
    expect(fn).toHaveBeenCalledTimes(1);
    sv.import({ budgie: base() });
    expect(fn).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent('storage', { key: 'ws.setup.gerbil-mongolian' }));
    expect(fn).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new StorageEvent('storage', { key: 'ws.animalType' }));
    expect(fn).toHaveBeenCalledTimes(3);
    off();
    act(() => h.result.current.toggle('wheel'));
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('import 는 같은 typeId 훅에 반영', () => {
    const h = renderHook(() => useSetup('hamster-golden', { storage: store }));
    act(() => createSetupSaveable(store).import({ 'hamster-golden': base({ checks: { cage: { source: 'PURCHASED', at: T1 } } }) }));
    expect(h.result.current.setup?.checks.cage?.source).toBe('PURCHASED');
  });
});
