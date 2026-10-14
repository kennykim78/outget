// SaveV1 검증기(계약 C-R5-1·C-R5-2, D5·D22). 서버는 검증된 스냅샷만 저장하고 병합하지 않는다.
//   1) 깊은 금지 키(대소문자 무시, 레코드 키 포함) → forbidden_key   (불변식 ⑧: 좌표·지역·이메일·토큰 등)
//   2) 엄격 스키마(알 수 없는 키 거부, recheck 제외) → invalid_snapshot
//   3) 결과는 알려진 필드만 새 객체로 재조립(원본 참조·프로토타입 키 미유입).
//   케이지 수치는 형태·상식 범위(0 < cm ≤ 1000, 0 < mm ≤ 100)만 본다 — specSchema min/max 정규화는 클라이언트
//   sanitizeSpecValues(C-R5-1) 몫이고, 서버 저장값은 판정·노출에 쓰이지 않는다(엔진 입력 아님).

import { FORBIDDEN_KEYS, isForbiddenKey } from '../shared/forbidden-keys.js';

export const SAVE_MAX_BYTES = 32 * 1024;
export const MAX_TYPES = 20;
export const MAX_CHECKS = 200;
export const MAX_OWNED = 200;
/** SetupV3.uncheckedAt(항목 해제 tombstone) 상한 — checks 와 합산 아님, 각각 ≤200(F 계약). */
export const MAX_UNCHECKED = 200;
export const MAX_REACTIONS = 500;
const MAX_DEPTH = 16;

/** 금지 키 = 공용 단일 소스(server/src/shared/forbidden-keys.ts, 클라 storage.ts 와 동일 목록·매칭 — R-1). */
export const SAVE_FORBIDDEN_KEYS: ReadonlySet<string> = FORBIDDEN_KEYS;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HELPFUL_KEY_RE = /^(SUPPLY_ITEM|BUNDLE|PRODUCT):[a-z0-9][a-z0-9-]{0,63}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** ISO 시각 문자열(Z, 밀리초 ≤3자리) — PUT /api/save baseUpdatedAt 검사(H1). */
export function isIsoTime(x: unknown): x is string {
  return typeof x === 'string' && ISO_RE.test(x) && Number.isFinite(Date.parse(x));
}
const READY_SOURCES = ['OWNED', 'PURCHASED', 'UNKNOWN'] as const;
const CAGE_TYPES = ['LIVING_BOX', 'WIRE', 'ACRYLIC', 'OTHER'] as const;

export type ReadySource = (typeof READY_SOURCES)[number];
export type CageType = (typeof CAGE_TYPES)[number];

export interface SetupV2 {
  v: 2;
  firstTime: boolean | null;
  owned: string[];
  answeredAt: string | null;
  startedAt: string;
  checks: Record<string, { source: ReadySource; at: string }>;
  reached100At: string | null;
  updatedAt: string;
}

/** F 계약: v2 필드 의미·형 그대로 + uncheckedAt(id → 해제 시각 ISO) + v:3. 같은 id 가 checks·uncheckedAt 에 동시 존재해도 허용(병합 판정은 클라 몫). */
export interface SetupV3 extends Omit<SetupV2, 'v'> {
  v: 3;
  uncheckedAt: Record<string, string>;
}

export type Setup = SetupV2 | SetupV3;

export interface CageV1 {
  v: 1;
  type: CageType;
  floorWcm: number;
  floorDcm: number;
  heightCm: number;
  barGapMm?: number;
  updatedAt: string;
}

export interface SaveV1 {
  v: 1;
  animalTypeId: string | null;
  setups: Record<string, Setup>;
  cages: Record<string, CageV1>;
  reactions: { like: Record<string, string>; helpful: Record<string, string>; updatedAt: string | null };
}

export type SaveValidation =
  | { ok: true; value: SaveV1 }
  | { ok: false; error: 'forbidden_key' | 'invalid_snapshot' };

class Invalid extends Error {}
const fail = (): never => {
  throw new Invalid();
};

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => x !== null && typeof x === 'object' && !Array.isArray(x);

/** 어느 깊이든 금지 키(소문자 비교)를 찾으면 그 키, 없으면 null. MAX_DEPTH 초과는 '<depth>'. */
export function findForbiddenKey(x: unknown, depth = 0): string | null {
  if (depth > MAX_DEPTH) return '<depth>';
  if (Array.isArray(x)) {
    for (const v of x) {
      const hit = findForbiddenKey(v, depth + 1);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (!isObj(x)) return null;
  for (const [k, v] of Object.entries(x)) {
    if (isForbiddenKey(k)) return k.toLowerCase();
    const hit = findForbiddenKey(v, depth + 1);
    if (hit !== null) return hit;
  }
  return null;
}

function exactKeys(o: Obj, required: readonly string[], optional: readonly string[] = []): void {
  for (const k of required) if (!Object.prototype.hasOwnProperty.call(o, k)) fail();
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) fail();
}

function obj(x: unknown): Obj {
  return isObj(x) ? x : fail();
}

function iso(x: unknown): string {
  if (typeof x !== 'string' || !ISO_RE.test(x) || !Number.isFinite(Date.parse(x))) fail();
  return x as string;
}

const isoOrNull = (x: unknown): string | null => (x === null ? null : iso(x));

function slug(x: unknown): string {
  return typeof x === 'string' && SLUG_RE.test(x) ? x : fail();
}

function num(x: unknown, max: number): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= max ? x : fail();
}

function record<T>(x: unknown, max: number, key: (k: string) => void, val: (v: unknown) => T): Record<string, T> {
  const o = obj(x);
  const entries = Object.entries(o);
  if (entries.length > max) fail();
  const out: Record<string, T> = {};
  for (const [k, v] of entries) {
    key(k);
    out[k] = val(v);
  }
  return out;
}

const slugKey = (k: string): void => void slug(k);

const SETUP_V2_KEYS = ['v', 'firstTime', 'owned', 'answeredAt', 'startedAt', 'checks', 'reached100At', 'updatedAt'] as const;

/** setups 레코드 값 — v2|v3 혼재 수용. v 로 분기, 그 외 v 는 거부. */
function setup(x: unknown): Setup {
  const o = obj(x);
  if (o.v === 3) {
    exactKeys(o, [...SETUP_V2_KEYS, 'uncheckedAt']);
    const { reached100At, updatedAt, ...head } = setupFields(o);
    const uncheckedAt = record(o.uncheckedAt, MAX_UNCHECKED, slugKey, iso);
    // 키 순서 = 계약 순서(uncheckedAt 은 checks 다음) — 왕복 비교 안정.
    return { v: 3, ...head, uncheckedAt, reached100At, updatedAt };
  }
  exactKeys(o, SETUP_V2_KEYS);
  if (o.v !== 2) fail();
  return { v: 2, ...setupFields(o) };
}

/** v2·v3 공통 필드(v2 의미·형 그대로). */
function setupFields(o: Obj): Omit<SetupV2, 'v'> {
  if (!(o.firstTime === null || typeof o.firstTime === 'boolean')) fail();
  if (!Array.isArray(o.owned) || o.owned.length > MAX_OWNED) fail();
  const owned = (o.owned as unknown[]).map(slug);
  const checks = record(o.checks, MAX_CHECKS, slugKey, (c) => {
    const co = obj(c);
    exactKeys(co, ['source', 'at']);
    if (!(READY_SOURCES as readonly unknown[]).includes(co.source)) fail();
    return { source: co.source as ReadySource, at: iso(co.at) };
  });
  return {
    firstTime: o.firstTime as boolean | null,
    owned,
    answeredAt: isoOrNull(o.answeredAt),
    startedAt: iso(o.startedAt),
    checks,
    reached100At: isoOrNull(o.reached100At),
    updatedAt: iso(o.updatedAt),
  };
}

function cageV1(x: unknown): CageV1 {
  const o = obj(x);
  exactKeys(o, ['v', 'type', 'floorWcm', 'floorDcm', 'heightCm', 'updatedAt'], ['barGapMm']);
  if (o.v !== 1) fail();
  if (!(CAGE_TYPES as readonly unknown[]).includes(o.type)) fail();
  const type = o.type as CageType;
  const out: CageV1 = {
    v: 1,
    type,
    floorWcm: num(o.floorWcm, 1000),
    floorDcm: num(o.floorDcm, 1000),
    heightCm: num(o.heightCm, 1000),
    updatedAt: iso(o.updatedAt),
  };
  if (o.barGapMm !== undefined) {
    if (type !== 'WIRE') fail(); // D7: barGapMm 는 WIRE 만
    out.barGapMm = num(o.barGapMm, 100);
  }
  // 키 순서를 계약 순서로(updatedAt 마지막) — 왕복 비교 안정.
  const { updatedAt, ...rest } = out;
  return { ...rest, updatedAt };
}

function saveV1(x: unknown): SaveV1 {
  const o = obj(x);
  exactKeys(o, ['v', 'animalTypeId', 'setups', 'cages', 'reactions']);
  if (o.v !== 1) fail();
  const animalTypeId = o.animalTypeId === null ? null : slug(o.animalTypeId);
  const setups = record(o.setups, MAX_TYPES, slugKey, setup);
  const cages = record(o.cages, MAX_TYPES, slugKey, cageV1);
  const r = obj(o.reactions);
  exactKeys(r, ['like', 'helpful', 'updatedAt']); // recheck 제외(D22) — 있으면 거부
  const reactions = {
    like: record(r.like, MAX_REACTIONS, slugKey, iso),
    helpful: record(
      r.helpful,
      MAX_REACTIONS,
      (k) => {
        if (!HELPFUL_KEY_RE.test(k)) fail();
      },
      iso,
    ),
    updatedAt: isoOrNull(r.updatedAt),
  };
  return { v: 1, animalTypeId, setups, cages, reactions };
}

export function validateSaveV1(x: unknown): SaveValidation {
  const forbidden = findForbiddenKey(x);
  if (forbidden === '<depth>') return { ok: false, error: 'invalid_snapshot' };
  if (forbidden !== null) return { ok: false, error: 'forbidden_key' };
  try {
    const value = saveV1(x);
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > SAVE_MAX_BYTES) return { ok: false, error: 'invalid_snapshot' };
    return { ok: true, value };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: 'invalid_snapshot' };
    throw e;
  }
}
