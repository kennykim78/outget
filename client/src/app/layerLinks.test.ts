// app/layerLinks — 문서 안 링크 가로채기(C-R5-5): 같은 문서 ws-data 에 대상이 있으면 레이어 push, 없으면 기본 동작(문서 이동).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicAnimalType } from '@ws/engine';
import { golden, pageOf, product, req } from '../test/fixtures';
import { installLayerLinks, layerTargetFor } from './layerLinks';

const dwarf: PublicAnimalType = { ...golden, id: 'hamster-dwarf', slug: 'hamster/dwarf', displayName: '드워프햄스터' };

function goldenPage() {
  return pageOf(
    'TYPE',
    { types: [golden, dwarf], requirements: [req('cage', 'REQUIRED', '케이지')], products: [product('p1', 'cage')] },
    { typeId: golden.id, path: '/hamster/golden' },
  );
}

describe('layerTargetFor', () => {
  const page = goldenPage();
  it.each([
    ['/hamster/golden/supplies/cage', 'L4', { typeId: golden.id, itemId: 'cage' }],
    ['/hamster/golden/check/cage', 'L5', { typeId: golden.id, itemId: 'cage' }],
    ['/hamster/golden/products/p1', 'L7', { typeId: golden.id, productId: 'p1' }],
    ['/save', 'L8', {}],
  ])('%s → %s', (path, kind, props) => {
    expect(layerTargetFor(path, page)).toEqual({ kind, props, url: path });
  });

  it.each([
    ['다른 타입(문서 이동)', '/hamster/dwarf/supplies/cage'],
    ['ws-data 에 없는 용품', '/hamster/golden/supplies/wheel'],
    ['ws-data 에 없는 상품', '/hamster/golden/products/p9'],
    ['레이어 아닌 페이지', '/hamster/golden/setup'],
    ['타입 홈', '/hamster/golden'],
    ['/supplies/{item}/{type}', '/supplies/cage/hamster/golden'],
    ['병원', '/vet'],
  ])('%s → null', (_label, path) => {
    expect(layerTargetFor(path, page)).toBeNull();
  });
});

describe('installLayerLinks', () => {
  let uninstall: () => void = () => undefined;
  const open = vi.fn();

  beforeEach(() => {
    open.mockReset();
    document.body.innerHTML =
      '<a id="l4" href="/hamster/golden/supplies/cage">케이지</a>' +
      '<a id="other" href="/hamster/dwarf/supplies/cage">드워프 케이지</a>' +
      '<a id="blank" href="/hamster/golden/supplies/cage" target="_blank">새 창</a>' +
      '<a id="ext" href="https://example.com/hamster/golden/supplies/cage">외부</a>' +
      '<a id="save" href="/save"><span id="inner">저장</span></a>';
    uninstall = installLayerLinks(document, () => goldenPage(), open);
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  function click(id: string, init: MouseEventInit = {}): MouseEvent {
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    document.getElementById(id)?.dispatchEvent(e);
    return e;
  }

  it('같은 타입 ws-data 대상 → preventDefault + push(url 포함)', () => {
    const e = click('l4');
    expect(e.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('L4', { typeId: golden.id, itemId: 'cage' }, { url: '/hamster/golden/supplies/cage' });
  });

  it('링크 안 자식 요소 클릭도 같은 동작(/save → L8)', () => {
    const e = click('inner');
    expect(e.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('L8', {}, { url: '/save' });
  });

  it('타 타입 링크는 가로채지 않는다(문서 이동)', () => {
    const e = click('other');
    expect(e.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('target=_blank·외부 출처·보조 키·가운데 버튼은 기본 동작', () => {
    for (const [id, init] of [
      ['blank', {}],
      ['ext', {}],
      ['l4', { metaKey: true }],
      ['l4', { ctrlKey: true }],
      ['l4', { shiftKey: true }],
      ['l4', { button: 1 }],
    ] as Array<[string, MouseEventInit]>) {
      const e = click(id, init);
      if (id !== 'ext') expect(e.defaultPrevented).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('이미 preventDefault 된 클릭은 건드리지 않는다', () => {
    const a = document.getElementById('l4') as HTMLElement;
    a.addEventListener('click', (ev) => ev.preventDefault());
    click('l4');
    expect(open).not.toHaveBeenCalled();
  });

  it('해제 후에는 가로채지 않는다', () => {
    uninstall();
    const e = click('l4');
    expect(e.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
