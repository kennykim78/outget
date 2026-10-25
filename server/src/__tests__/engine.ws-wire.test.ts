// 계획 73 S1/S2 — ws-data 와이어 v2(engine/ws-wire) 코덱.
//   round-trip(3 픽스처 전 페이지 deep-equal + 키 순서까지 같은 JSON), 결정론(출처 표 첫 등장 순서·재빌드 바이트 동일),
//   fail-closed(v2 위반 → null), v1 통과, 구·신 빌드(wsDataWire 1 vs 2) ws-data 밖 HTML 바이트 동일.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WS_WIRE_VERSION,
  buildSearchLinks,
  decodeWsPage,
  encodeWsPage,
  type SeedBundle,
  type WsPageData,
} from '../engine/index.js';
import { jsonForScript } from '../prerender/html.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { DWARF_PREVIEW_AS_OF, FIXTURE_AS_OF, dwarfPreview, promoted, promotedTwo } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(here, '..', '..', '..', 'client', 'index.html'), 'utf8');
const WS_RE = /<script id="ws-data" type="application\/json">([\s\S]*?)<\/script>/;

const build = (seed: SeedBundle, asOf: string, wsDataWire?: 1 | 2): SiteBuild =>
  buildSite(seed, {
    template: TEMPLATE,
    origin: 'http://localhost:3001',
    seedDigest: 'a'.repeat(64),
    indexable: true,
    asOf,
    ...(wsDataWire ? { wsDataWire } : {}),
  });

const FIXTURES: Array<[string, () => SeedBundle, string]> = [
  ['promoted', promoted, FIXTURE_AS_OF],
  ['promotedTwo', promotedTwo, FIXTURE_AS_OF],
  ['dwarfPreview', dwarfPreview, DWARF_PREVIEW_AS_OF],
];

function wireOf(html: string): Record<string, unknown> {
  const m = WS_RE.exec(html);
  if (!m) throw new Error('ws-data 없음');
  return JSON.parse(m[1]) as Record<string, unknown>;
}

type Rec = Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe.each(FIXTURES)('ws-wire round-trip — %s', (_name, seedOf, asOf) => {
  const b = build(seedOf(), asOf);

  it('모든 페이지: decode(HTML 와이어) = 메모리 data(deep-equal + 키 순서까지 같은 JSON)', () => {
    expect(b.pages.length).toBeGreaterThan(0);
    for (const p of b.pages) {
      const wire = wireOf(p.html);
      expect(wire.v, p.route.path).toBe(WS_WIRE_VERSION);
      const back = decodeWsPage(wire);
      expect(back, p.route.path).toEqual(p.data);
      expect(JSON.stringify(back), p.route.path).toBe(JSON.stringify(p.data));
    }
  });

  it('와이어 요구사항에 searchLinks·source 0, sourceRefs 배열, 표 항목은 {url,title} 만, 모든 항목 참조됨', () => {
    for (const p of b.pages) {
      const wire = wireOf(p.html) as { data: { requirements: Rec[] }; sources: Rec[] };
      const used = new Set<number>();
      for (const r of wire.data.requirements) {
        expect('searchLinks' in r).toBe(false);
        expect('source' in r).toBe(false);
        expect(Array.isArray(r.sourceRefs)).toBe(true);
        for (const n of r.sourceRefs as number[]) used.add(n);
      }
      for (const s of wire.sources) expect(Object.keys(s).sort()).toEqual(['title', 'url']);
      expect(used.size, p.route.path).toBe(wire.sources.length);
    }
  });

  it('결정론: 출처 표 = 첫 등장 순서(평탄화한 참조의 첫 출현이 0,1,2…), 재빌드 HTML 바이트 동일', () => {
    for (const p of b.pages) {
      const wire = wireOf(p.html) as { data: { requirements: Array<{ sourceRefs: number[] }> } };
      const firsts: number[] = [];
      for (const r of wire.data.requirements) for (const n of r.sourceRefs) if (!firsts.includes(n)) firsts.push(n);
      expect(firsts).toEqual(firsts.map((_, i) => i));
      expect(JSON.stringify(encodeWsPage(p.data))).toBe(JSON.stringify(encodeWsPage(clone(p.data))));
    }
    const again = build(seedOf(), asOf);
    expect(again.pages.map((p) => p.html)).toEqual(b.pages.map((p) => p.html));
  });

  it('구·신 빌드(wsDataWire 1 vs 기본 2): ws-data 밖 HTML 바이트 동일, v1 JSON = 메모리 data, decode(v2) = parse(v1)', () => {
    const old = build(seedOf(), asOf, 1);
    expect(old.pages.map((p) => p.route.path)).toEqual(b.pages.map((p) => p.route.path));
    for (const [i, p] of b.pages.entries()) {
      const o = old.pages[i];
      expect(p.html.replace(WS_RE, ''), p.route.path).toBe(o.html.replace(WS_RE, ''));
      const v1Json = WS_RE.exec(o.html)?.[1];
      expect(v1Json).toBe(jsonForScript(o.data));
      expect(decodeWsPage(wireOf(p.html))).toEqual(JSON.parse(v1Json ?? 'null'));
      // 요구사항 없는 페이지는 `,"sources":[]` 13B 만 늘고, 요구사항이 있으면 줄어든다.
      if (p.data.data.requirements.length > 0) expect(p.wsDataBytes, p.route.path).toBeLessThan(o.wsDataBytes);
      else expect(p.wsDataBytes, p.route.path).toBe(o.wsDataBytes + ',"sources":[]'.length);
    }
    // ws-data 밖 파일(sitemap·robots·manifest·카탈로그)도 같다.
    for (const [k, v] of old.files) if (!k.endsWith('.html')) expect(b.files.get(k), k).toBe(v);
  });
});

describe('ws-wire decode — v1 통과·복원 링크 출처', () => {
  const b = build(dwarfPreview(), DWARF_PREVIEW_AS_OF);
  const page = b.pages.find((p) => p.route.path === '/hamster/dwarf');
  if (!page) throw new Error('/hamster/dwarf 없음');

  it('v1 객체는 그대로 통과(배포 경계 — 구 HTML)', () => {
    const v1 = clone(page.data);
    expect(decodeWsPage(v1)).toBe(v1);
  });

  it('복원 searchLinks = buildSearchLinks(searchKeyword) — 링크는 엔진 함수로만', () => {
    const back = decodeWsPage(clone(encodeWsPage(page.data)));
    expect(back?.data.requirements.length).toBeGreaterThan(0);
    for (const r of back?.data.requirements ?? []) expect(r.searchLinks).toEqual(buildSearchLinks(r.searchKeyword));
  });

  it('표가 실제로 줄인다: 고유 출처 수 < 참조 수(드워프 타입 페이지)', () => {
    const w = encodeWsPage(page.data);
    const refs = w.data.requirements.reduce((n, r) => n + r.sourceRefs.length, 0);
    expect(w.sources.length).toBeGreaterThan(1);
    expect(w.sources.length).toBeLessThan(refs);
  });
});

describe('ws-wire decode — v2 fail-closed', () => {
  const b = build(dwarfPreview(), DWARF_PREVIEW_AS_OF);
  const page = b.pages.find((p) => p.route.path === '/hamster/dwarf');
  if (!page) throw new Error('/hamster/dwarf 없음');
  const base = (): { v: number; data: { requirements: Rec[] } & Rec; sources: Rec[] } & Rec =>
    clone(encodeWsPage(page.data)) as never;
  const withRef = (w: ReturnType<typeof base>): Rec => {
    const r = w.data.requirements.find((x) => (x.sourceRefs as number[]).length > 0);
    if (!r) throw new Error('출처 있는 요구사항 없음');
    return r;
  };

  it('대조: 변이 없는 와이어는 통과', () => {
    expect(decodeWsPage(base())).not.toBeNull();
  });

  const CASES: Array<[string, (w: ReturnType<typeof base>) => unknown]> = [
    ['범위 밖 인덱스(= 표 길이)', (w) => ((withRef(w).sourceRefs as number[])[0] = w.sources.length)],
    ['음수 인덱스', (w) => ((withRef(w).sourceRefs as number[])[0] = -1)],
    ['정수 아닌 인덱스', (w) => ((withRef(w).sourceRefs as number[])[0] = 0.5)],
    ['문자열 인덱스', (w) => ((withRef(w).sourceRefs as unknown[])[0] = '0')],
    ['미참조 표 항목', (w) => w.sources.push({ url: 'https://example.org/unused', title: 'unused' })],
    [
      '표 중복 항목(둘 다 참조됨)',
      (w) => {
        const r = withRef(w);
        const refs = r.sourceRefs as number[];
        w.sources.push({ ...w.sources[refs[0]] });
        refs.push(w.sources.length - 1);
      },
    ],
    ['v2 요구사항에 잔존 searchLinks', (w) => (w.data.requirements[0].searchLinks = [])],
    ['v2 요구사항에 잔존 source', (w) => (w.data.requirements[0].source = [])],
    ['sourceRefs 없음', (w) => delete w.data.requirements[0].sourceRefs],
    ['sourceRefs 배열 아님', (w) => (w.data.requirements[0].sourceRefs = 0)],
    ['searchKeyword 없음', (w) => delete w.data.requirements[0].searchKeyword],
    ['searchKeyword 문자열 아님', (w) => (w.data.requirements[0].searchKeyword = 1)],
    ['요구사항이 객체 아님', (w) => (w.data.requirements[0] = null as never)],
    ['requirements 배열 아님', (w) => (w.data.requirements = {} as never)],
    ['data 객체 아님', (w) => (w.data = [] as never)],
    ['표 항목에 {url,title} 외 키', (w) => (w.sources[0].accessedAt = '2026-10-01')],
    ['표 항목 키 부족', (w) => delete w.sources[0].title],
    ['표 항목 url 문자열 아님', (w) => (w.sources[0].url = 1)],
    ['표 항목 객체 아님', (w) => (w.sources[0] = 'x' as never)],
    ['sources 없음', (w) => delete (w as Rec).sources],
    ['sources 배열 아님', (w) => (w.sources = {} as never)],
    ['알 수 없는 최상위 키', (w) => (w.extra = 1)],
    ['알 수 없는 v(3)', (w) => (w.v = 3)],
    ['알 수 없는 v("2")', (w) => (w.v = '2' as never)],
    ['v 없음', (w) => delete (w as Rec).v],
  ];
  it.each(CASES)('%s → null', (_n, mutate) => {
    const w = base();
    mutate(w);
    expect(decodeWsPage(w)).toBeNull();
  });

  it.each([null, undefined, [], 'x', 2, true])('객체 아닌 입력 %j → null', (v) => {
    expect(decodeWsPage(v)).toBeNull();
  });

  // 보안 79 L-2: 출처 url 은 ^https:// 만.
  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['http:', 'http://example.org/a'],
    ['대문자 스킴', 'HTTPS://example.org/a'],
    ['상대 경로', '/data/x'],
    ['프로토콜 상대', '//example.org/a'],
    ['앞 공백', ' https://example.org/a'],
    ['빈 문자열', ''],
  ])('L-2: 표 항목 url %s → null', (_n, url) => {
    const w = base();
    w.sources[0].url = url;
    expect(decodeWsPage(w)).toBeNull();
  });

  // 보안 79 L-3: 위험 키는 어디에 있든 거부(v1 통과 경로 포함). JSON.parse 는 "__proto__" 를 자체 키로 만든다.
  const KEY_SITES: Array<[string, (json: string, key: string) => string]> = [
    ['최상위', (j, k) => j.replace('{"v":2,', `{"v":2,"${k}":{"polluted":1},`)],
    ['data', (j, k) => j.replace('"data":{', `"data":{"${k}":{"polluted":1},`)],
    ['요구사항', (j, k) => j.replace('"requirementId":', `"${k}":{"polluted":1},"requirementId":`)],
    ['요구사항 item 깊은 곳', (j, k) => j.replace('"specSchema":{', `"specSchema":{"${k}":1,`)],
    ['출처 표 항목', (j, k) => j.replace('"sources":[{', `"sources":[{"${k}":1,`)],
  ];
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    it.each(KEY_SITES)(`L-3: ${key} 키(%s) → null, 전역 프로토타입 불변`, (_n, inject) => {
      const json = JSON.stringify(base());
      const raw = inject(json, key);
      expect(raw).not.toBe(json); // 주입 지점이 실제로 있었다
      expect(decodeWsPage(JSON.parse(raw))).toBeNull();
      expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    });
  }

  it('L-3: v1 입력에 __proto__ 키 → null (v1 통과 경로도 막는다)', () => {
    const v1 = JSON.stringify(clone(page.data)).replace('"requirementId":', '"__proto__":{"polluted":1},"requirementId":');
    expect(decodeWsPage(JSON.parse(v1))).toBeNull();
    expect(decodeWsPage(clone(page.data))).not.toBeNull(); // 대조
  });

  it('L-3 대조: 값으로서의 "constructor"·"__proto__" 문자열은 허용(키만 거부)', () => {
    const w = base();
    w.sources[0].title = '__proto__ constructor prototype';
    expect(decodeWsPage(w)).not.toBeNull();
  });
});

describe('ws-wire encode — 무손실이 아닐 입력은 예외(빌드 실패)', () => {
  const b = build(promoted(), FIXTURE_AS_OF);
  const page = b.pages.find((p) => p.data.data.requirements.length > 0);
  if (!page) throw new Error('요구사항 있는 페이지 없음');

  it('searchLinks ≠ buildSearchLinks(searchKeyword) → 예외', () => {
    const d = clone(page.data);
    d.data.requirements[0].searchLinks = [{ provider: 'NAVER', href: 'https://search.shopping.naver.com/search/all?query=x' }];
    expect(() => encodeWsPage(d)).toThrow(/searchLinks/);
  });

  it('source 원소에 {url,title} 외 키 → 예외', () => {
    const d = clone(page.data);
    d.data.requirements[0].source = [{ url: 'https://example.org', title: 't', accessedAt: '2026-10-01' } as never];
    expect(() => encodeWsPage(d)).toThrow(/source/);
  });

  it.each(['javascript:alert(1)', 'http://example.org/a', '/relative', ''])('L-2: source url %j(https 아님) → 예외', (url) => {
    const d = clone(page.data);
    const r = d.data.requirements.find((x) => x.source.length > 0);
    if (!r) throw new Error('출처 있는 요구사항 없음');
    r.source[0] = { url, title: 't' };
    expect(() => encodeWsPage(d)).toThrow(/https/);
  });

  it('L-3: 입력에 __proto__·constructor·prototype 키 → 예외', () => {
    for (const k of ['__proto__', 'constructor', 'prototype']) {
      const d = JSON.parse(JSON.stringify(clone(page.data)).replace('"requirementId":', `"${k}":1,"requirementId":`)) as WsPageData;
      expect(() => encodeWsPage(d)).toThrow(/금지 키/);
    }
  });

  it('v ≠ 1 또는 최상위 키 이탈 → 예외', () => {
    expect(() => encodeWsPage({ ...clone(page.data), v: 2 as never })).toThrow();
    expect(() => encodeWsPage({ ...clone(page.data), extra: 1 } as never)).toThrow();
  });

  it('입력을 변형하지 않는다', () => {
    const d = clone(page.data);
    const before = JSON.stringify(d);
    encodeWsPage(d);
    expect(JSON.stringify(d)).toBe(before);
  });
});
