// C-R5-5 레이어 history: state = {wsLayer, wsLayerProps, wsParent, wsDepth}. 레이어 위 레이어 push(뒤로 = 이전 레이어),
//   닫기(✕·ESC) = 스택 전체 닫기(go(-depth)), 딥링크(depth 0) 닫기 = replaceState(wsParent) · history.length 불변.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { COPY } from '@ws/copy';
import LayerHost, { layerDocumentTitle, type LayerRegistry } from './LayerHost';
import { useLayerChrome } from './Layer';
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

/** jsdom history 이동(go/back)의 popstate 는 타이머로 온다 — 첫 테스트 콜드 스타트 부하에서 기본 1s 가 모자랄 수 있다. */
const WAIT = { timeout: 5000 };

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
  it.each([false, true])('387 bfcache: 부모 → SIT L4 → L5(%s) → 닫기 → persisted 복원은 L4·제목 일치, 즉시 닫기', async (withL5) => {
    const parent = '/supplies/wheel';
    const sit = '/supplies/wheel/hamster-golden';
    const props = { typeId: 'hamster-golden', itemId: 'wheel' };
    window.history.replaceState(null, '', parent);
    window.history.pushState(null, '', sit);
    const navigation = {
      entries: () => [{ url: `${location.origin}${parent}`, sameDocument: false }, { url: `${location.origin}${sit}`, sameDocument: true }],
      currentEntry: { index: 1 },
    };
    Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
    host();
    act(() => layerStore.initDeepLink('L4', props, parent, { backToParent: true, wsId: 'supplyRequirements#wheel' }));
    const entry = window.history.state;
    const pop = vi.fn();
    window.addEventListener('popstate', pop);
    let beforeLeave: ReturnType<typeof layerStore.get> | undefined;
    // jsdom에 없는 cross-document traversal만 모의한다. go(-1)은 실제 popstate를 발생시키며,
    // 떠날 때 pagehide와 도착 URL, 돌아올 때 pageshow를 발생시켜 문서 저장소·DOM을 검사한다.
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      beforeLeave = layerStore.get();
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.history.replaceState(null, '', parent);
    });
    try {
      if (withL5) act(() => layerStore.open('L5', props, { url: '/hamster/golden/check/wheel' }));
      expect(dialogKind()).toBe(withL5 ? 'L5' : 'L4');
      fireEvent.click(screen.getByRole('button', { name: '닫기' }));
      await waitFor(() => expect(back).toHaveBeenCalledTimes(1), WAIT);
      expect(window.location.pathname).toBe(parent);
      if (withL5) expect(pop).toHaveBeenCalled();
      act(() => {
        window.history.replaceState(entry, '', sit);
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      });
      const restored = { beforeLeave: beforeLeave?.kind, state: readLayerState(history.state)?.wsLayer, screen: dialogKind(), title: document.title };
      fireEvent.click(screen.getByRole('button', { name: '닫기' }));
      expect({ ...restored, backCalls: back.mock.calls.length }).toEqual({ beforeLeave: 'L4', state: 'L4', screen: 'L4', title: layerDocumentTitle('L4 제목'), backCalls: 2 });
      expect(window.location.pathname).toBe(parent);
    } finally {
      window.removeEventListener('popstate', pop);
      Reflect.deleteProperty(window, 'navigation');
      // 실제 go가 남긴 forward L5 항목을 잘라 다음 시험의 history.length 기준을 격리한다.
      window.history.pushState(null, '', parent);
    }
  });

  // 388 D1: 서버의 Referrer-Policy: no-referrer 때문에 다른 문서 항목은 url=null — 부모 문서가 떠날 때 남긴 entry key 로 판정한다.
  it.each([
    ['부모가 남긴 key', '/supplies/wheel', 'k-parent', 1],
    ['기록 없음', null, 'k-parent', 0],
    ['다른 항목의 key', '/supplies/wheel', 'k-other', 0],
    ['다른 용품 부모', '/supplies/saucer', 'k-parent', 0],
  ] as const)('388 no-referrer(앞 항목 url=null) — %s (기록 %s, key %s) → back %i회', (_name, left, prevKey, calls) => {
    const parent = '/supplies/wheel';
    const sit = '/supplies/wheel/hamster-golden';
    window.sessionStorage.clear();
    const view = host();
    if (left !== null) {
      window.history.replaceState(null, '', left);
      Object.defineProperty(window, 'navigation', { configurable: true, value: { currentEntry: { index: 0, key: 'k-parent', id: 'id-parent' } } });
      act(() => void window.dispatchEvent(new PageTransitionEvent('pagehide')));
    }
    view.unmount();
    window.history.replaceState(null, '', sit);
    const navigation = {
      entries: () => [{ url: null, key: prevKey, id: 'id-parent', sameDocument: false }, { url: `${location.origin}${sit}`, key: 'k-sit', id: 'id-sit', sameDocument: true }],
      currentEntry: { index: 1, key: 'k-sit', id: 'id-sit' },
    };
    Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    try {
      host();
      act(() => layerStore.initDeepLink('L4', { typeId: 'hamster-golden', itemId: 'wheel' }, parent, { backToParent: true }));
      fireEvent.click(screen.getByRole('button', { name: '닫기' }));
      expect(back).toHaveBeenCalledTimes(calls);
    } finally {
      Reflect.deleteProperty(window, 'navigation');
      window.sessionStorage.clear();
    }
  });

  describe('388 D1 낡은 부모 기록 무효화', () => {
    const parent = '/supplies/wheel';
    const storageKey = 'ws.layer.parentEntry:k-parent';
    let entry: { index: number; key: string; id: unknown };

    beforeEach(() => {
      window.sessionStorage.clear();
      entry = { index: 0, key: 'k-parent', id: 'id-parent' };
      Object.defineProperty(window, 'navigation', { configurable: true, value: { currentEntry: entry } });
      window.history.replaceState(null, '', parent);
      host();
    });

    afterEach(() => {
      Reflect.deleteProperty(window, 'navigation');
      window.sessionStorage.clear();
    });

    function pagehide(): void {
      act(() => void window.dispatchEvent(new PageTransitionEvent('pagehide')));
    }

    function expectNoBack(prevId: unknown): void {
      const sit = `${parent}/hamster-golden`;
      window.history.replaceState(null, '', sit);
      Object.defineProperty(window, 'navigation', {
        configurable: true,
        value: {
          entries: () => [{ url: null, key: entry.key, id: prevId, sameDocument: false }],
          currentEntry: { index: 1, key: 'k-sit', id: 'id-sit' },
        },
      });
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
      act(() => layerStore.initDeepLink('L4', { typeId: 'hamster-golden', itemId: 'wheel' }, parent, { backToParent: true }));
      fireEvent.click(screen.getByRole('button', { name: '닫기' }));
      expect(back).toHaveBeenCalledTimes(0);
      expect(window.location.pathname).toBe(parent);
    }

    it('부모 기록 → 같은 key가 /hamster/golden으로 변경 → pagehide → ✕ = back 0회', () => {
      pagehide();
      expect(window.sessionStorage.getItem(storageKey)).not.toBeNull();
      window.history.replaceState(null, '', '/hamster/golden');
      pagehide();
      expectNoBack(entry.id);
      expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    });

    it('pagehide 없이 id만 바뀜 → ✕ = back 0회', () => {
      pagehide();
      expect(window.sessionStorage.getItem(storageKey)).not.toBeNull();
      entry.id = 'id-replaced';
      expectNoBack(entry.id);
    });

    it('setItem 예외 시 낡은 기록 0', () => {
      pagehide();
      expect(window.sessionStorage.getItem(storageKey)).not.toBeNull();
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
      pagehide();
      expect(window.sessionStorage.getItem(storageKey)).toBeNull();
      expectNoBack(entry.id);
    });

    it('저장 값에는 pathname과 id만 포함한다', () => {
      window.history.replaceState(null, '', `${parent}?sample=value#section`);
      pagehide();
      expect(JSON.parse(window.sessionStorage.getItem(storageKey)!)).toEqual({ path: parent, id: 'id-parent' });
    });

    it.each([undefined, null, 17])('currentEntry.id가 문자열이 아니면 기존 기록 삭제 후 저장하지 않는다: %s', (id) => {
      pagehide();
      entry.id = id;
      pagehide();
      expect(window.sessionStorage.getItem(storageKey)).toBeNull();
      expectNoBack(entry.id);
    });

    it.each([undefined, null, 17])('prev.id가 문자열이 아니면 back 0회: %s', (id) => {
      pagehide();
      expectNoBack(id);
    });

    it.each([
      '/supplies/wheel', '{', 'null', '[]',
      '{"path":"/supplies/wheel"}',
      '{"path":"/supplies/wheel","id":17}',
      '{"path":17,"id":"id-parent"}',
      '{"path":"/hamster/golden","id":"id-parent"}',
      '{"path":"/supplies/wheel","id":"id-parent","extra":true}',
    ])('깨진 저장 형식이면 back 0회: %s', (value) => {
      window.sessionStorage.setItem(storageKey, value);
      expectNoBack(entry.id);
    });
  });

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
      await waitFor(() => expect(dialogKind()).toBeNull(), WAIT);
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

// R6 G1 ① 레이어 document.title — "<레이어 제목> — WithSmall"(프리렌더 titleSuffix), 스텝 전환 갱신, 닫으면 복원.
function StepBody({ props }: { props: Record<string, unknown> }) {
  const { setTitle } = useLayerChrome();
  const step = typeof props.step === 'string' ? props.step : '';
  useLayoutEffect(() => {
    if (step === 'species') setTitle('종 고르기');
  }, [step, setTitle]);
  return <p>{step}</p>;
}
const stepRegistry: LayerRegistry = { ...registry, L1: { title: '친구 고르기', Component: StepBody } };

describe('레이어 document.title (R6 G1)', () => {
  const PAGE_TITLE = `골든햄스터 페이지${COPY.site.titleSuffix}`;
  beforeEach(() => {
    document.title = PAGE_TITLE;
  });

  it('열면 "<제목> — WithSmall", 스텝 전환(setTitle) 시 갱신, 닫으면 이전 제목 복원', async () => {
    render(<LayerHost registry={stepRegistry} />);
    act(() => layerStore.open('L1', { step: 'group' }));
    expect(document.title).toBe(layerDocumentTitle('친구 고르기'));
    expect(document.title).toBe('친구 고르기 — WithSmall');
    act(() => layerStore.open('L1', { step: 'species' }));
    await waitFor(() => expect(document.title).toBe('종 고르기 — WithSmall'), WAIT);
    act(() => layerStore.open('L4', { itemId: 'cage' }, { url: '/hamster/golden/supplies/cage' }));
    expect(document.title).toBe('L4 제목 — WithSmall');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(dialogKind()).toBeNull(), WAIT);
    expect(document.title).toBe(PAGE_TITLE);
  });

  it('딥링크(depth 0)로 시작한 레이어를 닫으면 홈 제목(직전 제목 = 레이어 자신의 프리렌더 제목)', async () => {
    document.title = `골든햄스터 케이지${COPY.site.titleSuffix}`;
    host();
    act(() => layerStore.initDeepLink('L4', { typeId: 't', itemId: 'cage' }, '/hamster/golden'));
    expect(document.title).toBe('L4 제목 — WithSmall');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(dialogKind()).toBeNull(), WAIT);
    expect(document.title).toBe(COPY.site.homeTitle);
  });
});

// R6 G1 ② 스크롤 복원 점프(P3 N1): 열려 있는 동안만 scrollRestoration=manual, 닫으면 연 순간 scrollY 로(차이 ≤1px).
describe('레이어 스크롤 유지 (R6 G1)', () => {
  let y = 0;
  beforeEach(() => {
    y = 0;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
    vi.spyOn(window, 'scrollTo').mockImplementation(((a: number | ScrollToOptions, b?: number) => {
      y = typeof a === 'number' ? (b ?? 0) : (a.top ?? y);
    }) as typeof window.scrollTo);
    window.history.scrollRestoration = 'auto';
  });

  it('열 때 scrollY 저장 → 브라우저가 2556 으로 점프해도 ESC 닫힘 뒤 원래 위치(≤1px), 모드는 열린 동안만 manual', async () => {
    host();
    y = 1200;
    act(() => layerStore.open('L1'));
    expect(window.history.scrollRestoration).toBe('manual');
    y = 2556; // 브라우저 자동 복원이 부모 항목의 옛 위치로 튀는 상황
    // popstate 리스너(LayerHost 보다 먼저 등록되지 않았으므로 뒤에 돈다) — 닫힘 처리 직후 같은 태스크에서 다시 2556 으로 튀김
    window.addEventListener('popstate', () => (y = 2556), { once: true });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(dialogKind()).toBeNull(), WAIT);
    await waitFor(() => expect(window.history.scrollRestoration).toBe('auto'), WAIT); // 한 틱 뒤 원복 + 위치 재확인
    expect(Math.abs(window.scrollY - 1200)).toBeLessThanOrEqual(1);
  });

  it('닫힌 직후 다시 열면 원래 모드(auto)를 이어 받고, 최종 닫힘 뒤 auto', async () => {
    host();
    y = 300;
    act(() => layerStore.open('L2'));
    act(() => layerStore.close());
    await waitFor(() => expect(dialogKind()).toBeNull(), WAIT);
    act(() => layerStore.open('L2')); // 원복 타이머 전에 재열기
    expect(window.history.scrollRestoration).toBe('manual');
    act(() => layerStore.close());
    await waitFor(() => expect(dialogKind()).toBeNull(), WAIT);
    await waitFor(() => expect(window.history.scrollRestoration).toBe('auto'), WAIT);
    expect(Math.abs(window.scrollY - 300)).toBeLessThanOrEqual(1);
  });
});
