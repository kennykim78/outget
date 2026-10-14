// app.css 정적 페이지 회귀 — 프리렌더 main.ws-page[data-ws-route] 직접 셀렉터, 푸터 모바일 padding 순서.
import { describe, expect, it } from 'vitest';
import appCss from './app.css?raw';

describe('app.css static pages', () => {
  it('.ws-static-main > 셀렉터 없음', () => {
    expect(appCss).not.toContain('ws-static-main >');
  });

  it('WCAG 2.4.11: html scroll-padding-top(헤더)·모바일 scroll-padding-bottom(탭바)', () => {
    expect(appCss).toMatch(/scroll-padding-top:\s*var\(--ws-header-h\)/);
    expect(appCss).toMatch(/scroll-padding-bottom:\s*calc\(var\(--ws-tabbar-h\)/);
  });

  it('정적 scrim(:not([data-ws-scrim]))은 모바일에서 하단을 탭바 높이만큼 비운다', () => {
    expect(appCss).toMatch(
      /@media \(max-width: 767px\)\s*\{\s*\.ws-scrim:not\(\[data-ws-scrim\]\)\s*\{\s*bottom:\s*calc\(var\(--ws-tabbar-h\) \+ env\(safe-area-inset-bottom, 0px\)\);/,
    );
  });

  it('모바일 .ws-footer padding-bottom 은 기본 .ws-footer padding-block 뒤', () => {
    const base = appCss.indexOf('padding-block: var(--ws-space-6)');
    const mobile = appCss.lastIndexOf('@media (max-width: 767px)', appCss.indexOf('var(--ws-tabbar-h) + var(--ws-space-6)'));
    expect(base).toBeGreaterThan(-1);
    expect(mobile).toBeGreaterThan(base);
  });
});
