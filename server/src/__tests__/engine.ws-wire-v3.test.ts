// 259 단계 4(258) — ws-data 와이어 v3(제휴). 제휴 0 → v2 바이트 그대로, 제휴 → v3 왕복 무손실, v3 위반 fail-closed.
import { describe, expect, it } from 'vitest';
import { WS_WIRE_VERSION, WS_WIRE_VERSION_AFF, buildSearchLinks, decodeWsPage, encodeWsPage, toWsPageV1, type WsPageData } from '../engine/index.js';
import { buildSite } from '../prerender/site.js';
import { baseOptions } from './fixtures/affiliate/baseline.js';
import { buildKeywords, fakeLinkMap } from './fixtures/affiliate/fake-map.js';
import { DWARF_PREVIEW_AS_OF, FIXTURE_AS_OF, dwarfPreview, promotedTwo } from './fixtures/prerender-seed.js';

type Rec = Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const CASES = [
  ['promotedTwo', () => promotedTwo(), FIXTURE_AS_OF],
  ['dwarfPreview', dwarfPreview, DWARF_PREVIEW_AS_OF],
] as const;

/** HEAD 7ba51a1 encodeWsPage 의 요구사항 변환(searchLinks 제거, source → sourceRefs) — v2 기준 바이트 재현용. */
function headEncode(page: WsPageData): Rec {
  const sources: Array<{ url: string; title: string }> = [];
  const index = new Map<string, number>();
  const requirements = page.data.requirements.map((r) => {
    const refs = r.source.map((s) => {
      const k = JSON.stringify([s.url, s.title]);
      let n = index.get(k);
      if (n === undefined) {
        n = sources.length;
        index.set(k, n);
        sources.push({ url: s.url, title: s.title });
      }
      return n;
    });
    const e: Array<[string, unknown]> = [];
    for (const [k, v] of Object.entries(r)) {
      if (k === 'searchLinks') continue;
      e.push(k === 'source' ? ['sourceRefs', refs] : [k, v]);
    }
    return Object.fromEntries(e);
  });
  const data = Object.fromEntries(Object.entries(page.data).map(([k, v]) => [k, k === 'requirements' ? requirements : v]));
  return { v: 2, route: page.route, layer: page.layer, catalogUrl: page.catalogUrl, data, sources };
}

describe.each(CASES)('ws-wire v3 — %s', (_n, seedOf, asOf) => {
  const opts = baseOptions(asOf);
  const off = buildSite(seedOf(), opts);
  const on = buildSite(seedOf(), { ...opts, affiliate: fakeLinkMap(buildKeywords(seedOf(), opts)) });

  it('(a) 제휴 0 → v:2, HEAD encode 와 JSON 바이트 동일', () => {
    for (const p of off.pages) {
      const w = encodeWsPage(p.data);
      expect(w.v).toBe(WS_WIRE_VERSION);
      expect(JSON.stringify(w), p.route.path).toBe(JSON.stringify(headEncode(p.data)));
    }
  });

  it('(b) 제휴 → v:3 왕복 무손실(키 순서 포함), aff 는 searchKeyword 바로 뒤', () => {
    let n = 0;
    for (const p of on.pages) {
      const w = encodeWsPage(p.data) as unknown as Rec;
      const reqs = (w.data as Rec).requirements as Rec[];
      if (!reqs.some((r) => 'aff' in r)) continue;
      n++;
      expect(w.v).toBe(WS_WIRE_VERSION_AFF);
      for (const r of reqs) {
        const keys = Object.keys(r);
        if ('aff' in r) expect(keys[keys.indexOf('searchKeyword') + 1]).toBe('aff');
        expect(keys).not.toContain('searchLinks');
      }
      const back = decodeWsPage(clone(w));
      expect(JSON.stringify(back), p.route.path).toBe(JSON.stringify(p.data));
    }
    expect(n).toBeGreaterThan(0);
  });

  it('제휴 페이지의 aff 를 지우고 v2 로 바꾸면 꺼짐 페이지 와이어와 같다(제휴는 링크만 바꾼다)', () => {
    for (const [i, p] of on.pages.entries()) {
      const w = encodeWsPage(p.data) as unknown as Rec;
      w.v = WS_WIRE_VERSION;
      for (const r of (w.data as Rec).requirements as Rec[]) delete r.aff;
      expect(JSON.stringify(w)).toBe(JSON.stringify(encodeWsPage(off.pages[i].data)));
    }
  });
});

describe('(c) v3 fail-closed', () => {
  const opts = baseOptions(FIXTURE_AS_OF);
  const seed = promotedTwo();
  const on = buildSite(seed, { ...opts, affiliate: fakeLinkMap(buildKeywords(seed, opts)) });
  const page = on.pages.find((p) => p.data.data.requirements.length > 0) as (typeof on.pages)[number];
  const wire = encodeWsPage(page.data) as unknown as Rec;
  const firstAff = () => ((wire.data as Rec).requirements as Rec[]).findIndex((r) => 'aff' in r);

  it('정상 v3 는 decode 된다', () => {
    expect(wire.v).toBe(3);
    expect(firstAff()).toBeGreaterThan(-1);
    expect(decodeWsPage(clone(wire))).not.toBeNull();
  });

  const bad: Array<[string, (w: Rec, i: number) => void]> = [
    ['aff 이상 키(NAVER)', (w, i) => (((w.data as Rec).requirements as Rec[])[i].aff = { COUPANG: 'FAKE0001', NAVER: 'FAKE0002' })],
    ['aff 키 NAVER 만', (w, i) => (((w.data as Rec).requirements as Rec[])[i].aff = { NAVER: 'FAKE0001' })],
    ['javascript: code', (w, i) => (((w.data as Rec).requirements as Rec[])[i].aff = { COUPANG: 'javascript:alert(1)' })],
    ['하위 도메인·경로 code', (w, i) => (((w.data as Rec).requirements as Rec[])[i].aff = { COUPANG: 'evil.link.coupang.com/a/x' })],
    ['URL code', (w, i) => (((w.data as Rec).requirements as Rec[])[i].aff = { COUPANG: 'https://evil.example' })],
    ['code 숫자', (w, i) => (((w.data as Rec).requirements as Rec[])[i].aff = { COUPANG: 1234 })],
    ['aff 문자열', (w, i) => (((w.data as Rec).requirements as Rec[])[i].aff = 'FAKE0001')],
    ['aff 배열', (w, i) => (((w.data as Rec).requirements as Rec[])[i].aff = ['FAKE0001'])],
    ['v2 인데 aff', (w) => (w.v = 2)],
    ['v3 인데 aff 0', (w) => {
      w.v = 3;
      for (const r of (w.data as Rec).requirements as Rec[]) delete r.aff;
    }],
    ['v4', (w) => (w.v = 4)],
    ['aff 안 __proto__', (w, i) => (((w.data as Rec).requirements as Rec[])[i].aff = JSON.parse('{"COUPANG":"FAKE0001","__proto__":{}}') as Rec)],
    // 273(QA D7): 링크를 만들지 않는 aff — encode 는 내지 않는 형태.
    ['빈 검색어 + aff', (w, i) => (((w.data as Rec).requirements as Rec[])[i].searchKeyword = '')],
    ['공백뿐인 검색어 + aff', (w, i) => (((w.data as Rec).requirements as Rec[])[i].searchKeyword = '   ')],
  ];
  it.each(bad)('%s → null', (_n, mut) => {
    const w = clone(wire);
    mut(w, firstAff());
    expect(decodeWsPage(w)).toBeNull();
  });

  it('복원 링크는 buildSearchLinks(searchKeyword, aff) — 와이어에 href 를 실어도 받지 않는다', () => {
    const w = clone(wire);
    const r = ((w.data as Rec).requirements as Rec[])[firstAff()];
    r.searchLinks = [{ provider: 'COUPANG', kind: 'AFFILIATE', href: 'https://evil.example' }];
    expect(decodeWsPage(w)).toBeNull();
    const back = decodeWsPage(clone(wire)) as WsPageData;
    const req = back.data.requirements[firstAff()];
    expect(req.searchLinks).toEqual(buildSearchLinks(req.searchKeyword, { COUPANG: (((wire.data as Rec).requirements as Rec[])[firstAff()].aff as Rec).COUPANG as string }));
    expect(req.searchLinks[0]).toMatchObject({ provider: 'COUPANG', kind: 'AFFILIATE' });
  });

  it('encode: 메모리 searchLinks 가 buildSearchLinks(kw, aff) 와 다르면 throw · aff 키가 이미 있으면 throw', () => {
    const d = clone(page.data);
    d.data.requirements[0].searchLinks = [{ provider: 'COUPANG', kind: 'AFFILIATE', href: 'https://link.coupang.com/a/FAKE0001' }];
    expect(() => encodeWsPage(d)).toThrow(/searchLinks/);
    const d2 = clone(page.data);
    (d2.data.requirements[0] as unknown as Rec).aff = { COUPANG: 'FAKE0001' };
    expect(() => encodeWsPage(d2)).toThrow(/aff/);
  });
});

describe('273 toWsPageV1 — wsDataWire:1 은 제휴 코드 이전 v1 링크 형식({provider, href})', () => {
  const opts = baseOptions(FIXTURE_AS_OF);
  const seed = promotedTwo();
  const off = buildSite(seed, opts);
  const on = buildSite(seed, { ...opts, affiliate: fakeLinkMap(buildKeywords(seed, opts)) });
  const withReq = (b: typeof off) => b.pages.filter((p) => p.data.data.requirements.length > 0);

  it('꺼짐: SEARCH 링크에 kind 키 0 — 제휴 코드 이전 buildSearchLinks 형식과 JSON 바이트 동일, 나머지 키·순서 그대로', () => {
    expect(withReq(off).length).toBeGreaterThan(0);
    for (const p of withReq(off)) {
      const before = JSON.stringify(p.data);
      const v1 = toWsPageV1(p.data);
      expect(JSON.stringify(p.data), 'input untouched').toBe(before);
      for (const [i, r] of v1.data.requirements.entries()) {
        expect(JSON.stringify(r.searchLinks)).toBe(
          JSON.stringify(p.data.data.requirements[i].searchLinks.map((l) => ({ provider: l.provider, href: l.href }))),
        );
      }
      // kind 를 뺀 것 말고는 같다.
      expect(JSON.stringify(v1).replace(/,"kind":"SEARCH"/g, '')).toBe(JSON.stringify(v1));
      expect(JSON.stringify(p.data).replace(/,"kind":"SEARCH"/g, '')).toBe(JSON.stringify(v1));
      expect(Object.keys(v1)).toEqual(Object.keys(p.data));
    }
  });

  it('켜짐: AFFILIATE 링크는 kind 를 남기고 SEARCH 만 뺀다', () => {
    let aff = 0;
    for (const p of withReq(on)) {
      for (const r of toWsPageV1(p.data).data.requirements) {
        for (const l of r.searchLinks) {
          if (l.kind === 'AFFILIATE') aff++;
          else expect(Object.keys(l)).toEqual(['provider', 'href']);
        }
      }
    }
    expect(aff).toBeGreaterThan(0);
  });
});
