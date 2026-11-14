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
      /@media \(max-width: 767px\) and \(scripting: none\)\s*\{[\s\S]*?\.ws-menu-btn\s*\{\s*display:\s*none;\s*\}\s*\.ws-nav\s*\{\s*display:\s*flex;/,
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

  it('U1(R3): 드로어 폐기 — 레이어 CSS 에 drawer 0, 모달·정적 aside 는 위 48·가로 가운데, 안쪽 여백 layer-pad 16/40', () => {
    const noComments = (appCss + layersCss).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(noComments).not.toMatch(/drawer/);
    expect(appCss).toMatch(/\.ws-layer-panel--modal\s*\{[^}]*top:\s*var\(--ws-space-12\);[^}]*transform:\s*translateX\(-50%\);/);
    expect(appCss).toMatch(/\.ws-layer-body\s*\{[^}]*padding:\s*var\(--ws-layer-pad-mobile\);/);
    expect(appCss).toMatch(/@media \(min-width: 768px\)\s*\{[^@]*\.ws-layer-body\s*\{\s*padding:\s*var\(--ws-layer-pad\);/);
    expect(appCss).not.toMatch(/aside\.ws-layer\[data-ws-layer=/); // L4·L7 별도 위치 규칙 없음
  });
});
