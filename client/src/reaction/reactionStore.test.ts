// reaction/reactionStore — ws.reactions v1(D8): 👍 helpful · ⚠ recheck · ♥ like 독립 토글, 서버 POST/DELETE(동일 출처), 실패 무시.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage } from '../lib/storage';
import {
  MAX_SAVED_REACTIONS,
  REACTIONS_KEY,
  createReactionSaveable,
  publicLikeCount,
  reactionApi,
  readReactions,
  reactionKey,
  toggleReaction,
} from './reactionStore';

/**
 * 서버 SaveV1 reactions 검증 규칙의 거울(server/src/save/validate.ts — 클라 eslint 가 server/ 직접 import 를 막아 복제):
 *   :12 MAX_REACTIONS 500 · :26 SLUG_RE(like 키) · :27 HELPFUL_KEY_RE · :28 ISO_RE + :105-108 iso()(Date.parse 유한) ·
 *   :186-203 reactions = exactKeys(like, helpful, updatedAt), record(..., MAX_REACTIONS, key, iso), updatedAt isoOrNull.
 */
function serverAcceptsReactions(r: unknown): boolean {
  const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const HELPFUL = /^(SUPPLY_ITEM|BUNDLE|PRODUCT):[a-z0-9][a-z0-9-]{0,63}$/;
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
  const iso = (v: unknown) => typeof v === 'string' && ISO.test(v) && Number.isFinite(Date.parse(v));
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (!isObj(r)) return false;
  if (Object.keys(r).sort().join(',') !== 'helpful,like,updatedAt') return false;
  const rec = (x: unknown, key: RegExp) =>
    isObj(x) && Object.keys(x).length <= 500 && Object.entries(x).every(([k, v]) => key.test(k) && iso(v));
  return rec(r.like, SLUG) && rec(r.helpful, HELPFUL) && (r.updatedAt === null || iso(r.updatedAt));
}

function memStorage() {
  const m = new Map<string, string>();
  const backend = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
  } as unknown as Storage;
  return { storage: createStorage(() => backend), m };
}

describe('reactionStore', () => {
  const send = vi.fn(() => Promise.resolve());
  beforeEach(() => {
    send.mockClear();
    vi.spyOn(reactionApi, 'send').mockImplementation(send);
  });
  afterEach(() => vi.restoreAllMocks());

  it('빈 저장소 = 빈 v1, 키 형식 SUPPLY_ITEM:{id}', () => {
    const { storage } = memStorage();
    expect(readReactions(storage)).toMatchObject({ v: 1, like: {}, helpful: {}, recheck: {} });
    expect(reactionKey('helpful', 'SUPPLY_ITEM', 'wheel')).toBe('SUPPLY_ITEM:wheel');
    expect(reactionKey('like', 'PRODUCT', 'p1')).toBe('p1');
  });

  it('토글: 켜기 → POST, 끄기 → DELETE, 👍·⚠ 독립', () => {
    const { storage, m } = memStorage();
    expect(toggleReaction(storage, 'helpful', 'SUPPLY_ITEM', 'wheel')).toBe(true);
    expect(toggleReaction(storage, 'recheck', 'SUPPLY_ITEM', 'wheel')).toBe(true);
    let r = readReactions(storage);
    expect(Object.keys(r.helpful)).toEqual(['SUPPLY_ITEM:wheel']);
    expect(Object.keys(r.recheck)).toEqual(['SUPPLY_ITEM:wheel']);
    expect(toggleReaction(storage, 'helpful', 'SUPPLY_ITEM', 'wheel')).toBe(false);
    r = readReactions(storage);
    expect(r.helpful).toEqual({});
    expect(Object.keys(r.recheck)).toHaveLength(1);
    expect(send.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['POST', 'POST', 'DELETE']);
    expect((send.mock.calls[0] as unknown[])[1]).toEqual({ targetType: 'SUPPLY_ITEM', targetId: 'wheel', kind: 'HELPFUL' });
    expect(m.has(REACTIONS_KEY)).toBe(true);
  });

  it('Saveable: key reactions, export = like·helpful·updatedAt(recheck 제외), import 는 로컬 recheck 유지, 깨진 값 무시, subscribe', () => {
    const { storage } = memStorage();
    toggleReaction(storage, 'like', 'PRODUCT', 'p1');
    toggleReaction(storage, 'recheck', 'SUPPLY_ITEM', 'wheel');
    const s = createReactionSaveable(storage);
    expect(s.key).toBe('reactions');
    const out = s.export();
    expect(Object.keys(out).sort()).toEqual(['helpful', 'like', 'updatedAt']);
    expect(Object.keys(out.like)).toEqual(['p1']);
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.import({ like: { p9: '2026-10-02T00:00:00.000Z' }, helpful: { 'SUPPLY_ITEM:cage': '2026-10-02T00:00:00.000Z' }, updatedAt: '2026-10-02T00:00:00.000Z' });
    expect(fn).toHaveBeenCalledTimes(1);
    const r = readReactions(storage);
    expect(Object.keys(r.like)).toEqual(['p9']);
    expect(Object.keys(r.helpful)).toEqual(['SUPPLY_ITEM:cage']);
    expect(Object.keys(r.recheck)).toEqual(['SUPPLY_ITEM:wheel']);
    expect(r.updatedAt).toBe('2026-10-02T00:00:00.000Z');
    s.import({ like: 'x', helpful: {}, updatedAt: 'nope' } as never);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });

  it('QA-M D2: 손상 레코드는 export 에서 빠지고, 결과는 서버 검증기 규칙(validate.ts reactions)을 통과한다', () => {
    const { storage, m } = memStorage();
    const T = '2026-10-02T00:00:00.000Z';
    m.set(
      REACTIONS_KEY,
      JSON.stringify({
        v: 1,
        // like: slug 키만(접두 키·잘못된 시각 제외)
        like: { p1: T, 'PRODUCT:p2': T, p3: 'yesterday', p4: '2026-13-45T99:99:99Z' },
        // helpful: 접두 필수(접두 없는 키·잘못된 시각 제외)
        helpful: { 'SUPPLY_ITEM:wheel': T, wheel: T, 'BUNDLE:b1': 'x', 'PRODUCT:p1': T },
        recheck: { 'SUPPLY_ITEM:wheel': T },
        updatedAt: 'not-a-date',
      }),
    );
    const out = createReactionSaveable(storage).export();
    expect(out.like).toEqual({ p1: T });
    expect(out.helpful).toEqual({ 'SUPPLY_ITEM:wheel': T, 'PRODUCT:p1': T });
    expect(out.updatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(serverAcceptsReactions(out)).toBe(true);
    // 대조: 정리 전 원본은 서버 규칙에 걸린다.
    expect(serverAcceptsReactions({ like: { 'PRODUCT:p2': T }, helpful: {}, updatedAt: T })).toBe(false);
  });

  it('QA-M D2: 500 개 초과면 최근 500 개만(서버 MAX_REACTIONS)', () => {
    const { storage, m } = memStorage();
    const like: Record<string, string> = {};
    for (let i = 0; i < 520; i++) like[`p${i}`] = new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString();
    m.set(REACTIONS_KEY, JSON.stringify({ v: 1, like, helpful: {}, recheck: {}, updatedAt: '2026-10-02T00:00:00.000Z' }));
    const out = createReactionSaveable(storage).export();
    expect(Object.keys(out.like)).toHaveLength(MAX_SAVED_REACTIONS);
    expect(out.like.p519).toBeDefined();
    expect(out.like.p0).toBeUndefined();
    expect(serverAcceptsReactions(out)).toBe(true);
  });

  it('publicLikeCount: 정수 ≥10 만, 그 외 null', () => {
    expect([null, undefined, 0, 9, 9.5, '12', 10, 11].map(publicLikeCount)).toEqual([null, null, null, null, null, null, 10, 11]);
  });

  it('잘못된 id 는 무시(쓰기·전송 0), 깨진 저장값 = 빈 v1', () => {
    const { storage, m } = memStorage();
    expect(toggleReaction(storage, 'helpful', 'SUPPLY_ITEM', 'Bad Id!')).toBe(false);
    expect(send).not.toHaveBeenCalled();
    m.set(REACTIONS_KEY, '{broken');
    expect(readReactions(storage).helpful).toEqual({});
  });
});
