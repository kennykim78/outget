// @vitest-environment node
// 성능 P1 로더(client/build/wsAfterPaint.ts) 단위 테스트 — 트리거·주입 순서·중복 0, HTML 정리, fonts-first.css 원본 대조.
//   node 환경: 대상 모듈이 vite(esbuild)를 import 하는데 esbuild 는 jsdom 전역(TextEncoder)에서 초기화를 거부한다. DOM 은 가짜로 충분.
//   로더는 외부 파일로만 나가는 ES5 문자열이다. 여기서는 new Function 에 가짜 window·document 를 넣어 실행한다.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { FALLBACK_MS, FULL_FONT_CSS_ID, loaderSource, stripModuleTags } from '../../build/wsAfterPaint';
import fontsFirstCss from '../styles/fonts-first.css?raw';

const FONT = '/assets/ws-fonts-abc.css';
const ENTRY = '/assets/index-xyz.js';

interface FakeEl {
  tag: string;
  [k: string]: unknown;
}
type Listener = () => void;

function setup(opts: { path?: string; hash?: string; readyState?: string; hidden?: boolean; poThrows?: boolean } = {}) {
  const appended: FakeEl[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const winListeners = new Map<string, Listener[]>();
  const docListeners = new Map<string, Listener[]>();
  const observers: { cb: (list: unknown, obs: unknown) => void; disconnected: boolean; options: unknown }[] = [];
  const doc = {
    readyState: opts.readyState ?? 'interactive',
    visibilityState: opts.hidden ? 'hidden' : 'visible',
    head: { appendChild: (el: FakeEl) => appended.push(el) },
    createElement: (tag: string): FakeEl => ({ tag }),
    addEventListener: (t: string, f: Listener) => docListeners.set(t, [...(docListeners.get(t) ?? []), f]),
    removeEventListener: (t: string, f: Listener) => docListeners.set(t, (docListeners.get(t) ?? []).filter((x) => x !== f)),
  };
  class FakePO {
    private rec: (typeof observers)[number];
    constructor(cb: (list: unknown, obs: unknown) => void) {
      if (opts.poThrows) throw new Error('unsupported');
      this.rec = { cb, disconnected: false, options: null };
      observers.push(this.rec);
    }
    observe(o: unknown) {
      this.rec.options = o;
    }
    disconnect() {
      this.rec.disconnected = true;
    }
  }
  const win = {
    location: { pathname: opts.path ?? '/', hash: opts.hash ?? '' },
    PerformanceObserver: FakePO,
    setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
    addEventListener: (t: string, f: Listener) => winListeners.set(t, [...(winListeners.get(t) ?? []), f]),
  };
  new Function('window', 'document', loaderSource(FONT, ENTRY))(win, doc);

  const paint = (names: string[]) => {
    for (const o of observers) {
      if (o.disconnected) continue;
      const list = { getEntriesByName: (n: string) => names.filter((x) => x === n).map((name) => ({ name })) };
      o.cb(list, { disconnect: () => (o.disconnected = true) });
    }
  };
  const runTimers = (ms?: number) => {
    const due = timers.splice(0).filter((t) => (ms === undefined || t.ms === ms ? true : (timers.push(t), false)));
    for (const t of due) t.fn();
  };
  const fire = (m: Map<string, Listener[]>, t: string) => [...(m.get(t) ?? [])].forEach((f) => f());
  return {
    appended,
    timers,
    observers,
    doc,
    paint,
    runTimers,
    load: () => fire(winListeners, 'load'),
    visibility: (state: 'hidden' | 'visible') => {
      doc.visibilityState = state;
      fire(docListeners, 'visibilitychange');
    },
  };
}

function expectInjectedOnce(appended: FakeEl[]) {
  expect(appended).toHaveLength(2);
  // 순서: 전체 글꼴 CSS → 진입 module(crossorigin).
  expect(appended[0]).toEqual({ tag: 'link', rel: 'stylesheet', href: FONT });
  expect(appended[1]).toEqual({ tag: 'script', type: 'module', crossOrigin: '', src: ENTRY });
}

describe('wsAfterPaint 로더 — 트리거', () => {
  it('FCP 엔트리를 받으면 setTimeout 0 뒤에 주입한다(그 전엔 0)', () => {
    const h = setup();
    expect(h.observers).toHaveLength(1);
    expect(h.observers[0].options).toEqual({ type: 'paint', buffered: true });
    h.paint(['first-paint']);
    expect(h.appended).toHaveLength(0);
    h.paint(['first-contentful-paint']);
    expect(h.observers[0].disconnected).toBe(true);
    expect(h.appended).toHaveLength(0);
    h.runTimers(0);
    expectInjectedOnce(h.appended);
  });

  it('FCP 가 없으면 폴백: load 후 3000ms 에 주입한다', () => {
    const h = setup();
    expect(h.timers).toHaveLength(0);
    h.load();
    expect(h.timers.map((t) => t.ms)).toEqual([FALLBACK_MS]);
    expect(FALLBACK_MS).toBe(3000);
    expect(h.appended).toHaveLength(0);
    h.runTimers(FALLBACK_MS);
    expectInjectedOnce(h.appended);
  });

  it('이미 load 가 끝났으면(readyState complete) 바로 3000ms 폴백을 건다', () => {
    const h = setup({ readyState: 'complete' });
    expect(h.timers.map((t) => t.ms)).toEqual([FALLBACK_MS]);
    h.runTimers();
    expectInjectedOnce(h.appended);
  });

  it('PerformanceObserver 가 없거나 paint 를 못 받으면(생성 throw) 폴백만으로 주입한다', () => {
    const h = setup({ poThrows: true });
    expect(h.observers).toHaveLength(0);
    h.load();
    h.runTimers(FALLBACK_MS);
    expectInjectedOnce(h.appended);
  });

  it('hidden 이면 무장하지 않고, visible 이 된 뒤에 FCP 로 주입한다', () => {
    const h = setup({ hidden: true, readyState: 'complete' });
    expect(h.observers).toHaveLength(0);
    expect(h.timers).toHaveLength(0);
    h.visibility('hidden');
    expect(h.observers).toHaveLength(0);
    h.visibility('visible');
    expect(h.observers).toHaveLength(1);
    h.visibility('hidden');
    h.visibility('visible');
    expect(h.observers).toHaveLength(1); // 리스너는 한 번 무장 후 제거
    h.paint(['first-contentful-paint']);
    h.runTimers(0);
    expectInjectedOnce(h.appended);
  });

  it.each([
    ['/save', ''],
    ['/save/', ''],
    ['/save', '#t=abc'],
    ['/hamster/golden', '#t=abc'],
    ['/', '#x=1&t=abc'],
  ])('%s%s 는 즉시(동기) 주입한다 — 매직링크 토큰 순서 보존', (path, hash) => {
    const h = setup({ path, hash, hidden: true });
    expectInjectedOnce(h.appended);
    expect(h.observers).toHaveLength(0);
    expect(h.timers).toHaveLength(0);
  });

  it.each([
    ['/saved', ''],
    ['/save/x', ''],
    ['/', '#top'],
    ['/', '#at=1'],
  ])('%s%s 는 즉시 주입 대상이 아니다', (path, hash) => {
    const h = setup({ path, hash });
    expect(h.appended).toHaveLength(0);
    expect(h.observers).toHaveLength(1);
  });

  it('중복 주입 0 — FCP·폴백이 모두 와도, 콜백이 여러 번 와도 1회', () => {
    const h = setup();
    h.paint(['first-contentful-paint']);
    h.paint(['first-contentful-paint']);
    h.load();
    h.runTimers();
    h.runTimers();
    expectInjectedOnce(h.appended);
  });
});

describe('wsAfterPaint — 로더 원본·HTML 정리', () => {
  it('로더는 인라인·외부 출처·`</` 없는 순수 문자열이고 URL 은 JSON 이스케이프된다', () => {
    const src = loaderSource(FONT, ENTRY);
    expect(src).toBe(loaderSource(FONT, ENTRY));
    expect(src).not.toContain('</');
    expect(src).not.toMatch(/https?:|\/\//);
    expect(src).toContain(JSON.stringify(FONT));
    expect(loaderSource('/a"b.css', ENTRY)).toContain('"/a\\"b.css"');
  });

  it('진입 module script 와 modulepreload 를 걷어 내고 진입 src 를 돌려준다', () => {
    const html = [
      '<head>',
      '    <script type="module" crossorigin src="/assets/index-1.js"></script>',
      '    <link rel="modulepreload" crossorigin href="/assets/vendor-2.js">',
      '    <link rel="stylesheet" crossorigin href="/assets/index-3.css">',
      '<script type="application/ld+json">{}</script>',
      '</head>',
    ].join('\n');
    const out = stripModuleTags(html);
    expect(out.entrySrc).toBe('/assets/index-1.js');
    expect(out.html).not.toMatch(/type="module"|modulepreload/);
    expect(out.html).toContain('<link rel="stylesheet" crossorigin href="/assets/index-3.css">');
    expect(out.html).toContain('application/ld+json');
  });

  it('진입 module 이 0개·2개면 throw(조용히 하이드레이션 없는 페이지를 내지 않는다)', () => {
    expect(() => stripModuleTags('<head></head>')).toThrow();
    expect(() =>
      stripModuleTags('<script type="module" src="/a.js"></script><script type="module" src="/b.js"></script>'),
    ).toThrow();
  });
});

describe('fonts-first.css — 패키지 원본 [90]·[91] 과 같은 규칙', () => {
  const faces = (css: string) => css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  const norm = (f: string) => f.replace(/url\([^)]*?(PretendardVariable\.subset\.\d+\.woff2)\)/, 'url($1)').replace(/\s+/g, ' ');

  it('@font-face 는 정확히 2개(90·91)이고 descriptor·unicode-range 가 원본과 글자 단위로 같다', () => {
    const pkgCss = readFileSync(createRequire(import.meta.url).resolve(FULL_FONT_CSS_ID), 'utf8');
    const want = faces(pkgCss).filter((f) => /subset\.(?:90|91)\.woff2/.test(f)).map(norm);
    const got = faces(fontsFirstCss).map(norm);
    expect(want).toHaveLength(2);
    expect(got).toEqual(want);
    expect(faces(pkgCss)).toHaveLength(92);
  });

  it('url 은 번들되는 패키지 경로만(외부 출처 0, 불변식 ①)', () => {
    for (const m of fontsFirstCss.matchAll(/url\(([^)]+)\)/g)) {
      expect(m[1]).toMatch(/^pretendard\/dist\/web\/variable\/woff2-dynamic-subset\/PretendardVariable\.subset\.9[01]\.woff2$/);
    }
  });
});
