// R3 F2 — 사이트 모델·라우트·페이지(계획 §2 F2 (a)~(d), §4, §6-2, §6-3).
//   실시드는 읽기만. 승격 픽스처는 메모리 사본(디스크의 AI_DRAFT 를 VERIFIED 로 기록하지 않는다, §10-2).
//   노출 기준 비교는 compliance 의 독립 재구현(scripts/lib/seed-exposure.mjs, D9)으로 한다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SeedBundle } from '../engine/index.js';
import { WS_DATA_KEYS, decodeWsPage } from '../engine/index.js';
import { SEED_FILES } from '../seed/common.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { loadMascots, sanitizeMascotSvg } from '../prerender/mascot.js';
import { COPY } from '../prerender/copy.js';
import { PHOTO_SOURCES } from '../seed/validate-structure.js';
import { FIXTURE_AS_OF, FIXTURE_FIRST_STALE, FIXTURE_LAST_FRESH, V, patch, promoted, realSeed, type Row } from './fixtures/prerender-seed.js';
import { lintText } from '../seed/lint.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..');
const TEMPLATE = readFileSync(join(ROOT, 'client', 'index.html'), 'utf8');
const ORIGIN = 'http://localhost:3001';
const DIGEST = 'a'.repeat(64);

type Exposure = {
  ids: Record<string, Set<string>>;
  pairs: Set<string>;
  productTypes: Set<string>;
};
const exposureMod = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'seed-exposure.mjs')).href)) as {
  computeExposure: (seed: Record<string, unknown[]>, asOf: string) => Exposure;
};

const build = (seed: SeedBundle, indexable = false, asOf = FIXTURE_AS_OF): SiteBuild =>
  buildSite(seed, { template: TEMPLATE, origin: ORIGIN, seedDigest: DIGEST, indexable, asOf });

const paths = (b: SiteBuild): string[] => b.routes.map((r) => r.path);

function wsDataOf(html: string): Record<string, unknown> {
  const m = /<script id="ws-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('ws-data 없음');
  expect(m[1].includes('</')).toBe(false);
  // 와이어(v2) → 메모리(v1) — 클라이언트 readPageData 와 같은 디코더(engine/ws-wire). 거부(null)면 실패.
  const d = decodeWsPage(JSON.parse(m[1]));
  if (!d) throw new Error('ws-data 디코드 거부');
  return d as unknown as Record<string, unknown>;
}

const rawOf = (seed: SeedBundle): Record<string, unknown[]> =>
  Object.fromEntries(Object.keys(SEED_FILES).map((k) => [k, seed[k as keyof SeedBundle] as unknown[]]));

/** 산출물의 모든 id 가 독립 재구현 노출 집합 안에 있는지(C3-OUT-ID 와 같은 기준). 위반 목록 반환. */
function leaks(b: SiteBuild, seed: SeedBundle, asOf = FIXTURE_AS_OF): string[] {
  const ex = exposureMod.computeExposure(rawOf(seed), asOf);
  const bad: string[] = [];
  const COLL: Record<string, string> = {
    types: 'animalTypes',
    products: 'curatedProducts',
    bundles: 'setupBundles',
    vets: 'vetClinics',
    testimonials: 'testimonials',
  };
  for (const p of b.pages) {
    const d = wsDataOf(p.html) as { route: Row; layer: Row | null; data: Record<string, Row[]> };
    expect(Object.keys(d.data).sort()).toEqual([...WS_DATA_KEYS].sort());
    if (d.route.typeId !== undefined && !ex.ids.animalTypes.has(d.route.typeId as string)) bad.push(`${p.route.path} route.typeId`);
    if (d.layer) {
      const L = d.layer;
      if (L.itemId !== undefined && !ex.pairs.has(`${L.typeId}|${L.itemId}`)) bad.push(`${p.route.path} layer.itemId`);
      if (L.productId !== undefined && !ex.productTypes.has(`${L.typeId}|${L.productId}`)) bad.push(`${p.route.path} layer.productId`);
    }
    for (const [k, arr] of Object.entries(d.data)) {
      for (const x of arr) {
        if (k === 'requirements') {
          if (!ex.pairs.has(`${x.animalTypeId}|${x.supplyItemId}`)) bad.push(`${p.route.path} req ${x.animalTypeId}|${x.supplyItemId}`);
          const item = x.item as Row;
          if (!ex.ids.supplyItems.has(item.id as string)) bad.push(`${p.route.path} item ${item.id}`);
          for (const alt of item.alternativeIds as string[]) if (!ex.ids.supplyItems.has(alt)) bad.push(`${p.route.path} alt ${alt}`);
        } else if (!ex.ids[COLL[k]].has(x.id as string)) bad.push(`${p.route.path} ${k}#${x.id}`);
      }
    }
    for (const m of p.html.matchAll(/data-ws-id="([^"]*)"/g)) {
      const [key, id, extra] = m[1].split('#');
      if (extra !== undefined || !ex.ids[key]?.has(id)) bad.push(`${p.route.path} data-ws-id ${m[1]}`);
    }
    for (const m of p.html.matchAll(/data-ws-type="([^"]*)"/g)) if (!ex.ids.animalTypes.has(m[1])) bad.push(`${p.route.path} data-ws-type ${m[1]}`);
  }
  for (const [k, arr] of Object.entries(b.catalog)) {
    if (!Array.isArray(arr)) continue;
    for (const x of arr as Row[]) if (!ex.ids[k]?.has(x.id as string)) bad.push(`catalog ${k}#${x.id}`);
  }
  return bad;
}

/** 페이지 가시 텍스트(태그 제거) — 금지어 검사용. */
const visibleText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/g, ' ');

describe('(a) 실시드(VERIFIED 0) → /, /supplies, /vet + 404', () => {
  const b = build(realSeed());

  it('고정 라우트(R4 D6: /credits 항상 noindex · 86 P8: /privacy 항상 색인)', () => {
    // 51 레인 A(K1): /pick 항상(noindex·sitemap 제외).
    expect(paths(b)).toEqual(['/', '/supplies', '/vet', '/save', '/pick', '/credits', '/privacy', '/404']);
    expect(b.routes.map((r) => r.kind)).toEqual(['HOME', 'SUPPLIES', 'VET', 'SAVE', 'PICK', 'CREDITS', 'PRIVACY', 'NOT_FOUND']);
    expect(b.routes.find((r) => r.kind === 'CREDITS')?.indexable).toBe(false);
    expect(b.routes.find((r) => r.kind === 'NOT_FOUND')?.file).toBe('404.html');
  });

  it('indexable 은 / · /privacy 만, sitemap 2건, robots Disallow', () => {
    // 계획 86 P8: /privacy 는 항상 색인·sitemap 포함.
    expect(b.routes.filter((r) => r.indexable).map((r) => r.path)).toEqual(['/', '/privacy']);
    const sm = b.files.get('sitemap.xml') as string;
    expect(sm.match(/<loc>/g)).toHaveLength(2);
    expect(sm).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(b.files.get('robots.txt')).toBe('User-agent: *\nDisallow: /\n');
    expect(b.manifest.indexable).toBe(false);
  });

  it('비색인 페이지는 noindex, / 는 아님', () => {
    const page = (p: string) => b.pages.find((x) => x.route.path === p)?.html as string;
    expect(page('/')).not.toContain('name="robots"');
    for (const p of ['/supplies', '/vet', '/404']) expect(page(p)).toContain('<meta name="robots" content="noindex">');
  });

  it('홈 A: 후기 0 → ② 섹션 없음, 고정 섹션 제목 포함, 마커 0, title 1개', () => {
    const html = b.pages[0].html;
    expect(html).not.toContain('data-ws-section="reviews"');
    expect(html).toContain('작은 친구를 처음부터 제대로 준비해요');
    // 51 레인 A: 소개 제목은 client SplitTitle 마크업(" — " 를 visually-hidden span 으로 분리).
    expect(html).toContain('<span class="ws-split-title">WithSmall 소개</span><span class="ws-visually-hidden"> — </span><span class="ws-split-sub">작은 친구의 첫 준비를 이렇게 도와요</span>');
    expect(html).not.toMatch(/ws:head|ws:body/);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain('<div id="root" data-ws-prerendered="1">');
  });

  it('/supplies 는 노출 카테고리만(0개 → 그룹 0, D-49)·링크 0·빈 상태, /vet 은 빈 상태 문구', () => {
    const sup = b.pages.find((x) => x.route.path === '/supplies')?.html as string;
    expect(sup).not.toContain('data-ws-category=');
    expect(sup).toContain(COPY.supplies.empty);
    expect(sup).not.toMatch(/href="\/supplies\//);
    const vet = b.pages.find((x) => x.route.path === '/vet')?.html as string;
    expect(vet).toContain('전화로 확인한 병원을 준비하고 있어요');
  });

  it('공개 카탈로그·ws-data 모두 비어 있다(노출 0)', () => {
    for (const k of ['animalTypes', 'careProfiles', 'supplyItems', 'supplyRequirements', 'compatibilityRules'] as const) {
      expect(b.catalog[k]).toEqual([]);
    }
    expect(leaks(b, realSeed())).toEqual([]);
    expect(b.catalogFile).toMatch(/^data\/catalog\.v1\.[0-9a-f]{8}\.json$/);
  });
});

describe('(b) golden 체인 승격(메모리) → §4 전체 트리', () => {
  const seed = promoted();
  const b = build(seed);
  const page = (p: string): string => {
    const x = b.pages.find((y) => y.route.path === p);
    if (!x) throw new Error(`page ${p} 없음`);
    return x.html;
  };

  it('라우트 트리 = §4', () => {
    expect(paths(b)).toEqual([
      '/',
      '/hamster',
      '/hamster/golden',
      '/hamster/golden/setup',
      '/hamster/golden/supplies/cage',
      '/hamster/golden/check/cage',
      '/hamster/golden/supplies/wheel',
      '/hamster/golden/check/wheel',
      '/hamster/golden/products/cp-001',
      '/supplies',
      '/supplies/cage',
      '/supplies/cage/hamster-golden',
      '/supplies/wheel',
      '/supplies/wheel/hamster-golden',
      '/vet',
      '/vet/서울-마포구',
      '/save',
      '/pick',
      '/credits',
      '/privacy',
      '/404',
    ]);
    expect(b.routes.find((r) => r.path === '/vet/서울-마포구')).toMatchObject({ kind: 'VET_REGION', region: '서울 마포구', file: 'vet/서울-마포구/index.html' });
    expect(b.routes.find((r) => r.path === '/hamster')).toMatchObject({ kind: 'FAMILY', family: 'hamster' });
    expect(b.routes.find((r) => r.path === '/hamster/golden/products/cp-001')).toMatchObject({
      kind: 'TYPE',
      typeId: 'hamster-golden',
      layer: { kind: 'L7', typeId: 'hamster-golden', productId: 'cp-001' },
    });
  });

  it('D11: /supplies/{item}/{type} 는 canonical=타입 레이어, sitemap 제외, noindex 아님', () => {
    const r = b.routes.find((x) => x.path === '/supplies/cage/hamster-golden');
    expect(r).toMatchObject({ kind: 'SUPPLY_ITEM_TYPE', indexable: false, canonicalPath: '/hamster/golden/supplies/cage' });
    const html = page('/supplies/cage/hamster-golden');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/hamster/golden/supplies/cage">`);
    expect(html).not.toContain('name="robots"');
    expect(b.files.get('sitemap.xml')).not.toContain('/supplies/cage/hamster-golden');
  });

  it('sitemap = indexable 라우트, lastmod 는 verifiedAt 최댓값, 한글 지역 percent-encode', () => {
    const sm = b.files.get('sitemap.xml') as string;
    const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decodeURIComponent(m[1].slice(ORIGIN.length)));
    expect(locs.sort()).toEqual(b.routes.filter((r) => r.indexable).map((r) => r.path).sort());
    expect(sm).toContain(`<loc>${ORIGIN}/hamster/golden</loc><lastmod>2026-09-30</lastmod>`);
    expect(sm).toContain(`${ORIGIN}/vet/${encodeURIComponent('서울-마포구')}</loc><lastmod>2026-09-28</lastmod>`);
  });

  it('타입 홈 B: 컨텍스트 + 5섹션 순서, ① 진행 숫자 없음(D18 — 칩 규격 요약 G-1 만 예외), ④ 병원 레일(D16) + /vet 링크', () => {
    const html = page('/hamster/golden');
    const order = ['now', 'bundles', 'products', 'vet', 'save'].map((s) => html.indexOf(`data-ws-section="${s}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // 51 레인 A: client RailSection 마크업(h2.ws-t-section + p.ws-rail-sub), NeedChip 규격 span.ws-need-spec.
    expect(html).toContain('<h2 id="ws-sec-now-title" class="ws-t-section">지금 필요한 것</h2><p class="ws-rail-sub ws-t-body">필수 준비를 먼저 확인해요</p>');
    // 여는 태그 속성(data-ws-answered="0")은 가시 텍스트가 아니므로 태그 끝 이후부터.
    const now = html.slice(html.indexOf('>', order[0]) + 1, order[1]);
    // 진행·개수 숫자 0. 숫자는 칩 규격 요약(엔진 chipSpecText, "28cm 이상")에만.
    expect(visibleText(now.replace(/<span class="ws-t-meta ws-need-spec">[^<]*<\/span>/g, ''))).not.toMatch(/\d/);
    expect(now).toContain('<span class="ws-t-meta ws-need-spec">100×50×50cm 이상</span>');
    expect(now).not.toContain('↑');
    const vet = html.slice(order[3], order[4]);
    expect(vet).toContain('href="/vet"');
    expect(vet).toContain('data-ws-id="vetClinics#');
    expect(html).toContain('data-ws-type="hamster-golden"');
    expect(html).toContain('골든햄스터 준비, 이어서 할까요?');
  });

  it('L4 레이어: 부모 본문 + US-007 순서, 규격 문장, 검색 링크 rel noopener', () => {
    const html = page('/hamster/golden/supplies/wheel');
    expect(html).toContain('data-ws-section="now"'); // 부모 페이지 유지
    const aside = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
    const order = ['why', 'conditions', 'caution', 'avoid'].map((k) => aside.indexOf(`data-ws-part="${k}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(aside).toContain('지름 27cm 이상');
    expect(aside).toContain('마지막 검수 2026.09');
    expect(aside).toContain('data-ws-id="curatedProducts#cp-001"');
    for (const m of aside.matchAll(/<a href="https:[^"]*"[^>]*>/g)) expect(m[0]).toContain('rel="noopener noreferrer nofollow"');
    expect(aside).toContain('https://www.coupang.com/np/search?q=');
    // 대안 saucer 는 DRAFT → 렌더·ws-data 에 없음
    expect(html).not.toContain('saucer');
  });

  it('L5 정적 폼(판정 없음), L7 상품 상세(가격·판매처 없음)', () => {
    const l5 = page('/hamster/golden/check/cage');
    expect(l5).toContain('data-ws-layer="L5"');
    expect(l5).toContain('<fieldset disabled>');
    const l7 = page('/hamster/golden/products/cp-001');
    expect(l7).toContain('data-ws-layer="L7"');
    expect(l7).toContain('픽스처 쳇바퀴 A');
    expect(l7).toContain('기준 충족');
    // L7 레이어 본문에는 가격·판매처 없음(부모 페이지의 구성안 참고 범위 안내는 별개)
    const l7aside = l7.slice(l7.indexOf('<aside'), l7.indexOf('</aside>'));
    expect(l7aside).not.toMatch(/가격|판매처|원\b/);
    // 찾기 버튼은 PRD US-012 문구 2개, "이 조건으로 찾기"는 소제목뿐(K1)
    expect(l7aside.match(/<a href="https:/g)).toHaveLength(2);
    expect(l7aside).toContain('>이 조건으로 쿠팡에서 찾기<span class="ws-visually-hidden"> (새 창)</span></a>');
    expect(l7aside).toContain('>이 조건으로 네이버에서 찾기<span class="ws-visually-hidden"> (새 창)</span></a>');
    expect(l7aside).toContain('<h3>이 조건으로 찾기</h3>');
    // 구성안 참고 범위 옆 안내(K1)
    expect(page('/hamster/golden')).toContain('참고 범위예요. 실제 가격은 판매처마다 달라요');
  });

  it('PublicProduct.verdict 는 orderExposableProducts 결과(OK)', () => {
    const d = wsDataOf(page('/hamster/golden')) as { data: { products: Row[] } };
    expect(d.data.products).toEqual([
      expect.objectContaining({ id: 'cp-001', verdict: 'OK', reasonCodes: ['SPEC_MET', 'PROFILE_MATCH'], specVerifiedAt: '2026-09-30' }),
    ]);
  });

  it('공개 투영: verifiedBy·운영 메모·DRAFT 본문이 어떤 산출물에도 없다', () => {
    const all = [...b.files.values()].join('\n');
    expect(all).not.toContain('keeper-hidden-name');
    expect(all).not.toContain('hidden-ops-note');
    const drafts = seed.supplyRequirements.filter((r) => r.reviewStatus !== 'VERIFIED').map((r) => r.why);
    expect(drafts.length).toBeGreaterThan(5);
    for (const w of drafts) expect(all).not.toContain(w);
    expect(all).not.toContain('운영자가 실제 상품명'); // curated note
  });

  it('후기 1개 → 홈 ② 섹션, /credits 와 모든 페이지 푸터 링크', () => {
    expect(page('/')).toContain('data-ws-section="reviews"');
    for (const p of b.pages) expect(p.html).toContain('href="/credits"');
    expect(page('/credits')).toContain('Fixture Author');
  });

  it('JSON 블록에 `</` 없음, ws-data ≤ 32KB', () => {
    for (const p of b.pages) {
      for (const m of p.html.matchAll(/<script[^>]*type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/g)) {
        expect(m[1].includes('</')).toBe(false);
        expect(() => JSON.parse(m[1])).not.toThrow();
      }
      expect(p.wsDataBytes).toBeLessThanOrEqual(32 * 1024);
    }
  });

  it('렌더 텍스트에 금지어(L01) 0 — 페이지 경계 결합 포함', () => {
    for (const p of b.pages) {
      const hits = lintText(visibleText(p.html)).filter((x) => x.rule === 'L01');
      expect(hits, p.route.path).toEqual([]);
    }
  });

  it('결정론: 두 번 빌드하면 파일이 바이트 단위로 같다', () => {
    const again = build(promoted());
    expect([...again.files.entries()]).toEqual([...b.files.entries()]);
  });

  it('WS_INDEXABLE=1 일 때만 robots Allow + Sitemap', () => {
    const on = build(promoted(), true);
    expect(on.files.get('robots.txt')).toBe(`User-agent: *\nAllow: /\nDisallow: /save\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
    expect(on.manifest.indexable).toBe(true);
  });
});

describe('(c) 같은 승격에서 type 만 DRAFT → 타입 라우트 0', () => {
  const seed = promoted({ typeDraft: true });
  const b = build(seed);
  it('TYPE·SETUP·FAMILY·SUPPLY_ITEM* 라우트 없음, typeId 0', () => {
    expect(b.routes.filter((r) => ['FAMILY', 'TYPE', 'SETUP', 'SUPPLY_ITEM', 'SUPPLY_ITEM_TYPE'].includes(r.kind))).toEqual([]);
    expect(b.routes.filter((r) => r.typeId !== undefined)).toEqual([]);
    expect(paths(b)).toEqual(['/', '/supplies', '/vet', '/vet/서울-마포구', '/save', '/pick', '/credits', '/privacy', '/404']);
    expect(b.catalog.animalTypes).toEqual([]);
    expect(b.catalog.supplyRequirements).toEqual([]);
  });
});

describe('(d) 비노출 id 가 어떤 ws-data·data-ws-id·카탈로그에도 없다', () => {
  it('실시드', () => expect(leaks(build(realSeed()), realSeed())).toEqual([]));
  it('승격 픽스처', () => {
    const s = promoted();
    expect(leaks(build(s), s)).toEqual([]);
  });
  it('type DRAFT 픽스처', () => {
    const s = promoted({ typeDraft: true });
    expect(leaks(build(s), s)).toEqual([]);
  });
  it('AI_DRAFT 로 VERIFIED 표시된 상품·CHECK 상품은 노출되지 않는다', () => {
    const s = promoted();
    // cp-002: VERIFIED 지만 AI_DRAFT → 비노출
    patch(s, 'curatedProducts', 'cp-002', { ...V, reviewerType: 'AI_DRAFT', status: 'ACTIVE', meetsMinSpec: true, title: 'x' });
    // cp-003: 철망(WIRE), barGapMm 없음 → 최소 규격 CHECK → 비노출(불변식 3)
    //   BE92: 철망 간격은 WIRE 일 때만(85) → 리빙박스 목표 규격은 충족이라 형태를 철망으로 바꿔 CHECK 를 만든다.
    patch(s, 'curatedProducts', 'cp-003', { ...V, status: 'ACTIVE', meetsMinSpec: true, title: 'y', specVerifiedAt: '2026-09-30', specValues: { type: 'WIRE', floorWcm: 100, floorDcm: 50, heightCm: 50 } });
    // ph-02: CC_BY 인데 저작자·원본 URL 없음 → 사용 불가(isPhotoUsable) → /credits 에 없음
    patch(s, 'photos', 'ph-02', { source: 'Wikimedia Commons', license: 'CC_BY', author: null, sourceUrl: null, downloadedAt: '2026-09-27', status: 'READY' });
    const b = build(s);
    const all = [...b.files.values()].join('\n');
    expect(all).not.toContain('ph-02');
    expect(all).not.toContain('cp-002');
    expect(all).not.toContain('cp-003');
    expect(leaks(b, s)).toEqual([]);
  });
});

// R4 A2 — 프리렌더 보강: ws-data types 전체, /credits 항상 + CC BY 표기(M-3), Q1 갭(✓·이미지 대체·enum 라벨·선택), G4·G5.
describe('R4 A2 프리렌더 보강', () => {
  const MASCOTS = loadMascots(join(ROOT, 'docs', 'design', 'mascots'));
  const buildM = (s: SeedBundle): SiteBuild =>
    buildSite(s, { template: TEMPLATE, origin: ORIGIN, seedDigest: DIGEST, asOf: FIXTURE_AS_OF, mascots: MASCOTS });
  const pageOf = (b: SiteBuild, p: string): string => b.pages.find((x) => x.route.path === p)?.html as string;
  const dataOf = (html: string) => wsDataOf(html) as { data: { types: Row[]; requirements: Row[] } };

  it('(a) 모든 페이지 ws-data data.types = 노출 타입 전체(같은 길이·같은 id)', () => {
    const b = buildM(promoted());
    const ids = b.model.types.map((t) => t.id);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    for (const p of b.pages) expect(dataOf(p.html).data.types.map((t) => t.id), p.route.path).toEqual(ids);
  });

  it('(b) /credits 항상(실시드 포함): noindex·sitemap 제외, 모든 페이지 푸터 링크, 0건이면 빈 상태', () => {
    const b = buildM(realSeed());
    const r = b.routes.find((x) => x.path === '/credits');
    expect(r).toMatchObject({ kind: 'CREDITS', indexable: false });
    expect(b.files.get('sitemap.xml')).not.toContain('/credits');
    const html = pageOf(b, '/credits');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(COPY.credits.empty);
    for (const p of b.pages) expect(p.html, p.route.path).toContain('<a href="/credits">');
  });

  it('(c) CC BY → /credits 에 저작자·라이선스명+증서 링크·수정 여부·원본 링크', () => {
    const s = promoted();
    patch(s, 'photos', 'ph-01', { modified: true });
    const html = pageOf(buildM(s), '/credits');
    const li = /<li class="ws-credit" data-ws-id="photos#ph-01">([\s\S]*?)<\/li>/.exec(html)?.[1] as string;
    expect(li).toBeTruthy();
    expect(li).toContain('<span class="ws-credit-author">Fixture Author</span>');
    expect(li).toContain('<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer nofollow">CC BY 4.0<span class="ws-visually-hidden"> (새 창)</span></a>');
    expect(li).toContain(`${COPY.credits.modified}: ${COPY.credits.modifiedYes}`);
    expect(li).toContain('href="https://commons.wikimedia.org/wiki/File:Fixture.jpg"');
    patch(s, 'photos', 'ph-01', { modified: false });
    expect(pageOf(buildM(s), '/credits')).toContain(`${COPY.credits.modified}: ${COPY.credits.modifiedNo}`);
  });

  it('(c) /credits 출처는 표시명(copy credits.sourceName) — 보이는 텍스트에 원시 코드 0, 이름 없는 코드는 생략', () => {
    const visible = (html: string): string =>
      html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<head>[\s\S]*?<\/head>/, ' ').replace(/<[^>]+>/g, ' ');
    const s = promoted();
    const html = pageOf(buildM(s), '/credits');
    expect(html).toContain(`${COPY.credits.source}: ${COPY.credits.sourceName.WIKIMEDIA} · <a href="https://commons.wikimedia.org/wiki/File:Fixture.jpg"`);
    expect(visible(html)).not.toMatch(/\b[A-Z][A-Z_]{2,}\b/);
    patch(s, 'photos', 'ph-01', { source: 'NEW_SITE' });
    // R5 B3-1(SEC-2 M-1): 허용목록 밖 source 는 사진 자체가 사용 불가 → /credits 에서 빠진다(원시 코드 노출 경로 없음).
    const html2 = pageOf(buildM(s), '/credits');
    expect(html2).not.toContain('https://commons.wikimedia.org/wiki/File:Fixture.jpg');
    expect(html2).not.toContain('NEW_SITE');
    expect(visible(html2)).not.toMatch(/\b[A-Z][A-Z_]{2,}\b/);
    // 시드 허용 source 값(validate PHOTO_SOURCES) 전부 표시명이 있다.
    for (const code of PHOTO_SOURCES) expect(COPY.credits.sourceName[code], code).toMatch(/\S/);
  });

  it('(c) CC BY 인데 licenseUrl 없음·종류 불일치·허용목록 밖 → /credits 에 없음(isPhotoUsable=false)', () => {
    for (const licenseUrl of [null, 'https://creativecommons.org/licenses/by-sa/4.0/', 'https://evil.example/licenses/by/4.0/']) {
      const s = promoted();
      patch(s, 'photos', 'ph-01', { licenseUrl });
      const b = buildM(s);
      expect([...b.files.values()].join('\n')).not.toContain('photos#ph-01');
      expect(pageOf(b, '/credits')).toContain(COPY.credits.empty);
      expect(leaks(b, s)).toEqual([]);
    }
  });

  it('(d) 상품 카드·L7: ✓ 글리프 span + "기준 충족", 이미지 없으면 item.glyph + "이미지 준비 중" 타일', () => {
    const b = buildM(promoted());
    const badge = '<span class="ws-badge"><span class="ws-glyph" data-ws-glyph="ready" aria-hidden="true">✓</span>' + COPY.product.badge + '</span>';
    const tile = '<span class="ws-tile" aria-hidden="true"><span class="ws-tile-glyph">🎡</span><span class="ws-tile-label">' + COPY.product.imagePending + '</span></span>';
    for (const p of ['/hamster/golden', '/hamster/golden/supplies/wheel', '/hamster/golden/products/cp-001']) {
      const html = pageOf(b, p);
      const cards = html.match(/<li class="ws-product"[\s\S]*?<\/li>/g) ?? [];
      for (const c of cards) {
        expect(c).toContain(badge);
        expect(c).toContain(tile);
        expect(c).not.toMatch(/₩|원\b|구매|가격/);
      }
    }
    expect(pageOf(b, '/hamster/golden').match(/<li class="ws-product"/g)).toHaveLength(1);
    const l7 = pageOf(b, '/hamster/golden/products/cp-001');
    expect(l7).toContain(badge);
    expect(l7).toContain(tile);
  });

  it('(d) enum 라벨: 규격 한 줄은 라벨 없는 enum 생략, L4 조건 행 숨김, L5 는 라벨 불완전 enum 필드 미렌더 + 선택 표기', () => {
    const labeled = buildM(promoted());
    expect(pageOf(labeled, '/hamster/golden')).toContain('<span class="ws-spec">지름 30cm · 바닥면 픽스처 라벨 1 · 설치 픽스처 라벨 1</span>');
    expect(pageOf(labeled, '/hamster/golden/supplies/wheel')).toContain('바닥면 픽스처 라벨 1');
    const s = promoted();
    const wheel = s.supplyItems.find((x) => x.id === 'wheel') as SeedBundle['supplyItems'][number];
    for (const f of wheel.specSchema.fields) if (f.type === 'enum') delete f.optionLabels;
    const b = buildM(s);
    const home = pageOf(b, '/hamster/golden');
    expect(home).toContain('<span class="ws-spec">지름 30cm</span>');
    for (const code of ['SOLID', 'STAND', 'MESH', 'HANG']) {
      for (const p of b.pages) expect(p.html.replace(/<script[\s\S]*?<\/script>/g, ''), `${p.route.path} ${code}`).not.toContain(code);
    }
    const l4 = pageOf(b, '/hamster/golden/supplies/wheel');
    const cond = /<section data-ws-part="conditions">[\s\S]*?<\/section>/.exec(l4)?.[0] as string;
    expect(cond).toContain('지름 27cm 이상');
    expect(cond).not.toContain('바닥면');
    const l5 = pageOf(b, '/hamster/golden/check/wheel');
    expect(l5).toContain('name="diameterCm"');
    expect(l5).not.toContain('name="surface"');
    expect(l5).not.toContain('name="mount"');
    // G-6: boolean = 라디오 카드 예/아니오(기본값 없음), 그룹 이름 = 필드 라벨 + 선택 표기.
    expect(l5).toContain('<fieldset class="ws-radio-cards" role="radiogroup"><legend>무소음(베어링)<span class="ws-optional"> · 선택</span></legend>');
    expect(l5).toContain('<input type="radio" name="silent" value="true">예</label>');
    expect(l5).toContain('<input type="radio" name="silent" value="false">아니오</label>');
    expect(l5).not.toMatch(/type="checkbox"|checked/);
    const l5cage = pageOf(b, '/hamster/golden/check/cage');
    // 114(결정 2026-10-27 be-gp-schema 113 행): optional 이라도 minSpec(when 포함)이 참조하면 '· 선택' 생략 — barGapMm 은 cage minSpec 참조.
    expect(l5cage).toContain('<label for="ws-f-barGapMm">철망 간격(mm)</label>');
    expect(l5cage).toContain('<label for="ws-f-floorWcm">바닥 가로(cm)</label>');
  });

  it('G4: color-scheme meta, 탭바(현재 aria-current), 레이어 딥링크 스크림, 히어로·컨텍스트 인라인 마스코트(정제)', () => {
    const b = buildM(promoted());
    for (const p of b.pages) {
      expect(p.html.match(/<meta name="color-scheme" content="light"/g), p.route.path).toHaveLength(1);
      expect(p.html, p.route.path).toContain('<nav class="ws-tabbar">');
      expect(p.html).not.toContain('<metadata');
      expect(p.html).not.toContain('c2pa');
    }
    expect(pageOf(b, '/vet')).toMatch(/<a class="ws-tab" href="\/vet" aria-current="page">/);
    expect(pageOf(b, '/hamster/golden')).toMatch(/<a class="ws-tab" href="\/hamster\/golden" aria-current="page">/);
    expect(pageOf(b, '/supplies')).toMatch(/<a href="\/supplies" aria-current="page">/);
    for (const p of ['/hamster/golden/supplies/cage', '/hamster/golden/check/cage', '/hamster/golden/products/cp-001', '/supplies/cage/hamster-golden']) {
      expect(pageOf(b, p), p).toMatch(/<div class="ws-scrim" aria-hidden="true"><\/div>\n<aside class="ws-layer"/);
    }
    expect(pageOf(b, '/hamster/golden')).not.toContain('ws-scrim');
    // 51 레인 A(O-1): 인라인 SVG(D-2) → client AnimalAvatar 와 같은 img(/mascots/{asset}.svg). 정제 SVG 는 빌드 시 자산 검증용으로만.
    const hero = /<section class="ws-hero"[^>]*>\n(<span class="ws-avatar[^"]*" aria-hidden="true"><img [^>]*>)/.exec(pageOf(b, '/'));
    expect(hero?.[1]).toContain('ws-avatar--brand-soft');
    expect(hero?.[1]).toContain('<img src="/mascots/group-small-mammal.svg" width="96" height="96" alt=""');
    const ctx = /<section class="ws-context"[^>]*>\n(<span class="ws-avatar[^"]*" aria-hidden="true"><img [^>]*>)/.exec(pageOf(b, '/hamster/golden'));
    expect(ctx?.[1]).toContain('ws-avatar--peach-soft');
    expect(ctx?.[1]).toContain('src="/mascots/hamster-golden.svg"');
    expect(pageOf(b, '/hamster/golden')).not.toMatch(/role="img"|aria-label="골든/);
  });

  it('G4: 템플릿에 color-scheme 이 없으면 head 에 직접 넣는다(정확히 1개)', () => {
    const bare = TEMPLATE.replace(/\s*<meta name="color-scheme"[^>]*>/, '');
    expect(bare).not.toContain('color-scheme');
    const b = buildSite(promoted(), { template: bare, origin: ORIGIN, seedDigest: DIGEST, asOf: FIXTURE_AS_OF });
    for (const p of b.pages) expect(p.html.match(/<meta name="color-scheme" content="light"/g), p.route.path).toHaveLength(1);
  });

  it('G5: PublicRequirement.item.glyph(ws-data·카탈로그 아님)', () => {
    const b = buildM(promoted());
    const reqs = dataOf(pageOf(b, '/hamster/golden')).data.requirements as Array<{ item: { id: string; glyph: string } }>;
    expect(Object.fromEntries(reqs.map((r) => [r.item.id, r.item.glyph]))).toEqual({ cage: '🏠', wheel: '🎡' });
  });

  it('HOME ws-data vets = 목록 노출 병원(/vet 과 같은 투영), 실시드는 [], 상한 20·결정적 순서', () => {
    const b = buildM(promoted());
    const home = wsDataOf(pageOf(b, '/')) as { data: { vets: Row[] } };
    const vet = wsDataOf(pageOf(b, '/vet')) as { data: { vets: Row[] } };
    expect(home.data.vets.length).toBeGreaterThanOrEqual(1);
    expect(home.data.vets).toEqual(vet.data.vets);
    expect(home.data.vets.map((v) => v.id)).toEqual(['vc-mapo-01']);
    expect((wsDataOf(pageOf(buildM(realSeed()), '/')) as { data: { vets: Row[] } }).data.vets).toEqual([]);
    // 상한·순서: 병원 25곳(지역 역순 입력) → 20곳, 지역 → 이름 → id 순.
    const s = promoted();
    const tpl = s.vetClinics.find((v) => v.id === 'vc-mapo-01') as SeedBundle['vetClinics'][number];
    for (let i = 24; i >= 0; i--) {
      s.vetClinics.push({ ...tpl, id: `vc-x-${String(i).padStart(2, '0')}`, name: `픽스처 병원 ${String(i).padStart(2, '0')}`, region: i % 2 ? '서울 마포구' : '서울 강남구' });
    }
    const vs = (wsDataOf(pageOf(buildM(s), '/')) as { data: { vets: Array<{ id: string; region: string; name: string }> } }).data.vets;
    expect(vs).toHaveLength(20);
    const sorted = [...vs].sort((a, c) => (a.region + a.name + a.id < c.region + c.name + c.id ? -1 : 1));
    expect(vs.map((v) => v.id)).toEqual(sorted.map((v) => v.id));
    expect(vs[0].region).toBe('서울 강남구');
  });

  it('F7: 탭바 아이콘 = 보드 SVG(viewBox 0 0 24 24, stroke-width 2, 22px)', () => {
    const html = pageOf(buildM(promoted()), '/');
    const svgs = html.match(/<svg class="ws-tab-icon"[^>]*>[\s\S]*?<\/svg>/g) ?? [];
    expect(svgs).toHaveLength(3);
    for (const s of svgs) expect(s).toMatch(/viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"/);
    expect(svgs[0]).toContain('<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>');
    expect(svgs[1]).toContain('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/>');
    expect(svgs[2]).toContain('<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>');
  });

  it('F5: 비노출 동물(hamster-dwarf·guinea-pig)의 승인 후기는 어떤 산출물에도 없다, 노출 타입 후기는 홈에', () => {
    const s = promoted();
    patch(s, 'testimonials', 't-007', { status: 'APPROVED', verifiedUsage: true, quote: '드워프 후기 누출 표식이에요', consentAt: '2026-09-26' });
    patch(s, 'testimonials', 't-008', { status: 'APPROVED', verifiedUsage: true, quote: '기니피그 후기 누출 표식이에요', consentAt: '2026-09-26' });
    const b = buildM(s);
    const all = [...b.files.values()].join('\n');
    for (const leak of ['t-007', 't-008', '드워프 후기 누출 표식', '기니피그 후기 누출 표식']) expect(all, leak).not.toContain(leak);
    const home = wsDataOf(pageOf(b, '/')) as { data: { testimonials: Row[] } };
    expect(home.data.testimonials.map((t) => t.id)).toEqual(['t-001']);
    expect(pageOf(b, '/')).toContain('data-ws-id="testimonials#t-001"');
    expect(leaks(b, s)).toEqual([]);
    // 독립 구현(compliance)도 같은 판정 — 비노출 타입 후기는 노출 집합 밖.
    const ex = exposureMod.computeExposure(rawOf(s), FIXTURE_AS_OF);
    expect([...ex.ids.testimonials].sort()).toEqual(['t-001']);
  });

  it('ws-data ≤ 32KB (모든 페이지)', () => {
    for (const p of buildM(promoted()).pages) expect(p.wsDataBytes, p.route.path).toBeLessThanOrEqual(32 * 1024);
  });

  it('마스코트 정제기: 허용 밖 요소·속성·텍스트는 throw, metadata 제거', () => {
    const ok = sanitizeMascotSvg('<svg viewBox="0 0 96 96" role="img" aria-label="x"><metadata>m</metadata><circle cx="1" cy="2" r="3" fill="#fff"/></svg>', 't');
    expect(ok).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true" focusable="false" class="ws-mascot-svg"><circle cx="1" cy="2" r="3" fill="#fff"/></svg>');
    for (const bad of [
      '<svg viewBox="0 0 9 9"><script>x</script></svg>',
      '<svg viewBox="0 0 9 9"><circle onload="x" r="1"/></svg>',
      '<svg viewBox="0 0 9 9"><image href="https://e.x/a.png"/></svg>',
      '<svg viewBox="0 0 9 9"><path d="M0" fill="url(https://e.x)"/></svg>',
      '<svg viewBox="0 0 9 9"><foreignObject/></svg>',
      '<svg viewBox="0 0 9 9">text</svg>',
      '<svg><circle r="1"/></svg>',
    ]) expect(() => sanitizeMascotSvg(bad, 't'), bad).toThrow();
    expect(MASCOTS.size).toBeGreaterThanOrEqual(8);
  });
});

// M-1(S1) 6개월 자동 강등 — 노출 기준일 asOf(R4 A1, D5). 엔진(buildSite)과 독립 재구현(computeExposure)이 같은 답.
describe('검수 나이 강등(asOf, M-1)', () => {
  const productsOf = (b: SiteBuild): number => b.model.types.reduce((n, t) => n + t.requirements.reduce((m, r) => m + r.products.length, 0), 0);
  const exposureOf = (s: SeedBundle, asOf: string): Exposure => exposureMod.computeExposure(rawOf(s), asOf);

  it('verifiedAt+180 → types ≥ 1·products ≥ 1, +181 → types 0·products 0 (엔진·독립 구현 동일)', () => {
    const s = promoted();
    const fresh = build(s, false, FIXTURE_LAST_FRESH);
    expect(fresh.model.types.length).toBeGreaterThanOrEqual(1);
    expect(productsOf(fresh)).toBeGreaterThanOrEqual(1);
    expect(exposureOf(s, FIXTURE_LAST_FRESH).ids.animalTypes.size).toBe(fresh.model.types.length);
    expect(exposureOf(s, FIXTURE_LAST_FRESH).ids.curatedProducts.size).toBe(productsOf(fresh));

    const stale = build(s, false, FIXTURE_FIRST_STALE);
    expect(stale.model.types).toEqual([]);
    expect(productsOf(stale)).toBe(0);
    expect(stale.catalog.animalTypes).toEqual([]);
    expect(stale.catalog.compatibilityRules).toEqual([]);
    expect(exposureOf(s, FIXTURE_FIRST_STALE).ids.animalTypes.size).toBe(0);
    expect(exposureOf(s, FIXTURE_FIRST_STALE).ids.curatedProducts.size).toBe(0);
    expect(leaks(stale, s, FIXTURE_FIRST_STALE)).toEqual([]);
    expect([...stale.files.values()].join('\n')).not.toContain('픽스처 쳇바퀴 A');
  });

  it('CareProfile 하나만 오래돼도 types 0·products 0', () => {
    const s = promoted();
    patch(s, 'careProfiles', 'cp-hamster-syrian', { verifiedAt: '2026-03-31' }); // FIXTURE_AS_OF 기준 184일
    const b = build(s);
    expect(b.model.types).toEqual([]);
    expect(productsOf(b)).toBe(0);
    expect(exposureOf(s, FIXTURE_AS_OF).ids.animalTypes.size).toBe(0);
    expect(leaks(b, s)).toEqual([]);
  });

  it('상품 하나만 오래되면 그 상품만 빠진다', () => {
    const s = promoted();
    expect(productsOf(build(s))).toBe(1);
    patch(s, 'curatedProducts', 'cp-001', { verifiedAt: '2026-04-03' }); // 181일
    const b = build(s);
    expect(b.model.types.length).toBe(1);
    expect(productsOf(b)).toBe(0);
    expect(exposureOf(s, FIXTURE_AS_OF).ids.curatedProducts.size).toBe(0);
    expect(leaks(b, s)).toEqual([]);
  });

  it('asOf 누락·형식 오류 → throw(fail-open 기본값 없음)', () => {
    expect(() => buildSite(promoted(), { template: TEMPLATE, origin: ORIGIN, seedDigest: DIGEST } as never)).toThrow(RangeError);
    expect(() => build(promoted(), false, '2026-1-1')).toThrow(RangeError);
    expect(() => exposureOf(promoted(), '')).toThrow(RangeError);
  });

  it('asOf 는 산출물(HTML·ws-data·카탈로그·manifest·sitemap)에 쓰이지 않는다', () => {
    const asOf = '2026-12-25';
    const all = [...build(promoted(), true, asOf).files.values()].join('\n');
    expect(all).not.toContain(asOf);
  });
});

describe('입력 검증', () => {
  it('seedDigest 형식이 아니면 throw', () => {
    expect(() => buildSite(realSeed(), { template: TEMPLATE, origin: ORIGIN, seedDigest: 'x', asOf: FIXTURE_AS_OF })).toThrow();
  });
  it('slug 가 예약 세그먼트면 throw(검증 우회 방지)', () => {
    const s = promoted();
    patch(s, 'animalTypes', 'hamster-golden', { slug: 'supplies/golden' });
    expect(() => build(s)).toThrow(/slug/);
  });
});

describe('보안 회귀(S1 L-2·L-3)', () => {
  it('L-2: 출처 항목의 추가 키(note 등)는 어떤 산출물에도 나가지 않는다', () => {
    const s = promoted();
    const addNote = (key: keyof SeedBundle, id: string): void => {
      const row = (s[key] as unknown as Row[]).find((r) => r.id === id) as Row;
      (row.source as Row[])[0].note = 'SRCNOTE-LEAK';
    };
    addNote('supplyRequirements', 'req-syrian-cage');
    addNote('animalTypes', 'hamster-golden');
    addNote('careProfiles', 'cp-hamster-syrian');
    addNote('supplyItems', 'cage');
    const b = build(s);
    for (const [file, content] of b.files) expect(content.includes('SRCNOTE-LEAK'), file).toBe(false);
    const req = b.catalog.supplyRequirements.find((r) => r.id === 'req-syrian-cage');
    expect(req?.source[0]).toEqual({ url: expect.any(String), title: expect.any(String), accessedAt: expect.any(String) });
    expect(Object.keys(req?.source[0] ?? {}).sort()).toEqual(['accessedAt', 'title', 'url']);
  });

  it('L-3: specSchema 숫자 속성에 문자열이 들어와도(검증 우회) 이스케이프·생략된다', () => {
    const s = promoted();
    const cage = s.supplyItems.find((i) => i.id === 'cage') as unknown as { specSchema: { fields: Row[] } };
    const num = cage.specSchema.fields.filter((f) => f.type === 'number');
    num[0].min = '"><script>alert(1)</script>';
    num[0].max = '" onmouseover="x';
    num[1].min = '25';
    num[1].max = Number.NaN;
    const html = build(s).pages.find((p) => p.route.path === '/hamster/golden/check/cage')?.html as string;
    const aside = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
    expect(html).not.toContain('<script>alert');
    expect(aside).not.toContain('onmouseover');
    expect(aside).not.toMatch(/(min|max)="NaN"/);
    const input0 = new RegExp(`name="${String(num[0].key)}" type="number" inputmode="decimal"`);
    expect(aside).toMatch(input0); // 비숫자 min·max 는 속성 생략
    expect(aside).toContain(`name="${String(num[1].key)}" type="number" min="25" inputmode="decimal"`);
  });
});

// Kenny 2026-10-24 K-4 되돌림: 타입 노출은 Taxon 을 보지 않는다. Taxon 내용(legal)은 어떤 산출물에도 싣지 않고,
//   Taxon 참조(catalog taxonId·taxonIds)는 Taxon 이 VERIFIED ∧ ≠AI_DRAFT ∧ 유효일 때만(불변식 7).
describe('Taxon 미검수 — 타입 노출, legal 문구·Taxon 참조 비노출', () => {
  const disk = realSeed().taxa.find((t) => t.id === 'mesocricetus-auratus');
  if (!disk || typeof disk.legal.note !== 'string') throw new Error('fixture: 골든 Taxon legal.note 없음');
  const note = disk.legal.note;
  // 학명 문자열은 AnimalType.aliases(사용자 언어)에도 있어 Taxon 내용 판별에 쓰지 않는다 — legal.note·Taxon id 로 본다.
  const hidden = [note, 'mesocricetus-auratus'];

  it('디스크 Taxon(DRAFT·AI_DRAFT) 그대로 → 골든 페이지 노출, legal.note·Taxon id 가 어떤 산출물에도 없다', () => {
    expect(disk.reviewStatus).not.toBe('VERIFIED');
    const b = build(promoted());
    expect(paths(b)).toContain('/hamster/golden');
    expect(b.catalog.animalTypes.map((t) => [t.id, t.taxonId])).toEqual([['hamster-golden', null]]);
    for (const p of b.catalog.careProfiles) expect(p.taxonIds).toEqual([]);
    const all = [...b.files.values()].join('\n');
    for (const w of hidden) expect(all, w).not.toContain(w);
  });

  it('Taxon VERIFIED(OFFICIAL_SOURCE) → 카탈로그 Taxon 참조만 생기고 legal.note 는 여전히 없다(싣는 경로 없음)', () => {
    const b = build(promoted({ taxonVerified: true }));
    expect(b.catalog.animalTypes.map((t) => [t.id, t.taxonId])).toEqual([['hamster-golden', 'mesocricetus-auratus']]);
    const all = [...b.files.values()].join('\n');
    expect(all).not.toContain(note);
  });
});
