// ws.save(계약 C-R5-1) — 이 기기의 이메일 연결 여부·마지막 동기화 시각만.
//   불변식 ⑧ / K4: 이메일·토큰·세션 id 는 저장하지 않는다(세션은 HttpOnly 쿠키, 클라 JS 가 볼 수 없다).
//   알려진 필드만 새 객체로 쓰므로 호출부가 다른 필드를 넘겨도 저장되지 않는다.
import { wsStorage, type WsStorage } from '../lib/storage';
import type { SaveStateV1 } from './contract';

export const SAVE_STATE_KEY = 'ws.save';

const listeners = new Set<() => void>();

function emitSaveState(): void {
  for (const l of [...listeners]) l();
}

/** ws.save 변경 구독(같은 탭 write·clear + 다른 탭 storage 이벤트). 반환 = 해제. */
export function subscribeSaveState(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || e.key === SAVE_STATE_KEY) fn();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

const DEFAULT: SaveStateV1 = Object.freeze({ v: 1, linked: false, lastSyncAt: null }) as SaveStateV1;

function normalize(x: unknown): SaveStateV1 | null {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.linked !== 'boolean') return null;
  if (!(o.lastSyncAt === null || typeof o.lastSyncAt === 'string')) return null;
  const out: SaveStateV1 = { v: 1, linked: o.linked, lastSyncAt: o.lastSyncAt };
  if (o.pendingLogout === true) out.pendingLogout = true;
  return out;
}

/** 원문 → SaveStateV1 | null(미지 v·깨짐). */
export function parseSaveState(raw: string): SaveStateV1 | null {
  try {
    const p: unknown = JSON.parse(raw);
    if (p === null || typeof p !== 'object' || (p as { v?: unknown }).v !== 1) return null;
    return normalize(p);
  } catch {
    return null;
  }
}

/** 없거나 깨졌으면 기본값(연결 안 됨). */
export function readSaveState(storage: WsStorage = wsStorage): SaveStateV1 {
  const raw = storage.get(SAVE_STATE_KEY);
  return (raw === null ? null : parseSaveState(raw)) ?? { ...DEFAULT };
}

export function writeSaveState(
  storage: WsStorage,
  s: Pick<SaveStateV1, 'linked' | 'lastSyncAt' | 'pendingLogout'>,
): SaveStateV1 {
  const n = normalize(s);
  if (!n) throw new Error('saveStateStore: 잘못된 ws.save 값');
  storage.set(SAVE_STATE_KEY, JSON.stringify(n));
  emitSaveState();
  return n;
}

export function clearSaveState(storage: WsStorage = wsStorage): void {
  storage.remove(SAVE_STATE_KEY);
  emitSaveState();
}
