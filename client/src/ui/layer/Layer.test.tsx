// 레이어(F3 ③): Tab 순환, ESC, popstate 포커스 복귀, 교체, 3변형.
import { lazy, useEffect, useLayoutEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Layer, layerVariantFor, useLayerChrome } from './Layer';
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

  it('마운트 시 정적 div.ws-scrim·aside.ws-layer 제거(이중 aside 0), 패널 data-ws-layer·data-ws-id 유지', () => {
    const scrim = document.createElement('div');
    scrim.className = 'ws-scrim';
    const aside = document.createElement('aside');
    aside.className = 'ws-layer';
    aside.setAttribute('data-ws-layer', 'L4');
    document.body.append(scrim, aside);
    render(
      <Layer kind="L4" title="케이지" wsId="supplyRequirements#r1" onClose={() => undefined}>
        <p>x</p>
      </Layer>,
    );
    expect(document.querySelectorAll('aside.ws-layer')).toHaveLength(0);
    expect(document.querySelectorAll('.ws-scrim')).toHaveLength(1);
    expect(document.querySelector('.ws-scrim')).toHaveAttribute('data-ws-scrim');
    const dlg = screen.getByRole('dialog');
    expect(dlg).toHaveAttribute('data-ws-layer', 'L4');
    expect(dlg).toHaveAttribute('data-ws-id', 'supplyRequirements#r1');
  });

  it('내용이 마운트 때 setTitle 한 제목을 기본 제목이 덮지 않는다', () => {
    function Titled() {
      const chrome = useLayerChrome();
      useLayoutEffect(() => chrome.setTitle('케이지'), [chrome]);
      return null;
    }
    render(
      <Layer kind="L4" title="" onClose={() => undefined}>
        <Titled />
      </Layer>,
    );
    expect(screen.getByRole('dialog', { name: '케이지' })).toBeInTheDocument();
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

  it('열린 상태에서 다른 레이어를 열면 그 위에 push(화면엔 하나), 뒤로 = 이전 레이어(C-R5-5)', async () => {
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
    expect(window.history.length).toBe(len + 1);
    expect((window.history.state as { wsLayer?: string }).wsLayer).toBe('L2');
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-ws-layer', 'L1'));
  });

  it('registry 에 없는 종류는 그리지 않는다(throw 없음)', () => {
    render(<LayerHost registry={registry} />);
    act(() => layerStore.open('L8'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lazy 내용: 대기 중에도 껍데기(제목·✕), 로드 후 내용', async () => {
    let resolve!: (m: { default: () => JSX.Element }) => void;
    const Lazy = lazy(() => new Promise<{ default: () => JSX.Element }>((r) => (resolve = r)));
    render(<LayerHost registry={{ ...registry, L5: { title: '규격 확인', Component: Lazy } }} />);
    act(() => layerStore.open('L5'));
    expect(screen.getByRole('dialog', { name: '규격 확인' })).toBeInTheDocument();
    await act(async () => resolve({ default: () => <p>지연 내용</p> }));
    expect(await screen.findByText('지연 내용')).toBeInTheDocument();
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

describe('Layer 포커스 관리(D1·D8, WCAG 2.4.3·4.1.3)', () => {
  function StepContent({ props }: { props: Record<string, unknown> }) {
    const chrome = useLayerChrome();
    const step = typeof props.step === 'string' ? props.step : 'L5';
    useLayoutEffect(() => chrome.setTitle(step === 'L6' ? '내 케이지' : '규격 확인'), [chrome, step]);
    return step === 'L6' ? (
      <div>
        <input aria-label="가로" />
        <button type="button" onClick={() => layerStore.open('L5', { step: 'L5' }, { replace: true })}>
          저장
        </button>
      </div>
    ) : (
      <div>
        <input aria-label="이름" />
        <button type="button" onClick={() => layerStore.open('L5', { step: 'L6' }, { replace: true })}>
          등록
        </button>
      </div>
    );
  }
  const stepRegistry: LayerRegistry = { L5: { title: '규격 확인', Component: StepContent } };

  it('스텝 변경으로 누른 버튼이 언마운트되면 같은 커밋에서 새 제목으로 포커스(동기)', () => {
    function Swap({ props }: { props: Record<string, unknown> }) {
      return props.step === 'species' ? (
        <section>
          <h3>종 고르기</h3>
        </section>
      ) : (
        <div>
          <button type="button" onClick={() => layerStore.open('L1', { step: 'species' })}>
            햄스터류
          </button>
        </div>
      );
    }
    render(<LayerHost registry={{ L1: { title: '어떤 친구인가요?', Component: Swap } }} />);
    act(() => layerStore.open('L1'));
    const group = screen.getByRole('button', { name: '햄스터류' });
    group.focus();
    fireEvent.click(group);
    expect(group.isConnected).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: '어떤 친구인가요?' }));
  });

  it('스텝 변경 때 React 가 버튼 DOM 을 재사용해도(포커스 살아 있음) 새 제목으로 포커스(동기)', () => {
    render(<LayerHost registry={stepRegistry} />);
    act(() => layerStore.open('L5', { step: 'L5' }));
    const reg = screen.getByRole('button', { name: '등록' });
    reg.focus();
    fireEvent.click(reg);
    const dlg = screen.getByRole('dialog', { name: '내 케이지' });
    const title = document.getElementById(dlg.getAttribute('aria-labelledby') ?? '');
    expect(document.activeElement).toBe(title);
    expect(title).toHaveTextContent('내 케이지');
    const save = screen.getByRole('button', { name: '저장' });
    save.focus();
    fireEvent.click(save);
    expect(screen.getByRole('dialog', { name: '규격 확인' })).toBeInTheDocument();
    expect(document.activeElement).toBe(title);
  });

  it('입력에 포커스가 있으면 스텝 변경·리렌더에도 빼앗지 않는다', async () => {
    function KeepInput({ props }: { props: Record<string, unknown> }) {
      return (
        <div>
          <input aria-label="가로" />
          <p>{String(props.step)}</p>
          {props.step === 'b' ? <span>추가</span> : null}
        </div>
      );
    }
    render(<LayerHost registry={{ L5: { title: '규격 확인', Component: KeepInput } }} />);
    act(() => layerStore.open('L5', { step: 'a' }));
    const input = screen.getByRole('textbox', { name: '가로' });
    input.focus();
    act(() => layerStore.open('L5', { step: 'b' }, { replace: true }));
    expect(screen.getByText('추가')).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(document.activeElement).toBe(input);
  });

  it('band 모드: 흰 제목 행이 밴드로 교체되면(포커스된 h2 언마운트) 밴드의 첫 heading 으로 복구', async () => {
    function Banded() {
      const chrome = useLayerChrome();
      useEffect(() => {
        chrome.setBand(<h3 className="band-h">밴드 제목</h3>);
      }, [chrome]);
      return <button type="button">항목</button>;
    }
    render(
      <Layer kind="L2" title="체크리스트" onClose={() => undefined}>
        <Banded />
      </Layer>,
    );
    const bandHeading = await screen.findByRole('heading', { name: '밴드 제목' });
    await waitFor(() => expect(document.activeElement).toBe(bandHeading));
    expect(bandHeading).toHaveAttribute('tabindex', '-1');
  });

  it('레이어 안에서 포커스된 요소가 언마운트되면(로컬 상태 교체) 제목으로 복구', async () => {
    function LocalStep() {
      const [g, setG] = useState(false);
      return g ? <p>종 선택</p> : <button type="button" onClick={() => setG(true)}>그룹</button>;
    }
    render(
      <Layer kind="L1" title="어떤 친구인가요?" onClose={() => undefined}>
        <LocalStep />
      </Layer>,
    );
    const btn = screen.getByRole('button', { name: '그룹' });
    btn.focus();
    fireEvent.click(btn);
    const title = screen.getByRole('heading', { name: '어떤 친구인가요?' });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('닫힐 때 트리거가 사라졌으면 main 의 h1 로(tabIndex=-1)', async () => {
    function Page() {
      const [open, setOpen] = useState(false);
      const [picked, setPicked] = useState(false);
      return (
        <main>
          <h1>우리 햄스터</h1>
          {!picked ? (
            <button type="button" onClick={() => setOpen(true)}>
              친구 선택
            </button>
          ) : null}
          {open ? (
            <Layer
              kind="L1"
              title="어떤 친구인가요?"
              onClose={() => {
                setPicked(true);
                setOpen(false);
              }}
            >
              <p>x</p>
            </Layer>
          ) : null}
        </main>
      );
    }
    render(<Page />);
    const trigger = screen.getByRole('button', { name: '친구 선택' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const h1 = screen.getByRole('heading', { level: 1, name: '우리 햄스터' });
    await waitFor(() => expect(document.activeElement).toBe(h1));
    expect(h1).toHaveAttribute('tabindex', '-1');
  });
});
