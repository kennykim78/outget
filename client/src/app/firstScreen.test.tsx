// R7 성능 O1 — 지연 청크(레이어 L1·L2·L4·L5·L7·L8, /vet)의 미로딩 경로.
//   전역 설정(test/setup)은 청크를 미리 불러 두므로, 여기서는 vi.resetModules() 로 새 모듈 그래프(청크 미로딩 상태)를 만든다.
//   - 딥링크 부팅: 청크 전에는 React 첫 렌더를 미뤄 프리렌더 main·aside 가 그대로(빈 패널·레이아웃 점프 0), 받은 뒤 React 레이어로 교체.
//   - preloadable: 미로딩 = Suspense fallback(레이어 껍데기 패턴), 로딩 후 마운트 = 같은 렌더(대기 0), 청크 오류 = ChunkBoundary fallback.
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { Suspense, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WsPageData } from '@ws/engine';
import { golden, pageOf, req } from '../test/fixtures';

let root: Root | null = null;
let resetStore: (() => void) | null = null;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  act(() => resetStore?.());
  resetStore = null;
  document.body.innerHTML = '';
  document.documentElement.style.overflow = '';
});

function writeDoc(page: WsPageData, inner: string): void {
  document.body.innerHTML =
    `<div id="root" data-ws-prerendered="1">${inner}</div>` +
    `<script id="ws-data" type="application/json">${JSON.stringify(page).replace(/</g, '\\u003c')}</script>`;
}

describe('firstScreenChunks(새 모듈 그래프 = 청크 미로딩)', () => {
  it('홈·타입 홈(딥링크 아님) = null(동기 렌더), L4 딥링크·/vet = 대기 후 null', async () => {
    const { firstScreenChunks } = await import('./firstScreen');
    expect(firstScreenChunks(pageOf('HOME'), null)).toBeNull();
    expect(firstScreenChunks(pageOf('TYPE', {}, { typeId: golden.id, path: '/hamster/golden' }), null)).toBeNull();
    const l4 = pageOf('TYPE', { requirements: [req('cage', 'REQUIRED', '케이지')] }, {
      typeId: golden.id,
      path: '/hamster/golden/supplies/cage',
      layer: { kind: 'L4', typeId: golden.id, itemId: 'cage' },
    });
    const wait = firstScreenChunks(l4, null);
    expect(wait).not.toBeNull();
    await wait;
    expect(firstScreenChunks(l4, null)).toBeNull();
    const vet = pageOf('VET', {}, { path: '/vet' });
    const vw = firstScreenChunks(vet, null);
    expect(vw).not.toBeNull();
    await vw;
    expect(firstScreenChunks(vet, null)).toBeNull();
  }, 30000);
});

describe('딥링크 부팅 — 청크 전 프리렌더 유지', () => {
  it('L4: boot 직후 = 프리렌더 main·aside 그대로(React 렌더 0), 청크 후 = React L4(제목 = 용품명) + 정적 aside 0', async () => {
    const page = pageOf('TYPE', { requirements: [req('cage', 'REQUIRED', '케이지')] }, {
      typeId: golden.id,
      path: '/hamster/golden/supplies/cage',
      layer: { kind: 'L4', typeId: golden.id, itemId: 'cage' },
    });
    window.history.replaceState(null, '', '/hamster/golden/supplies/cage');
    writeDoc(
      page,
      '<main class="ws-page" data-ws-route="TYPE"><h1>골든햄스터</h1></main>' +
        '<div class="ws-scrim" aria-hidden="true"></div>' +
        '<aside class="ws-layer" data-ws-layer="L4" role="dialog" aria-labelledby="ws-layer-title" data-ws-id="supplyRequirements#req-cage">' +
        '<h2 id="ws-layer-title">케이지</h2><p>바닥 면적이 넓어야 해요</p></aside>',
    );
    const { layerStore } = await import('../ui/layer/useLayer');
    resetStore = () => layerStore.resetForTest();
    const { boot } = await import('./boot');
    root = boot(document, { pathname: page.route.path });
    // 첫 렌더 대기 중: 프리렌더 그대로 — 빈 화면·빈 패널 0.
    expect(document.getElementById('root')).toHaveAttribute('data-ws-prerendered', '1');
    expect(document.querySelectorAll('aside.ws-layer')).toHaveLength(1);
    expect(document.querySelector('main[data-ws-route="TYPE"] h1')?.textContent).toBe('골든햄스터');
    expect(document.querySelector('.ws-layer-root')).toBeNull();
    // 청크 후: React 레이어(같은 data-ws-id) + 홈 B, 정적 aside 0. (정적 aside 도 role=dialog·같은 이름이라 React 패널 루트를 기다린다.)
    await waitFor(() => expect(document.querySelector('.ws-layer-root [role="dialog"]')).not.toBeNull(), { timeout: 15000 });
    const dlg = screen.getByRole('dialog', { name: '케이지' });
    expect(dlg.closest('.ws-layer-root')).not.toBeNull();
    expect(dlg).toHaveAttribute('data-ws-layer', 'L4');
    expect(dlg).toHaveAttribute('data-ws-id', 'supplyRequirements#req-cage');
    expect(document.querySelectorAll('aside.ws-layer')).toHaveLength(0);
    expect(document.querySelector('main.ws-home-b')).not.toBeNull();
    expect(document.getElementById('root')).not.toHaveAttribute('data-ws-prerendered');
  }, 30000);
});

describe('installLayerWarmup', () => {
  it('입력 전 = 받지 않음, 첫 pointerover 한 번에 L1·L2·L4·L7 청크, 이후 리스너 해제', async () => {
    const { installLayerWarmup, layerLoaded, WARMUP_LAYERS } = await import('./layerRegistry');
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const off = installLayerWarmup(document);
    expect(WARMUP_LAYERS).toEqual(['L1', 'L2', 'L4', 'L7']);
    expect(WARMUP_LAYERS.some((k) => layerLoaded(k))).toBe(false);
    document.body.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(remove).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(WARMUP_LAYERS.every((k) => layerLoaded(k))).toBe(true), { timeout: 15000 });
    expect(layerLoaded('L5')).toBe(false);
    expect(layerLoaded('L8')).toBe(false);
    expect(add).toHaveBeenCalledTimes(3);
    off();
    add.mockRestore();
    remove.mockRestore();
  }, 30000);
});

describe('preloadable', () => {
  function deferred() {
    let resolve!: (m: { default: ComponentType<{ label: string }> }) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<{ default: ComponentType<{ label: string }> }>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const Impl = ({ label }: { label: string }) => <p>내용 {label}</p>;

  it('미로딩 = Suspense fallback → 로드 후 내용, load 는 한 번만', async () => {
    const { preloadable } = await import('./preloadable');
    const d = deferred();
    const load = vi.fn(() => d.promise);
    const c = preloadable(load, 'T');
    expect(c.loaded()).toBe(false);
    render(
      <Suspense fallback={<p>대기</p>}>
        <c.Component label="a" />
      </Suspense>,
    );
    expect(screen.getByText('대기')).toBeInTheDocument();
    void c.preload();
    await act(async () => d.resolve({ default: Impl }));
    expect(await screen.findByText('내용 a')).toBeInTheDocument();
    expect(c.loaded()).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('로드 후 마운트 = 같은 렌더(fallback 0)', async () => {
    const { preloadable } = await import('./preloadable');
    const c = preloadable(() => Promise.resolve({ default: Impl }), 'T');
    await c.preload();
    render(
      <Suspense fallback={<p>대기</p>}>
        <c.Component label="b" />
      </Suspense>,
    );
    expect(screen.getByText('내용 b')).toBeInTheDocument();
    expect(screen.queryByText('대기')).toBeNull();
  });

  it('청크 오류 = ChunkBoundary fallback(페이지 유지), 다음 preload 는 다시 시도', async () => {
    const { preloadable, ChunkBoundary } = await import('./preloadable');
    const d = deferred();
    let calls = 0;
    const c = preloadable(() => (++calls === 1 ? d.promise : Promise.resolve({ default: Impl })), 'T');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ChunkBoundary fallback={<p>보관 본문</p>}>
        <Suspense fallback={<p>대기</p>}>
          <c.Component label="c" />
        </Suspense>
      </ChunkBoundary>,
    );
    await act(async () => {
      d.reject(new Error('offline'));
      await d.promise.catch(() => undefined);
    });
    expect(await screen.findByText('보관 본문')).toBeInTheDocument();
    spy.mockRestore();
    await c.preload();
    expect(calls).toBe(2);
    expect(c.loaded()).toBe(true);
  });
});
