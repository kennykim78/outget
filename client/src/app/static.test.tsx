// F8: 미구현 라우트 = 셸 + StaticMain(같은 문서 보관 main), 레이어 딥링크 = 부모 홈 B + Layer 안 StaticLayer(보관 aside).
//   ① 프리렌더 fixture 를 boot 로 마운트한 뒤 main textContent 가 원본과 같다(9종) ② 딥링크 dialog 안 원본 aside, 닫으면 부모 경로.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RouteKind, WsPageData } from '@ws/engine';
import { golden, pageOf, product, req } from '../test/fixtures';
import { layerStore } from '../ui/layer/useLayer';
import { boot } from './boot';
import appCss from '../styles/app.css?raw';
import layerStaticCss from '../styles/layer-static.css?raw';

let root: Root | null = null;

function mount(page: WsPageData, mainHtml: string, asideHtml = ''): void {
  document.body.innerHTML =
    `<div id="root" data-ws-prerendered="1"><header class="ws-header"><a class="ws-logo" href="/">WithSmall</a></header>${mainHtml}` +
    (asideHtml ? `<div class="ws-scrim" aria-hidden="true"></div>${asideHtml}` : '') +
    `<footer class="ws-footer"><p>x</p></footer></div>` +
    `<script id="ws-data" type="application/json">${JSON.stringify(page).replace(/</g, '\u003c')}</script>`;
  act(() => {
    root = boot(document, { pathname: page.route.path });
  });
}

beforeEach(() => {
  localStorage.clear();
  layerStore.resetForTest();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

const STATIC_KINDS: Array<[RouteKind, string]> = [
  ['FAMILY', '/hamster'],
  ['SETUP', '/hamster/golden/setup'],
  ['SUPPLIES', '/supplies'],
  ['SUPPLY_ITEM', '/supplies/cage'],
  ['SUPPLY_ITEM_TYPE', '/supplies/cage/hamster/golden'],
  ['VET', '/vet'],
  ['VET_REGION', '/vet/seoul-mapo'],
  ['CREDITS', '/credits'],
  ['NOT_FOUND', '/404'],
];

describe('F8 StaticMain', () => {
  it.each(STATIC_KINDS)('%s: 마운트 후 main textContent = 프리렌더 원본, 셸·푸터 크레딧 링크 있음', (kind, path) => {
    const mainHtml = `<main class="ws-page" data-ws-route="${kind}"><h1>제목 ${kind}</h1><ul><li data-ws-id="x#1">항목 &amp; 하나</li></ul><p>본문 <a href="/vet">병원</a></p></main>`;
    const original = new DOMParser().parseFromString(mainHtml, 'text/html').querySelector('main')?.textContent;
    mount(pageOf(kind, {}, { path }), mainHtml);
    const mains = document.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('data-ws-route', kind);
    expect(mains[0].textContent).toBe(original);
    expect(document.getElementById('root')).not.toHaveAttribute('data-ws-prerendered');
    expect(document.querySelector('footer.ws-footer a[href="/credits"]')).not.toBeNull();
    expect(document.querySelector('header.ws-header a[data-ws-chip]')).not.toBeNull();
  });
});

describe('F8 StaticLayer', () => {
  function l4Page(): WsPageData {
    return pageOf(
      'TYPE',
      { requirements: [req('cage', 'REQUIRED', '케이지')], products: [product('p1', 'cage')] },
      { typeId: golden.id, path: '/hamster/golden/supplies/cage', layer: { kind: 'L4', typeId: golden.id, itemId: 'cage' } },
    );
  }
  const aside =
    '<aside class="ws-layer" data-ws-layer="L4" role="dialog" aria-labelledby="ws-layer-title" data-ws-id="supplyRequirements#r1">' +
    '<h2 id="ws-layer-title">케이지</h2><h3>왜</h3><p>바닥 면적이 넓어야 해요</p></aside>';

  it('부모 홈 B + dialog 안 원본 aside(제목은 레이어 제목으로), 닫으면 부모 경로로 replaceState', async () => {
    window.history.replaceState(null, '', '/hamster/golden/supplies/cage');
    mount(l4Page(), '<main class="ws-page" data-ws-route="TYPE"><h1>골든햄스터</h1></main>', aside);
    // 부모 = 홈 B
    expect(document.querySelector('main.ws-home-b')).not.toBeNull();
    const dlg = screen.getByRole('dialog', { name: '케이지' });
    const inner = dlg.querySelector('aside.ws-layer[data-ws-layer="L4"]');
    expect(inner).not.toBeNull();
    expect(inner).not.toHaveAttribute('role');
    expect(inner?.textContent).toBe('왜바닥 면적이 넓어야 해요');
    expect(dlg.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/hamster/golden');
    expect(document.querySelector('main.ws-home-b')).not.toBeNull();
  });

  it('패널 안 aside 는 position:fixed 가 아니고(스타일 적용 상태), 머리(제목·✕)가 내용보다 앞 — ✕ 를 내용이 덮지 않는다', () => {
    const style = document.createElement('style');
    style.textContent = `${appCss}\n${layerStaticCss}`;
    mount(l4Page(), '<main class="ws-page" data-ws-route="TYPE"><h1>골든햄스터</h1></main>', aside);
    document.head.appendChild(style);
    try {
      const dlg = screen.getByRole('dialog', { name: '케이지' });
      const inner = dlg.querySelector('aside.ws-layer') as HTMLElement;
      expect(inner).toHaveClass('ws-layer--static');
      expect(getComputedStyle(inner).position).toBe('static');
      expect(getComputedStyle(inner).boxShadow === '' || getComputedStyle(inner).boxShadow === 'none').toBe(true);
      // 원본(하이드레이션 전) aside 규칙은 여전히 fixed — 무력화가 패널 안에서만 걸린다는 대조.
      const bare = document.createElement('aside');
      bare.className = 'ws-layer';
      document.body.appendChild(bare);
      expect(getComputedStyle(bare).position).toBe('fixed');
      bare.remove();
      const close = screen.getByRole('button', { name: '닫기' });
      const head = close.closest('.ws-layer-head') as HTMLElement;
      expect(head).not.toBeNull();
      expect(head.compareDocumentPosition(inner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(head.contains(inner)).toBe(false);
    } finally {
      style.remove();
    }
  });

  it('보관 aside 가 없으면(dev) 레이어 없이 부모만', () => {
    mount(l4Page(), '<main class="ws-page" data-ws-route="TYPE"></main>');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('main.ws-home-b')).not.toBeNull();
  });
});
