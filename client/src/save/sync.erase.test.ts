// sync.erase · sync.wipeDevice(89 스펙 동작 계약 ①~⑤·⑦) — 서버 먼저·로컬은 성공 뒤, 401 = 연결 기록만 해제, 실패 = 로컬 0 변경 + 재개,
//   기기 지우기 = (연결 시) 로그아웃 먼저 → ws.* 전부(래퍼 keys('ws.') 열거), 로그아웃 실패 시 ws.save {pendingLogout} 만.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage, type WsStorage } from '../lib/storage';
import type { SaveApi } from './api';
import type { Saveable } from './contract';
import { SAVE_STATE_KEY } from './saveStateStore';
import { createSaveSync, type SaveSync } from './sync';
import type { SaveSlices } from './saveables';

function memoryBackend(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as Storage;
}

function slice<P>(key: Saveable<P>['key'], value: P): Saveable<P> & { listeners: number } {
  const ls = new Set<() => void>();
  return {
    key,
    export: () => value,
    import: () => undefined,
    subscribe: (fn: () => void) => {
      ls.add(fn);
      return () => ls.delete(fn);
    },
    get listeners() {
      return ls.size;
    },
  };
}

function slices(): SaveSlices {
  return {
    setups: slice('setups', {}),
    cages: slice('cages', {}),
    reactions: slice('reactions', { v: 1, like: {}, helpful: {}, updatedAt: null } as never),
    animalType: slice('animalType', null),
  };
}

let store: WsStorage;
let events: string[];

function api(over: Partial<SaveApi> = {}): SaveApi {
  return {
    requestMagic: vi.fn(async () => ({ status: 202 })),
    verify: vi.fn(async () => ({ status: 200 })),
    session: vi.fn(async () => ({ status: 200, linked: true })),
    logout: vi.fn(async () => ({ status: 204 })),
    getSave: vi.fn(async () => ({ status: 200, body: { snapshot: null, updatedAt: null } })),
    putSave: vi.fn(async () => ({ status: 200, updatedAt: '2026-10-01T00:00:00.000Z' })),
    erase: vi.fn(async () => ({ status: 204 })),
    ...over,
  };
}

function make(a: SaveApi): SaveSync {
  return createSaveSync({ api: a, storage: store, slices: slices(), track: (n) => void events.push(n), now: () => '2026-10-02T00:00:00.000Z', debounceMs: 10 });
}

function seed(linked: boolean): void {
  store.set('ws.animalType', 'hamster-golden');
  store.set('ws.setup.hamster-golden', '{"v":2}');
  store.set('ws.context.hamster-golden.cage', '{"v":1}');
  store.set('ws.reactions', '{"v":1}');
  store.set('ws.session', '{"v":1}');
  store.set('ws.future-key', '"x"'); // 하드코딩 목록 밖 키도 지운다
  if (linked) store.set(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
}

beforeEach(() => {
  const b = memoryBackend();
  store = createStorage(() => b);
  events = [];
});

describe('sync.erase', () => {
  it('204 · wipeDevice=false → ws.save 만 삭제, 로그아웃 0, 이벤트 0', async () => {
    seed(true);
    const a = api();
    const s = make(a);
    await s.resume();
    expect(s.isRunning()).toBe(true);
    events = [];
    const r = await s.erase({ wipeDevice: false });
    expect(r).toEqual({ kind: 'erased', wiped: false });
    expect(a.erase).toHaveBeenCalledTimes(1);
    expect(a.logout).not.toHaveBeenCalled();
    expect(store.get(SAVE_STATE_KEY)).toBeNull();
    expect(store.keys('ws.').sort()).toEqual(['ws.animalType', 'ws.context.hamster-golden.cage', 'ws.future-key', 'ws.reactions', 'ws.session', 'ws.setup.hamster-golden']);
    expect(s.isRunning()).toBe(false);
    expect(events).toEqual([]);
  });

  it('204 · wipeDevice=true → ws.* 0(목록 밖 키 포함)', async () => {
    seed(true);
    const s = make(api());
    expect(await s.erase({ wipeDevice: true })).toEqual({ kind: 'erased', wiped: true });
    expect(store.keys('ws.')).toEqual([]);
  });

  it('요청 전 자동 저장 정지 — erase 호출 시점에 구독 0', async () => {
    seed(true);
    let runningAtCall: boolean | null = null;
    const s: SaveSync = make(
      api({
        erase: vi.fn(async () => {
          runningAtCall = s.isRunning();
          return { status: 204 };
        }),
      }),
    );
    await s.resume();
    await s.erase({ wipeDevice: false });
    expect(runningAtCall).toBe(false);
  });

  it('401 → reauth: ws.save 만 해제(로그아웃 0), 준비 상태 유지', async () => {
    seed(true);
    const a = api({ erase: vi.fn(async () => ({ status: 401 })) });
    const s = make(a);
    expect(await s.erase({ wipeDevice: true })).toEqual({ kind: 'reauth' });
    expect(a.logout).not.toHaveBeenCalled();
    expect(store.get(SAVE_STATE_KEY)).toBeNull();
    expect(store.get('ws.animalType')).toBe('hamster-golden');
  });

  it.each([
    [429, 'limited'],
    [500, 'failed'],
    [0, 'failed'],
    [400, 'failed'],
    [403, 'failed'],
  ] as const)('%s → %s: 로컬 0 변경, 연결 중이었으면 자동 저장 재개', async (status, kind) => {
    seed(true);
    const s = make(api({ erase: vi.fn(async () => ({ status })) }));
    await s.resume();
    const before = store.keys('ws.').sort().map((k) => `${k}=${store.get(k)}`);
    expect(await s.erase({ wipeDevice: true })).toEqual({ kind });
    expect(store.keys('ws.').sort().map((k) => `${k}=${store.get(k)}`)).toEqual(before);
    expect(s.isRunning()).toBe(true);
  });
});

describe('sync.wipeDevice', () => {
  it('미연결 → 네트워크 0, ws.* 0', async () => {
    seed(false);
    const a = api();
    const s = make(a);
    expect(await s.wipeDevice()).toEqual({ logoutPending: false });
    expect(a.logout).not.toHaveBeenCalled();
    expect(a.erase).not.toHaveBeenCalled();
    expect(store.keys('ws.')).toEqual([]);
  });

  it('연결 중 → 로그아웃 먼저 → ws.* 0, 서버 저장본 삭제 요청 0', async () => {
    seed(true);
    const order: string[] = [];
    const a = api({
      logout: vi.fn(async () => {
        order.push(`logout:${store.keys('ws.').length}`);
        return { status: 204 };
      }),
    });
    const s = make(a);
    await s.resume();
    expect(await s.wipeDevice()).toEqual({ logoutPending: false });
    expect(order).toHaveLength(1);
    expect(order[0]).not.toBe('logout:0'); // 로그아웃 시점엔 아직 지우기 전
    expect(a.erase).not.toHaveBeenCalled();
    expect(store.keys('ws.')).toEqual([]);
    expect(s.isRunning()).toBe(false);
  });

  it('로그아웃 실패 → ws.save {linked:false, pendingLogout:true} 만 남김', async () => {
    seed(true);
    const s = make(api({ logout: vi.fn(async () => ({ status: 0 })) }));
    expect(await s.wipeDevice()).toEqual({ logoutPending: true });
    expect(store.keys('ws.')).toEqual([SAVE_STATE_KEY]);
    expect(JSON.parse(store.get(SAVE_STATE_KEY) as string)).toEqual({ v: 1, linked: false, lastSyncAt: null, pendingLogout: true });
  });

  it('unlink:true(서버 세션만 있는 기기) → 로그아웃 후 ws.* 0', async () => {
    seed(false);
    const a = api();
    const s = make(a);
    await s.wipeDevice({ unlink: true });
    expect(a.logout).toHaveBeenCalledTimes(1);
    expect(store.keys('ws.')).toEqual([]);
  });

  it('메모리 모드(localStorage 불가)에서도 열거한 키를 모두 지운다', async () => {
    store = createStorage(() => {
      throw new Error('blocked');
    });
    seed(false);
    expect(store.isMemoryOnly()).toBe(true);
    expect(store.keys('ws.').length).toBeGreaterThan(0);
    await make(api()).wipeDevice();
    expect(store.keys('ws.')).toEqual([]);
  });
});
