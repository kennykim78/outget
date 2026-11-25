// 362 N9 — ws-data data.feed 검증(isWsFeedData)·피드 경로 도우미. 하나라도 어긋나면 false(클라는 페이지 데이터를 버린다).
import { describe, expect, it } from 'vitest';
import { feedCheckedParts, feedJsonFile, feedJsonPath, feedVariantFile, isFeedImageUrl, isFeedLink, feedDataAt, isWsFeedData, type WsFeedData } from '../engine/index.js';

const card = { supplyItemId: 'wheel', provider: 'COUPANG', title: '햄스터 쳇바퀴 30cm', url: 'https://link.coupang.com/a/Abcd12', imageUrl: null, verdict: 'OK', specValues: { diameterCm: 30, surface: 'SOLID' } };
const FRESH = Date.UTC(2026, 10, 23, 0, 12, 0);
const full = () => ({ v: 1, stage: 'full', freshMs: FRESH, priceCheckedOn: '2026-11-23', items: ['wheel', 'hideout'], rail: [{ ...card, price: { amount: 12900, currency: 'KRW' } }] });
const noprice = () => ({ v: 1, stage: 'noprice', freshMs: FRESH, items: ['wheel'], rail: [{ ...card }] });

describe('isWsFeedData', () => {
  it('377 S1: freshMs(양의 안전 정수) 필수', () => {
    const { freshMs: _f, ...rest } = full();
    void _f;
    expect(isWsFeedData(rest)).toBe(false);
    for (const freshMs of [0, -1, 1.5, '1', null, Number.NaN]) expect(isWsFeedData({ ...full(), freshMs }), String(freshMs)).toBe(false);
  });
  it('정상 full·noprice·레일 0 통과', () => {
    expect(isWsFeedData(full())).toBe(true);
    expect(isWsFeedData(noprice())).toBe(true);
    expect(isWsFeedData({ v: 1, stage: 'noprice', freshMs: FRESH, items: ['wheel'], rail: [] })).toBe(true);
    const nullPrice = full();
    nullPrice.rail[0].price = null as never;
    expect(isWsFeedData(nullPrice)).toBe(true);
  });

  const bad: Array<[string, (f: ReturnType<typeof full>) => unknown]> = [
    ['stage 밖', (f) => ({ ...f, stage: 'nofeed' })],
    ['v ≠ 1', (f) => ({ ...f, v: 2 })],
    ['추가 키', (f) => ({ ...f, extra: 1 })],
    ['full 인데 확인일 없음', (f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'priceCheckedOn'))],
    ['확인일 형식 밖', (f) => ({ ...f, priceCheckedOn: '2026-13-40' })],
    ['품목 id 형식 밖', (f) => ({ ...f, items: ['../x'] })],
    ['품목 중복', (f) => ({ ...f, items: ['wheel', 'wheel'] })],
    ['레일 품목이 items 밖', (f) => ({ ...f, items: ['hideout'] })],
    ['링크 형식 밖', (f) => ({ ...f, rail: [{ ...f.rail[0], url: 'https://www.coupang.com/vp/products/1' }] })],
    ['javascript 링크', (f) => ({ ...f, rail: [{ ...f.rail[0], url: 'javascript:alert(1)' }] })],
    ['이미지 호스트 밖', (f) => ({ ...f, rail: [{ ...f.rail[0], imageUrl: 'https://evil.example/a.jpg' }] })],
    ['verdict 밖', (f) => ({ ...f, rail: [{ ...f.rail[0], verdict: 'BELOW_MIN' }] })],
    ['verdict null', (f) => ({ ...f, rail: [{ ...f.rail[0], verdict: null }] })],
    ['가격 음수', (f) => ({ ...f, rail: [{ ...f.rail[0], price: { amount: -1, currency: 'KRW' } }] })],
    ['가격 통화 밖', (f) => ({ ...f, rail: [{ ...f.rail[0], price: { amount: 1, currency: 'USD' } }] })],
    ['full 카드에 price 키 없음', (f) => ({ ...f, rail: [{ ...card }] })],
    ['빈 상품명', (f) => ({ ...f, rail: [{ ...f.rail[0], title: ' ' }] })],
    ['공급자 밖', (f) => ({ ...f, rail: [{ ...f.rail[0], provider: 'NAVER' }] })],
    ['specValues 객체 값', (f) => ({ ...f, rail: [{ ...f.rail[0], specValues: { a: {} } }] })],
  ];
  for (const [name, mk] of bad) it(`거부: ${name}`, () => expect(isWsFeedData(mk(full()))).toBe(false));

  it('noprice 에 확인일·price 키가 있으면 거부', () => {
    expect(isWsFeedData({ ...noprice(), priceCheckedOn: '2026-11-23' })).toBe(false);
    const f = noprice();
    expect(isWsFeedData({ ...f, rail: [{ ...f.rail[0], price: null }] })).toBe(false);
  });
});

describe('피드 경로·링크 도우미', () => {
  it('feedJsonFile/Path·feedVariantFile', () => {
    expect(feedJsonFile('hamster/golden', 'wheel', 'full')).toBe('hamster/golden/feed/wheel.json');
    expect(feedJsonPath('hamster/golden', 'wheel', 'noprice')).toBe('/hamster/golden/feed/wheel.noprice.json');
    expect(feedVariantFile('hamster/golden/index.html', 'full')).toBe('hamster/golden/index.feed.html');
    expect(feedVariantFile('index.html', 'noprice')).toBe('index.feed-noprice.html');
    expect(feedVariantFile('404.html', 'full')).toBeNull();
  });

  it('feedCheckedParts', () => {
    expect(feedCheckedParts('2026-11-03')).toEqual({ month: 11, day: 3 });
    expect(feedCheckedParts('2026-11-3')).toBeNull();
    expect(feedCheckedParts(undefined)).toBeNull();
  });

  it('isFeedLink·isFeedImageUrl', () => {
    expect(isFeedLink('COUPANG', 'https://link.coupang.com/a/Abcd12')).toBe(true);
    expect(isFeedLink('COUPANG', 'https://link.coupang.com/a/Abcd12?x=1')).toBe(false);
    expect(isFeedImageUrl('ALIEXPRESS', 'https://ae01.alicdn.com/kf/a.jpg')).toBe(true);
    expect(isFeedImageUrl('ALIEXPRESS', 'https://ae01.alicdn.com:8443/kf/a.jpg')).toBe(false);
    expect(isFeedImageUrl('ALIEXPRESS', 'http://ae01.alicdn.com/kf/a.jpg')).toBe(false);
    expect(isFeedImageUrl('COUPANG', 'https://ae01.alicdn.com/kf/a.jpg')).toBe(false);
  });
});

// 377 S1 — 클라가 자기 시계로 다시 재는 단계(문서 단계보다 좋아지지 않는다).
describe('feedDataAt', () => {
  const H = 3_600_000;
  const doc = full() as unknown as WsFeedData;

  it('72h 까지 그대로, 72h+1ms 는 noprice(가격·확인일 키 0), 168h+1ms 는 없음', () => {
    expect(feedDataAt(doc, FRESH + 72 * H)).toBe(doc);
    const late = feedDataAt(doc, FRESH + 72 * H + 1);
    expect(late?.stage).toBe('noprice');
    expect(JSON.stringify(late)).not.toMatch(/"price"|priceCheckedOn/);
    expect(isWsFeedData(late)).toBe(true);
    expect(feedDataAt(doc, FRESH + 168 * H)?.stage).toBe('noprice');
    expect(feedDataAt(doc, FRESH + 168 * H + 1)).toBeUndefined();
  });

  it('noprice 문서는 full 로 올라가지 않는다 · 미래 freshMs(시계 오차 초과)·없는 피드 = 없음', () => {
    const np = { v: 1, stage: 'noprice', freshMs: FRESH, items: ['wheel'], rail: [] } as WsFeedData;
    expect(feedDataAt(np, FRESH)).toBe(np);
    expect(feedDataAt(doc, FRESH - 5 * 60_000)).toBe(doc);
    expect(feedDataAt(doc, FRESH - 5 * 60_000 - 1)).toBeUndefined();
    expect(feedDataAt(undefined, FRESH)).toBeUndefined();
  });
});
