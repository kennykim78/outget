// 레이어(F3 ③): Tab 순환, ESC, popstate 포커스 복귀, 교체, 3변형.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Layer, layerVariantFor } from './Layer';
import LayerHost, { type LayerRegistry } from './LayerHost';
import { layerStore, useLayer } from './useLayer';

function mockViewport(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const max = /max-width:\s*(\d+)px/.exec(q);
    const min = /min-width:\s*(\d+)px/.exec(q);
    const ok = (max ? width <= Number(max[1]) : true) && (min ? width >= Number(min[1]) : true);
    return {
      matches: ok,
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList;
  });
  // window.matchMedia 도 같은 목으로(stubGlobal 은 globalThis = window).
}

function L1Content({ close }: { close(): void }) {
  return (
    <div>
      <button type="button">첫째</button>
      <button type="button" onClick={close}>
        마지막
      </button>
    </div>
  );
}
function L2Content() {
  return <p>두 번째 레이어</p>;
}
const registry: LayerRegistry = {
  L1: { title: '어떤 친구인가요?', Component: L1Content },
  L2: { title: '체크리스트', Component: L2Content },
};

function Opener() {
  const layer = useLayer();
  return (
    <>
      <button type="button" onClick={() => layer.open('L1')}>
        열기
      </button>
      <button type="button" onClick={() => layer.open('L2')}>
        L2로
      </button>
    </>
  );
}

beforeEach(() => {
  act(() => layerStore.resetForTest());
  window.history.replaceState(null, '');
  mockViewport(390);
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => layerStore.resetForTest());
  document.documentElement.style.overflow = '';
});

describe('Layer 3변형', () => {
  it('≤767 sheet · 768–1023 modal · ≥1024 modal(L1)/drawer(L4·L7)', () => {
    mockViewport(390);
    expect(layerVariantFor('L1')).toBe('sheet');
    expect(layerVariantFor('L7')).toBe('sheet');
    mockViewport(800);
    expect(layerVariantFor('L1')).toBe('modal');
    expect(layerVariantFor('L4')).toBe('modal');
    mockViewport(1280);
    expect(layerVariantFor('L1')).toBe('modal');
    expect(layerVariantFor('L2')).toBe('modal');
    expect(layerVariantFor('L4')).toBe('drawer');
    expect(layerVariantFor('L7')).toBe('drawer');
  });

  it('렌더된 패널에 변형이 반영되고 sheet 만 그랩이 있다', () => {
    mockViewport(1280);
    const { unmount } = render(
      <Layer kind="L4" title="케이지" onClose={() => undefined}>
        <p>x</p>
      </Layer>,
    );
    const dlg = screen.getByRole('dialog');
    expect(dlg).toHaveAttribute('data-ws-variant', 'drawer');
    expect(dlg.querySelector('.ws-layer-grab')).toBeNull();
    unmount();
    mockViewport(390);
    render(
      <Layer kind="L4" title="케이지" onClose={() => undefined}>
        <p>x</p>
      </Layer>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('data-ws-variant', 'sheet');
    expect(screen.getByRole('dialog').querySelector('.ws-layer-grab')).not.toBeNull();
  });
});

describe('Layer 접근성', () => {
  it('role=dialog aria-modal, 제목 연결, 열면 제목 포커스, 배경 inert, html 스크롤 잠금', () => {
    render(
      <Layer kind="L1" title="어떤 친구인가요?" onClose={() => undefined}>
        <button type="button">a</button>
      </Layer>,
    );
    const dlg = screen.getByRole('dialog');
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    const title = document.getElementById(dlg.getAttribute('aria-labelledby') ?? '');
    expect(title).toHaveTextContent('어떤 친구인가요?');
    expect(document.activeElement).toBe(title);
    expect(document.documentElement.style.overflow).toBe('hidden');
    const others = Array.from(document.body.children).filter((el) => !el.classList.contains('ws-layer-root'));
    expect(others.length).toBeGreaterThan(0);
    for (const el of others) expect(el).toHaveAttribute('inert');
  });

  it('Tab 은 마지막 → 첫째로, Shift+Tab 은 첫째 → 마지막으로 순환한다', () => {
    render(
      <Layer kind="L1" title="t" onClose={() => undefined}>
        <button type="button">하나</button>
        <button type="button">둘</button>
      </Layer>,
    );
    const dlg = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: '닫기' });
    const last = screen.getByRole('button', { name: '둘' });
    // 순서: 닫기(머리) → 하나 → 둘
    last.focus();
    fireEvent.keyDown(dlg, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dlg, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('ESC·✕·스크림이 onClose 를 부른다', () => {
    const onClose = vi.fn();
    render(
      <Layer kind="L1" title="t" onClose={onClose}>
        <p>x</p>
      </Layer>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    fireEvent.click(document.querySelector('[data-ws-scrim]') as Element);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('LayerHost + history', () => {
  it('열면 history push, 뒤로(popstate)로 닫히고 연 버튼으로 포커스가 돌아온다', async () => {
    render(
      <>
        <Opener />
        <LayerHost registry={registry} />
      </>,
    );
    const opener = screen.getByRole('button', { name: '열기' });
    opener.focus();
    const before = window.history.length;
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(window.history.length).toBe(before + 1);
    expect((window.history.state as { wsLayer?: string }).wsLayer).toBe('L1');

    act(() => {
      window.history.back();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.style.overflow).toBe('');
    expect(opener.closest('[inert]')).toBeNull();
  });

  it('ESC 로 닫으면 history.back 경로로 닫힌다(항목이 남지 않음)', async () => {
    render(
      <>
        <Opener />
        <LayerHost registry={registry} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((window.history.state as { wsLayer?: string } | null)?.wsLayer).toBeUndefined();
  });

  it('열린 상태에서 다른 레이어를 열면 교체(한 번에 하나, history 항목 추가 없음)', () => {
    render(
      <>
        <Opener />
        <LayerHost registry={registry} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    const len = window.history.length;
    act(() => layerStore.open('L2'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByText('두 번째 레이어')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('data-ws-layer', 'L2');
    expect(window.history.length).toBe(len);
    expect((window.history.state as { wsLayer?: string }).wsLayer).toBe('L2');
  });

  it('내용이 throw 하면 레이어만 닫히고 페이지는 남는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Boom(): JSX.Element {
      throw new Error('boom');
    }
    render(
      <>
        <Opener />
        <LayerHost registry={{ ...registry, L1: { title: 't', Component: Boom } }} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: '열기' })).toBeInTheDocument();
    spy.mockRestore();
  });
});
