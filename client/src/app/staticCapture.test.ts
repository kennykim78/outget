// captureStatic — mount 전 #root 의 정적 HTML 보관(F0 (e)).
import { describe, expect, it } from 'vitest';
import { captureStatic } from './staticCapture';

describe('captureStatic', () => {
  it('#root 안 main.ws-page outerHTML 과 aside.ws-layer 식별 속성(HTML 아님)을 보관한다', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<main class="ws-page" data-ws-route="TYPE"><h1>골든햄스터</h1></main>' +
      '<aside class="ws-layer" data-ws-layer="L4" data-ws-id="supplyRequirements#r1" role="dialog"><h2>케이지</h2></aside>';
    const c = captureStatic(root);
    expect(c.main).toBe('<main class="ws-page" data-ws-route="TYPE"><h1>골든햄스터</h1></main>');
    expect(c.layer).toEqual({ kind: 'L4', wsId: 'supplyRequirements#r1' });
  });

  it('없으면 null, root 가 null 이어도 throw 하지 않는다', () => {
    const root = document.createElement('div');
    root.innerHTML = '<main><p>x</p></main>';
    expect(captureStatic(root)).toEqual({ main: null, layer: null });
    expect(captureStatic(null)).toEqual({ main: null, layer: null });
  });

  it('stripProducts: 상품 추천 표면(섹션·ul·li·curatedProducts# 식별자·L4 products 파트)만 빼고 보관, 원본 DOM 은 그대로', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<main class="ws-page"><h1>골든햄스터</h1>' +
      '<section data-ws-section="products"><ul class="ws-products"><li class="ws-product" data-ws-id="curatedProducts#p1">카드</li></ul></section>' +
      '<section data-ws-part="products"><p>L4 상품</p></section><p data-ws-id="curatedProducts#p2">단독</p>' +
      '<section data-ws-section="mall"><h2>몰에 올라온 상품</h2></section>' +
      '<section data-ws-section="vet"><a href="/vet">병원</a></section></main>';
    const c = captureStatic(root, { stripProducts: true });
    expect(c.main).not.toMatch(/ws-product|curatedProducts|data-ws-section="products"|data-ws-part="products"|data-ws-section="mall"|몰에 올라온|카드|단독|L4 상품/);
    expect(c.main).toContain('<h1>골든햄스터</h1>');
    expect(c.main).toContain('href="/vet"');
    expect(root.querySelectorAll('li.ws-product')).toHaveLength(1);
    expect(captureStatic(root).main).toContain('curatedProducts#p1');
  });
  it('383: aside 의 대안 목록은 품목 id·이름만 보관한다', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<main class="ws-page"></main><aside class="ws-layer" data-ws-layer="L4" data-ws-id="supplyRequirements#r"><section data-ws-part="alternatives"><ul><li data-ws-id="supplyItems#saucer"><a href="/x/supplies/saucer">플라잉소서</a></li></ul></section></aside>';
    expect(captureStatic(root).layer).toEqual({ kind: 'L4', wsId: 'supplyRequirements#r', alternatives: [{ itemId: 'saucer', name: '플라잉소서' }] });
  });
});
