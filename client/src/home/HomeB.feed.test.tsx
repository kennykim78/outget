// 362 N10 홈 B 「기준에 맞는 준비물」 레일 피드 카드(364 §2.2, 367 §1-2). 합성 fixture 만(실호출·키 0).
//   운영자 카드 뒤 · lead/고지는 카드 ≥ 1 일 때만 · GENERAL_INFO 종 0장 · 요구사항 밖·FOOD/HEALTH 0 · noprice 가격·확인일 0 · 푸터 고지 F.
import { act, cleanup, render } from '@testing-library/react';
import { COPY } from '@ws/copy';
import type { PublicFeedRailCard, PublicRequirement, WsFeedData } from '@ws/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { NO_CAPTURE } from '../app/staticCapture';
import { golden, pageOf, product, req } from '../test/fixtures';
import { layerStore } from '../ui/layer/useLayer';

function card(itemId: string, over: Partial<PublicFeedRailCard> = {}): PublicFeedRailCard {
  return {
    supplyItemId: itemId,
    provider: 'COUPANG',
    title: `몰 원문 상품명 ${itemId}`,
    url: `https://link.coupang.com/a/Mk${itemId}x`,
    imageUrl: null,
    price: { amount: 12900, currency: 'KRW' },
    verdict: 'OK',
    specValues: {},
    ...over,
  };
}

const food = (): PublicRequirement => {
  const r = req('pellet', 'REQUIRED', '사료');
  return { ...r, item: { ...r.item, category: 'FOOD' as PublicRequirement['item']['category'] } };
};

function page(feed: WsFeedData | undefined, products = [product('p1', 'wheel', 'A 쳇바퀴')], type = golden) {
  const p = pageOf(
    'TYPE',
    { types: [type], requirements: [req('cage', 'REQUIRED', '케이지'), req('wheel', 'REQUIRED', '쳇바퀴'), food()], products },
    { typeId: type.id, path: '/hamster/golden' },
  );
  if (feed) p.data.feed = feed;
  return p;
}

const FULL = (rail: PublicFeedRailCard[]): WsFeedData => ({ v: 1, stage: 'full', priceCheckedOn: '2026-11-23', items: rail.map((c) => c.supplyItemId), rail });
const NOPRICE = (rail: PublicFeedRailCard[]): WsFeedData => ({
  v: 1,
  stage: 'noprice',
  items: rail.map((c) => c.supplyItemId),
  rail: rail.map(({ price: _p, ...c }) => (void _p, c)),
});

const sec = () => document.querySelector('[data-ws-section="products"]') as HTMLElement | null;
const PRICE_OR_DATE = /\d[\d,]*\s*원|₩|￦|KRW|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}|12,?900/i;

beforeEach(() => {
  localStorage.clear();
  act(() => layerStore.resetForTest());
});
afterEach(() => {
  cleanup();
  act(() => layerStore.resetForTest());
});

describe('362 N10 홈 B 피드 카드', () => {
  it('피드 없는 문서: 피드 카드·피드 고지·lead 0(기존 DOM)', () => {
    render(<App page={page(undefined)} captured={NO_CAPTURE} />);
    const s = sec() as HTMLElement;
    expect(s.querySelectorAll('li.ws-feed-card')).toHaveLength(0);
    expect(document.querySelector('[data-ws-aff="note-feed"]')).toBeNull();
    expect(s.textContent).not.toContain(COPY.feed.homeLead);
  });

  it('full: 운영자 카드 뒤에 피드 카드 · lead + 고지 1회 · ○/ws-badge 0 · rel sponsored+noopener · 가격·확인일 · 푸터 F', () => {
    render(<App page={page(FULL([card('cage'), card('wheel')]))} captured={NO_CAPTURE} />);
    const s = sec() as HTMLElement;
    const lis = Array.from(s.querySelectorAll('ul li'));
    const kinds = lis.map((li) => (li.classList.contains('ws-feed-card') ? 'feed' : 'op'));
    expect(kinds).toEqual(['op', 'feed', 'feed']);
    expect(s.textContent).toContain(COPY.feed.homeLead);
    expect(document.querySelectorAll('#ws-aff-feed-home')).toHaveLength(1);
    const feedCards = Array.from(s.querySelectorAll('li.ws-feed-card'));
    for (const c of feedCards) {
      expect(c.textContent).not.toContain('○');
      expect(c.innerHTML).not.toMatch(/ws-badge(?!-)|ws-badge--|data-ws-glyph="ok"/);
      expect(c.querySelector('.ws-feed-badge--listed')).toHaveTextContent(COPY.feed.badgeListed);
      const a = c.querySelector('a.ws-feed-go') as HTMLAnchorElement;
      const rel = (a.getAttribute('rel') ?? '').split(/\s+/);
      expect(rel).toEqual(expect.arrayContaining(['sponsored', 'noopener']));
      expect(a).toHaveAttribute('aria-describedby', 'ws-aff-feed-home');
      expect(c.querySelector('.ws-feed-amount')).toHaveTextContent('12,900원');
      expect(c.querySelector('.ws-feed-checked')).toHaveTextContent('11월 23일 확인');
    }
    expect(feedCards[0]).toHaveAttribute('data-ws-item', 'cage');
    expect(feedCards[0].querySelector('.ws-feed-item')).toHaveTextContent('케이지');
    expect(document.querySelector('footer [data-ws-aff="note-f"]')).toHaveTextContent(COPY.affiliate.coupang);
  });

  it('운영자 카드 0 이어도 피드 카드가 있으면 섹션이 선다', () => {
    render(<App page={page(FULL([card('wheel')]), [])} captured={NO_CAPTURE} />);
    expect(sec()?.querySelectorAll('li.ws-feed-card')).toHaveLength(1);
  });

  it('요구사항 밖·FOOD/HEALTH·알리 카드는 그리지 않는다 — 남는 카드 0 이면 lead·고지 0', () => {
    const rail = [card('ghost'), card('pellet'), card('wheel', { provider: 'ALIEXPRESS', url: 'https://s.click.aliexpress.com/e/_abcd1' })];
    render(<App page={page({ v: 1, stage: 'full', priceCheckedOn: '2026-11-23', items: [], rail })} captured={NO_CAPTURE} />);
    const s = sec() as HTMLElement;
    expect(s.querySelectorAll('li.ws-feed-card')).toHaveLength(0);
    expect(s.textContent).not.toContain(COPY.feed.homeLead);
    expect(document.querySelector('[data-ws-aff="note-feed"]')).toBeNull();
  });

  it('GENERAL_INFO 종: 레일 카드 0장(「표기 규격 통과」 0)', () => {
    const gi = { ...golden, generalInfo: true as const };
    render(<App page={page(FULL([card('wheel')]), undefined, gi)} captured={NO_CAPTURE} />);
    expect(document.querySelectorAll('li.ws-feed-card')).toHaveLength(0);
    expect(document.body.textContent).not.toContain(COPY.feed.badgeListed);
  });

  it('noprice(72h 초과): 카드는 그대로, 가격·확인일이 어떤 표기로도 0 · lead(신선도 문구) 0 · 고지는 유지', () => {
    render(<App page={page(NOPRICE([card('cage')]))} captured={NO_CAPTURE} />);
    const s = sec() as HTMLElement;
    const c = s.querySelector('li.ws-feed-card') as HTMLElement;
    expect(c).not.toBeNull();
    expect(c.querySelector('.ws-feed-price, .ws-feed-amount, .ws-feed-checked')).toBeNull();
    expect(c.textContent).not.toMatch(PRICE_OR_DATE);
    expect(s.querySelectorAll('li.ws-feed-card').length).toBe(1);
    expect(Array.from(s.querySelectorAll('li.ws-feed-card')).map((x) => x.textContent).join('')).not.toMatch(PRICE_OR_DATE);
    expect(s.textContent).not.toContain(COPY.feed.homeLead);
    expect(document.querySelectorAll('#ws-aff-feed-home')).toHaveLength(1);
  });
});
