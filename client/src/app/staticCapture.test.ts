// captureStatic — mount 전 #root 의 정적 HTML 보관(F0 (e)).
import { describe, expect, it } from 'vitest';
import { captureStatic } from './staticCapture';

describe('captureStatic', () => {
  it('#root 안 main.ws-page·aside.ws-layer outerHTML 을 보관한다', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<main class="ws-page" data-ws-route="TYPE"><h1>골든햄스터</h1></main>' +
      '<aside class="ws-layer" data-ws-layer="L4" role="dialog"><h2>케이지</h2></aside>';
    const c = captureStatic(root);
    expect(c.main).toBe('<main class="ws-page" data-ws-route="TYPE"><h1>골든햄스터</h1></main>');
    expect(c.layer).toContain('data-ws-layer="L4"');
  });

  it('없으면 null, root 가 null 이어도 throw 하지 않는다', () => {
    const root = document.createElement('div');
    root.innerHTML = '<main><p>x</p></main>';
    expect(captureStatic(root)).toEqual({ main: null, layer: null });
    expect(captureStatic(null)).toEqual({ main: null, layer: null });
  });
});
