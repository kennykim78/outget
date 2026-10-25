// 51 레인 T — 프리렌더 ↔ 하이드레이션 DOM 동등성(계획 _workspace/51_architect_persona_fix.md §3.1 테스트 전략 1).
//   서버 buildSite(승격 픽스처, 고정 asOf) 가 만든 body + ws-data 를 jsdom(390, desktop=false, 빈 localStorage)에 넣고
//   boot() 전/후 main 골격(skeleton)이 같아야 한다. 하이드레이션 순간 레이아웃이 바뀌지 않게(무JS 첫 화면 = React 첫 화면).
//
//   서버 모듈 import 예외(사유): 클라 규칙은 서버 파일을 @ws/* 별칭으로만 가져온다(.eslintrc no-restricted-imports, tsconfig paths).
//   프리렌더(site.ts)·픽스처는 node:fs/node:crypto 를 쓰는 빌드 타임 코드라 별칭 대상이 아니다. 이 테스트만 lazy import.meta.glob 으로
//   가져온다(번들에 들어가지 않음 — *.test.tsx, 클라 tsconfig 에 node 타입을 들이지 않음). 반환 타입은 아래 최소 인터페이스.
import { act } from '@testing-library/react';
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
    kinds: ['HOME', 'PICK'],
    re: /^main>section\.ws-reviews-section\[\d+\]>ul\.ws-reviews-static\[\d+\]>li\.ws-review\[\d+\]>a\.ws-review-action\.ws-t-meta\[\d+\] \.tag: static="a" react="button"$/,
    why: '비-VET 후기 행동: 정적 a(해당 페이지 링크) → React button(레이어 열기)',
  },
  {
    kinds: ['TYPE'],
    re: /^main>section\.ws-rail-section\.ws-rail-section--need\[\d+\] \.id: static="ws-now" react=undefined$/,
    why: '홈B ① 정적 앵커 id=ws-now(⑤ 저장 CTA #ws-now 이동 대상) — React 는 CTA 가 L2 를 열어 앵커 불필요',
  },
  {
    kinds: ['TYPE'],
    re: /^main>section\.ws-rail-section\.ws-rail-section--need\[\d+\]>ul\.ws-chips\.ws-rail\[\d+\]>li\[\d+\] \.wsId: static="supplyRequirements#[a-z0-9-]+" react=undefined$/,
    why: '홈B ① 정적 칩 li data-ws-id(컴플라이언스 산출물 스캔용 출처 표지) — 클라 전용 아님, 정적만',
  },
  {
    kinds: ['TYPE'],
    re: /^main>section\.ws-band\.ws-band--save\[\d+\]>a\.ws-btn\.ws-btn--fill\[\d+\] \.tag: static="a" react="button"$/,
    why: '홈B ⑤ 저장 CTA: 정적 a href=#ws-now → React button(L2/L8)',
  },
  {
    kinds: ['TYPE'],
    re: /^main>section\.ws-rail-section\.ws-rail-section--need\[\d+\]>div\.ws-rail-head\[\d+\]>div\.ws-rail-tools\[\d+\]>a\.ws-rail-more\.ws-t-meta\[\d+\] \.tag: static="a" react="button"$/,
    why: 'now 전체 ›: 정적은 /{slug}/setup 링크, React는 L2 버튼 — decisions 2026-10-14',
  },
  {
    kinds: ['TYPE'],
    re: /^main>section\.ws-rail-section\.ws-rail-section--product\[\d+\]>ul\.ws-products\.ws-rail\[\d+\]>li\.ws-product\[\d+\]>span\.ws-like\[\d+\] \.(tag: static="span" react="button"|text: static=undefined react="♡")$/,
    why: '상품 카드 ♡: 정적 span 자리표시(내부 span.ws-like-glyph 동일) → React button(D-38; .text 는 button 만 TEXT_TAGS 라 따라오는 차이) — decisions 2026-10-14',
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

  // 허용 목록이 썩지 않게 — 위 케이스들이 먼저 돈다(파일 내 순차). 더 이상 나타나지 않는 항목은 지운다.
  it('허용 목록 항목은 모두 실제로 쓰인다', () => {
    expect(ALLOWED.filter((_, i) => !allowedHits.has(i)).map((a) => a.why)).toEqual([]);
  });
});
