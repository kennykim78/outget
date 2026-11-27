// 362 N10 L4 아래층 「많이 찾는 상품」(364 §2.1·§3.1·§3.2, 367 §1). 합성 fixture·모의 fetch 만(실호출·키 0).
//   요청 조건(data.feed.items ∋ 품목 · FOOD/HEALTH 제외) · 같은 오리진 상대 경로 · 로딩/404/실패/다시 시도 · products 뒤 자리 ·
//   ○·ws-badge·ws-product 0 · rel sponsored+noopener · referrerpolicy · 이미지 실패 → PhotoTile · GENERAL_INFO 블록 0(398 불변식 7) ·
//   noprice(72h 초과) 가격·확인일이 어떤 표기(원·₩·KRW·날짜 형식)로도 DOM 에 0.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COPY } from '@ws/copy';
import type { PublicFeedBlock, PublicRequirement, WsFeedData, WsPageData } from '@ws/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feedClock } from '../app/feedClock';
import { LayerPageProvider } from '../app/layerPage';
import { layerRegistry, layerWsId } from '../app/layerRegistry';
import { reactionApi } from '../reaction/reactionStore';
import { golden, pageOf, product, req } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';
import { feedDeps, feedFooterOn, feedPathFor, isSameOriginPath, parseFeedBlock, resetFeedCacheForTest } from './feedBlock';
import { compatDeps } from './useCageCompat';

const loadSpecCatalogMock = vi.hoisted(() => vi.fn());
vi.mock('../speccheck/engine', async (orig) => ({ ...(await orig<typeof import('../speccheck/engine')>()), loadSpecCatalog: loadSpecCatalogMock }));

const SCHEMA = {
  fields: [
    { key: 'diameterCm', label: '지름(cm)', type: 'number' as const, min: 1, max: 100 },
  ],
};

function wheel(over: Partial<PublicRequirement> = {}): PublicRequirement {
  const base = req('wheel', 'REQUIRED', '쳇바퀴');
  return {
    ...base,
    minSpec: { rules: [{ key: 'diameterCm', op: 'gte', value: 28, reason: 'r' }] },
    item: { ...base.item, category: 'ACCESSORY' as PublicRequirement['item']['category'], specSchema: SCHEMA },
    photo: { photoId: 'ph-fx-wheel', asset: '/assets/items/fx-wheel.webp' },
    ...over,
  };
}

const FRESH = Date.UTC(2026, 10, 23, 0, 12, 0);
const FULL: WsFeedData = { v: 1, stage: 'full', freshMs: FRESH, priceCheckedOn: '2026-11-23', items: ['wheel'], rail: [] };
const NOPRICE: WsFeedData = { v: 1, stage: 'noprice', freshMs: FRESH, items: ['wheel'], rail: [] };

function rowFull(n: number, over: Record<string, unknown> = {}) {
  return {
    provider: 'COUPANG',
    title: `햄스터 쳇바퀴 30cm 통면 ${n}호`,
    url: `https://link.coupang.com/a/Mk${n}x`,
    imageUrl: null,
    price: { amount: 12900, currency: 'KRW' },
    verdict: 'OK',
    specValues: { diameterCm: 30 },
    ...over,
  };
}
function rowNoprice(n: number, over: Record<string, unknown> = {}) {
  const { price: _p, ...rest } = rowFull(n, over);
  void _p;
  return rest;
}
function blockFull(rows: Array<Record<string, unknown>> = [1, 2, 3].map((n) => rowFull(n)), over: Record<string, unknown> = {}) {
  return { v: 1, typeId: golden.id, supplyItemId: 'wheel', badge: 'LISTED_PASS', generalInfo: false, priceCheckedOn: '2026-11-23', rows, ...over };
}
function blockNoprice(rows: Array<Record<string, unknown>> = [1, 2, 3].map((n) => rowNoprice(n)), over: Record<string, unknown> = {}) {
  return { v: 1, typeId: golden.id, supplyItemId: 'wheel', badge: 'LISTED_PASS', generalInfo: false, rows, ...over };
}

function pageWith(feed: WsFeedData | undefined, r: PublicRequirement = wheel(), products = [product('p1', 'wheel')], type = golden): WsPageData {
  const p = pageOf('TYPE', { types: [type], requirements: [r], products }, { typeId: type.id, path: '/hamster/golden' });
  if (feed) p.data.feed = feed;
  return p;
}

const fetchMock = vi.fn<(path: string) => Promise<Response>>();
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.spyOn(feedClock, 'now').mockReturnValue(FRESH + 3_600_000);
  window.localStorage.clear();
  resetFeedCacheForTest();
  fetchMock.mockReset();
  vi.spyOn(feedDeps, 'fetch').mockImplementation((p) => fetchMock(p));
  vi.spyOn(reactionApi, 'send').mockResolvedValue(undefined);
  loadSpecCatalogMock.mockReset();
  loadSpecCatalogMock.mockRejectedValue(new Error('no catalog in test'));
  vi.spyOn(compatDeps, 'load').mockRejectedValue(new Error('no catalog in test'));
});

afterEach(() => {
  cleanup();
  act(() => layerStore.resetForTest());
  vi.restoreAllMocks();
});

function openL4(page: WsPageData, itemId = 'wheel'): HTMLElement {
  render(
    <LayerPageProvider page={page}>
      <LayerHost registry={layerRegistry} wsIdFor={(k, p) => layerWsId(page, k, p)} />
    </LayerPageProvider>,
  );
  act(() => layerStore.open('L4', { typeId: golden.id, itemId }));
  return screen.getByRole('dialog');
}

/** waitFor 가 null 을 바로 돌려주지 않도록 — 요소가 생길 때까지 기다린다. */
const waitEl = (find: () => Element | null | undefined) =>
  waitFor(() => {
    const el = find();
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
const feedSec = (d: HTMLElement) => d.querySelector('section[data-ws-part="feed"]');
const parts = (d: HTMLElement) => Array.from(d.querySelectorAll('[data-ws-part]')).map((el) => el.getAttribute('data-ws-part'));

/** 가격·확인일이 어떤 표기로든 나오는가 — 원·₩·KRW·통화 코드·「N월 N일」·YYYY-MM-DD·YYYY.MM.DD·YYYY/MM/DD·MM/DD·「확인」. */
const PRICE_OR_DATE = /\d[\d,]*\s*원|₩|￦|KRW|\bwon\b|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}|\b\d{1,2}\/\d{1,2}\b|12,?900|확인\s*·|몰에서 달라질/i;

describe('362 N10 feedBlock 순수 규칙', () => {
  it('피드 없는 문서(기본 파일)·items 밖 품목·FOOD/HEALTH 품목 → 경로 null(fetch 0)', () => {
    expect(feedPathFor(pageWith(undefined), golden, wheel())).toBeNull();
    expect(feedPathFor(pageWith({ ...FULL, items: ['cage'] }), golden, wheel())).toBeNull();
    for (const category of ['FOOD', 'HEALTH']) {
      const r = wheel({ item: { ...wheel().item, category: category as PublicRequirement['item']['category'] } });
      expect(feedPathFor(pageWith(FULL, r), golden, r)).toBeNull();
    }
  });

  it('경로는 같은 오리진 상대 경로뿐(단계별 파일)', () => {
    expect(feedPathFor(pageWith(FULL), golden, wheel())).toBe('/hamster/golden/feed/wheel.json');
    expect(feedPathFor(pageWith(NOPRICE), golden, wheel())).toBe('/hamster/golden/feed/wheel.noprice.json');
    for (const bad of ['https://evil.example/x.json', '//evil.example/x.json', '/a/../b.json', '/a//b.json', 'a/b.json', '/a/b.json?x=1'])
      expect(isSameOriginPath(bad), bad).toBe(false);
  });

  it('검사 fail-closed: 키 추가·단계 어긋남·링크/이미지 호스트·알리·GENERAL_INFO LISTED_PASS·7행 → null', () => {
    const ex = { typeId: golden.id, itemId: 'wheel', stage: 'full' as const, generalInfo: false };
    expect(parseFeedBlock(blockFull(), ex)).not.toBeNull();
    expect(parseFeedBlock({ ...blockFull(), commission: 1 }, ex)).toBeNull();
    expect(parseFeedBlock(blockFull([rowFull(1, { rank: 1 })]), ex)).toBeNull();
    expect(parseFeedBlock(blockNoprice(), ex)).toBeNull(); // full 인데 확인일 없음
    expect(parseFeedBlock(blockFull([rowFull(1, { url: 'https://www.coupang.com/vp/products/1' })]), ex)).toBeNull();
    expect(parseFeedBlock(blockFull([rowFull(1, { imageUrl: 'https://evil.example/a.jpg' })]), ex)).toBeNull();
    expect(parseFeedBlock(blockFull([rowFull(1, { provider: 'ALIEXPRESS', url: 'https://s.click.aliexpress.com/e/_abcd1' })]), ex)).toBeNull();
    expect(parseFeedBlock(blockFull([rowFull(1, { price: { amount: 12900, currency: 'USD' } })]), ex)).toBeNull();
    expect(parseFeedBlock(blockFull(undefined, { generalInfo: true }), ex)).toBeNull();
    expect(parseFeedBlock(blockFull(), { ...ex, generalInfo: true })).toBeNull();
    // 398(불변식 7): GENERAL_INFO 는 CHECK_NEEDED 블록도 거부(362 D-7 「△만」 폐기)
    expect(parseFeedBlock(blockFull(undefined, { badge: 'CHECK_NEEDED', generalInfo: true }), ex)).toBeNull();
    expect(parseFeedBlock(blockFull(undefined, { badge: 'CHECK_NEEDED' }), { ...ex, generalInfo: true })).toBeNull();
    expect(parseFeedBlock(blockFull(undefined, { badge: 'CHECK_NEEDED' }), ex)).not.toBeNull();
    expect(parseFeedBlock(blockFull([1, 2, 3, 4, 5, 6, 7].map((n) => rowFull(n))), ex)).toBeNull();
    expect(parseFeedBlock(blockFull(undefined, { supplyItemId: 'cage' }), ex)).toBeNull();
    const np = { ...ex, stage: 'noprice' as const };
    expect(parseFeedBlock(blockNoprice(), np)).not.toBeNull();
    // 오래된 피드(noprice)에 가격·확인일 키가 섞여 있으면 블록 전체 거부
    expect(parseFeedBlock(blockFull(), np)).toBeNull();
    expect(parseFeedBlock(blockNoprice([rowFull(1)]), np)).toBeNull();
    expect(parseFeedBlock({ ...blockNoprice(), priceCheckedOn: '2026-11-23' }, np)).toBeNull();
  });

  it('푸터 고지 F 피드 몫 = 홈 레일 카드 ≥ 1 ∨ 열린 L4 품목 ∈ items(서버 feedLinksOn 과 같은 규칙)', () => {
    expect(feedFooterOn(pageWith(undefined), null)).toBe(false);
    expect(feedFooterOn(pageWith(FULL), null)).toBe(false);
    expect(feedFooterOn(pageWith(FULL), { kind: 'L4', props: { typeId: golden.id, itemId: 'wheel' } })).toBe(true);
    expect(feedFooterOn(pageWith(FULL), { kind: 'L4', props: { typeId: golden.id, itemId: 'cage' } })).toBe(false);
    expect(feedFooterOn(pageWith(FULL), { kind: 'L7', props: { productId: 'p1' } })).toBe(false);
  });
});

describe('380 S3 블록 제목 — popular 표지(인기순 확인 sort)일 때만 「많이 찾는 상품」', () => {
  const heading = async (block: unknown) => {
    fetchMock.mockResolvedValue(jsonRes(block));
    const d = openL4(pageWith(FULL));
    await waitEl(() => feedSec(d)?.querySelector('li.ws-feed-row'));
    return feedSec(d)?.querySelector('h3')?.textContent;
  };

  it('popular 없음(지금 모든 빌드): 「몰 검색 결과」', async () => {
    expect(await heading(blockFull())).toBe('몰 검색 결과');
  });

  it('popular: true(허용 목록 주입 빌드): 「많이 찾는 상품」', async () => {
    expect(await heading(blockFull(undefined, { popular: true }))).toBe('많이 찾는 상품');
  });

  it('popular 는 true 만 — 그 밖 값은 블록 거부(fail-closed)', () => {
    const ex = { typeId: golden.id, itemId: 'wheel', stage: 'full' as const, generalInfo: false };
    expect(parseFeedBlock(blockFull(undefined, { popular: true }), ex)).not.toBeNull();
    expect(parseFeedBlock(blockNoprice(undefined, { popular: true }), { ...ex, stage: 'noprice' })).not.toBeNull();
    for (const popular of [false, 'true', 1, null]) expect(parseFeedBlock(blockFull(undefined, { popular }), ex), String(popular)).toBeNull();
  });
});

describe('362 N10 L4 피드 블록', () => {
  it('피드 없는 문서: fetch 0, 블록 0(기존 DOM 그대로)', async () => {
    const d = openL4(pageWith(undefined));
    await act(async () => undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(feedSec(d)).toBeNull();
    expect(parts(d)).not.toContain('feed');
  });

  it('full: 로딩 → 행(≤6) · products 뒤 · 고지 1회 · ○/ws-badge/ws-product 0 · 링크 rel·새 창·고지 참조 · 가격 줄', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((res) => (resolve = res)));
    const d = openL4(pageWith(FULL));
    // 로딩: 제목 + StateBlock(고지 0)
    const loading = feedSec(d) as HTMLElement;
    expect(loading.querySelector('h3')).toHaveTextContent('몰 검색 결과');
    expect(loading.querySelector('[data-ws-state-kind="loading"] h4')).toHaveTextContent(COPY.feed.loadingTitle);
    expect(loading.querySelector('[data-ws-aff]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/hamster/golden/feed/wheel.json');
    await act(async () => resolve(jsonRes(blockFull([1, 2, 3, 4, 5, 6].map((n) => rowFull(n))))));
    const sec = await waitFor(() => {
      const s = feedSec(d) as HTMLElement;
      expect(s.querySelectorAll('li.ws-feed-row')).toHaveLength(6);
      return s;
    });
    const order = parts(d);
    expect(order.indexOf('products')).toBeLessThan(order.indexOf('feed'));
    expect(order.indexOf('feed')).toBeLessThan(order.indexOf('verified'));
    expect(sec.querySelectorAll('[data-ws-aff="note-feed"]')).toHaveLength(1);
    expect(sec.querySelector('#ws-aff-feed-wheel')).toHaveTextContent(COPY.affiliate.coupang);
    expect(sec.textContent).not.toContain('○');
    expect(sec.innerHTML).not.toMatch(/ws-badge(?!-)|ws-badge--|ws-product|data-ws-glyph="ok"/);
    expect(sec.querySelectorAll('.ws-feed-badge--listed')).toHaveLength(6);
    expect(sec.textContent).toContain(`${COPY.feed.specPrefix} · `);
    for (const a of Array.from(sec.querySelectorAll('a'))) {
      const rel = (a.getAttribute('rel') ?? '').split(/\s+/);
      expect(rel).toContain('sponsored');
      expect(rel).toContain('noopener');
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('aria-describedby', 'ws-aff-feed-wheel');
      expect(a.getAttribute('href')).toMatch(/^https:\/\/link\.coupang\.com\/a\//);
    }
    expect(sec.querySelectorAll('.ws-feed-price')).toHaveLength(6);
    expect(sec.querySelector('.ws-feed-price')).toHaveTextContent('12,900원 · 11월 23일 확인 · 몰에서 달라질 수 있어요');
    // 채운 버튼은 여전히 레이어 하단 「규격 확인」 하나
    expect(d.querySelectorAll('.ws-btn--fill')).toHaveLength(1);
  });

  it('products 0 이어도 같은 자리(대안·준비완료 뒤, 검수 앞)', async () => {
    fetchMock.mockResolvedValue(jsonRes(blockFull()));
    const d = openL4(pageWith(FULL, wheel(), []));
    await waitFor(() => expect(feedSec(d)?.querySelectorAll('li.ws-feed-row')).toHaveLength(3));
    const order = parts(d);
    expect(order).not.toContain('products');
    expect(order.indexOf('ready')).toBeLessThan(order.indexOf('feed'));
    expect(order.indexOf('feed')).toBeLessThan(order.indexOf('verified'));
  });

  it('이미지: referrerpolicy=no-referrer·loading=lazy, 실패 → 요구사항 사진 PhotoTile(글자 대체 0)', async () => {
    fetchMock.mockResolvedValue(jsonRes(blockFull([rowFull(1, { imageUrl: null })])));
    // 쿠팡 이미지 호스트는 비어 있다(FEED_IMAGE_HOSTS.COUPANG = []) — 이미지 있는 쿠팡 행은 형식 위반. null 행 = 바로 대체.
    const d = openL4(pageWith(FULL));
    const sec = await waitEl(() => feedSec(d)?.querySelector('li.ws-feed-row'));
    expect(sec.querySelector('img.ws-feed-thumb')).toBeNull();
    expect(sec.querySelector('img.ws-photo.ws-feed-photo')).toHaveAttribute('src', '/assets/items/fx-wheel.webp');
  });

  it('404 → 블록 통째로 제거(오류 표시 0) / 행 0 → 블록 0', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    const d = openL4(pageWith(FULL));
    await waitFor(() => expect(feedSec(d)).toBeNull());
    expect(d.querySelector('[data-ws-error="feed"]')).toBeNull();
    cleanup();
    act(() => layerStore.resetForTest());
    resetFeedCacheForTest();
    fetchMock.mockResolvedValue(jsonRes(blockFull([])));
    const d2 = openL4(pageWith(FULL));
    await act(async () => undefined);
    await waitFor(() => expect(feedSec(d2)).toBeNull());
  });

  it('실패(네트워크·형식) → 제목 + 오류 블록 + 테두리 「다시 시도하기」 → 새 요청으로 회복', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    const d = openL4(pageWith(FULL));
    const err = await waitEl(() => d.querySelector('[data-ws-error="feed"]'));
    expect(err.querySelector('h4')).toHaveTextContent(COPY.feed.errorTitle);
    expect(err).toHaveTextContent(COPY.feed.errorBody);
    const retry = err.querySelector('button.ws-btn.ws-btn--outline') as HTMLButtonElement;
    expect(retry).toHaveTextContent(COPY.feed.retry);
    expect(feedSec(d)?.querySelectorAll('li.ws-feed-row')).toHaveLength(0);
    expect(d.querySelectorAll('.ws-btn--fill')).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(jsonRes({ ...blockFull(), commission: 3 })); // 형식 위반도 실패
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(d.querySelector('[data-ws-error="feed"]')).not.toBeNull());
    expect(d.textContent).not.toContain('12,900');
    fetchMock.mockResolvedValueOnce(jsonRes(blockFull()));
    fireEvent.click(d.querySelector('[data-ws-error="feed"] button') as HTMLButtonElement);
    await waitFor(() => expect(feedSec(d)?.querySelectorAll('li.ws-feed-row')).toHaveLength(3));
  });

  it('GENERAL_INFO 종·요구사항(398 불변식 7): items 에 있어도 fetch 0·블록 0(「규격 확인 필요」 블록도 0)', async () => {
    const gi = { ...golden, generalInfo: true as const };
    fetchMock.mockResolvedValue(jsonRes(blockFull(undefined, { badge: 'CHECK_NEEDED', generalInfo: true })));
    const d = openL4(pageWith(FULL, wheel({ generalInfo: true } as Partial<PublicRequirement>), [], gi));
    await act(async () => undefined);
    expect(feedSec(d)).toBeNull();
    cleanup();
    act(() => layerStore.resetForTest());
    resetFeedCacheForTest();
    // 타입만 GENERAL_INFO 여도, 요구사항만 GENERAL_INFO 여도 같다
    const d2 = openL4(pageWith(FULL, wheel(), [], gi));
    await act(async () => undefined);
    expect(feedSec(d2)).toBeNull();
    cleanup();
    act(() => layerStore.resetForTest());
    resetFeedCacheForTest();
    const d3 = openL4(pageWith(FULL, wheel({ generalInfo: true } as Partial<PublicRequirement>)));
    await act(async () => undefined);
    expect(feedSec(d3)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('FOOD/HEALTH 품목: items 에 있어도 fetch 0·블록 0', async () => {
    for (const category of ['FOOD', 'HEALTH']) {
      const r = wheel({ item: { ...wheel().item, category: category as PublicRequirement['item']['category'] } });
      const d = openL4(pageWith(FULL, r));
      await act(async () => undefined);
      expect(feedSec(d)).toBeNull();
      cleanup();
      act(() => layerStore.resetForTest());
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('오래된 피드(noprice, 72h 초과): 가격·확인일이 어떤 표기(원·₩·KRW·날짜 형식)로도 DOM 에 0, 나머지는 그대로', async () => {
    // 정상 noprice JSON — 가격 키 없음
    fetchMock.mockResolvedValueOnce(jsonRes(blockNoprice()));
    const d = openL4(pageWith(NOPRICE));
    expect(fetchMock.mock.calls[0][0]).toBe('/hamster/golden/feed/wheel.noprice.json');
    const sec = await waitFor(() => {
      const s = feedSec(d) as HTMLElement;
      expect(s.querySelectorAll('li.ws-feed-row')).toHaveLength(3);
      return s;
    });
    expect(sec.querySelector('.ws-feed-price, .ws-feed-amount, .ws-feed-checked')).toBeNull();
    expect(sec.textContent).not.toMatch(PRICE_OR_DATE);
    expect(sec.querySelectorAll('a.ws-feed-go')).toHaveLength(3);
    cleanup();
    act(() => layerStore.resetForTest());
    resetFeedCacheForTest();
    // 오염된 noprice JSON — 가격을 다른 표기로 숨겨 실어도(₩·KRW·문자 금액·다른 날짜 형식) 블록 전체 거부, DOM 에 0
    const hostile = [
      { ...blockNoprice(), priceCheckedOn: '2026/11/23' },
      { ...blockNoprice(), priceCheckedOn: '11월 23일' },
      blockNoprice([{ ...rowNoprice(1), price: { amount: '₩12,900', currency: 'KRW' } }]),
      blockNoprice([{ ...rowNoprice(1), price: { amount: 12900, currency: 'KRW' } }]),
      blockNoprice([{ ...rowNoprice(1), priceText: 'KRW 12,900' }]),
      blockNoprice([{ ...rowNoprice(1), fetchedAt: '2026.11.23' }]),
      { ...blockNoprice(), checkedOn: '2026-11-23' },
    ];
    for (const body of hostile) {
      fetchMock.mockResolvedValueOnce(jsonRes(body));
      const dx = openL4(pageWith(NOPRICE));
      await waitFor(() => expect(dx.querySelector('[data-ws-error="feed"]')).not.toBeNull());
      expect(dx.querySelectorAll('li.ws-feed-row')).toHaveLength(0);
      expect((feedSec(dx) as HTMLElement).textContent).not.toMatch(PRICE_OR_DATE);
      cleanup();
      act(() => layerStore.resetForTest());
      resetFeedCacheForTest();
    }
  });

  it('같은 품목을 다시 열면 캐시(요청 1회)', async () => {
    fetchMock.mockResolvedValue(jsonRes(blockFull()));
    const page = pageWith(FULL);
    const d = openL4(page);
    await waitFor(() => expect(feedSec(d)?.querySelectorAll('li.ws-feed-row')).toHaveLength(3));
    act(() => layerStore.close());
    act(() => layerStore.open('L4', { typeId: golden.id, itemId: 'wheel' }));
    await waitFor(() => expect(screen.getByRole('dialog').querySelectorAll('li.ws-feed-row')).toHaveLength(3));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// fixture 가 PublicFeedBlock 모양을 따르는지 — 검사 통과분은 그 타입으로 돌아온다.
const _typed: PublicFeedBlock | null = parseFeedBlock(blockFull(), { typeId: golden.id, itemId: 'wheel', stage: 'full', generalInfo: false });
void _typed;
