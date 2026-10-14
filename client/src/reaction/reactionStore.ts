// 반응 로컬 상태(ws.reactions v1, D8 · 계약 C-R5-3). 👍 helpful · ⚠ recheck · ♥ like — 독립 토글.
//   - 서버 집계는 POST/DELETE /api/reactions(동일 출처, 실패 무시). 집계는 노출·정렬·판정에 영향 0(불변식 ③).
//   - 저장 값은 대상 키 → 누른 시각만(이메일·좌표 등 들어갈 자리 없음, 불변식 ⑧). recheck 는 로컬 전용(D22).
//   - Saveable(C-R5-9): createReactionSaveable — recheck 제외(D22).
import { useCallback, useSyncExternalStore } from 'react';
import type { ReactionsV1, Saveable, SavePayloads } from '../save/contract';
import { isWsId, wsStorage, type WsStorage } from '../lib/storage';

export const REACTIONS_KEY = 'ws.reactions';
export type ReactionKind = 'helpful' | 'recheck' | 'like';
export type ReactionTarget = 'SUPPLY_ITEM' | 'BUNDLE' | 'PRODUCT';

const SERVER_KIND: Record<ReactionKind, 'HELPFUL' | 'RECHECK' | 'LIKE'> = { helpful: 'HELPFUL', recheck: 'RECHECK', like: 'LIKE' };
const ENDPOINT = '/api/reactions';

export interface ReactionBody {
  targetType: ReactionTarget;
  targetId: string;
  kind: 'HELPFUL' | 'RECHECK' | 'LIKE';
}

/** 서버 전송(테스트는 send 를 바꿔 끼운다). 동일 출처 상대 경로만, 실패는 삼킨다. */
export const reactionApi = {
  send(method: 'POST' | 'DELETE', body: ReactionBody): Promise<void> {
    if (typeof fetch !== 'function') return Promise.resolve();
    try {
      return fetch(ENDPOINT, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(
        () => undefined,
        () => undefined,
      );
    } catch {
      return Promise.resolve();
    }
  },
};

/** 저장 키: like = productId, helpful·recheck = "{targetType}:{id}"(계약 ReactionsV1). */
export function reactionKey(kind: ReactionKind, targetType: ReactionTarget, id: string): string {
  return kind === 'like' ? id : `${targetType}:${id}`;
}

function empty(): ReactionsV1 {
  return { v: 1, like: {}, helpful: {}, recheck: {}, updatedAt: new Date(0).toISOString() };
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const KEY_RE = /^(?:(?:SUPPLY_ITEM|BUNDLE|PRODUCT):)?[a-z0-9][a-z0-9-]{0,63}$/;

function cleanMap(x: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(x)) return out;
  for (const [k, v] of Object.entries(x)) if (KEY_RE.test(k) && typeof v === 'string') out[k] = v;
  return out;
}

export function readReactions(storage: WsStorage = wsStorage): ReactionsV1 {
  const raw = storage.get(REACTIONS_KEY);
  if (raw === null) return empty();
  try {
    const p: unknown = JSON.parse(raw);
    if (!isObj(p) || p.v !== 1) return empty();
    return {
      v: 1,
      like: cleanMap(p.like),
      helpful: cleanMap(p.helpful),
      recheck: cleanMap(p.recheck),
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : empty().updatedAt,
    };
  } catch {
    return empty();
  }
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of [...listeners]) l();
}

/** 토글 후 새 상태(true = 켜짐). 잘못된 id 면 false·변경 0. */
export function toggleReaction(storage: WsStorage, kind: ReactionKind, targetType: ReactionTarget, id: string): boolean {
  if (!isWsId(id)) return false;
  const cur = readReactions(storage);
  const key = reactionKey(kind, targetType, id);
  const map = { ...cur[kind] };
  const on = !Object.prototype.hasOwnProperty.call(map, key);
  const now = new Date().toISOString();
  if (on) map[key] = now;
  else delete map[key];
  storage.set(REACTIONS_KEY, JSON.stringify({ ...cur, [kind]: map, updatedAt: now }));
  emit();
  void reactionApi.send(on ? 'POST' : 'DELETE', { targetType, targetId: id, kind: SERVER_KIND[kind] });
  return on;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === REACTIONS_KEY) l();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

/** 한 대상의 반응 켜짐 여부 + 토글. */
export function useReaction(kind: ReactionKind, targetType: ReactionTarget, id: string, storage: WsStorage = wsStorage): [boolean, () => boolean] {
  const key = reactionKey(kind, targetType, id);
  const getSnapshot = useCallback(() => Object.prototype.hasOwnProperty.call(readReactions(storage)[kind], key), [storage, kind, key]);
  const on = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const toggle = useCallback(() => toggleReaction(storage, kind, targetType, id), [storage, kind, targetType, id]);
  return [on, toggle];
}

// ── Saveable(C-R5-9) — 스냅샷 조각 'reactions' = {like, helpful, updatedAt}(recheck 제외, D22) ─────────────
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

// 서버 저장 검증기와 같은 규칙(server/src/shared/save-validate.ts = 별칭 @ws/save-validate — SLUG_RE · HELPFUL_KEY_RE · ISO_RE · iso() ·
//   MAX_REACTIONS · saveV1() reactions). 규칙 밖 레코드는 export 에서 뺀다 — 손상 레코드 1개로 PUT 전체가 400 이 되지 않게(QA-M D2).
const LIKE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HELPFUL_KEY_RE = /^(SUPPLY_ITEM|BUNDLE|PRODUCT):[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_SAVED_REACTIONS = 500;
const EPOCH_ISO = new Date(0).toISOString();

function isIso(v: unknown): v is string {
  return typeof v === 'string' && ISO_RE.test(v) && Number.isFinite(Date.parse(v));
}

/** 키·값 규칙을 통과한 레코드만, 많으면 최근(시각 큰 순) MAX_SAVED_REACTIONS 개. */
function exportMap(m: Record<string, string>, keyRe: RegExp): Record<string, string> {
  const ok = Object.entries(m).filter(([k, v]) => keyRe.test(k) && isIso(v));
  ok.sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
  return Object.fromEntries(ok.slice(0, MAX_SAVED_REACTIONS));
}

/** ws.reactions → 스냅샷 조각. import 는 검증 통과 시에만 like·helpful·updatedAt 을 쓰고 로컬 recheck 는 그대로 둔다. */
export function createReactionSaveable(storage: WsStorage = wsStorage): Saveable<SavePayloads['reactions']> {
  return {
    key: 'reactions',
    export() {
      const r = readReactions(storage);
      return {
        like: exportMap(r.like, LIKE_KEY_RE),
        helpful: exportMap(r.helpful, HELPFUL_KEY_RE),
        updatedAt: isIso(r.updatedAt) ? r.updatedAt : EPOCH_ISO,
      };
    },
    import(p) {
      if (!isObj(p) || typeof p.updatedAt !== 'string' || !ISO_RE.test(p.updatedAt)) return;
      if (!isObj(p.like) || !isObj(p.helpful)) return;
      const cur = readReactions(storage);
      const next: ReactionsV1 = { v: 1, like: cleanMap(p.like), helpful: cleanMap(p.helpful), recheck: cur.recheck, updatedAt: p.updatedAt };
      storage.set(REACTIONS_KEY, JSON.stringify(next));
      emit();
    },
    subscribe(fn) {
      return subscribe(fn);
    },
  };
}

// ── ♥ 공개 수(C-R5-3 · D9) — L7 에서만 조회. 10 미만·형식 밖은 null(숫자 표시 안 함). 노출·정렬에 쓰지 않는다(③). ──
export const LIKE_PUBLIC_MIN = 10;

/** 응답 값 → 표시 가능한 수(정수 ≥ 10) 또는 null. */
export function publicLikeCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= LIKE_PUBLIC_MIN ? v : null;
}

/** 테스트는 get 을 바꿔 끼운다. 동일 출처 상대 경로, 실패 = 빈 결과. */
export const reactionCounts = {
  get(ids: string[]): Promise<Record<string, number | null>> {
    const valid = ids.filter(isWsId).slice(0, 20);
    if (valid.length === 0 || typeof fetch !== 'function') return Promise.resolve({});
    const url = `${ENDPOINT}/counts?targetType=PRODUCT&ids=${valid.map(encodeURIComponent).join(',')}`;
    try {
      return fetch(url, { credentials: 'same-origin' })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: unknown) => {
          const out: Record<string, number | null> = {};
          const counts = isObj(body) && isObj(body.counts) ? body.counts : {};
          for (const id of valid) out[id] = publicLikeCount(counts[id]);
          return out;
        })
        .catch(() => ({}));
    } catch {
      return Promise.resolve({});
    }
  },
};
