// 51 레인 T — 프리렌더 ↔ 하이드레이션 DOM 동등성(계획 _workspace/51_architect_persona_fix.md §3.1 테스트 전략 1).
//   서버 buildSite(승격 픽스처, 고정 asOf) 가 만든 body + ws-data 를 jsdom(390, desktop=false, 빈 localStorage)에 넣고
//   boot() 전/후 main 골격(skeleton)이 같아야 한다. 하이드레이션 순간 레이아웃이 바뀌지 않게(무JS 첫 화면 = React 첫 화면).
//
//   서버 모듈 import 예외(사유): 클라 규칙은 서버 파일을 @ws/* 별칭으로만 가져온다(.eslintrc no-restricted-imports, tsconfig paths).
//   프리렌더(site.ts)·픽스처는 node:fs/node:crypto 를 쓰는 빌드 타임 코드라 별칭 대상이 아니다. 이 테스트만 lazy import.meta.glob 으로
//   가져온다(번들에 들어가지 않음 — *.test.tsx, 클라 tsconfig 에 node 타입을 들이지 않음). 반환 타입은 아래 최소 인터페이스.
import { act, waitFor } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteKind } from '@ws/engine';
import { layerStore } from '../ui/layer/useLayer';
import { boot } from './boot';
import { readPageData } from './pageData';

interface BuiltPageLite {
  route: { path: string; kind: RouteKind };
  html: string;
}
interface SiteLite {
  pages: BuiltPageLite[];
}
type BuildSite = (seed: unknown, opts: Record<string, unknown>) => SiteLite;

// 리포 루트 — `new URL(템플릿, import.meta.url)` 은 쓰지 않는다: Vite 가 그 패턴을 자산 glob 으로 변환해 경로가
//   …/client/src/app/undefined 가 되고 loadMascots 가 조용히 빈 맵을 돌려준다(→ 정적 마스코트 img 누락이라는 가짜 차이).
//   그 변환의 부수 효과(glob 이 서버 파일을 모듈 그래프에 등록)에 기대 상대 동적 import 가 통과하던 것도 함께 걷어 낸다.
const REPO_ROOT = decodeURIComponent(import.meta.url)
  .replace(/^file:\/\//, '')
  .replace(/^\/(?=[A-Za-z]:)/, '')
  .replace(/\/client\/src\/app\/[^/]+$/, '');
const repoPath = (rel: string): string => `${REPO_ROOT}/${rel}`;

// 서버 모듈은 명시적 lazy import.meta.glob — Vite 가 정적으로 해석(fs.strict 통과)하고, tsc 는 대상 파일을 검사하지 않는다.
const SERVER_MODULES = import.meta.glob([
  '../../../server/src/prerender/site.ts',
  '../../../server/src/prerender/mascot.ts',
  '../../../server/src/__tests__/fixtures/prerender-seed.ts',
  '../../../server/src/__tests__/fixtures/affiliate/fake-map.ts',
]);
async function serverModule<T>(rel: string): Promise<T> {
  const load = SERVER_MODULES[`../../../server/src/${rel}`];
  if (!load) throw new Error(`server module not globbed: ${rel}`);
  return (await load()) as T;
}

const TEMPLATE = '<!doctype html><html><head><!--ws:head--></head><body><div id="root"><!--ws:body--></div></body></html>';

let site: SiteLite;
// 73 S5: 드워프 미리보기(PLANNED→ACTIVE 픽스처, 와이어 v2 최대 쪽 포함) — 같은 템플릿·마스코트, 고정 asOf.
let dwarfSite: SiteLite;
// R4-3: 제휴 켜짐(가짜 맵 — 검색어 전부 FAKE 코드) 골든 승격 빌드. 푸터 고지 F 프리렌더 ↔ React 일치용.
let affSite: SiteLite;

beforeAll(async () => {
  const siteMod = await serverModule<{ buildSite: BuildSite }>('prerender/site.ts');
  const mascotMod = await serverModule<{ loadMascots: (dir: string) => ReadonlyMap<string, string> }>('prerender/mascot.ts');
  const fx = await serverModule<{ promoted: () => unknown; dwarfPreview: () => unknown; FIXTURE_AS_OF: string; DWARF_PREVIEW_AS_OF: string }>('__tests__/fixtures/prerender-seed.ts');
  const mascots = mascotMod.loadMascots(repoPath('docs/design/mascots'));
  // 경로가 틀리면 loadMascots 는 예외 없이 빈 맵 — 하네스 결함을 제품 차이로 오인하지 않게 먼저 막는다.
  expect(mascots.has('group-small-mammal')).toBe(true);
  expect(mascots.has('hamster-golden')).toBe(true);
  site = siteMod.buildSite(fx.promoted(), {
    template: TEMPLATE,
    origin: 'http://localhost:3001',
    seedDigest: 'a'.repeat(64),
    asOf: fx.FIXTURE_AS_OF,
    mascots,
  });
  const fake = await serverModule<{
    buildKeywords: (seed: unknown, opts: Record<string, unknown>) => string[];
    fakeLinkMap: (kws: readonly string[]) => unknown;
  }>('__tests__/fixtures/affiliate/fake-map.ts');
  const affOpts = { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), asOf: fx.FIXTURE_AS_OF, mascots };
  affSite = siteMod.buildSite(fx.promoted(), { ...affOpts, affiliate: fake.fakeLinkMap(fake.buildKeywords(fx.promoted(), affOpts)) });
  dwarfSite = siteMod.buildSite(fx.dwarfPreview(), {
    template: TEMPLATE,
    origin: 'http://localhost:3001',
    seedDigest: 'a'.repeat(64),
    asOf: fx.DWARF_PREVIEW_AS_OF,
    mascots,
  });
}, 30_000);

// ---- 골격 ----
interface Skel {
  tag: string;
  cls?: string;
  id?: string;
  section?: string;
  action?: string;
  wsId?: string;
  text?: string;
  kids?: Skel[];
}
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'a', 'button']);
// 공백 전부 제거 — 정적 HTML 은 형제 사이 공백 텍스트 노드가, React 는 없을 수 있다(골격 비교에서 의미 없음).
const norm = (s: string | null): string => (s ?? '').replace(/\s+/g, '');

function skel(el: Element): Skel {
  const tag = el.tagName.toLowerCase();
  const out: Skel = { tag };
  const cls = Array.from(el.classList).sort().join(' ');
  if (cls) out.cls = cls;
  if (el.id) out.id = el.id;
  const sec = el.getAttribute('data-ws-section');
  if (sec !== null) out.section = sec;
  const act = el.getAttribute('data-ws-action');
  if (act !== null) out.action = act;
  const wid = el.getAttribute('data-ws-id');
  if (wid !== null) out.wsId = wid;
  if (TEXT_TAGS.has(tag)) out.text = norm(el.textContent);
  // svg 내부(마스코트 인라인 vs img)는 골격 밖 — 태그만.
  if (tag === 'svg') return out;
  const kids = Array.from(el.children).map(skel);
  if (kids.length) out.kids = kids;
  return out;
}

function mainEl(): Element {
  const mains = document.querySelectorAll('main');
  expect(mains).toHaveLength(1);
  return mains[0];
}

function classTokens(el: Element): Set<string> {
  const s = new Set<string>();
  for (const e of [el, ...Array.from(el.querySelectorAll('*'))]) for (const c of Array.from(e.classList)) s.add(c);
  return s;
}

const label = (s: Skel): string => `${s.tag}${s.cls ? `.${s.cls.replace(/ /g, '.')}` : ''}`;
const flat = (s: Skel): Omit<Skel, 'kids'> => {
  const { kids: _k, ...rest } = s;
  void _k;
  return rest;
};
/** 사람이 읽는 차이 목록(실패 메시지용). */
function diff(a: Skel | undefined, b: Skel | undefined, path: string, out: string[]): void {
  if (!a || !b) {
    out.push(`${path}: ${a ? `static-only ${JSON.stringify(flat(a))}` : `react-only ${JSON.stringify(flat(b as Skel))}`}`);
    return;
  }
  for (const k of ['tag', 'cls', 'id', 'section', 'action', 'wsId', 'text'] as const) {
    if (a[k] !== b[k]) out.push(`${path} .${k}: static=${JSON.stringify(a[k])} react=${JSON.stringify(b[k])}`);
  }
  const n = Math.max(a.kids?.length ?? 0, b.kids?.length ?? 0);
  for (let i = 0; i < n; i++) {
    const x = (a.kids?.[i] ?? b.kids?.[i]) as Skel;
    diff(a.kids?.[i], b.kids?.[i], `${path}>${label(x)}[${i}]`, out);
  }
}

// ---- 환경 ----
let root: Root | null = null;

function mockMedia(): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  localStorage.clear();
  layerStore.resetForTest();
  mockMedia();
  window.innerWidth = 390;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  act(() => layerStore.resetForTest());
  document.body.innerHTML = '';
  document.documentElement.style.overflow = '';
  vi.unstubAllGlobals();
});

function pageAt(path: string, from: SiteLite = site): BuiltPageLite {
  const p = from.pages.find((x) => x.route.path === path);
  if (!p) throw new Error(`no prerendered page ${path}`);
  return p;
}

function loadStatic(p: BuiltPageLite): void {
  const doc = new DOMParser().parseFromString(p.html, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  window.history.replaceState(null, '', p.route.path);
}

function hydrate(p: BuiltPageLite): void {
  act(() => {
    root = boot(document, { pathname: p.route.path });
  });
}

const CASES: Array<[RouteKind, string]> = [
  ['HOME', '/'],
  ['TYPE', '/hamster/golden'],
  ['SETUP', '/hamster/golden/setup'],
  ['PICK', '/pick'],
  ['NOT_FOUND', '/404'],
  // 94 FE-privacy: /privacy 는 StaticMain 이 프리렌더 main 을 그대로 유지(차이 0).
  ['PRIVACY', '/privacy'],
];

// ---- 허용 차이(레인 A 수용, _workspace/decisions.md 2026-10-13 레인 A 행) ----
//   정적(무JS)은 같은 자리에 같은 클래스의 링크/앵커를 두고, 하이드레이션 후 React 가 레이어를 여는 버튼으로 바꾼다.
//   같은 클래스라 크기·위치는 같다(태그만 다름). 여기 없는 차이는 전부 실패 — 새 항목은 결정 로그 근거가 있어야 추가한다.
interface Allowed {
  kinds: readonly RouteKind[];
  re: RegExp;
  why: string;
}
const ALLOWED: readonly Allowed[] = [
  {
    kinds: ['TYPE'],
    re: /^main>section\.ws-home-sec\.ws-now\[\d+\]>ul\.ws-now-grid\[\d+\]>li\.ws-now-lead\[\d+\]>a\.ws-btn\.ws-btn--fill\.ws-now-cta\[\d+\] \.tag: static="a" react="button"$/,
    why: '홈B ① 요약 카드 주 버튼(R4-2): 정적 a(첫 필수 항목 L4 문서) → React button(L2) — 같은 클래스·data-ws-action, 이전 ⑤ 저장 CTA a→button 허용과 같은 근거(decisions 2026-10-13 레인 A)',
  },
  {
    kinds: ['TYPE'],
    re: /^main>section\.ws-home-sec\.ws-products-sec\.ws-rail-section\.ws-rail-section--product\[\d+\]>ul\.ws-products\.ws-rail\[\d+\]>li\.ws-product\[\d+\]>span\.ws-like\[\d+\] \.(tag: static="span" react="button"|text: static=undefined react="♡")$/,
    why: '홈B 상품 카드 ♡(R4-2b 복원): 정적 span 자리표시(내부 span.ws-like-glyph 동일) → React button(D-38; .text 는 button 만 TEXT_TAGS 라 따라오는 차이) — decisions 2026-10-14, R4-2 에서 지웠던 항목을 새 섹션 경로로 되살림',
  },
];
const allowedHits = new Set<number>();
function unexplained(kind: RouteKind, d: readonly string[]): string[] {
  return d.filter((line) => {
    const i = ALLOWED.findIndex((a) => a.kinds.includes(kind) && a.re.test(line));
    if (i < 0) return true;
    allowedHits.add(i);
    return false;
  });
}

// 73 S5: 드워프 — 홈B·용품 레이어(L4)·규격 확인(L5)·상품(L7) 정적 경로(경로는 dwarfPreview 산출에서 확인).
const DWARF_CASES: Array<[RouteKind, string]> = [
  // 286 U3d: 홈 A 「지금 필요 없는 것도 알려 드려요」는 노출 NOT_NOW 가 있는 드워프 미리보기에서만 그려진다(골든 승격 픽스처엔 없음).
  ['HOME', '/'],
  ['TYPE', '/hamster/dwarf'],
  ['TYPE', '/hamster/dwarf/supplies/cage'],
  ['TYPE', '/hamster/dwarf/check/cage'],
  ['TYPE', '/hamster/dwarf/products/cp-dw-001'],
  ['TYPE', '/hamster/dwarf/supplies/sand-bath-box'],
];

describe('레인 T 프리렌더 ↔ 하이드레이션 main 골격', () => {
  it.each([
    ...CASES.map(([k, p]) => [k, p, 'promoted'] as const),
    ...DWARF_CASES.map(([k, p]) => [k, p, 'dwarf'] as const),
  ])('%s %s (%s): 골격 동일(허용 목록 외 차이 0)', (kind, path, which) => {
    const p = pageAt(path, which === 'dwarf' ? dwarfSite : site);
    expect(p.route.kind).toBe(kind);
    loadStatic(p);
    // 73 S3·S5: 프리렌더는 와이어 v2 를 싣고, 클라 디코드가 받아들인다(fail-closed 폴백으로 빠져 '같은 빈 골격'이 되는 위양성 차단).
    expect((JSON.parse(document.getElementById('ws-data')?.textContent ?? 'null') as { v?: unknown } | null)?.v).toBe(2);
    expect(readPageData(document)?.route.path).toBe(path);
    const before = skel(mainEl());
    const beforeTokens = classTokens(mainEl());
    hydrate(p);
    const after = skel(mainEl());
    const afterTokens = classTokens(mainEl());
    const d: string[] = [];
    diff(before, after, 'main', d);
    expect([...beforeTokens].filter((c) => !afterTokens.has(c))).toEqual([]);
    expect(unexplained(kind, d)).toEqual([]);
  });

  it('/privacy: 하이드레이션 후에도 프리렌더 본문(h1·표·절) 유지 — data-ws-static=main', () => {
    const p = pageAt('/privacy');
    loadStatic(p);
    hydrate(p);
    const m = mainEl();
    expect(m.getAttribute('data-ws-route')).toBe('PRIVACY');
    expect(m.closest('[data-ws-static="main"]')).not.toBeNull();
    expect(m.querySelector('h1')?.textContent).toBe('개인정보 처리방침');
    expect(m.querySelectorAll('section.ws-privacy-section').length).toBeGreaterThan(5);
    expect(m.querySelectorAll('table.ws-privacy-table').length).toBeGreaterThan(0);
  });

  // 94 FE-privacy: 푸터(크레딧·처리방침 링크 순서·마크업)는 서버 renderFooter 와 하이드레이션 후 같다 — 텍스트·href 까지.
  it.each(CASES)('푸터 %s %s: 프리렌더 ↔ React footer 동일', (_kind, path) => {
    const p = pageAt(path);
    loadStatic(p);
    const footerOf = (): { skel: Skel; hrefs: string[]; texts: string[] } => {
      const fs = document.querySelectorAll('footer.ws-footer');
      expect(fs).toHaveLength(1);
      const f = fs[0];
      return {
        skel: skel(f),
        hrefs: Array.from(f.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? ''),
        texts: Array.from(f.querySelectorAll('p')).map((x) => norm(x.textContent)),
      };
    };
    const before = footerOf();
    expect(before.hrefs).toEqual(['/privacy', '/credits']);
    hydrate(p);
    const after = footerOf();
    const d: string[] = [];
    diff(before.skel, after.skel, 'footer', d);
    expect(d).toEqual([]);
    expect(after.hrefs).toEqual(before.hrefs);
    expect(after.texts).toEqual(before.texts);
  });

  // U2b: 헤더(로고·메뉴 단추·메뉴 3·칩)는 서버 renderHeader 와 하이드레이션 후 같다(빈 저장소) — 골격·href·속성(aria-controls/expanded·current).
  //   탭바는 어디에도 없다(D2). 드워프 L5 딥링크(요구사항 1개짜리 문서 아님 — 크기 확인 대상 계산 경로 확인용)도 같이 본다.
  it.each([...CASES.map((c) => [c[0], c[1], 'golden'] as const), ['TYPE', '/hamster/dwarf/supplies/cage', 'dwarf'] as const])(
    '헤더 %s %s: 프리렌더 ↔ React header 동일, 탭바 0',
    (_kind, path, which) => {
      const p = pageAt(path, which === 'dwarf' ? dwarfSite : site);
      loadStatic(p);
      const headerOf = () => {
        const hs = document.querySelectorAll('header.ws-header');
        expect(hs).toHaveLength(1);
        const h = hs[0];
        const btn = h.querySelector('button.ws-menu-btn');
        return {
          skel: skel(h),
          links: Array.from(h.querySelectorAll('a')).map((a) => [a.getAttribute('href'), a.getAttribute('aria-current'), norm(a.textContent)]),
          btn: [btn?.getAttribute('aria-expanded'), btn?.getAttribute('aria-controls'), btn?.getAttribute('type')],
          nav: [h.querySelector('nav')?.id, h.querySelector('nav')?.getAttribute('aria-label')],
        };
      };
      const before = headerOf();
      expect(before.btn).toEqual(['false', 'ws-nav', 'button']);
      expect(document.querySelector('.ws-tabbar, .ws-tab')).toBeNull();
      hydrate(p);
      const after = headerOf();
      const d: string[] = [];
      diff(before.skel, after.skel, 'header', d);
      expect(d).toEqual([]);
      expect(after.links).toEqual(before.links);
      expect(after.btn).toEqual(before.btn);
      expect(after.nav).toEqual(before.nav);
      expect(document.querySelector('.ws-tabbar, .ws-tab')).toBeNull();
    },
  );

  // 114 FE-gp-schema(기니피그 S5, 계획 107): L5 폼 필드 목록·'· 선택' 표시가 프리렌더 = 하이드레이션 후(visibleSpecFields·isFieldOptionalForDisplay 공용).
  //   React 는 숫자 칸을 먼저 묶어 그리므로(SpecForm) 순서가 아닌 키 집합 + 키별 '선택' 표시로 비교한다.
  //   ruleScoped 6개(floorType·dustFree·forSpecies·baseType·vitaminC·entrances)는 골든·드워프 규칙이 참조하지 않아 양쪽 모두 미노출.
  const RULE_SCOPED_NEW = ['floorType', 'dustFree', 'forSpecies', 'baseType', 'vitaminC', 'entrances', 'coversThisAnimal'];
  type FieldMark = [key: string, optional: boolean];
  const sortMarks = (m: FieldMark[]): FieldMark[] => [...m].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  function staticL5(): FieldMark[] {
    const form = document.querySelector('aside[data-ws-layer="L5"] form.ws-check');
    expect(form).not.toBeNull();
    return Array.from((form as Element).querySelectorAll('div.ws-field')).map((d) => {
      const named = d.querySelector('[name]');
      expect(named).not.toBeNull();
      return [(named as Element).getAttribute('name') ?? '', d.querySelector('.ws-optional') !== null];
    });
  }
  function reactL5(): FieldMark[] {
    const forms = document.querySelectorAll('[data-ws-spec-form]');
    expect(forms).toHaveLength(1);
    return Array.from(forms[0].querySelectorAll('[data-ws-field]')).map((el) => [el.getAttribute('data-ws-field') ?? '', el.querySelector('.ws-spec-optional') !== null]);
  }
  const l5Paths = (from: SiteLite, prefix: string): string[] =>
    from.pages.map((p) => p.route.path).filter((x) => x.startsWith(`${prefix}/check/`));

  it('L5 대상 경로가 있다(골든·드워프 — 0개면 아래 패리티가 공회전)', () => {
    // 승격 픽스처(골든)는 cage·wheel 만 노출, 드워프 미리보기는 전 요구사항(cage·bedding·food·hideout 포함 — ruleScoped 6개 전부 스키마에 있음).
    expect(l5Paths(site, '/hamster/golden')).toEqual(expect.arrayContaining(['/hamster/golden/check/cage', '/hamster/golden/check/wheel']));
    expect(l5Paths(dwarfSite, '/hamster/dwarf')).toEqual(
      expect.arrayContaining(['/hamster/dwarf/check/cage', '/hamster/dwarf/check/bedding', '/hamster/dwarf/check/food', '/hamster/dwarf/check/hideout']),
    );
  });

  it.each([
    ['promoted', '/hamster/golden', ['floorType']],
    ['dwarf', '/hamster/dwarf', RULE_SCOPED_NEW],
  ] as const)('L5 폼 필드·선택 표시: 프리렌더 = 하이드레이션 후 (%s %s 의 모든 /check/*)', (which, prefix, scopedInSchemas) => {
    const from = which === 'dwarf' ? dwarfSite : site;
    const paths = l5Paths(from, prefix);
    let total = 0;
    const scopedSeen = new Set<string>(); // 숨김 단언이 공회전하지 않게 — 실제 스키마에 ruleScoped 로 있는 키
    for (const path of paths) {
      const p = pageAt(path, from);
      loadStatic(p);
      const itemId = path.slice(path.lastIndexOf('/') + 1);
      const req = readPageData(document)?.data.requirements.find((r) => r.supplyItemId === itemId);
      expect(req).toBeDefined();
      for (const f of req?.item.specSchema.fields ?? []) if (f.ruleScoped === true) scopedSeen.add(f.key);
      const before = staticL5();
      hydrate(p);
      const after = reactL5();
      expect({ path, fields: sortMarks(after) }).toEqual({ path, fields: sortMarks(before) });
      for (const k of RULE_SCOPED_NEW) expect({ path, shown: before.some(([x]) => x === k) }).toEqual({ path, shown: false });
      total += before.length;
      act(() => root?.unmount());
      root = null;
      act(() => layerStore.resetForTest());
      document.body.innerHTML = '';
    }
    expect(total).toBeGreaterThan(0);
    expect([...scopedInSchemas].filter((k) => !scopedSeen.has(k))).toEqual([]);
  });

  // 허용 목록이 썩지 않게 — 위 케이스들이 먼저 돈다(파일 내 순차). 더 이상 나타나지 않는 항목은 지운다.
  it('허용 목록 항목은 모두 실제로 쓰인다', () => {
    expect(ALLOWED.filter((_, i) => !allowedHits.has(i)).map((a) => a.why)).toEqual([]);
  });
});

// R4-3(R4 시안 affiliate_candidates): 제휴 켜짐 빌드 — 푸터 고지 F 는 「지금 화면에 제휴 링크가 그려질 때만」(프리렌더 renderFooter(affOn)
//   · React Footer affNote = layerAffiliateOn). 타입 딥링크(L4·L7)는 하이드레이션 전후 푸터가 같다. 레이어 없는 문서는 양쪽 다 0.
//   /supplies/{item}/{type}(SUPPLY_ITEM_TYPE): 기존 동작상 하이드레이션 뒤 정적 L4 aside 가 걷히고 React 레이어를 열지 않는다(deepLinkFor = TYPE 만)
//   — 제휴 링크가 화면에서 사라지므로 고지 F 도 0(링크 없는 화면에 고지 없음). 그 밖 푸터는 같다.
describe('R4-3 제휴 on 빌드 — 푸터 고지 F 프리렌더 ↔ React', () => {
  const footerState = () => {
    const fs = document.querySelectorAll('footer.ws-footer');
    expect(fs).toHaveLength(1);
    const f = fs[0];
    const notes = Array.from(f.querySelectorAll('[data-ws-aff="note-f"]'));
    const texts = Array.from(f.querySelectorAll('p')).filter((x) => !notes.includes(x)).map((x) => norm(x.textContent));
    return { notes: notes.length, noteText: notes.map((x) => x.textContent), texts, affLinks: document.querySelectorAll('a[href^="https://link.coupang.com/a/"]').length };
  };

  it('고지 F 개수 = 화면에 제휴 링크가 있는가(하이드레이션 전후), 타입 딥링크 L4·L7 은 전후 동일', async () => {
    const withF = affSite.pages.filter((p) => p.html.includes('data-ws-aff="note-f"'));
    const kinds = new Set(withF.map((p) => (p.route.kind === 'SUPPLY_ITEM_TYPE' ? 'SIT' : /\/products\//.test(p.route.path) ? 'L7' : 'L4')));
    expect([...kinds].sort()).toEqual(['L4', 'L7', 'SIT']);
    const cases: Array<[BuiltPageLite | undefined, 'deep' | 'sit' | 'plain' | 'l5']> = [
      [withF.find((p) => p.route.kind === 'TYPE' && /\/supplies\//.test(p.route.path)), 'deep'],
      [withF.find((p) => /\/products\//.test(p.route.path)), 'deep'],
      [withF.find((p) => p.route.kind === 'SUPPLY_ITEM_TYPE'), 'sit'],
      [pageAt('/', affSite), 'plain'],
      [pageAt('/hamster/golden', affSite), 'plain'],
      [pageAt('/hamster/golden/check/wheel', affSite), 'l5'],
    ];
    for (const [p, mode] of cases) {
      expect(p).toBeDefined();
      if (!p) continue;
      loadStatic(p);
      const before = footerState();
      expect({ path: p.route.path, notes: before.notes }).toEqual({ path: p.route.path, notes: before.affLinks > 0 ? 1 : 0 });
      hydrate(p);
      // 딥링크 문서는 첫 커밋이 레이어 청크를 기다린다 — 레이어가 store 에 열리고(React 렌더 뒤) 내용이 그려질 때까지.
      if (mode === 'deep') await waitFor(() => expect(footerState().affLinks).toBeGreaterThan(0), { timeout: 15000 });
      if (mode === 'l5') await waitFor(() => expect(layerStore.get()).not.toBeNull(), { timeout: 15000 });
      const after = footerState();
      expect({ path: p.route.path, notes: after.notes }).toEqual({ path: p.route.path, notes: after.affLinks > 0 ? 1 : 0 });
      expect(after.texts).toEqual(before.texts);
      for (const t of [...before.noteText, ...after.noteText]) expect(t).toBe('이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.');
      if (mode === 'deep') expect({ path: p.route.path, notes: after.notes }).toEqual({ path: p.route.path, notes: 1 });
      if (mode === 'sit') expect({ path: p.route.path, notes: after.notes, affLinks: after.affLinks }).toEqual({ path: p.route.path, notes: 0, affLinks: 0 });
      if (mode === 'plain' || mode === 'l5') expect({ path: p.route.path, notes: after.notes }).toEqual({ path: p.route.path, notes: 0 });
      act(() => root?.unmount());
      root = null;
      act(() => layerStore.resetForTest());
      document.body.innerHTML = '';
    }
  }, 60_000);
});
