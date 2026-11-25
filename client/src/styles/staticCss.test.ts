// app.css 정적 페이지 회귀 — 프리렌더 main.ws-page[data-ws-route] 직접 셀렉터, 헤더 메뉴(U2b) 표시 규칙, 탭바 참조 0.
import { describe, expect, it } from 'vitest';
import appCss from './app.css?raw';
import layersCss from './layers.css?raw';

describe('app.css static pages', () => {
  it('.ws-static-main > 셀렉터 없음', () => {
    expect(appCss).not.toContain('ws-static-main >');
  });

  it('WCAG 2.4.11: html scroll-padding-top(헤더) — 하단 탭바 없음(U2b·D2)이라 scroll-padding-bottom·탭바 높이 참조 0', () => {
    expect(appCss).toMatch(/scroll-padding-top:\s*var\(--ws-header-h\)/);
    const sheets = import.meta.glob(['../**/*.css', '!./tokens.css'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    for (const [file, css] of Object.entries(sheets)) expect(css, file).not.toMatch(/--ws-tabbar-h|\.ws-tabbar|\.ws-tab(?![\w-])/);
  });

  it('U2b 헤더 메뉴: ≤767 패널은 단추 aria-expanded=true 일 때만 · 무JS(scripting: none)는 단추 숨김 + 메뉴 펼침 · ≥768 단추 숨김', () => {
    expect(appCss).toMatch(/\.ws-nav\s*\{\s*display:\s*none;\s*\}/);
    expect(appCss).toMatch(/@media \(max-width: 767px\)\s*\{\s*\.ws-menu-btn\[aria-expanded='true'\] \+ \.ws-nav\s*\{[^}]*display:\s*flex;/);
    expect(appCss).toMatch(
      /@media \(max-width: 767px\) and \(scripting: none\)\s*\{[\s\S]*?html:not\(\[data-ws-js\]\) \.ws-menu-btn\s*\{\s*display:\s*none;\s*\}\s*html:not\(\[data-ws-js\]\) \.ws-nav\s*\{\s*display:\s*flex;/,
    );
    // qa MED-2: JS 준비 표식(<html data-ws-js>) 전에는 ≤767 에서도 단추 숨김 + nav 한 줄 보임(번들 로드 실패 폴백) — 미디어 기능 조건 없이.
    expect(appCss).toMatch(
      /@media \(max-width: 767px\)\s*\{\s*html:not\(\[data-ws-js\]\) \.ws-menu-btn\s*\{\s*display:\s*none;\s*\}\s*html:not\(\[data-ws-js\]\) \.ws-nav\s*\{\s*display:\s*flex;[^}]*overflow-x:\s*auto;/,
    );
    expect(appCss).toMatch(/@media \(min-width: 768px\)\s*\{[\s\S]*?\.ws-menu-btn\s*\{\s*display:\s*none;\s*\}/);
  });

  it('토큰 v2.0: 앱 CSS 는 색 리터럴 0(hex·rgb·hsl) — 색은 tokens.css 변수로만', () => {
    const sheets = import.meta.glob(['../**/*.css', '!./tokens.css', '!./fonts-*.css'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sheets).length).toBeGreaterThanOrEqual(8);
    for (const [file, css] of Object.entries(sheets)) {
      const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(noComments.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g), file).toBeNull();
    }
  });

  it('QA118: L4 조건표 규격 숫자는 단위 안에서 끊지 않는다 — 조건표 2칸은 flex-wrap(쌓임), 숫자 토큰 overflow-wrap:break-word', () => {
    expect(appCss).toMatch(/body\s*\{[^}]*overflow-wrap:\s*anywhere/); // 전역은 그대로 — 아래 규칙이 조건표만 덮는다.
    expect(layersCss).toMatch(/\.ws-cond-cell dd \.ws-t-spec-lg\s*\{\s*overflow-wrap:\s*break-word;\s*\}/);
    expect(layersCss).toMatch(/\.ws-cond-table--2\s*\{\s*display:\s*flex;\s*flex-wrap:\s*wrap;/);
    expect(layersCss).not.toMatch(/\.ws-cond-table--2\s*\{[^}]*grid-template-columns/);
  });

  it('305 TIPS: 정적 본문 목록에 TIPS, 읽기 폭 720(modal-w) 단일 열, 본문 34em, 외부 원문 링크 44 터치·밑줄, 밴드 bg-100·radius-lg(상태색·그림자 0)', () => {
    const noComments = appCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const staticLists = noComments.match(/main\.ws-page:is\([^)]*\)/g) ?? [];
    expect(staticLists.length).toBeGreaterThan(0);
    for (const sel of staticLists) if (sel.includes("[data-ws-route='PRIVACY']")) expect(sel).toContain("[data-ws-route='TIPS']");
    expect(noComments).toMatch(/main\.ws-page\[data-ws-route='TIPS'\]\s*\{[^}]*--ws-reading-w:\s*var\(--ws-modal-w\);[^}]*max-width:\s*var\(--ws-reading-w\);/);
    // 311 S-2: 위험 상자·확인 밴드는 34em 에서 빠진다(열 전체 폭), 상자 안 글줄만 34em.
    expect(noComments).toMatch(/\[data-ws-tip-part\]:not\(\.ws-tip-check\):not\(\.ws-tip-hazard\)\s*\{[^}]*max-width:\s*34em;/);
    expect(noComments).not.toMatch(/article\.ws-tip > \.ws-tip-hazard\s*\{[^}]*max-width/);
    expect(noComments).toMatch(/\.ws-tip-hazard > ul\s*\{[^}]*max-width:\s*34em;/);
    expect(noComments).toMatch(/a\.ws-tip-source\s*\{[^}]*min-height:\s*var\(--ws-touch\);[^}]*text-decoration:\s*underline;/);
    expect(noComments).toMatch(/\.ws-tip-check\s*\{[^}]*border-radius:\s*var\(--ws-radius-lg\);[^}]*background:\s*var\(--ws-bg-100\);/);
    // 311 S-1: 위험 상자 뒤 구하는 곳 줄은 상자와 space-3 떼기(article gap space-6 보정).
    expect(noComments).toMatch(/\.ws-tip-hazard \+ \.ws-tip-source-hint\s*\{[^}]*margin-top:\s*calc\(var\(--ws-space-3\) - var\(--ws-space-6\)\);/);
    // 311 N-1: ≥768 섹션 머리 h2 ↔ 기준 링크 세로 가운데, h2 위 여백은 섹션으로.
    expect(noComments).toMatch(/\.ws-tips-sec\s*\{[^}]*display:\s*grid;[^}]*align-items:\s*center;/);
    expect(noComments).toMatch(/\.ws-tips-sec > h2 \+ \.ws-tips-std\s*\{[^}]*align-self:\s*center;/);
    expect(noComments).toMatch(/\.ws-tips-sec > h2\s*\{\s*margin-top:\s*0;\s*\}/);
    // 311 N-2: 우리 최소 규격 줄 기본 = body 600, 조건 접두 = body 400(spec 18/700 은 .ws-t-spec 유틸만).
    expect(noComments).toMatch(/\.ws-tip-min \+ ul li\s*\{[^}]*font-size:\s*var\(--ws-type-body-size\);[^}]*font-weight:\s*var\(--ws-type-cta-weight\);/);
    expect(noComments).toMatch(/\.ws-tip-min \+ ul \.ws-tip-when\s*\{[^}]*font-weight:\s*var\(--ws-type-body-weight\);/);
    expect(noComments).not.toMatch(/\.ws-tip-min \+ ul li\s*\{[^}]*--ws-type-spec-/);
    const tipsRules = noComments.match(/[^{}]*data-ws-route='TIPS'\][^{}]*\{[^}]*\}/g) ?? [];
    expect(tipsRules.length).toBeGreaterThan(5);
    for (const r of tipsRules) expect(r).not.toMatch(/--ws-status-|box-shadow|gradient|max-height|details|summary/);
  });

  it('U1(R3): 드로어 폐기 — 레이어 CSS 에 drawer 0, 모달·정적 aside 는 위 48·가로 가운데, 안쪽 여백 layer-pad 16/40', () => {
    const noComments = (appCss + layersCss).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(noComments).not.toMatch(/drawer/);
    expect(appCss).toMatch(/\.ws-layer-panel--modal\s*\{[^}]*top:\s*var\(--ws-space-12\);[^}]*transform:\s*translateX\(-50%\);/);
    expect(appCss).toMatch(/\.ws-layer-body\s*\{[^}]*padding:\s*var\(--ws-layer-pad-mobile\);/);
    expect(appCss).toMatch(/@media \(min-width: 768px\)\s*\{[^@]*\.ws-layer-body\s*\{\s*padding:\s*var\(--ws-layer-pad\);/);
    expect(appCss).not.toMatch(/aside\.ws-layer\[data-ws-layer=/); // L4·L7 별도 위치 규칙 없음
  });

  it('385(382 F2): 정적 L4(하이드레이션 전) 피드 블록은 앞 구획과 space 토큰만큼 뗀다 — 레이어(React)는 .ws-supply gap 그대로', () => {
    expect(layersCss).toMatch(/aside\.ws-layer \.ws-feed\s*\{\s*margin-top:\s*var\(--ws-space-6\);\s*\}/);
  });
});
