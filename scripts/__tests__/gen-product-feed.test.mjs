// 362 N13 — 상품 피드 생성기 시험. 모의 transport 만(실호출·실제 키 0). 가짜 키 문자열이 어떤 출력에도 없어야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDER_KEY_ENV, createShopApi, normalizeItem, providerCreds, titleBanned } from '../lib/shop-api.mjs';
import { buildFeedFile, collectTargets, generateFeeds, seoulIsoOf, FEED_EXCLUDED_CATEGORIES } from '../dev/gen-product-feed.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BANNED = JSON.parse(readFileSync(join(ROOT, 'server', 'src', 'seed', 'banned-words.json'), 'utf8'));

const FAKE_ENV = { ALIEXPRESS_APP_KEY: 'ALIKEYzzFAKE1234', ALIEXPRESS_APP_SECRET: 'ALISECzzFAKE56', ALIEXPRESS_TRACKING_ID: 'TRACKzzFAKE' };
/** 시험용 주입 규칙(가짜 호스트 — 실제 값은 실행 시 server/dist engine 에서). */
const RULES = { ALIEXPRESS: { linkRe: /^https:\/\/s\.click\.aliexpress\.com\/e\/_[A-Za-z0-9_-]{4,64}$/, imageHosts: ['ae01.alicdn.com'] } };
const TERMS = { checkedAt: '2026-11-23', displayFields: ['title', 'url', 'imageUrl', 'price'] };

/** 가짜 알리 응답 아이템 — 수수료·판매량·평점·상품 id·판매처를 일부러 넣는다(출력 0 이어야 함). */
const aliItem = (i, over = {}) => ({
  product_id: `PIDzz${i}`,
  product_title: `햄스터 쳇바퀴 30cm 통면 ${i}호`,
  promotion_link: `https://s.click.aliexpress.com/e/_Fake${i}abc`,
  product_main_image_url: `https://ae01.alicdn.com/kf/F${i}.jpg`,
  target_sale_price: String(12900 + i),
  target_sale_price_currency: 'KRW',
  commission_rate: '7.0%',
  hot_product_commission_rate: '9.0%',
  lastest_volume: 999,
  evaluate_rate: '98.2%',
  shop_name: 'SHOPzz',
  shop_id: 123,
  ...over,
});

function mockTransport(itemsFor, calls) {
  return async (req) => {
    calls.push({ provider: req.provider, keyword: req.keyword, limit: req.limit, credKeys: Object.keys(req.creds).sort() });
    return { method: 'aliexpress.affiliate.product.query', sort: 'LAST_VOLUME_DESC', items: itemsFor(req.keyword) };
  };
}

const TARGETS = [
  { animalTypeId: 'hamster-golden', supplyItemId: 'wheel', keyword: '골든햄스터 쳇바퀴' },
  { animalTypeId: 'hamster-golden', supplyItemId: 'bedding', keyword: '골든햄스터 베딩' },
];

test('키 미설정 → 키 이름만 오류(값 0), transport 호출 0', async () => {
  const calls = [];
  const r = providerCreds('ALIEXPRESS', { ALIEXPRESS_APP_KEY: 'ALIKEYzzFAKE1234' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['ALIEXPRESS_APP_SECRET', 'ALIEXPRESS_TRACKING_ID']);
  const out = await generateFeeds({ targets: TARGETS, env: { ALIEXPRESS_APP_KEY: 'ALIKEYzzFAKE1234' }, transport: mockTransport(() => [], calls), providers: ['ALIEXPRESS'], nowMs: 0, banned: BANNED, existingTerms: { ALIEXPRESS: TERMS } });
  assert.equal(calls.length, 0);
  assert.equal(out.files.length, 0);
  assert.match(out.errors.join('\n'), /ALIEXPRESS_APP_SECRET/);
  assert.doesNotMatch(out.errors.join('\n'), /ALIKEYzzFAKE1234/);
  assert.deepEqual(PROVIDER_KEY_ENV.COUPANG, ['COUPANG_PARTNERS_ACCESS_KEY', 'COUPANG_PARTNERS_SECRET_KEY']);
});

test('응답의 수수료·판매량·평점·상품 id·판매처는 출력 0, 행 키는 고정 9개', async () => {
  const calls = [];
  const out = await generateFeeds({
    targets: TARGETS,
    env: FAKE_ENV,
    transport: mockTransport((kw) => (kw.includes('쳇바퀴') ? [aliItem(1), aliItem(2)] : []), calls),
    providers: ['ALIEXPRESS'],
    nowMs: Date.UTC(2026, 10, 23, 0, 12, 0),
    banned: BANNED,
    existingTerms: { ALIEXPRESS: TERMS },
    rules: RULES,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].credKeys, ['appKey', 'appSecret', 'trackingId']);
  const [file] = out.files;
  const text = JSON.stringify(file);
  for (const bad of ['commission', 'volume', 'evaluate', 'PIDzz', 'SHOPzz', 'shop_', 'ALIKEYzzFAKE1234', 'ALISECzzFAKE56', 'TRACKzzFAKE']) assert.ok(!text.includes(bad), bad);
  assert.equal(file.provider, 'ALIEXPRESS');
  assert.equal(file.source, 'OFFICIAL_API');
  assert.deepEqual(file.api, { method: 'aliexpress.affiliate.product.query', sort: 'LAST_VOLUME_DESC' });
  assert.deepEqual(file.terms, TERMS);
  assert.equal(file.generatedAt, '2026-11-23T09:12:00+09:00');
  assert.equal(file.rows.length, 2);
  assert.deepEqual(Object.keys(file.rows[0]), ['animalTypeId', 'supplyItemId', 'keyword', 'rank', 'title', 'url', 'imageUrl', 'price', 'fetchedAt']);
  assert.deepEqual(file.rows.map((r) => r.rank), [1, 2]);
  assert.deepEqual(file.rows[0].price, { amount: 12901, currency: 'KRW' });
  // 가짜 키 값이 로그·오류에도 없다
  assert.doesNotMatch([...out.log, ...out.errors].join('\n'), /zzFAKE/);
});

test('비KRW → price null, 금지어 제목 행 0, http 링크 행 0, 10행 상한', async () => {
  const items = [
    aliItem(1, { target_sale_price_currency: 'USD', target_sale_price: '9.99' }),
    aliItem(2, { product_title: '인기 햄스터 쳇바퀴 특가' }),
    aliItem(3, { product_title: '최저가 쳇바퀴' }),
    aliItem(4, { promotion_link: 'http://s.click.aliexpress.com/e/_x' }),
    ...Array.from({ length: 12 }, (_, i) => aliItem(10 + i)),
  ];
  const out = await generateFeeds({ targets: TARGETS.slice(0, 1), env: FAKE_ENV, transport: mockTransport(() => items, []), providers: ['ALIEXPRESS'], nowMs: 0, banned: BANNED, existingTerms: { ALIEXPRESS: TERMS }, rules: RULES });
  const rows = out.files[0].rows;
  assert.equal(rows[0].price, null);
  assert.ok(rows.every((r) => !/인기|특가|최저가/.test(r.title)));
  assert.ok(rows.every((r) => r.url.startsWith('https://')));
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('표시 허용 필드에 없는 값은 null(imageUrl·price)', () => {
  const r = normalizeItem('ALIEXPRESS', aliItem(1), ['title', 'url']);
  assert.equal(r.imageUrl, null);
  assert.equal(r.price, null);
});

test('titleBanned: banned·stems, 공백 제거 뒤에도', () => {
  assert.equal(titleBanned('특 가 쳇바퀴', BANNED), true);
  assert.equal(titleBanned('ＢＥＳＴ 쳇바퀴', BANNED), true);
  assert.equal(titleBanned('안전한 쳇바퀴', BANNED), true);
  assert.equal(titleBanned('햄스터 쳇바퀴 30cm', BANNED), false);
});

test('createShopApi: transport 필수(실호출 구현 0)', () => {
  assert.throws(() => createShopApi({ provider: 'ALIEXPRESS', creds: {}, transport: undefined }), /transport/);
});

test('collectTargets: 노출 타입 × 비 FOOD/HEALTH 품목, 조합 수', () => {
  assert.deepEqual([...FEED_EXCLUDED_CATEGORIES].sort(), ['FOOD', 'HEALTH']);
  const seed = { animalTypes: [{ id: 'a1' }, { id: 'a2' }, { id: 'hidden' }] };
  const engine = {
    createCatalog: () => ({}),
    isAnimalTypeExposable: (_c, id) => id !== 'hidden',
    listResolvedRequirements: (_c, id) => [
      { animalTypeId: id, supplyItemId: 'wheel', item: { category: 'TOY' } },
      { animalTypeId: id, supplyItemId: 'food', item: { category: 'FOOD' } },
      { animalTypeId: id, supplyItemId: 'scale', item: { category: 'HEALTH' } },
      { animalTypeId: id, supplyItemId: 'gone', item: { category: 'CAGE' } },
    ],
    isRequirementExposable: (_c, r) => r.supplyItemId !== 'gone',
    buildSearchKeyword: (at, r) => `${at.id} ${r.supplyItemId}`,
  };
  const t = collectTargets(seed, engine, '2026-11-25');
  assert.deepEqual(t, [
    { animalTypeId: 'a1', supplyItemId: 'wheel', keyword: 'a1 wheel' },
    { animalTypeId: 'a2', supplyItemId: 'wheel', keyword: 'a2 wheel' },
  ]);
});

test('buildFeedFile: 행 없으면 generatedAt null(빈 파일 형식)', () => {
  const f = buildFeedFile({ provider: 'COUPANG', api: { method: null, sort: null }, terms: { checkedAt: null, displayFields: [] }, generatedAt: '2026-11-23T09:12:00+09:00', rows: [] });
  assert.equal(JSON.stringify(f), '{"v":1,"provider":"COUPANG","source":"OFFICIAL_API","api":{"method":null,"sort":null},"terms":{"checkedAt":null,"displayFields":[]},"generatedAt":null,"rows":[]}');
});

test('rules 주입: 링크 정확 패턴·이미지 호스트, 주입 없으면 이미지 null·https 일반 형태만', () => {
  const all = ['title', 'url', 'imageUrl', 'price'];
  assert.equal(normalizeItem('ALIEXPRESS', aliItem(1), all).imageUrl, null);
  assert.equal(normalizeItem('ALIEXPRESS', aliItem(1, { promotion_link: 'https://user@x.example/a' }), all), null);
  assert.equal(normalizeItem('ALIEXPRESS', aliItem(1, { promotion_link: 'https://other.example/a' }), all, RULES.ALIEXPRESS), null);
  assert.equal(normalizeItem('ALIEXPRESS', aliItem(1, { product_main_image_url: 'https://ae01.alicdn.com.evil.example/a.jpg' }), all, RULES.ALIEXPRESS).imageUrl, null);
});

test('seoulIsoOf: TZ 무관 +09:00', () => {
  assert.equal(seoulIsoOf(Date.UTC(2026, 10, 23, 15, 0, 5)), '2026-11-24T00:00:05+09:00');
});
