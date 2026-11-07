// 내 케이지(계약 C-R5-1 ws.context.{typeId}.cage v1 · D7). L6 입력 → L4/L5 호환 판정의 UserContext.
//   - 값 범위는 cage specSchema(min/max·options)가 결정 — 검증은 @ws/engine sanitizeSpecValues 한 곳(별도 범위 표 없음, 불변식 ⑥).
//   - barGapMm 은 WIRE 만(다른 형태면 버린다). 모든 쓰기는 updatedAt 갱신. 삭제 = 키 삭제.
//   - 미지 v·파싱 실패·형태 깨짐 → 원본 .bak 1개 + null(setupStore 와 같은 규칙).
//   - 불변식 ⑧: 알려진 필드만 새 객체로 쓴다(좌표·지역·이메일 등은 들어갈 자리가 없고, storage 가 키 이름으로 한 번 더 거부).
//   - Saveable(C-R5-9): createCageSaveable — export/import/subscribe.
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { sanitizeSpecValues, type SpecSchema, type UserContext } from '@ws/engine';
import { isWsId, wsStorage, type WsStorage } from '../lib/storage';
import type { CageType, CageV1, Saveable, SavePayloads } from '../save/contract';

export type { CageType, CageV1 } from '../save/contract';

export const CAGE_TYPES: readonly CageType[] = ['LIVING_BOX', 'WIRE', 'ACRYLIC', 'OTHER'];
/** 엔진 ownedItems 키 = cage SupplyItem id. */
export const CAGE_ITEM_ID = 'cage';

/** L6 입력(저장 메타 제외). */
export type CageInput = Omit<CageV1, 'v' | 'updatedAt'>;

const CAGE_VERSION = 1;
const PREFIX = 'ws.context.';
const SUFFIX = '.cage';
/** 삭제 tombstone 키(ws.context.{typeId}.cagedel) — 삭제 시각 ISO 하나. 서버로 보내지 않고 병합에서만 쓴다. */
const DEL_SUFFIX = '.cagedel';

export function cageKey(typeId: string): string {
  if (!isWsId(typeId)) throw new Error(`cageStore: 잘못된 typeId: ${String(typeId)}`);
  return `${PREFIX}${typeId}${SUFFIX}`;
}

function delKey(typeId: string): string {
  return `${PREFIX}${typeId}${DEL_SUFFIX}`;
}

function typeIdOfKey(key: string): string | null {
  if (!key.startsWith(PREFIX) || !key.endsWith(SUFFIX)) return null;
  const id = key.slice(PREFIX.length, key.length - SUFFIX.length);
  return isWsId(id) ? id : null;
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isPos = (x: unknown): x is number => isNum(x) && x > 0;
/** 저장 시각 = toISOString 형식만(자유 문자열 금지 — import 로 이메일 등 임의 문자열이 들어오지 않게, 불변식 ⑧). */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const isIso = (x: unknown): x is string => typeof x === 'string' && ISO_RE.test(x) && Number.isFinite(Date.parse(x));
const isCageType = (x: unknown): x is CageType => typeof x === 'string' && (CAGE_TYPES as readonly string[]).includes(x);

/** 알려진 필드만 뽑는다(barGapMm 은 WIRE 일 때만 후보). */
function pick(x: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: x.type,
    floorWcm: x.floorWcm,
    floorDcm: x.floorDcm,
    heightCm: x.heightCm,
  };
  if (x.type === 'WIRE' && x.barGapMm !== undefined) out.barGapMm = x.barGapMm;
  return out;
}

/** 형태만 검사(스키마를 아직 모를 때 — 카탈로그 로드 전 읽기·import). */
function checkShape(x: unknown): CageInput | null {
  if (!isObj(x)) return null;
  const p = pick(x);
  if (!isCageType(p.type) || !isPos(p.floorWcm) || !isPos(p.floorDcm) || !isPos(p.heightCm)) return null;
  const out: CageInput = { type: p.type, floorWcm: p.floorWcm, floorDcm: p.floorDcm, heightCm: p.heightCm };
  if (p.barGapMm !== undefined) {
    if (!isPos(p.barGapMm)) return null;
    out.barGapMm = p.barGapMm;
  }
  return out;
}

/**
 * 입력 → 저장 가능한 CageInput(스키마 범위 안) | null.
 *   type·floorWcm·floorDcm·heightCm 필수, WIRE 의 barGapMm 은 선택(있으면 범위 안), 비-WIRE barGapMm 은 버린다.
 *   범위·선택지는 sanitizeSpecValues(schema) 가 남긴 값과 같아야 통과(스키마에 없는 필드 = 거부).
 */
export function validateCage(input: unknown, schema: SpecSchema): CageInput | null {
  const shaped = checkShape(input);
  if (!shaped) return null;
  const clean = sanitizeSpecValues(schema, shaped as unknown as Record<string, number | string>);
  for (const [k, v] of Object.entries(shaped)) {
    if (clean[k] !== v) return null;
  }
  return shaped;
}

function normalizeStored(x: unknown, schema: SpecSchema | null | undefined): CageV1 | null {
  if (!isObj(x) || x.v !== CAGE_VERSION || !isIso(x.updatedAt)) return null;
  const c = schema ? validateCage(x, schema) : checkShape(x);
  return c ? { v: 1, ...c, updatedAt: x.updatedAt } : null;
}

function parseRaw(storage: WsStorage, key: string, raw: string, schema?: SpecSchema | null): CageV1 | null {
  let parsed: unknown;
  let ok = true;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ok = false;
  }
  const c = ok ? normalizeStored(parsed, schema) : null;
  if (c) return c;
  try {
    storage.set(`${key}.bak`, raw);
  } catch {
    // 원본에 금지 키가 섞여 있으면 .bak 에도 남기지 않는다(불변식 ⑧).
  }
  storage.remove(key);
  return null;
}

/** schema 를 주면 값 범위까지, 없으면 형태만 검사. */
export function readCage(storage: WsStorage, typeId: string, schema?: SpecSchema | null): CageV1 | null {
  const key = cageKey(typeId);
  const raw = storage.get(key);
  return raw === null ? null : parseRaw(storage, key, raw, schema);
}

/** 검증 통과 시 저장하고 레코드 반환, 범위 밖·형태 깨짐이면 null(저장 0, 기존 값 유지). */
export function writeCage(
  storage: WsStorage,
  typeId: string,
  input: unknown,
  schema: SpecSchema,
  now: string,
): CageV1 | null {
  const key = cageKey(typeId);
  const c = validateCage(input, schema);
  if (!c) return null;
  const rec: CageV1 = { v: 1, ...c, updatedAt: now };
  storage.set(key, JSON.stringify(rec));
  storage.remove(delKey(typeId));
  emit(key);
  return rec;
}

/** 삭제 = 키 삭제 + (있던 케이지면) 삭제 시각 tombstone — 서버 병합이 옛 서버 케이지로 되살리지 않게. */
export function removeCage(storage: WsStorage, typeId: string, now: string = new Date().toISOString()): void {
  const key = cageKey(typeId);
  const had = storage.get(key) !== null;
  storage.remove(key);
  if (had) storage.set(delKey(typeId), now);
  emit(key);
}

/** typeId → 삭제 시각(ISO). 형식이 틀린 값은 버린다. */
function readTombstones(storage: WsStorage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of storage.keys(PREFIX)) {
    if (!k.endsWith(DEL_SUFFIX)) continue;
    const id = k.slice(PREFIX.length, k.length - DEL_SUFFIX.length);
    const v = storage.get(k);
    if (isWsId(id) && isIso(v)) out[id] = v;
  }
  return out;
}

/** 엔진 입력(C-R5-1): {ownedItems:{cage:{type,floorWcm,floorDcm,heightCm,barGapMm?}}}. 케이지 없으면 undefined. */
export function toUserContext(cage: CageV1 | null): UserContext | undefined {
  if (!cage) return undefined;
  const values: Record<string, string | number> = {
    type: cage.type,
    floorWcm: cage.floorWcm,
    floorDcm: cage.floorDcm,
    heightCm: cage.heightCm,
  };
  if (cage.type === 'WIRE' && cage.barGapMm !== undefined) values.barGapMm = cage.barGapMm;
  return { ownedItems: { [CAGE_ITEM_ID]: values } };
}

// ── 구독(같은 탭 + 다른 탭) ──────────────────────────────────
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

const noop = (): void => undefined;

export interface UseCageOptions {
  /** cage specSchema(ws-data PublicRequirement.item.specSchema 또는 카탈로그). null = 아직 모름 → 저장 불가. */
  schema: SpecSchema | null;
  storage?: WsStorage;
}

export interface CageHandle {
  cage: CageV1 | null;
  /** 검증 통과 시 저장 true, 범위 밖·스키마 없음 false. */
  save(input: CageInput): boolean;
  remove(): void;
}

export function useCage(typeId: string, opts: UseCageOptions): CageHandle {
  const storage = opts.storage ?? wsStorage;
  const schema = opts.schema;
  const key = isWsId(typeId) ? cageKey(typeId) : null;
  const cache = useRef<{ raw: string | null; schema: SpecSchema | null; value: CageV1 | null }>({
    raw: null,
    schema: null,
    value: null,
  });

  const subscribe = useCallback((l: () => void) => (key ? subscribeKey(key, l) : noop), [key]);
  const getSnapshot = useCallback((): CageV1 | null => {
    if (!key) return null;
    const raw = storage.get(key);
    if (raw === cache.current.raw && schema === cache.current.schema) return cache.current.value;
    const value = raw === null ? null : parseRaw(storage, key, raw, schema);
    cache.current = { raw: value === null ? null : raw, schema, value };
    return value;
  }, [key, storage, schema]);
  const cage = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo<CageHandle>(
    () => ({
      cage,
      save: (input) => {
        if (!key || !schema) return false;
        return writeCage(storage, typeId, input, schema, new Date().toISOString()) !== null;
      },
      remove: () => {
        if (key) removeCage(storage, typeId);
      },
    }),
    [cage, key, typeId, storage, schema],
  );
}

// ── Saveable(C-R5-9) ─────────────────────────────────────────
/**
 * ws.context.*.cage 전체를 스냅샷 조각 'cages' 로. getSchema 가 스키마를 주면 범위까지, null 이면 형태만 검사
 * (그 경우에도 다음 읽기·쓰기에서 스키마로 다시 거른다). import 는 레코드 updatedAt 을 보존한다(병합 기준).
 */
export function createCageSaveable(
  storage: WsStorage = wsStorage,
  getSchema: () => SpecSchema | null = () => null,
): Saveable<SavePayloads['cages']> {
  return {
    key: 'cages',
    export() {
      const schema = getSchema();
      const out: SavePayloads['cages'] = {};
      for (const k of storage.keys(PREFIX)) {
        const id = typeIdOfKey(k);
        if (!id) continue;
        const c = readCage(storage, id, schema);
        if (c) out[id] = c;
      }
      return out;
    },
    import(p) {
      if (!isObj(p)) return;
      const schema = getSchema();
      for (const [id, rec] of Object.entries(p)) {
        if (!isWsId(id)) continue;
        const c = normalizeStored(rec, schema);
        if (!c) continue;
        const key = cageKey(id);
        // 이 기기에서 지운 뒤(삭제 시각 ≥ 레코드 시각)의 옛 레코드는 받지 않는다. 더 새 레코드면 tombstone 해제.
        const del = storage.get(delKey(id));
        if (isIso(del)) {
          if (Date.parse(c.updatedAt) <= Date.parse(del)) continue;
          storage.remove(delKey(id));
        }
        storage.set(key, JSON.stringify(c));
        emit(key);
      }
    },
    tombstones: () => readTombstones(storage),
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
