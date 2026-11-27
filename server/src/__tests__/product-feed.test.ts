// 362 N3 — 상품 피드 로더·게이트·순수 시각 함수 시험. 실호출·키 0(손으로 만든 픽스처만).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PRODUCT_FEED_DIR,
  feedGeneratedAt,
  feedRowsOf,
  loadProductFeeds,
  parseProductFeed,
  parseProductFeedText,
  productFeedGate,
} from '../prerender/product-feed.js';
import {
  FEED_PROVIDER_ORDER,
  compareFeedRows,
  feedDeadlines,
  feedPriceText,
  feedStage,
  parseFeedInstant,
  seoulDate,
  seoulIso,
} from '../engine/feed-types.js';
import { FEED_IMAGE_HOSTS, FEED_LINK_RE } from '../engine/providers.js';

const GEN = '2026-11-23T09:12:00+09:00';

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    animalTypeId: 'hamster-golden',
    supplyItemId: 'wheel',
    keyword: '골든햄스터 쳇바퀴',
    rank: 1,
    title: '햄스터 쳇바퀴 30cm 통면',
    url: 'https://s.click.aliexpress.com/e/_AbCd1234',
    imageUrl: 'https://ae01.alicdn.com/kf/X1.jpg',
    price: { amount: 12900, currency: 'KRW' },
    fetchedAt: '2026-11-23T09:12:03+09:00',
    ...over,
  };
}

function ali(over: Record<string, unknown> = {}, rows: unknown[] = [row()]): Record<string, unknown> {
  return {
    v: 1,
    provider: 'ALIEXPRESS',
    source: 'OFFICIAL_API',
    api: { method: 'aliexpress.affiliate.product.query', sort: 'LAST_VOLUME_DESC' },
    terms: { checkedAt: '2026-11-23', displayFields: ['title', 'url', 'imageUrl', 'price'] },
    generatedAt: GEN,
    rows,
    ...over,
  };
}

const EMPTY_COUPANG =
  '{"v":1,"provider":"COUPANG","source":"OFFICIAL_API","api":{"method":null,"sort":null},"terms":{"checkedAt":null,"displayFields":[]},"generatedAt":null,"rows":[]}';

describe('parseProductFeed — 통과', () => {
  it('정상 알리 피드', () => {
    const f = parseProductFeed(ali(), 'ALIEXPRESS');
    expect(f.rows).toHaveLength(1);
    expect(feedRowsOf([f])[0].provider).toBe('ALIEXPRESS');
  });
  it('빈 쿠팡 파일(353 §2 원문) 통과', () => {
    expect(parseProductFeedText(EMPTY_COUPANG, 'COUPANG').rows).toEqual([]);
  });
  it('저장소의 빈 피드 2파일 통과', () => {
    const files = loadProductFeeds((name) => readFileSync(join(DEFAULT_PRODUCT_FEED_DIR, name), 'utf8'), Date.now());
    expect(files.map((f) => f.provider)).toEqual(['COUPANG', 'ALIEXPRESS']);
    expect(files.every((f) => f.rows.length === 0 && f.generatedAt === null)).toBe(true);
    expect(feedGeneratedAt(files)).toBeNull();
  });
  it('imageUrl·price null 허용', () => {
    expect(() => parseProductFeed(ali({}, [row({ imageUrl: null, price: null })]), 'ALIEXPRESS')).not.toThrow();
  });
});

describe('parseProductFeed — throw', () => {
  const bad: Array<[string, unknown]> = [
    ['최상위 초과 키', ali({ extra: 1 })],
    ['행 초과 키 productId', ali({}, [{ ...row(), productId: 'x' }])],
    ['행 초과 키 commission', ali({}, [{ ...row(), commission: 0.05 }])],
    ['행 초과 키 rating', ali({}, [{ ...row(), rating: 4.9 }])],
    ['행 초과 키 salesVolume', ali({}, [{ ...row(), salesVolume: 999 }])],
    ['행 누락 키', ali({}, [Object.fromEntries(Object.entries(row()).filter(([k]) => k !== 'fetchedAt'))])],
    ['provider 불일치', ali({ provider: 'COUPANG' })],
    ['source', ali({ source: 'CRAWL' })],
    ['http url', ali({}, [row({ url: 'http://s.click.aliexpress.com/e/_AbCd1234' })])],
    ['다른 링크 형태', ali({}, [row({ url: 'https://www.aliexpress.com/item/1.html' })])],
    ['허용 밖 이미지 호스트', ali({}, [row({ imageUrl: 'https://evil.example.com/a.jpg' })])],
    ['이미지 하위 호스트 흉내', ali({}, [row({ imageUrl: 'https://ae01.alicdn.com.evil.com/a.jpg' })])],
    ['http 이미지', ali({}, [row({ imageUrl: 'http://ae01.alicdn.com/kf/X1.jpg' })])],
    ['rows 있는데 generatedAt null', ali({ generatedAt: null })],
    ['generatedAt 형식', ali({ generatedAt: '2026-11-23' })],
    ['rows 있는데 checkedAt null', ali({ terms: { checkedAt: null, displayFields: ['title', 'url', 'imageUrl', 'price'] } })],
    ['price 선언 없이 가격', ali({ terms: { checkedAt: '2026-11-23', displayFields: ['title', 'url', 'imageUrl'] } })],
    ['비 KRW', ali({}, [row({ price: { amount: 10, currency: 'USD' } })])],
    ['가격 소수', ali({}, [row({ price: { amount: 10.5, currency: 'KRW' } })])],
    ['rank 중복', ali({}, [row(), row({ rank: 1 })])],
    ['rank 범위', ali({}, [row({ rank: 11 })])],
    ['fetchedAt 이 generatedAt+1h 뒤', ali({}, [row({ fetchedAt: '2026-11-23T11:12:04+09:00' })])],
    ['키워드 공백', ali({}, [row({ keyword: ' 골든 ' })])],
    ['제목 꺾쇠', ali({}, [row({ title: '<b>쳇바퀴</b>' })])],
    ['displayFields 모르는 값', ali({ terms: { checkedAt: '2026-11-23', displayFields: ['title', 'url', 'sales'] } })],
  ];
  it.each(bad)('%s', (_n, json) => {
    expect(() => parseProductFeed(json, 'ALIEXPRESS')).toThrow(/product-feed/);
  });

  it('금지 키(__proto__)', () => {
    expect(() => parseProductFeedText('{"__proto__":{"x":1},"v":1}', 'ALIEXPRESS')).toThrow(/금지 키/);
  });
  it('원문 중복 키', () => {
    const t = JSON.stringify(ali()).replace('"v":1', '"v":1,"v":1');
    expect(() => parseProductFeedText(t, 'ALIEXPRESS')).toThrow(/중복 키/);
  });
  it('BOM·JSON 아님', () => {
    expect(() => parseProductFeedText(`\uFEFF${EMPTY_COUPANG}`, 'COUPANG')).toThrow(/BOM/);
    expect(() => parseProductFeedText('{', 'COUPANG')).toThrow(/JSON 아님/);
  });
  it('오류 메시지에 제목·URL 값 없음', () => {
    try {
      parseProductFeed(ali({}, [row({ url: 'http://secret.example/abc' })]), 'ALIEXPRESS');
    } catch (e) {
      expect((e as Error).message).not.toMatch(/secret|쳇바퀴/);
    }
  });
  it('공급자×타입·품목당 10행 상한', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ rank: i + 1 }));
    expect(() => parseProductFeed(ali({}, rows), 'ALIEXPRESS')).not.toThrow();
  });
});

describe('productFeedGate — 기본 꺼짐', () => {
  const env = { WS_PRODUCT_FEED: 'public', WS_AFFILIATE_ORIGINS: 'https://withsmall.kr' };
  it('production ∧ public ∧ origin 허용일 때만 켜짐', () => {
    expect(productFeedGate(env, 'https://withsmall.kr', true)).toEqual({ on: true, reason: 'ON' });
    expect(productFeedGate(env, 'https://withsmall.kr', false).on).toBe(false);
    expect(productFeedGate({ ...env, WS_PRODUCT_FEED: '1' }, 'https://withsmall.kr', true).reason).toBe('FEED_OFF');
    expect(productFeedGate({}, 'https://withsmall.kr', true).reason).toBe('FEED_OFF');
    expect(productFeedGate(env, 'https://other.kr', true).reason).toBe('ORIGIN_NOT_ALLOWED');
  });
});

describe('feed-types 순수 함수', () => {
  it('공급자 고정 순서', () => {
    expect(FEED_PROVIDER_ORDER).toEqual(['COUPANG', 'ALIEXPRESS']);
  });
  it('정렬 = verdict → 공급자 → rank (가격 자리 없음)', () => {
    const rows = [
      { verdict: 'BELOW_RECOMMENDED' as const, provider: 'COUPANG' as const, rank: 1 },
      { verdict: 'OK' as const, provider: 'ALIEXPRESS' as const, rank: 1 },
      { verdict: 'OK' as const, provider: 'COUPANG' as const, rank: 2 },
      { verdict: 'OK' as const, provider: 'COUPANG' as const, rank: 1 },
    ];
    expect([...rows].sort(compareFeedRows)).toEqual([rows[3], rows[2], rows[1], rows[0]]);
  });
  it('ISO 파싱·서울 날짜는 실행 TZ 무관', () => {
    const ms = parseFeedInstant('2026-11-23T23:30:00Z') as number;
    expect(ms).toBe(Date.UTC(2026, 10, 23, 23, 30, 0));
    expect(seoulDate(ms)).toEqual({ year: 2026, month: 11, day: 24 });
    expect(seoulIso(ms)).toBe('2026-11-24T08:30:00+09:00');
    expect(parseFeedInstant(GEN)).toBe(Date.UTC(2026, 10, 23, 0, 12, 0));
    expect(parseFeedInstant('2026-02-30T00:00:00Z')).toBeNull();
    expect(parseFeedInstant('2026-11-23 09:12:00+09:00')).toBeNull();
    expect(seoulDate(Date.UTC(2026, 11, 31, 15, 0, 0))).toEqual({ year: 2027, month: 1, day: 1 });
  });
  it('단계: ≤72h full, ≤168h noprice, 그 뒤·null nofeed', () => {
    const g = parseFeedInstant(GEN) as number;
    const H = 3_600_000;
    expect(feedStage(g + 72 * H, GEN)).toBe('full');
    expect(feedStage(g + 72 * H + 1, GEN)).toBe('noprice');
    expect(feedStage(g + 168 * H, GEN)).toBe('noprice');
    expect(feedStage(g + 168 * H + 1, GEN)).toBe('nofeed');
    expect(feedStage(g, null)).toBe('nofeed');
    expect(feedDeadlines(g)).toEqual({ priceUntil: g + 72 * H, blockUntil: g + 168 * H });
  });
  it('가격 표기', () => {
    expect(feedPriceText(12900)).toBe('12,900원');
    expect(feedPriceText(1234567)).toBe('1,234,567원');
    expect(feedPriceText(900)).toBe('900원');
  });
  it('링크·호스트 상수는 https 정확 패턴', () => {
    expect(FEED_LINK_RE.COUPANG.test('https://link.coupang.com/a/AbCd12')).toBe(true);
    expect(FEED_LINK_RE.COUPANG.test('https://link.coupang.com/a/AbCd12?x=1')).toBe(false);
    expect(FEED_IMAGE_HOSTS.COUPANG).toEqual([]);
    for (const hosts of Object.values(FEED_IMAGE_HOSTS)) for (const h of hosts) expect(h).not.toMatch(/\*|^https?:|\//);
  });
});
