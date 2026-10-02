// 준비 상태 저장(계약 C-1 ws.setup.{typeId}). 금지: 이메일·토큰·좌표·지역·자유 질의(불변식 ⑧ — storage 가 쓰기 거부).
//   - 모든 값은 v 를 갖는다. 읽기 = migrate(업그레이더 표) → 미지 v·파싱 실패·형태 깨짐이면 원본을 .bak 1개로 옮기고 null.
//   - 쓰기는 항상 최신 v. 해제 = checks 에서 키 삭제. PURCHASED 는 R5(외부 검색 복귀)에서 쓴다.
//   - 이벤트는 여기서 보내지 않는다(priority 등 문맥은 호출부 L2/L3 가 안다).
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { isWsId, wsStorage, type WsStorage } from '../lib/storage';

export type ReadySource = 'OWNED' | 'PURCHASED' | 'UNKNOWN';

export interface SetupV1 {
  v: 1;
  firstTime: boolean | null;
  owned: string[];
  /** null = L3 전. */
  answeredAt: string | null;
  startedAt: string;
  checks: Record<string, { source: ReadySource; at: string }>;
  reached100At: string | null;
}

export interface SetupAnswer {
  firstTime: boolean | null;
  owned: string[];
}

export interface SetupHandle {
  setup: SetupV1 | null;
  answer(a: SetupAnswer): void;
  toggle(itemId: string): void;
  reset(): void;
  /** 답 없이 시작(L3 건너뛰기) — setup 이 없을 때만 L3 전 상태(answeredAt null)로 만든다. */
  start(): void;
  /** REQUIRED 100% 도달 기록. 처음 기록할 때만 true(setup_100_reached 1회 판정). */
  markReached100(): boolean;
}

const SETUP_VERSION = 1;
const READY_SOURCES: readonly ReadySource[] = ['OWNED', 'PURCHASED', 'UNKNOWN'];

export function setupKey(typeId: string): string {
  if (!isWsId(typeId)) throw new Error(`setupStore: 잘못된 typeId: ${String(typeId)}`);
  return `ws.setup.${typeId}`;
}

const isStr = (x: unknown): x is string => typeof x === 'string';
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);

/** v1 형태 검증 + 정규화(알려진 필드만 새 객체로, 잘못된 check 행은 버린다). 형태가 깨졌으면 null. */
function normalizeV1(x: Record<string, unknown>): SetupV1 | null {
  const { firstTime, owned, answeredAt, startedAt, checks, reached100At } = x;
  if (!(firstTime === null || typeof firstTime === 'boolean')) return null;
  if (!Array.isArray(owned)) return null;
  if (!(answeredAt === null || isStr(answeredAt))) return null;
  if (!isStr(startedAt)) return null;
  if (!isObj(checks)) return null;
  if (!(reached100At === null || isStr(reached100At))) return null;
  const outChecks: SetupV1['checks'] = {};
  for (const [id, c] of Object.entries(checks)) {
    if (!isWsId(id) || !isObj(c)) continue;
    if (!READY_SOURCES.includes(c.source as ReadySource) || !isStr(c.at)) continue;
    outChecks[id] = { source: c.source as ReadySource, at: c.at };
  }
  return {
    v: 1,
    firstTime,
    owned: [...new Set(owned.filter(isWsId))],
    answeredAt,
    startedAt,
    checks: outChecks,
    reached100At,
  };
}

/** 업그레이더 표: from v → 다음 v 의 원시 객체. v1 이 최초 버전이라 아직 비어 있다. */
const UPGRADERS: Readonly<Record<number, (prev: Record<string, unknown>) => Record<string, unknown>>> = {};

export function migrateSetup(raw: unknown): SetupV1 | null {
  if (!isObj(raw)) return null;
  let cur: Record<string, unknown> = raw;
  for (let guard = 0; guard < 16; guard++) {
    const v = cur.v;
    if (v === SETUP_VERSION) return normalizeV1(cur);
    if (typeof v !== 'number' || !Object.prototype.hasOwnProperty.call(UPGRADERS, v)) return null;
    cur = UPGRADERS[v](cur);
  }
  return null;
}

/** 원문 → SetupV1. 실패 시 원본을 .bak 으로 옮기고(최신 1개) null. */
function parseRaw(storage: WsStorage, key: string, raw: string): SetupV1 | null {
  let parsed: unknown;
  let ok = true;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ok = false;
  }
  const m = ok ? migrateSetup(parsed) : null;
  if (m) return m;
  try {
    storage.set(`${key}.bak`, raw);
  } catch {
    // 원본에 금지 키가 섞여 있으면 .bak 에도 남기지 않는다(불변식 ⑧).
  }
  storage.remove(key);
  return null;
}

export function readSetup(storage: WsStorage, typeId: string): SetupV1 | null {
  const key = setupKey(typeId);
  const raw = storage.get(key);
  return raw === null ? null : parseRaw(storage, key, raw);
}

export function writeSetup(storage: WsStorage, typeId: string, s: SetupV1): void {
  storage.set(setupKey(typeId), JSON.stringify(s));
}

function fresh(now: string): SetupV1 {
  return { v: 1, firstTime: null, owned: [], answeredAt: null, startedAt: now, checks: {}, reached100At: null };
}

/** L3 2질문 답. 보유 항목은 OWNED ✓(이미 ✓ 면 유지), 빠진 보유 항목의 OWNED ✓ 는 해제. */
export function applyAnswer(prev: SetupV1 | null, a: SetupAnswer, now: string): SetupV1 {
  const base = prev ?? fresh(now);
  const owned = [...new Set(a.owned.filter(isWsId))];
  const checks: SetupV1['checks'] = {};
  for (const [id, c] of Object.entries(base.checks)) {
    if (c.source === 'OWNED' && !owned.includes(id)) continue;
    checks[id] = c;
  }
  for (const id of owned) if (!checks[id]) checks[id] = { source: 'OWNED', at: now };
  return { ...base, firstTime: a.firstTime, owned, answeredAt: now, checks };
}

/** 체크 토글: 없으면 UNKNOWN ✓, 있으면 해제(키 삭제). setup 이 없으면 L3 전 상태로 만든다. */
export function applyToggle(prev: SetupV1 | null, itemId: string, now: string): SetupV1 {
  const base = prev ?? fresh(now);
  const checks = { ...base.checks };
  if (checks[itemId]) delete checks[itemId];
  else checks[itemId] = { source: 'UNKNOWN', at: now };
  return { ...base, checks };
}

export function applyReached100(prev: SetupV1, now: string): SetupV1 {
  return prev.reached100At ? prev : { ...prev, reached100At: now };
}

// ── 같은 탭 구독(같은 typeId 를 보는 훅끼리 동기) + 다른 탭(storage 이벤트) ──
const listeners = new Map<string, Set<() => void>>();

function emit(key: string): void {
  for (const l of [...(listeners.get(key) ?? [])]) l();
}

function subscribeKey(key: string, l: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(l);
  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || e.key === key) l();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    set?.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

const nowIso = (): string => new Date().toISOString();
const noop = (): void => undefined;

export interface UseSetupOptions {
  /** 테스트 주입용. 기본 = 브라우저 localStorage(실패 시 메모리). */
  storage?: WsStorage;
}

export function useSetup(typeId: string, opts: UseSetupOptions = {}): SetupHandle {
  const storage = opts.storage ?? wsStorage;
  const key = isWsId(typeId) ? setupKey(typeId) : null;
  const cache = useRef<{ raw: string | null; value: SetupV1 | null }>({ raw: null, value: null });

  const subscribe = useCallback((l: () => void) => (key ? subscribeKey(key, l) : noop), [key]);
  const getSnapshot = useCallback((): SetupV1 | null => {
    if (!key) return null;
    const raw = storage.get(key);
    if (raw === cache.current.raw) return cache.current.value;
    const value = raw === null ? null : parseRaw(storage, key, raw);
    cache.current = { raw: value === null ? null : raw, value };
    return value;
  }, [key, storage]);
  const setup = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo<SetupHandle>(() => {
    const current = (): SetupV1 | null => (key && typeId ? readSetup(storage, typeId) : null);
    const commit = (next: SetupV1): void => {
      if (!key) return;
      writeSetup(storage, typeId, next);
      emit(key);
    };
    return {
      setup,
      answer: (a) => {
        if (key) commit(applyAnswer(current(), a, nowIso()));
      },
      toggle: (itemId) => {
        if (key && isWsId(itemId)) commit(applyToggle(current(), itemId, nowIso()));
      },
      reset: () => {
        if (!key) return;
        storage.remove(key);
        emit(key);
      },
      start: () => {
        if (key && current() === null) commit(fresh(nowIso()));
      },
      markReached100: () => {
        const prev = current();
        if (!prev || prev.reached100At) return false;
        commit(applyReached100(prev, nowIso()));
        return true;
      },
    };
  }, [setup, key, typeId, storage]);
}
