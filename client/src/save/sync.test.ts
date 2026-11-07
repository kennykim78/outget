// save/sync — link(verify → GET → 병합 → 로컬 쓰기 → PUT) · save_link_confirm/save_merge · 2초 디바운스 PUT · 401 · 연결 해제.
//   + 퍼즈: 실제 스토어(setups·cages·reactions·animalType)로 연결·병합·변경을 반복한 뒤 모든 ws.* 값에 토큰·이메일·금지 키 0.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORBIDDEN_KEYS, createStorage, type WsStorage } from '../lib/storage';
import { applyToggle, readSetup } from '../checklist/setupStore';
import type { SaveApi } from './api';
import type { Saveable, SaveReactions, SaveV1, SetupV3 } from './contract';
import { emptyReactions } from './merge';
import { defaultSlices, type SaveSlices } from './saveables';
import { SAVE_STATE_KEY, clearSaveState, readSaveState, writeSaveState } from './saveStateStore';
import { SAVE_RETRY_BASE_MS, SAVE_RETRY_MAX_ATTEMPTS, createSaveSync, flushOnHide, type LinkOutcome, type SaveSync, type SaveSyncDeps } from './sync';

const T1 = '2026-10-01T00:00:00.000Z';
const T2 = '2026-10-02T00:00:00.000Z';
const NOW = '2026-10-12T00:00:00.000Z';
const TOKEN = 'Q'.repeat(43);
const EMAIL = 'kenny@example.com';

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

function setup(updatedAt: string, checked: string[] = []): SetupV3 {
  return {
    v: 3,
    firstTime: true,
    owned: [],
    answeredAt: T1,
    startedAt: T1,
    checks: Object.fromEntries(checked.map((id) => [id, { source: 'OWNED' as const, at: updatedAt }])),
    uncheckedAt: {},
    reached100At: null,
    updatedAt,
  };
}

/** 손으로 바꾸는 조각(변경 알림을 테스트가 직접 쏜다). */
function fakeSlice<P>(key: Saveable<P>['key'], initial: P): Saveable<P> & { value: P; fire(): void; imported: P[] } {
  const ls = new Set<() => void>();
  const s = {
    key,
    value: initial,
    imported: [] as P[],
    export: () => s.value,
    import: (p: P) => {
      s.imported.push(p);
      // 계약(C-R5-9): setups·cages 는 받은 레코드만 쓰고 없는 레코드는 그대로(D23) — 실제 스토어와 같게 합친다.
      s.value = key === 'setups' || key === 'cages' ? ({ ...(s.value as object), ...(p as object) } as P) : p;
    },
    subscribe: (fn: () => void) => {
      ls.add(fn);
      return () => ls.delete(fn);
    },
    fire: () => ls.forEach((l) => l()),
  };
  return s;
}

/** 서버 행 시각 — 실제 서버처럼 쓸 때마다 증가(H1 기준 시각 비교용). */
let tick = 0;
const nextAt = (): string => new Date(Date.parse(T2) + ++tick * 1000).toISOString();

function fakeApi(over: Partial<{ [K in keyof SaveApi]: SaveApi[K] }> = {}) {
  const order: string[] = [];
  const puts: SaveV1[] = [];
  const bases: Array<string | null> = [];
  let server: SaveV1 | null = null;
  let serverAt: string | null = null;
  const api: SaveApi = {
    requestMagic: vi.fn(async () => ({ status: 202 })),
    verify: vi.fn(async () => {
      order.push('verify');
      return { status: 200 };
    }),
    session: vi.fn(async () => ({ status: 200, linked: true })),
    logout: vi.fn(async () => {
      order.push('logout');
      return { status: 204 };
    }),
    erase: vi.fn(async () => {
      order.push('erase');
      return { status: 204 };
    }),
    getSave: vi.fn(async () => {
      order.push('get');
      return { status: 200, body: { snapshot: server, updatedAt: serverAt } };
    }),
    // 서버 PUT 계약(H1): 기준 시각이 지금 행 시각과 같을 때만 쓰고 200 {updatedAt}, 다르면 409 + 지금 서버본.
    putSave: vi.fn(async (s: SaveV1, base: string | null) => {
      order.push('put');
      bases.push(base);
      if (base !== serverAt) return { status: 409, current: { snapshot: structuredClone(server), updatedAt: serverAt } };
      puts.push(structuredClone(s));
      server = structuredClone(s);
      serverAt = nextAt();
      return { status: 200, updatedAt: serverAt };
    }),
    ...over,
  };
  return {
    api,
    order,
    puts,
    bases,
    setServer: (s: SaveV1 | null) => {
      server = s;
      serverAt = s ? nextAt() : null;
    },
    getServer: () => ({ snapshot: server, updatedAt: serverAt }),
  };
}

let store: WsStorage;
let events: Array<[string, Record<string, string>]>;

function fakeSlices() {
  return {
    setups: fakeSlice<Record<string, SetupV3>>('setups', {}),
    cages: fakeSlice<SaveV1['cages']>('cages', {}),
    reactions: fakeSlice<SaveReactions>('reactions', emptyReactions()),
    animalType: fakeSlice<string | null>('animalType', null),
  };
}

function deps(api: SaveApi, slices: SaveSlices): SaveSyncDeps {
  return { api, storage: store, slices, track: (n, p) => void events.push([n, p]), now: () => NOW };
}

/** R6 D2: link → (첫 PUT 보류면) 사용자 확인까지 — 연결 이후 동작을 보는 테스트용. */
async function linkC(sync: SaveSync, token: string): Promise<LinkOutcome> {
  const r = await sync.link(token);
  if (r.kind === 'linked' && r.confirm) await sync.confirm();
  return r;
}

beforeEach(() => {
  const b = memBackend();
  store = createStorage(() => b);
  events = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('link', () => {
  it('verify → GET → (로컬 승) 확인 전 PUT 0 · 연결 기록 0 → confirm → PUT, save_link_confirm · save_merge{local}, ws.save linked + lastSyncAt', async () => {
    const { api, order, puts } = fakeApi();
    const slices = fakeSlices();
    slices.animalType.value = 'hamster-golden';
    slices.setups.value = { 'hamster-golden': setup(T2, ['cage']) };
    const sync = createSaveSync(deps(api, slices));
    const r = await sync.link(TOKEN);
    expect(r).toEqual({ kind: 'linked', winner: 'local', confirm: true });
    // R6 D2(SEC-4 L-1(c)): verify 성공 직후 PUT 0 · ws.save 연결 기록 0 · 구독 0 — 변경이 생겨도 PUT 0.
    expect(order).toEqual(['verify', 'get']);
    expect(sync.isAwaitingConfirm()).toBe(true);
    expect(readSaveState(store).linked).toBe(false);
    expect(sync.isRunning()).toBe(false);
    slices.setups.fire();
    await sync.flush();
    expect(order).toEqual(['verify', 'get']);
    expect(await sync.confirm()).toBe(true);
    expect(sync.isAwaitingConfirm()).toBe(false);
    expect(order).toEqual(['verify', 'get', 'put']);
    expect(api.verify).toHaveBeenCalledWith(TOKEN);
    expect(puts[0].setups['hamster-golden'].checks.cage).toBeDefined();
    expect(puts[0].animalTypeId).toBe('hamster-golden');
    expect(events).toEqual([
      ['save_link_confirm', {}],
      ['save_merge', { winner: 'local' }],
    ]);
    expect(readSaveState(store)).toEqual({ v: 1, linked: true, lastSyncAt: NOW });
    expect(sync.isRunning()).toBe(true);
  });

  it('서버 승 → 로컬 import, PUT 없음, save_merge{server}', async () => {
    const { api, order, setServer } = fakeApi();
    setServer({ v: 1, animalTypeId: 'hamster-golden', setups: { 'hamster-golden': setup(T2, ['wheel']) }, cages: {}, reactions: emptyReactions() });
    const slices = fakeSlices();
    const sync = createSaveSync(deps(api, slices));
    expect(await sync.link(TOKEN)).toEqual({ kind: 'linked', winner: 'server', confirm: true });
    expect(order).toEqual(['verify', 'get']);
    // GET 병합(서버 승 레코드 로컬 쓰기)은 확인 전에 끝난다.
    expect(slices.setups.imported).toHaveLength(1);
    expect(slices.animalType.imported).toEqual(['hamster-golden']);
    expect(events.at(-1)).toEqual(['save_merge', { winner: 'server' }]);
    expect(readSaveState(store).linked).toBe(false);
    // 확인 → 연결·구독, 서버본이 이미 다 가졌으니 PUT 0.
    expect(await sync.confirm()).toBe(true);
    expect(order).toEqual(['verify', 'get']);
    expect(readSaveState(store)).toEqual({ v: 1, linked: true, lastSyncAt: NOW });
    expect(sync.isRunning()).toBe(true);
  });

  it('confirmSave: PUT 실패(500·네트워크·413)면 saved 가 아니라 failed — 연결은 유지, 다시 누르면 재시도해 성공 때만 saved', async () => {
    for (const bad of [{ status: 500 }, { status: 0 }, { status: 413 }]) {
      const f = fakeApi();
      let fail = true;
      const real = f.api.putSave;
      f.api.putSave = vi.fn(async (s: SaveV1, b: string | null) => (fail ? bad : real(s, b)));
      const slices = fakeSlices();
      slices.animalType.value = 'hamster-golden';
      slices.setups.value = { 'hamster-golden': setup(T2, ['cage']) };
      const sync = createSaveSync(deps(f.api, slices));
      expect((await sync.link(TOKEN)).kind).toBe('linked');
      expect(await sync.confirmSave()).toBe('failed');
      expect(readSaveState(store).lastSyncAt).toBeNull();
      fail = false;
      expect(await sync.confirmSave()).toBe('saved');
      expect(f.puts).toHaveLength(1);
      sync.stop();
      store.remove(SAVE_STATE_KEY);
    }
  });

  it('confirmSave: 성공 saved · 보류 아님+미연결 expired', async () => {
    const f = fakeApi();
    const slices = fakeSlices();
    slices.animalType.value = 'hamster-golden';
    slices.setups.value = { 'hamster-golden': setup(T2, ['cage']) };
    const sync = createSaveSync(deps(f.api, slices));
    expect(await sync.confirmSave()).toBe('expired');
    await sync.link(TOKEN);
    expect(await sync.confirmSave()).toBe('saved');
  });

  it('로컬에서 지운 케이지(tombstone)는 서버 병합으로 부활하지 않고 PUT 본문에서 빠진다', async () => {
    const f = fakeApi();
    const cageRec = { v: 1 as const, type: 'LIVING_BOX' as const, floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: T1 };
    f.setServer({ v: 1, animalTypeId: 'hamster-golden', setups: {}, cages: { 'hamster-golden': cageRec }, reactions: emptyReactions() });
    const slices = fakeSlices();
    slices.animalType.value = 'hamster-golden';
    const cages = slices.cages as typeof slices.cages & { tombstones: () => Record<string, string> };
    cages.tombstones = () => ({ 'hamster-golden': T2 });
    const sync = createSaveSync(deps(f.api, slices));
    await sync.link(TOKEN);
    expect(slices.cages.imported).toHaveLength(0);
    expect(await sync.confirmSave()).toBe('saved');
    expect(f.puts).toHaveLength(1);
    expect(f.puts[0].cages).toEqual({});
  });

  it('보류 중이 아니면 confirm 은 네트워크 0(지금 연결 상태만)', async () => {
    const { api, order } = fakeApi();
    const sync = createSaveSync(deps(api, fakeSlices()));
    expect(await sync.confirm()).toBe(false);
    expect(order).toEqual([]);
  });

  it('보류 중 새로고침(새 인스턴스) — 연결 기록이 없어 boot·resume 모두 네트워크 0', async () => {
    const { api, order } = fakeApi();
    const slices = fakeSlices();
    slices.setups.value = { a: setup(T2, ['cage']) };
    await createSaveSync(deps(api, slices)).link(TOKEN);
    order.length = 0;
    const again = createSaveSync(deps(api, slices));
    await again.boot();
    await again.resume();
    expect(order).toEqual([]);
  });

  it.each([401, 400])('verify %i → expired, GET 0, 연결 안 됨', async (status) => {
    const { api, order } = fakeApi({ verify: vi.fn(async () => ({ status })) });
    const sync = createSaveSync(deps(api, fakeSlices()));
    expect(await sync.link(TOKEN)).toEqual({ kind: 'expired' });
    expect(order).toEqual([]);
    expect(readSaveState(store).linked).toBe(false);
    expect(events).toEqual([]);
  });

  it('verify 네트워크 오류(0) → error', async () => {
    const { api } = fakeApi({ verify: vi.fn(async () => ({ status: 0 })) });
    expect(await createSaveSync(deps(api, fakeSlices())).link(TOKEN)).toEqual({ kind: 'error' });
  });

  it('같은 토큰 두 번(StrictMode 이중 effect) → verify 1회', async () => {
    const { api } = fakeApi();
    const sync = createSaveSync(deps(api, fakeSlices()));
    const [a, b] = await Promise.all([sync.link(TOKEN), sync.link(TOKEN)]);
    expect(a).toBe(b);
    expect(api.verify).toHaveBeenCalledTimes(1);
  });

  it('GET 실패 → 서버본 받기 전엔 PUT 으로 덮지 않는다; 다음 변경 때 GET 부터', async () => {
    vi.useFakeTimers();
    let fail = true;
    const { api, order } = fakeApi();
    const realGet = api.getSave;
    api.getSave = vi.fn(async () => (fail ? { status: 0, body: null } : realGet()));
    const slices = fakeSlices();
    slices.setups.value = { a: setup(T2) };
    const sync = createSaveSync(deps(api, slices));
    expect(await sync.link(TOKEN)).toEqual({ kind: 'linked', winner: null, confirm: true });
    expect(order).toEqual(['verify']);
    expect(events).toEqual([['save_link_confirm', {}]]);
    // 확인 시점에도 서버본이 없다 → GET 부터(또 실패 → PUT 0, 백오프)
    await sync.confirm();
    expect(api.getSave).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['verify']);
    fail = false;
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_BASE_MS);
    expect(order).toEqual(['verify', 'get', 'put']);
    expect(events.at(-1)).toEqual(['save_merge', { winner: 'local' }]);
  });
});

describe('연결 후 자동 저장', () => {
  it('변경 알림 → 2초 디바운스 PUT 1회(연속 변경은 합친다), 2초 전엔 0', async () => {
    vi.useFakeTimers();
    const { api, puts } = fakeApi();
    const slices = fakeSlices();
    const sync = createSaveSync(deps(api, slices));
    await linkC(sync, TOKEN); // 로컬·서버 모두 빈 상태 → none, PUT 0
    expect(puts).toHaveLength(0);
    expect(events.at(-1)).toEqual(['save_merge', { winner: 'none' }]);

    slices.setups.value = { a: setup(T2, ['cage']) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(1500);
    slices.cages.value = { a: { v: 1, type: 'WIRE', floorWcm: 60, floorDcm: 40, heightCm: 35, barGapMm: 9, updatedAt: T2 } };
    slices.cages.fire();
    await vi.advanceTimersByTimeAsync(1999);
    expect(puts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(puts).toHaveLength(1);
    expect(puts[0].setups.a.checks.cage).toBeDefined();
    expect(puts[0].cages.a.barGapMm).toBe(9);
  });

  it('디바운스 PUT(requestPush)도 케이지 tombstone 을 병합에 써서 서버의 옛 케이지가 PUT 본문에 없다', async () => {
    vi.useFakeTimers();
    const { api, puts, setServer } = fakeApi();
    const cageRec = { v: 1 as const, type: 'LIVING_BOX' as const, floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: T1 };
    setServer({ v: 1, animalTypeId: null, setups: {}, cages: { 'hamster-golden': cageRec }, reactions: emptyReactions() });
    const slices = fakeSlices();
    const cages = slices.cages as typeof slices.cages & { tombstones: () => Record<string, string> };
    const sync = createSaveSync(deps(api, slices));
    await linkC(sync, TOKEN);
    cages.tombstones = () => ({ 'hamster-golden': T2 }); // 연결 뒤 케이지 삭제
    slices.cages.value = {}; // removeCage 는 로컬 레코드도 지운다(연결 시 가져온 케이지 제거)
    slices.setups.value = { mine: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(puts.length).toBeGreaterThan(0);
    expect(puts.at(-1)?.cages).toEqual({});
  });

  it('케이지 삭제 뒤 첫 PUT 이 409 → 재병합(putWithBase)도 tombstone 을 써서 재시도 PUT 본문에 옛 서버 케이지가 없다', async () => {
    vi.useFakeTimers();
    const { api, puts, bases, setServer } = fakeApi();
    const cageRec = { v: 1 as const, type: 'LIVING_BOX' as const, floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: T1 };
    setServer({ v: 1, animalTypeId: null, setups: {}, cages: { 'hamster-golden': cageRec }, reactions: emptyReactions() });
    const slices = fakeSlices();
    const cages = slices.cages as typeof slices.cages & { tombstones: () => Record<string, string> };
    const sync = createSaveSync(deps(api, slices));
    await linkC(sync, TOKEN);
    cages.tombstones = () => ({ 'hamster-golden': T2 }); // 연결 뒤 케이지 삭제
    slices.cages.value = {};
    // 다른 기기가 서버 행을 바꿈(기준 시각이 달라져 첫 PUT 은 409) — 서버본에도 옛 케이지(삭제 시각 T2 이전)가 있다.
    setServer({ v: 1, animalTypeId: null, setups: {}, cages: { 'hamster-golden': { ...cageRec, heightCm: 50 } }, reactions: emptyReactions() });
    slices.setups.value = { mine: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(bases.length).toBeGreaterThanOrEqual(2); // 409 한 번 + 재시도
    expect(puts.length).toBeGreaterThan(0);
    expect(puts.at(-1)?.cages).toEqual({});
    expect(puts.at(-1)?.setups.mine).toBeDefined();
  });

  it('flushOnHide: pagehide · visibilitychange(hidden) 에서만 flush, visible 은 0, 해제 뒤 0, flush 실패는 조용히', async () => {
    const mk = () => {
      const m = new Map<string, Array<() => void>>();
      return {
        visibilityState: 'visible' as string,
        addEventListener: (t: string, f: () => void) => void m.set(t, [...(m.get(t) ?? []), f]),
        removeEventListener: (t: string, f: () => void) => void m.set(t, (m.get(t) ?? []).filter((x) => x !== f)),
        emit: (t: string) => (m.get(t) ?? []).forEach((f) => f()),
      };
    };
    const doc = mk();
    const win = mk();
    const flush = vi.fn(async () => {
      throw new Error('net');
    });
    const off = flushOnHide({ flush }, doc as never, win as never);
    doc.emit('visibilitychange'); // visible → 0
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(0);
    doc.visibilityState = 'hidden';
    doc.emit('visibilitychange');
    win.emit('pagehide');
    await Promise.resolve();
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(2);
    off();
    win.emit('pagehide');
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('디바운스 PUT 은 서버에만 있는 레코드(다른 기기분)를 지우지 않는다', async () => {
    vi.useFakeTimers();
    const { api, puts, setServer } = fakeApi();
    setServer({ v: 1, animalTypeId: null, setups: { other: setup(T1) }, cages: {}, reactions: emptyReactions() });
    const slices = fakeSlices();
    slices.setups.import = () => undefined; // 로컬 쓰기가 거절된 경우
    const sync = createSaveSync(deps(api, slices));
    await linkC(sync, TOKEN);
    slices.setups.value = { mine: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(Object.keys(puts.at(-1)?.setups ?? {}).sort()).toEqual(['mine', 'other']);
  });

  it('PUT 401(세션 만료) → 로컬 연결 해제·구독 중지', async () => {
    vi.useFakeTimers();
    const { api } = fakeApi();
    const slices = fakeSlices();
    const sync = createSaveSync(deps(api, slices));
    await linkC(sync, TOKEN);
    api.putSave = vi.fn(async () => ({ status: 401 }));
    slices.setups.value = { a: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.get(SAVE_STATE_KEY)).toBeNull();
    expect(sync.isRunning()).toBe(false);
  });
});

describe('연결 해제 · resume', () => {
  it('unlink → DELETE /auth/session, ws.save 삭제, 이후 변경에 PUT 0, 로컬 준비 상태 유지', async () => {
    vi.useFakeTimers();
    const { api, order, puts } = fakeApi();
    const slices = fakeSlices();
    slices.setups.value = { a: setup(T2) };
    const sync = createSaveSync(deps(api, slices));
    await linkC(sync, TOKEN);
    const putsBefore = puts.length;
    await sync.unlink();
    expect(order.at(-1)).toBe('logout');
    expect(store.get(SAVE_STATE_KEY)).toBeNull();
    expect(sync.isRunning()).toBe(false);
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(5000);
    expect(puts.length).toBe(putsBefore);
    expect(slices.setups.value.a).toBeDefined();
  });

  it('resume: 연결 안 된 기기 → 네트워크 0', async () => {
    const { api, order } = fakeApi();
    await createSaveSync(deps(api, fakeSlices())).resume();
    expect(order).toEqual([]);
  });

  it('resume: 연결된 기기 → GET·병합·구독, GET 401 → 연결 해제', async () => {
    writeSaveState(store, { linked: true, lastSyncAt: null });
    const ok = fakeApi();
    const s1 = createSaveSync(deps(ok.api, fakeSlices()));
    await s1.resume();
    expect(ok.order).toEqual(['get']);
    expect(s1.isRunning()).toBe(true);

    const gone = fakeApi({ getSave: vi.fn(async () => ({ status: 401, body: null })) });
    const s2 = createSaveSync(deps(gone.api, fakeSlices()));
    writeSaveState(store, { linked: true, lastSyncAt: null });
    await s2.resume();
    expect(store.get(SAVE_STATE_KEY)).toBeNull();
    expect(s2.isRunning()).toBe(false);
  });
});

/** 손으로 여는 응답(응답 순서·동시성 재현). */
function deferred<T>() {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** 두 기기: 기기마다 저장소·조각·동기화, 서버(fakeApi)는 하나. */
function device(api: SaveApi) {
  const b = memBackend();
  const storage = createStorage(() => b);
  const slices = fakeSlices();
  const sync = createSaveSync({ api, storage, slices, track: () => undefined, now: () => NOW });
  return { storage, slices, sync };
}

describe('H1 다기기 — 낙관적 동시성(baseUpdatedAt · 409 병합 1회 재시도)', () => {
  it('기기 A 의 옛 서버본으로 보낸 PUT 이 기기 B 의 새 레코드를 지우지 않는다(409 → 병합 → 재시도)', async () => {
    vi.useFakeTimers();
    const srv = fakeApi();
    const A = device(srv.api);
    const B = device(srv.api);
    A.slices.setups.value = { a: setup(T1) };
    await linkC(A.sync, TOKEN); // 서버 = {a}
    B.slices.setups.value = { b: setup(T1) };
    await linkC(B.sync, `${TOKEN.slice(0, 42)}B`); // B: GET {a} → 병합 {a,b} PUT
    expect(Object.keys(srv.getServer().snapshot?.setups ?? {}).sort()).toEqual(['a', 'b']);
    expect(B.slices.setups.imported.at(-1)).toHaveProperty('a');

    // A 는 아직 서버본 {a} 만 안다 — 로컬 a 를 고친다.
    A.slices.setups.value = { a: setup(T2, ['cage']) };
    A.slices.setups.fire();
    const putsBefore = (srv.api.putSave as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    const calls = (srv.api.putSave as ReturnType<typeof vi.fn>).mock.calls.slice(putsBefore);
    expect(calls).toHaveLength(2); // 409 1번 + 병합 재시도 1번
    const final = srv.getServer().snapshot;
    expect(Object.keys(final?.setups ?? {}).sort()).toEqual(['a', 'b']);
    expect(final?.setups.a.checks.cage).toBeDefined();
    // 409 서버본의 B 레코드는 A 로컬에도 들어온다.
    expect(A.slices.setups.imported.at(-1)).toHaveProperty('b');
    expect(readSaveState(A.storage).lastSyncAt).toBe(NOW);
  });

  it('NIT-2: 409 병합의 자기 import 가 건 디바운스는 같은 본문 PUT 을 또 보내지 않는다 — 실제 로컬 변경 때만 1회', async () => {
    vi.useFakeTimers();
    const srv = fakeApi();
    const A = device(srv.api);
    const B = device(srv.api);
    A.slices.setups.value = { a: setup(T1) };
    await linkC(A.sync, TOKEN);
    B.slices.setups.value = { b: setup(T1) };
    await linkC(B.sync, `${TOKEN.slice(0, 42)}B`);
    // 실제 조각처럼 import 도 구독자를 깨운다.
    const rawImport = A.slices.setups.import;
    A.slices.setups.import = (p) => {
      rawImport(p);
      A.slices.setups.fire();
    };
    const puts = () => (srv.api.putSave as ReturnType<typeof vi.fn>).mock.calls.length;
    const before = puts();
    A.slices.setups.value = { a: setup(T2, ['cage']) };
    A.slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(puts() - before).toBe(2); // 409 + 병합 재시도
    await vi.advanceTimersByTimeAsync(10000); // import 가 건 디바운스가 지나도
    expect(puts() - before).toBe(2);
    A.slices.setups.value = { ...A.slices.setups.value, a: setup('2026-10-05T00:00:00.000Z', ['cage', 'wheel']) };
    A.slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(puts() - before).toBe(3);
  });

  it('F 항목 병합: 같은 동물 레코드에서 A 는 wheel 체크, B 는 cage 해제 → 409 병합 후 PUT 본문에 양쪽 항목', async () => {
    vi.useFakeTimers();
    const srv = fakeApi();
    const A = device(srv.api);
    const B = device(srv.api);
    const start = setup(T1, ['cage']);
    A.slices.setups.value = { a: start };
    await linkC(A.sync, TOKEN); // 서버 = {a: cage ✓}
    B.slices.setups.value = { a: structuredClone(start) };
    await linkC(B.sync, `${TOKEN.slice(0, 42)}B`); // 같은 내용 → PUT 없음

    const tB = '2026-10-03T00:00:00.000Z';
    const tA = '2026-10-04T00:00:00.000Z'; // A 가 더 늦게 바꿨다 — 레코드 LWW 였다면 B 의 해제가 되돌려진다
    B.slices.setups.value = { a: applyToggle(start, 'cage', tB) };
    B.slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000); // B PUT 200(서버 = cage 해제)

    A.slices.setups.value = { a: applyToggle(start, 'wheel', tA) };
    A.slices.setups.fire();
    const putsBefore = (srv.api.putSave as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    const calls = (srv.api.putSave as ReturnType<typeof vi.fn>).mock.calls.slice(putsBefore);
    expect(calls).toHaveLength(2); // 409 → 병합 → 재시도
    const body = calls[1][0] as SaveV1;
    expect(Object.keys(body.setups.a.checks)).toEqual(['wheel']);
    expect(body.setups.a.uncheckedAt).toEqual({ cage: tB });
    expect(body.setups.a.v).toBe(3);
    expect(srv.getServer().snapshot?.setups.a).toEqual(body.setups.a);
    // 병합본은 A 로컬에도 쓰인다(cage 해제가 A 에 내려온다).
    expect(A.slices.setups.imported.at(-1)?.a.checks).toEqual({ wheel: { source: 'UNKNOWN', at: tA } });
  });

  it('PUT 은 마지막으로 본 서버 행 시각을 싣는다 — 첫 PUT(행 없음) null, 다음은 직전 200 의 updatedAt', async () => {
    vi.useFakeTimers();
    const srv = fakeApi();
    const slices = fakeSlices();
    slices.setups.value = { a: setup(T1) };
    const sync = createSaveSync(deps(srv.api, slices));
    await linkC(sync, TOKEN);
    expect(srv.bases).toEqual([null]);
    const at1 = srv.getServer().updatedAt;
    slices.setups.value = { a: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(srv.bases).toEqual([null, at1]);
  });

  it('재시도도 409 → 그 PUT 은 2번에서 멈추고(무한 루프 0) 백오프 후 GET 부터 다시', async () => {
    vi.useFakeTimers();
    const srv = fakeApi();
    const slices = fakeSlices();
    const sync = createSaveSync(deps(srv.api, slices));
    await linkC(sync, TOKEN);
    let n = 0;
    srv.api.putSave = vi.fn(async () => {
      n++;
      return { status: 409, current: { snapshot: null, updatedAt: `2026-11-01T00:00:0${n}.000Z` } };
    });
    srv.order.length = 0;
    slices.setups.value = { a: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(srv.api.putSave).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_BASE_MS - 1);
    expect(srv.api.putSave).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(srv.order[0]).toBe('get'); // 재시도는 PUT 이 아니라 GET 부터(pulled=false)
    expect(srv.api.putSave).toHaveBeenCalledTimes(4); // GET 후 병합 PUT → 409 → 1회 재시도, 그 뒤 다시 백오프
  });
});

describe('fetchSaveApi.putSave 계약(H1)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const snap: SaveV1 = { v: 1, animalTypeId: null, setups: {}, cages: {}, reactions: emptyReactions() };

  it('본문 {snapshot, baseUpdatedAt} · 200 → updatedAt · 409 → current(서버본) · 204 → updatedAt 없음', async () => {
    const replies: Array<[number, unknown]> = [
      [200, { updatedAt: T2 }],
      [409, { error: 'conflict', snapshot: snap, updatedAt: T1 }],
      [204, null],
    ];
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_p: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        const [status, body] = replies.shift() as [number, unknown];
        return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const { fetchSaveApi } = await import('./api');
    expect(await fetchSaveApi.putSave(snap, null)).toEqual({ status: 200, updatedAt: T2 });
    expect(await fetchSaveApi.putSave(snap, T1)).toEqual({ status: 409, current: { snapshot: snap, updatedAt: T1 } });
    expect(await fetchSaveApi.putSave(snap, T2)).toEqual({ status: 204 });
    expect(bodies).toEqual([
      { snapshot: snap, baseUpdatedAt: null },
      { snapshot: snap, baseUpdatedAt: T1 },
      { snapshot: snap, baseUpdatedAt: T2 },
    ]);
  });
});

describe('M3 PUT 직렬화', () => {
  it('PUT 진행 중 변경은 대기 1개로 합쳐 완료 후 1번 더 — 동시에 둘 이상 0, 늦게 온 응답이 새 기준을 덮지 않는다', async () => {
    vi.useFakeTimers();
    const srv = fakeApi();
    const slices = fakeSlices();
    const sync = createSaveSync(deps(srv.api, slices));
    await linkC(sync, TOKEN);
    const real = srv.api.putSave;
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const sent: SaveV1[] = [];
    srv.api.putSave = vi.fn(async (s: SaveV1, base: string | null) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      sent.push(structuredClone(s));
      const g = deferred<void>();
      gates.push(g);
      await g.promise;
      inFlight--;
      return real(s, base);
    });
    slices.setups.value = { a: setup(T2, ['cage']) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000); // PUT 1 출발(응답 대기)
    expect(sent).toHaveLength(1);
    for (const id of ['wheel', 'water']) {
      slices.setups.value = { a: setup(T2, ['cage', id]) };
      slices.setups.fire();
      await vi.advanceTimersByTimeAsync(2000); // 디바운스 만료 — 그래도 PUT 2 는 출발하지 않는다
    }
    expect(sent).toHaveLength(1);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(2); // 합친 1개
    expect(sent[1].setups.a.checks.water).toBeDefined();
    gates[1].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(maxInFlight).toBe(1);
    expect(srv.getServer().snapshot?.setups.a.checks.water).toBeDefined();
    // 두 번째 PUT 도 409 없이 통과 = 첫 응답의 기준 시각을 이어받았다
    expect(srv.puts.at(-1)?.setups.a.checks.water).toBeDefined();
    expect(srv.api.putSave).toHaveBeenCalledTimes(2);
  });

  it('GET(resume) 진행 중 flush → PUT 은 GET·병합이 끝난 뒤에만', async () => {
    vi.useFakeTimers();
    writeSaveState(store, { linked: true, lastSyncAt: null });
    const srv = fakeApi();
    srv.setServer({ v: 1, animalTypeId: null, setups: { other: setup(T1) }, cages: {}, reactions: emptyReactions() });
    const realGet = srv.api.getSave;
    const g = deferred<void>();
    srv.api.getSave = vi.fn(async () => {
      srv.order.push('get-start');
      await g.promise;
      return realGet();
    });
    const slices = fakeSlices();
    slices.setups.import = () => undefined;
    const sync = createSaveSync(deps(srv.api, slices));
    const resuming = sync.resume();
    // 아직 pulled 전 — 이 시점 변경은 대기 PUT 로 줄 선다
    await vi.advanceTimersByTimeAsync(0);
    expect(srv.order).toEqual(['get-start']);
    g.resolve();
    await resuming;
    slices.setups.value = { mine: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(srv.order.indexOf('put')).toBeGreaterThan(srv.order.indexOf('get'));
    expect(Object.keys(srv.puts.at(-1)?.setups ?? {}).sort()).toEqual(['mine', 'other']);
  });
});

describe('M4 link 실패', () => {
  it.each([0, 500, 503, 429])('verify %i → error, 캐시에서 빠져 같은 토큰으로 다시 누르면 실제로 다시 보낸다', async (status) => {
    let s = status;
    const { api } = fakeApi({ verify: vi.fn(async () => ({ status: s })) });
    const sync = createSaveSync(deps(api, fakeSlices()));
    expect(await sync.link(TOKEN)).toEqual({ kind: 'error' });
    expect(readSaveState(store).linked).toBe(false);
    s = 200;
    expect(await sync.link(TOKEN)).toMatchObject({ kind: 'linked' });
    expect(api.verify).toHaveBeenCalledTimes(2);
  });

  it('verify 410 → expired', async () => {
    const { api } = fakeApi({ verify: vi.fn(async () => ({ status: 410 })) });
    expect(await createSaveSync(deps(api, fakeSlices())).link(TOKEN)).toEqual({ kind: 'expired' });
  });

  it('연결 성공은 캐시 — 같은 토큰 재호출에 verify 1회', async () => {
    const { api } = fakeApi();
    const sync = createSaveSync(deps(api, fakeSlices()));
    await linkC(sync, TOKEN);
    await linkC(sync, TOKEN);
    expect(api.verify).toHaveBeenCalledTimes(1);
  });
});

describe('M5 다른 탭 해제·재연결(세대)', () => {
  it('다른 탭 해제 → 구독 중지·PUT 0, 다시 연결 → 새 서버본 GET 뒤에만 PUT(그 계정 기준 시각)', async () => {
    vi.useFakeTimers();
    const srv = fakeApi();
    const slices = fakeSlices();
    slices.setups.value = { a: setup(T1) };
    const sync = createSaveSync(deps(srv.api, slices));
    await linkC(sync, TOKEN);
    expect(sync.isRunning()).toBe(true);
    clearSaveState(store); // 다른 탭: 연결 해제
    expect(sync.isRunning()).toBe(false);
    slices.setups.value = { a: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(5000);
    srv.order.length = 0;
    // 다른 탭: 다른 계정으로 연결 — 서버본이 바뀌었다
    srv.setServer({ v: 1, animalTypeId: null, setups: { acct2: setup(T1) }, cages: {}, reactions: emptyReactions() });
    const at2 = srv.getServer().updatedAt;
    writeSaveState(store, { linked: true, lastSyncAt: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(srv.order[0]).toBe('get');
    expect(srv.bases.at(-1)).toBe(at2);
    expect(sync.isRunning()).toBe(true);
    expect(Object.keys(srv.getServer().snapshot?.setups ?? {}).sort()).toEqual(['a', 'acct2']);
  });

  it('PUT 응답 대기 중 다른 탭 해제 → 응답이 와도 ws.save 를 다시 쓰지 않는다', async () => {
    vi.useFakeTimers();
    const srv = fakeApi();
    const slices = fakeSlices();
    const sync = createSaveSync(deps(srv.api, slices));
    await linkC(sync, TOKEN);
    const real = srv.api.putSave;
    const g = deferred<void>();
    srv.api.putSave = vi.fn(async (s: SaveV1, b: string | null) => {
      await g.promise;
      return real(s, b);
    });
    slices.setups.value = { a: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    clearSaveState(store);
    g.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get(SAVE_STATE_KEY)).toBeNull();
  });

  it('PUT 응답 대기 중 해제→재연결 → 옛 연결의 200 응답은 버린다(새 연결을 "동기화됨"으로 표시하지 않고, 그 기준 시각도 안 씀)', async () => {
    vi.useFakeTimers();
    const srv = fakeApi();
    const slices = fakeSlices();
    const sync = createSaveSync(deps(srv.api, slices));
    await linkC(sync, TOKEN);
    const real = srv.api.putSave;
    const g = deferred<void>();
    srv.api.putSave = vi.fn(async (s: SaveV1, b: string | null) => {
      await g.promise;
      return real(s, b);
    });
    slices.setups.value = { a: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    clearSaveState(store);
    srv.api.getSave = vi.fn(async () => ({ status: 0, body: null })); // 새 연결의 GET 은 실패 → lastSyncAt 을 쓸 수 있는 건 옛 PUT 응답뿐
    writeSaveState(store, { linked: true, lastSyncAt: null });
    g.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(readSaveState(store)).toEqual({ v: 1, linked: true, lastSyncAt: null });
  });

  it('probe 대기 중 해제 → 재연결(둘 다 linked) → 옛 "연결 아님" 응답은 stale(null), 새 연결 유지', async () => {
    writeSaveState(store, { linked: true, lastSyncAt: null });
    const g = deferred<void>();
    const { api } = fakeApi({
      session: vi.fn(async () => {
        await g.promise;
        return { status: 200, linked: false };
      }),
    });
    const sync = createSaveSync(deps(api, fakeSlices()));
    const pending = sync.probe();
    await Promise.resolve();
    clearSaveState(store);
    writeSaveState(store, { linked: true, lastSyncAt: null });
    g.resolve();
    expect(await pending).toBeNull();
    expect(readSaveState(store).linked).toBe(true);
  });
});

describe('M6 PUT 실패 백오프', () => {
  it.each([503, 429, 0])('PUT %i → 5s·10s·20s·40s·80s 최대 5회 재시도 후 멈춤, lastSyncAt 은 성공 때만', async (status) => {
    vi.useFakeTimers();
    const srv = fakeApi();
    const slices = fakeSlices();
    const sync = createSaveSync(deps(srv.api, slices));
    writeSaveState(store, { linked: true, lastSyncAt: null });
    await sync.resume();
    srv.api.putSave = vi.fn(async () => ({ status }));
    slices.setups.value = { a: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(srv.api.putSave).toHaveBeenCalledTimes(1);
    let expected = 1;
    for (let i = 0; i < SAVE_RETRY_MAX_ATTEMPTS; i++) {
      const delay = SAVE_RETRY_BASE_MS * 2 ** i;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(srv.api.putSave).toHaveBeenCalledTimes(expected);
      await vi.advanceTimersByTimeAsync(1);
      expected++;
      expect(srv.api.putSave).toHaveBeenCalledTimes(expected);
    }
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(srv.api.putSave).toHaveBeenCalledTimes(1 + SAVE_RETRY_MAX_ATTEMPTS);
    expect(readSaveState(store).lastSyncAt).toBe(NOW); // resume 의 GET 성공 시각 그대로(실패는 갱신 0)
  });

  it('백오프 중 로컬 변경은 디바운스로 앞당기지 않고, 재시도가 최신 로컬을 실어 성공하면 lastSyncAt 갱신', async () => {
    vi.useFakeTimers();
    const srv = fakeApi();
    const slices = fakeSlices();
    let t = NOW;
    const sync = createSaveSync({ ...deps(srv.api, slices), now: () => t });
    writeSaveState(store, { linked: true, lastSyncAt: null });
    await sync.resume();
    const real = srv.api.putSave;
    let fail = true;
    srv.api.putSave = vi.fn(async (s: SaveV1, b: string | null) => (fail ? { status: 503 } : real(s, b)));
    slices.setups.value = { a: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    slices.setups.value = { a: setup(T2, ['late']) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(srv.api.putSave).toHaveBeenCalledTimes(1);
    fail = false;
    t = '2026-10-12T01:00:00.000Z';
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_BASE_MS - 2000);
    expect(srv.api.putSave).toHaveBeenCalledTimes(2);
    expect(srv.puts.at(-1)?.setups.a.checks.late).toBeDefined();
    expect(readSaveState(store).lastSyncAt).toBe(t);
  });

  it('PUT 400(같은 본문이면 또 거절) → 재시도 0', async () => {
    vi.useFakeTimers();
    const srv = fakeApi();
    const slices = fakeSlices();
    const sync = createSaveSync(deps(srv.api, slices));
    await linkC(sync, TOKEN);
    srv.api.putSave = vi.fn(async () => ({ status: 400 }));
    slices.setups.value = { a: setup(T2) };
    slices.setups.fire();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(srv.api.putSave).toHaveBeenCalledTimes(1);
  });
});

// 퍼즈 — 실제 스토어. 서버본에 금지 키·이메일을 섞어도 로컬 ws.* 에는 토큰·이메일·금지 키 0.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EMAIL_RE = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/;
const POISON: Record<string, unknown> = { email: EMAIL, token: TOKEN, sid: 'abc', ws_sid: 'x', region: '강남구', address: '서울', q: '검색' };

describe('퍼즈: 연결·병합·변경 반복 후 ws.* 에 토큰·이메일·금지 키 0', () => {
  it.each([3, 11, 2026])('seed %i', async (seed) => {
    vi.useFakeTimers();
    const r = rng(seed);
    const backend = memBackend();
    store = createStorage(() => backend);
    const slices = defaultSlices(store);
    const { api, setServer } = fakeApi();
    const sync = createSaveSync(deps(api, slices));
    const types = ['hamster-golden', 'gerbil', 'budgie'];
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    const poison = (o: Record<string, unknown>) => {
      const out = { ...o };
      if (r() < 0.6) {
        const k = pick(Object.keys(POISON));
        out[k] = POISON[k];
      }
      return out;
    };
    for (let i = 0; i < 40; i++) {
      const t = pick(types);
      const op = Math.floor(r() * 4);
      if (op === 0) {
        setServer({
          v: 1,
          animalTypeId: pick([...types, null]),
          setups: { [t]: poison({ ...setup(new Date(Date.UTC(2026, 9, 1 + Math.floor(r() * 20))).toISOString(), ['cage']) }) as never },
          cages: { [t]: poison({ v: 1, type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: T2 }) as never },
          reactions: poison({ like: { p1: T2 }, helpful: {}, updatedAt: T2 }) as never,
        });
        await sync.unlink();
        await linkC(sync, `${TOKEN.slice(0, 40)}${i.toString().padStart(3, '0')}`);
      } else if (op === 1) {
        slices.setups.import({ [t]: applyToggle(readSetup(store, t), pick(['cage', 'wheel', 'water']), new Date(Date.UTC(2026, 9, 5, i)).toISOString()) });
        await vi.advanceTimersByTimeAsync(2000);
      } else if (op === 2) {
        slices.reactions.import(poison({ like: { p2: T1 }, helpful: { 'SUPPLY_ITEM:wheel': T1 }, updatedAt: T1 }) as never);
      } else {
        await sync.flush();
      }
    }
    const keys = store.keys();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.startsWith('ws.setup.'))).toBe(true);
    for (const k of keys) {
      const raw = backend.getItem(k) as string;
      expect(raw, k).not.toContain(TOKEN.slice(0, 40));
      expect(raw, k).not.toMatch(EMAIL_RE);
      const seen: string[] = [];
      try {
        JSON.parse(raw, (key, v) => {
          seen.push(key.toLowerCase());
          return v;
        });
      } catch {
        continue;
      }
      for (const key of seen) expect(FORBIDDEN_KEYS.has(key) || key === 'ws_sid', `${k} → ${key}`).toBe(false);
    }
  });
});

describe('boot(F3-3) — GET /auth/session 1회', () => {
  it('연결 기록 없는 기기 → 네트워크 0', async () => {
    const { api, order } = fakeApi();
    await createSaveSync(deps(api, fakeSlices())).boot();
    expect(api.session).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('연결 기록 + 세션 linked → session 1회 → GET(병합)·구독', async () => {
    writeSaveState(store, { linked: true, lastSyncAt: null });
    const { api, order } = fakeApi();
    const sync = createSaveSync(deps(api, fakeSlices()));
    await sync.boot();
    expect(api.session).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['get']);
    expect(sync.isRunning()).toBe(true);
  });

  it.each([
    ['200 linked:false', { status: 200, linked: false }],
    ['401', { status: 401, linked: false }],
  ])('연결 기록 + 세션 %s → 로컬 해제, GET 0', async (_l, res) => {
    writeSaveState(store, { linked: true, lastSyncAt: null });
    const { api, order } = fakeApi({ session: vi.fn(async () => res) });
    const sync = createSaveSync(deps(api, fakeSlices()));
    await sync.boot();
    expect(store.get(SAVE_STATE_KEY)).toBeNull();
    expect(order).toEqual([]);
    expect(sync.isRunning()).toBe(false);
  });
});

describe('SEC-3 M-1 · L-3', () => {
  it('link 결과에 verify 의 maskedEmail(표시 전용) — ws.save 에는 0', async () => {
    const { api } = fakeApi({ verify: vi.fn(async () => ({ status: 200, maskedEmail: 'k***@e***.com' })) });
    const r = await createSaveSync(deps(api, fakeSlices())).link(TOKEN);
    expect(r).toMatchObject({ kind: 'linked', maskedEmail: 'k***@e***.com' });
    expect(store.get(SAVE_STATE_KEY)).not.toContain('@');
  });

  it.each([0, 500])('unlink DELETE 실패(%i) → {linked:false, pendingLogout:true} 남김 → boot 가 재시도 → 성공 시 삭제', async (status) => {
    let del = status;
    const { api } = fakeApi({ logout: vi.fn(async () => ({ status: del })) });
    const sync = createSaveSync(deps(api, fakeSlices()));
    writeSaveState(store, { linked: true, lastSyncAt: NOW });
    await sync.unlink();
    expect(readSaveState(store)).toEqual({ v: 1, linked: false, lastSyncAt: null, pendingLogout: true });
    del = 204;
    await sync.boot();
    expect(api.logout).toHaveBeenCalledTimes(2);
    expect(api.session).not.toHaveBeenCalled();
    expect(store.get(SAVE_STATE_KEY)).toBeNull();
  });

  it('pendingLogout 재시도 401(이미 세션 없음)도 완료로 본다', async () => {
    const { api } = fakeApi({ logout: vi.fn(async () => ({ status: 401 })) });
    writeSaveState(store, { linked: false, lastSyncAt: null, pendingLogout: true });
    await createSaveSync(deps(api, fakeSlices())).boot();
    expect(store.get(SAVE_STATE_KEY)).toBeNull();
  });

  it('probe: 연결 기록 없음 + 서버 linked → {linked:true, maskedEmail}, 로컬 변경 0; adopt → 연결·GET', async () => {
    const { api, order } = fakeApi({ session: vi.fn(async () => ({ status: 200, linked: true, maskedEmail: 'k***@e***.com' })) });
    const sync = createSaveSync(deps(api, fakeSlices()));
    expect(await sync.probe()).toEqual({ linked: true, maskedEmail: 'k***@e***.com' });
    expect(store.get(SAVE_STATE_KEY)).toBeNull();
    await sync.adopt();
    expect(readSaveState(store).linked).toBe(true);
    expect(order).toEqual(['get']);
    expect(api.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['200 linked:false', { status: 200, linked: false }],
    ['401', { status: 401, linked: false }],
  ])('probe: 로컬 linked 그대로 + 서버 %s → 로컬 해제·구독 중지, {linked:false}', async (_l, res) => {
    writeSaveState(store, { linked: true, lastSyncAt: null });
    const { api } = fakeApi();
    const sync = createSaveSync(deps(api, fakeSlices()));
    await sync.resume();
    expect(sync.isRunning()).toBe(true);
    api.session = vi.fn(async () => res);
    expect(await sync.probe()).toEqual({ linked: false });
    expect(store.get(SAVE_STATE_KEY)).toBeNull();
    expect(sync.isRunning()).toBe(false);
  });

  it('probe 경쟁: 미연결에서 probe 대기 중 다른 탭이 연결 → 오래된 linked:false 응답이 연결을 되돌리지 않는다(null)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { api } = fakeApi({
      session: vi.fn(async () => {
        await gate;
        return { status: 200, linked: false };
      }),
    });
    const sync = createSaveSync(deps(api, fakeSlices()));
    const pending = sync.probe();
    await Promise.resolve();
    expect(api.session).toHaveBeenCalledTimes(1);
    // 다른 탭이 연결(ws.save linked=true 기록) — 응답 도착 전.
    writeSaveState(store, { linked: true, lastSyncAt: null });
    release();
    expect(await pending).toBeNull();
    expect(readSaveState(store)).toEqual({ v: 1, linked: true, lastSyncAt: null });
  });

  it('probe: 네트워크 오류 → null, 로컬 그대로', async () => {
    writeSaveState(store, { linked: true, lastSyncAt: null });
    const { api } = fakeApi({ session: vi.fn(async () => ({ status: 0, linked: false })) });
    expect(await createSaveSync(deps(api, fakeSlices())).probe()).toBeNull();
    expect(readSaveState(store).linked).toBe(true);
  });
});

describe('P1 MAJOR-1 빈 기기 연결 — 빈 행 생성 금지', () => {
  it('로컬 비어 있음 + 서버 행 없음 → PUT 0, linked.empty, 연결·구독은 유지; 첫 로컬 변경 때 디바운스 PUT 이 행을 만든다', async () => {
    vi.useFakeTimers();
    const { api, order, puts, bases } = fakeApi();
    const slices = fakeSlices();
    const sync = createSaveSync({ ...deps(api, slices), debounceMs: 2000 });
    const r = await sync.link(TOKEN);
    expect(r).toMatchObject({ kind: 'linked', empty: true });
    expect(order).toEqual(['verify', 'get']);
    expect(puts).toHaveLength(0);
    expect(readSaveState(store).linked).toBe(true);
    expect(sync.isRunning()).toBe(true);
    slices.animalType.value = 'hamster-golden';
    slices.animalType.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(puts).toHaveLength(1);
    expect(puts[0].animalTypeId).toBe('hamster-golden');
    expect(bases).toEqual([null]);
  });

  it('로컬 비어 있음 + 서버 행은 있으나 빈 스냅샷 → PUT 0, linked.empty', async () => {
    const { api, order, setServer } = fakeApi();
    setServer({ v: 1, animalTypeId: null, setups: {}, cages: {}, reactions: emptyReactions() });
    const r = await createSaveSync(deps(api, fakeSlices())).link(TOKEN);
    expect(r).toMatchObject({ kind: 'linked', empty: true });
    expect(order).toEqual(['verify', 'get']);
  });

  it('로컬 비어 있음 + 서버 저장본 있음 → 불러오기(winner server), empty 없음, PUT 0', async () => {
    const { api, order, setServer } = fakeApi();
    setServer({ v: 1, animalTypeId: 'hamster-golden', setups: {}, cages: {}, reactions: emptyReactions() });
    const sync = createSaveSync(deps(api, fakeSlices()));
    const r = await sync.link(TOKEN);
    // 서버본이 있으면 빈 기기가 아니다 — 확인 화면을 거친다(이후 로컬 변경이 그 계정에 저장되므로).
    expect(r).toEqual({ kind: 'linked', winner: 'server', confirm: true });
    expect(order).toEqual(['verify', 'get']);
    await sync.confirm();
    expect(order).toEqual(['verify', 'get']);
  });

  it('로컬 있음(동물만 선택) + 서버 행 없음 → 확인 뒤 PUT, empty 없음', async () => {
    const { api, order, puts } = fakeApi();
    const slices = fakeSlices();
    slices.animalType.value = 'hamster-golden';
    const sync = createSaveSync(deps(api, slices));
    const r = await sync.link(TOKEN);
    expect(r).toEqual({ kind: 'linked', winner: 'local', confirm: true });
    expect(order).toEqual(['verify', 'get']);
    await sync.confirm();
    expect(order).toEqual(['verify', 'get', 'put']);
    expect(puts[0].animalTypeId).toBe('hamster-golden');
  });

  it('반응만 있는 기기(키 1개)도 비어 있지 않다 → 확인 뒤 PUT', async () => {
    const { api, puts } = fakeApi();
    const slices = fakeSlices();
    slices.reactions.value = { like: { p1: T1 }, helpful: {}, updatedAt: T1 };
    const sync = createSaveSync(deps(api, slices));
    const r = await sync.link(TOKEN);
    expect(r).not.toHaveProperty('empty');
    expect(puts).toHaveLength(0);
    await sync.confirm();
    expect(puts).toHaveLength(1);
  });
});
