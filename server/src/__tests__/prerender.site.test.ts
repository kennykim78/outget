// R3 F2 — 사이트 모델·라우트·페이지(계획 §2 F2 (a)~(d), §4, §6-2, §6-3).
//   실시드는 읽기만. 승격 픽스처는 메모리 사본(디스크의 AI_DRAFT 를 VERIFIED 로 기록하지 않는다, §10-2).
//   노출 기준 비교는 compliance 의 독립 재구현(scripts/lib/seed-exposure.mjs, D9)으로 한다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SeedBundle } from '../engine/index.js';
import { WS_DATA_KEYS } from '../engine/index.js';
import { SEED_FILES } from '../seed/common.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { V, patch, promoted, realSeed, type Row } from './fixtures/prerender-seed.js';
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
  computeExposure: (seed: Record<string, unknown[]>) => Exposure;
};

const build = (seed: SeedBundle, indexable = false): SiteBuild =>
  buildSite(seed, { template: TEMPLATE, origin: ORIGIN, seedDigest: DIGEST, indexable });

const paths = (b: SiteBuild): string[] => b.routes.map((r) => r.path);

function wsDataOf(html: string): Record<string, unknown> {
  const m = /<script id="ws-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('ws-data 없음');
  expect(m[1].includes('</')).toBe(false);
  return JSON.parse(m[1]) as Record<string, unknown>;
}

const rawOf = (seed: SeedBundle): Record<string, unknown[]> =>
  Object.fromEntries(Object.keys(SEED_FILES).map((k) => [k, seed[k as keyof SeedBundle] as unknown[]]));

/** 산출물의 모든 id 가 독립 재구현 노출 집합 안에 있는지(C3-OUT-ID 와 같은 기준). 위반 목록 반환. */
function leaks(b: SiteBuild, seed: SeedBundle): string[] {
  const ex = exposureMod.computeExposure(rawOf(seed));
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

  it('라우트가 정확히 4개', () => {
    expect(paths(b)).toEqual(['/', '/supplies', '/vet', '/404']);
    expect(b.routes.map((r) => r.kind)).toEqual(['HOME', 'SUPPLIES', 'VET', 'NOT_FOUND']);
    expect(b.routes.find((r) => r.kind === 'NOT_FOUND')?.file).toBe('404.html');
  });

  it('indexable 은 / 만, sitemap 1건, robots Disallow', () => {
    expect(b.routes.filter((r) => r.indexable).map((r) => r.path)).toEqual(['/']);
    const sm = b.files.get('sitemap.xml') as string;
    expect(sm.match(/<loc>/g)).toHaveLength(1);
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
    expect(html).toContain('WithSmall 소개 — 작은 친구의 첫 준비를 이렇게 도와요');
    expect(html).not.toMatch(/ws:head|ws:body/);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain('<div id="root" data-ws-prerendered="1">');
  });

  it('/supplies 는 카테고리 10칸·링크 0, /vet 은 빈 상태 문구', () => {
    const sup = b.pages.find((x) => x.route.path === '/supplies')?.html as string;
    expect(sup.match(/data-ws-category=/g)).toHaveLength(10);
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
      '/credits',
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

  it('타입 홈 B: 컨텍스트 + 5섹션 순서, ① 숫자 없음(D18), 병원은 /vet 링크만', () => {
    const html = page('/hamster/golden');
    const order = ['now', 'bundles', 'products', 'vet', 'save'].map((s) => html.indexOf(`data-ws-section="${s}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(html).toContain('<h2>지금 필요한 것</h2><p>필수 준비를 먼저 확인해요</p>');
    const now = html.slice(order[0], order[1]);
    expect(visibleText(now)).not.toMatch(/\d/); // 가시 텍스트에 숫자 없음
    const vet = html.slice(order[3], order[4]);
    expect(vet).toContain('href="/vet"');
    expect(vet).not.toContain('data-ws-id');
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
    expect(aside).toContain('지름 28cm 이상');
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
    expect(l7aside).toContain('>이 조건으로 쿠팡에서 찾기</a>');
    expect(l7aside).toContain('>이 조건으로 네이버에서 찾기</a>');
    expect(l7aside).toContain('<h3>이 조건으로 찾기</h3>');
    // 구성안 참고 범위 옆 안내(K1)
    expect(page('/hamster/golden')).toContain('참고 범위예요. 실제 가격은 판매처마다 달라요');
  });

  it('PublicProduct.verdict 는 orderExposableProducts 결과(OK)', () => {
    const d = wsDataOf(page('/hamster/golden')) as { data: { products: Row[] } };
    expect(d.data.products).toEqual([
      expect.objectContaining({ id: 'cp-001', verdict: 'OK', reasonCodes: ['SPEC_MET', 'PROFILE_MATCH'], specVerifiedAt: '2026-09-29' }),
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
    expect(on.files.get('robots.txt')).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
    expect(on.manifest.indexable).toBe(true);
  });
});

describe('(c) 같은 승격에서 type 만 DRAFT → 타입 라우트 0', () => {
  const seed = promoted({ typeDraft: true });
  const b = build(seed);
  it('TYPE·SETUP·FAMILY·SUPPLY_ITEM* 라우트 없음, typeId 0', () => {
    expect(b.routes.filter((r) => ['FAMILY', 'TYPE', 'SETUP', 'SUPPLY_ITEM', 'SUPPLY_ITEM_TYPE'].includes(r.kind))).toEqual([]);
    expect(b.routes.filter((r) => r.typeId !== undefined)).toEqual([]);
    expect(paths(b)).toEqual(['/', '/supplies', '/vet', '/vet/서울-마포구', '/credits', '/404']);
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
    // cp-003: 리빙박스, barGapMm 없음 → 최소 규격 CHECK → 비노출(불변식 3)
    patch(s, 'curatedProducts', 'cp-003', { ...V, status: 'ACTIVE', meetsMinSpec: true, title: 'y', specVerifiedAt: '2026-09-30' });
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

describe('입력 검증', () => {
  it('seedDigest 형식이 아니면 throw', () => {
    expect(() => buildSite(realSeed(), { template: TEMPLATE, origin: ORIGIN, seedDigest: 'x' })).toThrow();
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
