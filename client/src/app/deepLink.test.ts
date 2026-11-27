// app/deepLink — 딥링크 레이어 판정(C-R5-5 · D-55).
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COPY, formatCopy } from '@ws/copy';
import type { WsLayer } from '@ws/engine';
import LayerHost from '../ui/layer/LayerHost';
import { layerNav, layerStore } from '../ui/layer/useLayer';
import { golden, pageOf } from '../test/fixtures';
import { deepLinkFor } from './deepLink';
import { routeView } from './routeView';

describe('deepLinkFor', () => {
  it('TYPE + L4: 부모 = 타입 홈, 보관 aside 의 data-ws-id 는 종류가 같을 때만', () => {
    const p = pageOf('TYPE', {}, { typeId: golden.id, path: '/hamster/golden/supplies/cage', layer: { kind: 'L4', typeId: golden.id, itemId: 'cage' } });
    expect(deepLinkFor(p, { kind: 'L4', wsId: 'supplyRequirements#r1' }, null)).toEqual({
      kind: 'L4',
      props: { typeId: golden.id, itemId: 'cage' },
      parent: '/hamster/golden',
      documentParent: false,
      wsId: 'supplyRequirements#r1',
      parentTitle: formatCopy(COPY.site.typeTitle, { animal: golden.displayName }) + COPY.site.titleSuffix,
    });
    expect(deepLinkFor(p, { kind: 'L7', wsId: 'curatedProducts#x' }, null)?.wsId).toBeNull();
  });

  it('TYPE + L7: productId props', () => {
    const p = pageOf('TYPE', {}, { typeId: golden.id, layer: { kind: 'L7', typeId: golden.id, productId: 'p1' } });
    expect(deepLinkFor(p, null, null)?.props).toEqual({ typeId: golden.id, productId: 'p1' });
  });

  describe('388 D2: TYPE 부모 제목', () => {
    const layers: WsLayer[] = [
      { kind: 'L4', typeId: golden.id, itemId: 'cage' },
      { kind: 'L5', typeId: golden.id, itemId: 'cage' },
      { kind: 'L7', typeId: golden.id, productId: 'p1' },
    ];
    it.each(layers)('$kind: SEO 원문을 보존하고, 키가 없으면 타입 제목을 쓴다', (layer) => {
      const seoTitle = '  골든햄스터 맞춤 제목  ';
      const withSeo = pageOf('TYPE', { types: [{ ...golden, seoTitle }] }, { typeId: golden.id, layer });
      expect(deepLinkFor(withSeo, null, null)?.parentTitle).toBe(seoTitle);
      // null·빈 문자열·공백 원문은 projectType에서 키 자체를 생략한다(서버 투영 시험으로 검증).
      const withoutSeo = pageOf('TYPE', {}, { typeId: golden.id, layer });
      expect(deepLinkFor(withoutSeo, null, null)?.parentTitle).toBe(
        formatCopy(COPY.site.typeTitle, { animal: golden.displayName }) + COPY.site.titleSuffix,
      );
    });

    it('L4 직접 진입 → ✕: 타입 홈 URL과 document.title로 복원한다', () => {
      const oldTitle = document.title;
      const oldUrl = window.location.href;
      const oldState: unknown = window.history.state;
      act(() => layerStore.resetForTest());
      const p = pageOf('TYPE', {}, { typeId: golden.id, path: '/hamster/golden/supplies/cage', layer: layers[0] });
      const link = deepLinkFor(p, null, null)!;
      window.history.replaceState(null, '', p.route.path);
      document.title = '케이지 레이어 제목';
      const view = render(createElement(LayerHost, { registry: { L4: { title: '케이지', Component: () => null } } }));
      try {
        act(() => layerStore.initDeepLink(link.kind, link.props, link.parent, link));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '닫기' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(window.location.pathname).toBe('/hamster/golden');
        expect(document.title).toBe(formatCopy(COPY.site.typeTitle, { animal: golden.displayName }) + COPY.site.titleSuffix);
      } finally {
        view.unmount();
        act(() => layerStore.resetForTest());
        window.history.replaceState(oldState, '', oldUrl);
        document.title = oldTitle;
      }
    });
  });

  it('SAVE: 저장 타입 있으면 부모 = 타입 홈(다른 문서), 없으면 "/"(같은 문서)', () => {
    const p = pageOf('SAVE', {}, { path: '/save' });
    expect(deepLinkFor(p, null, golden)).toMatchObject({ kind: 'L8', parent: '/hamster/golden', documentParent: true });
    expect(deepLinkFor(p, null, null)).toMatchObject({ kind: 'L8', parent: '/', documentParent: false });
  });

  it('K1 PICK(/pick): L1, 부모 = "/"(같은 문서 = 홈 A, 저장 타입 무관), 보관 aside wsId 는 L1 일 때만 · NOT_FOUND 는 null', () => {
    const p = pageOf('PICK', {}, { path: '/pick' });
    expect(deepLinkFor(p, null, golden)).toEqual({ kind: 'L1', props: {}, parent: '/', documentParent: false, wsId: null });
    expect(deepLinkFor(p, { kind: 'L1', wsId: 'pick#1' }, null)?.wsId).toBe('pick#1');
    expect(deepLinkFor(p, { kind: 'L4', wsId: 'x#1' }, null)?.wsId).toBeNull();
    expect(deepLinkFor(pageOf('NOT_FOUND', {}, { path: '/pick' }), null, null)).toBeNull();
    expect(routeView(p)).toEqual({ view: 'homeA' });
  });

  // 383(PRD 183-187): 용품으로 찾기의 /supplies/{item}/{type} 도 같은 L4. 부모 = /supplies/{item}(프리렌더 misc.ts 가 선언한 부모, 같은 문서).
  it('SUPPLY_ITEM_TYPE + L4: 부모 = /supplies/{item}(다른 문서 — 398 B-2), L4 아닌 레이어 → null', () => {
    const extra = { typeId: golden.id, path: '/supplies/cage/hamster-golden' };
    const p = pageOf('SUPPLY_ITEM_TYPE', {}, { ...extra, layer: { kind: 'L4', typeId: golden.id, itemId: 'cage' } });
    expect(deepLinkFor(p, { kind: 'L4', wsId: 'supplyRequirements#r1' }, golden)).toEqual({
      kind: 'L4',
      props: { typeId: golden.id, itemId: 'cage' },
      parent: '/supplies/cage',
      documentParent: true,
      wsId: 'supplyRequirements#r1',
      backToParent: true,
    });
    expect(deepLinkFor(pageOf('SUPPLY_ITEM_TYPE', {}, { ...extra, layer: { kind: 'L5', typeId: golden.id, itemId: 'cage' } }), null, null)).toBeNull();
  });

  // 398 B-2: 이 문서의 route·헤더·본문은 진입 종({type}) 기준 — 부모 /supplies/{item} 은 다른 문서다.
  //   닫기 = 바로 앞 항목이 부모 문서면 history.back, 아니면 location.replace(부모) — URL 만 바꾸는 replaceState 금지.
  describe('398 B-2: SUPPLY_ITEM_TYPE L4 직접 진입 → 닫기 = 실제 부모 문서', () => {
    const sit = '/supplies/cage/hamster-golden';
    const page = pageOf('SUPPLY_ITEM_TYPE', {}, { typeId: golden.id, path: sit, layer: { kind: 'L4', typeId: golden.id, itemId: 'cage' } });
    const registry = { L4: { title: '케이지', Component: () => null }, L5: { title: '규격', Component: () => null } };

    function run(body: (ctx: { replace: ReturnType<typeof vi.fn>; back: ReturnType<typeof vi.spyOn> }) => Promise<void> | void) {
      return async () => {
        const oldUrl = window.location.href;
        const oldState: unknown = window.history.state;
        const oldTitle = document.title;
        act(() => layerStore.resetForTest());
        window.history.replaceState(null, '', sit);
        const replace = vi.fn();
        const navSpy = vi.spyOn(layerNav, 'replace').mockImplementation(replace);
        const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
        const view = render(createElement(LayerHost, { registry }));
        try {
          const link = deepLinkFor(page, null, golden)!;
          act(() => layerStore.initDeepLink(link.kind, link.props, link.parent, link));
          await body({ replace, back });
        } finally {
          view.unmount();
          navSpy.mockRestore();
          back.mockRestore();
          Reflect.deleteProperty(window, 'navigation');
          act(() => layerStore.resetForTest());
          window.history.replaceState(oldState, '', oldUrl);
          document.title = oldTitle;
        }
      };
    }

    it('Navigation API 없음 → ✕ = location.replace(/supplies/cage), back 0, URL 만 바꾸지 않는다', run(({ replace, back }) => {
      fireEvent.click(screen.getByRole('button', { name: '닫기' }));
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith('/supplies/cage');
      expect(back).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe(sit);
      // 연타(이동 도착 전)는 두 번째 이동을 만들지 않는다.
      act(() => layerStore.close());
      expect(replace).toHaveBeenCalledTimes(1);
    }));

    it('L5 위에서 ✕ → go(-1) 뒤 딥링크 항목에서 location.replace(부모)', run(async ({ replace, back }) => {
      act(() => layerStore.open('L5', { typeId: golden.id, itemId: 'cage' }, { url: '/hamster/golden/check/cage' }));
      fireEvent.click(screen.getByRole('button', { name: '닫기' }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/supplies/cage'), { timeout: 5000 });
      expect(replace).toHaveBeenCalledTimes(1);
      expect(back).not.toHaveBeenCalled();
    }));

    it('바로 앞 항목이 부모 문서면 ✕ = history.back, replace 0', run(({ replace, back }) => {
      Object.defineProperty(window, 'navigation', {
        configurable: true,
        value: {
          entries: () => [{ url: `${location.origin}/supplies/cage`, sameDocument: false }, { url: `${location.origin}${sit}`, sameDocument: true }],
          currentEntry: { index: 1 },
        },
      });
      fireEvent.click(screen.getByRole('button', { name: '닫기' }));
      expect(back).toHaveBeenCalledTimes(1);
      expect(replace).not.toHaveBeenCalled();
    }));
  });

  it('레이어 없는 TYPE·HOME·타입 불일치 → null', () => {
    expect(deepLinkFor(pageOf('TYPE', {}, { typeId: golden.id }), null, null)).toBeNull();
    expect(deepLinkFor(pageOf('HOME'), null, null)).toBeNull();
    const mismatch = pageOf('TYPE', {}, { typeId: golden.id, layer: { kind: 'L4', typeId: 'other', itemId: 'cage' } });
    expect(deepLinkFor(mismatch, null, null)).toBeNull();
  });
});
