// F8: 미구현 라우트 = 셸 + StaticMain(같은 문서 보관 main).
// R5 F1-1: 레이어 딥링크 = 부모(홈 B·홈 A) + ws-data 로 마운트한 React 레이어(R4 정적 레이어 보관 렌더 삭제, 스펙33 §2.1).
//   정적 div.ws-scrim·aside.ws-layer 0(이중 aside 0), 패널 data-ws-layer·data-ws-id 유지, 닫기 = replaceState(부모)·history.length 불변.
//   F1-2: L4 프리렌더 why·조건 문장 ⊆ React 텍스트.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COPY } from '@ws/copy';
import { ruleText, type RouteKind, type WsPageData } from '@ws/engine';
import { golden, pageOf, product, req } from '../test/fixtures';
import { layerStore, readLayerState } from '../ui/layer/useLayer';
import { boot } from './boot';
import appCss from '../styles/app.css?raw';

let root: Root | null = null;

function mount(page: WsPageData, mainHtml: string, asideHtml = ''): void {
  document.body.innerHTML =
    `<div id="root" data-ws-prerendered="1"><header class="ws-header"><a class="ws-logo" href="/">WithSmall</a></header>${mainHtml}` +
    (asideHtml ? `<div class="ws-scrim" aria-hidden="true"></div>${asideHtml}` : '') +
    `<footer class="ws-footer"><p>x</p></footer></div>` +
    `<script id="ws-data" type="application/json">${JSON.stringify(page).replace(/</g, '<')}</script>`;
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
  act(() => layerStore.resetForTest());
  document.body.innerHTML = '';
  document.documentElement.style.overflow = '';
});

const STATIC_KINDS: Array<[RouteKind, string]> = [
  ['FAMILY', '/hamster'],
  ['SETUP', '/hamster/golden/setup'],
  ['SUPPLIES', '/supplies'],
  ['SUPPLY_ITEM', '/supplies/cage'],
  ['SUPPLY_ITEM_TYPE', '/supplies/cage/hamster/golden'],
  // VET·VET_REGION 은 R5 F3-1 부터 React(vet/VetPage) — vet/VetPage.test.tsx.
  ['CREDITS', '/credits'],
  ['PRIVACY', '/privacy'],
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
    expect(document.querySelector('footer.ws-footer a[href="/privacy"]')).not.toBeNull();
    expect(document.querySelector('header.ws-header a[data-ws-chip]')).not.toBeNull();
  });
});

describe('boot 표식 제거 시점', () => {
  it('render 직후엔 data-ws-prerendered 유지, 첫 커밋 뒤에 제거', async () => {
    const page = pageOf('CREDITS', {}, { path: '/credits' });
    document.body.innerHTML =
      '<div id="root" data-ws-prerendered="1"><main class="ws-page" data-ws-route="CREDITS"><h1>x</h1></main></div>' +
      `<script id="ws-data" type="application/json">${JSON.stringify(page).replace(/</g, '<')}</script>`;
    root = boot(document, { pathname: page.route.path }); // act 밖 = 비동기 렌더 그대로
    expect(document.getElementById('root')).toHaveAttribute('data-ws-prerendered', '1');
    await waitFor(() => expect(document.getElementById('root')).not.toHaveAttribute('data-ws-prerendered'));
  });
});

describe('R5 딥링크 레이어(ws-data → React)', () => {
  const data = { requirements: [req('cage', 'REQUIRED', '케이지')], products: [product('p1', 'cage', '합성 케이지')] };
  function typePage(path: string, layer: WsPageData['layer']): WsPageData {
    return pageOf('TYPE', data, { typeId: golden.id, path, layer });
  }
  const typeMain = '<main class="ws-page" data-ws-route="TYPE"><h1>골든햄스터</h1></main>';
  const asideL4 =
    '<aside class="ws-layer" data-ws-layer="L4" role="dialog" aria-labelledby="ws-layer-title" data-ws-id="supplyRequirements#req-cage">' +
    '<h2 id="ws-layer-title">케이지</h2><h3>왜</h3><p>바닥 면적이 넓어야 해요</p></aside>';

  it('L4: 부모 홈 B + React 레이어(제목 = 용품명), 정적 aside·스크림 0, data-ws-layer·data-ws-id 유지', () => {
    window.history.replaceState(null, '', '/hamster/golden/supplies/cage');
    mount(typePage('/hamster/golden/supplies/cage', { kind: 'L4', typeId: golden.id, itemId: 'cage' }), typeMain, asideL4);
    expect(document.querySelector('main.ws-home-b')).not.toBeNull();
    const dlg = screen.getByRole('dialog', { name: '케이지' });
    expect(dlg).toHaveAttribute('data-ws-layer', 'L4');
    expect(dlg).toHaveAttribute('data-ws-id', 'supplyRequirements#req-cage');
    expect(document.querySelectorAll('aside.ws-layer')).toHaveLength(0);
    expect(document.querySelectorAll('.ws-scrim')).toHaveLength(1);
    expect(document.querySelector('.ws-scrim')).toHaveAttribute('data-ws-scrim');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(readLayerState(window.history.state)).toMatchObject({ wsLayer: 'L4', wsDepth: 0, wsParent: '/hamster/golden' });
  });

  it('F1-2: 프리렌더 aside 의 왜·조건 문장 ⊆ React L4 텍스트(같은 ws-data, 엔진 ruleText 단일 소스)', () => {
    const schema = { fields: [{ key: 'diameterCm', label: '지름(cm)', type: 'number' as const, min: 1, max: 100 }] };
    const minRule = { key: 'diameterCm', op: 'gte' as const, value: 28, reason: '등이 굽지 않는 최소 지름' };
    const recRule = { key: 'diameterCm', op: 'gte' as const, value: 30, reason: '' };
    const base = req('wheel', 'REQUIRED', '쳇바퀴');
    const wheel = {
      ...base,
      why: '척추가 휘지 않게 큰 바퀴가 필요해요',
      minSpec: { rules: [minRule] },
      recommendedSpec: { rules: [recRule] },
      item: { ...base.item, specSchema: schema },
    };
    // 프리렌더 layerL4(server/src/prerender/pages/type.ts)와 같은 조립: <li>{ruleText}{reason ? ` — ${reason}` : ''}</li>
    const li = (r: typeof minRule) => `<li>${ruleText(schema, r)}${r.reason ? ` — ${r.reason}` : ''}</li>`;
    const aside =
      `<aside class="ws-layer" data-ws-layer="L4" role="dialog" data-ws-id="supplyRequirements#${wheel.requirementId}">` +
      `<h2 id="ws-layer-title">쳇바퀴</h2><section data-ws-part="why"><h3>왜</h3><p>${wheel.why}</p></section>` +
      `<section data-ws-part="conditions"><h3>조건</h3><h4>최소</h4><ul>${li(minRule)}</ul><h4>권장</h4><ul>${li(recRule)}</ul></section></aside>`;
    const sentences = Array.from(
      new DOMParser().parseFromString(aside, 'text/html').querySelectorAll('[data-ws-part="why"] p, [data-ws-part="conditions"] li'),
    ).map((el) => (el.textContent ?? '').trim());
    expect(sentences).toHaveLength(3);
    window.history.replaceState(null, '', '/hamster/golden/supplies/wheel');
    mount(
      pageOf('TYPE', { requirements: [wheel] }, { typeId: golden.id, path: '/hamster/golden/supplies/wheel', layer: { kind: 'L4', typeId: golden.id, itemId: 'wheel' } }),
      typeMain,
      aside,
    );
    const text = screen.getByRole('dialog', { name: '쳇바퀴' }).textContent ?? '';
    for (const s of sentences) expect(text).toContain(s);
  });

  it('L4 딥링크 닫기(✕): replaceState(부모 /{slug}) · history.length 불변 · 부모 유지', async () => {
    window.history.replaceState(null, '', '/hamster/golden/supplies/cage');
    mount(typePage('/hamster/golden/supplies/cage', { kind: 'L4', typeId: golden.id, itemId: 'cage' }), typeMain, asideL4);
    const len = window.history.length;
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: COPY.supplyLayer.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/hamster/golden');
    expect(window.history.length).toBe(len);
    expect(readLayerState(window.history.state)).toBeNull();
    expect(document.querySelector('main.ws-home-b')).not.toBeNull();
  });

  it('L4 딥링크 ESC 닫기도 같은 경로', async () => {
    window.history.replaceState(null, '', '/hamster/golden/supplies/cage');
    mount(typePage('/hamster/golden/supplies/cage', { kind: 'L4', typeId: golden.id, itemId: 'cage' }), typeMain, asideL4);
    const len = window.history.length;
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/hamster/golden');
    expect(window.history.length).toBe(len);
  });

  it('L7: 제목 = 상품명, data-ws-id = curatedProducts#{id}', () => {
    window.history.replaceState(null, '', '/hamster/golden/products/p1');
    const aside = '<aside class="ws-layer" data-ws-layer="L7" role="dialog" data-ws-id="curatedProducts#p1"><h2 id="ws-layer-title">합성 케이지</h2></aside>';
    mount(typePage('/hamster/golden/products/p1', { kind: 'L7', typeId: golden.id, productId: 'p1' }), typeMain, aside);
    const dlg = screen.getByRole('dialog', { name: '합성 케이지' });
    expect(dlg).toHaveAttribute('data-ws-id', 'curatedProducts#p1');
    expect(document.querySelectorAll('aside.ws-layer')).toHaveLength(0);
  });

  it('L5: 지연 청크(불러온 뒤 첫 커밋) — 껍데기·내용·용품명 제목이 같은 커밋에(빈 패널·제목 점프 0, R7 O1)', () => {
    window.history.replaceState(null, '', '/hamster/golden/check/cage');
    mount(typePage('/hamster/golden/check/cage', { kind: 'L5', typeId: golden.id, itemId: 'cage' }), typeMain);
    const dlg = screen.getByRole('dialog', { name: new RegExp(`^${COPY.checkLayer.title}`) });
    expect(dlg).toHaveAttribute('data-ws-layer', 'L5');
    expect(dlg).toHaveAttribute('data-ws-id', 'supplyRequirements#req-cage');
    expect(dlg.querySelector('[data-ws-step="L5"]')).not.toBeNull();
  });

  it('보관 aside 가 없어도(dev) ws-data 로 레이어를 연다', () => {
    window.history.replaceState(null, '', '/hamster/golden/supplies/cage');
    mount(typePage('/hamster/golden/supplies/cage', { kind: 'L4', typeId: golden.id, itemId: 'cage' }), typeMain);
    // 보관 aside 가 없어도 data-ws-id 는 ws-data requirementId 에서(프리렌더 aside 와 같은 형식).
    expect(screen.getByRole('dialog', { name: '케이지' })).toHaveAttribute('data-ws-id', 'supplyRequirements#req-cage');
    expect(document.querySelector('main.ws-home-b')).not.toBeNull();
  });

  it('/save: 부모 홈 A + L8, 저장 타입 없으면 닫기 = replaceState("/")', async () => {
    window.history.replaceState(null, '', '/save');
    mount(pageOf('SAVE', {}, { path: '/save' }), '<main class="ws-page" data-ws-route="SAVE"></main>');
    expect(screen.getByRole('dialog', { name: COPY.save.title })).toHaveAttribute('data-ws-layer', 'L8');
    expect(readLayerState(window.history.state)).toMatchObject({ wsLayer: 'L8', wsParent: '/', wsDepth: 0 });
    const len = window.history.length;
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/');
    expect(window.history.length).toBe(len);
  });

  it('K1 /pick: 부모 홈 A + L1(정적 aside 걷힘), 닫기 = replaceState("/") · history.length 불변', async () => {
    const kind: RouteKind = 'PICK';
    window.history.replaceState(null, '', '/pick');
    mount(
      pageOf(kind, {}, { path: '/pick' }),
      `<main class="ws-page" data-ws-route="${kind}"></main>`,
      '<aside class="ws-layer" data-ws-layer="L1"><h2>친구</h2><a href="/">닫기</a></aside>',
    );
    const d = screen.getByRole('dialog', { name: COPY.picker.title });
    expect(d).toHaveAttribute('data-ws-layer', 'L1');
    expect(document.querySelectorAll('aside.ws-layer')).toHaveLength(0);
    expect(document.querySelector('div.ws-scrim:not([data-ws-scrim])')).toBeNull();
    expect(document.querySelector('[data-ws-section="hero"]')).not.toBeNull();
    expect(readLayerState(window.history.state)).toMatchObject({ wsLayer: 'L1', wsParent: '/', wsDepth: 0 });
    expect(window.location.pathname).toBe('/pick');
    const len = window.history.length;
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/');
    expect(window.history.length).toBe(len);
    expect(readLayerState(window.history.state)).toBeNull();
  });

  it('타입 홈(딥링크 아님)은 레이어 없음 + 이전 문서가 남긴 레이어 state 정리', () => {
    window.history.replaceState({ wsLayer: 'L2', wsLayerProps: {}, wsParent: '/hamster/golden', wsDepth: 1 }, '', '/hamster/golden');
    mount(typePage('/hamster/golden', null), typeMain);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readLayerState(window.history.state)).toBeNull();
  });

  it('JS 꺼짐 최소 CSS(app.css): 정적 aside.ws-layer 는 fixed, 스크림도 fixed', () => {
    const style = document.createElement('style');
    style.textContent = appCss;
    document.head.appendChild(style);
    try {
      const scrim = document.createElement('div');
      scrim.className = 'ws-scrim';
      const bare = document.createElement('aside');
      bare.className = 'ws-layer';
      document.body.append(scrim, bare);
      expect(getComputedStyle(bare).position).toBe('fixed');
      expect(getComputedStyle(scrim).position).toBe('fixed');
    } finally {
      style.remove();
    }
  });
});

describe('R5 SPA push(C-R5-5)', () => {
  const page = pageOf(
    'TYPE',
    { requirements: [req('cage', 'REQUIRED', '케이지'), req('wheel', 'REQUIRED', '쳇바퀴')], products: [product('p1', 'cage')] },
    { typeId: golden.id, path: '/hamster/golden' },
  );
  const typeMain = '<main class="ws-page" data-ws-route="TYPE"><h1>골든햄스터</h1></main>';

  it('L2 행 › → L4 push(URL /{slug}/supplies/{item}), 뒤로 = L2, 다시 뒤로 = 닫힘', async () => {
    window.history.replaceState(null, '', '/hamster/golden');
    mount(page, typeMain);
    act(() => layerStore.open('L2'));
    const l2 = screen.getByRole('dialog');
    fireEvent.click(within(l2).getByRole('button', { name: COPY.setupQ.skip }));
    const more = within(screen.getByRole('dialog')).getByRole('link', {
      name: COPY.checklist.itemDetailAria.replace('{name}', '케이지'),
    });
    const len = window.history.length;
    fireEvent.click(more);
    expect(window.location.pathname).toBe('/hamster/golden/supplies/cage');
    expect(window.history.length).toBe(len + 1);
    expect(screen.getByRole('dialog', { name: '케이지' })).toHaveAttribute('data-ws-layer', 'L4');
    // 클릭으로 연 L4 도 프리렌더 aside 와 같은 data-ws-id(ws-data requirementId).
    expect(screen.getByRole('dialog', { name: '케이지' })).toHaveAttribute('data-ws-id', 'supplyRequirements#req-cage');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-ws-layer', 'L2'));
    expect(window.location.pathname).toBe('/hamster/golden');
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('홈 B 상품 카드 → L7 push, ✕ = 부모로(레이어 state 없음)', async () => {
    window.history.replaceState(null, '', '/hamster/golden');
    mount(page, typeMain);
    const card = document.querySelector('a[href="/hamster/golden/products/p1"]') as HTMLElement;
    expect(card).not.toBeNull();
    fireEvent.click(card);
    expect(window.location.pathname).toBe('/hamster/golden/products/p1');
    expect(screen.getByRole('dialog')).toHaveAttribute('data-ws-layer', 'L7');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: COPY.supplyLayer.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/hamster/golden');
    expect(readLayerState(window.history.state)).toBeNull();
  });
});

describe('QA-M D1: ws-data 거부(BELOW_MIN 주입) → 상품 추천 표면 렌더 0(fail-closed)', () => {
  // 프리렌더 type.ts 표식 그대로(:59 li.ws-product[data-ws-id], :123 ul.ws-products, :139 section[data-ws-section=products]).
  const card = (id: string) =>
    `<li class="ws-product" data-ws-id="curatedProducts#${id}"><a href="/hamster/golden/products/${id}"><span class="ws-product-title">픽스처 쳇바퀴 ${id}</span></a><span class="ws-like" aria-hidden="true">♡</span></li>`;
  const homeMain =
    '<main class="ws-page" data-ws-route="TYPE"><section class="ws-context"><h1>골든햄스터</h1></section>' +
    '<section data-ws-section="now"><h2>지금 필요한 것</h2></section>' +
    `<section data-ws-section="products"><h2>기준에 맞는 준비물</h2><ul class="ws-products">${card('cp-001')}${card('cp-002')}</ul></section>` +
    '<section data-ws-section="vet"><h2>우리 동네 병원</h2><p><a href="/vet">병원 보기</a></p></section></main>';
  const asideL7 =
    '<aside class="ws-layer" data-ws-layer="L7" role="dialog" data-ws-id="curatedProducts#cp-001"><h2 id="ws-layer-title">픽스처 쳇바퀴 cp-001</h2></aside>';

  function tainted(path: string, layer: WsPageData['layer']): WsPageData {
    const p = pageOf('TYPE', { requirements: [req('wheel', 'REQUIRED', '쳇바퀴')], products: [product('cp-001', 'wheel', '픽스처 쳇바퀴 cp-001')] }, { typeId: golden.id, path, layer });
    // 미달 제품 주입 — readPageData 가 페이지 전체를 거부해야 한다.
    return { ...p, data: { ...p.data, products: [{ ...p.data.products[0], verdict: 'BELOW_MIN' as never }] } };
  }
  const productNodes = () =>
    document.querySelectorAll('li.ws-product, ul.ws-products, [data-ws-section="products"], [data-ws-part="products"], [data-ws-id^="curatedProducts#"]');

  it.each([
    ['홈 B /hamster/golden', '/hamster/golden', null, ''],
    ['상품 /hamster/golden/products/cp-001', '/hamster/golden/products/cp-001', { kind: 'L7' as const, typeId: golden.id, productId: 'cp-001' }, asideL7],
  ])('%s: 상품 카드·섹션·L7 0, 나머지 정적 본문 유지', (_label, path, layer, aside) => {
    window.history.replaceState(null, '', path);
    mount(tainted(path, layer), homeMain, aside);
    expect(productNodes()).toHaveLength(0);
    // 렌더된 화면(#root + 레이어 포털) 텍스트 — ws-data <script> JSON 은 화면이 아니다.
    const rendered = Array.from(document.body.children)
      .filter((el) => el.tagName !== 'SCRIPT')
      .map((el) => el.textContent ?? '')
      .join('');
    expect(rendered).not.toContain('픽스처 쳇바퀴');
    expect(screen.queryByRole('dialog')).toBeNull();
    // 나머지 정적 본문은 남는다(fail-closed 는 상품 표면만).
    expect(document.querySelector('[data-ws-static="main"] h1')).toHaveTextContent('골든햄스터');
    expect(document.querySelector('[data-ws-static="main"] [data-ws-section="vet"] a[href="/vet"]')).not.toBeNull();
  });

  it('대조: 유효한 ws-data 면 같은 상품 카드가 렌더된다(지우는 조건 = 거부일 때만)', () => {
    window.history.replaceState(null, '', '/hamster/golden');
    const ok = pageOf('TYPE', { requirements: [req('wheel', 'REQUIRED', '쳇바퀴')], products: [product('cp-001', 'wheel', '픽스처 쳇바퀴 cp-001')] }, { typeId: golden.id, path: '/hamster/golden' });
    mount(ok, homeMain);
    expect(document.querySelectorAll('li.ws-product')).toHaveLength(1);
  });
});
