// 377 S6 — 피드 켜기 조건: 행이 있으면 api.method·api.sort non-null, terms.checkedAt 은 빌드일(서울) 기준 90일 이내의 실제 날짜.
import { describe, expect, it } from 'vitest';
import { loadProductFeeds, parseProductFeed, TERMS_MAX_AGE_DAYS } from '../prerender/product-feed.js';

const GEN = '2026-11-23T09:12:00+09:00';
const NOW = Date.UTC(2026, 10, 23, 1, 12, 0);
const DAY = 86_400_000;
const FIELDS = ['title', 'url', 'imageUrl', 'price'];

function file(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    provider: 'ALIEXPRESS',
    source: 'OFFICIAL_API',
    api: { method: 'aliexpress.affiliate.product.query', sort: 'LAST_VOLUME_DESC' },
    terms: { checkedAt: '2026-11-23', displayFields: FIELDS },
    generatedAt: GEN,
    rows: [
      {
        animalTypeId: 'hamster-golden',
        supplyItemId: 'wheel',
        keyword: '골든햄스터 쳇바퀴',
        rank: 1,
        title: '햄스터 쳇바퀴 30cm 통면',
        url: 'https://s.click.aliexpress.com/e/_AbCd1234',
        imageUrl: null,
        price: { amount: 12900, currency: 'KRW' },
        fetchedAt: GEN,
      },
    ],
    ...over,
  };
}
const checked = (checkedAt: string): Record<string, unknown> => file({ terms: { checkedAt, displayFields: FIELDS } });
const EMPTY = { v: 1, provider: 'COUPANG', source: 'OFFICIAL_API', api: { method: null, sort: null }, terms: { checkedAt: null, displayFields: [] }, generatedAt: null, rows: [] };

describe('S6 api.method·api.sort', () => {
  it.each([
    ['sort null', { method: 'm.q', sort: null }],
    ['method null', { method: null, sort: 'S' }],
  ])('행이 있는데 %s → throw', (_n, api) => {
    expect(() => parseProductFeed(file({ api }), 'ALIEXPRESS')).toThrow(/api\./);
    expect(() => parseProductFeed(file({ api }), 'ALIEXPRESS', { nowMs: NOW })).toThrow(/api\./);
  });
  it('행이 없으면 null 허용', () => {
    expect(() => parseProductFeed(EMPTY, 'COUPANG', { nowMs: NOW })).not.toThrow();
  });
});

describe('S6 terms.checkedAt 신선도(빌드일 기준)', () => {
  const at = (checkedAt: string, now = NOW) => () => parseProductFeed(checked(checkedAt), 'ALIEXPRESS', { nowMs: now });

  it('상수 = 90일', () => {
    expect(TERMS_MAX_AGE_DAYS).toBe(90);
  });
  it('90일 전은 통과, 91일 전은 throw', () => {
    expect(at('2026-08-25')).not.toThrow();
    expect(at('2026-08-24')).toThrow(/terms\.checkedAt/);
  });
  it('미래 날짜·달력에 없는 날짜 → throw', () => {
    expect(at('2026-11-24')).toThrow(/terms\.checkedAt/);
    expect(at('2026-09-31')).toThrow(/terms\.checkedAt/);
  });
  it('날짜 경계는 서울 기준(UTC 15:00 = 다음 날)', () => {
    const justAfterSeoulMidnight = Date.UTC(2026, 10, 23, 15, 0, 0);
    expect(at('2026-08-25', justAfterSeoulMidnight - 1)).not.toThrow();
    expect(at('2026-08-25', justAfterSeoulMidnight)).toThrow(/terms\.checkedAt/);
    expect(at('2026-11-24', justAfterSeoulMidnight)).not.toThrow();
  });
  it('로더(빌드 경로)도 같은 검사', () => {
    const read = (f: Record<string, unknown>) => (name: string) => JSON.stringify(name === 'coupang.json' ? EMPTY : f);
    expect(() => loadProductFeeds(read(checked('2026-11-23')), NOW)).not.toThrow();
    expect(() => loadProductFeeds(read(checked('2026-11-23')), NOW + 91 * DAY)).toThrow(/terms\.checkedAt/);
  });
});
