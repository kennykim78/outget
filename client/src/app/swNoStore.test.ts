// 377 S1 — SW ws-html 은 no-store 응답(피드 변형 HTML)을 담지도 내놓지도 않는다. 기존 동작(200·0 만 저장)은 유지.
import { describe, expect, it } from 'vitest';
import { wsHtmlNoStore } from '../../build/swNoStore';
import viteConfig from '../../vite.config.ts?raw';

const res = (status: number, cacheControl?: string): Response =>
  ({ status, headers: new Headers(cacheControl ? { 'cache-control': cacheControl } : {}) }) as Response;

describe('wsHtmlNoStore', () => {
  it('저장: 200·0(opaqueredirect) 만, no-store 는 버린다', async () => {
    const ok = res(200, 'public, max-age=0');
    const redirect = res(0);
    expect(await wsHtmlNoStore.cacheWillUpdate({ response: ok })).toBe(ok);
    expect(await wsHtmlNoStore.cacheWillUpdate({ response: redirect })).toBe(redirect);
    for (const r of [res(200, 'no-store'), res(200, 'private, No-Store'), res(404), res(500)]) {
      expect(await wsHtmlNoStore.cacheWillUpdate({ response: r })).toBeNull();
    }
  });

  it('꺼내기: 예전 SW 가 담아 둔 no-store 응답은 오프라인에서도 내놓지 않는다', async () => {
    const ok = res(200);
    expect(await wsHtmlNoStore.cachedResponseWillBeUsed({ cachedResponse: ok })).toBe(ok);
    expect(await wsHtmlNoStore.cachedResponseWillBeUsed({ cachedResponse: res(200, 'no-store') })).toBeNull();
    expect(await wsHtmlNoStore.cachedResponseWillBeUsed({ cachedResponse: undefined })).toBeNull();
  });

  it('vite.config 의 ws-html 항목에 연결돼 있다', () => {
    expect(viteConfig).toMatch(/cacheName: 'ws-html',[\s\S]{0,300}plugins: \[wsHtmlNoStore\]/);
  });
});
