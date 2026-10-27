// scripts/dev/check-search-keywords.mjs — 개발 전용 검색 키워드 검증 도구. 실제 네트워크 호출 0(가짜 fetch 만).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SKIP_COUPANG_TODO,
  SKIP_NO_KEY,
  VERDICT,
  collectKeywords,
  coupangAuthorization,
  coupangSignedDate,
  extractNaverProducts,
  itemTerms,
  judge,
  keywordTerms,
  main,
  renderMarkdown,
  runCheck,
  toJson,
} from '../dev/check-search-keywords.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const NAVER_ID = 'NAVERIDzzFAKE0123456789';
const NAVER_SECRET = 'NAVERSECRETzzFAKE987';
const CP_ACCESS = 'CPACCESSzzFAKE5555';
const CP_SECRET = 'CPSECRETzzFAKE7777';
const KEY_ENV = { NAVER_SEARCH_CLIENT_ID: NAVER_ID, NAVER_SEARCH_CLIENT_SECRET: NAVER_SECRET, COUPANG_PARTNERS_ACCESS_KEY: CP_ACCESS, COUPANG_PARTNERS_SECRET_KEY: CP_SECRET };

const row = (over = {}) => ({
  keyword: '골든햄스터 쳇바퀴 30cm 무소음',
  uses: [{ animalTypeId: 'hamster-golden', animal: '골든햄스터', animalReviewStatus: 'DRAFT', supplyItemId: 'wheel', item: '쳇바퀴' }],
  itemTerms: ['쳇바퀴'],
  keywordTerms: ['무소음'],
  animalNames: ['골든햄스터', '골햄'],
  ...over,
});

const PET = ['생활/건강', '반려동물', '소동물용품', '쳇바퀴'];
const OTHER = ['생활/건강', '공구'];
/** 가짜 네이버 아이템 — 응답에 가격·판매처·이미지·링크·id 를 일부러 넣는다(출력에 0 이어야 함). */
const fakeItem = (title, cats = PET, i = 0) => ({
  title,
  link: `https://shop.example/p/${i}`,
  image: `https://img.example/${i}.jpg`,
  lprice: String(91230 + i),
  hprice: String(99870 + i),
  mallName: `MALLNAMEzz${i}`,
  productId: `PIDzz${i}`,
  productType: '1',
  brand: 'BRANDzz',
  maker: 'MAKERzz',
  category1: cats[0],
  category2: cats[1],
  category3: cats[2],
  category4: cats[3],
});

function fakeFetch(itemsFor, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    const items = itemsFor(url);
    return { ok: true, status: 200, json: async () => ({ lastBuildDate: 'x', total: 999, start: 1, display: items.length, items }) };
  };
}

// ── 판정 ───────────────────────────────────────────────────
test('itemTerms·keywordTerms: 용품명 조각·별칭, 조건어는 동물명·숫자 토큰 제외', () => {
  assert.deepEqual(itemTerms({ name: '터널·놀이기구', aliases: ['터널장난감'] }), ['터널·놀이기구', '터널', '놀이기구', '터널장난감']);
  assert.deepEqual(itemTerms({ name: '모래 목욕통' }), ['모래 목욕통', '모래', '목욕통']);
  assert.deepEqual(keywordTerms('골든햄스터 대형 케이지 100x50', ['골든햄스터'], ['케이지']), ['대형']);
});

test('judge: 관련 8/10 + 반려동물 분류 → OK, 상위 3 상품명', () => {
  const products = extractNaverProducts({
    items: [
      ...Array.from({ length: 8 }, (_, i) => fakeItem(`<b>햄스터</b> 저소음 <b>쳇바퀴</b> ${i}호 &amp; 받침`, PET, i)),
      fakeItem('햄스터 은신처', PET, 8),
      fakeItem('리빙박스', PET, 9),
    ],
  });
  const r = judge(row(), products);
  assert.equal(r.total, 10);
  assert.equal(r.related, 8);
  assert.equal(r.ratio, 0.8);
  assert.equal(r.verdict, VERDICT.OK);
  assert.equal(r.petCategory, 10);
  assert.deepEqual(r.top3, ['햄스터 저소음 쳇바퀴 0호 & 받침', '햄스터 저소음 쳇바퀴 1호 & 받침', '햄스터 저소음 쳇바퀴 2호 & 받침']);
  assert.equal(r.conditionMatch, 0);
});

test('judge: 4/10 → 약함, 1/10 → 무관, 0건 → 무관', () => {
  const mk = (n) => Array.from({ length: 10 }, (_, i) => ({ title: i < n ? '쳇 바퀴 원목' : '사료', categories: PET }));
  assert.equal(judge(row(), mk(4)).verdict, VERDICT.WEAK);
  assert.equal(judge(row(), mk(1)).verdict, VERDICT.NONE);
  const empty = judge(row(), []);
  assert.equal(empty.verdict, VERDICT.NONE);
  assert.equal(empty.total, 0);
});

test('judge: 이름은 맞아도 반려동물 분류가 절반 미만이면 OK → 약함', () => {
  const products = Array.from({ length: 10 }, (_, i) => ({ title: '쳇바퀴', categories: i < 3 ? PET : OTHER }));
  assert.equal(judge(row(), products).verdict, VERDICT.WEAK);
});

test('extractNaverProducts: 상품명·카테고리만 남기고 가격·판매처·이미지·링크·id 는 버린다', () => {
  const out = extractNaverProducts({ items: [fakeItem('<b>쳇바퀴</b>', PET, 0)] });
  assert.deepEqual(out, [{ title: '쳇바퀴', categories: PET }]);
  assert.deepEqual(Object.keys(out[0]).sort(), ['categories', 'title']);
});

// ── 수집(engine 주입) ───────────────────────────────────────
test('collectKeywords: engine 의 listResolvedRequirements·buildSearchKeyword 를 쓰고 동일 검색어는 하나로 묶는다', () => {
  const seed = {
    animalTypes: [
      { id: 'a1', displayName: '골든햄스터', aliases: ['골햄'], reviewStatus: 'DRAFT' },
      { id: 'a2', displayName: '드워프햄스터', aliases: [], reviewStatus: 'DRAFT' },
    ],
    supplyItems: [{ id: 'wheel', name: '쳇바퀴' }],
  };
  const calls = [];
  const engine = {
    createCatalog: (s) => ({ s }),
    listResolvedRequirements: (_cat, id) => [{ supplyItemId: 'wheel', item: { name: '쳇바퀴' } }].map((r) => ({ ...r, animalTypeId: id })),
    buildSearchKeyword: (at, r) => {
      calls.push([at.id, r.supplyItemId]);
      return '햄스터 쳇바퀴 30cm';
    },
  };
  const rows = collectKeywords(seed, engine);
  assert.deepEqual(calls, [['a1', 'wheel'], ['a2', 'wheel']]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uses.length, 2);
  assert.deepEqual(rows[0].itemTerms, ['쳇바퀴']);
  assert.deepEqual(rows[0].keywordTerms, ['햄스터']);
});

// ── 실행 ───────────────────────────────────────────────────
test('키 없음: 두 공급자 skipped(키 없음), fetch 호출 0', async () => {
  const calls = [];
  const res = await runCheck({ keywords: [row()], env: {}, fetchFn: fakeFetch(() => [], calls), sleep: async () => {} });
  assert.equal(calls.length, 0);
  assert.equal(res.providers.naver, SKIP_NO_KEY);
  assert.equal(res.providers.coupang, SKIP_NO_KEY);
  assert.equal(res.rows[0].naver.status, SKIP_NO_KEY);
  assert.match(renderMarkdown({ date: '2026-10-27', ...res }), /skipped\(키 없음\)/);
});

test('키 있음(가짜 fetch): 출력 md·json·로그에 가격·판매처·링크·이미지·키 문자열 0, 헤더로만 키 전달, 쿠팡은 TODO skip', async () => {
  const calls = [];
  const logs = [];
  const items = Array.from({ length: 10 }, (_, i) => fakeItem(`햄스터 쳇바퀴 ${i}`, PET, i));
  const keywords = [row(), row({ keyword: '골든햄스터 쳇바퀴 30cm 무소음' }), row({ keyword: '골든햄스터 베딩', itemTerms: ['베딩'] })];
  const res = await runCheck({ keywords, env: KEY_ENV, fetchFn: fakeFetch(() => items, calls), sleep: async () => {}, log: (l) => logs.push(l) });
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.equal(c.init.headers['X-Naver-Client-Id'], NAVER_ID);
    assert.equal(c.init.headers['X-Naver-Client-Secret'], NAVER_SECRET);
    for (const k of Object.values(KEY_ENV)) assert.ok(!c.url.includes(k), 'URL 에 키 0');
    assert.match(c.url, /display=10/);
  }
  assert.equal(res.providers.coupang, SKIP_COUPANG_TODO);
  assert.equal(res.rows[0].naver.verdict, VERDICT.OK);
  assert.equal(res.rows[2].naver.verdict, VERDICT.NONE);
  const text = [renderMarkdown({ date: '2026-10-27', ...res }), JSON.stringify(toJson({ date: '2026-10-27', ...res })), ...logs].join('\n');
  for (const k of Object.values(KEY_ENV)) assert.ok(!text.includes(k), `키 문자열 출력 0: ${k}`);
  for (const bad of ['lprice', 'hprice', 'mallName', 'MALLNAMEzz', 'PIDzz', 'BRANDzz', 'MAKERzz', 'shop.example', 'img.example', '91230', '99870', 'price', 'link', 'image']) {
    assert.ok(!text.includes(bad), `출력에 ${bad} 0`);
  }
});

test('401: 네이버 중단(나머지 skipped), 오류 본문·키 출력 0', async () => {
  let n = 0;
  const fetchFn = async () => {
    n++;
    return { ok: false, status: 401, json: async () => ({ errorMessage: `bad ${NAVER_ID}` }) };
  };
  const logs = [];
  const res = await runCheck({ keywords: [row(), row({ keyword: 'b' }), row({ keyword: 'c' })], env: KEY_ENV, fetchFn, sleep: async () => {}, log: (l) => logs.push(l) });
  assert.equal(n, 1);
  assert.equal(res.rows[0].naver.status, 'error(HTTP 401)');
  assert.match(res.rows[1].naver.status, /^skipped\(중단/);
  const text = [renderMarkdown({ date: 'd', ...res }), JSON.stringify(toJson({ date: 'd', ...res })), ...logs].join('\n');
  assert.ok(!text.includes(NAVER_ID));
});

test('실행 한도·요청 간 지연', async () => {
  const calls = [];
  const sleeps = [];
  const res = await runCheck({
    keywords: [row({ keyword: 'a' }), row({ keyword: 'b' }), row({ keyword: 'c' })],
    env: KEY_ENV,
    fetchFn: fakeFetch(() => [], calls),
    sleep: async (ms) => sleeps.push(ms),
    limit: 2,
    delayMs: 300,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [300]);
  assert.equal(res.rows[2].naver.status, 'skipped(실행 한도)');
});

test('쿠팡 서명: 공식 문서 형식(CEA, signed-date yymmddTHHMMSSZ GMT, message = date+method+path+query)', () => {
  const d = coupangSignedDate(new Date(Date.UTC(2026, 9, 27, 3, 4, 5)));
  assert.equal(d, '261027T030405Z');
  const h = coupangAuthorization({ method: 'GET', path: '/v2/x', query: 'a=1', accessKey: 'AK', secretKey: 'SK', signedDate: d });
  const sig = createHmac('sha256', 'SK').update(`${d}GET/v2/xa=1`).digest('hex');
  assert.equal(h, `CEA algorithm=HmacSHA256, access-key=AK, signed-date=${d}, signature=${sig}`);
});

// ── main(실제 시드 + server/dist engine, 키 없음) ───────────────
const DIST = join(ROOT, 'server', 'dist', 'engine', 'index.js');
test('main: 키 없음 → exit 0, md·json 기록, 실제 시드 검색어(engine 결과)', { skip: !existsSync(DIST) && 'server/dist 없음(npm run build -w server)' }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'search-check-'));
  made.push(out);
  const lines = [];
  const code = await main(['--out', out], {}, { stdout: (l) => lines.push(l), stderr: (l) => lines.push(l) });
  assert.equal(code, 0, lines.join('\n'));
  const files = readdirSync(out).sort();
  assert.equal(files.length, 2);
  const json = JSON.parse(readFileSync(join(out, files.find((f) => f.endsWith('.json'))), 'utf8'));
  assert.equal(json.providers.naver, SKIP_NO_KEY);
  assert.equal(json.providers.coupang, SKIP_NO_KEY);
  assert.ok(json.rows.length > 0);
  assert.equal(new Set(json.rows.map((r) => r.keyword)).size, json.rows.length, '중복 제거');
  assert.ok(json.rows.some((r) => r.uses.some((u) => u.animalTypeId === 'hamster-golden')));
});
