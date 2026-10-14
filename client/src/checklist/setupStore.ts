// 준비 상태 저장(계약 C-R5-1 ws.setup.{typeId} · 레인 F SetupV3). 금지: 이메일·토큰·좌표·지역·자유 질의(불변식 ⑧ — storage 가 쓰기 거부).
//   - 모든 값은 v 를 갖는다. 읽기 = migrate(업그레이더 표 v1→v2→v3) → 미지 v·파싱 실패·형태 깨짐이면 원본을 .bak 1개로 옮기고 null.
//   - 쓰기는 항상 최신 v(3). 사용자 변경(답·체크·해제·준비했어요)은 updatedAt 을 갱신한다. reached100 기록은 갱신하지 않는다
//     (L2 열기만으로 레코드가 '새것'이 되지 않게 — 병합은 항목 단위라 updatedAt 을 판정에 쓰지 않는다, merge.ts).
//   - 해제 = checks 에서 키 삭제 + uncheckedAt[id] = 해제 시각(tombstone). L3 재답변으로 빠지는 OWNED ✓ 도 같다.
//     쓰기 시 정리(tidySetup): 같은 id 의 더 새 체크가 있으면 tombstone 제거, 90일 초과 제거, 200 상한 초과 시 오래된 것부터.
//   - R6 D1 상한: checks·owned·uncheckedAt 각 ≤200(서버 검증기 @ws/save-validate MAX_CHECKS·MAX_OWNED·MAX_UNCHECKED 와 같은 값).
//     초과 시 오래된 것부터 정리(checks = at 오래된 것, owned = 배열 앞쪽, uncheckedAt = 시각 오래된 것) — 넘친 레코드 1개로 PUT 전체가
//     400 이 되어 동기화가 멈추지 않게.
//   - R6 D2 reset tombstone(D23): reset 은 키 삭제가 아니라 '리셋 레코드'를 쓴다 — 모든 체크를 uncheckedAt=now 로 내리고
//     answeredAt=now · firstTime null · owned [](= L3 건너뛰기와 같은 모양). 항목 단위 병합(merge.ts)에서 다른 기기의 옛 체크·답이
//     되살아나지 않는다. 한계: 리셋 뒤 L3 를 다시 묻지 않는다(완전한 'L3 전' 리셋은 SetupV3 새 필드 = 서버 계약 변경이 필요).
//   - PURCHASED = L4 [준비했어요](purchase).
//   - 이벤트는 여기서 보내지 않는다(priority 등 문맥은 호출부 L2/L3/L4 가 안다).
//   - Saveable(C-R5-9): createSetupSaveable — export/import/subscribe.
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { MAX_CHECKS, MAX_OWNED, MAX_UNCHECKED } from '@ws/save-validate';
import { FORBIDDEN_KEYS, isWsId, wsStorage, type WsStorage } from '../lib/storage';
import type { ReadySource, Saveable, SavePayloads, SetupV2, SetupV3 } from '../save/contract';

export type { ReadySource, SetupV2, SetupV3 } from '../save/contract';

/** 이전 버전(R4) — 마이그레이션 입력 전용. */
export interface SetupV1 {
  v: 1;
  firstTime: boolean | null;
  owned: string[];
  answeredAt: string | null;
  startedAt: string;
  checks: Record<string, { source: ReadySource; at: string }>;
  reached100At: string | null;
}

/** 현재 버전. */
export type Setup = SetupV3;

export interface SetupAnswer {
  firstTime: boolean | null;
  owned: string[];
}

export interface SetupHandle {
  setup: SetupV3 | null;
  answer(a: SetupAnswer): void;
  toggle(itemId: string): void;
  /** L4 [준비했어요] — 미체크면 PURCHASED ✓, 이미 ✓ 면 그대로. */
  purchase(itemId: string): void;
  /** 리셋 레코드를 쓴다(D23 tombstone — 키 삭제 아님). 레코드가 없으면 아무것도 안 한다. */
  reset(): void;
  /** 답 없이 시작(L3 건너뛰기) — setup 이 없을 때만 L3 전 상태(answeredAt null)로 만든다. */
  start(): void;
  /** REQUIRED 100% 도달 기록. 처음 기록할 때만 true(setup_100_reached 1회 판정). */
  markReached100(): boolean;
}

const SETUP_VERSION = 3;
/** tombstone 보존 기간·상한(F 계약). */
export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const TOMBSTONE_MAX = MAX_UNCHECKED;
/** R6 D1: 클라 쓰기 상한(서버 검증기와 같은 값 — 단일 소스 @ws/save-validate). */
export const SETUP_MAX_CHECKS = MAX_CHECKS;
export const SETUP_MAX_OWNED = MAX_OWNED;
const SETUP_PREFIX = 'ws.setup.';
const READY_SOURCES: readonly ReadySource[] = ['OWNED', 'PURCHASED', 'UNKNOWN'];

export function setupKey(typeId: string): string {
  if (!isWsId(typeId)) throw new Error(`setupStore: 잘못된 typeId: ${String(typeId)}`);
  return `${SETUP_PREFIX}${typeId}`;
}

/** 'ws.setup.{typeId}' → typeId(.bak 등 다른 꼴이면 null). */
function typeIdOfKey(key: string): string | null {
  if (!key.startsWith(SETUP_PREFIX)) return null;
  const id = key.slice(SETUP_PREFIX.length);
  return isWsId(id) ? id : null;
}

/** 시각 = ISO 8601 형식만(자유 문자열 금지 — import·저장 값으로 이메일 등 임의 문자열이 들어오지 않게, 불변식 ⑧). */
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const isTime = (x: unknown): x is string => typeof x === 'string' && TIME_RE.test(x) && Number.isFinite(Date.parse(x));
/** 오프셋 시각(+09:00 등)은 같은 순간의 Z 형식으로 — 서버 검증기(F1)는 Z 만 받는다(아니면 PUT 400). */
const toZ = (t: string): string => (t.endsWith('Z') ? t : new Date(t).toISOString());
const toZOrNull = (t: string | null): string | null => (t === null ? null : toZ(t));
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
/** check id: slug 이면서 저장 금지 키 이름이 아닌 것(금지 키면 쓰기 전체가 거부되므로 미리 버린다). */
const isCheckId = (x: unknown): x is string => isWsId(x) && !FORBIDDEN_KEYS.has(x);

type Body = Omit<SetupV2, 'v' | 'updatedAt'>;

/** v1·v2 공통 필드 검증 + 정규화(알려진 필드만 새 객체로, 잘못된 check 행은 버린다). 형태가 깨졌으면 null. */
function normalizeBody(x: Record<string, unknown>): Body | null {
  const { firstTime, owned, answeredAt, startedAt, checks, reached100At } = x;
  if (!(firstTime === null || typeof firstTime === 'boolean')) return null;
  if (!Array.isArray(owned)) return null;
  if (!(answeredAt === null || isTime(answeredAt))) return null;
  if (!isTime(startedAt)) return null;
  if (!isObj(checks)) return null;
  if (!(reached100At === null || isTime(reached100At))) return null;
  const outChecks: Body['checks'] = {};
  for (const [id, c] of Object.entries(checks)) {
    if (!isCheckId(id) || !isObj(c)) continue;
    if (!READY_SOURCES.includes(c.source as ReadySource) || !isTime(c.at)) continue;
    outChecks[id] = { source: c.source as ReadySource, at: toZ(c.at) };
  }
  return {
    firstTime,
    owned: [...new Set(owned.filter(isCheckId))],
    answeredAt: toZOrNull(answeredAt),
    startedAt: toZ(startedAt),
    checks: outChecks,
    reached100At: toZOrNull(reached100At),
  };
}

function normalizeV2(x: Record<string, unknown>): SetupV2 | null {
  if (!isTime(x.updatedAt)) return null;
  const body = normalizeBody(x);
  return body ? { v: 2, ...body, updatedAt: toZ(x.updatedAt) } : null;
}

/** v3 객체를 계약 키 순서(서버 검증기 왕복 비교 안정 — checks 다음 uncheckedAt)로 만든다. */
function buildV3(b: Body, uncheckedAt: Record<string, string>, updatedAt: string): SetupV3 {
  return {
    v: 3,
    firstTime: b.firstTime,
    owned: b.owned,
    answeredAt: b.answeredAt,
    startedAt: b.startedAt,
    checks: b.checks,
    uncheckedAt,
    reached100At: b.reached100At,
    updatedAt,
  };
}

const msOf = (t: string): number => {
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
};

/**
 * tombstone 정리(F 계약) — 새 객체를 돌려준다.
 *   ① 같은 id 에 체크와 tombstone 이 함께 있으면 더 새 쪽만 남긴다(체크가 엄밀히 새것일 때만 체크, 동률 = 해제).
 *   ② now 가 주어지면 90일 초과 tombstone 제거(쓰기 시점만 — 병합은 시각 의존 없이 결정적).
 *   ③ 200 상한 초과 시 오래된 것부터 버린다(동률은 id 순).
 *   ④ R6 D1: checks 200 상한(at 오래된 것부터, 동률 id 순) · owned 200 상한(배열 앞쪽 = 먼저 답한 것부터). 시각 무관 — 병합 결정적.
 */
export function tidySetup(s: SetupV3, now?: string): SetupV3 {
  const checks: SetupV3['checks'] = capChecks(s.checks);
  let tombs = Object.entries(s.uncheckedAt).filter(([id, t]) => {
    const c = Object.prototype.hasOwnProperty.call(checks, id) ? checks[id] : undefined;
    if (!c) return true;
    if (msOf(c.at) > msOf(t)) return false;
    delete checks[id];
    return true;
  });
  if (now !== undefined) {
    const cutoff = msOf(now) - TOMBSTONE_MAX_AGE_MS;
    tombs = tombs.filter(([, t]) => msOf(t) >= cutoff);
  }
  if (tombs.length > TOMBSTONE_MAX) {
    tombs = [...tombs]
      .sort((a, b) => msOf(b[1]) - msOf(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, TOMBSTONE_MAX);
  }
  const uncheckedAt: Record<string, string> = {};
  for (const [id, t] of tombs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) uncheckedAt[id] = t;
  const owned = s.owned.length > SETUP_MAX_OWNED ? s.owned.slice(s.owned.length - SETUP_MAX_OWNED) : s.owned;
  return buildV3({ ...s, owned, checks }, uncheckedAt, s.updatedAt);
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** checks 200 상한 — 넘치면 at 이 새로운 것부터 남긴다(남은 항목의 원래 키 순서 유지). */
function capChecks(c: SetupV3['checks']): SetupV3['checks'] {
  const ids = Object.keys(c);
  if (ids.length <= SETUP_MAX_CHECKS) return { ...c };
  const keep = new Set([...ids].sort((a, b) => msOf(c[b].at) - msOf(c[a].at) || byId(a, b)).slice(0, SETUP_MAX_CHECKS));
  const out: SetupV3['checks'] = {};
  for (const id of ids) if (keep.has(id)) out[id] = c[id];
  return out;
}

function normalizeV3(x: Record<string, unknown>): SetupV3 | null {
  if (!isTime(x.updatedAt)) return null;
  const body = normalizeBody(x);
  if (!body || !isObj(x.uncheckedAt)) return null;
  const uncheckedAt: Record<string, string> = {};
  for (const [id, t] of Object.entries(x.uncheckedAt)) {
    if (isCheckId(id) && isTime(t)) uncheckedAt[id] = toZ(t);
  }
  return tidySetup(buildV3(body, uncheckedAt, toZ(x.updatedAt)));
}

/** 시각 문자열 중 시간값이 가장 큰 것(해석 불가는 무시, 전부 불가면 fallback). */
function latest(times: Array<string | null>, fallback: string): string {
  let best = fallback;
  let bestMs = Date.parse(fallback);
  for (const t of times) {
    if (t === null) continue;
    const ms = Date.parse(t);
    if (Number.isNaN(ms)) continue;
    if (Number.isNaN(bestMs) || ms > bestMs) {
      best = t;
      bestMs = ms;
    }
  }
  return best;
}

/** 업그레이더 표: from v → 다음 v 의 원시 객체(형태가 깨졌으면 null). */
const UPGRADERS: Readonly<Record<number, (prev: Record<string, unknown>) => Record<string, unknown> | null>> = {
  // v1 → v2: updatedAt = max(startedAt, answeredAt, reached100At, checks[*].at)
  1: (prev) => {
    const b = normalizeBody(prev);
    if (!b) return null;
    const updatedAt = latest([b.answeredAt, b.reached100At, ...Object.values(b.checks).map((c) => c.at)], b.startedAt);
    return { ...b, v: 2, updatedAt };
  },
  // v2 → v3: uncheckedAt {}(해제 기록 없음 — 승격 전 해제는 복구 불가, 알려진 한계).
  2: (prev) => {
    const s = normalizeV2(prev);
    return s ? { ...buildV3(s, {}, s.updatedAt) } : null;
  },
};

/** 원시 레코드(v1·v2·v3) → 정규화된 SetupV3. 미지 v·형태 깨짐 = null. */
export function migrateSetup(raw: unknown): SetupV3 | null {
  if (!isObj(raw)) return null;
  let cur: Record<string, unknown> = raw;
  for (let guard = 0; guard < 16; guard++) {
    const v = cur.v;
    if (v === SETUP_VERSION) return normalizeV3(cur);
    if (typeof v !== 'number' || !Object.prototype.hasOwnProperty.call(UPGRADERS, v)) return null;
    const next = UPGRADERS[v](cur);
    if (!next) return null;
    cur = next;
  }
  return null;
}

/** 원문 → SetupV3. 실패 시 원본을 .bak 으로 옮기고(최신 1개) null. */
function parseRaw(storage: WsStorage, key: string, raw: string): SetupV3 | null {
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

export function readSetup(storage: WsStorage, typeId: string): SetupV3 | null {
  const key = setupKey(typeId);
  const raw = storage.get(key);
  return raw === null ? null : parseRaw(storage, key, raw);
}

/** 쓰기는 항상 v3 — v2 가 들어오면(테스트·이전 호출부) 승격해서 쓴다(uncheckedAt {}). 상한(R6 D1)은 쓰기 시점에 다시 적용. */
export function writeSetup(storage: WsStorage, typeId: string, s: SetupV2 | SetupV3): void {
  const rec: SetupV3 = tidySetup(s.v === 3 ? s : buildV3(s, {}, s.updatedAt));
  storage.set(setupKey(typeId), JSON.stringify(rec));
}

function fresh(now: string): SetupV3 {
  return {
    v: 3,
    firstTime: null,
    owned: [],
    answeredAt: null,
    startedAt: now,
    checks: {},
    uncheckedAt: {},
    reached100At: null,
    updatedAt: now,
  };
}

/** 체크 추가 시 같은 id 의 tombstone 은 지운다(더 새 체크가 이긴다). */
function withoutTomb(u: SetupV3['uncheckedAt'], id: string): SetupV3['uncheckedAt'] {
  if (!Object.prototype.hasOwnProperty.call(u, id)) return u;
  const out = { ...u };
  delete out[id];
  return out;
}

/** L3 2질문 답. 보유 항목은 OWNED ✓(이미 ✓ 면 유지), 빠진 보유 항목의 OWNED ✓ 는 해제(tombstone = now). */
export function applyAnswer(prev: SetupV3 | null, a: SetupAnswer, now: string): SetupV3 {
  const base = prev ?? fresh(now);
  const owned = [...new Set(a.owned.filter(isCheckId))];
  const checks: SetupV3['checks'] = {};
  let uncheckedAt: SetupV3['uncheckedAt'] = { ...base.uncheckedAt };
  for (const [id, c] of Object.entries(base.checks)) {
    if (c.source === 'OWNED' && !owned.includes(id)) {
      uncheckedAt[id] = now;
      continue;
    }
    checks[id] = c;
  }
  for (const id of owned) {
    if (checks[id]) continue;
    checks[id] = { source: 'OWNED', at: now };
    uncheckedAt = withoutTomb(uncheckedAt, id);
  }
  return tidySetup({ ...base, firstTime: a.firstTime, owned, answeredAt: now, checks, uncheckedAt, updatedAt: now }, now);
}

/** 체크 토글: 없으면 UNKNOWN ✓, 있으면 해제(키 삭제 + tombstone = now). setup 이 없으면 L3 전 상태로 만든다. */
export function applyToggle(prev: SetupV3 | null, itemId: string, now: string): SetupV3 {
  const base = prev ?? fresh(now);
  const checks = { ...base.checks };
  let uncheckedAt = base.uncheckedAt;
  if (checks[itemId]) {
    delete checks[itemId];
    uncheckedAt = { ...uncheckedAt, [itemId]: now };
  } else {
    checks[itemId] = { source: 'UNKNOWN', at: now };
    uncheckedAt = withoutTomb(uncheckedAt, itemId);
  }
  return tidySetup({ ...base, checks, uncheckedAt, updatedAt: now }, now);
}

/** L4 [준비했어요]: 미체크면 PURCHASED ✓(setup 없으면 L3 전 상태로 생성), 이미 ✓ 면 prev 그대로. */
export function applyPurchased(prev: SetupV3 | null, itemId: string, now: string): SetupV3 {
  if (prev?.checks[itemId]) return prev;
  const base = prev ?? fresh(now);
  return tidySetup(
    {
      ...base,
      checks: { ...base.checks, [itemId]: { source: 'PURCHASED', at: now } },
      uncheckedAt: withoutTomb(base.uncheckedAt, itemId),
      updatedAt: now,
    },
    now,
  );
}

/**
 * R6 D2 리셋(D23 tombstone): 모든 체크를 해제(uncheckedAt = now)하고 답을 '빈 답'(answeredAt = now, firstTime null, owned [])으로.
 *   answeredAt = now 라서 답 단위 LWW 에서 다른 기기의 옛 답을 이기고, 항목 tombstone 이 옛 체크를 이긴다(merge.ts mergeSetup).
 *   startedAt·reached100At 은 그대로(병합 규칙이 최솟값이라 지워도 되살아난다). prev 없음 = null(쓸 것 없음).
 */
export function applyReset(prev: SetupV3 | null, now: string): SetupV3 | null {
  if (!prev) return null;
  const uncheckedAt: SetupV3['uncheckedAt'] = { ...prev.uncheckedAt };
  for (const id of Object.keys(prev.checks)) uncheckedAt[id] = now;
  return tidySetup({ ...prev, firstTime: null, owned: [], answeredAt: now, checks: {}, uncheckedAt, updatedAt: now }, now);
}

/** REQUIRED 100% 도달 기록 — updatedAt 은 건드리지 않는다(F 계약: L2 열기만으로 레코드가 '새것'이 되지 않게). */
export function applyReached100(prev: SetupV3, now: string): SetupV3 {
  return prev.reached100At ? prev : { ...prev, reached100At: now };
}

// ── 같은 탭 구독(같은 typeId 를 보는 훅끼리 동기 + 조각 전체 구독) + 다른 탭(storage 이벤트) ──
const listeners = new Map<string, Set<() => void>>();
const anyListeners = new Set<() => void>();

function emit(key: string): void {
  for (const l of [...(listeners.get(key) ?? [])]) l();
  for (const l of [...anyListeners]) l();
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
  const cache = useRef<{ raw: string | null; value: SetupV3 | null }>({ raw: null, value: null });

  const subscribe = useCallback((l: () => void) => (key ? subscribeKey(key, l) : noop), [key]);
  const getSnapshot = useCallback((): SetupV3 | null => {
    if (!key) return null;
    const raw = storage.get(key);
    if (raw === cache.current.raw) return cache.current.value;
    const value = raw === null ? null : parseRaw(storage, key, raw);
    cache.current = { raw: value === null ? null : raw, value };
    return value;
  }, [key, storage]);
  const setup = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo<SetupHandle>(() => {
    const current = (): SetupV3 | null => (key && typeId ? readSetup(storage, typeId) : null);
    const commit = (next: SetupV3): void => {
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
        if (key && isCheckId(itemId)) commit(applyToggle(current(), itemId, nowIso()));
      },
      purchase: (itemId) => {
        if (!key || !isCheckId(itemId)) return;
        const prev = current();
        const next = applyPurchased(prev, itemId, nowIso());
        if (next !== prev) commit(next);
      },
      reset: () => {
        if (!key) return;
        const next = applyReset(current(), nowIso());
        if (next) commit(next);
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

// ── Saveable(C-R5-9) ─────────────────────────────────────────
/** ws.setup.* 전체를 스냅샷 조각 'setups' 로. import 는 검증 통과 레코드만 쓴다(없는 레코드는 그대로 — D23). */
export function createSetupSaveable(storage: WsStorage = wsStorage): Saveable<SavePayloads['setups']> {
  return {
    key: 'setups',
    export() {
      const out: SavePayloads['setups'] = {};
      for (const k of storage.keys(SETUP_PREFIX)) {
        const id = typeIdOfKey(k);
        if (!id) continue;
        const s = readSetup(storage, id);
        if (s) out[id] = s;
      }
      return out;
    },
    import(p) {
      if (!isObj(p)) return;
      for (const [id, rec] of Object.entries(p)) {
        if (!isWsId(id)) continue;
        const s = migrateSetup(rec);
        if (!s) continue;
        writeSetup(storage, id, s);
        emit(setupKey(id));
      }
    },
    subscribe(fn) {
      anyListeners.add(fn);
      const onStorage = (e: StorageEvent): void => {
        if (e.key === null || typeIdOfKey(e.key) !== null) fn();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        anyListeners.delete(fn);
        window.removeEventListener('storage', onStorage);
      };
    },
  };
}
