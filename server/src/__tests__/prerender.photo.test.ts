// 359 단계 3·4(감사 356r M2, D-1 A·D-2 A·D-3) — 프리렌더가 엔진 resolvePhoto 로 고른 사진을 ws-data(값 있을 때만 키)와 마크업에 싣는다.
//   T8 실시드(전부 SLOT): data-ws-photo 0 · .ws-photo 전부 span · ws-data 에 photo/photos/homeScenes 키 0(바이트 불변은 dist diff 로 확인).
//   T12 와이어 왕복 보존 · __proto__ 는 decode null(L-3).
//   투영: 골든은 장면 행(ph-01·ph-08) 사용 가능 시 종 자리·cage 품목 자리에 싣고, 다른 종(앵무·드워프 등)엔 장면 id 0(D-1 A).
//   T9~T11·T13(마크업)은 단계 4 — 아래 describe 「마크업」.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeWsPage, encodeWsPage, type SeedBundle, type WsPageData } from '../engine/index.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { COPY } from '../prerender/copy.js';
import { FIXTURE_AS_OF, realSeed } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(here, '..', '..', '..', 'client', 'index.html'), 'utf8');
const WS_RE = /<script id="ws-data" type="application\/json">([\s\S]*?)<\/script>/;
type Rec = Record<string, unknown>;

const build = (seed: SeedBundle): SiteBuild =>
  buildSite(seed, { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), indexable: true, asOf: FIXTURE_AS_OF });
const page = (b: SiteBuild, path: string) => {
  const p = b.pages.find((x) => x.route.path === path);
  if (!p) throw new Error(`no page ${path}`);
  return p;
};
const wireOf = (html: string): Rec => {
  const m = WS_RE.exec(html);
  if (!m) throw new Error('ws-data 없음');
  return JSON.parse(m[1]) as Rec;
};
/** 깊이 탐색 — 키 이름 k 가 어디든 있는가. */
function hasKeyDeep(v: unknown, keys: readonly string[]): boolean {
  if (Array.isArray(v)) return v.some((x) => hasKeyDeep(x, keys));
  if (typeof v !== 'object' || v === null) return false;
  return Object.entries(v).some(([k, x]) => keys.includes(k) || hasKeyDeep(x, keys));
}
const SCENE_ID_RE = /ph-\d\d\b/;

/** AI 생성 사진 READY 기록(engine.photo-ai.test.ts AI 와 같은 형식) — 사용권·종 확인까지 갖춘 사용 가능 행. */
const readyAi = (id: string, slot: string, asset: string): Rec => ({
  status: 'READY', license: 'AI_GENERATED', source: 'CODEX', sourceUrl: null, licenseUrl: null, author: null, downloadedAt: null,
  modified: false, generatedAt: '2026-11-20', promptPath: `docs/assets/prompts/${slot}.md`, asset,
  speciesCheck: { checkedBy: '운영자 Kenny', checkedAt: '2026-11-21' },
});
/** 실시드 사본에서 id 행들을 READY 로(사용 가능). */
function seedReady(ids: readonly string[], mut?: (s: SeedBundle) => void): SeedBundle {
  const s = realSeed();
  for (const id of ids) {
    const row = (s.photos as unknown as Rec[]).find((r) => r.id === id);
    if (!row) throw new Error(`photo ${id} 없음`);
    const use = (row.scope as Rec | undefined)?.use;
    const dir = use === 'item' ? 'items' : 'photos';
    Object.assign(row, readyAi(id, String(row.slot), `/assets/${dir}/${String(row.slot)}.webp`));
  }
  mut?.(s);
  return s;
}
const typeOf = (d: WsPageData, id: string) => d.data.types.find((t) => t.id === id);

describe('T8 실시드(전부 SLOT) — 사진 키·마크업 0', () => {
  const b = build(realSeed());
  it('모든 페이지: data-ws-photo 0, .ws-photo 는 전부 span aria-hidden, ws-data 에 photo/photos/homeScenes 키 0', () => {
    expect(b.pages.length).toBeGreaterThan(100);
    for (const p of b.pages) {
      expect(p.html, p.route.path).not.toContain('data-ws-photo');
      expect(p.html, p.route.path).not.toMatch(/<img\b[^>]*class="[^"]*\bws-photo\b/);
      expect(hasKeyDeep(p.data, ['photo', 'photos', 'homeScenes']), p.route.path).toBe(false);
      expect(hasKeyDeep(wireOf(p.html), ['photo', 'photos', 'homeScenes']), p.route.path).toBe(false);
    }
  });
});

describe('투영(D-2 A) — 장면 사진은 골든에만(D-1 A), 홈 장면은 대표 타입이 허용일 때만(D-3)', () => {
  const b = build(seedReady(['ph-01', 'ph-08', 'ph-02']));

  it('골든 종 페이지: photos.habitat=ph-01, photos.spec=ph-08(aiGenerated), cage 요구사항 photo=ph-08, 비매핑 품목(wheel) photo 0', () => {
    const d = page(b, '/hamster/golden').data;
    const g = typeOf(d, 'hamster-golden');
    expect(g?.photos).toEqual({
      habitat: { photoId: 'ph-01', asset: '/assets/photos/intro-1.webp', aiGenerated: true },
      spec: { photoId: 'ph-08', asset: '/assets/photos/l4-cage.webp', aiGenerated: true },
    });
    // 키 순서: photoId → asset → aiGenerated
    expect(Object.keys(g?.photos?.spec ?? {})).toEqual(['photoId', 'asset', 'aiGenerated']);
    const cage = d.data.requirements.find((r) => r.supplyItemId === 'cage');
    expect(cage?.photo?.photoId).toBe('ph-08');
    expect(Object.keys(cage ?? {}).at(-1)).toBe('photo');
    expect(d.data.requirements.find((r) => r.supplyItemId === 'wheel')?.photo).toBeUndefined();
  });

  it('다른 종(앵무·드워프·저빌·기니피그·로보) 페이지 ws-data·HTML 에 장면 id(ph-NN) 0', () => {
    for (const path of ['/parrot/budgie', '/hamster/dwarf', '/gerbil', '/guinea-pig', '/hamster/robo']) {
      const p = b.pages.find((x) => x.route.path === path);
      if (!p) continue; // slug 형식이 다르면 아래 전수 검사가 잡는다
      expect(JSON.stringify(p.data), path).not.toMatch(SCENE_ID_RE);
    }
    for (const p of b.pages) {
      const id = p.data.route.typeId ?? p.data.layer?.typeId;
      if (typeof id !== 'string' || id === 'hamster-golden') continue;
      expect(JSON.stringify(p.data.data.requirements), p.route.path).not.toMatch(SCENE_ID_RE);
      for (const t of p.data.data.types) if (t.id !== 'hamster-golden') expect(JSON.stringify(t), `${p.route.path} ${t.id}`).not.toMatch(SCENE_ID_RE);
    }
  });

  it('홈(/·/pick·/save): 대표 타입(골든)에만 homeScenes(startSetup=ph-01·startSpecCheck=ph-08·explainFigures=ph-02), 다른 타입엔 키 0', () => {
    for (const path of ['/', '/pick', '/save']) {
      const p = b.pages.find((x) => x.route.path === path);
      if (!p) continue;
      const [rep, ...rest] = p.data.data.types;
      expect(rep.id, path).toBe('hamster-golden');
      expect(rep.homeScenes, path).toEqual({
        startSpecCheck: { photoId: 'ph-08', asset: '/assets/photos/l4-cage.webp', aiGenerated: true },
        startSetup: { photoId: 'ph-01', asset: '/assets/photos/intro-1.webp', aiGenerated: true },
        explainFigures: { photoId: 'ph-02', asset: '/assets/photos/intro-2.webp', aiGenerated: true },
      });
      for (const t of rest) expect(t.homeScenes, `${path} ${t.id}`).toBeUndefined();
    }
    // 홈이 아닌 페이지엔 homeScenes 0
    expect(hasKeyDeep(page(b, '/hamster/golden').data, ['homeScenes'])).toBe(false);
  });

  it('T10: ph-budgie-spec 만 READY → /parrot/budgie 에만, 같은 프로필 lovebird-peach 엔 0', () => {
    const b2 = build(seedReady(['ph-budgie-spec']));
    const budgie = JSON.stringify(page(b2, '/parrot/budgie').data);
    expect(budgie).toContain('"photoId":"ph-budgie-spec"');
    for (const p of b2.pages) {
      const id = p.data.route.typeId ?? p.data.layer?.typeId;
      if (id === 'lovebird-peach') expect(JSON.stringify(p.data), p.route.path).not.toContain('ph-budgie-spec');
    }
    expect(typeOf(page(b2, '/parrot/budgie').data, 'budgie')?.photos).toEqual({
      spec: { photoId: 'ph-budgie-spec', asset: '/assets/photos/budgie-spec.webp', aiGenerated: true },
    });
  });

  it('T11(D-3): 대표 타입이 PARROT 인 사본이면 homeScenes 0', () => {
    const b3 = build(seedReady(['ph-01', 'ph-08', 'ph-02'], (s) => {
      const i = s.animalTypes.findIndex((t) => t.id === 'budgie');
      const [bud] = s.animalTypes.splice(i, 1);
      s.animalTypes.unshift(bud);
    }));
    const p = page(b3, '/');
    expect(p.data.data.types[0].id).toBe('budgie');
    expect(hasKeyDeep(p.data, ['homeScenes'])).toBe(false);
    // 홈 데이터의 골든 타입 자체 사진(photos)은 그대로(종별 resolvePhoto)
    expect(typeOf(p.data, 'hamster-golden')?.photos?.habitat?.photoId).toBe('ph-01');
    expect(JSON.stringify(typeOf(p.data, 'budgie'))).not.toMatch(SCENE_ID_RE);
  });

  it('T12 와이어 왕복: HTML 와이어 decode = 메모리 data(photo·photos·homeScenes 보존), 그 안 __proto__ 키 → decode null', () => {
    for (const path of ['/', '/hamster/golden']) {
      const p = page(b, path);
      const back = decodeWsPage(wireOf(p.html));
      expect(back, path).toEqual(p.data);
      expect(JSON.stringify(back), path).toBe(JSON.stringify(p.data));
    }
    const wire = JSON.stringify(encodeWsPage(page(b, '/hamster/golden').data));
    expect(wire).toContain('"photos":{"habitat":{"photoId":"ph-01"');
    const evil = JSON.parse(wire.replace('"photos":{"habitat":{"photoId":"ph-01"', '"photos":{"__proto__":{"x":1},"habitat":{"photoId":"ph-01"')) as unknown;
    expect(decodeWsPage(evil)).toBeNull();
  });
});

describe('마크업(단계 4) — photoTile: 사진 있으면 img + 생성 표기, 없으면 지금 span 그대로', () => {
  const NOTICE = COPY.photoNotice.aiGenerated;
  const b = build(seedReady(['ph-01', 'ph-08', 'ph-02']));
  const imgTags = (html: string) => [...html.matchAll(/<img\b[^>]*\bdata-ws-photo="([^"]+)"[^>]*>/g)];

  it('T9: /hamster/golden spec·habitat 자리 img(src=asset, alt 빈 값, lazy, async, data-ws-photo) — 앵무 페이지엔 ph-NN 0', () => {
    const html = page(b, '/hamster/golden').html;
    const ids = imgTags(html).map((m) => m[1]);
    expect(ids).toContain('ph-08');
    // 359d 스펙 §2: 생성 사진은 틀(span.ws-photo-frame + 슬롯 클래스)로 감싸고 img 는 class="ws-photo" 만, 표기 span aria-hidden.
    expect(html).toContain(
      `<span class="ws-photo-frame ws-spec-sec-photo"><img class="ws-photo" src="/assets/photos/l4-cage.webp" alt="" loading="lazy" decoding="async" data-ws-photo="ph-08"><span class="ws-photo-notice ws-t-meta" aria-hidden="true">${NOTICE}</span></span>`,
    );
    // 틀에는 ws-photo 클래스가 없다(빈 자리 span.ws-photo[aria-hidden] 세는 시험과 섞이지 않게).
    expect(html).not.toMatch(/<span class="ws-photo ws-photo-frame/);
    for (const p of b.pages) {
      const id = p.data.route.typeId ?? p.data.layer?.typeId;
      if (typeof id !== 'string' || id === 'hamster-golden') continue;
      const body = p.html.replace(WS_RE, '');
      expect(body, p.route.path).not.toMatch(/data-ws-photo="ph-\d\d"/);
    }
  });

  it('T13: aiGenerated 사진 자리마다 생성 표기 1회(img 수 = 표기 수), 사용 불가 자리엔 0', () => {
    for (const path of ['/', '/hamster/golden']) {
      const html = page(b, path).html.replace(WS_RE, '');
      const n = imgTags(html).length;
      expect(n, path).toBeGreaterThan(0);
      expect(html.split(`>${NOTICE}<`).length - 1, path).toBe(n);
    }
    const slotOnly = build(realSeed());
    for (const p of slotOnly.pages) expect(p.html, p.route.path).not.toContain(`>${NOTICE}<`);
  });

  it('T11: 홈 habitat 카드는 종별 — 골든 카드 img(ph-01), 앵무 카드에 ph-01 0; 대표 PARROT 사본은 시작 카드 사진 0', () => {
    const home = page(b, '/').html.replace(WS_RE, '');
    expect(imgTags(home).map((m) => m[1])).toContain('ph-01');
    const habitats = home.slice(home.indexOf('data-ws-section="habitats"'));
    const cards = habitats.split('<li').slice(1);
    const golden = cards.find((c) => c.includes('골든햄스터'));
    expect(golden).toContain('data-ws-photo="ph-01"');
    for (const c of cards.filter((x) => x.includes('앵무'))) expect(c).not.toContain('data-ws-photo');
    const b3 = build(seedReady(['ph-01', 'ph-08', 'ph-02'], (s) => {
      const i = s.animalTypes.findIndex((t) => t.id === 'budgie');
      const [bud] = s.animalTypes.splice(i, 1);
      s.animalTypes.unshift(bud);
    }));
    const home3 = page(b3, '/').html.replace(WS_RE, '');
    const starters = home3.slice(home3.indexOf('data-ws-section="starters"'), home3.indexOf('data-ws-section="habitats"'));
    expect(starters).not.toContain('data-ws-photo');
  });
});

describe('photoTile 헬퍼(359d §2 세 갈래) — 프리렌더 단일 출처', () => {
  it('없음 → 지금 span 그대로 · 실사 → img 하나 · 생성 → 틀+img+표기 1, 속성 값은 이스케이프', async () => {
    const { photoTile } = await import('../prerender/pages/common.js');
    expect(photoTile(undefined, 'ws-now-photo')).toBe('<span class="ws-photo ws-now-photo" aria-hidden="true"></span>');
    expect(photoTile({ photoId: 'ph-x', asset: '/assets/items/a.webp' }, 'ws-supply-photo')).toBe(
      '<img class="ws-photo ws-supply-photo" src="/assets/items/a.webp" alt="" loading="lazy" decoding="async" data-ws-photo="ph-x">',
    );
    expect(photoTile({ photoId: 'ph-x', asset: '/assets/photos/a.webp', aiGenerated: true }, 'ws-starter-photo')).toBe(
      `<span class="ws-photo-frame ws-starter-photo"><img class="ws-photo" src="/assets/photos/a.webp" alt="" loading="lazy" decoding="async" data-ws-photo="ph-x"><span class="ws-photo-notice ws-t-meta" aria-hidden="true">${COPY.photoNotice.aiGenerated}</span></span>`,
    );
    expect(photoTile({ photoId: 'ph-"x', asset: '/assets/photos/a.webp' }, 'ws-now-photo')).toContain('data-ws-photo="ph-&quot;x"');
  });
});
