// 레이어 껍데기(스펙22 §2.9). 변형: ≤767 바텀시트 · 768–1023 모달 600 · ≥1024 모달 720 — L1~L8 전부 같은 모달(R3 U1, 드로어 폐기).
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
import type { LayerKind } from './useLayer';

export type LayerShellKind = LayerKind;
export type LayerVariant = 'sheet' | 'modal';

const MQ_SHEET = '(max-width: 767px)';

function matches(q: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
}

/**
 * 현재 뷰포트에서의 변형(순수 — 테스트 가능). matchMedia 가 없으면 모바일 우선 sheet.
 * 종류(kind)와 무관 — 모달 폭 600/720 은 CSS 미디어 쿼리가 정한다.
 */
export function layerVariantFor(): LayerVariant {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'sheet';
  return matches(MQ_SHEET) ? 'sheet' : 'modal';
}

function useLayerVariant(): LayerVariant {
  const [v, setV] = useState<LayerVariant>(() => layerVariantFor());
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const update = () => setV(layerVariantFor());
    const mq = window.matchMedia(MQ_SHEET);
    mq.addEventListener?.('change', update);
    update();
    return () => {
      mq.removeEventListener?.('change', update);
    };
  }, []);
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
  /** 대화상자 aria-describedby 대상 요소 id(없으면 null) — 이름(제목)은 그대로 두고 보조 설명만 잇는다. */
  setDescribedBy(id: string | null): void;
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
  /** 패널 data-ws-id(프리렌더 aside 와 같은 식별자, 스펙33 §2.1). */
  wsId?: string | null;
  onClose(): void;
  /**
   * 레이어 안 스텝 키(L1 그룹→종 · L3→L2 · L5↔L6 등 — LayerHost 가 props.step 을 넘긴다). 바뀌면 포커스를 잃은 경우(BODY·제거된 노드)
   * 새 제목으로 옮긴다(WCAG 2.4.3). 이미 레이어 안의 살아 있는 요소(입력 등)에 있으면 빼앗지 않는다.
   */
  stepKey?: string;
  children: ReactNode;
}

const HEADINGS = 'h1, h2, h3, h4, h5, h6';

/** 포커스를 잃었는지 — BODY·null·DOM 에서 제거된 노드. */
function focusLost(doc: Document): boolean {
  const a = doc.activeElement;
  return a === null || a === doc.body || a === doc.documentElement || !a.isConnected;
}

/** 입력 중인 편집 필드(텍스트 입력·선택·textarea·contenteditable) — 스텝 전환에도 포커스를 빼앗지 않는다. */
function isEditing(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'color', 'range'].includes(el.type);
  return false;
}

/** 프로그램 포커스가 가능하도록(이미 포커스 가능하면 그대로) tabIndex=-1 을 단다. */
function focusTarget(el: HTMLElement): HTMLElement {
  if (!el.matches(FOCUSABLE) && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  return el;
}

/** 닫힌 뒤 복귀 대상이 아직 쓸 수 있는지 — DOM 에 있고 숨겨지지 않았다. */
function usableOpener(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.isConnected || el === document.body) return false;
  if (el.closest('[hidden], [inert]')) return false;
  const check = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  if (typeof check === 'function' && !check.call(el)) return false;
  return true;
}

/** 복귀 대상이 없을 때 — main 의 h1, 없으면 #main, 없으면 main(WCAG 2.4.3, D8). */
function mainFallback(doc: Document): HTMLElement | null {
  const el = doc.querySelector<HTMLElement>('main h1') ?? doc.getElementById('main') ?? doc.querySelector<HTMLElement>('main');
  return el ? focusTarget(el) : null;
}

/**
 * 프리렌더 딥링크의 정적 레이어(div.ws-scrim · aside.ws-layer)를 걷어낸다 — React 레이어가 마운트되는 같은 useLayoutEffect 에서
 * 불러 이중 aside 프레임 0(스펙33 §2.1). React 스크림은 data-ws-scrim 으로 구분, React 패널은 aside 가 아니다.
 */
export function removePrerenderedLayer(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll('aside.ws-layer, div.ws-scrim:not([data-ws-scrim])'))) el.remove();
}

export function Layer({ kind, title: initialTitle, wsId, onClose, stepKey, children }: LayerProps) {
  const variant = useLayerVariant();
  const titleId = `ws-layer-title-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [title, setTitle] = useState(initialTitle);
  const [back, setBack] = useState<LayerBack | null>(null);
  const [band, setBand] = useState<ReactNode | null>(null);
  const [describedBy, setDescribedBy] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 기본 제목이 바뀔 때만 반영 — 마운트 때 내용이 setTitle 로 정한 제목(L4 용품명 등)을 덮지 않는다.
  const prevInitialTitle = useRef(initialTitle);
  useEffect(() => {
    if (prevInitialTitle.current === initialTitle) return;
    prevInitialTitle.current = initialTitle;
    setTitle(initialTitle);
  }, [initialTitle]);

  // 포털 컨테이너 — body 직속(다른 자식은 inert).
  const [container] = useState(() => {
    const el = document.createElement('div');
    el.className = 'ws-layer-root';
    return el;
  });

  // 열기: 포털 부착, 배경 inert, 스크롤 잠금, 제목 포커스. 닫기: 모두 복원 + 연 요소로 포커스 복귀.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    removePrerenderedLayer(document);
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
      // 복귀: 연 요소가 살아 있으면 그곳, 아니면 main h1(D8). 닫힘과 같은 커밋·직후에 트리거가 사라질 수 있어(동물 선택 → 홈 교체)
      //   한 틱 뒤에도 포커스를 잃었으면 다시 main h1 로.
      if (usableOpener(opener)) opener.focus();
      else mainFallback(document)?.focus();
      setTimeout(() => {
        if (document.querySelector('.ws-layer-root')) return; // 다음 레이어가 열렸다 — 그 레이어가 포커스를 맡는다
        if (focusLost(document)) mainFallback(document)?.focus();
      }, 0);
    };
  }, [container]);

  // 포커스 복구: 레이어 안에서 포커스를 잃으면(BODY·제거된 노드) 현재 제목으로. 살아 있는 요소의 포커스는 건드리지 않는다.
  //   onStep: 스텝 전환 — React 가 같은 모양의 버튼 DOM 을 재사용하면(L5 [등록] 자리에 L6 [저장]) 포커스가 "살아 있는" 채로
  //   새 제목이 낭독되지 않는다. 그래서 스텝 전환 때는 입력 중(편집 필드)만 보호하고 그 밖엔 새 제목으로 옮긴다.
  const recoverFocus = useCallback((onStep = false) => {
    const panel = panelRef.current;
    if (!panel || !panel.isConnected) return;
    if (!focusLost(document)) {
      const a = document.activeElement as HTMLElement;
      if (!onStep || !panel.contains(a) || isEditing(a)) return;
    }
    const title = titleRef.current?.isConnected ? titleRef.current : null;
    const heading = title ?? panel.querySelector<HTMLElement>(HEADINGS);
    (heading ? focusTarget(heading) : panel).focus();
  }, []);

  // 스텝 전환(D1): 키가 바뀐 커밋에서 눌린 버튼이 사라졌으면 새 제목으로. 첫 실행은 열기 효과가 맡는다.
  const prevStepKey = useRef(stepKey);
  useLayoutEffect(() => {
    if (prevStepKey.current === stepKey) return;
    prevStepKey.current = stepKey;
    recoverFocus(true);
  }, [stepKey, recoverFocus]);

  // 일반 가드: 내용 교체(로컬 상태 스텝·L2 밴드 교체 등)로 포커스된 노드가 언마운트되면 복구. focusout 은 브라우저마다
  //   제거 시 발화가 달라 MutationObserver(childList)와 함께 본다.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => recoverFocus()) : null;
    mo?.observe(panel, { childList: true, subtree: true });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget !== null) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        recoverFocus();
      }, 0);
    };
    panel.addEventListener('focusout', onFocusOut);
    return () => {
      mo?.disconnect();
      panel.removeEventListener('focusout', onFocusOut);
      if (timer !== null) clearTimeout(timer);
    };
  }, [recoverFocus]);

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
    const atTitle =
      active === titleRef.current || active === panelRef.current || (active instanceof HTMLElement && active.id === titleId);
    if (e.shiftKey && (active === first || atTitle)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, [titleId]);

  const chrome = useMemo<LayerChrome>(
    () => ({ titleId, close: () => onCloseRef.current(), setTitle, setBack, setBand, setDescribedBy }),
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
        data-ws-id={wsId ?? undefined}
        data-ws-variant={variant}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy ?? undefined}
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
