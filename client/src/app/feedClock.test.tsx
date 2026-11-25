// 377 S1 — 문서·탭 캐시가 남아 있어도 클라 시계로 다시 재서 만료 가격·블록을 지운다(fail-closed).
//   「SW·bfcache 가 준 옛 full 문서」= full ws-data 를 72h+1ms / 168h+1ms 에 그린다. 합성 fixture·모의 fetch 만.
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { COPY } from '@ws/copy';
import type { WsFeedData } from '@ws/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { feedDeps, resetFeedCacheForTest } from '../supply/feedBlock';
import { golden, pageOf, req } from '../test/fixtures';
import { layerStore } from '../ui/layer/useLayer';
import { feedClock, useLivePage } from './feedClock';
import { NO_CAPTURE } from './staticCapture';

const H = 3_600_000;
const FRESH = Date.UTC(2026, 10, 23, 0, 12, 0);
const PRICE_OR_DATE = /12,?900|\d\s*원 ·|11월 23일|₩|KRW/;

const doc = (): WsFeedData => ({
  v: 1,
  stage: 'full',
  freshMs: FRESH,
  priceCheckedOn: '2026-11-23',
  items: ['wheel'],
  rail: [{ supplyItemId: 'wheel', provider: 'COUPANG', title: '몰 원문 상품명', url: 'https://link.coupang.com/a/Mk1x', imageUrl: null, price: { amount: 12900, currency: 'KRW' }, verdict: 'OK', specValues: {} }],
});

function page() {
  const r = req('wheel', 'REQUIRED', '쳇바퀴');
  const p = pageOf('TYPE', { types: [golden], requirements: [r], products: [] }, { typeId: golden.id, path: '/hamster/golden' });
  p.data.feed = doc();
  return p;
}

const row = { provider: 'COUPANG', title: '햄스터 쳇바퀴 30cm', url: 'https://link.coupang.com/a/Mk2x', imageUrl: null, verdict: 'OK', specValues: {} };
const base = { v: 1, typeId: golden.id, supplyItemId: 'wheel', badge: 'LISTED_PASS', generalInfo: false };
const paths: string[] = [];

let now = FRESH + H;
beforeEach(() => {
  now = FRESH + H;
  paths.length = 0;
  localStorage.clear();
  resetFeedCacheForTest();
  vi.spyOn(feedClock, 'now').mockImplementation(() => now);
  vi.spyOn(feedDeps, 'fetch').mockImplementation(async (p) => {
    paths.push(p);
    const body = p.endsWith('.noprice.json')
      ? { ...base, rows: [row] }
      : { ...base, priceCheckedOn: '2026-11-23', rows: [{ ...row, price: { amount: 12900, currency: 'KRW' } }] };
    return new Response(JSON.stringify(body), { status: 200 });
  });
});
afterEach(() => {
  cleanup();
  act(() => layerStore.resetForTest());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const cards = () => document.querySelectorAll('li.ws-feed-card');
const l4 = () => document.querySelector('[role="dialog"] [data-ws-part="feed"]');
const openL4 = () => act(() => layerStore.open('L4', { typeId: golden.id, itemId: 'wheel' }));
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });

describe('옛 full 문서를 만료 뒤에 그림', () => {
  it('72h 안: 가격이 보인다(대조군)', () => {
    now = FRESH + 72 * H;
    render(<App page={page()} captured={NO_CAPTURE} />);
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toMatch(/12,900원/);
  });

  it('72h+1ms: 카드는 남고 가격·확인일·가격 안내 0, L4 는 noprice 파일을 읽는다', async () => {
    now = FRESH + 72 * H + 1;
    render(<App page={page()} captured={NO_CAPTURE} />);
    expect(cards()).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(PRICE_OR_DATE);
    expect(document.body.textContent).not.toContain(COPY.feed.homeLead);
    openL4();
    await vi.waitFor(() => expect(l4()?.querySelector('li.ws-feed-row')).toBeTruthy());
    expect(paths).toEqual(['/hamster/golden/feed/wheel.noprice.json']);
    expect(document.body.textContent).not.toMatch(PRICE_OR_DATE);
  });

  it('168h+1ms: 피드 카드·피드 고지·L4 블록·요청 0', async () => {
    now = FRESH + 168 * H + 1;
    render(<App page={page()} captured={NO_CAPTURE} />);
    openL4();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    await flush();
    expect(cards()).toHaveLength(0);
    expect(l4()).toBeNull();
    expect(document.querySelector('[data-ws-aff="note-feed"]')).toBeNull();
    expect(paths).toEqual([]);
  });
});

describe('열어 둔 탭', () => {
  it('타이머가 72h·168h 를 넘기면 가격 → 블록 순서로 사라진다(탭 캐시의 full 블록도)', async () => {
    vi.useFakeTimers();
    now = FRESH + 72 * H - 1000;
    render(<App page={page()} captured={NO_CAPTURE} />);
    openL4();
    for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(l4()?.textContent).toMatch(/12,900원/);

    now = FRESH + 72 * H + 1;
    for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
    expect(document.body.textContent).not.toMatch(PRICE_OR_DATE);
    expect(cards()).toHaveLength(1);

    now = FRESH + 168 * H + 1;
    await act(async () => { await vi.advanceTimersByTimeAsync(96 * H); });
    expect(cards()).toHaveLength(0);
    expect(l4()).toBeNull();
  });

  it('렌더와 effect 사이에 72h·168h 를 넘겨도 그 자리에서 다시 그린다(378 D1)', () => {
    for (const [limit, stage] of [[72, 'noprice'], [168, undefined]] as const) {
      now = FRESH + limit * H + 1;
      vi.mocked(feedClock.now).mockReturnValueOnce(FRESH + limit * H); // 첫 렌더만 기한 직전
      const p = page(); // 참조 고정 — App 의 다른 재렌더에 가려지지 않게 hook 만 그린다
      const { result } = renderHook(() => useLivePage(p));
      expect(result.current.data.feed?.stage, `${limit}h`).toBe(stage);
      cleanup();
    }
  });

  it('잠들었던 탭: visibilitychange·pageshow 에서 바로 다시 잰다', () => {
    for (const [target, type] of [[document, 'visibilitychange'], [window, 'pageshow']] as const) {
      now = FRESH + H;
      render(<App page={page()} captured={NO_CAPTURE} />);
      expect(document.body.textContent).toMatch(/12,900원/);
      now = FRESH + 72 * H + 1;
      act(() => {
        target.dispatchEvent(new Event(type));
      });
      expect(document.body.textContent, type).not.toMatch(PRICE_OR_DATE);
      cleanup();
    }
  });
});
