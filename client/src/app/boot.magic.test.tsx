// boot — 매직링크 토큰(/save#t=)은 boot() 첫 줄에서 지워진다: 렌더·L8 지연 청크·어떤 fetch 보다 먼저(C-R5-2 · D1).
//   createRoot().render 는 act 밖에서 비동기로 예약되므로, boot() 가 돌아온 직후엔 아직 렌더·동적 import·fetch 가 0 —
//   그 시점에 location.hash === '' 이면 토큰 제거가 그것들보다 앞이라는 뜻이다. 이후 일어나는 fetch 도 전부 hash '' 에서.
import { act } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageOf } from '../test/fixtures';
import { layerStore } from '../ui/layer/useLayer';
import { boot } from './boot';

const TOKEN = 'A'.repeat(43);
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  act(() => layerStore.resetForTest());
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

describe('boot: 매직링크 토큰 선제거', () => {
  it('/save#t=… → boot() 직후(렌더·지연 청크·fetch 전) hash 비움, 이후 fetch 도 hash 비어 있음, 경로·state 유지', async () => {
    const hashAtFetch: string[] = [];
    const fetchSpy = vi.fn((input: unknown) => {
      hashAtFetch.push(window.location.hash);
      void input;
      return Promise.reject(new Error('network disabled in test'));
    });
    vi.stubGlobal('fetch', fetchSpy);
    window.history.replaceState({ keep: 1 }, '', `/save#t=${TOKEN}`);
    const page = pageOf('SAVE', {}, { path: '/save' });
    document.body.innerHTML =
      '<div id="root" data-ws-prerendered="1"><main class="ws-page" data-ws-route="SAVE"></main></div>' +
      `<script id="ws-data" type="application/json">${JSON.stringify(page)}</script>`;

    root = boot(document, window.location);
    // 아직 렌더 전(act 밖 = 예약만) — 토큰은 이미 URL 에 없다.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.pathname).toBe('/save');
    expect((window.history.state as { keep?: number } | null)?.keep).toBe(1);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    for (const h of hashAtFetch) expect(h).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
  });
});
