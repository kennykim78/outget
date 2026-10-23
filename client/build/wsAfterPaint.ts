// 성능 P1(font2 + jslate) — _workspace/59_architect_perf_plan.md 로더 사양. 빌드 전용 vite 플러그인 + 로더 원본.
//
//   ① 동기 CSS 에는 첫 화면 글꼴 조각 90·91 두 @font-face 만(src/styles/fonts-first.css). 전체 Pretendard Variable
//      dynamic-subset 92규칙은 별도 자산 assets/ws-fonts-[hash].css 로 낸다(url 은 전부 번들 woff2 — 외부 출처 0, 불변식 ①).
//   ② Vite 가 head 에 넣는 진입 <script type="module"> 과 <link rel="modulepreload"> 를 걷어 내고, 외부 로더
//      assets/ws-boot-[hash].js 를 <script defer src> 로 둔다(인라인 0 — CSP script-src 'self'·compliance C8).
//   ③ 로더는 첫 페인트(FCP) 뒤에 전체 글꼴 CSS → 진입 module(crossorigin) 순으로 주입한다. 트리거:
//        FCP(PerformanceObserver paint, buffered) → setTimeout 0 | 폴백 load + 3000ms | hidden 이면 visible 이 된 뒤 무장 |
//        /save 또는 해시 t= 이면 즉시(매직링크 토큰 — boot 가 가장 먼저 지우는 D1 순서를 늦추지 않는다).
//   ④ JS 가 꺼진 경우 <noscript><link rel="stylesheet" href="전체 글꼴 CSS"></noscript>.
//   dev(vite serve)는 이 플러그인이 꺼지고 main.tsx 가 전체 CSS 를 직접 import 한다(import.meta.env.DEV).
//   프리렌더(server/src/prerender)는 client/dist/index.html 을 템플릿으로 쓰므로 모든 정적 페이지 head 가 같은 형태다.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { transformWithEsbuild, type Plugin } from 'vite';

/** 전체 글꼴 CSS(패키지 원본). main.tsx dev 경로와 같은 모듈 id. */
export const FULL_FONT_CSS_ID = 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
/** 로더 폴백 지연 — load 이벤트 뒤 이 시간 안에 FCP 를 못 받으면 그냥 주입한다. */
export const FALLBACK_MS = 3000;

const FONT_URL_RE = /url\(\s*(['"]?)\.\/woff2-dynamic-subset\/([^'")]+\.woff2)\1\s*\)/g;
const MODULE_SCRIPT_RE = /[ \t]*<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>[ \t]*\r?\n?/g;
const MODULEPRELOAD_RE = /[ \t]*<link\b[^>]*\brel="modulepreload"[^>]*>[ \t]*\r?\n?/g;
const OFL_NOTE =
  '/*! Pretendard Variable — Copyright (c) 2021 Kil Hyung-jin, with Reserved Font Name Pretendard. SIL Open Font License 1.1 (https://github.com/orioncactus/pretendard) */\n';

/**
 * 로더 원본(ES5, 외부 파일로만 낸다 — 인라인 금지). 순수 함수: 같은 입력이면 같은 문자열(해시 안정).
 * 전역은 window·document 만 쓴다(테스트는 new Function 매개변수로 가짜를 넣는다).
 */
export function loaderSource(fontCssUrl: string, entryUrl: string): string {
  const font = JSON.stringify(fontCssUrl);
  const entry = JSON.stringify(entryUrl);
  return [
    '(function(w,d){',
    `var FONT=${font},ENTRY=${entry},done=false,armed=false;`,
    // 주입은 정확히 1회 — 글꼴 CSS 먼저, 그다음 진입 module(crossorigin: Vite 기본 산출과 같은 CORS 모드).
    'function inject(){if(done)return;done=true;',
    "var l=d.createElement('link');l.rel='stylesheet';l.href=FONT;d.head.appendChild(l);",
    "var s=d.createElement('script');s.type='module';s.crossOrigin='';s.src=ENTRY;d.head.appendChild(s);}",
    `function fallback(){w.setTimeout(inject,${FALLBACK_MS});}`,
    'function arm(){if(armed)return;armed=true;',
    'try{new w.PerformanceObserver(function(list,obs){',
    "if(list.getEntriesByName('first-contentful-paint').length){obs.disconnect();w.setTimeout(inject,0);}",
    "}).observe({type:'paint',buffered:true});}catch(e){}",
    "if(d.readyState==='complete')fallback();else w.addEventListener('load',fallback);}",
    'var loc=w.location;',
    "if(/^\\/save\\/?$/.test(loc.pathname)||/[#&]t=/.test(loc.hash)){inject();return;}",
    "if(d.visibilityState==='hidden'){d.addEventListener('visibilitychange',function on(){",
    "if(d.visibilityState!=='hidden'){d.removeEventListener('visibilitychange',on);arm();}});}",
    'else arm();',
    '})(window,document);',
    '',
  ].join('');
}

/** Vite 산출 HTML 에서 진입 module script·modulepreload 를 걷어 낸다. 진입 src 는 정확히 1개여야 한다. */
export function stripModuleTags(html: string): { html: string; entrySrc: string } {
  const srcs = [...html.matchAll(MODULE_SCRIPT_RE)].map((m) => m[1]);
  if (srcs.length !== 1) throw new Error(`ws-after-paint: 진입 <script type="module"> 이 ${srcs.length}개 — 정확히 1개여야 한다`);
  return { html: html.replace(MODULE_SCRIPT_RE, '').replace(MODULEPRELOAD_RE, ''), entrySrc: srcs[0] };
}

interface Emitted {
  fontCss: string;
  boot: string;
  entry: string;
}

export function wsAfterPaint(): Plugin {
  let base = '/';
  let emitted: Emitted | null = null;
  return {
    name: 'ws-after-paint',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    // 일반 순서 — vite:build-html 의 generateBundle(transformIndexHtml 실행)보다 먼저 돈다.
    async generateBundle(_options, bundle) {
      const resolved = await this.resolve(FULL_FONT_CSS_ID);
      if (!resolved) this.error(`ws-after-paint: ${FULL_FONT_CSS_ID} 를 찾지 못했다`);
      const cssPath = resolved.id.replace(/[?#].*$/, '');
      const fontDir = join(dirname(cssPath), 'woff2-dynamic-subset');
      const source = readFileSync(cssPath, 'utf8');

      // 이미 번들에 있는 조각(fonts-first.css 의 90·91)은 그 파일을 그대로 쓴다 — preload 와 같은 URL.
      const existing = new Map<string, string>();
      for (const out of Object.values(bundle)) {
        if (out.type !== 'asset') continue;
        for (const n of out.names ?? []) existing.set(n, out.fileName);
      }
      let faces = 0;
      const rewritten = source.replace(FONT_URL_RE, (_m, _q: string, file: string) => {
        faces++;
        const name = basename(file);
        let fileName = existing.get(name);
        if (!fileName) {
          const ref = this.emitFile({ type: 'asset', name, source: readFileSync(join(fontDir, name)) });
          fileName = this.getFileName(ref);
          existing.set(name, fileName);
        }
        return `url(${base}${fileName})`;
      });
      const total = (source.match(/@font-face\s*\{/g) ?? []).length;
      if (faces === 0 || faces !== total) this.error(`ws-after-paint: @font-face ${total}개 중 url 치환 ${faces}개 — 패키지 형식이 바뀌었다`);
      if (/url\((?!\s*['"]?\/)/.test(rewritten)) this.error('ws-after-paint: 치환되지 않은 상대 url() 이 남았다');
      const min = await transformWithEsbuild(rewritten, 'ws-fonts.css', { minify: true, legalComments: 'none' });
      const fontRef = this.emitFile({ type: 'asset', name: 'ws-fonts.css', source: OFL_NOTE + min.code });

      const entries = Object.values(bundle).filter((o) => o.type === 'chunk' && o.isEntry);
      if (entries.length !== 1) this.error(`ws-after-paint: 진입 청크 ${entries.length}개 — 1개여야 한다`);
      const entry = `${base}${entries[0].fileName}`;
      const fontCss = `${base}${this.getFileName(fontRef)}`;
      const bootRef = this.emitFile({ type: 'asset', name: 'ws-boot.js', source: loaderSource(fontCss, entry) });
      emitted = { fontCss, entry, boot: `${base}${this.getFileName(bootRef)}` };
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!emitted) throw new Error('ws-after-paint: generateBundle 이 먼저 돌지 않았다(플러그인 순서)');
        const { html: stripped, entrySrc } = stripModuleTags(html);
        if (entrySrc !== emitted.entry) throw new Error(`ws-after-paint: HTML 진입(${entrySrc}) ≠ 로더 진입(${emitted.entry})`);
        return {
          html: stripped,
          tags: [
            { tag: 'script', attrs: { defer: true, src: emitted.boot }, injectTo: 'head' },
            // children 을 문자열로 — Vite 가 줄바꿈·들여쓰기 없이 그대로 넣는다(<noscript><link ...></noscript> 한 줄).
            { tag: 'noscript', children: `<link rel="stylesheet" href="${emitted.fontCss}">`, injectTo: 'head' },
          ],
        };
      },
    },
  };
}
