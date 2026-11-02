// 259 단계 2(258) — 제휴 링크 코드 맵 로더·게이트(prerender/affiliate.ts) + CLI 배선. 네트워크 0, 코드는 가짜(FAKE…)만.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  affiliateDisclosureOn,
  affiliateGate,
  affiliateMapWarnings,
  hasDuplicateJsonKey,
  parseAffiliateMap,
  parseAffiliateMapText,
  renderableSearchLinks,
  toAffiliateLinkMap,
} from '../prerender/affiliate.js';
import { DEFAULT_AFFILIATE_MAP, runPrerenderCli, type PrerenderIo } from '../prerender/cli.js';
import { buildSite } from '../prerender/site.js';
import { buildSearchLinks, type SearchLink } from '../engine/index.js';
import { baseOptions, TEMPLATE } from './fixtures/affiliate/baseline.js';
import { buildKeywords, fakeMapFile } from './fixtures/affiliate/fake-map.js';
import { FIXTURE_AS_OF, promoted, writeSeedDir } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_FILE = join(here, 'fixtures', 'affiliate', 'coupang.fake.json');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const fakeJson = (): Record<string, unknown> => JSON.parse(readFileSync(FAKE_FILE, 'utf8')) as Record<string, unknown>;

describe('커밋 맵 server/affiliate/coupang.json', () => {
  it('빈 맵(entries 0, subId "") — 유효하고 제휴 링크 0', () => {
    const f = parseAffiliateMap(JSON.parse(readFileSync(DEFAULT_AFFILIATE_MAP, 'utf8')));
    expect(f.entries).toEqual([]);
    expect(f.subId).toBe('');
    expect(toAffiliateLinkMap(f).size).toBe(0);
  });
});

describe('parseAffiliateMap', () => {
  it('가짜 픽스처 맵 통과 → 키워드 → {COUPANG: code}', () => {
    const m = toAffiliateLinkMap(parseAffiliateMap(fakeJson()));
    expect([...m.values()]).toEqual([{ COUPANG: 'FAKE0001' }, { COUPANG: 'FAKE0002' }]);
  });

  it('(a) 빈 맵이면 buildSearchLinks 결과에 AFFILIATE 0', () => {
    const m = toAffiliateLinkMap(parseAffiliateMap({ ...fakeJson(), entries: [] }));
    expect(buildSearchLinks('골든햄스터 쳇바퀴 30cm 무소음', m.get('골든햄스터 쳇바퀴 30cm 무소음')).every((l) => l.kind === 'SEARCH')).toBe(true);
  });

  const bad: Array<[string, (j: Record<string, unknown>) => void]> = [
    ['landingUrl 불일치(다른 검색어)', (j) => ((j.entries as Record<string, unknown>[])[0].landingUrl = 'https://www.coupang.com/np/search?q=other')],
    ['landingUrl 상품 페이지', (j) => ((j.entries as Record<string, unknown>[])[0].landingUrl = 'https://www.coupang.com/vp/products/1')],
    ['항목 키 초과(commissionRate)', (j) => ((j.entries as Record<string, unknown>[])[0].commissionRate = 3)],
    ['항목 키 초과(price)', (j) => ((j.entries as Record<string, unknown>[])[0].price = 1000)],
    ['최상위 키 초과(commission)', (j) => (j.commission = 1)],
    ['최상위 키 누락(subId)', (j) => delete j.subId],
    ['code 형식 오류(/)', (j) => ((j.entries as Record<string, unknown>[])[0].code = 'FAKE/001')],
    ['code 형식 오류(URL)', (j) => ((j.entries as Record<string, unknown>[])[0].code = 'https://evil.example')],
    ['code 숫자', (j) => ((j.entries as Record<string, unknown>[])[0].code = 12345)],
    ['code 중복', (j) => ((j.entries as Record<string, unknown>[])[1].code = 'FAKE0001')],
    ['keyword 중복', (j) => (j.entries = [(j.entries as unknown[])[0], (j.entries as unknown[])[0]])],
    ['keyword 공백 미정리', (j) => ((j.entries as Record<string, unknown>[])[1].keyword = ' fixture keyword two')],
    ['v 2', (j) => (j.v = 2)],
    ['provider NAVER', (j) => (j.provider = 'NAVER')],
    ['source API', (j) => (j.source = 'API')],
    ['generatedAt 형식', (j) => (j.generatedAt = '2026-13-01')],
    ['subId 특수문자', (j) => (j.subId = 'a b')],
    ['entries 객체', (j) => (j.entries = {})],
  ];
  it.each(bad)('무효 → throw: %s', (_n, mut) => {
    const j = clone(fakeJson());
    mut(j);
    expect(() => parseAffiliateMap(j)).toThrow(/affiliate: 맵 무효/);
  });

  it('__proto__·constructor 키 → throw', () => {
    const j1 = JSON.parse(readFileSync(FAKE_FILE, 'utf8').replace('"v": 1,', '"v": 1, "__proto__": {"x": 1},')) as unknown;
    expect(() => parseAffiliateMap(j1)).toThrow(/금지 키/);
    const j2 = clone(fakeJson());
    (j2.entries as Record<string, unknown>[])[0] = JSON.parse('{"constructor":1}') as Record<string, unknown>;
    expect(() => parseAffiliateMap(j2)).toThrow(/금지 키/);
    for (const x of [null, [], 'x', 1]) expect(() => parseAffiliateMap(x)).toThrow(/맵 무효/);
  });

  it('오류 메시지에 코드 값을 넣지 않는다', () => {
    const j = clone(fakeJson());
    (j.entries as Record<string, unknown>[])[0].code = 'SECRETCODE/9';
    expect(() => parseAffiliateMap(j)).toThrow();
    try {
      parseAffiliateMap(j);
    } catch (e) {
      expect((e as Error).message).not.toContain('SECRETCODE');
    }
  });
});

describe('273 parseAffiliateMapText — 원문 중복 키(Codex ④)', () => {
  const text = readFileSync(FAKE_FILE, 'utf8');

  it('정상 원문 통과 = parseAffiliateMap(JSON.parse) 와 같다 · 다른 객체의 같은 키·값 문자열은 중복 아님', () => {
    expect(parseAffiliateMapText(text)).toEqual(parseAffiliateMap(JSON.parse(text)));
    expect(hasDuplicateJsonKey(text)).toBe(false);
    expect(hasDuplicateJsonKey('{"a":"a","b":{"a":1},"c":[{"a":1},{"a":2}],"d":"\\"a\\"","e":"x\\\\"}')).toBe(false);
  });

  const dups: Array<[string, string]> = [
    ['최상위 v 두 번', text.replace('"v": 1,', '"v": 1, "v": 1,')],
    ['앞 code 가 무효·뒤 code 가 유효(앞 값이 사라짐)', text.replace('"code": "FAKE0001"', '"code": "https://evil.example", "code": "FAKE0001"')],
    ['항목 안 keyword 두 번', text.replace('"keyword": "fixture keyword two",', '"keyword": "x", "keyword": "fixture keyword two",')],
    ['이스케이프 키(\\u0063ode = code)', text.replace('"code": "FAKE0002"', '"code": "FAKE0009", "\\u0063ode": "FAKE0002"')],
    ['entries 두 번(앞 entries 가 사라짐)', text.replace('"v": 1,', '"entries": [{"keyword":"z","landingUrl":"https://evil.example","code":"FAKE0003"}], "v": 1,')],
  ];
  it.each(dups)('중복 키 → throw: %s', (_n, t) => {
    expect(() => JSON.parse(t)).not.toThrow(); // JSON.parse 는 조용히 마지막 값만 남긴다 — 그래서 원문 검사가 필요하다.
    expect(hasDuplicateJsonKey(t)).toBe(true);
    expect(() => parseAffiliateMapText(t)).toThrow(/중복 키/);
  });

  it('JSON 아님 → throw(값을 메시지에 넣지 않는다)', () => {
    expect(() => parseAffiliateMapText('{ not json FAKE0001')).toThrow(/JSON 아님/);
    try {
      parseAffiliateMapText('{ not json FAKE0001');
    } catch (e) {
      expect((e as Error).message).not.toContain('FAKE0001');
    }
  });
});

describe('affiliateMapWarnings', () => {
  const f = parseAffiliateMap(fakeJson());
  it('(e) generatedAt 90일 초과 → 경고 1줄(값 0), 90일 이하 → 0', () => {
    const kws = new Set(f.entries.map((e) => e.keyword));
    expect(affiliateMapWarnings(f, kws, '2027-01-31')).toEqual([]); // 90일
    const w = affiliateMapWarnings(f, kws, '2027-02-01');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/90일/);
    expect(w[0]).not.toMatch(/FAKE|2026-11-02/);
  });
  it('(f) 현 빌드에 없는 맵 키워드 → 개수만', () => {
    const w = affiliateMapWarnings(f, new Set(['골든햄스터 쳇바퀴 30cm 무소음']), '2026-11-02');
    expect(w).toEqual(['affiliate: 경고 이번 빌드 검색어에 없는 맵 항목 1개(일반 링크로 폴백)']);
  });
});

describe('affiliateGate — 4조건', () => {
  const ON = { WS_AFFILIATE_PROVIDERS: 'COUPANG', WS_AFFILIATE_ORIGINS: 'https://withsmall.example' };
  it('전부 참 → on', () => {
    expect(affiliateGate(ON, 'https://withsmall.example', true)).toEqual({ on: true, reason: 'ON' });
    expect(affiliateGate({ WS_AFFILIATE_PROVIDERS: ' NAVER , COUPANG ', WS_AFFILIATE_ORIGINS: 'https://a.example,https://withsmall.example/' }, 'https://withsmall.example', true).on).toBe(true);
  });
  it('(c)(d) 하나라도 거짓 → off(기본 꺼짐)', () => {
    expect(affiliateGate(ON, 'https://withsmall.example', false)).toEqual({ on: false, reason: 'NOT_PRODUCTION' });
    expect(affiliateGate({ ...ON, WS_AFFILIATE_PROVIDERS: '' }, 'https://withsmall.example', true).reason).toBe('PROVIDER_OFF');
    expect(affiliateGate({ ...ON, WS_AFFILIATE_PROVIDERS: 'coupang' }, 'https://withsmall.example', true).reason).toBe('PROVIDER_OFF');
    expect(affiliateGate({ WS_AFFILIATE_PROVIDERS: 'COUPANG' }, 'https://withsmall.example', true).reason).toBe('ORIGIN_NOT_ALLOWED');
    expect(affiliateGate(ON, 'https://staging.withsmall.example', true).reason).toBe('ORIGIN_NOT_ALLOWED');
    expect(affiliateGate({}, 'https://withsmall.example', true).on).toBe(false);
  });
});

describe('renderableSearchLinks · affiliateDisclosureOn(A·B 공통 판정)', () => {
  it('엔진 출력은 그대로 통과(순서 유지)', () => {
    for (const aff of [undefined, { COUPANG: 'FAKE0001' }]) {
      const ls = buildSearchLinks('a', aff);
      expect(renderableSearchLinks(ls)).toEqual(ls);
    }
    expect(affiliateDisclosureOn(buildSearchLinks('a'))).toBe(false);
    expect(affiliateDisclosureOn(buildSearchLinks('a', { COUPANG: 'FAKE0001' }))).toBe(true);
  });
  it('허용 밖 href 는 걸러지고, 걸러진 AFFILIATE 는 고지도 켜지 않는다', () => {
    const bad: SearchLink[] = [
      { provider: 'COUPANG', kind: 'AFFILIATE', href: 'https://evil.example/a/FAKE0001' },
      { provider: 'COUPANG', kind: 'AFFILIATE', href: 'https://link.coupang.com/a/FAKE/1' },
      { provider: 'NAVER', kind: 'AFFILIATE', href: 'https://link.coupang.com/a/FAKE0001' },
      { provider: 'COUPANG', kind: 'SEARCH', href: 'https://link.coupang.com/a/FAKE0001' },
      { provider: 'COUPANG', kind: 'SEARCH', href: 'https://evil.example/np/search?q=a' },
      { provider: 'AMAZON' as never, kind: 'SEARCH', href: 'https://www.amazon.com/s?k=a' },
    ];
    expect(renderableSearchLinks(bad)).toEqual([]);
    expect(affiliateDisclosureOn(bad)).toBe(false);
  });
});

// ── CLI 배선 ─────────────────────────────────────────────────────────────────
const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), `ws-aff-${p}-`));
  temps.push(d);
  return d;
};
function outDir(): string {
  const d = tmp('dist');
  writeFileSync(join(d, 'index.html'), TEMPLATE);
  return d;
}
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
async function run(argv: string[], env: Record<string, string>): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const io: PrerenderIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), env, today: () => FIXTURE_AS_OF };
  return { code: await runPrerenderCli([...argv, '--now', FIXTURE_AS_OF], io), out, err };
}

describe('CLI 제휴 게이트', () => {
  const ORIGIN = 'https://withsmall.example';
  const PROD_ON = { NODE_ENV: 'production', SITE_ORIGIN: ORIGIN, WS_AFFILIATE_PROVIDERS: 'COUPANG', WS_AFFILIATE_ORIGINS: ORIGIN };
  const seed = promoted({ publishable: true });
  const seedDir = tmp('seed');
  writeSeedDir(seedDir, seed);
  const kws = buildKeywords(seed, baseOptions(FIXTURE_AS_OF));
  const mapPath = join(tmp('map'), 'coupang.json');
  writeFileSync(mapPath, `${JSON.stringify(fakeMapFile(kws))}\n`);
  const coupangLinkFiles = (dir: string): string[] => walk(dir).filter((f) => readFileSync(f, 'utf8').includes('link.coupang.com'));

  it('픽스처 검색어가 있다(시험 전제)', () => {
    expect(kws.length).toBeGreaterThan(3);
  });

  it('켜짐 + 유효 맵 → 쿠팡 제휴 링크·고지, 요약 1줄', async () => {
    const out = outDir();
    const r = await run(['--out', out, '--seed-dir', seedDir, '--affiliate-map', mapPath], PROD_ON);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out[0]).toBe(`prerender — affiliate COUPANG on, map entries ${kws.length}, matched ${kws.length}/${kws.length} keywords`);
    const html = readFileSync(join(out, 'hamster', 'golden', 'supplies', 'cage', 'index.html'), 'utf8');
    expect(html).toContain('data-ws-aff="note-a"');
    expect(html).toContain('https://link.coupang.com/a/FAKE');
  });

  it('(d) 개발 빌드 + 유효 맵 + env 켜짐 → 꺼짐(맵 무시), 산출물에 link.coupang 0', async () => {
    const out = outDir();
    const env = { ...PROD_ON, NODE_ENV: 'development' };
    const r = await run(['--out', out, '--seed-dir', seedDir, '--affiliate-map', mapPath], env);
    expect(r.code).toBe(0);
    expect(r.err).toEqual(['prerender: 제휴 꺼짐(NOT_PRODUCTION)']);
    expect(coupangLinkFiles(out)).toEqual([]);
  });

  it('오리진 미허용 → 꺼짐, 맵이 무효여도 읽지 않는다', async () => {
    const out = outDir();
    const r = await run(['--out', out, '--seed-dir', seedDir, '--affiliate-map', join(tmp('none'), 'missing.json')], { ...PROD_ON, WS_AFFILIATE_ORIGINS: 'https://other.example' });
    expect(r.code).toBe(0);
    expect(coupangLinkFiles(out)).toEqual([]);
  });

  it('켜짐 + 맵 없음·JSON 아님·무효 → exit 2, 산출물 0', async () => {
    const broken = join(tmp('map'), 'broken.json');
    writeFileSync(broken, '{ not json FAKE0001');
    const invalid = join(tmp('map'), 'invalid.json');
    const inv = fakeMapFile(kws);
    (inv.entries[0] as Record<string, unknown>).commissionRate = 3;
    writeFileSync(invalid, JSON.stringify(inv));
    // 273: 원문 중복 키(앞 code 무효·뒤 code 유효 — JSON.parse 만으로는 통과하던 입력).
    const dup = join(tmp('map'), 'dup.json');
    const valid = JSON.stringify(fakeMapFile(kws));
    writeFileSync(dup, valid.replace('"code":"FAKE0001"', '"code":"https://evil.example","code":"FAKE0001"'));
    expect(readFileSync(dup, 'utf8')).not.toBe(valid);
    for (const p of [join(tmp('none'), 'missing.json'), broken, invalid, dup]) {
      const out = outDir();
      const r = await run(['--out', out, '--seed-dir', seedDir, '--affiliate-map', p], PROD_ON);
      expect(r.code, p).toBe(2);
      expect(r.err.join('\n')).not.toContain('FAKE0001');
      expect(walk(out).map((f) => f.slice(out.length + 1))).toEqual(['index.html']);
    }
  });

  it('켜짐 + 빈 맵(커밋 파일) → 꺼짐 빌드와 바이트 동일', async () => {
    const on = outDir();
    const off = outDir();
    const r1 = await run(['--out', on, '--seed-dir', seedDir, '--affiliate-map', DEFAULT_AFFILIATE_MAP], PROD_ON);
    const r2 = await run(['--out', off, '--seed-dir', seedDir], { NODE_ENV: 'production', SITE_ORIGIN: ORIGIN });
    expect([r1.code, r2.code]).toEqual([0, 0]);
    const files = (d: string) => walk(d).map((f) => f.slice(d.length + 1)).sort();
    expect(files(on)).toEqual(files(off));
    for (const f of files(on)) expect(readFileSync(join(on, f), 'utf8'), f).toBe(readFileSync(join(off, f), 'utf8'));
  });

  it('buildSite 기본(affiliate 옵션 없음)은 맵 파일과 무관하게 꺼짐', () => {
    const b = buildSite(seed, baseOptions(FIXTURE_AS_OF));
    expect(b.pages.some((p) => p.html.includes('link.coupang.com'))).toBe(false);
  });
});
