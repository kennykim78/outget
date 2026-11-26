// 레이어 열기/닫기(UX v2.3.1 · 스펙22 §2.9 · 계약 C-R5-5 · 스펙33 §2.1). 화면에는 한 번에 하나.
//   history 가 원본: 항목마다 state = {wsLayer, wsLayerProps, wsParent, wsDepth}.
//   - open: 새 history 항목 push(레이어 위 레이어 = push, 뒤로 = 이전 레이어). url 을 주면 그 URL(L4·L5·L7·L8), 없으면 같은 URL(L1·L2).
//   - close(✕·ESC·스크림): 스택 전체 닫기 — wsDepth 만큼 go(-n) 로 부모 항목에 돌아간다.
//     부모 항목이 딥링크(depth 0)면 replaceState(wsParent) — 재로드 없음·history.length 불변(D-55).
//   - popstate: 도착한 항목의 state 로 현재 레이어를 복원(없으면 닫힘).
//   L3(L2 안)·L6(L5·L2 안)은 레이어가 아니라 스텝 — wsLayerProps.step.
//   상태는 모듈 단일 저장소 — LayerHost 가 구독하고 popstate 를 연결한다(Provider 불필요).
import { useSyncExternalStore } from 'react';
import { captureMagicToken, hasMagicHash } from '../../save/magicLink';

export const LAYER_KINDS = ['L1', 'L2', 'L4', 'L5', 'L7', 'L8'] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];
export type LayerProps = Record<string, unknown>;

/** history 에 남기는 props 키(문자열만). 그 밖의 값(이메일·좌표 등)은 history 에 쓰지 않는다(불변식 ⑧). */
const HISTORY_PROP_KEYS = ['typeId', 'itemId', 'productId', 'step'] as const;
export type HistoryLayerProps = Partial<Record<(typeof HISTORY_PROP_KEYS)[number], string>>;

export interface LayerHistoryState {
  wsLayer: LayerKind;
  wsLayerProps: HistoryLayerProps;
  /** 레이어를 모두 닫았을 때의 페이지 경로. */
  wsParent: string;
  /** 부모 항목에서 몇 번 push 했는지(딥링크 항목 = 0). */
  wsDepth: number;
}

export interface OpenOptions {
  /** 이 레이어의 URL(L4 /{slug}/supplies/{item} · L5 /check/{item} · L7 /products/{id} · L8 /save). 없으면 현재 URL. */
  url?: string;
  /** push 대신 현재 항목 교체(같은 깊이). */
  replace?: boolean;
}

export interface DeepLinkOptions {
  /** 부모가 다른 문서면(예: /save → /{slug}) 닫을 때 location.replace — 그 외엔 replaceState. */
  documentParent?: boolean;
  /** 프리렌더 aside 의 data-ws-id(React 패널이 유지). */
  wsId?: string | null;
  /** 다 닫았을 때 문서 제목(387 D3 — /supplies/{item}/{type} 의 부모 제목). 없으면 LayerHost 기본. */
  parentTitle?: string | null;
  /** 바로 앞 history 항목이 부모 문서면 닫기 = history.back()(387 D4 — 같은 URL 항목 중복 0). 아니면 replaceState. */
  backToParent?: boolean;
}

export interface LayerControl {
  open(kind: LayerKind, props?: LayerProps, opts?: OpenOptions): void;
  close(): void;
}

export interface OpenLayer {
  kind: LayerKind;
  props: LayerProps;
  /** 프리렌더 aside 의 data-ws-id(딥링크일 때만). */
  wsId?: string | null;
}

type Listener = () => void;

const WS_KEYS = ['wsLayer', 'wsLayerProps', 'wsParent', 'wsDepth'] as const;

let current: OpenLayer | null = null;
/** 현재 레이어가 서 있는 history 항목의 state(같은 탭 매직링크 해시 이동 때 다음 항목의 깊이·부모 계산용). */
let currentState: LayerHistoryState | null = null;
/** close() 가 go(-n) 을 부른 뒤 도착할 popstate 를 기다리는 중. */
let closingAll = false;
const CLOSING_SAFETY_MS = 1000;
let closingTimer: ReturnType<typeof setTimeout> | null = null;
/** back() 이 history.back() 을 부른 뒤 도착할 popstate 를 기다리는 중(더블탭 방지). */
let backPending = false;
let backTimer: ReturnType<typeof setTimeout> | null = null;
function clearBackPending(): void {
  backPending = false;
  if (backTimer !== null) {
    clearTimeout(backTimer);
    backTimer = null;
  }
}
/** 딥링크 부모가 다른 문서인지(이 문서 수명 동안). */
let deepLinkDocumentParent = false;
let deepLinkWsId: string | null = null;
let deepLinkParentTitle: string | null = null;
let deepLinkBackToParent = false;
const listeners = new Set<Listener>();

/** 문서 이동(다른 문서 부모). 테스트는 replace 를 바꿔 끼운다(jsdom location 은 교체 불가). */
export const layerNav = {
  replace(href: string): void {
    window.location.replace(href);
  },
};

function emit(): void {
  for (const l of listeners) l();
}

// 스크롤 유지(R6 G1, P3 N1): 레이어가 열려 있는 동안만 history.scrollRestoration='manual' + 열 때 scrollX/Y 저장, 다 닫히면 복원.
//   브라우저 자동 복원은 popstate 직후(같은 태스크) 도착 항목의 모드로 돌므로, 모드 원복은 한 틱 뒤로 미룬다.
//   push 는 현재 항목 모드를 복사한다 — 그래서 push 전에 manual 로 바꿔야 부모 항목으로 돌아올 때도 manual.
interface ScrollHold {
  x: number;
  y: number;
  mode: ScrollRestoration | null;
}
let scrollHold: ScrollHold | null = null;
/** 닫힘 뒤 모드 원복 대기(그 사이 다시 열리면 취소 — 원래 모드를 이어 받는다). */
let scrollRelease: { timer: ReturnType<typeof setTimeout>; mode: ScrollRestoration | null } | null = null;

function setRestoration(mode: ScrollRestoration | null): void {
  if (mode === null) return;
  try {
    window.history.scrollRestoration = mode;
  } catch {
    // 일부 환경은 쓰기 불가 — 위치 복원(scrollTo)만으로 충분
  }
}

function holdScroll(): void {
  if (scrollHold !== null) return;
  let mode: ScrollRestoration | null = 'scrollRestoration' in window.history ? window.history.scrollRestoration : null;
  if (scrollRelease !== null) {
    clearTimeout(scrollRelease.timer);
    mode = scrollRelease.mode;
    scrollRelease = null;
  }
  scrollHold = { x: window.scrollX, y: window.scrollY, mode };
  setRestoration('manual');
}

function releaseScroll(): void {
  const hold = scrollHold;
  if (hold === null) return;
  scrollHold = null;
  const put = (): void => {
    if (Math.abs(window.scrollY - hold.y) > 1 || Math.abs(window.scrollX - hold.x) > 1) window.scrollTo(hold.x, hold.y);
  };
  put();
  scrollRelease = {
    mode: hold.mode,
    timer: setTimeout(() => {
      scrollRelease = null;
      put(); // 레이어 껍데기 해제(overflow 원복) 뒤 한 번 더
      setRestoration(hold.mode);
    }, 0),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeProps(props: LayerProps): HistoryLayerProps {
  const out: HistoryLayerProps = {};
  for (const k of HISTORY_PROP_KEYS) {
    const v = props[k];
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  return out;
}

/** history.state → 레이어 state(형식이 아니면 null). */
export function readLayerState(s: unknown): LayerHistoryState | null {
  if (!isRecord(s)) return null;
  const kind = s.wsLayer;
  if (typeof kind !== 'string' || !(LAYER_KINDS as readonly string[]).includes(kind)) return null;
  if (typeof s.wsParent !== 'string' || !s.wsParent.startsWith('/')) return null;
  const depth = s.wsDepth;
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0) return null;
  const props = isRecord(s.wsLayerProps) ? sanitizeProps(s.wsLayerProps) : {};
  return { wsLayer: kind as LayerKind, wsLayerProps: props, wsParent: s.wsParent, wsDepth: depth };
}

/** 레이어 키를 뺀 나머지 state(다른 코드가 쓴 값은 보존). 비면 null. */
function stripLayerKeys(s: unknown): Record<string, unknown> | null {
  if (!isRecord(s)) return null;
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (!(WS_KEYS as readonly string[]).includes(k)) rest[k] = v;
  return Object.keys(rest).length > 0 ? rest : null;
}

function herePath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function fromState(s: LayerHistoryState): OpenLayer {
  return s.wsDepth === 0 && deepLinkWsId !== null
    ? { kind: s.wsLayer, props: { ...s.wsLayerProps }, wsId: deepLinkWsId }
    : { kind: s.wsLayer, props: { ...s.wsLayerProps } };
}

/** 바로 앞 history 항목이 다른 문서이고 그 경로가 parent 인지(Navigation API — 없으면 false → replaceState). */
function previousEntryIsParent(parent: string): boolean {
  const nav = (window as unknown as { navigation?: unknown }).navigation;
  if (!isRecord(nav) || typeof nav.entries !== 'function' || !isRecord(nav.currentEntry)) return false;
  const idx = nav.currentEntry.index;
  if (typeof idx !== 'number' || idx < 1) return false;
  const entries: unknown = (nav.entries as () => unknown)();
  if (!Array.isArray(entries)) return false;
  const prev: unknown = entries[idx - 1];
  if (!isRecord(prev) || prev.sameDocument === true || typeof prev.url !== 'string') return false;
  try {
    const u = new URL(prev.url);
    if (u.origin !== window.location.origin) return false;
    return `${u.pathname}${u.search}` === parent || decodeURI(u.pathname) === decodeURI(parent);
  } catch {
    return false;
  }
}

/** 딥링크 항목(depth 0)에서 닫기: 부모 경로로 교체(재로드 없음) 또는 다른 문서면 location.replace. */
function closeDeepLinkEntry(s: LayerHistoryState): void {
  if (deepLinkBackToParent && previousEntryIsParent(s.wsParent)) {
    // go(-depth)로 도착한 L4를 문서 이동 전에 저장한다. bfcache가 L5 화면을 보관하지 않게 한다.
    currentState = s;
    current = fromState(s);
    emit();
    // 부모 문서로 뒤로(문서 이동) — 레이어는 이동까지 그대로 둔다. 연타 방지 = closingAll + 안전 해제.
    closingAll = true;
    if (closingTimer !== null) clearTimeout(closingTimer);
    closingTimer = setTimeout(() => {
      closingTimer = null;
      closingAll = false;
    }, CLOSING_SAFETY_MS);
    window.history.back();
    return;
  }
  releaseScroll();
  current = null;
  currentState = null;
  closingAll = false;
  if (deepLinkDocumentParent) {
    deepLinkDocumentParent = false;
    deepLinkWsId = null;
    emit();
    layerNav.replace(s.wsParent);
    return;
  }
  deepLinkWsId = null;
  window.history.replaceState(stripLayerKeys(window.history.state), '', s.wsParent);
  emit();
}

export const layerStore = {
  get(): OpenLayer | null {
    return current;
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /** 열기 — 기본 push(레이어 위 레이어도 push, 뒤로 = 이전 레이어). replace 면 같은 깊이 교체. */
  open(kind: LayerKind, props: LayerProps = {}, opts: OpenOptions = {}): void {
    const s = readLayerState(window.history.state);
    const parent = s ? s.wsParent : herePath();
    const depth = s ? s.wsDepth : 0;
    const replace = opts.replace === true && s !== null;
    const state: LayerHistoryState = {
      wsLayer: kind,
      wsLayerProps: sanitizeProps(props),
      wsParent: parent,
      wsDepth: replace ? depth : depth + 1,
    };
    const next = { ...(stripLayerKeys(window.history.state) ?? {}), ...state };
    if (current === null) holdScroll(); // push 전에(새 항목이 manual 을 복사)
    if (replace) window.history.replaceState(next, '', opts.url);
    else window.history.pushState(next, '', opts.url);
    closingAll = false;
    current = { kind, props };
    currentState = state;
    emit();
  },
  /** 딥링크 진입(프리렌더 레이어 URL·/save): 현재 항목을 depth 0 레이어 항목으로 교체(push 없음). */
  initDeepLink(kind: LayerKind, props: LayerProps, parentPath: string, opts: DeepLinkOptions = {}): void {
    deepLinkDocumentParent = opts.documentParent === true;
    deepLinkWsId = opts.wsId ?? null;
    deepLinkParentTitle = opts.parentTitle ?? null;
    deepLinkBackToParent = opts.backToParent === true;
    const state: LayerHistoryState = { wsLayer: kind, wsLayerProps: sanitizeProps(props), wsParent: parentPath, wsDepth: 0 };
    window.history.replaceState({ ...(stripLayerKeys(window.history.state) ?? {}), ...state }, '');
    holdScroll();
    closingAll = false;
    current = fromState(state);
    currentState = state;
    emit();
  },
  /** 딥링크 부모 문서 제목(닫은 뒤 document.title). 없으면 null. */
  deepLinkParentTitle(): string | null {
    return deepLinkParentTitle;
  },
  /** 문서 부팅 시 딥링크가 아니면: 이전 문서가 남긴 레이어 state 를 지운다(재로드 후 유령 레이어 방지). */
  clearStaleState(): void {
    if (readLayerState(window.history.state) !== null) {
      window.history.replaceState(stripLayerKeys(window.history.state), '');
    }
  },
  /** 닫기(스택 전체). push 한 항목이면 go(-depth) → popstate 에서 실제로 닫힌다(뒤로가기와 같은 경로). */
  close(): void {
    if (current === null || closingAll) return; // 전체 닫기 진행 중 재호출(ESC 반복·더블탭) 무시
    const s = readLayerState(window.history.state);
    if (s === null) {
      releaseScroll();
      current = null;
      currentState = null;
      closingAll = false;
      emit();
      return;
    }
    if (s.wsDepth === 0) {
      closeDeepLinkEntry(s);
      return;
    }
    closingAll = true;
    // popstate 가 끝내 오지 않아도 닫기가 영구히 막히지 않게 안전 해제.
    if (closingTimer !== null) clearTimeout(closingTimer);
    closingTimer = setTimeout(() => {
      closingTimer = null;
      closingAll = false;
    }, CLOSING_SAFETY_MS);
    window.history.go(-s.wsDepth);
  },
  /** 한 단계 뒤로(L6 스텝 [뒤로] 등). popstate 도착 전 재호출·전체 닫기 중 호출은 무시. */
  back(): void {
    if (backPending || closingAll) return;
    backPending = true;
    if (backTimer !== null) clearTimeout(backTimer);
    backTimer = setTimeout(() => {
      backTimer = null;
      backPending = false;
    }, CLOSING_SAFETY_MS);
    window.history.back();
  },
  /** popstate: 도착한 항목의 state 로 복원. 전체 닫기 중 딥링크 항목에 도착하면 부모로 교체. */
  onPopState(e: PopStateEvent): void {
    clearBackPending();
    const s = readLayerState(e.state);
    if (closingAll && s !== null && s.wsDepth === 0) {
      closeDeepLinkEntry(s);
      return;
    }
    // 같은 탭 매직링크(/save#t=): 해시만 바뀐 state=null 항목 — 닫지 않는다. 토큰을 먼저 URL 에서 지우고(captureMagicToken),
    //   그 항목을 L8 항목으로 교체(이전 레이어 위 1단 — 닫기 go(-n) 이 원래 부모로 돌아간다). 연결 화면 전환은 L8 이 구독으로(D1).
    if (s === null && !closingAll && hasMagicHash()) {
      captureMagicToken();
      const state: LayerHistoryState = {
        wsLayer: 'L8',
        wsLayerProps: {},
        wsParent: currentState?.wsParent ?? '/',
        wsDepth: currentState ? currentState.wsDepth + 1 : 1,
      };
      window.history.replaceState({ ...(stripLayerKeys(window.history.state) ?? {}), ...state }, ''); // URL = captureMagicToken 이 이미 해시를 뗀 /save
      if (current === null) holdScroll();
      current = current?.kind === 'L8' ? current : { kind: 'L8', props: {} };
      currentState = state;
      emit();
      return;
    }
    closingAll = false;
    const next = s ? fromState(s) : null;
    currentState = s;
    if (next === null && current === null) return;
    if (next === null) releaseScroll();
    else if (current === null) holdScroll(); // 앞으로 가기로 레이어 항목 재진입
    current = next;
    emit();
  },
  /** bfcache 복원은 popstate 없이도 일어난다. 떠날 때 남은 닫기 잠금·타이머를 해제하고 도착 항목을 다시 읽는다. */
  onPageShow(e: PageTransitionEvent): void {
    if (!e.persisted) return;
    closingAll = false;
    if (closingTimer !== null) clearTimeout(closingTimer);
    closingTimer = null;
    layerStore.onPopState(new PopStateEvent('popstate', { state: window.history.state }));
  },
  /** 테스트 전용 초기화. */
  resetForTest(): void {
    current = null;
    currentState = null;
    closingAll = false;
    clearBackPending();
    deepLinkDocumentParent = false;
    deepLinkWsId = null;
    deepLinkParentTitle = null;
    deepLinkBackToParent = false;
    if (closingTimer !== null) clearTimeout(closingTimer);
    closingTimer = null;
    if (scrollRelease !== null) clearTimeout(scrollRelease.timer);
    setRestoration(scrollRelease?.mode ?? scrollHold?.mode ?? null);
    scrollRelease = null;
    scrollHold = null;
    emit();
  },
};

/** 현재 열린 레이어(구독). */
export function useOpenLayer(): OpenLayer | null {
  return useSyncExternalStore(layerStore.subscribe, layerStore.get, () => null);
}

const control: LayerControl = {
  open: (kind, props, opts) => layerStore.open(kind, props, opts),
  close: () => layerStore.close(),
};

export function useLayer(): LayerControl {
  return control;
}
