// C-R5-5 레이어 history: state = {wsLayer, wsLayerProps, wsParent, wsDepth}. 레이어 위 레이어 push(뒤로 = 이전 레이어),
//   닫기(✕·ESC) = 스택 전체 닫기(go(-depth)), 딥링크(depth 0) 닫기 = replaceState(wsParent) · history.length 불변.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LayerHost, { type LayerRegistry } from './LayerHost';
import { captureMagicToken, clearMagicToken } from '../../save/magicLink';
import { layerNav, layerStore, readLayerState } from './useLayer';

function Body({ props }: { props: Record<string, unknown> }) {
  return <p>{`내용 ${JSON.stringify(props)}`}</p>;
}
const registry: LayerRegistry = {
  L1: { title: 'L1', Component: Body },
  L2: { title: 'L2 제목', Component: Body },
  L4: { title: 'L4 제목', Component: Body },
  L5: { title: 'L5 제목', Component: Body },
  L7: { title: 'L7 제목', Component: Body },
  L8: { title: 'L8 제목', Component: Body },
};

function host() {
  return render(<LayerHost registry={registry} />);
}

function dialogKind(): string | null {
  return screen.queryByRole('dialog')?.getAttribute('data-ws-layer') ?? null;
}

beforeEach(() => {
  act(() => layerStore.resetForTest());
  window.history.replaceState(null, '', '/hamster/golden');
});

afterEach(() => {
  act(() => layerStore.resetForTest());
  vi.restoreAllMocks();
  document.documentElement.style.overflow = '';
  window.history.replaceState(null, '', '/');
});

describe('useLayer history (C-R5-5)', () => {
  it('L2 → L4 push: URL·state 기록, 뒤로 = L2(같은 문서, 한 번에 하나)', async () => {
    host();
    const len0 = window.history.length;
    act(() => layerStore.open('L2'));
    expect(window.location.pathname).toBe('/hamster/golden');
    act(() => layerStore.open('L4', { typeId: 'hamster-golden', itemId: 'cage' }, { url: '/hamster/golden/supplies/cage' }));
    expect(window.history.length).toBe(len0 + 2);
    expect(window.location.pathname).toBe('/hamster/golden/supplies/cage');
    expect(window.history.state).toMatchObject({
      wsLayer: 'L4',
      wsLayerProps: { typeId: 'hamster-golden', itemId: 'cage' },
      wsParent: '/hamster/golden',
      wsDepth: 2,
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(dialogKind()).toBe('L4');

    act(() => window.history.back());
    await waitFor(() => expect(dialogKind()).toBe('L2'));
    expect(window.location.pathname).toBe('/hamster/golden');

    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('✕(close) 는 스택 전체를 닫는다 — 부모 항목으로 go(-depth), 레이어 state 없음', async () => {
    host();
    act(() => layerStore.open('L2'));
    act(() => layerStore.open('L4', { typeId: 't', itemId: 'cage' }, { url: '/hamster/golden/supplies/cage' }));
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/hamster/golden');
    expect(readLayerState(window.history.state)).toBeNull();
  });

  it('H2: popstate 전 close() 연속 호출·ESC 반복에도 history.go 는 1회', async () => {
    host();
    act(() => layerStore.open('L2'));
    act(() => layerStore.open('L4', { typeId: 't', itemId: 'cage' }, { url: '/hamster/golden/supplies/cage' }));
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    act(() => {
      layerStore.close();
      layerStore.close();
    });
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-2);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('L10: 호스트 리렌더에도 내용에 전달되는 close 는 같은 참조', () => {
    const seen: Array<() => void> = [];
    const Probe = ({ close }: { props: Record<string, unknown>; close(): void }) => {
      seen.push(close);
      return null;
    };
    const { rerender } = render(<LayerHost registry={{ L2: { title: 'L2', Component: Probe } }} />);
    act(() => layerStore.open('L2'));
    rerender(<LayerHost registry={{ L2: { title: 'L2', Component: Probe } }} />);
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(1);
  });

  it('H2: popstate 가 오지 않으면 안전 해제 후 다시 닫을 수 있다', () => {
    vi.useFakeTimers();
    try {
      host();
      act(() => layerStore.open('L2'));
      const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
      act(() => layerStore.close());
      act(() => layerStore.close());
      expect(go).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      act(() => layerStore.close());
      expect(go).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('back(): popstate 전 연속 호출은 history.back 1회, popstate 후 다시 가능', async () => {
    host();
    act(() => layerStore.open('L2'));
    act(() => layerStore.open('L2', { step: 'L6' }));
    act(() => layerStore.open('L2', { step: 'L6' }));
    const back = vi.spyOn(window.history, 'back');
    act(() => {
      layerStore.back();
      layerStore.back();
    });
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(readLayerState(window.history.state)?.wsDepth).toBe(2));
    act(() => layerStore.back());
    expect(back).toHaveBeenCalledTimes(2);
  });

  it('back(): popstate 가 오지 않으면 안전 타이머 후 다시 가능', () => {
    vi.useFakeTimers();
    try {
      host();
      act(() => layerStore.open('L2'));
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      act(() => layerStore.back());
      act(() => layerStore.back());
      expect(back).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      act(() => layerStore.back());
      expect(back).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('back(): 전체 닫기 진행 중이면 무시', () => {
    host();
    act(() => layerStore.open('L2'));
    act(() => layerStore.open('L4', { typeId: 't', itemId: 'cage' }, { url: '/hamster/golden/supplies/cage' }));
    vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const back = vi.spyOn(window.history, 'back');
    act(() => layerStore.close());
    act(() => layerStore.back());
    expect(back).not.toHaveBeenCalled();
  });

  it('forward(popstate) 로 레이어 항목에 돌아오면 그 레이어를 복원한다', async () => {
    host();
    act(() => layerStore.open('L7', { typeId: 't', productId: 'p1' }, { url: '/hamster/golden/products/p1' }));
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => window.history.forward());
    await waitFor(() => expect(dialogKind()).toBe('L7'));
    expect(screen.getByText(/"productId":"p1"/)).toBeInTheDocument();
  });

  it('history 에는 허용 props(typeId·itemId·productId·step) 문자열만 남는다', () => {
    host();
    act(() => layerStore.open('L4', { typeId: 't', itemId: 'cage', email: 'a@b.c', lat: 37.5, step: 'L6' } as never));
    const s = readLayerState(window.history.state);
    expect(s?.wsLayerProps).toEqual({ typeId: 't', itemId: 'cage', step: 'L6' });
    expect(JSON.stringify(window.history.state)).not.toMatch(/a@b\.c|37\.5/);
  });

  it('replace 옵션: 같은 깊이에서 교체(항목 추가 없음)', () => {
    host();
    act(() => layerStore.open('L1'));
    const len = window.history.length;
    act(() => layerStore.open('L2', {}, { replace: true }));
    expect(window.history.length).toBe(len);
    expect(dialogKind()).toBe('L2');
    expect(readLayerState(window.history.state)?.wsDepth).toBe(1);
  });

  it('딥링크: initDeepLink → depth 0, 닫으면 replaceState(wsParent)·history.length 불변·재로드 없음', async () => {
    window.history.replaceState(null, '', '/hamster/golden/supplies/cage');
    host();
    const len = window.history.length;
    act(() => layerStore.initDeepLink('L4', { typeId: 't', itemId: 'cage' }, '/hamster/golden'));
    expect(dialogKind()).toBe('L4');
    expect(readLayerState(window.history.state)).toMatchObject({ wsDepth: 0, wsParent: '/hamster/golden' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/hamster/golden');
    expect(window.history.length).toBe(len);
    expect(readLayerState(window.history.state)).toBeNull();
  });

  it('딥링크 위에 push 한 L5 를 닫으면 딥링크 항목까지 돌아가 replaceState(부모)', async () => {
    window.history.replaceState(null, '', '/hamster/golden/supplies/cage');
    host();
    act(() => layerStore.initDeepLink('L4', { typeId: 't', itemId: 'cage' }, '/hamster/golden'));
    act(() => layerStore.open('L5', { typeId: 't', itemId: 'cage' }, { url: '/hamster/golden/check/cage' }));
    expect(dialogKind()).toBe('L5');
    // 뒤로 = L4(딥링크)
    act(() => window.history.back());
    await waitFor(() => expect(dialogKind()).toBe('L4'));
    act(() => layerStore.open('L5', { typeId: 't', itemId: 'cage' }, { url: '/hamster/golden/check/cage' }));
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/hamster/golden');
  });

  it('딥링크 부모가 다른 문서면(documentParent) location.replace 로 이동', () => {
    window.history.replaceState(null, '', '/save');
    host();
    const replace = vi.spyOn(layerNav, 'replace').mockImplementation(() => undefined);
    act(() => layerStore.initDeepLink('L8', {}, '/hamster/golden', { documentParent: true }));
    act(() => layerStore.close());
    expect(replace).toHaveBeenCalledWith('/hamster/golden');
  });

  it('레이어 상태 없는 항목에서 close 는 메모리만 닫는다(throw 없음)', () => {
    host();
    act(() => layerStore.open('L1'));
    window.history.replaceState(null, '');
    act(() => layerStore.close());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('같은 탭 매직링크(P2 D1): /save#t= 해시 이동 popstate(null)', () => {
    const TOKEN = 'Q'.repeat(43);
    function pasteHash(path: string, hash: string): void {
      act(() => {
        window.history.pushState(null, '', `${path}${hash}`);
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      });
    }
    afterEach(() => clearMagicToken());

    it('L8 열린 상태 → 닫지 않고 해시 제거 + 그 항목을 L8(depth+1, 같은 부모)로 교체, 토큰 붙잡음', () => {
      host();
      act(() => layerStore.open('L8', {}, { url: '/save' }));
      pasteHash('/save', `#t=${TOKEN}`);
      expect(dialogKind()).toBe('L8');
      expect(window.location.hash).toBe('');
      expect(window.location.pathname).toBe('/save');
      expect(window.history.state).toMatchObject({ wsLayer: 'L8', wsParent: '/hamster/golden', wsDepth: 2 });
      expect(JSON.stringify(window.history.state)).not.toContain(TOKEN);
      expect(captureMagicToken()).toEqual({ token: TOKEN });
    });

    it('붙잡은 뒤 close → go(-depth) 로 원래 부모에 돌아가 닫힘', async () => {
      host();
      act(() => layerStore.open('L8', {}, { url: '/save' }));
      pasteHash('/save', `#t=${TOKEN}`);
      const go = vi.spyOn(window.history, 'go');
      act(() => layerStore.close());
      expect(go).toHaveBeenCalledWith(-2);
      await waitFor(() => expect(dialogKind()).toBeNull());
      expect(window.location.pathname).toBe('/hamster/golden');
    });

    it('레이어 없음 → L8 이 열린다(depth 1)', () => {
      host();
      pasteHash('/save', `#t=${TOKEN}`);
      expect(dialogKind()).toBe('L8');
      expect(window.location.hash).toBe('');
      expect(window.history.state).toMatchObject({ wsLayer: 'L8', wsDepth: 1 });
    });

    it('/save 가 아닌 경로·t= 없는 해시는 기존대로 닫힘', () => {
      host();
      act(() => layerStore.open('L8', {}, { url: '/save' }));
      pasteHash('/save', '#top');
      expect(dialogKind()).toBeNull();
      act(() => layerStore.open('L2'));
      pasteHash('/hamster/golden', `#t=${TOKEN}`);
      expect(dialogKind()).toBeNull();
    });
  });
});
