// 51 레인 T — 프리렌더 ↔ 하이드레이션 DOM 동등성(계획 _workspace/51_architect_persona_fix.md §3.1 테스트 전략 1).
//   서버 buildSite(승격 픽스처, 고정 asOf) 가 만든 body + ws-data 를 jsdom(390, desktop=false, 빈 localStorage)에 넣고
//   boot() 전/후 main 골격(skeleton)이 같아야 한다. 하이드레이션 순간 레이아웃이 바뀌지 않게(무JS 첫 화면 = React 첫 화면).
//
//   서버 모듈 import 예외(사유): 클라 규칙은 서버 파일을 @ws/* 별칭으로만 가져온다(.eslintrc no-restricted-imports, tsconfig paths).
//   프리렌더(site.ts)·픽스처는 node:fs/node:crypto 를 쓰는 빌드 타임 코드라 별칭 대상이 아니다. 이 테스트만 lazy import.meta.glob 으로
//   가져온다(번들에 들어가지 않음 — *.test.tsx, 클라 tsconfig 에 node 타입을 들이지 않음). 반환 타입은 아래 최소 인터페이스.
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@ws/copy';
import type { RouteKind } from '@ws/engine';
import { resetFeedCacheForTest } from '../supply/feedBlock';
import { layerStore, readLayerState } from '../ui/layer/useLayer';
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
  '../../../server/src/prerender/privacy-content.ts',
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
// 294: 운영 빌드 + 처리방침 자리표시 남음 → /privacy 비노출 빌드(#root data-ws-privacy="off"). 푸터 처리방침 링크 0 프리렌더 ↔ React.
let hiddenSite: SiteLite;
// 305: 팁 ≥ 1 승격 빌드(시험 픽스처 팁 — 실제 seed 파일 무관). /hamster/golden/tips 프리렌더 ↔ React.
let tipsSite: SiteLite;
// 308: 실시드 budget-tips 가 5행이 되어 승격 픽스처 기본(site)에도 팁이 있다 — 팁 0건 경로는 budgetTips [] 로 따로 만든다.
let noTipsSite: SiteLite;

// 팁 픽스처(사육 사실 아님 — 시험 고정값). 서버 prerender.tips.test.ts tip() 과 같은 모양. checkedAt 은 FIXTURE_AS_OF(2026-11-16) 기준 180일 안.
const TIP_REF = { title: '시험 글 제목', url: 'https://brunch.co.kr/@tester/123', siteName: '예시 블로그', checkedAt: '2026-11-10' };
// 총괄 ORDERS 11/22 18:4x: 팁은 요약 원문 대조 기록(summaryCheck)이 있어야 노출 — 시험용 기록을 채운다(사육 사실 아님).
//   sources = 이 행 references[].url 전부 · checkedAt = 참조 확인일 중 가장 늦은 날. p 에 summaryCheck 키가 있으면 그대로.
function tipFixture(p: Record<string, unknown> = {}): Record<string, unknown> {
  const t = tipFixtureBase(p);
  if (Object.hasOwn(p, 'summaryCheck')) return t;
  const refs = t.references as Array<{ url: string; checkedAt: string }>;
  return { ...t, summaryCheck: { sources: [...new Set(refs.map((r) => r.url))], checkedAt: refs.map((r) => r.checkedAt).sort().at(-1), checkedBy: '시험 운영자' } };
}
function tipFixtureBase(p: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'tip-fe-cage',
    kind: 'REFERENCE',
    careProfileId: 'cp-hamster-syrian',
    supplyItemId: 'cage',
    substitute: '시험 대체물',
    sourceHint: 'LIVING_GOODS_STORE',
    materials: ['시험 물품'],
    steps: ['시험 단계 하나', '시험 단계 둘'],
    dimensions: ['시험 치수 줄'],
    cautions: ['시험 주의'],
    hazards: [],
    mustCheck: ['시험 확인'],
    references: [TIP_REF],
    reviewStatus: 'DRAFT',
    reviewerType: 'AI_DRAFT',
    verifiedBy: null,
    verifiedAt: null,
    reviewBasis: null,
    contentKind: 'CARE',
    source: [],
    ...p,
  };
}

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
  const privacyMod = await serverModule<{ PRIVACY_POLICY: Record<string, unknown> }>('prerender/privacy-content.ts');
  hiddenSite = siteMod.buildSite(fx.promoted(), {
    template: TEMPLATE,
    origin: 'https://withsmall.example',
    seedDigest: 'a'.repeat(64),
    asOf: fx.FIXTURE_AS_OF,
    mascots,
    production: true,
    // 지금 본문이 채워진 뒤에도 자리표시 경로를 보도록 시행일 자리를 자리표시로 둔다(시험 안에서만).
    privacyPolicy: { ...privacyMod.PRIVACY_POLICY, effectiveDate: ['{{KEN', 'NY:effectiveDate}}'].join('') },
  });
  noTipsSite = siteMod.buildSite({ ...(fx.promoted() as Record<string, unknown>), budgetTips: [] }, { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), asOf: fx.FIXTURE_AS_OF, mascots });
  tipsSite = siteMod.buildSite(
    {
      ...(fx.promoted() as Record<string, unknown>),
      budgetTips: [
        tipFixture(),
        // 치수 없음 + 참조 2개(원문 링크 2줄, 도메인 2곳) — 파트 생략 경로 + 308 위험 태그 고정 주의 상자(하이드레이션 차이 0)
        tipFixture({ id: 'tip-fe-cage-2', substitute: '시험 대체물 둘', dimensions: [], hazards: ['VENTILATION'], references: [TIP_REF, { ...TIP_REF, url: 'https://namu.wiki/w/test-7', siteName: '다른 블로그' }] }),
        // 승격 픽스처에서 hideout 요구사항은 비노출 → 이 팁도 비노출(섹션 생략)
        tipFixture({ id: 'tip-fe-hide', supplyItemId: 'hideout', substitute: '시험 은신처' }),
      ],
    },
    { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), asOf: fx.FIXTURE_AS_OF, mascots },
  );
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
//   /supplies/{item}/{type}(SUPPLY_ITEM_TYPE): 383 — PRD 183-187(US-008 「선택 → US-007과 같은 상세」, URL /supplies/{item}/{type})에 따라
//   하이드레이션 뒤에도 같은 L4 를 연다 → 타입 딥링크처럼 제휴 링크·고지 F 가 남는다. 이전 sit 단언(하이드레이션 뒤 링크 0·고지 0)은
//   요구와 어긋난 옛 동작을 고정한 것이라 바꿨다(379 §3).
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
      // 383(PRD 183-187): 정적 aside 가 걷힌 뒤 React L4 의 링크를 본다(정적 링크로 통과하지 않게).
      if (mode === 'sit')
        await waitFor(() => expect([document.querySelector('aside.ws-layer'), document.querySelectorAll('[role="dialog"] a[href^="https://link.coupang.com/a/"]').length > 0]).toEqual([null, true]), { timeout: 15000 });
      if (mode === 'l5') await waitFor(() => expect(layerStore.get()).not.toBeNull(), { timeout: 15000 });
      const after = footerState();
      expect({ path: p.route.path, notes: after.notes }).toEqual({ path: p.route.path, notes: after.affLinks > 0 ? 1 : 0 });
      expect(after.texts).toEqual(before.texts);
      for (const t of [...before.noteText, ...after.noteText]) expect(t).toBe('이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.');
      if (mode === 'deep') expect({ path: p.route.path, notes: after.notes }).toEqual({ path: p.route.path, notes: 1 });
      if (mode === 'sit') expect({ path: p.route.path, notes: after.notes, affLinks: after.affLinks }).toEqual({ path: p.route.path, notes: 1, affLinks: before.affLinks });
      if (mode === 'plain' || mode === 'l5') expect({ path: p.route.path, notes: after.notes }).toEqual({ path: p.route.path, notes: 0 });
      act(() => root?.unmount());
      root = null;
      act(() => layerStore.resetForTest());
      document.body.innerHTML = '';
    }
  }, 60_000);
});

// 294(Kenny 2026-11-16): /privacy 비노출 빌드 — 프리렌더 푸터에 처리방침 링크 0, React 푸터도 0(#root data-ws-privacy="off" 를 읽는다).
//   골격·텍스트·href 는 하이드레이션 전후 같다. /privacy 문서 자체가 없다.
describe('294 /privacy 비노출 빌드 — 푸터 프리렌더 ↔ React', () => {
  it('/privacy 페이지 없음', () => {
    expect(hiddenSite.pages.some((p) => p.route.path === '/privacy' || p.route.kind === 'PRIVACY')).toBe(false);
  });

  it.each(CASES.filter(([kind]) => kind !== 'PRIVACY'))('푸터 %s %s: 처리방침 링크 0, 프리렌더 ↔ React 동일', (_kind, path) => {
    const p = pageAt(path, hiddenSite);
    loadStatic(p);
    expect(document.getElementById('root')?.getAttribute('data-ws-privacy')).toBe('off');
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
    expect(before.hrefs).toEqual(['/credits']);
    hydrate(p);
    const after = footerOf();
    const d: string[] = [];
    diff(before.skel, after.skel, 'footer', d);
    expect(d).toEqual([]);
    expect(after.hrefs).toEqual(['/credits']);
    expect(after.texts).toEqual(before.texts);
    expect(document.querySelector('a[href="/privacy"]')).toBeNull();
  });
});

// 305(계획 300 단계 10): /{slug}/tips — 프리렌더 main 을 StaticMain 이 그대로 유지(하이드레이션 차이 0), 헤더·푸터도 같다.
//   팁 0건이면 라우트 자체가 없다(308: 실시드 budget-tips 5행 → 팁 0건 빌드는 noTipsSite = budgetTips []).
describe('305 /{slug}/tips — 프리렌더 ↔ 하이드레이션', () => {
  const TIPS_PATH = '/hamster/golden/tips';

  it('팁 0건 빌드(budgetTips [])엔 TIPS 라우트·/tips 링크 0', () => {
    expect(noTipsSite.pages.some((p) => p.route.kind === 'TIPS')).toBe(false);
    for (const p of noTipsSite.pages) expect({ path: p.route.path, tips: p.html.includes('/tips') }).toEqual({ path: p.route.path, tips: false });
  });

  it('팁 ≥ 1 빌드엔 TIPS 라우트 1개(골든), 노출 불가 팁(hideout) 0', () => {
    expect(tipsSite.pages.filter((p) => p.route.kind === 'TIPS').map((p) => p.route.path)).toEqual([TIPS_PATH]);
    const html = pageAt(TIPS_PATH, tipsSite).html;
    expect(html).toContain('data-ws-id="budgetTips#tip-fe-cage"');
    expect(html).toContain('data-ws-id="budgetTips#tip-fe-cage-2"');
    expect(html).not.toContain('tip-fe-hide');
  });

  it('main 골격·클래스·텍스트 동일(허용 차이 없음), data-ws-static=main, 외부 링크 rel/target 유지', () => {
    const p = pageAt(TIPS_PATH, tipsSite);
    expect(p.route.kind).toBe('TIPS');
    loadStatic(p);
    expect((JSON.parse(document.getElementById('ws-data')?.textContent ?? 'null') as { v?: unknown } | null)?.v).toBe(2);
    expect(readPageData(document)?.route.kind).toBe('TIPS');
    const externals = (): string[][] =>
      Array.from(mainEl().querySelectorAll('a[href^="http"]')).map((a) => [a.getAttribute('href') ?? '', a.getAttribute('target') ?? '', a.getAttribute('rel') ?? '', a.className]);
    const before = skel(mainEl());
    const beforeHtml = mainEl().outerHTML;
    const beforeExt = externals();
    expect(beforeExt).toHaveLength(3);
    for (const [, target, rel, cls] of beforeExt) expect([target, rel, cls]).toEqual(['_blank', 'noopener noreferrer nofollow ugc', 'ws-tip-source']);
    hydrate(p);
    const m = mainEl();
    expect(m.getAttribute('data-ws-route')).toBe('TIPS');
    expect(m.closest('[data-ws-static="main"]')).not.toBeNull();
    const d: string[] = [];
    diff(before, skel(m), 'main', d);
    expect(d).toEqual([]);
    expect(m.outerHTML).toBe(beforeHtml);
    expect(externals()).toEqual(beforeExt);
    // 이미지·스크립트·iframe 외부 로드 0, 판정 글리프·검수 표기 0
    expect(document.querySelector('main img, main iframe, main script')).toBeNull();
    // 308 총괄 ②(310 LOW-1 문구): 위험 태그 상자 라벨 「수의사가 확인하지 않은 참고 정보」 만 허용(고정 문구 1회) — 그 밖의 검수 표기 0.
    expect(m.querySelectorAll('.ws-tip-hazard [data-ws-hazard="VENTILATION"]')).toHaveLength(1);
    expect(Array.from(m.querySelectorAll('.ws-tip-hazard-label')).map((e) => e.textContent)).toEqual(['수의사가 확인하지 않은 참고 정보']);
    expect((m.textContent ?? '').replace('수의사가 확인하지 않은 참고 정보', '')).not.toMatch(/검수|확인됨/);
  });

  it('헤더(칩=골든, 메뉴 활성 0)·푸터(제휴 고지 0) 프리렌더 ↔ React 동일', () => {
    const p = pageAt(TIPS_PATH, tipsSite);
    loadStatic(p);
    const chrome = () => {
      const h = document.querySelector('header.ws-header') as Element;
      const f = document.querySelector('footer.ws-footer') as Element;
      return {
        header: skel(h),
        links: Array.from(h.querySelectorAll('a')).map((a) => [a.getAttribute('href'), a.getAttribute('aria-current'), norm(a.textContent)]),
        footer: skel(f),
        footerHrefs: Array.from(f.querySelectorAll('a')).map((a) => a.getAttribute('href')),
        notes: f.querySelectorAll('[data-ws-aff="note-f"]').length,
      };
    };
    const before = chrome();
    expect(before.links.some(([, cur]) => cur === 'page')).toBe(false);
    expect(before.notes).toBe(0);
    hydrate(p);
    const after = chrome();
    const d: string[] = [];
    diff(before.header, after.header, 'header', d);
    diff(before.footer, after.footer, 'footer', d);
    expect(d).toEqual([]);
    expect(after.links).toEqual(before.links);
    expect(after.footerHrefs).toEqual(before.footerHrefs);
    expect(after.notes).toBe(0);
  });

  it('진입 링크 /setup → /tips 도 하이드레이션 후 유지', () => {
    const p = pageAt('/hamster/golden/setup', tipsSite);
    loadStatic(p);
    expect(mainEl().querySelector('.ws-tips-entry a')?.getAttribute('href')).toBe(TIPS_PATH);
    const before = skel(mainEl());
    hydrate(p);
    const d: string[] = [];
    diff(before, skel(mainEl()), 'main', d);
    expect(d).toEqual([]);
    expect(mainEl().querySelector('.ws-tips-entry a')?.getAttribute('href')).toBe(TIPS_PATH);
  });

  // 311 S-3: /supplies/{item}/{type} — 진입 링크는 본문 ul.ws-tips-entries 1개(정적 L4 aside 안 0) → JS 켬/끔 같은 수·같은 자리.
  it('진입 링크 /supplies/cage/hamster-golden: 하이드레이션 전후 1개·본문 같은 자리, 정적 레이어 안 0', () => {
    const p = pageAt('/supplies/cage/hamster-golden', tipsSite);
    loadStatic(p);
    const entries = (): string[] =>
      Array.from(document.querySelectorAll(`a[href^="${TIPS_PATH}"]`)).map((a) => `${a.closest('main ul.ws-tips-entries') ? 'main' : 'other'}|${a.getAttribute('href') ?? ''}`);
    const before = entries();
    expect(before).toEqual([`main|${TIPS_PATH}#ws-tips-cage`]);
    expect(document.querySelector('aside.ws-layer')).not.toBeNull();
    expect(document.querySelector('aside.ws-layer .ws-tips-entry, aside.ws-layer a[href^="/hamster/golden/tips"]')).toBeNull();
    const beforeSkel = skel(mainEl());
    hydrate(p);
    const d: string[] = [];
    diff(beforeSkel, skel(mainEl()), 'main', d);
    expect(d).toEqual([]);
    expect(entries()).toEqual(before);
  });
});

// 359 T18(감사 356r M2): 사진 자리 — 실시드 사본에서 장면 행을 READY(생성 이미지, 시험 안에서만 — 자산 파일·시드 변경 0)로 바꿔
//   프리렌더(server photoTile) ↔ 하이드레이션 뒤(PhotoTile) 사진 자리 마크업이 같다(태그·클래스·src·data-ws-photo·표기 수).
//   ph-01(habitat·startSetup)·ph-08(spec·cage·startSpecCheck)·ph-02(explainFigures) 는 골든(장면 허용 종)에만 실린다(D-1 A).
describe('359 T18 사진 자리 — 프리렌더 ↔ 하이드레이션', () => {
  let photoSite: SiteLite;
  beforeAll(async () => {
    const siteMod = await serverModule<{ buildSite: BuildSite }>('prerender/site.ts');
    const mascotMod = await serverModule<{ loadMascots: (dir: string) => ReadonlyMap<string, string> }>('prerender/mascot.ts');
    const fx = await serverModule<{ realSeed: () => Record<string, unknown>; FIXTURE_AS_OF: string }>('__tests__/fixtures/prerender-seed.ts');
    const seed = fx.realSeed();
    for (const id of ['ph-01', 'ph-08', 'ph-02']) {
      const row = (seed.photos as Array<Record<string, unknown>>).find((r) => r.id === id);
      if (!row) throw new Error(`photo ${id} 없음`);
      // server prerender.photo.test.ts readyAi 와 같은 형식(사용권·종 확인을 갖춘 사용 가능 AI 행 — 시험 고정값)
      Object.assign(row, {
        status: 'READY', license: 'AI_GENERATED', source: 'CODEX', sourceUrl: null, licenseUrl: null, author: null, downloadedAt: null,
        modified: false, generatedAt: '2026-11-20', promptPath: `docs/assets/prompts/${String(row.slot)}.md`, asset: `/assets/photos/${String(row.slot)}.webp`,
        speciesCheck: { checkedBy: '시험 운영자', checkedAt: '2026-11-21' },
      });
    }
    photoSite = siteMod.buildSite(seed, { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), asOf: fx.FIXTURE_AS_OF, mascots: mascotMod.loadMascots(repoPath('docs/design/mascots')) });
  }, 30_000);

  const photoSlots = (): string[] =>
    Array.from(document.querySelectorAll('main .ws-photo, main .ws-photo-frame')).map((el) =>
      [el.tagName, el.className, el.getAttribute('src') ?? '', el.getAttribute('data-ws-photo') ?? '', el.getAttribute('aria-hidden') ?? '', el.querySelectorAll('.ws-photo-notice').length].join('|'),
    );

  it.each(['/', '/hamster/golden', '/parrot/budgie'])('%s: 사진 자리 프리렌더 = 하이드레이션 뒤, 골든 외 종 페이지엔 장면 id 0', (path) => {
    const p = pageAt(path, photoSite);
    loadStatic(p);
    const before = photoSlots();
    expect(before.length).toBeGreaterThan(0);
    if (path === '/parrot/budgie') expect(before.join('\n')).not.toMatch(/ph-\d\d\b/);
    else expect(before.some((x) => x.startsWith('IMG|') || x.startsWith('SPAN|ws-photo-frame'))).toBe(true);
    hydrate(p);
    expect(photoSlots()).toEqual(before);
    if (path === '/parrot/budgie') expect(mainEl().innerHTML).not.toMatch(/ph-\d\d\b/);
  });
});

// 362 N10: 피드 켜짐 빌드(승격 픽스처 + 합성 피드 행 — 실호출·키 0). 변형 문서(index.feed[-noprice].html) 프리렌더 ↔ 하이드레이션.
//   홈 B 레일: main 골격 동일(허용 목록 외 차이 0). L4 딥링크: 피드 블록 골격 동일(같은 오리진 JSON 은 site.files 에서 모의 fetch).
//   noprice: 하이드레이션 전후 가격·확인일이 어떤 표기로도 0.
describe('362 N10 피드 변형 — 프리렌더 ↔ 하이드레이션', () => {
  interface FeedSiteLite extends SiteLite {
    files: Map<string, string>;
    feedPages: Array<BuiltPageLite & { stage: 'full' | 'noprice'; file: string }>;
  }
  let full: FeedSiteLite;
  let late: FeedSiteLite;
  const GEN = '2026-11-23T09:12:00+09:00';
  const GEN_MS = Date.UTC(2026, 10, 23, 0, 12, 0);
  const H = 3_600_000;
  const PRICE_OR_DATE = /\d[\d,]*\s*원|₩|￦|KRW|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}|12,?900/i;

  beforeAll(async () => {
    const siteMod = await serverModule<{ buildSite: (seed: unknown, opts: Record<string, unknown>) => FeedSiteLite }>('prerender/site.ts');
    const mascotMod = await serverModule<{ loadMascots: (dir: string) => ReadonlyMap<string, string> }>('prerender/mascot.ts');
    const fx = await serverModule<{ promoted: () => unknown; FIXTURE_AS_OF: string }>('__tests__/fixtures/prerender-seed.ts');
    const eng = await import('@ws/engine');
    const seed = fx.promoted() as Parameters<typeof eng.createCatalog>[0] & { animalTypes: Array<{ id: string }> };
    const cat = eng.createCatalog(seed);
    const at = seed.animalTypes.find((a) => a.id === 'hamster-golden') as Parameters<typeof eng.buildSearchKeyword>[0];
    let seq = 0;
    const row = (i: string, title: string) => {
      const r = eng.resolveRequirement(cat, 'hamster-golden', i);
      if (!r) throw new Error(`no requirement ${i}`);
      seq += 1;
      return {
        provider: 'COUPANG',
        animalTypeId: 'hamster-golden',
        supplyItemId: i,
        keyword: eng.buildSearchKeyword(at, r),
        rank: seq,
        title,
        url: `https://link.coupang.com/a/Mk${seq}x`,
        imageUrl: null,
        price: { amount: 12900, currency: 'KRW' },
        fetchedAt: GEN,
      };
    };
    const rows = [row('wheel', '햄스터 쳇바퀴 30cm 통면 1호'), row('wheel', '햄스터 쳇바퀴 30cm 통면 2호')];
    const base = { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), asOf: fx.FIXTURE_AS_OF, mascots: mascotMod.loadMascots(repoPath('docs/design/mascots')) };
    // 제목 금지어 판정은 서버 lintText 몫 — 합성 제목은 금지어 0 이라 여기선 항상 통과로 둔다.
    const productFeed = (buildAtMs: number) => ({ rows, generatedAt: GEN, buildAtMs, isTitleBanned: () => false });
    full = siteMod.buildSite(fx.promoted(), { ...base, productFeed: productFeed(GEN_MS + H) });
    late = siteMod.buildSite(fx.promoted(), { ...base, productFeed: productFeed(GEN_MS + 80 * H) });
  }, 30_000);

  // 하이드레이션은 신선도를 「지금」 시계로 다시 잰다(377 S1). 합성 피드(GEN)가 실제 날짜로 72h 를 넘기면 가격이 사라지므로 Date 만 고정.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(GEN_MS + H);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const variant = (s: FeedSiteLite, file: string) => {
    const p = s.feedPages.find((x) => x.file === file);
    if (!p) throw new Error(`no feed page ${file} — ${s.feedPages.map((x) => x.file).join(', ')}`);
    return p;
  };
  const stubFeedFetch = (s: FeedSiteLite) =>
    vi.stubGlobal('fetch', (input: string) => {
      const key = String(input).replace(/^\//, '');
      const body = s.files.get(key);
      return Promise.resolve(body === undefined ? new Response('', { status: 404 }) : new Response(body, { status: 200 }));
    });

  it('홈 B(TYPE 변형 full·noprice): main 골격 동일 — 피드 카드·고지가 하이드레이션 전후 같은 자리', () => {
    for (const [s, file] of [
      [full, 'hamster/golden/index.feed.html'],
      [late, 'hamster/golden/index.feed-noprice.html'],
    ] as const) {
      const p = variant(s, file);
      loadStatic(p);
      expect(readPageData(document)?.data.feed?.stage).toBe(s === full ? 'full' : 'noprice');
      const staticCards = document.querySelectorAll('main li.ws-feed-card').length;
      expect(staticCards, file).toBeGreaterThan(0);
      const before = skel(mainEl());
      const beforeTokens = classTokens(mainEl());
      expect(mainEl().querySelector('[data-ws-section="mall"] li.ws-feed-card'), file).not.toBeNull();
      if (s === late) expect(norm(mainEl().querySelector('[data-ws-section="mall"]')?.textContent ?? '')).not.toMatch(PRICE_OR_DATE);
      hydrate(p);
      const after = skel(mainEl());
      const d: string[] = [];
      diff(before, after, 'main', d);
      expect([...beforeTokens].filter((c) => !classTokens(mainEl()).has(c))).toEqual([]);
      expect(unexplained('TYPE', d)).toEqual([]);
      expect(document.querySelectorAll('main li.ws-feed-card')).toHaveLength(staticCards);
      expect(mainEl().querySelector('[data-ws-section="mall"] li.ws-feed-card'), file).not.toBeNull();
      if (s === late) expect(norm(mainEl().querySelector('[data-ws-section="mall"]')?.textContent ?? '')).not.toMatch(PRICE_OR_DATE);
      act(() => root?.unmount());
      root = null;
      document.body.innerHTML = '';
    }
  });

  it('L4 딥링크(/supplies/wheel 변형): 피드 블록 골격 프리렌더 = 하이드레이션 후, noprice 는 전후 가격·확인일 0', async () => {
    for (const [s, file] of [
      [full, 'hamster/golden/supplies/wheel/index.feed.html'],
      [late, 'hamster/golden/supplies/wheel/index.feed-noprice.html'],
    ] as const) {
      stubFeedFetch(s);
      const p = variant(s, file);
      loadStatic(p);
      const stat = document.querySelector('section[data-ws-part="feed"]');
      expect(stat, file).not.toBeNull();
      const before = skel(stat as Element);
      const beforeText = norm(stat?.textContent ?? '');
      if (s === late) expect(beforeText).not.toMatch(PRICE_OR_DATE);
      hydrate(p);
      await waitFor(() => expect(document.querySelectorAll('[role="dialog"] section[data-ws-part="feed"] li.ws-feed-row').length).toBeGreaterThan(0), { timeout: 15000 });
      const live = document.querySelector('[role="dialog"] section[data-ws-part="feed"]') as Element;
      const d: string[] = [];
      diff(before, skel(live), 'feed', d);
      expect(d).toEqual([]);
      expect(norm(live.textContent)).toBe(beforeText);
      if (s === late) expect(norm(live.textContent)).not.toMatch(PRICE_OR_DATE);
      // 푸터 고지 F: 피드 블록이 있는 L4 는 1(서버 feedLinksOn 과 같은 규칙)
      expect(document.querySelectorAll('footer [data-ws-aff="note-f"]')).toHaveLength(1);
      act(() => root?.unmount());
      root = null;
      act(() => layerStore.resetForTest());
      document.body.innerHTML = '';
      vi.unstubAllGlobals();
      mockMedia();
    }
  }, 60_000);

  it('383 /supplies/wheel/hamster-golden 변형: 피드 블록 동일 + 고지 F 1, 닫으면 0', async () => {
    for (const [s, file] of [
      [full, 'supplies/wheel/hamster-golden/index.feed.html'],
      [late, 'supplies/wheel/hamster-golden/index.feed-noprice.html'],
    ] as const) {
      stubFeedFetch(s);
      const p = variant(s, file);
      expect(p.route.kind).toBe('SUPPLY_ITEM_TYPE');
      loadStatic(p);
      const stat = document.querySelector('section[data-ws-part="feed"]') as Element;
      expect(stat, file).not.toBeNull();
      const before = skel(stat);
      const beforeText = norm(stat.textContent);
      expect(document.querySelectorAll('footer [data-ws-aff="note-f"]')).toHaveLength(1);
      hydrate(p);
      await waitFor(() => expect(document.querySelectorAll('[role="dialog"] section[data-ws-part="feed"] li.ws-feed-row').length).toBeGreaterThan(0), { timeout: 15000 });
      const live = document.querySelector('[role="dialog"] section[data-ws-part="feed"]') as Element;
      const d: string[] = [];
      diff(before, skel(live), 'feed', d);
      expect(d).toEqual([]);
      expect(norm(live.textContent)).toBe(beforeText);
      if (s === late) expect(norm(live.textContent)).not.toMatch(PRICE_OR_DATE);
      expect(document.querySelectorAll('footer [data-ws-aff="note-f"]')).toHaveLength(1);
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
      expect(document.querySelectorAll('[data-ws-aff]')).toHaveLength(0);
      act(() => root?.unmount());
      root = null;
      act(() => layerStore.resetForTest());
      document.body.innerHTML = '';
      vi.unstubAllGlobals();
      mockMedia();
    }
  }, 60_000);

  // 385(381 D2): popular 블록(시험 주입 허용 목록 — 제품 FEED_POPULAR_SORTS 는 빈 목록 그대로)의 제목은 하이드레이션·로딩·실패 내내 「많이 찾는 상품」.
  it('popular 변형 L4 딥링크: 정적 → 로딩 → 실패 → 다시 시도 → 행 내내 제목 동일, 골격 차이 0', async () => {
    const siteMod = await serverModule<{ buildSite: (seed: unknown, opts: Record<string, unknown>) => FeedSiteLite }>('prerender/site.ts');
    const mascotMod = await serverModule<{ loadMascots: (dir: string) => ReadonlyMap<string, string> }>('prerender/mascot.ts');
    const fx = await serverModule<{ promoted: () => unknown; FIXTURE_AS_OF: string }>('__tests__/fixtures/prerender-seed.ts');
    const eng = await import('@ws/engine');
    const seed = fx.promoted() as Parameters<typeof eng.createCatalog>[0] & { animalTypes: Array<{ id: string }> };
    const at = seed.animalTypes.find((a) => a.id === 'hamster-golden') as Parameters<typeof eng.buildSearchKeyword>[0];
    const r = eng.resolveRequirement(eng.createCatalog(seed), 'hamster-golden', 'wheel');
    if (!r) throw new Error('no requirement wheel');
    const pop = siteMod.buildSite(fx.promoted(), {
      template: TEMPLATE,
      origin: 'http://localhost:3001',
      seedDigest: 'a'.repeat(64),
      asOf: fx.FIXTURE_AS_OF,
      mascots: mascotMod.loadMascots(repoPath('docs/design/mascots')),
      productFeed: {
        rows: [
          {
            provider: 'COUPANG',
            animalTypeId: 'hamster-golden',
            supplyItemId: 'wheel',
            keyword: eng.buildSearchKeyword(at, r),
            rank: 1,
            title: '햄스터 쳇바퀴 30cm 통면 1호',
            url: 'https://link.coupang.com/a/Mk1x',
            imageUrl: null,
            price: { amount: 12900, currency: 'KRW' },
            fetchedAt: GEN,
          },
        ],
        generatedAt: GEN,
        buildAtMs: GEN_MS + H,
        isTitleBanned: () => false,
        sorts: { COUPANG: 'S' },
        popularSorts: { COUPANG: ['S'], ALIEXPRESS: [] },
      },
    });
    const title = (root_: string) => document.querySelector(`${root_} section[data-ws-part="feed"] > h3`)?.textContent;
    for (const file of ['hamster/golden/supplies/wheel/index.feed.html', 'supplies/wheel/hamster-golden/index.feed.html']) {
      resetFeedCacheForTest();
      const pending: Array<(res: Response) => void> = [];
      vi.stubGlobal('fetch', (input: string) =>
        String(input).includes('/feed/') ? new Promise<Response>((res) => pending.push(res)) : Promise.resolve(new Response('', { status: 404 })),
      );
      const p = variant(pop, file);
      loadStatic(p);
      const stat = document.querySelector('section[data-ws-part="feed"]') as Element;
      const before = skel(stat);
      const beforeText = norm(stat.textContent);
      expect(title('aside.ws-layer'), file).toBe(COPY.feed.title);
      hydrate(p);
      const dlg = '[role="dialog"]';
      await waitFor(() => expect(pending).toHaveLength(1), { timeout: 15000 });
      expect(document.querySelector(`${dlg} [data-ws-part="feed"] li.ws-feed-row`), file).toBeNull();
      expect(title(dlg), `${file} 로딩`).toBe(COPY.feed.title);
      await act(async () => pending[0]!(new Response('', { status: 500 })));
      const retry = await waitFor(() => within(document.querySelector(`${dlg} [data-ws-part="feed"]`) as HTMLElement).getByRole('button', { name: COPY.feed.retry }));
      expect(title(dlg), `${file} 실패`).toBe(COPY.feed.title);
      act(() => {
        fireEvent.click(retry);
      });
      await waitFor(() => expect(pending).toHaveLength(2));
      expect(title(dlg), `${file} 다시 시도 로딩`).toBe(COPY.feed.title);
      const json = pop.files.get('hamster/golden/feed/wheel.json');
      expect(json).toBeDefined();
      await act(async () => pending[1]!(new Response(json, { status: 200 })));
      await waitFor(() => expect(document.querySelector(`${dlg} [data-ws-part="feed"] li.ws-feed-row`)).not.toBeNull());
      const live = document.querySelector(`${dlg} section[data-ws-part="feed"]`) as Element;
      const d: string[] = [];
      diff(before, skel(live), 'feed', d);
      expect(d, file).toEqual([]);
      expect(norm(live.textContent), file).toBe(beforeText);
      act(() => root?.unmount());
      root = null;
      act(() => layerStore.resetForTest());
      document.body.innerHTML = '';
      vi.unstubAllGlobals();
      mockMedia();
    }
    resetFeedCacheForTest();
  }, 60_000);
});

// 383 — PRD 183-187: /supplies/{item}/{type} 는 US-007 과 같은 상세. 프리렌더가 내는 모든 URL 에서 본문(main + L4)이 하이드레이션 전후 같다.
//   부모 = 프리렌더가 선언한 것(misc.ts 「같은 부모 + L4」: main = /supplies/{item}, 정적 레이어 닫기 링크 href).
describe('383 /supplies/{item}/{type} — 프리렌더 ↔ 하이드레이션 L4', () => {
  let realSite: SiteLite;
  beforeAll(async () => {
    const siteMod = await serverModule<{ buildSite: BuildSite }>('prerender/site.ts');
    const mascotMod = await serverModule<{ loadMascots: (dir: string) => ReadonlyMap<string, string> }>('prerender/mascot.ts');
    const fx = await serverModule<{ realSeed: () => unknown; FIXTURE_AS_OF: string }>('__tests__/fixtures/prerender-seed.ts');
    realSite = siteMod.buildSite(fx.realSeed(), { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), asOf: fx.FIXTURE_AS_OF, mascots: mascotMod.loadMascots(repoPath('docs/design/mascots')) });
  }, 60_000);

  beforeEach(() => {
    // L4 의 같은 오리진 보조 요청(호환 카탈로그·반응)은 이 시험 범위 밖 — 404.
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })));
  });

  const sitPages = (from: SiteLite): BuiltPageLite[] => from.pages.filter((p) => p.route.kind === 'SUPPLY_ITEM_TYPE');
  const texts = (el: Element, sel: string): string[] => Array.from(el.querySelectorAll(sel)).map((x) => norm(x.textContent));
  const attrs = (el: Element, sel: string, name: string): string[] => Array.from(el.querySelectorAll(sel)).map((x) => x.getAttribute(name) ?? '');

  /** 정적 aside 와 React 레이어에서 같은 뜻의 내용만 뽑는다(감싸는 마크업은 타입 L4 와 똑같이 다르다). */
  function body(layer: Element, kind: 'static' | 'react') {
    const q = (sel: string) => layer.querySelector(sel);
    const merchants = kind === 'static' ? '.ws-search a' : '.ws-search-merchants a';
    const notNow = Array.from(layer.querySelectorAll(kind === 'static' ? ':scope > p:not([class])' : '[data-ws-part="notNow"] p'))
      .map((x) => norm(x.textContent))
      .filter((x) => x.startsWith(norm(COPY.supplyLayer.notNow)));
    return {
      layer: layer.getAttribute('data-ws-layer'),
      wsId: layer.getAttribute('data-ws-id'),
      title: norm(q('#ws-layer-title, h2')?.textContent ?? ''),
      eyebrow: norm(q('.ws-supply-eyebrow')?.textContent ?? ''),
      meta: texts(layer, kind === 'static' ? ':scope > p.ws-meta' : '.ws-supply-meta'),
      notNow,
      why: texts(layer, '[data-ws-part="why"] p'),
      conditions: texts(layer, kind === 'static' ? '[data-ws-part="conditions"] li' : '[data-ws-part="conditions"] .ws-cond-list li'),
      caution: texts(layer, '[data-ws-part="caution"] p'),
      avoid: texts(layer, '[data-ws-part="avoid"] p'),
      altIds: attrs(layer, '[data-ws-part="alternatives"] li', 'data-ws-id'),
      altHrefs: attrs(layer, '[data-ws-part="alternatives"] a', 'href'),
      altNames: texts(layer, '[data-ws-part="alternatives"] a'),
      productIds: attrs(layer, '[data-ws-part="products"] li.ws-product', 'data-ws-id'),
      productHrefs: attrs(layer, '[data-ws-part="products"] li.ws-product > a', 'href'),
      productTitles: texts(layer, '[data-ws-part="products"] .ws-product-title'),
      sources: attrs(layer, '[data-ws-part="verified"] a', 'href'),
      generalInfo: layer.querySelectorAll('[data-ws-source="general-info"]').length,
      photo: attrs(layer, '[data-ws-photo]', 'data-ws-photo'),
      checkLink: attrs(layer, 'a[href*="/check/"]:not(.ws-compat-link)', 'href'),
      merchants: Array.from(layer.querySelectorAll(merchants)).map((a) => `${a.getAttribute('href')} ${(a.getAttribute('rel') ?? '').split(' ').sort().join(' ')}`),
      noteA: texts(layer, '[data-ws-aff="note-a"]'),
      noteB: texts(layer, '[data-ws-aff="note-b"]'),
    };
  }

  async function openSit(p: BuiltPageLite) {
    loadStatic(p);
    const aside = document.querySelector('aside.ws-layer') as Element;
    expect(aside, p.route.path).not.toBeNull();
    const before = {
      main: skel(mainEl()),
      mainText: norm(mainEl().textContent),
      body: body(aside, 'static'),
      parent: aside.querySelector('a.ws-layer-close')?.getAttribute('href') ?? '',
      noteF: document.querySelectorAll('footer [data-ws-aff="note-f"]').length,
      affLinks: document.querySelectorAll('a[href^="https://link.coupang.com/a/"]').length,
    };
    hydrate(p);
    await waitFor(() => expect([document.querySelector('aside.ws-layer'), document.querySelector('[role="dialog"] .ws-supply') !== null], p.route.path).toEqual([null, true]), { timeout: 15000 });
    expect(document.querySelectorAll('[role="dialog"]'), p.route.path).toHaveLength(1);
    return { before, dialog: document.querySelector('[role="dialog"]') as HTMLElement };
  }

  function unmount() {
    act(() => root?.unmount());
    root = null;
    act(() => layerStore.resetForTest());
    document.body.innerHTML = '';
    document.documentElement.style.overflow = '';
  }

  it.each(['off', 'aff', 'dwarf', 'real'] as const)(
    '모든 URL(%s 빌드): main 골격·L4 본문 동일, 고지는 링크가 있을 때만(F·A·B), 부모 = 프리렌더 닫기 링크',
    async (which) => {
      const from = which === 'off' ? site : which === 'aff' ? affSite : which === 'dwarf' ? dwarfSite : realSite;
      const pages = sitPages(from);
      expect(pages.length).toBeGreaterThan(0);
      let withAlts = 0;
      for (const p of pages) {
        const path = p.route.path;
        const { before, dialog } = await openSit(p);
        const d: string[] = [];
        diff(before.main, skel(mainEl()), 'main', d);
        expect({ path, d }).toEqual({ path, d: [] });
        expect({ path, text: norm(mainEl().textContent) }).toEqual({ path, text: before.mainText });
        expect({ path, ...body(dialog, 'react') }).toEqual({ path, ...before.body });
        const on = which === 'aff' ? 1 : 0;
        const noteF = document.querySelectorAll('footer [data-ws-aff="note-f"]').length;
        expect({ path, f: [before.noteF, noteF], a: before.body.noteA.length, b: before.body.noteB.length, links: before.affLinks > 0 }).toEqual({ path, f: [on, on], a: on, b: on, links: on === 1 });
        expect(readLayerState(window.history.state)).toMatchObject({ wsLayer: 'L4', wsDepth: 0, wsParent: before.parent });
        if (before.body.altIds.length) withAlts += 1;
        unmount();
      }
      if (which === 'real') expect(withAlts).toBeGreaterThan(0); // 대안 있는 URL 이 실제로 비교됐다
    },
    180_000,
  );

  it.each(['close-button', 'escape'] as const)('닫기(%s): replaceState(부모) · history.length 불변 · main 유지 · 고지 0', async (how) => {
    const { before, dialog } = await openSit(sitPages(affSite)[0]);
    const len = window.history.length;
    if (how === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
    else fireEvent.click(within(dialog).getByRole('button', { name: COPY.supplyLayer.close }));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(window.location.pathname).toBe(before.parent);
    expect(window.history.length).toBe(len);
    expect(readLayerState(window.history.state)).toBeNull();
    expect(norm(mainEl().textContent)).toBe(before.mainText);
    expect(document.querySelectorAll('[data-ws-aff]')).toHaveLength(0);
  });

  // 대안 품목은 이 문서 ws-data 에 없다(프리렌더 출력 불변) → 이름·id 는 보관한 정적 aside 에서, 이동은 정적 링크 그대로(문서 이동, D10).
  it('대안 링크: 정적과 같은 href 로 문서 이동(가로채지 않음) — 그 URL 은 프리렌더가 낸 L4 문서', async () => {
    const p = sitPages(realSite).find((x) => x.html.includes('data-ws-part="alternatives"'));
    if (!p) throw new Error('대안 있는 SUPPLY_ITEM_TYPE 페이지 없음');
    const { before, dialog } = await openSit(p);
    const href = before.body.altHrefs[0];
    expect(pageAt(href, realSite).html).toContain('data-ws-layer="L4"');
    let intercepted: boolean | null = null;
    const watch = (e: Event) => {
      intercepted = e.defaultPrevented;
      e.preventDefault(); // jsdom 은 문서 이동 미구현
    };
    window.addEventListener('click', watch);
    fireEvent.click(dialog.querySelector(`[data-ws-part="alternatives"] a[href="${href}"]`) as Element);
    window.removeEventListener('click', watch);
    expect(intercepted).toBe(false);
    expect(window.location.pathname).toBe(p.route.path);
  });
});
