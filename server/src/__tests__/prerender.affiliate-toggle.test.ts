// 259 단계 3(258) — 불변식 ③ 증명: 제휴 여부가 노출·순서에 영향 0, 꺼짐 빌드 = 제휴 코드 이전 바이트.
//   T-③a: 같은 시드로 off / on 빌드 — on 은 맵 변형 5개(전체·홀수 번째·짝수 번째·마지막 1개·빈 맵, 273 QA D1: 일부 맵이어야
//         "제휴 있는 요구사항을 앞으로" 같은 재정렬이 드러난다).
//         (1) 상인 a 비교(273 Codex): 파일마다 쿠팡·네이버 a 의 개수·순서·라벨·속성이 off 와 같다. 쿠팡 a 는 href·rel·aria-describedby 만 다를 수 있고
//             (제휴 a 는 link.coupang.com/a/{code} + rel sponsored + 고지 A 연결), 제휴 아닌 쿠팡 a 와 네이버 a 는 off 와 태그 바이트까지 같다.
//         (2) 정규화 후 모든 파일 바이트 동일: 고지 요소 제거, 쿠팡 a 는 지우지 않고 제자리에서 href·rel·aria-describedby 만 자리표시로 바꾼다
//             (위치·개수·라벨·class·target·그 밖 속성이 바이트 비교에 남는다), ws-data 는 parse → aff 삭제·v3→v2 → 재직렬화.
//         (3) 라우트 동일 + 페이지별 requirements·products·types·bundles id 순서 동일. 빈 맵은 정규화 없이 바이트 동일.
//   T-③b: off 빌드 파일별 sha256 = fixtures/affiliate/off-baseline.sha256.json(제휴 코드 이전 코드로 만든 기준선).
//   T-③b-v1(273 Codex·QA D8): wsDataWire:1 off 빌드 ws-data JSON sha256 = off-baseline-v1.sha256.json(HEAD c03f3d2 코드로 생성) + ws-data 밖 HTML = v2 빌드.
//   + 고지 위치·문구 원문·rel, 고지 없는 화면, ws-data 크기.
//
//   기준선 재생성 절차(의도한 산출물 변경 때만 — 커밋 메시지에 사유·명령을 남긴다):
//     ① 권장(독립): 제휴 코드가 없는 리비전 코드로 만든다 — 시험이 자기 코드로 기준선을 만들지 않게.
//          npx tsx server/src/__tests__/fixtures/affiliate/gen-baseline.ts --rev <rev> [--overlay <작업 트리 경로>]...        (비교만, 차이 파일 목록 출력)
//          npx tsx server/src/__tests__/fixtures/affiliate/gen-baseline.ts --rev <rev> [--overlay ...] --write                (기준선 파일 쓰기)
//          v1 기준선은 같은 명령에 --wire 1.
//     ② 차선: 제휴 코드가 커밋된 뒤 제휴와 무관한 산출물 변경이면 현재 코드로 — WS_AFF_BASELINE_WRITE=1 npx vitest run prerender.affiliate-toggle
//          (쓰기 모드도 이전 기준선과 다른 파일 목록을 먼저 출력한다 — 비교 없이 조용히 덮어쓰지 않는다). 쓴 뒤 출력된 목록이 의도한 파일뿐인지 확인.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { WS_WIRE_VERSION, WS_WIRE_VERSION_AFF, decodeWsPage } from '../engine/ws-wire.js';
import { COPY } from '../prerender/copy.js';
import { WS_DATA_MAX_BYTES, WS_DATA_WARN_BYTES } from '../prerender/cli.js';
import { jsonForScript } from '../prerender/html.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { projectSite, type RequirementModel } from '../prerender/project.js';
import { layerL4 } from '../prerender/pages/type.js';
import { FIXTURE_AS_OF, promotedTwo } from './fixtures/prerender-seed.js';
import { BASELINE_CASES, BASELINE_FILE, baseOptions, hashFiles, sha256 } from './fixtures/affiliate/baseline.js';
import { buildKeywords, fakeLinkMap } from './fixtures/affiliate/fake-map.js';
import { BASELINE_V1_FILE, diffBaselines, type BaselineFile } from './fixtures/affiliate/gen-baseline.js';

const WS_RE = /<script id="ws-data" type="application\/json">([\s\S]*?)<\/script>/;
/** 상인 a(쿠팡 www·link, 네이버 쇼핑) — 원문 순서. */
const MERCHANT_A_RE = /<a href="(https:\/\/(?:www\.coupang\.com|link\.coupang\.com|search\.shopping\.naver\.com)\/[^"]*)"([^>]*)>([\s\S]*?)<\/a>/g;
const DISCLOSURE = '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
/**
 * 275 A-2: 정규화가 지우는 것은 프리렌더가 만드는 고지 형태뿐 — note-a(id ws-aff-a-{supplyItemId})·note-b(id 없음)·note-f(R4-3 푸터, id 없음),
 *   원문 문구 그대로(pages/common.ts affNote). 그 밖 data-ws-aff 값·문구·id·속성의 p 는 남겨서 off 와의 비교가 빨강이 되게 한다.
 */
const reEsc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOTE_RE = new RegExp(
  `<p class="ws-t-meta ws-aff-note"(?: id="ws-aff-a-[A-Za-z0-9_-]+" data-ws-aff="note-a"| data-ws-aff="note-b"| data-ws-aff="note-f")>${reEsc(DISCLOSURE)}</p>\\n?`,
  'g',
);
const AFF_REL = ' rel="sponsored nofollow noopener noreferrer"';

type Rec = Record<string, unknown>;

/** ws-data 정규화: aff 키 삭제, v3 → v2, 같은 직렬화기로 다시 쓴다. */
function normWire(json: string): string {
  const w = JSON.parse(json) as Rec;
  if (w.v === WS_WIRE_VERSION_AFF) w.v = WS_WIRE_VERSION;
  for (const r of ((w.data as Rec).requirements as Rec[]) ?? []) delete r.aff;
  return jsonForScript(w);
}

const isCoupang = (href: string): boolean => /^https:\/\/(?:www|link)\.coupang\.com\//.test(href);
/** 쿠팡 a 의 허용 차이(rel·aria-describedby) 를 뺀 속성 문자열 — 나머지 속성·순서는 그대로 남는다. */
const coupangAttrs = (attrs: string): string => attrs.replace(/ rel="[^"]*"/, ' rel="«REL»"').replace(/ aria-describedby="[^"]*"/, '');

/** 제휴 흔적 정규화(고지 요소 제거 · 쿠팡 a 는 제자리에서 href·rel·aria-describedby 만 자리표시 · ws-data aff). 비 HTML 파일은 그대로. */
function strip(file: string, content: string): string {
  if (!file.endsWith('.html')) return content;
  return content
    .replace(NOTE_RE, '')
    .replace(MERCHANT_A_RE, (m: string, href: string, attrs: string, body: string) =>
      isCoupang(href) ? `<a href="«COUPANG»"${coupangAttrs(attrs)}>${body}</a>` : m,
    )
    .replace(WS_RE, (_m, j: string) => `<script id="ws-data" type="application/json">${normWire(j)}</script>`);
}

interface Merchant {
  href: string;
  attrs: string;
  body: string;
}
const merchants = (html: string): Merchant[] =>
  [...html.replace(WS_RE, '').matchAll(MERCHANT_A_RE)].map((m) => ({ href: m[1], attrs: m[2], body: m[3] }));

/**
 * on 파일의 상인 a 가 off 와 같은가(개수·순서·라벨·속성). 다르면 첫 차이 설명, 같으면 null.
 *   제휴 쿠팡 a(link.coupang.com/a/) 는 off 의 같은 자리가 쿠팡 검색 a 여야 하고, rel 은 sponsored 고정·aria-describedby 필수, 나머지 속성·라벨은 off 와 같다.
 *   그 밖의 a(제휴 아닌 쿠팡·네이버)는 off 와 href·속성·라벨 바이트 동일.
 */
function merchantDiff(onHtml: string, offHtml: string): string | null {
  const on = merchants(onHtml);
  const off = merchants(offHtml);
  if (on.length !== off.length) return `상인 a 개수 ${on.length} ≠ off ${off.length}`;
  for (const [i, a] of on.entries()) {
    const b = off[i];
    if (a.body !== b.body) return `#${i} 라벨 다름`;
    if (a.href.startsWith('https://link.coupang.com/a/')) {
      if (!b.href.startsWith('https://www.coupang.com/np/search?')) return `#${i} 제휴 a 자리의 off 가 쿠팡 검색 a 가 아님`;
      if (!/^https:\/\/link\.coupang\.com\/a\/[A-Za-z0-9]+$/.test(a.href)) return `#${i} 제휴 href 형식`;
      if (!a.attrs.includes(AFF_REL)) return `#${i} 제휴 rel`;
      if (!/ aria-describedby="ws-aff-a-[^"]+"/.test(a.attrs)) return `#${i} 제휴 aria-describedby 없음`;
      if (coupangAttrs(a.attrs) !== coupangAttrs(b.attrs)) return `#${i} 제휴 a 속성(href·rel·aria-describedby 밖) 다름`;
    } else if (a.href !== b.href || a.attrs !== b.attrs) return `#${i} 제휴 아닌 상인 a 가 off 와 다름`;
  }
  return null;
}

/** 맵 변형 — 검색어 목록에서 제휴를 줄 부분집합(273 QA D1). */
const VARIANTS: ReadonlyArray<readonly [string, (kws: readonly string[]) => string[]]> = [
  ['전체', (k) => [...k]],
  ['홀수 번째', (k) => k.filter((_x, i) => i % 2 === 1)],
  ['짝수 번째', (k) => k.filter((_x, i) => i % 2 === 0)],
  ['마지막 1개', (k) => k.slice(-1)],
  ['빈 맵', () => []],
];

interface Pair {
  name: string;
  variant: string;
  off: SiteBuild;
  on: SiteBuild;
  keywords: string[];
  affKeywords: string[];
}

const OFF = new Map(BASELINE_CASES.map((c) => [c.name, buildSite(c.seed(), baseOptions(c.asOf))] as const));
const PAIRS: Pair[] = BASELINE_CASES.flatMap((c) => {
  const opts = baseOptions(c.asOf);
  const keywords = buildKeywords(c.seed(), opts);
  const off = OFF.get(c.name) as SiteBuild;
  // 검색어 0 인 실시드는 변형이 모두 빈 맵과 같다 — 전체·빈 맵만.
  const variants = keywords.length === 0 ? VARIANTS.filter(([v]) => v === '전체' || v === '빈 맵') : VARIANTS;
  return variants.map(([variant, pick]) => {
    const affKeywords = pick(keywords);
    return { name: c.name, variant, off, on: buildSite(c.seed(), { ...opts, affiliate: fakeLinkMap(affKeywords) }), keywords, affKeywords };
  });
});
const FULL = PAIRS.filter((p) => p.variant === '전체');

const ids = (b: SiteBuild) =>
  b.pages.map((p) => ({
    path: p.route.path,
    requirements: p.data.data.requirements.map((r) => r.requirementId),
    products: p.data.data.products.map((x) => x.id),
    types: p.data.data.types.map((t) => t.id),
    bundles: p.data.data.bundles.map((x) => x.id),
  }));

describe('전제 — 링크가 있는 픽스처', () => {
  it('promotedTwo·dwarfPreview 는 검색어 ≥ 2, on 빌드에 제휴 링크가 실제로 있다 · 일부 맵 변형은 제휴·비제휴 요구사항이 섞인다', () => {
    for (const p of PAIRS.filter((x) => x.name !== 'real')) {
      expect(p.keywords.length, p.name).toBeGreaterThan(1);
      expect(p.off.pages.some((x) => x.html.includes('link.coupang.com')), p.name).toBe(false);
      const affReqs = p.on.pages.flatMap((x) => x.data.data.requirements).filter((r) => r.searchLinks.some((l) => l.kind === 'AFFILIATE')).length;
      if (p.variant === '빈 맵') expect(affReqs, `${p.name}/${p.variant}`).toBe(0);
      else {
        expect(affReqs, `${p.name}/${p.variant}`).toBeGreaterThan(0);
        expect(p.on.pages.some((x) => x.html.includes('https://link.coupang.com/a/FAKE')), `${p.name}/${p.variant}`).toBe(true);
      }
      if (p.variant !== '전체' && p.variant !== '빈 맵') {
        // 섞인 페이지(같은 페이지 데이터에 제휴·비제휴 요구사항)가 있어야 재정렬 변이가 드러난다.
        const mixed = p.on.pages.some((x) => {
          const k = x.data.data.requirements.map((r) => r.searchLinks.some((l) => l.kind === 'AFFILIATE'));
          return k.includes(true) && k.includes(false);
        });
        expect(mixed, `${p.name}/${p.variant}`).toBe(true);
      }
    }
  });
});

describe.each(PAIRS)('T-③a on/off 동일성 — $name · $variant 맵', ({ off, on, variant }) => {
  it('라우트 목록·파일 목록 동일', () => {
    expect(on.routes.map((r) => r.path)).toEqual(off.routes.map((r) => r.path));
    expect([...on.files.keys()]).toEqual([...off.files.keys()]);
  });

  it('페이지별 requirements·products·types·bundles id 순서 동일', () => {
    expect(ids(on)).toEqual(ids(off));
  });

  it('상인 a(쿠팡·네이버) 개수·순서·라벨·속성 = off(쿠팡 제휴 a 는 href·rel·aria-describedby 만 다름)', () => {
    for (const [f, c] of off.files) if (f.endsWith('.html')) expect(merchantDiff(on.files.get(f) as string, c), f).toBeNull();
  });

  it('정규화 후 모든 파일 바이트 동일(HTML·ws-data·catalog·sitemap·manifest)', () => {
    for (const [f, c] of off.files) expect(strip(f, on.files.get(f) as string), f).toBe(strip(f, c));
  });

  it.runIf(variant === '빈 맵')('빈 맵은 정규화 없이 모든 파일 바이트 동일', () => {
    for (const [f, c] of off.files) expect(on.files.get(f), f).toBe(c);
  });

  it('카탈로그 JSON 에 제휴 0', () => {
    expect(on.files.get(on.catalogFile)).toBe(off.files.get(off.catalogFile));
    expect(on.files.get(on.catalogFile)).not.toMatch(/link\.coupang|"aff"/);
  });
});

describe('273 T-③a 정규화·상인 비교가 상인 a 결함을 가리지 않는다(Codex)', () => {
  const p = FULL.find((x) => x.name === 'promotedTwo') as Pair;
  const file = [...p.on.files.keys()].find((f) => /<a href="https:\/\/link\.coupang\.com\/a\//.test(p.on.files.get(f) as string)) ?? 'index.html';
  // 제휴 a 가 하나도 없으면(변이) 아래 '전제' 가 빨강 — 수집 단계에서 던지지 않는다.
  const onHtml = p.on.files.get(file) as string;
  const offHtml = p.off.files.get(file) as string;
  const affA = /<a href="https:\/\/link\.coupang\.com\/a\/[^"]*"[^>]*>[\s\S]*?<\/a>\n/.exec(onHtml)?.[0] ?? '';
  const naverA = affA === '' ? '' : (/<a href="https:\/\/search\.shopping\.naver\.com\/[^"]*"[^>]*>[\s\S]*?<\/a>\n?/.exec(onHtml.slice(onHtml.indexOf(affA)))?.[0] ?? '');

  it('전제: 제휴 a 다음에 네이버 a 가 있는 정상 파일은 두 검사 모두 통과', () => {
    expect(affA).toBeTruthy();
    expect(naverA).toBeTruthy();
    expect(merchantDiff(onHtml, offHtml)).toBeNull();
    expect(strip(file, onHtml)).toBe(strip(file, offHtml));
  });

  const mutations: Array<[string, (h: string) => string]> = [
    ['쿠팡 a 누락', (h) => h.replace(affA, '')],
    ['쿠팡 a 중복', (h) => h.replace(affA, affA + affA)],
    ['쿠팡 a 를 네이버 뒤로 이동', (h) => h.replace(affA + naverA, naverA + affA)],
    ['쿠팡 a 에 style 추가', (h) => h.replace(affA, affA.replace('" target=', '" style="font-size:64px" target='))],
    ['쿠팡 a 라벨 변경', (h) => h.replace(affA, affA.replace(/>[^<]+<span/, '>다른 라벨<span'))],
    ['쿠팡 a 를 검색 블록 밖(본문 앞)으로', (h) => h.replace(affA, '').replace('<main ', `${affA}<main `)],
    // 275 A-2 X6·X7: 고지처럼 보이는 다른 data-ws-aff p 는 정규화가 지우지 않는다
    ['X6 .ws-search 안 data-ws-aff="promo" p', (h) => h.replace(affA, `<p class="ws-t-meta ws-aff-note" data-ws-aff="promo">${DISCLOSURE}</p>\n${affA}`)],
    ['X7 aside 에 note-c', (h) => h.replace(/(<aside [^>]*>)/, `$1<p class="ws-t-meta ws-aff-note" data-ws-aff="note-c">${DISCLOSURE}</p>\n`)],
    ['고지 문구 변경', (h) => h.replace(`>${DISCLOSURE}</p>`, '>다른 문구</p>')],
  ];
  it.each(mutations)('%s → 상인 비교 또는 정규화 비교가 빨강', (_n, mut) => {
    const bad = mut(onHtml);
    expect(bad).not.toBe(onHtml);
    expect(strip(file, bad)).not.toBe(strip(file, offHtml));
  });

  it('누락·중복·이동은 상인 비교 단독으로도 빨강', () => {
    expect(merchantDiff(mutations[0][1](onHtml), offHtml)).toMatch(/개수/);
    expect(merchantDiff(mutations[1][1](onHtml), offHtml)).toMatch(/개수/);
    expect(merchantDiff(mutations[2][1](onHtml), offHtml)).not.toBeNull();
  });
});

/** 기준선 비교 — 쓰기 모드(WS_AFF_BASELINE_WRITE=1)에서도 이전 기준선과 다른 파일 목록을 먼저 출력한다(조용한 덮어쓰기 금지, 273). */
function checkBaseline(file: string, name: string, now: Record<string, string>): void {
  const baseline = JSON.parse(readFileSync(file, 'utf8')) as BaselineFile;
  expect(baseline.head, file).toMatch(/^[0-9a-f]{7,40}(\+overlay)?$/);
  if (process.env.WS_AFF_BASELINE_WRITE === '1') {
    const diff = diffBaselines({ [name]: baseline.cases[name] ?? {} }, { [name]: now });
    console.log(`[WS_AFF_BASELINE_WRITE] ${file} ${name}: 이전 기준선(head ${baseline.head})과 차이 ${diff.length}개${diff.map((d) => `\n  ${d}`).join('')}`);
    baseline.cases[name] = now;
    writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
    return;
  }
  expect(now).toEqual(baseline.cases[name]);
}

describe('T-③b 꺼짐 빌드 = 기준선 sha256(off-baseline.sha256.json — 제휴 코드 이전 코드로 생성)', () => {
  it.each(BASELINE_CASES.map((c) => [c.name] as const))('%s', (name) => {
    checkBaseline(BASELINE_FILE, name, hashFiles(OFF.get(name) as SiteBuild));
  });
});

describe('273 T-③b-v1 wsDataWire:1 꺼짐 빌드 — ws-data JSON = HEAD c03f3d2 v1 기준선, ws-data 밖 HTML = v2 빌드', () => {
  const V1 = new Map(BASELINE_CASES.map((c) => [c.name, buildSite(c.seed(), { ...baseOptions(c.asOf), wsDataWire: 1 })] as const));
  it.each(BASELINE_CASES.map((c) => [c.name] as const))('%s', (name) => {
    const v1 = V1.get(name) as SiteBuild;
    const v2 = OFF.get(name) as SiteBuild;
    const now = Object.fromEntries(
      [...v1.files.keys()].sort().filter((k) => k.endsWith('.html')).map((k) => [k, sha256(WS_RE.exec(v1.files.get(k) as string)?.[1] ?? '')]),
    );
    for (const [f, c] of v1.files) expect(c.replace(WS_RE, ''), f).toBe((v2.files.get(f) as string).replace(WS_RE, ''));
    checkBaseline(BASELINE_V1_FILE, name, now);
  });
});

describe('on 빌드 — 고지 A·B 위치·문구·rel', () => {
  const pages = PAIRS.filter((p) => p.variant !== '빈 맵').flatMap((p) => p.on.pages);

  it('고지 문구는 쿠팡 원문 그대로(COPY.affiliate.coupang)', () => {
    expect(COPY.affiliate.coupang).toBe(DISCLOSURE);
  });

  it('쿠팡 AFFILIATE a 마다: 같은 .ws-search 안 앞에 note-a(id = describedby), 같은 aside 에 note-b(첫 요소), rel sponsored', () => {
    let n = 0;
    for (const p of pages) {
      const html = p.html;
      for (const m of html.matchAll(/<div class="ws-search">([\s\S]*?)<\/div>/g)) {
        const block = m[1];
        const a = /<a href="https:\/\/link\.coupang\.com\/a\/([A-Za-z0-9]+)"([^>]*)>/.exec(block);
        if (!a) {
          // 제휴 아닌 검색 블록(일부 맵) — 고지 A 없음.
          expect(block, p.route.path).not.toContain('data-ws-aff');
          continue;
        }
        n++;
        expect(a[2]).toContain('rel="sponsored nofollow noopener noreferrer"');
        const describedBy = /aria-describedby="([^"]+)"/.exec(a[2])?.[1];
        const noteA = new RegExp(`<p class="ws-t-meta ws-aff-note" id="${describedBy}" data-ws-aff="note-a">${DISCLOSURE}</p>`);
        const noteAt = block.search(noteA);
        expect(noteAt, p.route.path).toBeGreaterThan(-1);
        expect(noteAt).toBeLessThan(block.indexOf('<a href="https://link.coupang.com/a/'));
        // note-a 는 검색어 줄 다음, 첫 상인 a 바로 앞.
        expect(block).toMatch(new RegExp(`</span></p>\\n<p class="ws-t-meta ws-aff-note" id="${describedBy}" data-ws-aff="note-a">[^<]*</p>\\n<a href="https://link\\.coupang\\.com/a/`));
        // 네이버는 제휴 아님 — 기존 rel 그대로.
        expect(block).toContain('rel="noopener noreferrer nofollow">이 조건으로 네이버에서 찾기');
        const aside = /<aside class="ws-layer"[\s\S]*?<\/aside>/.exec(html)?.[0] ?? '';
        expect(aside.split('data-ws-aff="note-b"').length - 1, p.route.path).toBe(1);
        const layer = /data-ws-layer="(L\d)"/.exec(aside)?.[1];
        const noteB = `<p class="ws-t-meta ws-aff-note" data-ws-aff="note-b">${DISCLOSURE}</p>`;
        if (layer === 'L4') expect(aside).toMatch(/<\/h2>\n<a [^>]*class="ws-layer-close"[^>]*>[^<]*<\/a>\n<p class="ws-t-meta ws-aff-note" data-ws-aff="note-b">/);
        if (layer === 'L7') expect(aside).toContain(`</h2>\n${noteB}\n<p class="ws-meta"`);
        expect(['L4', 'L7']).toContain(layer);
      }
    }
    expect(n).toBeGreaterThan(10);
  });

  it('R4-3 고지 F: 제휴 a 가 있는 문서마다 footer.ws-footer 안 © 바로 앞에 note-f 정확히 1개(원문·전부 펼침), 없는 문서는 0', () => {
    const noteF = `<p class="ws-t-meta ws-aff-note" data-ws-aff="note-f">${DISCLOSURE}</p>`;
    let withAff = 0;
    for (const p of pages) {
      const html = p.html.replace(WS_RE, '');
      const footer = /<footer class="ws-footer">[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
      const count = html.split('data-ws-aff="note-f"').length - 1;
      if (html.includes('<a href="https://link.coupang.com/a/')) {
        withAff++;
        expect(count, p.route.path).toBe(1);
        expect(footer, p.route.path).toContain(`${noteF}\n<p class="ws-footer-copy">`);
        // 접힘·숨김 장치 없음(details·hidden·title).
        expect(footer, p.route.path).not.toMatch(/<details|\shidden[\s>]|\stitle="/);
      } else {
        expect(count, p.route.path).toBe(0);
      }
    }
    expect(withAff).toBeGreaterThan(5);
  });

  it('고지·제휴 링크 없는 화면: 레이어 없는 페이지·L5·홈·/setup·/vet·/supplies 목록 — data-ws-aff·link.coupang 0', () => {
    for (const p of pages) {
      const html = p.html.replace(WS_RE, '');
      const layer = p.route.layer?.kind;
      if (layer === 'L4' || layer === 'L7' || p.route.kind === 'SUPPLY_ITEM_TYPE') continue;
      expect(html, p.route.path).not.toContain('data-ws-aff');
      expect(html, p.route.path).not.toContain('link.coupang');
      expect(html, p.route.path).not.toContain('sponsored');
    }
  });

  it('ProductCard(상품 카드)에는 고지·제휴 링크 0', () => {
    let cards = 0;
    for (const p of pages) {
      for (const m of p.html.matchAll(/<li class="ws-product"[\s\S]*?<\/li>/g)) {
        cards++;
        expect(m[0]).not.toMatch(/data-ws-aff|link\.coupang|coupang\.com/);
      }
    }
    expect(cards).toBeGreaterThan(0);
  });

  it('ws-data: 제휴 페이지는 v3(aff), decode 하면 메모리 data 와 같다 · 제휴 없는 페이지는 v2', () => {
    let v3 = 0;
    for (const p of pages) {
      const wire = JSON.parse(WS_RE.exec(p.html)?.[1] ?? 'null') as Rec;
      const reqs = (wire.data as Rec).requirements as Rec[];
      const hasAff = reqs.some((r) => 'aff' in r);
      expect(wire.v, p.route.path).toBe(hasAff ? WS_WIRE_VERSION_AFF : WS_WIRE_VERSION);
      if (hasAff) v3++;
      expect(JSON.stringify(decodeWsPage(wire)), p.route.path).toBe(JSON.stringify(p.data));
    }
    expect(v3).toBeGreaterThan(0);
  });

  it('(e) on 빌드 ws-data ≤ 32KB 상한(28KB 경고선 초과 페이지 수 기록)', () => {
    const full = FULL.flatMap((p) => p.on.pages);
    const max = Math.max(...full.map((p) => p.wsDataBytes));
    expect(max).toBeLessThanOrEqual(WS_DATA_MAX_BYTES);
    const over = full.filter((p) => p.wsDataBytes > WS_DATA_WARN_BYTES).length;
    // 기록용(실패 아님) — 보고서에 옮긴다.
    console.log(`[259] on ws-data max ${max}B, >28KB ${over}쪽`);
  });
});

// R4-3(R4 시안 affiliate_candidates): 렌더 필터를 통과한 상인 링크(URL)가 0 → 정적 L4 검색 블록에 비활성 「상인 링크 준비 중」 1개, 고지·제휴 0.
//   엔진은 검색어가 있으면 링크 ≥ 1 이라 정상 빌드(기준선 3종)에는 이 상태가 없다 — 모델의 링크를 비워 직접 확인한다.
describe('R4-3 상인 링크 0 → 비활성 「준비 중」', () => {
  const m = projectSite(promotedTwo(), FIXTURE_AS_OF);
  const t = m.types[0];
  const r = t.requirements.find((x) => x.pub.searchKeyword.trim() !== '') as RequirementModel;

  it('전제: 정상 모델은 링크 ≥ 1 이고 비활성 버튼이 없다', () => {
    expect(r.pub.searchLinks.length).toBeGreaterThan(0);
    expect(layerL4(t, r)).not.toContain(COPY.supplyLayer.merchantPending);
  });

  it('링크 0(또는 허용 필터 밖 href 만) → 검색어 + disabled button 1, 상인 a·고지 0', () => {
    for (const links of [[], [{ provider: 'COUPANG' as const, kind: 'SEARCH' as const, href: 'https://evil.example/np/search?q=x' }]]) {
      const rr: RequirementModel = { ...r, pub: { ...r.pub, searchLinks: links } };
      const html = layerL4(t, rr);
      const block = /<div class="ws-search">[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
      expect(block).toContain(`<button type="button" disabled>${COPY.supplyLayer.merchantPending}</button>`);
      expect(block).toContain(r.pub.searchKeyword);
      expect(block).not.toMatch(/<a\s/);
      expect(html).not.toContain('data-ws-aff');
    }
  });

  it('검색어도 없으면 블록 없음(이전과 같음)', () => {
    const rr: RequirementModel = { ...r, pub: { ...r.pub, searchKeyword: '', searchLinks: [] } };
    expect(layerL4(t, rr)).not.toContain('class="ws-search"');
  });
});
