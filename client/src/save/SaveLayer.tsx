// L8 이메일 저장(UX §4 L8 · 스펙33 §7 · PRD US-025 · 계약 C-R5-2). 진입 = 홈 B 저장 배너 링크 · L2 꼬리 링크 · /save 딥링크.
//   상태: input(A) → sending(B) → sent(C) · connect → verifying → confirmed | expired · linked(로그인 상태)
//         · serverLinked(이 브라우저에 서버 세션만 살아 있음 — 연결하기 | 연결 해제).
//   - 이메일은 이 컴포넌트 state(메모리)에만 — localStorage·history·이벤트 0(불변식 ⑧ / K4). 마케팅 동의·비밀번호·소셜 0.
//   - /save#t= : 렌더 첫 단계에서 captureMagicToken(즉시 replaceState). verify 는 [이 기기 연결하기] 클릭 때만
//     (SEC-3 M-1 — 링크 스캐너가 토큰을 소진하거나 남의 링크로 자동 연결되는 로그인 CSRF 방지). 연결 후 마스킹 주소 표시(저장 0).
//   - R6 D2(SEC-4 L-1(c)): 연결(verify) 직후 PUT 0 — 저장할 준비가 있으면 확인 화면(confirmSave: COPY.save.confirmMasked
//     마스킹 주소 + [이 주소로 저장하기])을 거친 뒤 sync.confirm() 이 첫 PUT. 빈 기기(connectedEmpty)는 예전대로 바로 연결.
//   - 연결 안 된 채 열면 GET /auth/session 1회(미전송 로그아웃이 있으면 그것부터 재시도 — SEC-3 L-3).
//   - 마스코트는 요약 줄 AnimalAvatar sm 하나(L8 유일). L3 전 숫자 0(D-34). 채운 CTA ≤ 1.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BACKUP_RETENTION_DAYS, COPY, formatCopy } from '@ws/copy';
import type { PublicAnimalType, PublicRequirement } from '@ws/engine';
import { useAnimalSelection } from '../animal/selection';
import { useLayerPage } from '../app/layerPage';
import { toDeriveOptions, useCageCompatState } from '../checklist/cageCompat';
import { deriveChecklist } from '../checklist/derive';
import { useSetup } from '../checklist/setupStore';
import { CAGE_ITEM_ID, useCage } from '../context/cageStore';
import { track } from '../events/track';
import { wsStorage } from '../lib/storage';
import AnimalAvatar from '../ui/AnimalAvatar';
import { LayerBody, LayerFoot, useLayerChrome } from '../ui/layer/Layer';
import type { LayerContentProps } from '../ui/layer/LayerHost';
import { readLayerState } from '../ui/layer/useLayer';
import type { MagicEntry } from './api';
import { fetchSaveApi, type SaveApi } from './api';
import type { SaveMergeWinner } from './contract';
import { captureMagicToken, clearMagicToken, subscribeMagicToken } from './magicLink';
import { SAVE_STATE_KEY } from './saveStateStore';
import { useSaveLinked } from './useSaveLinked';
import { getSaveSync, type SaveSync } from './sync';
import '../styles/save.css';

export const RESEND_COOLDOWN_S = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;

type View =
  | 'input'
  | 'sending'
  | 'sent'
  | 'connect'
  | 'verifying'
  | 'confirmSave'
  | 'saving'
  | 'confirmed'
  | 'expired'
  | 'linked'
  | 'serverLinked'
  // 89 스펙 §1 — 지우기 스텝(같은 레이어 본문, 새 레이어 0).
  | 'eraseConfirm'
  | 'erasing'
  | 'erased'
  | 'eraseReauth'
  | 'deviceConfirm'
  | 'deviceWiping'
  | 'deviceWiped';
/** 지우기 스텝에 들어온 화면(그만두기·뒤로 → 여기로, 포커스는 진입 링크). */
type EntryView = 'input' | 'linked' | 'serverLinked';
type EntryLink = 'erase-link' | 'device-link';
/** 스텝 진입 시 제목(h2)으로 포커스 옮기는 화면(P3 D6 + 89 스펙 접근성). */
const FOCUS_TITLE_VIEWS: ReadonlySet<View> = new Set<View>(['sent', 'confirmed', 'expired', 'confirmSave', 'eraseConfirm', 'deviceConfirm', 'eraseReauth', 'erased', 'deviceWiped']);
type PromptEntry = 'home_band' | 'l2_footer' | 'deeplink';

const SERVER_ENTRY: Record<PromptEntry, MagicEntry> = { home_band: 'home', l2_footer: 'checklist', deeplink: 'direct' };

/** 진입점: 딥링크 = depth 0, 홈 배너 = 부모 위 1단, L2 꼬리 = L2 위(2단↑). 진입점은 이 둘뿐(스펙33 §5.9). */
function promptEntry(): PromptEntry {
  const s = readLayerState(typeof window === 'undefined' ? null : window.history.state);
  if (!s || s.wsDepth === 0) return 'deeplink';
  return s.wsDepth >= 2 ? 'l2_footer' : 'home_band';
}

/** 테스트 주입(기본 = 앱 전역 동기화·동일 출처 API · 처음 화면 이동). */
export const saveLayerDeps: { sync: () => SaveSync; api: () => SaveApi; goHome: () => void } = {
  sync: getSaveSync,
  api: () => fetchSaveApi,
  // 89 스펙 ⑥(D7): 이 기기를 지운 뒤 닫기 → 새 문서로 처음 화면(헤더 칩·SaveDot·체크 등 메모리 상태 0).
  goHome: () => window.location.replace('/'),
};

/** 이 기기에 ws.save 말고 지울 ws.* 키가 있는지(래퍼 열거 — 하드코딩 0). */
function hasDeviceData(): boolean {
  return wsStorage.keys('ws.').some((k) => k !== SAVE_STATE_KEY);
}

function SaveSummary({ type, reqs, catalogUrl }: { type: PublicAnimalType; reqs: PublicRequirement[]; catalogUrl: string }) {
  const { setup } = useSetup(type.id);
  // P1 MAJOR-2: 홈 B·L2 와 같은 경로 — 케이지 스키마로 읽고, 케이지가 있을 때만 카탈로그를 불러 △(compat)를 넘긴다(개수 일치).
  const cageSchema = useMemo(() => reqs.find((r) => r.supplyItemId === CAGE_ITEM_ID)?.item.specSchema ?? null, [reqs]);
  const { cage } = useCage(type.id, { schema: cageSchema });
  const compatState = useCageCompatState(type.id, reqs, catalogUrl, cage);
  const view = useMemo(() => deriveChecklist(reqs, setup, toDeriveOptions(compatState)), [reqs, setup, compatState]);
  const answered = Boolean(setup?.answeredAt);
  const parts: string[] = [type.displayName];
  if (answered) {
    // 숫자는 L3 응답 후만(D-34). 이 문서 ws-data 에 요구사항이 있을 때만 남은 개수.
    if (view.requiredTotal >= 1 && view.remainingRequired > 0) parts.push(formatCopy(COPY.save.summaryRemaining, { n: view.remainingRequired }));
    if (cage) parts.push(`${COPY.save.summaryCage} ${cage.floorWcm}×${cage.floorDcm}×${cage.heightCm}cm`);
  }
  return (
    <p className="ws-save-summary" data-ws-save="summary">
      <AnimalAvatar asset={type.mascot} size="sm" tone="peach-soft" alt="" />
      <span className="ws-t-meta">{parts.join(' · ')}</span>
    </p>
  );
}

export default function SaveLayer({ close }: LayerContentProps) {
  const chrome = useLayerChrome();
  const page = useLayerPage();
  // 렌더 첫 단계 — 프래그먼트 토큰은 여기서 지워진다(이후 effect 의 verify 보다 먼저).
  const [captured, setCaptured] = useState(() => captureMagicToken());
  const linked = useSaveLinked();
  const [view, setView] = useState<View>(() => (captured ? ('invalid' in captured ? (linked ? 'linked' : 'expired') : 'connect') : linked ? 'linked' : 'input'));
  const [maskedEmail, setMaskedEmail] = useState<string | undefined>(undefined);
  const probed = useRef(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<'format' | 'network' | 'unavailable' | null>(null);
  /** M4: [이 기기 연결하기] 가 네트워크·서버 오류로 끝남(만료 아님) — 연결 화면에 안내, 토큰 유지. */
  const [connectFailed, setConnectFailed] = useState(false);
  const [winner, setWinner] = useState<SaveMergeWinner | null>(null);
  /** P1 MAJOR-1: 연결은 됐지만 로컬·서버 모두 저장할 준비가 없음(PUT 0) — "저장했어요" 대신 connectedEmpty. */
  const [linkedEmpty, setLinkedEmpty] = useState(false);
  /** 첫 저장(PUT) 실패 — 확인 화면에서 다시 시도(재시도 가능 오류). */
  const [saveFailed, setSaveFailed] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const entryRef = useRef<PromptEntry>(promptEntry());
  // 89 스펙 지우기 스텝 상태 — 메모리만(저장·이벤트 0).
  const [eraseOrigin, setEraseOrigin] = useState<EntryView>('input');
  const [entryLink, setEntryLink] = useState<EntryLink>('erase-link');
  const [wipeChecked, setWipeChecked] = useState(false);
  const [eraseError, setEraseError] = useState<{ kind: 'limited' | 'failed'; seq: number } | null>(null);
  const [erasedWiped, setErasedWiped] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const wipeHintId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-wipe-hint`;
  const promptSent = useRef(false);
  const inputId = `ws-save-email-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const errorId = `${inputId}-err`;

  const selection = useAnimalSelection(page.data.types);
  const type = useMemo(() => page.data.types.find((t) => t.id === selection.typeId) ?? null, [page.data.types, selection.typeId]);
  const reqs = useMemo(() => (type ? page.data.requirements.filter((r) => r.animalTypeId === type.id) : []), [page.data.requirements, type]);

  const title =
    view === 'eraseConfirm' || view === 'erasing'
      ? COPY.save.eraseTitle
      : view === 'erased'
        ? COPY.save.erasedTitle
        : view === 'eraseReauth'
          ? COPY.save.reauthTitle
          : view === 'deviceConfirm' || view === 'deviceWiping'
            ? COPY.save.deviceTitle
            : view === 'deviceWiped'
              ? COPY.save.deviceDoneTitle
              : view === 'sent'
      ? COPY.save.sentTitle
      : view === 'confirmed'
        ? linkedEmpty
          ? COPY.save.signedInTitle // 빈 연결: "저장했어요" 금지 — 연결 상태 제목(자동 저장은 켜져 있다)
          : COPY.save.confirmedTitle
        : view === 'expired'
          ? COPY.save.expiredTitle
          : view === 'linked'
            ? COPY.save.signedInTitle
            : view === 'confirmSave' || view === 'saving'
              ? COPY.save.confirmTitle
              : view === 'verifying' || view === 'connect'
                ? COPY.save.connectTitle
                : COPY.save.title;
  useLayoutEffect(() => {
    chrome.setTitle(title);
  }, [chrome, title]);

  // P3 D6: 결과 화면(보냄·확인·만료)으로 바뀌면 새 제목(h2, tabIndex=-1)으로 포커스 — 낭독 시점이 새 제목이 되도록
  //   제목 갱신(setTitle → Layer 재렌더)이 끝난 뒤 마이크로태스크에서. 첫 렌더는 Layer 열기 효과가 맡는다. 오류로 입력·연결 화면에
  //   돌아올 때는 포커스를 옮기지 않는다(버튼이 aria-disabled 로 포커스를 유지 + role=alert).
  //   89 스펙: 지우기 스텝(확인·재연결·완료) 진입도 제목으로(파괴 버튼은 첫 포커스 금지). 처리 중 → 확인 복귀(오류)는 버튼에 유지.
  //   그만두기·뒤로로 들어온 화면에 돌아가면 진입 링크로(없으면 제목).
  const prevView = useRef(view);
  const focusLink = useRef<EntryLink | null>(null);
  useEffect(() => {
    const from = prevView.current;
    if (from === view) return;
    prevView.current = view;
    const link = focusLink.current;
    focusLink.current = null;
    const fromBusy = (from === 'erasing' && view === 'eraseConfirm') || (from === 'deviceWiping' && view === 'deviceConfirm');
    if (!link && (fromBusy || !FOCUS_TITLE_VIEWS.has(view))) return;
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const titleEl = document.getElementById(chrome.titleId);
      const target = link ? titleEl?.closest('[role="dialog"]')?.querySelector<HTMLElement>(`[data-ws-save="${link}"]`) : null;
      (target ?? titleEl)?.focus();
    });
    return () => {
      live = false;
    };
  }, [view, chrome.titleId]);

  // 같은 탭 매직링크(L8 이 열린 채 /save#t= 붙여넣기) — 새 토큰이면 연결 확인 화면으로. verify 는 여전히 클릭 때만(SEC-3 M-1).
  useEffect(
    () =>
      subscribeMagicToken(() => {
        const next = captureMagicToken();
        if (!next) return;
        setCaptured(next);
        setConnectFailed(false);
        setView('invalid' in next ? (linked ? 'linked' : 'expired') : 'connect');
      }),
    [linked],
  );

  // 형식이 틀린 토큰 — 네트워크 0, 만료 화면.
  useEffect(() => {
    if (captured && 'invalid' in captured) clearMagicToken();
  }, [captured]);

  // 매직링크 확인 — 사용자가 [이 기기 연결하기]를 눌렀을 때만(1회용 토큰, sync.link 가 중복 전송을 막는다).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const capturedRef = useRef(captured);
  capturedRef.current = captured;
  const onConnect = () => {
    if (!captured || 'invalid' in captured || view !== 'connect') return;
    const sent = captured;
    setView('verifying');
    setConnectFailed(false);
    void saveLayerDeps
      .sync()
      .link(captured.token)
      .then((r) => {
        // 그 사이 같은 탭에 새 링크가 들어왔으면(연결 화면 재표시) 이전 결과로 새 토큰·화면을 덮지 않는다.
        if (capturedRef.current !== sent) return;
        // M4: 네트워크·서버 오류(error)는 토큰이 아직 쓰이지 않았을 수 있다 — 토큰을 유지하고 연결 화면에서 다시 누를 수 있게.
        if (r.kind === 'error') {
          if (!alive.current) return;
          setConnectFailed(true);
          setView((v) => (v === 'verifying' ? 'connect' : v));
          return;
        }
        clearMagicToken();
        if (!alive.current) return;
        if (r.kind === 'linked') {
          setWinner(r.winner);
          setLinkedEmpty(r.empty === true);
          setMaskedEmail(r.maskedEmail);
          setView(r.confirm ? 'confirmSave' : 'confirmed'); // R6 D2: 저장할 준비가 있으면 첫 PUT 전에 주소 확인
        } else setView(linked ? 'linked' : 'expired'); // 이미 연결된 기기에서 쓰인 링크 → 연결 상태(DR-2 m-12)
      });
  };

  // R6 D2: [이 주소로 저장하기] — 여기서 처음 연결 기록·자동 저장·PUT. 세션이 그새 끊겼으면(401) 만료 화면.
  const onConfirmSave = () => {
    if (view !== 'confirmSave') return;
    setView('saving');
    setSaveFailed(false);
    void saveLayerDeps
      .sync()
      .confirmSave()
      .then((r) => {
        if (!alive.current) return;
        // 연결 여부 ≠ 저장 결과 — PUT 성공(saved)일 때만 "저장했어요". 실패는 확인 화면에서 다시 시도.
        if (r === 'failed') setSaveFailed(true);
        setView((v) => (v === 'saving' ? (r === 'saved' ? 'confirmed' : r === 'failed' ? 'confirmSave' : 'expired') : v));
      });
  };

  // 토큰 없이 열림: 세션 확인 1회. 연결된 기기 → 마스킹 주소 + 자동 저장 재개(F3-3 부팅 전이어도),
  //   연결 기록 없는 기기인데 서버 세션이 살아 있음 → serverLinked(연결하기 | 연결 해제).
  useEffect(() => {
    if ((captured && view !== 'linked') || probed.current) return;
    probed.current = true;
    const wasLinked = linked;
    const sync = saveLayerDeps.sync();
    void sync.probe().then((p) => {
      if (!alive.current) return;
      if (p?.linked) setMaskedEmail(p.maskedEmail);
      if (wasLinked && (p === null || p.linked)) void sync.resume();
      if (!wasLinked && p?.linked) setView((v) => (v === 'input' ? 'serverLinked' : v));
    });
  }, [captured, linked, view]);

  useEffect(() => {
    if (!linked && view === 'linked') setView('input');
  }, [linked, view]);

  // 다른 탭에서 연결됨(false → true) — 보냄·입력 화면에 머무르지 않고 연결 상태로 전환(DR-2 m-11).
  //   전이만 본다: 연결 해제 직후(아직 linked 가 남은 순간)에 입력 화면을 되돌리지 않기 위해.
  const prevLinked = useRef(linked);
  useEffect(() => {
    const was = prevLinked.current;
    prevLinked.current = linked;
    if (!was && linked && (view === 'sent' || view === 'input' || view === 'sending')) {
      setView('linked');
      // 마스킹 주소 줄 — 세션 확인 probe 를 전환 시 1회만 다시(verify 아님). 실패(null)·미연결이면 줄 생략.
      void saveLayerDeps
        .sync()
        .probe()
        .then((p) => {
          if (alive.current && p?.linked) setMaskedEmail(p.maskedEmail);
        });
    }
  }, [linked, view]);

  useEffect(() => {
    if (view !== 'input' || promptSent.current) return;
    promptSent.current = true;
    track('save_prompt_view', { entry: entryRef.current });
  }, [view]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = useCallback(
    async (address: string) => {
      setView('sending');
      setError(null);
      const res = await saveLayerDeps.api().requestMagic(address, SERVER_ENTRY[entryRef.current]);
      if (res.status === 202 || res.status === 200) {
        setCooldown(RESEND_COOLDOWN_S);
        setView((v) => (v === 'sending' ? 'sent' : v)); // 그 사이 다른 탭이 연결해 linked 로 전환됐으면 덮어쓰지 않는다
        return;
      }
      setError(res.status === 503 ? 'unavailable' : res.status === 400 ? 'format' : 'network');
      setView((v) => (v === 'sending' ? 'input' : v));
    },
    [],
  );

  const onSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    if (view === 'sending') return;
    const address = email.trim();
    if (address.length === 0 || address.length > MAX_EMAIL || !EMAIL_RE.test(address)) {
      setError('format');
      return;
    }
    track('save_email_submit', {});
    void send(address);
  };

  const onUnlink = () => {
    void saveLayerDeps.sync().unlink();
    setEmail('');
    setMaskedEmail(undefined);
    setView('input');
  };

  const onAdopt = () => {
    void saveLayerDeps.sync().adopt();
    setView('linked');
  };

  // ── 89 스펙 지우기 ──────────────────────────────
  /** 이 기기 준비 상태를 지웠다(완료 화면) — ✕·ESC·버튼 어느 닫기든 처음 화면으로(⑥). */
  const deviceGone = view === 'deviceWiped' || (view === 'erased' && erasedWiped);
  const deviceGoneRef = useRef(false);
  deviceGoneRef.current = deviceGone;
  const wentHome = useRef(false);
  const goHome = useCallback(() => {
    if (wentHome.current) return;
    wentHome.current = true;
    saveLayerDeps.goHome();
  }, []);
  // 레이어가 닫혀 언마운트될 때(✕·ESC·스크림·뒤로) — 기기를 지운 뒤면 처음 화면으로.
  useEffect(
    () => () => {
      if (deviceGoneRef.current) goHome();
    },
    [goHome],
  );

  /** origin null = 기기 지우기 확인 안 링크에서 — 그만두면 처음 들어온 화면의 [저장한 정보 지우기]로. */
  const openErase = (origin: EntryView | null) => {
    if (origin) setEraseOrigin(origin);
    setEntryLink('erase-link');
    setWipeChecked(false);
    setEraseError(null);
    setView('eraseConfirm');
  };
  const openDevice = (origin: EntryView) => {
    setEraseOrigin(origin);
    setEntryLink('device-link');
    setView('deviceConfirm');
  };
  const cancelErase = () => {
    if (view === 'erasing' || view === 'deviceWiping') return;
    setEraseError(null);
    // 401 뒤엔 이 기기 연결 기록이 없다 — 연결 화면 대신 입력 화면(진입 링크가 없으면 제목).
    const back: EntryView = eraseOrigin === 'linked' && !linked ? 'input' : eraseOrigin;
    focusLink.current = entryLink;
    setView(back);
  };
  const onErase = () => {
    if (view !== 'eraseConfirm') return;
    const wipe = wipeChecked;
    setEraseError(null);
    setView('erasing');
    void saveLayerDeps
      .sync()
      .erase({ wipeDevice: wipe })
      .then((r) => {
        if (!alive.current) return;
        if (r.kind === 'erased') {
          setErasedWiped(r.wiped);
          setMaskedEmail(undefined);
          setView('erased');
        } else if (r.kind === 'reauth') {
          setMaskedEmail(undefined);
          setView('eraseReauth');
        } else {
          const kind = r.kind;
          setEraseError((e) => ({ kind, seq: (e?.seq ?? 0) + 1 }));
          setView('eraseConfirm');
        }
      });
  };
  const onWipeDevice = () => {
    if (view !== 'deviceConfirm') return;
    setView('deviceWiping');
    void saveLayerDeps
      .sync()
      .wipeDevice({ unlink: eraseOrigin === 'serverLinked' })
      .then((r) => {
        if (!alive.current) return;
        setLogoutPending(r.logoutPending);
        setMaskedEmail(undefined);
        setView('deviceWiped');
      });
  };

  // 뒤로(머리 행)는 확인·재연결 화면에서만 — 처리 중·완료·그 밖 화면은 없음.
  const backable = view === 'eraseConfirm' || view === 'deviceConfirm' || view === 'eraseReauth';
  const cancelRef = useRef(cancelErase);
  cancelRef.current = cancelErase;
  useLayoutEffect(() => {
    chrome.setBack(backable ? { label: COPY.save.backLabel, onBack: () => cancelRef.current() } : null);
  }, [chrome, backable]);

  /** 본문 끝 관리 링크(89 스펙 진입 링크). input 은 이 기기에 지울 것이 있을 때만 기기 지우기. */
  const manageLinks = (origin: EntryView) => {
    const connected = origin !== 'input';
    const device = connected || hasDeviceData();
    return (
      <div className="ws-save-resend" data-ws-save="manage">
        {connected ? (
          <button type="button" className="ws-save-link ws-t-meta" data-ws-save="erase-link" onClick={() => openErase(origin)}>
            {COPY.save.eraseLink}
          </button>
        ) : null}
        {device ? (
          <button type="button" className="ws-save-link ws-t-meta" data-ws-save="device-link" onClick={() => openDevice(origin)}>
            {COPY.save.deviceLink}
          </button>
        ) : null}
        <a className="ws-save-link ws-t-meta" href="/privacy">
          {COPY.footer.privacy}
        </a>
      </div>
    );
  };

  const linkedAs = maskedEmail ? (
    <p className="ws-t-meta ws-save-muted" data-ws-save="linked-as">
      {formatCopy(COPY.save.linkedAs, { name: maskedEmail })}
    </p>
  ) : null;

  if (view === 'eraseConfirm' || view === 'erasing') {
    const busy = view === 'erasing';
    return (
      <>
        <LayerBody>
          <div className="ws-save" data-ws-save="erase-confirm">
            <p className="ws-t-body">{maskedEmail ? formatCopy(COPY.save.eraseIntro, { name: maskedEmail }) : COPY.save.eraseIntroNoName}</p>
            <div className="ws-save-list">
              <h3 className="ws-t-label ws-save-muted">{COPY.save.eraseListTitle}</h3>
              <ul>
                <li className="ws-t-body">{COPY.save.eraseItemEmail}</li>
                <li className="ws-t-body">{COPY.save.eraseItemState}</li>
              </ul>
            </div>
            <p className="ws-t-meta ws-save-muted">{COPY.save.eraseOtherDevices}</p>
            <p className="ws-t-meta ws-save-muted" data-ws-save="erase-backup">
              {formatCopy(COPY.save.eraseBackup, { n: BACKUP_RETENTION_DAYS })}
            </p>
            <p className="ws-t-meta ws-save-muted">{COPY.save.eraseFinal}</p>
            <div className="ws-save-check-row">
              <label className="ws-save-check">
                <input
                  type="checkbox"
                  data-ws-save="wipe-device"
                  checked={wipeChecked}
                  aria-describedby={wipeHintId}
                  onChange={(e) => {
                    if (!busy) setWipeChecked(e.target.checked);
                  }}
                />
                <span className="ws-t-body">{COPY.save.eraseWipeDevice}</span>
              </label>
              <p id={wipeHintId} className="ws-t-meta ws-save-muted">
                {COPY.save.eraseWipeDeviceHint}
              </p>
            </div>
            {eraseError && !busy ? (
              <p
                key={eraseError.seq}
                className="ws-t-meta ws-save-muted"
                role="alert"
                data-ws-error={eraseError.kind === 'limited' ? 'erase-limited' : 'erase-failed'}
              >
                {eraseError.kind === 'limited' ? COPY.save.eraseLimited : COPY.save.eraseFailed}
              </p>
            ) : null}
          </div>
        </LayerBody>
        <LayerFoot>
          <div className="ws-save-foot">
            {/* 파괴 = outline(채운 CTA 0, D2). 처리 중 aria-disabled — 포커스 유지(onErase 는 erasing 중 무시). */}
            <button
              type="button"
              className="ws-btn ws-btn--outline"
              data-ws-save="erase-cta"
              aria-disabled={busy ? true : undefined}
              aria-busy={busy ? true : undefined}
              onClick={onErase}
            >
              {busy ? COPY.save.erasing : COPY.save.eraseCta}
            </button>
            <button type="button" className="ws-save-link ws-t-meta" aria-disabled={busy ? true : undefined} onClick={cancelErase}>
              {COPY.save.eraseCancel}
            </button>
          </div>
        </LayerFoot>
      </>
    );
  }

  if (view === 'erased') {
    return (
      <>
        <LayerBody>
          <div className="ws-save" data-ws-save="erased">
            <p className="ws-t-body">{COPY.save.erasedBody}</p>
            <p className="ws-t-body">{erasedWiped ? COPY.save.erasedDeviceWiped : COPY.save.erasedDeviceKept}</p>
          </div>
        </LayerBody>
        <LayerFoot>
          <div className="ws-save-foot">
            {erasedWiped ? (
              <button type="button" className="ws-btn ws-btn--outline" onClick={goHome}>
                {COPY.save.toStart}
              </button>
            ) : (
              <button type="button" className="ws-btn ws-btn--outline" onClick={close}>
                {COPY.save.close}
              </button>
            )}
          </div>
        </LayerFoot>
      </>
    );
  }

  if (view === 'eraseReauth') {
    return (
      <>
        <LayerBody>
          <div className="ws-save" data-ws-save="erase-reauth">
            <p className="ws-t-body">{COPY.save.reauthBody}</p>
            <p className="ws-t-meta ws-save-muted">{COPY.save.reauthKept}</p>
          </div>
        </LayerBody>
        <LayerFoot>
          <div className="ws-save-foot">
            <button
              type="button"
              className="ws-btn ws-btn--fill"
              onClick={() => {
                setEmail('');
                setError(null);
                setView('input');
              }}
            >
              {COPY.save.resendVerify}
            </button>
            <button type="button" className="ws-save-link ws-t-meta" onClick={cancelErase}>
              {COPY.save.eraseCancel}
            </button>
          </div>
        </LayerFoot>
      </>
    );
  }

  if (view === 'deviceConfirm' || view === 'deviceWiping') {
    const busy = view === 'deviceWiping';
    const connected = eraseOrigin !== 'input';
    return (
      <>
        <LayerBody>
          <div className="ws-save" data-ws-save="device-confirm">
            <p className="ws-t-body">{COPY.save.deviceBody}</p>
            {connected ? (
              <div className="ws-save-resend">
                <p className="ws-t-meta ws-save-muted">{COPY.save.deviceLinkedNote}</p>
                <button
                  type="button"
                  className="ws-save-link ws-t-meta"
                  data-ws-save="erase-link"
                  aria-disabled={busy ? true : undefined}
                  onClick={() => {
                    if (!busy) openErase(null);
                  }}
                >
                  {COPY.save.eraseLink}
                </button>
              </div>
            ) : null}
            <p className="ws-t-meta ws-save-muted">{COPY.save.eraseFinal}</p>
          </div>
        </LayerBody>
        <LayerFoot>
          <div className="ws-save-foot">
            <button
              type="button"
              className="ws-btn ws-btn--outline"
              data-ws-save="device-cta"
              aria-disabled={busy ? true : undefined}
              aria-busy={busy ? true : undefined}
              onClick={onWipeDevice}
            >
              {busy ? COPY.save.erasing : COPY.save.deviceCta}
            </button>
            <button type="button" className="ws-save-link ws-t-meta" aria-disabled={busy ? true : undefined} onClick={cancelErase}>
              {COPY.save.eraseCancel}
            </button>
          </div>
        </LayerFoot>
      </>
    );
  }

  if (view === 'deviceWiped') {
    return (
      <>
        <LayerBody>
          <div className="ws-save" data-ws-save="device-wiped">
            <p className="ws-t-body">{COPY.save.deviceDoneBody}</p>
            {logoutPending ? (
              <p className="ws-t-meta ws-save-muted" data-ws-save="logout-pending">
                {COPY.save.deviceLogoutPending}
              </p>
            ) : null}
          </div>
        </LayerBody>
        <LayerFoot>
          <div className="ws-save-foot">
            <button type="button" className="ws-btn ws-btn--outline" onClick={goHome}>
              {COPY.save.toStart}
            </button>
          </div>
        </LayerFoot>
      </>
    );
  }

  if (view === 'connect' || view === 'verifying') {
    const busy = view === 'verifying';
    return (
      <>
        <LayerBody>
          <div className="ws-save" data-ws-save={busy ? 'verifying' : 'connect'}>
            <p className="ws-t-body">{COPY.save.connectBody}</p>
            {connectFailed && !busy ? (
              <p className="ws-t-meta ws-save-muted" role="alert" data-ws-error="connect">
                {COPY.save.connectError}
              </p>
            ) : null}
            {type ? <SaveSummary type={type} reqs={reqs} catalogUrl={page.catalogUrl} /> : null}
          </div>
        </LayerBody>
        <LayerFoot>
          <div className="ws-save-foot">
            {/* D6: disabled 대신 aria-disabled — 포커스 유지(onConnect 는 verifying 중 무시). */}
            <button type="button" className="ws-btn ws-btn--fill" aria-disabled={busy ? true : undefined} aria-busy={busy ? true : undefined} onClick={onConnect}>
              {busy ? COPY.save.verifying : COPY.save.connectCta}
            </button>
            <button type="button" className="ws-btn ws-btn--outline" onClick={close}>
              {COPY.save.later}
            </button>
          </div>
        </LayerFoot>
      </>
    );
  }

  if (view === 'confirmSave' || view === 'saving') {
    const busy = view === 'saving';
    return (
      <>
        <LayerBody>
          <div className="ws-save" data-ws-save="confirm-save">
            {maskedEmail ? (
              <p className="ws-t-body" data-ws-save="confirm-masked">
                {formatCopy(COPY.save.confirmMasked, { name: maskedEmail })}
              </p>
            ) : null}
            {saveFailed && !busy ? (
              <p className="ws-t-meta ws-save-muted" role="alert" data-ws-error="save-failed">
                {COPY.save.errorNetwork}
              </p>
            ) : null}
            {type ? <SaveSummary type={type} reqs={reqs} catalogUrl={page.catalogUrl} /> : null}
          </div>
        </LayerBody>
        <LayerFoot>
          <div className="ws-save-foot">
            {/* D6: disabled 대신 aria-disabled — 포커스 유지(onConfirmSave 는 saving 중 무시). */}
            <button type="button" className="ws-btn ws-btn--fill" aria-disabled={busy ? true : undefined} aria-busy={busy ? true : undefined} onClick={onConfirmSave}>
              {COPY.save.confirmCta}
            </button>
            <button type="button" className="ws-btn ws-btn--outline" onClick={close}>
              {COPY.save.later}
            </button>
          </div>
        </LayerFoot>
      </>
    );
  }

  if (view === 'serverLinked') {
    return (
      <>
        <LayerBody>
          <div className="ws-save" data-ws-save="server-linked">
            {linkedAs}
            {type ? <SaveSummary type={type} reqs={reqs} catalogUrl={page.catalogUrl} /> : null}
            {manageLinks('serverLinked')}
          </div>
        </LayerBody>
        <LayerFoot>
          <div className="ws-save-foot">
            <button type="button" className="ws-btn ws-btn--fill" onClick={onAdopt}>
              {COPY.save.connectCta}
            </button>
            <button type="button" className="ws-btn ws-btn--outline" onClick={onUnlink}>
              {COPY.save.disconnect}
            </button>
          </div>
        </LayerFoot>
      </>
    );
  }

  if (view === 'linked') {
    return (
      <>
        <LayerBody>
          <div className="ws-save" data-ws-save="linked">
            {linkedAs}
            <p className="ws-t-meta ws-save-muted">{COPY.save.signedInNote}</p>
            {manageLinks('linked')}
          </div>
        </LayerBody>
        <LayerFoot>
          <div className="ws-save-foot">
            <button type="button" className="ws-btn ws-btn--outline" onClick={onUnlink}>
              {COPY.save.disconnect}
            </button>
          </div>
        </LayerFoot>
      </>
    );
  }

  if (view === 'confirmed') {
    const note = linkedEmpty
      ? null
      : winner === 'server'
        ? COPY.save.mergedServer
        : winner === 'local' || winner === 'mixed'
          ? COPY.save.mergedLocal
          : null;
    return (
      <>
        <LayerBody>
          <div className="ws-save" data-ws-save={linkedEmpty ? 'connected-empty' : 'confirmed'}>
            <p className="ws-t-body">{linkedEmpty ? COPY.save.connectedEmpty : COPY.save.confirmedBody}</p>
            {linkedAs}
            {note ? <p className="ws-t-meta ws-save-muted">{note}</p> : null}
          </div>
        </LayerBody>
        <LayerFoot>
          <div className="ws-save-foot">
            <button type="button" className="ws-btn ws-btn--outline" onClick={close}>
              {COPY.save.close}
            </button>
          </div>
        </LayerFoot>
      </>
    );
  }

  if (view === 'expired') {
    return (
      <>
        <LayerBody>
          <div className="ws-save" data-ws-save="expired">
            <p className="ws-t-body">{COPY.save.expiredBody}</p>
          </div>
        </LayerBody>
        <LayerFoot>
          <div className="ws-save-foot">
            <button type="button" className="ws-btn ws-btn--fill" onClick={() => setView('input')}>
              {COPY.save.resendVerify}
            </button>
          </div>
        </LayerFoot>
      </>
    );
  }

  if (view === 'sent') {
    return (
      <>
        <LayerBody>
          <div className="ws-save" data-ws-save="sent">
            <p className="ws-t-body">{COPY.save.sentBody}</p>
            <p className="ws-t-body" data-ws-save="same-device">
              {COPY.save.sentSameDevice}
            </p>
            <div className="ws-save-resend">
              <p className="ws-t-meta ws-save-muted">{COPY.save.notReceived}</p>
              <button type="button" className="ws-save-link ws-t-meta" disabled={cooldown > 0} onClick={() => void send(email.trim())}>
                {COPY.save.resend}
              </button>
              {/* D7: 카운트다운은 live 밖(매초 낭독 금지) — 시각 안내만. 버튼 활성화로 다시 보낼 수 있음이 드러난다. */}
              {cooldown > 0 ? (
                <p className="ws-t-meta ws-save-muted" data-ws-save="countdown">
                  {formatCopy(COPY.save.resendWait, { n: cooldown })}
                </p>
              ) : null}
              <button type="button" className="ws-save-link ws-t-meta" onClick={() => setView('input')}>
                {COPY.save.otherAddress}
              </button>
            </div>
          </div>
        </LayerBody>
        <LayerFoot>
          <div className="ws-save-foot">
            <button type="button" className="ws-btn ws-btn--outline" onClick={close}>
              {COPY.save.close}
            </button>
          </div>
        </LayerFoot>
      </>
    );
  }

  // input(A) · sending(B)
  const sending = view === 'sending';
  const errorText =
    error === 'format' ? COPY.save.errorFormat : error === 'unavailable' ? COPY.save.unavailable : error ? COPY.save.errorNetwork : null;
  return (
    <>
      <LayerBody>
        <div className="ws-save" data-ws-save="input">
          <p className="ws-t-body">{COPY.save.description}</p>
          <form className="ws-save-form" noValidate onSubmit={onSubmit}>
            <label htmlFor={inputId} className="ws-t-label ws-save-muted">
              {COPY.save.emailLabel}
            </label>
            <input
              id={inputId}
              className={`ws-save-input${error === 'format' ? ' ws-save-input--invalid' : ''}`}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              aria-invalid={error === 'format' ? true : undefined}
              aria-describedby={errorText ? errorId : undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error === 'format') setError(null);
              }}
            />
            {errorText ? (
              <p id={errorId} className={`ws-t-meta ${error === 'format' ? 'ws-save-error' : 'ws-save-muted'}`} role="alert" data-ws-error={error ?? undefined}>
                {errorText}
              </p>
            ) : null}
          </form>
          {type ? <SaveSummary type={type} reqs={reqs} catalogUrl={page.catalogUrl} /> : null}
          {sending ? null : manageLinks('input')}
        </div>
      </LayerBody>
      <LayerFoot>
        <div className="ws-save-foot">
          {/* D6: disabled 대신 aria-disabled — 포커스 유지(onSubmit 은 sending 중 무시). */}
          <button type="button" className="ws-btn ws-btn--fill" aria-disabled={sending ? true : undefined} aria-busy={sending ? true : undefined} onClick={() => onSubmit()}>
            {sending ? COPY.save.sending : COPY.save.submit}
          </button>
          <button type="button" className="ws-btn ws-btn--outline" onClick={close}>
            {COPY.save.later}
          </button>
          <p className="ws-t-meta ws-save-muted">{COPY.save.noAds}</p>
        </div>
      </LayerFoot>
    </>
  );
}
