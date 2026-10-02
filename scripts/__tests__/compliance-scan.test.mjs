// scripts/compliance-scan.mjs — 규칙별 주입(exit 1 + 규칙 ID) / 깨끗(exit 0) 양방향 테스트.
//   R3 계획 §5 C1-FETCH ~ C8-OUT-SAFE, §6-1 정규화, D8/D9/D10.
//   이 파일도 실트리 스캔 대상이다(scripts/__tests__ 제외 안 함) — 위반 문자열은 전부 j(...)로 런타임 조립한다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCANNER = resolve(HERE, '..', 'compliance-scan.mjs');
const j = (...parts) => parts.join('');

// ── 조립 문자열(소스에 위반 리터럴 0) ─────────────────────────
const HTTPS = j('htt', 'ps://');
const MAP_HOST = j('oapi.map.', 'naver.com');
const PST_HOST = j('*.pst', 'atic.net');
const OPENAPI_HOST = j('open', 'api.', 'naver.com');
const FETCH = j('fe', 'tch');
const KO = {
  okay: j('괜', '찮다'),
  safe: j('안', '전하다'),
  cheapest: j('최', '저가'),
  bySales: j('판', '매순'),
  best: j('베', '스트'),
  accuracy: j('정', '확도'),
  signup: j('회원', '가입'),
  purchase: j('구', '매'),
  safeStem: j('안', '전'),
  okayStem: j('괜', '찮'),
  expertN: j('전문', '가'),
};

const BANNED_WORDS = {
  v: 1,
  banned: [
    { term: KO.okay, pattern: KO.okay },
    { term: KO.safe, pattern: KO.safe },
    { term: KO.cheapest, pattern: KO.cheapest },
    { term: KO.bySales, pattern: KO.bySales },
    { term: KO.best, pattern: KO.best },
    { term: KO.accuracy, pattern: KO.accuracy },
    {
      term: j(KO.expertN, ' N명'),
      pattern: j(KO.expertN, '\\s*(?:\\d+|[한두세네다섯여섯일곱여덟아홉열스물서른마흔쉰백천일이삼사오육칠팔구십]+)\\s*명'),
    },
    { term: KO.signup, pattern: KO.signup },
    { term: KO.purchase, pattern: KO.purchase },
  ],
  stems: [
    { term: KO.safeStem, pattern: KO.safeStem },
    { term: KO.okayStem, pattern: KO.okayStem },
  ],
};

const meta = (over = {}) => ({
  reviewStatus: 'VERIFIED',
  reviewerType: 'EXPERIENCED_KEEPER',
  verifiedBy: 'keeper-kim',
  verifiedAt: '2026-09-30',
  contentKind: 'SPEC',
  source: [{ url: j(HTTPS, 'example.org/care'), title: 'care guide', accessedAt: '2026-09-30' }],
  ...over,
});

function baseSeed() {
  return {
    'animal-types.json': [
      {
        id: 'hamster-golden', slug: 'hamster/golden', group: 'SMALL_MAMMAL', displayName: '골든햄스터', status: 'ACTIVE',
        aliases: ['시리안햄스터'], taxonId: null, careProfileId: 'cp-syrian', careOverrides: {}, oneLiner: '단독 사육', ...meta({ contentKind: 'CARE' }),
      },
      {
        id: 'hamster-dwarf', slug: 'hamster/dwarf', group: 'SMALL_MAMMAL', displayName: '드워프햄스터', status: 'PLANNED',
        aliases: [], taxonId: null, careProfileId: null, careOverrides: {}, ...meta({ reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null }),
      },
    ],
    'taxa.json': [],
    'care-profiles.json': [{ id: 'cp-syrian', name: '골든햄스터 기본', taxonIds: [], facts: {}, careNotes: ['단독 사육'], ...meta({ contentKind: 'CARE' }) }],
    'supply-items.json': [
      { id: 'cage', name: '케이지', category: 'CAGE', lifecycle: 'DURABLE', specSchema: { fields: [] }, compatibleAlternativeIds: [], description: '바닥 면적이 우선', ...meta() },
      { id: 'wheel', name: '쳇바퀴', category: 'WHEEL', lifecycle: 'DURABLE', specSchema: { fields: [] }, compatibleAlternativeIds: [], description: '통면', ...meta({ reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null }) },
    ],
    'supply-requirements.json': [
      {
        id: 'req-cage', careProfileId: 'cp-syrian', supplyItemId: 'cage', priority: 'REQUIRED', orderHint: 'BEFORE_ARRIVAL',
        why: '바닥을 넓게 써요', caution: null, avoid: null, searchKeyword: '햄스터 케이지',
        minSpec: { rules: [{ key: 'floorWcm', op: 'gte', value: 60, reason: '활동 바닥' }] }, recommendedSpec: { rules: [] }, ...meta(),
      },
      {
        id: 'req-wheel', careProfileId: 'cp-syrian', supplyItemId: 'wheel', priority: 'REQUIRED', orderHint: 'BEFORE_ARRIVAL',
        why: '많이 달려요', caution: null, avoid: null, searchKeyword: '햄스터 쳇바퀴',
        minSpec: { rules: [] }, recommendedSpec: { rules: [] }, ...meta(),
      },
    ],
    'compatibility-rules.json': [],
    'setup-bundles.json': [
      { id: 'sb-1', careProfileId: 'cp-syrian', tier: 'BUDGET', name: '실속', purpose: '기준은 지키고', itemIds: ['cage'], estimatedRangeText: null, note: null, ...meta({ contentKind: 'CARE' }) },
    ],
    'curated-products.json': [
      {
        id: 'cp-001', supplyItemId: 'cage', careProfileIds: ['cp-syrian'], title: '넓은 케이지', imageAsset: '/assets/products/cp-001.webp',
        specValues: { floorWcm: 80 }, meetsMinSpec: true, specVerifiedBy: 'op', specVerifiedAt: '2026-09-30', status: 'ACTIVE', imageLicense: 'OWN_PHOTO', ...meta(),
      },
      {
        id: 'cp-002', supplyItemId: 'cage', careProfileIds: ['cp-syrian'], title: '작은 케이지', imageAsset: null,
        specValues: { floorWcm: 40 }, meetsMinSpec: false, specVerifiedBy: null, specVerifiedAt: null, status: 'SLOT', imageLicense: 'NONE', ...meta({ reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null }),
      },
    ],
    'testimonials.json': [
      { id: 't-001', quote: '', animalTypeId: 'hamster-golden', situation: 'FIRST_TIME', linkedAction: 'CHECKLIST', verifiedUsage: false, source: 'BETA', consentAt: null, status: 'SLOT', reviewerImage: null, reviewerImageConsent: false },
    ],
    'vet-clinics.json': [
      {
        id: 'vc-1', name: '마포 동물병원', region: '서울 마포구', treats: ['hamster-golden'], night: false, emergency: false, phone: '02-000-0000', address: '서울 마포구',
        lat: 37.5, lng: 126.9, verification: { status: 'VERIFIED', method: 'PHONE_CALL', verifiedAt: '2026-09-30', note: '' },
      },
    ],
    'photos.json': [
      { id: 'ph-01', scene: 'x', slot: 'intro-1', query: 'q', source: null, license: null, author: null, sourceUrl: null, downloadedAt: null, modified: false, status: 'SLOT' },
    ],
  };
}

const GUARD_TEST = [
  "import { isVerified, isTestimonialExposable } from '../engine/index.js';",
  "it('V01 AI_DRAFT', () => { expect(issues('V01')).toContain('AI_DRAFT'); });",
  "it('isVerified AI_DRAFT', () => { expect(isVerified({ reviewerType: 'AI_DRAFT' })).toBe(false); });",
  "it('t', () => { expect(isTestimonialExposable({})).toBe(false); });",
  '',
].join('\n');

function baseSource() {
  return {
    'package.json': JSON.stringify({ name: 'fx', private: true }),
    'client/package.json': JSON.stringify({ name: 'c', dependencies: { react: '^18' }, devDependencies: { jsdom: '^29' } }),
    'server/package.json': JSON.stringify({ name: 's', dependencies: { express: '^4' } }),
    'client/src/app.ts': j("export const load = () => ", FETCH, "('/api/vets');\n"),
    'client/src/map/loader.ts': j("export const SDK = '", HTTPS, MAP_HOST, "/openapi/v3/maps.js';\n"),
    'server/src/middleware/spa.ts': j('export const CSP = "img-src \'self\' https://', PST_HOST, '";\n'),
    'server/src/vet/vet.prisma.repo.ts': [
      "import { VET_LISTED_STATUS } from '../engine/exposure.js';",
      'export const list = (prisma) => prisma.vetClinic.findMany({ where: { status: VET_LISTED_STATUS } });',
      '',
    ].join('\n'),
    'server/src/__tests__/guards.test.ts': GUARD_TEST,
    'server/src/seed/banned-words.json': JSON.stringify(BANNED_WORDS, null, 2),
    'server/prisma/schema.prisma': 'model VetClinic {\n  id String @id\n  lat Float?\n  lng Float?\n}\n',
    'scripts/tool.mjs': 'export const ok = 1;\n',
  };
}

// ── 산출물(dist) 픽스처 ─────────────────────────────────────
const SAFE_HEAD = '<title>WithSmall</title><meta name="description" content="작은 반려동물 준비">';
function page(body, wsData = { v: 1, data: { types: [], requirements: [], products: [], bundles: [], vets: [], testimonials: [] } }) {
  return [
    '<!doctype html><html lang="ko"><head>', SAFE_HEAD,
    '<link rel="canonical" href="http://localhost:3001/">',
    '<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>',
    '</head><body><div id="root" data-ws-prerendered="1">',
    '<header class="ws-header"><a href="/">WithSmall</a></header>',
    body,
    '<footer><a href="/vet">병원</a></footer>',
    '</div>',
    '<script id="ws-data" type="application/json">', JSON.stringify(wsData), '</script>',
    '<script type="module" src="/assets/index-abc.js"></script>',
    '<script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script>',
    '</body></html>',
  ].join('');
}

function baseOutput() {
  const typeData = {
    v: 1,
    route: { kind: 'TYPE', path: '/hamster/golden', typeId: 'hamster-golden' },
    layer: null,
    catalogUrl: '/data/catalog.v1.abcd1234.json',
    data: {
      types: [{ id: 'hamster-golden', slug: 'hamster/golden', displayName: '골든햄스터' }],
      requirements: [{ animalTypeId: 'hamster-golden', supplyItemId: 'cage', why: '바닥을 넓게 써요', item: { id: 'cage', name: '케이지', alternativeIds: [] } }],
      products: [{ id: 'cp-001', supplyItemId: 'cage', title: '넓은 케이지' }],
      bundles: [{ id: 'sb-1', name: '실속' }],
      vets: [{ id: 'vc-1', name: '마포 동물병원' }],
      testimonials: [],
    },
  };
  return {
    'index.html': page('<main class="ws-page" data-ws-route="HOME"><section data-ws-section="now"><h2>지금 필요한 것</h2></section></main>'),
    'hamster/golden/index.html': page(
      [
        '<main class="ws-page" data-ws-route="TYPE" data-ws-type="hamster-golden">',
        '<section data-ws-section="now"><ul><li data-ws-id="supplyRequirements#req-cage"><a href="/hamster/golden/supplies/cage">케이지</a></li></ul></section>',
        '<section data-ws-section="products"><article data-ws-id="curatedProducts#cp-001"><img src="/assets/products/cp-001.webp" alt="넓은 케이지"></article></section>',
        j('<a href="', HTTPS, 'www.coupang.com/np/search?q=x" rel="noopener noreferrer">쿠팡에서 찾기</a>'),
        '</main>',
      ].join(''),
      typeData,
    ),
    'robots.txt': 'User-agent: *\nDisallow: /\n',
    'sitemap.xml': '<?xml version="1.0"?><urlset><url><loc>http://localhost:3001/</loc></url><url><loc>http://localhost:3001/hamster/golden</loc></url></urlset>',
    'data/catalog.v1.abcd1234.json': JSON.stringify({
      v: 1,
      animalTypes: [{ id: 'hamster-golden', displayName: '골든햄스터' }],
      careProfiles: [{ id: 'cp-syrian' }],
      supplyItems: [{ id: 'cage', name: '케이지' }],
      supplyRequirements: [{ id: 'req-cage', why: '바닥을 넓게 써요' }],
      compatibilityRules: [],
    }),
  };
}

function manifestFor(seedDigest, over = {}) {
  return {
    v: 1,
    seedDigest,
    indexable: false,
    routes: [
      { path: '/', file: 'index.html', kind: 'HOME', indexable: true },
      { path: '/hamster/golden', file: 'hamster/golden/index.html', kind: 'TYPE', typeId: 'hamster-golden', indexable: true },
    ],
    ...over,
  };
}

// ── 픽스처 생성·실행 ─────────────────────────────────────────
const made = [];
function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
}

/** opts: { source(files), seed(seed), output(files)|null, manifest(digest)=>obj|null } */
async function makeRoot({ source, seed, output, manifest } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'compliance-scan-'));
  made.push(root);
  const src = baseSource();
  if (source) source(src);
  writeTree(root, src);
  const sd = baseSeed();
  if (seed) seed(sd);
  const seedFiles = {};
  for (const [f, rows] of Object.entries(sd)) seedFiles[`server/seed/${f}`] = rows;
  writeTree(root, seedFiles);
  if (output !== null && output !== undefined) {
    const out = baseOutput();
    output(out);
    const dist = {};
    for (const [f, c] of Object.entries(out)) dist[`client/dist/${f}`] = c;
    writeTree(root, dist);
    const { seedDigest } = await import('../lib/seed-exposure.mjs');
    const digest = seedDigest(join(root, 'server', 'seed'));
    const m = (manifest ?? manifestFor)(digest);
    if (m) writeTree(root, { 'client/dist/prerender-manifest.json': m });
  }
  return root;
}

function scan(root, ...flags) {
  const r = spawnSync(process.execPath, [SCANNER, '--root', root, '--json', ...flags], { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

const rulesOf = (res, severity) =>
  (res.json?.findings ?? []).filter((f) => !severity || f.severity === severity).map((f) => f.rule);

function expectFail(res, rule) {
  assert.equal(res.code, 1, `exit 1 기대, 실제 ${res.code}\n${res.stdout}\n${res.stderr}`);
  assert.ok(rulesOf(res, 'FAIL').includes(rule), `${rule} FAIL 기대, 실제 ${JSON.stringify(res.json?.findings)}`);
}

function expectClean(res) {
  assert.equal(res.code, 0, `exit 0 기대, 실제 ${res.code}\n${res.stdout}\n${res.stderr}`);
  assert.deepEqual(rulesOf(res, 'FAIL'), []);
}

const noop = () => {};

after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

// ── 깨끗한 트리 ─────────────────────────────────────────────
test('clean: 소스+시드만(산출물 없음) → exit 0, outputs NOT RUN', async () => {
  const res = scan(await makeRoot());
  expectClean(res);
  assert.equal(res.json.outputs, 'NOT RUN');
});

test('clean: 산출물 포함 → exit 0, outputs RUN', async () => {
  const res = scan(await makeRoot({ output: noop }));
  expectClean(res);
  assert.equal(res.json.outputs, 'RUN');
});

test('--require-output: manifest 없으면 exit 1 NOT RUN', async () => {
  const res = scan(await makeRoot(), '--require-output');
  expectFail(res, 'C0-OUTPUT');
  assert.match(JSON.stringify(res.json), /NOT RUN/);
});

test('--require-output: 산출물 있으면 exit 0', async () => {
  expectClean(scan(await makeRoot({ output: noop }), '--require-output'));
});

test('설정 오류: banned-words.json 없음 → exit 2', async () => {
  const root = await makeRoot();
  unlinkSync(join(root, 'server', 'src', 'seed', 'banned-words.json'));
  assert.equal(scan(root).code, 2);
});

test('설정 오류: banned-words.json 형식 오류 → exit 2', async () => {
  const root = await makeRoot({ source: (s) => { s['server/src/seed/banned-words.json'] = '{ "v": 1, "banned": [ "x\\q" ] '; } });
  assert.equal(scan(root).code, 2);
});

test('사람용 출력: 위반 시 FAIL 요약 + 파일:라인', async () => {
  const root = await makeRoot({ source: (s) => { s['client/src/x.ts'] = j('const a = 1;\n', FETCH, '("', HTTPS, 'shop.ex/p");\n'); } });
  const r = spawnSync(process.execPath, [SCANNER, '--root', root], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL C1-FETCH client\/src\/x\.ts:2/);
});

// ── C1 무크롤링 ─────────────────────────────────────────────
test('C1-FETCH: 외부 절대 URL fetch', async () => {
  expectFail(scan(await makeRoot({ source: (s) => { s['client/src/x.ts'] = j(FETCH, '("', HTTPS, 'shop.ex/p");\n'); } })), 'C1-FETCH');
});

test('C1-FETCH: 상수 경유 간접 호출', async () => {
  const src = j("const U = '", HTTPS, "shop.ex/p';\nexport const go = () => ", FETCH, '(U);\n');
  expectFail(scan(await makeRoot({ source: (s) => { s['server/src/x.ts'] = src; } })), 'C1-FETCH');
});

test('C1-FETCH: scripts/ 도 대상, WebSocket 외부', async () => {
  expectFail(scan(await makeRoot({ source: (s) => { s['scripts/x.mjs'] = j("new WebSocket('wss://", 'feed.ex/s', "');\n"); } })), 'C1-FETCH');
});

test('C1-FETCH: localhost·상대경로·주석은 통과', async () => {
  const src = j(FETCH, "('http://localhost:3001/api');\n// ", FETCH, '("', HTTPS, 'shop.ex/p")\n', FETCH, "('/api/x');\n");
  expectClean(scan(await makeRoot({ source: (s) => { s['client/src/x.ts'] = src; } })));
});

test('C1-LIB: 코드 import', async () => {
  expectFail(scan(await makeRoot({ source: (s) => { s['server/src/x.ts'] = j("import * as c from '", 'chee', "rio';\n"); } })), 'C1-LIB');
});

test('C1-LIB: package.json deps', async () => {
  const pkg = { name: 's', dependencies: { [j('puppe', 'teer')]: '^1' } };
  expectFail(scan(await makeRoot({ source: (s) => { s['server/package.json'] = JSON.stringify(pkg); } })), 'C1-LIB');
});

test('C1-LIB: jsdom 은 devDependencies 만', async () => {
  const pkg = { name: 'c', dependencies: { jsdom: '^29' } };
  expectFail(scan(await makeRoot({ source: (s) => { s['client/package.json'] = JSON.stringify(pkg); } })), 'C1-LIB');
});

test('C1-SDK: 지도 SDK 호스트가 허용 파일 밖', async () => {
  const src = j("const s = document.createElement('script'); s.src = '", HTTPS, MAP_HOST, "/maps.js';\n");
  expectFail(scan(await makeRoot({ source: (s) => { s['client/src/home/x.ts'] = src; } })), 'C1-SDK');
});

test('C1-SDK: 쇼핑 오픈API 호스트 전면 금지(허용 파일 안이어도)', async () => {
  const src = j("export const U = '", HTTPS, OPENAPI_HOST, "/v1/search';\n");
  expectFail(scan(await makeRoot({ source: (s) => { s['client/src/map/x.ts'] = src; } })), 'C1-SDK');
});

test('C1-SEEDURL: imageAsset 외부 URL', async () => {
  const res = scan(await makeRoot({ seed: (d) => { d['curated-products.json'][0].imageAsset = j(HTTPS, 'cdn.x/a.jpg'); } }));
  expectFail(res, 'C1-SEEDURL');
});

test('C1-SEEDURL: source[].url·sourceUrl 외 필드의 http URL', async () => {
  const res = scan(await makeRoot({ seed: (d) => { d['supply-items.json'][0].description = j('참고 ', HTTPS, 'shop.ex/p'); } }));
  expectFail(res, 'C1-SEEDURL');
});

// ── C2 거래·자금 ─────────────────────────────────────────────
test('C2-TRADE: 금지 모델', async () => {
  const schema = j('model VetClinic {\n  id String @id\n  lat Float?\n}\nmodel ', 'Pay', 'ment {\n  id String @id\n}\n');
  expectFail(scan(await makeRoot({ source: (s) => { s['server/prisma/schema.prisma'] = schema; } })), 'C2-TRADE');
});

test('C2-TRADE: 금지 라우트', async () => {
  const src = j("router.post('/ad", "option', handler);\n");
  expectFail(scan(await makeRoot({ source: (s) => { s['server/src/r.ts'] = src; } })), 'C2-TRADE');
});

test('C2-TRADE: 금지 식별자', async () => {
  const src = j('export const ', 'esc', 'rowId = 1;\n');
  expectFail(scan(await makeRoot({ source: (s) => { s['server/src/r.ts'] = src; } })), 'C2-TRADE');
});

test('C2-TRADE: 문자열·주석 속 단어는 통과', async () => {
  const src = j("// ", 'esc', "row 없음\nexport const KEYS = ['", 'settle', "ment'];\n");
  expectClean(scan(await makeRoot({ source: (s) => { s['server/src/r.ts'] = src; } })));
});

test('C2-PRICE: 스키마 가격 컬럼', async () => {
  const schema = j('model VetClinic {\n  id String @id\n  lat Float?\n}\nmodel CuratedProduct {\n  id String @id\n  ', 'pri', 'ce Int\n}\n');
  expectFail(scan(await makeRoot({ source: (s) => { s['server/prisma/schema.prisma'] = schema; } })), 'C2-PRICE');
});

// ── C3 노출 ─────────────────────────────────────────────────
test('C3-QUERY: 노출 모듈 import 없이 콘텐츠 모델 조회', async () => {
  const src = 'export const all = (prisma) => prisma.curatedProduct.findMany();\n';
  expectFail(scan(await makeRoot({ source: (s) => { s['server/src/products/repo.ts'] = src; } })), 'C3-QUERY');
});

test('C3-QUERY: 노출 모듈 import 하면 통과, seed/·테스트는 면제', async () => {
  const src = "import { isProductExposable } from '../engine/index.js';\nexport const all = (prisma) => prisma.curatedProduct.findMany();\n";
  const res = scan(await makeRoot({
    source: (s) => {
      s['server/src/products/repo.ts'] = src;
      s['server/src/seed/load.ts'] = 'export const r = (p) => p.curatedProduct.findMany();\n';
    },
  }));
  expectClean(res);
});

test('C3-GUARDTEST: 가드 테스트 부재', async () => {
  expectFail(scan(await makeRoot({ source: (s) => { delete s['server/src/__tests__/guards.test.ts']; } })), 'C3-GUARDTEST');
});

test('C3-OUT-ID: DRAFT 상품 id 가 HTML 에', async () => {
  const res = scan(await makeRoot({
    output: (o) => { o['index.html'] = o['index.html'].replace('</main>', '<p data-ws-id="curatedProducts#cp-002">x</p></main>'); },
  }));
  expectFail(res, 'C3-OUT-ID');
});

test('C3-OUT-ID: 비노출 아이템 requirement 가 ws-data 에', async () => {
  const res = scan(await makeRoot({
    output: (o) => {
      o['hamster/golden/index.html'] = o['hamster/golden/index.html'].replace(
        '"requirements":[',
        '"requirements":[{"animalTypeId":"hamster-golden","supplyItemId":"wheel","item":{"id":"wheel","alternativeIds":[]}},',
      );
    },
  }));
  expectFail(res, 'C3-OUT-ID');
});

// D4(Q1): 타입·아이템 id 가 각각은 노출이어도 (타입, 아이템) 쌍이 노출이 아니면 실패.
test('C3-OUT-ID: ws-data requirement 쌍 비노출(각 id 는 노출)', async () => {
  const res = scan(await makeRoot({
    seed: (d) => {
      Object.assign(d['supply-items.json'][1], meta());                // wheel item VERIFIED
      Object.assign(d['supply-requirements.json'][1], { reviewStatus: 'DRAFT' }); // golden×wheel 비노출
      d['care-profiles.json'].push({ id: 'cp-gerbil', name: '저빌 기본', taxonIds: [], facts: {}, careNotes: ['무리'], ...meta({ contentKind: 'CARE' }) });
      d['animal-types.json'].push({
        id: 'gerbil', slug: 'gerbil', group: 'SMALL_MAMMAL', displayName: '저빌', status: 'ACTIVE', aliases: [], taxonId: null,
        careProfileId: 'cp-gerbil', careOverrides: {}, ...meta({ contentKind: 'CARE' }),
      });
      d['supply-requirements.json'].push({
        id: 'req-gerbil-wheel', careProfileId: 'cp-gerbil', supplyItemId: 'wheel', priority: 'REQUIRED', orderHint: 'BEFORE_ARRIVAL',
        why: '많이 달려요', caution: null, avoid: null, searchKeyword: '저빌 쳇바퀴', minSpec: { rules: [] }, recommendedSpec: { rules: [] }, ...meta(),
      });
    },
    output: (o) => {
      o['hamster/golden/index.html'] = o['hamster/golden/index.html'].replace(
        '"requirements":[',
        '"requirements":[{"animalTypeId":"hamster-golden","supplyItemId":"wheel","item":{"id":"wheel","alternativeIds":[]}},',
      );
    },
  }));
  expectFail(res, 'C3-OUT-ID');
  assert.equal(res.json.exposed.animalTypes, 2);
  assert.equal(res.json.exposed.supplyItems, 2);
  assert.ok(res.json.findings.some((f) => f.rule === 'C3-OUT-ID' && /requirement hamster-golden\|wheel/.test(f.message)));
  assert.ok(!res.json.findings.some((f) => f.rule === 'C3-OUT-ID' && /requirement\.item/.test(f.message)));
});

test('C3-OUT-ID: 카탈로그에 비노출 id', async () => {
  const res = scan(await makeRoot({
    output: (o) => {
      const c = JSON.parse(o['data/catalog.v1.abcd1234.json']);
      c.supplyItems.push({ id: 'wheel' });
      o['data/catalog.v1.abcd1234.json'] = JSON.stringify(c);
    },
  }));
  expectFail(res, 'C3-OUT-ID');
});

test('C3-OUT-ID: 알 수 없는 시드 키 접두사도 실패(fail-closed)', async () => {
  const res = scan(await makeRoot({
    output: (o) => { o['index.html'] = o['index.html'].replace('</main>', '<p data-ws-id="widgets#w1">x</p></main>'); },
  }));
  expectFail(res, 'C3-OUT-ID');
});

test('C3-OUT-ID: override 가 최소 규격을 조이면 상품 비노출', async () => {
  const res = scan(await makeRoot({
    seed: (d) => {
      d['animal-types.json'][0].careOverrides = {
        requirements: { cage: { minSpec: { rules: [{ key: 'floorWcm', op: 'gte', value: 100, reason: 'r' }] } } },
      };
    },
    output: noop,
  }));
  expectFail(res, 'C3-OUT-ID');
});

test('C3-OUT-ID: AI_DRAFT 를 VERIFIED 로 표시한 타입은 비노출', async () => {
  const res = scan(await makeRoot({ seed: (d) => { d['animal-types.json'][0].reviewerType = 'AI_DRAFT'; }, output: noop }));
  expectFail(res, 'C3-OUT-ID');
  expectFail(res, 'C3-OUT-ROUTE');
});

test('C3-OUT-ID: 알 수 없는 reviewerType(블록리스트 아님, rank ≥ OPERATOR 허용목록)', async () => {
  for (const bad of ['HUMAN', '', null]) {
    const res = scan(await makeRoot({ seed: (d) => { d['curated-products.json'][0].reviewerType = bad; }, output: noop }));
    expectFail(res, 'C3-OUT-ID');
  }
});

test('C3-OUT-ID: 같은 id 중복 행 중 하나라도 비노출이면 비노출', async () => {
  const res = scan(await makeRoot({
    seed: (d) => { d['curated-products.json'].push({ ...d['curated-products.json'][0], reviewStatus: 'DRAFT' }); },
    output: noop,
  }));
  expectFail(res, 'C3-OUT-ID');
});

test('C3-OUT-ROUTE: seedDigest 불일치', async () => {
  const res = scan(await makeRoot({ output: noop, manifest: (dg) => manifestFor(dg.replace(/^./, dg[0] === 'a' ? 'b' : 'a')) }));
  expectFail(res, 'C3-OUT-ROUTE');
});

test('C3-OUT-ROUTE: sitemap 에 manifest indexable 밖 URL', async () => {
  const res = scan(await makeRoot({
    output: (o) => { o['sitemap.xml'] = o['sitemap.xml'].replace('</urlset>', '<url><loc>http://localhost:3001/vet</loc></url></urlset>'); },
  }));
  expectFail(res, 'C3-OUT-ROUTE');
});

test('C3-OUT-ROUTE: DRAFT 타입 페이지', async () => {
  const res = scan(await makeRoot({
    output: noop,
    manifest: (dg) => {
      const m = manifestFor(dg);
      m.routes.push({ path: '/hamster/dwarf', file: 'index.html', kind: 'TYPE', typeId: 'hamster-dwarf', indexable: false });
      return m;
    },
  }));
  expectFail(res, 'C3-OUT-ROUTE');
});

// ── C4 금지어 ───────────────────────────────────────────────
test('C4-BANNED: 시드 제로폭 우회(stripped/spaced 정규화)', async () => {
  const res = scan(await makeRoot({ seed: (d) => { d['supply-requirements.json'][0].why = j('최', '​', '저가 상품'); } }));
  expectFail(res, 'C4-BANNED');
});

test('C4-BANNED: 시드 NFD 분해형', async () => {
  const res = scan(await makeRoot({ seed: (d) => { d['supply-items.json'][0].description = KO.safe.normalize('NFD'); } }));
  expectFail(res, 'C4-BANNED');
});

test('C4-BANNED: 시드 전문가 N명(한글 수사)', async () => {
  const res = scan(await makeRoot({ seed: (d) => { d['setup-bundles.json'][0].purpose = j(KO.expertN, ' 열 명이 골랐어요'); } }));
  expectFail(res, 'C4-BANNED');
});

test('C4-BANNED: 산출물 가시 텍스트 공백 우회', async () => {
  const spaced = KO.signup.split('').join(' ');
  const res = scan(await makeRoot({ output: (o) => { o['index.html'] = o['index.html'].replace('</main>', `<p>${spaced}</p></main>`); } }));
  expectFail(res, 'C4-BANNED');
});

test('C4-BANNED: 산출물 alt·meta content·JSON 문자열', async () => {
  for (const mut of [
    (o) => { o['index.html'] = o['index.html'].replace('</main>', `<img src="/assets/a.webp" alt="${KO.best} 케이지"></main>`); },
    (o) => { o['index.html'] = o['index.html'].replace('작은 반려동물 준비', KO.cheapest); },
    (o) => { o['index.html'] = o['index.html'].replace('"data":{', `"note":"${KO.okay}","data":{`); },
  ]) {
    expectFail(scan(await makeRoot({ output: mut })), 'C4-BANNED');
  }
});

test('C4-BANNED: 태그 경계에 걸친 금지어', async () => {
  const [a, b] = [KO.signup.slice(0, 2), KO.signup.slice(2)];
  const res = scan(await makeRoot({ output: (o) => { o['index.html'] = o['index.html'].replace('</main>', `<p><b>${a}</b>${b}</p></main>`); } }));
  expectFail(res, 'C4-BANNED');
});

test('C4-BANNED: 2자 금지어 공백 분리는 WARN 만(exit 0)', async () => {
  const res = scan(await makeRoot({ seed: (d) => { d['supply-items.json'][0].description = j('가', KO.purchase[0], ' ', KO.purchase[1], '장'); } }));
  expectClean(res);
  assert.ok(rulesOf(res, 'WARN').includes('C4-BANNED'));
});

test('C4-BANNED: 제외 필드(id·url·source.title·verifiedBy·photos.query)는 검사 안 함', async () => {
  const res = scan(await makeRoot({
    seed: (d) => {
      d['supply-items.json'][0].source[0].title = KO.best;
      d['supply-items.json'][0].verifiedBy = KO.best;
      d['photos.json'][0].query = KO.best;
      d['photos.json'][0].scene = KO.best;
    },
  }));
  expectClean(res);
});

test('C4-CODE: 코드 리터럴 금지어는 WARN(R3, exit 0)', async () => {
  const src = j('export const Login = () => <button>', KO.signup, "</button>;\nexport const t = '", KO.purchase, "';\n");
  const res = scan(await makeRoot({ source: (s) => { s['client/src/auth/LoginView.tsx'] = src; } }));
  expectClean(res);
  assert.ok(rulesOf(res, 'WARN').filter((r) => r === 'C4-CODE').length >= 2);
});

// ── C5 위치 ─────────────────────────────────────────────────
test('C5-GEO: 좌표 + localStorage 근접', async () => {
  const src = j('navigator.geolocation.getCurrentPosition((pos) => {\n  const c = pos.coords;\n  local', 'Storage.setItem(\'pos\', JSON.stringify(c));\n});\n');
  expectFail(scan(await makeRoot({ source: (s) => { s['client/src/g.ts'] = src; } })), 'C5-GEO');
});

test('C5-GEO: 좌표 + 네트워크 전송 근접', async () => {
  const src = j('const body = { lat: p.lat, lng: p.lng };\n', FETCH, "('/api/where', { method: 'POST', body: JSON.stringify(body) });\n");
  expectFail(scan(await makeRoot({ source: (s) => { s['client/src/g.ts'] = src; } })), 'C5-GEO');
});

test('C5-GEO: VetClinic 외 스키마 좌표 컬럼', async () => {
  const schema = 'model VetClinic {\n  id String @id\n  lat Float?\n}\nmodel User {\n  id String @id\n  lat Float\n}\n';
  expectFail(scan(await makeRoot({ source: (s) => { s['server/prisma/schema.prisma'] = schema; } })), 'C5-GEO');
});

test('C5-GEO: vet-clinics.json 외 시드 좌표 키', async () => {
  expectFail(scan(await makeRoot({ seed: (d) => { d['animal-types.json'][0].lat = 37.5; } })), 'C5-GEO');
});

test('C5-GEO: 클라 메모리 사용(전송·영속 없음)은 통과', async () => {
  const src = 'navigator.geolocation.getCurrentPosition((pos) => {\n  setCenter(pos.coords.latitude, pos.coords.longitude);\n});\n';
  expectClean(scan(await makeRoot({ source: (s) => { s['client/src/g.ts'] = src; } })));
});

// ── C6 이미지 ───────────────────────────────────────────────
const ccByPhoto = (over = {}) => ({
  id: 'ph-02', scene: 'x', slot: 'intro-2', query: 'q', source: 'Wikimedia Commons', license: 'CC_BY', author: 'Jane',
  sourceUrl: j(HTTPS, 'commons.example.org/p.jpg'), downloadedAt: '2026-09-30', modified: false, status: 'READY', ...over,
});

test('C6-IMG: CC_BY 사진 author 없음', async () => {
  expectFail(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto({ author: null })); } })), 'C6-IMG');
});

test('C6-IMG: 라이선스 허용 외 값·http sourceUrl', async () => {
  expectFail(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto({ license: 'UNKNOWN' })); } })), 'C6-IMG');
  expectFail(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto({ sourceUrl: 'http://commons.example.org/p.jpg' })); } })), 'C6-IMG');
});

test('C6-IMG: 상품 imageAsset 인데 imageLicense 허용 외', async () => {
  expectFail(scan(await makeRoot({ seed: (d) => { d['curated-products.json'][0].imageLicense = 'NONE'; } })), 'C6-IMG');
});

test('C6-IMG: 후기 reviewerImage 동의 없음', async () => {
  expectFail(scan(await makeRoot({ seed: (d) => { d['testimonials.json'][0].reviewerImage = '/assets/reviewers/a.webp'; } })), 'C6-IMG');
});

test('C6-IMG: CC_BY 사진 있는데 /credits 누락', async () => {
  expectFail(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto()); }, output: noop })), 'C6-IMG');
});

test('C6-IMG: CC_BY 사진 + /credits 페이지 + 모든 페이지 링크 → 통과', async () => {
  const res = scan(await makeRoot({
    seed: (d) => { d['photos.json'].push(ccByPhoto()); },
    output: (o) => {
      for (const k of Object.keys(o)) if (k.endsWith('.html')) o[k] = o[k].replace('</footer>', '<a href="/credits">사진 출처</a></footer>');
      o['credits/index.html'] = o['index.html'];
    },
    manifest: (dg) => {
      const m = manifestFor(dg);
      m.routes.push({ path: '/credits', file: 'credits/index.html', kind: 'CREDITS', indexable: false });
      return m;
    },
  }));
  expectClean(res);
});

// D1(Q1): credits 링크 규칙은 manifest 라우트 파일에만 — SPA 셸·비라우트 HTML 제외.
function creditsFixture({ dropLinkFrom = null } = {}) {
  return {
    seed: (d) => { d['photos.json'].push(ccByPhoto()); },
    output: (o) => {
      for (const k of Object.keys(o)) if (k.endsWith('.html') && k !== dropLinkFrom) o[k] = o[k].replace('</footer>', '<a href="/credits">사진 출처</a></footer>');
      o['credits/index.html'] = o['index.html'];
      o['404.html'] = o['index.html'];
      o['shell.html'] = '<!doctype html><html lang="ko"><head><title>WithSmall</title></head><body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body></html>';
    },
    manifest: (dg) => {
      const m = manifestFor(dg);
      m.routes.push({ path: '/credits', file: 'credits/index.html', kind: 'CREDITS', indexable: false });
      m.routes.push({ path: '/404', file: '404.html', kind: 'NOT_FOUND', indexable: false });
      return m;
    },
  };
}

test('C6-IMG: CC_BY 사진 + 링크 없는 shell.html(비라우트) → 통과', async () => {
  expectClean(scan(await makeRoot(creditsFixture())));
});

test('C6-IMG: CC_BY 사진 + manifest 라우트 페이지(404 포함)에 링크 없음 → 실패', async () => {
  expectFail(scan(await makeRoot(creditsFixture({ dropLinkFrom: 'hamster/golden/index.html' }))), 'C6-IMG');
  const res = scan(await makeRoot((() => {
    const f = creditsFixture();
    const out = f.output;
    f.output = (o) => { out(o); o['404.html'] = o['404.html'].replace('<a href="/credits">사진 출처</a>', ''); };
    return f;
  })()));
  expectFail(res, 'C6-IMG');
});

// D3(Q1): 자산 경로는 TS P05/T03 과 같은 정규식.
test('C1-SEEDURL: imageAsset·reviewerImage 가 /assets/products|reviewers/<kebab>.(webp…) 밖', async () => {
  const bad = j('/assets/x/', 'Y.svg');
  expectFail(scan(await makeRoot({ seed: (d) => { d['curated-products.json'][0].imageAsset = bad; } })), 'C1-SEEDURL');
  expectFail(scan(await makeRoot({ seed: (d) => { Object.assign(d['testimonials.json'][0], { reviewerImage: bad, reviewerImageConsent: true }); } })), 'C1-SEEDURL');
  expectFail(scan(await makeRoot({ seed: (d) => { d['curated-products.json'][0].imageAsset = '/assets/products/Cp-001.webp'; } })), 'C1-SEEDURL');
  expectFail(scan(await makeRoot({ seed: (d) => { d['curated-products.json'][0].imageAsset = '/assets/reviewers/cp-001.webp'; } })), 'C1-SEEDURL');
});

// ── C7 시크릿 ───────────────────────────────────────────────
test('C7-SECRET: 하드코딩 JWT 시크릿', async () => {
  const src = j('const ', 'JWT_', 'SECRET = "', 'abcdefghijklmnopqrstu', '";\n');
  expectFail(scan(await makeRoot({ source: (s) => { s['server/src/s.ts'] = src; } })), 'C7-SECRET');
});

test('C7-SECRET: 주석 속 PEM 헤더도 실패', async () => {
  const src = j('// -----BEGIN ', 'PRIVATE KEY-----\n');
  expectFail(scan(await makeRoot({ source: (s) => { s['scripts/k.mjs'] = src; } })), 'C7-SECRET');
});

test('C7-SECRET: git 추적 .env', async () => {
  const root = await makeRoot();
  writeFileSync(join(root, 'server', '.env'), 'X=1\n');
  writeFileSync(join(root, 'server', '.env.example'), 'X=\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-f', 'server/.env', 'server/.env.example'], { cwd: root });
  const res = scan(root);
  expectFail(res, 'C7-SECRET');
  assert.equal(res.json.findings.filter((f) => f.rule === 'C7-SECRET').length, 1);
});

// ── C8 산출물 안전 ──────────────────────────────────────────
test('C8-OUT-SAFE: 외부 script src', async () => {
  const res = scan(await makeRoot({ output: (o) => { o['index.html'] = o['index.html'].replace('</body>', j('<script src="', HTTPS, 'cdn.x/y.js"></script></body>')); } }));
  expectFail(res, 'C8-OUT-SAFE');
});

test('C8-OUT-SAFE: 프로토콜 상대 script src(//host)', async () => {
  const res = scan(await makeRoot({ output: (o) => { o['index.html'] = o['index.html'].replace('</body>', '<script src="//evil/x.js"></script></body>'); } }));
  expectFail(res, 'C8-OUT-SAFE');
});

test('C8-OUT-SAFE: 같은 오리진 비모듈 script src(/registerSW.js)는 통과', async () => {
  const res = scan(await makeRoot({ output: (o) => { o['index.html'] = o['index.html'].replace('</body>', '<script defer src="/registerSW.js"></script></body>'); } }));
  expectClean(res);
});

test('C8-OUT-SAFE: 인라인 JS', async () => {
  const res = scan(await makeRoot({ output: (o) => { o['index.html'] = o['index.html'].replace('</body>', '<script>alert(1)</script></body>'); } }));
  expectFail(res, 'C8-OUT-SAFE');
});

test('C8-OUT-SAFE: JSON 블록 속 </', async () => {
  const res = scan(await makeRoot({ output: (o) => { o['index.html'] = o['index.html'].replace('"data":{', '"x":"</b>","data":{'); } }));
  expectFail(res, 'C8-OUT-SAFE');
});

test('C8-OUT-SAFE: iframe·외부 link·noopener 없는 외부 a', async () => {
  for (const add of [
    '<iframe src="/x"></iframe>',
    j('<link rel="stylesheet" href="', HTTPS, 'cdn.x/a.css">'),
    j('<a href="', HTTPS, 'shop.ex/p">x</a>'),
  ]) {
    const res = scan(await makeRoot({ output: (o) => { o['index.html'] = o['index.html'].replace('</main>', `${add}</main>`); } }));
    expectFail(res, 'C8-OUT-SAFE');
  }
});

test('C8-OUT-SAFE: manifest.indexable≠true 인데 robots 허용', async () => {
  const res = scan(await makeRoot({ output: (o) => { o['robots.txt'] = 'User-agent: *\nAllow: /\n'; } }));
  expectFail(res, 'C8-OUT-SAFE');
});

test('C8-OUT-SAFE: manifest.indexable=true 면 robots 허용 가능', async () => {
  const res = scan(await makeRoot({
    output: (o) => { o['robots.txt'] = 'User-agent: *\nAllow: /\n'; },
    manifest: (dg) => manifestFor(dg, { indexable: true }),
  }));
  expectClean(res);
});

// ── 정규화 단위(§6-1) ───────────────────────────────────────
test('normalize: spaced/stripped 절차와 판정', async () => {
  const { normalizeLintText, compileBannedWords, lintText } = await import('../lib/normalize.mjs');
  const bw = compileBannedWords(BANNED_WORDS);
  assert.equal(normalizeLintText(j('a­', 'b​ c\t\n d'), 'spaced'), 'ab c d');
  assert.equal(normalizeLintText('a b  c', 'stripped'), 'abc');
  assert.deepEqual(lintText(KO.safe.normalize('NFD'), bw).map((h) => h.rule), ['L01']);
  assert.deepEqual(lintText(j(KO.expertN, '４명'), bw).map((h) => h.rule), ['L01']);
  assert.deepEqual(lintText(j('가', KO.purchase[0], ' ', KO.purchase[1], '장'), bw).map((h) => h.rule), ['L06']);
  assert.deepEqual(lintText(j(KO.safeStem, '·세척'), bw).map((h) => h.rule), ['L02']);
  assert.deepEqual(lintText('깨끗', bw), []);
});

test('실트리 소스 파일이 존재하면 테스트 픽스처와 무관하게 읽힌다(스모크)', () => {
  assert.ok(existsSync(SCANNER));
  assert.ok(readFileSync(SCANNER, 'utf8').length > 0);
});
