// 레이어 껍데기(스펙22 §2.9). 변형: ≤767 바텀시트 · 768–1023 모달 600 · ≥1024 모달 720(L4·L7 은 우측 드로어 480).
//   접근성: role=dialog aria-modal aria-labelledby, 열 때 제목 포커스, Tab 순환(포커스 트랩), ESC·✕·스크림 닫힘,
//   배경(body 의 다른 자식) inert, 닫히면 연 요소로 포커스 복귀, html overflow hidden(스크롤 위치 유지).
//   내용은 children — 스텝 제목·뒤로·L2 요약 밴드는 useLayerChrome() 로 바꾼다.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { COPY } from '@ws/copy';

export type LayerShellKind = 'L1' | 'L2' | 'L4' | 'L5' | 'L7' | 'L8';
export type LayerVariant = 'sheet' | 'modal' | 'drawer';

const MQ_SHEET = '(max-width: 767px)';
const MQ_DESKTOP = '(min-width: 1024px)';

function matches(q: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
}

/** 현재 뷰포트에서의 변형(순수 — 테스트 가능). matchMedia 가 없으면 모바일 우선 sheet. */
export function layerVariantFor(kind: LayerShellKind): LayerVariant {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'sheet';
  if (matches(MQ_SHEET)) return 'sheet';
  if ((kind === 'L4' || kind === 'L7') && matches(MQ_DESKTOP)) return 'drawer';
  return 'modal';
}

function useLayerVariant(kind: LayerShellKind): LayerVariant {
  const [v, setV] = useState<LayerVariant>(() => layerVariantFor(kind));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const update = () => setV(layerVariantFor(kind));
    const mqs = [window.matchMedia(MQ_SHEET), window.matchMedia(MQ_DESKTOP)];
    for (const m of mqs) m.addEventListener?.('change', update);
    update();
    return () => {
      for (const m of mqs) m.removeEventListener?.('change', update);
    };
  }, [kind]);
  return v;
}

export interface LayerBack {
  label: string;
  onBack(): void;
}

export interface LayerChrome {
  titleId: string;
  close(): void;
  setTitle(title: string): void;
  setBack(back: LayerBack | null): void;
  /** L2 요약 밴드(bg-100). 있으면 흰 제목 행 대신 그린다 — 밴드 안 제목 요소에 id={titleId} 를 달 것. */
  setBand(band: ReactNode | null): void;
}

const ChromeContext = createContext<LayerChrome | null>(null);

/** 레이어 내용에서 제목·뒤로·요약 밴드를 바꾼다. Layer 밖에서 호출하면 throw. */
export function useLayerChrome(): LayerChrome {
  const c = useContext(ChromeContext);
  if (!c) throw new Error('useLayerChrome must be used inside <Layer>');
  return c;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('inert'));
}

export interface LayerProps {
  kind: LayerShellKind;
  /** 기본 제목(스텝이 setTitle 로 바꿀 수 있다). */
  title: string;
  onClose(): void;
  children: ReactNode;
}

export function Layer({ kind, title: initialTitle, onClose, children }: LayerProps) {
  const variant = useLayerVariant(kind);
  const titleId = `ws-layer-title-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [title, setTitle] = useState(initialTitle);
  const [back, setBack] = useState<LayerBack | null>(null);
  const [band, setBand] = useState<ReactNode | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => setTitle(initialTitle), [initialTitle]);

  // 포털 컨테이너 — body 직속(다른 자식은 inert).
  const [container] = useState(() => {
    const el = document.createElement('div');
    el.className = 'ws-layer-root';
    return el;
  });

  // 열기: 포털 부착, 배경 inert, 스크롤 잠금, 제목 포커스. 닫기: 모두 복원 + 연 요소로 포커스 복귀.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.appendChild(container);
    const inerted: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === container || el.tagName === 'SCRIPT' || el.hasAttribute('inert')) continue;
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
      inerted.push(el);
    }
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    const prevGutter = html.style.getPropertyValue('scrollbar-gutter');
    html.style.overflow = 'hidden';
    html.style.setProperty('scrollbar-gutter', 'stable');
    (titleRef.current ?? panelRef.current)?.focus();
    return () => {
      for (const el of inerted) {
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
      }
      html.style.overflow = prevOverflow;
      if (prevGutter) html.style.setProperty('scrollbar-gutter', prevGutter);
      else html.style.removeProperty('scrollbar-gutter');
      container.remove();
      if (opener && opener.isConnected) opener.focus();
    };
  }, [container]);

  // ESC 닫기(문서 단위 — 한 번에 하나라 충돌 없음).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // 포커스 트랩.
  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const list = focusables(panelRef.current);
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    const atTitle = active === titleRef.current || active === panelRef.current;
    if (e.shiftKey && (active === first || atTitle)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const chrome = useMemo<LayerChrome>(
    () => ({ titleId, close: () => onCloseRef.current(), setTitle, setBack, setBand }),
    [titleId],
  );

  const closeLabel = COPY.supplyLayer.close;

  return createPortal(
    <ChromeContext.Provider value={chrome}>
      <div className="ws-scrim" aria-hidden="true" data-ws-scrim="" onClick={() => onCloseRef.current()} />
      <div
        ref={panelRef}
        className={`ws-layer-panel ws-layer-panel--${variant}`}
        data-ws-layer={kind}
        data-ws-variant={variant}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {variant === 'sheet' ? <span className="ws-layer-grab" aria-hidden="true" /> : null}
        {band !== null ? (
          <div className="ws-layer-band">
            {band}
            <button type="button" className="ws-layer-close" aria-label={closeLabel} onClick={() => onCloseRef.current()}>
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        ) : (
          <div className="ws-layer-head">
            {back ? (
              <button type="button" className="ws-layer-back ws-t-cta" onClick={back.onBack}>
                <span aria-hidden="true">‹ </span>
                {back.label}
              </button>
            ) : null}
            <h2 id={titleId} ref={titleRef} className="ws-layer-title ws-t-title" tabIndex={-1}>
              {title}
            </h2>
            <button type="button" className="ws-layer-close" aria-label={closeLabel} onClick={() => onCloseRef.current()}>
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        )}
        <div className="ws-layer-content">{children}</div>
      </div>
    </ChromeContext.Provider>,
    container,
  );
}

/** 레이어 본문(내부 스크롤). */
export function LayerBody({ children }: { children: ReactNode }) {
  return <div className="ws-layer-body">{children}</div>;
}

/** 레이어 꼬리(위 1px line, 채운 CTA ≤1). */
export function LayerFoot({ children }: { children: ReactNode }) {
  return <div className="ws-layer-foot">{children}</div>;
}
