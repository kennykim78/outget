// 362 N10 — L4 아래층 「많이 찾는 상품」 피드 블록 읽기(364 §3.2 · 367 §1-1). 같은 오리진 정적 JSON 만(feedJsonPath) — 외부 호스트 fetch 0(불변식 ①).
//   읽는 조건: 이 문서 ws-data 에 data.feed 가 있고(피드 변형 페이지) items 에 그 품목이 있을 때만. 그 밖엔 fetch 0·블록 0.
//   FOOD/HEALTH 품목(engine FEED_EXCLUDED_CATEGORIES)은 items 에 있어도 읽지 않는다(서버 selectFeedRows 와 같은 규칙, 방어 심화).
//   응답 검사는 fail-closed(형식이 하나라도 어긋나면 블록 전체를 버린다 — 「실패」 상태, 행 0):
//     키 집합 정확 · 단계(noprice 면 priceCheckedOn·price 키 자체가 없어야) · 링크 isFeedLink · 이미지 isFeedImageUrl ·
//     GENERAL_INFO(D-7 — 블록·요구사항·타입 중 하나라도)면 LISTED_PASS 거부 · 알리 행 거부(고지 문안 Kenny 결정 전, 프리렌더 feed.ts 와 같은 막음).
//   이 파일은 HomeB(클라 순서 모듈)가 import 하지 않는다 — 홈 레일 데이터는 pageData isWsFeedData 가 이미 검사했다.
import { useCallback, useEffect, useState } from 'react';
import {
  FEED_EXCLUDED_CATEGORIES,
  FEED_SCREEN_ROWS,
  feedCheckedParts,
  feedJsonPath,
  isFeedImageUrl,
  isFeedLink,
  type PublicAnimalType,
  type PublicFeedBlock,
  type PublicFeedRow,
  type PublicRequirement,
  type WsPageData,
} from '@ws/engine';

type Stage = 'full' | 'noprice';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const ks = Object.keys(o);
  return ks.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

const ROW_KEYS = ['provider', 'title', 'url', 'imageUrl', 'verdict', 'specValues'] as const;
const ROW_KEYS_PRICE = ['provider', 'title', 'url', 'imageUrl', 'price', 'verdict', 'specValues'] as const;
const BLOCK_KEYS = ['v', 'typeId', 'supplyItemId', 'badge', 'generalInfo', 'rows'] as const;
const BLOCK_KEYS_FULL = ['v', 'typeId', 'supplyItemId', 'badge', 'generalInfo', 'priceCheckedOn', 'rows'] as const;

function isPrice(v: unknown): boolean {
  if (v === null) return true;
  return isRecord(v) && exactKeys(v, ['amount', 'currency']) && Number.isSafeInteger(v.amount) && (v.amount as number) > 0 && v.currency === 'KRW';
}

function isSpecValues(v: unknown): boolean {
  if (v === null) return true;
  if (!isRecord(v)) return false;
  return Object.entries(v).every(
    ([k, x]) => /^[A-Za-z][A-Za-z0-9]*$/.test(k) && (typeof x === 'boolean' || typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))),
  );
}

function isRow(v: unknown, full: boolean): v is PublicFeedRow {
  if (!isRecord(v) || !exactKeys(v, full ? ROW_KEYS_PRICE : ROW_KEYS)) return false;
  // 알리 행: 고지 문안(364 §9 K2) 전 — 프리렌더는 빌드 오류, 클라는 블록 거부.
  if (v.provider !== 'COUPANG') return false;
  if (typeof v.title !== 'string' || v.title.trim() === '') return false;
  if (!isFeedLink(v.provider, v.url)) return false;
  if (v.imageUrl !== null && !isFeedImageUrl(v.provider, v.imageUrl)) return false;
  if (full && !isPrice(v.price)) return false;
  if (v.verdict !== null && v.verdict !== 'OK' && v.verdict !== 'BELOW_RECOMMENDED') return false;
  return isSpecValues(v.specValues);
}

export interface FeedExpect {
  typeId: string;
  itemId: string;
  stage: Stage;
  /** 요구사항·타입 중 하나라도 일반 참고 정보(D-7)면 true — LISTED_PASS 거부. */
  generalInfo: boolean;
}

/** 피드 JSON 검사(fail-closed). 맞으면 블록, 아니면 null. */
export function parseFeedBlock(raw: unknown, ex: FeedExpect): PublicFeedBlock | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const full = ex.stage === 'full';
  if (!exactKeys(raw, full ? BLOCK_KEYS_FULL : BLOCK_KEYS)) return null;
  if (raw.typeId !== ex.typeId || raw.supplyItemId !== ex.itemId) return null;
  if (raw.badge !== 'LISTED_PASS' && raw.badge !== 'CHECK_NEEDED') return null;
  if (typeof raw.generalInfo !== 'boolean') return null;
  if (raw.badge === 'LISTED_PASS' && (raw.generalInfo || ex.generalInfo)) return null;
  if (full && feedCheckedParts(raw.priceCheckedOn) === null) return null;
  const rows = raw.rows;
  if (!Array.isArray(rows) || rows.length > FEED_SCREEN_ROWS) return null;
  if (!rows.every((r) => isRow(r, full))) return null;
  return raw as unknown as PublicFeedBlock;
}

/** 같은 오리진 상대 경로만(「/」 하나로 시작, 스킴·「//」·역슬래시 0). feedJsonPath 결과를 한 번 더 확인한다. */
export function isSameOriginPath(p: string): boolean {
  return /^\/[a-z0-9][a-z0-9/._-]*\.json$/.test(p) && !p.includes('//') && !p.includes('..');
}

/** 이 L4 가 피드 JSON 을 읽을 경로 — 읽지 않을 조건이면 null(fetch 0). */
export function feedPathFor(page: WsPageData, type: PublicAnimalType | null, r: PublicRequirement | null): string | null {
  const feed = page.data.feed;
  if (!feed || !type || !r) return null;
  if (!feed.items.includes(r.supplyItemId)) return null;
  if (FEED_EXCLUDED_CATEGORIES.includes(r.item.category)) return null;
  const p = feedJsonPath(type.slug, r.supplyItemId, feed.stage);
  return isSameOriginPath(p) ? p : null;
}

/** 푸터 고지 F 의 피드 몫(서버 feedLinksOn 과 같은 규칙): 홈 레일 카드 ≥ 1, 또는 열린 L4 품목이 data.feed.items 에 있음. */
export function feedFooterOn(page: WsPageData, open: { kind: string; props: Readonly<Record<string, unknown>> } | null): boolean {
  const feed = page.data.feed;
  if (!feed) return false;
  if (feed.rail.length > 0) return true;
  return open !== null && open.kind === 'L4' && typeof open.props.itemId === 'string' && feed.items.includes(open.props.itemId);
}

export type FeedState = { kind: 'none' } | { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; block: PublicFeedBlock };

type Outcome = { kind: 'none' } | { kind: 'error' } | { kind: 'ready'; block: PublicFeedBlock };

/** 시험 주입 지점(네트워크 모의). 기본 = 전역 fetch(같은 오리진 상대 경로만 넘어온다). */
export const feedDeps = {
  fetch: (path: string): Promise<Response> => fetch(path, { credentials: 'same-origin' }),
};

const cache = new Map<string, Promise<Outcome>>();

export function resetFeedCacheForTest(): void {
  cache.clear();
}

function load(path: string, ex: FeedExpect): Promise<Outcome> {
  const key = `${path}|${ex.generalInfo ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async (): Promise<Outcome> => {
    let res: Response;
    try {
      res = await feedDeps.fetch(path);
    } catch {
      return { kind: 'error' };
    }
    // 404(만료·목록 밖) → 블록 통째로 제거(오류 표시 0, 364 §3.2).
    if (res.status === 404) return { kind: 'none' };
    if (!res.ok) return { kind: 'error' };
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      return { kind: 'error' };
    }
    const block = parseFeedBlock(raw, ex);
    if (block === null) return { kind: 'error' };
    return block.rows.length === 0 ? { kind: 'none' } : { kind: 'ready', block };
  })();
  cache.set(key, p);
  // 실패는 캐시에 남기지 않는다(다시 시도하기가 새 요청을 보낸다).
  void p.then((o) => {
    if (o.kind === 'error') cache.delete(key);
  });
  return p;
}

/** L4 피드 상태. path 가 null 이면 항상 none(요청 안 함). */
export function useFeedBlock(path: string | null, ex: Omit<FeedExpect, 'stage'> & { stage: Stage | null }): { state: FeedState; retry(): void } {
  const [state, setState] = useState<FeedState>(path === null ? { kind: 'none' } : { kind: 'loading' });
  const [nonce, setNonce] = useState(0);
  const { typeId, itemId, stage, generalInfo } = ex;
  useEffect(() => {
    if (path === null || stage === null) {
      setState({ kind: 'none' });
      return;
    }
    let live = true;
    setState({ kind: 'loading' });
    void load(path, { typeId, itemId, stage, generalInfo }).then((o) => {
      if (live) setState(o);
    });
    return () => {
      live = false;
    };
  }, [path, typeId, itemId, stage, generalInfo, nonce]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { state, retry };
}
