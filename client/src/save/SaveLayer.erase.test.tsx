// L8 저장 정보 지우기 · 이 기기 정보 지우기(89 스펙 §1 · be-privacy 87 DELETE /api/save 계약).
//   204 → erased(ws.save 미연결, DELETE /auth/session 0) · 선택 시 ws.* 0 · 401 → eraseReauth · 429·5xx·0 → 인라인 오류(선택 유지)
//   · 포커스(스텝 제목·오류 시 버튼·그만두기 → 진입 링크) · 기기 지우기(연결 시 로그아웃 먼저, 실패 시 pendingLogout 만) · 닫기 → 처음 화면.
//   네트워크는 fetch 스텁(동일 출처 경로만). 클라 이벤트 0(⑦).
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BACKUP_RETENTION_DAYS, COPY, formatCopy } from '@ws/copy';
import type { WsPageData } from '@ws/engine';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30000 });
configure({ asyncUtilTimeout: 10000 });
beforeAll(async () => {
  await import('./SaveLayer');
}, 30000);
import { LayerPageProvider } from '../app/layerPage';
import { layerRegistry } from '../app/layerRegistry';
import { setTrackerForTest, type Tracker } from '../events/track';
import { golden, pageOf, req } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';
import { clearMagicToken } from './magicLink';
import { saveLayerDeps } from './SaveLayer';
import { SAVE_STATE_KEY } from './saveStateStore';
import { resetSaveSyncForTest } from './sync';

const MASKED = 'k***@e***.com';
const T1 = '2026-10-01T00:00:00.000Z';
const BANNED = ['괜찮', '안전', '최저가', '판매순', '베스트', '정확도', '회원', '가입', '구매', '탈퇴', '계정'];

type Route = { status: number; body?: unknown };
let routes: Record<string, Route>;
let fetchLog: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }>;
let events: Array<[string, Record<string, unknown>]>;
let gates: Record<string, Promise<void>>;
async function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = String(input);
  const method = init?.method ?? 'GET';
  fetchLog.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null, headers: { ...(init?.headers as Record<string, string> | undefined) } });
  const gate = gates[`${method} ${path}`];
  if (gate) await gate;
  const r = routes[`${method} ${path}`] ?? { status: 404 };
  if (r.status === 0) throw new TypeError('network');
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? null } as unknown as Response;
}
const fetchMock = vi.fn(route);
const goHome = vi.fn();
const realGoHome = saveLayerDeps.goHome;

function page(): WsPageData {
  return pageOf('TYPE', { requirements: [req('cage', 'REQUIRED', '케이지')] }, { typeId: golden.id, path: '/hamster/golden' });
}

function mount(p: WsPageData = page()) {
  render(
    <LayerPageProvider page={p}>
      <LayerHost registry={layerRegistry} />
    </LayerPageProvider>,
  );
}

const calls = (): string[] => fetchLog.map((f) => `${f.method} ${f.path}`);
const wsKeys = (): string[] => {
  const out: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i) as string;
    if (k.startsWith('ws.')) out.push(k);
  }
  return out.sort();
};
const q = (d: HTMLElement, key: string): HTMLElement => {
  const el = d.querySelector<HTMLElement>(`[data-ws-save="${key}"]`);
  if (!el) throw new Error(`no [data-ws-save=${key}]`);
  return el;
};

function seedDevice(): void {
  window.localStorage.setItem('ws.animalType', golden.id);
  window.localStorage.setItem(`ws.context.${golden.id}.cage`, JSON.stringify({ v: 1, type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: T1 }));
  window.localStorage.setItem('ws.reactions', JSON.stringify({ v: 1, like: {}, helpful: {}, recheck: {}, updatedAt: T1 }));
}

function seedLinked(): void {
  window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
  routes['GET /auth/session'] = { status: 200, body: { linked: true, maskedEmail: MASKED } };
}

/** 연결 상태로 L8 열기 → 진입 링크 확인 → 대화 상자. */
async function openLinked(): Promise<HTMLElement> {
  seedLinked();
  mount();
  act(() => layerStore.open('L8', {}, { url: '/save' }));
  const d = await screen.findByRole('dialog', { name: COPY.save.signedInTitle }, { timeout: 15000 });
  await screen.findByText(formatCopy(COPY.save.linkedAs, { name: MASKED }));
  await waitFor(() => expect(calls()).toContain('GET /api/save'));
  return d;
}

async function toEraseConfirm(): Promise<HTMLElement> {
  const d = await openLinked();
  fireEvent.click(q(d, 'erase-link'));
  const c = await screen.findByRole('dialog', { name: COPY.save.eraseTitle });
  await waitFor(() => expect(document.activeElement).toBe(c.querySelector('h2')));
  return c;
}

function expectNoBanned(el: HTMLElement): void {
  for (const w of BANNED) expect(el.textContent ?? '').not.toContain(w);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/hamster/golden');
  routes = {
    'GET /api/save': { status: 200, body: { snapshot: null, updatedAt: null } },
    'PUT /api/save': { status: 200, body: { updatedAt: T1 } },
    'DELETE /api/save': { status: 204 },
    'DELETE /auth/session': { status: 204 },
    'GET /auth/session': { status: 200, body: { linked: false } },
  };
  gates = {};
  fetchLog = [];
  events = [];
  fetchMock.mockClear();
  fetchMock.mockImplementation(route);
  vi.stubGlobal('fetch', fetchMock);
  goHome.mockClear();
  saveLayerDeps.goHome = goHome;
  const fake: Tracker = { track: (n, p) => void events.push([n, p]), flush: () => undefined, dispose: () => undefined };
  setTrackerForTest(fake);
});

afterEach(() => {
  act(() => layerStore.resetForTest());
  resetSaveSyncForTest();
  clearMagicToken();
  setTrackerForTest(null);
  saveLayerDeps.goHome = realGoHome;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('진입 링크(본문 끝 data-ws-save=manage)', () => {
  it('연결 상태: 저장한 정보 지우기 · 이 기기 정보 지우기 · 개인정보 처리방침(/privacy)', async () => {
    const d = await openLinked();
    const manage = q(d, 'manage');
    expect(manage).toHaveClass('ws-save-resend');
    expect(q(manage, 'erase-link')).toHaveTextContent(COPY.save.eraseLink);
    expect(q(manage, 'erase-link').tagName).toBe('BUTTON');
    expect(q(manage, 'device-link')).toHaveTextContent(COPY.save.deviceLink);
    const privacy = manage.querySelector('a[href="/privacy"]') as HTMLAnchorElement;
    expect(privacy).toHaveTextContent(COPY.footer.privacy);
    expect(privacy).toHaveClass('ws-save-link');
  });

  it('입력 화면: 지울 ws.* 가 없으면 기기 지우기 링크 0 · 처리방침 링크만, 있으면 기기 지우기 링크', async () => {
    mount();
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    let d = await screen.findByRole('dialog', { name: COPY.save.title }, { timeout: 15000 });
    expect(d.querySelector('[data-ws-save="erase-link"]')).toBeNull();
    expect(d.querySelector('[data-ws-save="device-link"]')).toBeNull();
    expect(q(d, 'manage').querySelector('a[href="/privacy"]')).not.toBeNull();
    act(() => layerStore.resetForTest());

    seedDevice();
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    d = await screen.findByRole('dialog', { name: COPY.save.title }, { timeout: 15000 });
    expect(q(d, 'device-link')).toBeInTheDocument();
    expect(d.querySelector('[data-ws-save="erase-link"]')).toBeNull();
  });
});

describe('저장한 정보 지우기 — eraseConfirm', () => {
  it('확인 화면: 마스킹 주소 안내·지우는 정보·백업 {n}=policy·선택 칸 기본 꺼짐·outline 1(채움 0)·뒤로 라벨·금지어 0', async () => {
    const c = await toEraseConfirm();
    expect(c).toHaveTextContent(formatCopy(COPY.save.eraseIntro, { name: MASKED }));
    expect(c).toHaveTextContent(COPY.save.eraseListTitle);
    expect(c).toHaveTextContent(COPY.save.eraseItemEmail);
    expect(c).toHaveTextContent(COPY.save.eraseItemState);
    expect(c).toHaveTextContent(COPY.save.eraseOtherDevices);
    expect(q(c, 'erase-backup')).toHaveTextContent(formatCopy(COPY.save.eraseBackup, { n: BACKUP_RETENTION_DAYS }));
    expect(c).toHaveTextContent(COPY.save.eraseFinal);
    const box = q(c, 'wipe-device') as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(false);
    expect(box.closest('label')).toHaveClass('ws-save-check');
    expect(document.getElementById(box.getAttribute('aria-describedby') as string)).toHaveTextContent(COPY.save.eraseWipeDeviceHint);
    expect(screen.getByRole('checkbox', { name: COPY.save.eraseWipeDevice })).toBe(box);
    expect(c.querySelectorAll('.ws-btn--fill')).toHaveLength(0);
    expect(q(c, 'erase-cta')).toHaveClass('ws-btn--outline');
    expect(q(c, 'erase-cta')).toHaveTextContent(COPY.save.eraseCta);
    expect(screen.getByRole('button', { name: COPY.save.eraseCancel })).toHaveClass('ws-save-link');
    expect(screen.getByRole('button', { name: COPY.save.backLabel })).toBeInTheDocument();
    expect(c.querySelector('.ws-avatar')).toBeNull();
    expect(c.querySelector('[data-ws-save="summary"]')).toBeNull();
    expect(c.textContent).not.toContain('{');
    expectNoBanned(c);
  });

  it('204 → erased: DELETE /api/save {confirm:"ERASE"} json · ws.save 삭제 · DELETE /auth/session 0 · 이 기기 준비 상태 유지 · 제목 포커스 · 이벤트 0', async () => {
    seedDevice();
    const c = await toEraseConfirm();
    const before = events.length;
    const putsBefore = calls().filter((x) => x === 'PUT /api/save').length;
    fireEvent.click(q(c, 'erase-cta'));
    const d = await screen.findByRole('dialog', { name: COPY.save.erasedTitle });
    await waitFor(() => expect(document.activeElement).toBe(d.querySelector('h2')));
    const del = fetchLog.filter((f) => f.method === 'DELETE' && f.path === '/api/save');
    expect(del).toHaveLength(1);
    expect(del[0].body).toEqual({ confirm: 'ERASE' });
    expect(del[0].headers['Content-Type']).toBe('application/json');
    expect(calls()).not.toContain('DELETE /auth/session');
    expect(window.localStorage.getItem(SAVE_STATE_KEY)).toBeNull();
    expect(window.localStorage.getItem('ws.animalType')).toBe(golden.id);
    expect(d).toHaveTextContent(COPY.save.erasedBody);
    expect(d).toHaveTextContent(COPY.save.erasedDeviceKept);
    const closeBtn = d.querySelector('.ws-save-foot button') as HTMLElement;
    expect(closeBtn).toHaveTextContent(COPY.save.close);
    expect(closeBtn).toHaveClass('ws-btn--outline');
    expect(screen.queryByRole('button', { name: COPY.save.backLabel })).toBeNull();
    expect(events.slice(before)).toEqual([]);
    // 지운 뒤 자동 저장 0 — 로컬 변경이 PUT 을 만들지 않는다.
    window.localStorage.setItem('ws.animalType', 'hamster-dwarf');
    expect(saveLayerDeps.sync().isRunning()).toBe(false);
    expect(calls().filter((x) => x === 'PUT /api/save')).toHaveLength(putsBefore);
    fireEvent.click(closeBtn);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(goHome).not.toHaveBeenCalled();
  });

  it('204 + 이 기기도 지우기 → ws.* 0 · erasedDeviceWiped · [처음 화면으로] → location.replace("/")', async () => {
    seedDevice();
    const c = await toEraseConfirm();
    fireEvent.click(q(c, 'wipe-device'));
    expect((q(c, 'wipe-device') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(q(c, 'erase-cta'));
    const d = await screen.findByRole('dialog', { name: COPY.save.erasedTitle });
    expect(d).toHaveTextContent(COPY.save.erasedDeviceWiped);
    expect(wsKeys()).toEqual([]);
    expect(calls()).not.toContain('DELETE /auth/session');
    fireEvent.click(screen.getByRole('button', { name: COPY.save.toStart }));
    expect(goHome).toHaveBeenCalledTimes(1);
  });

  it('204 + 이 기기도 지우기 → ✕(ESC) 로 닫아도 처음 화면으로', async () => {
    const c = await toEraseConfirm();
    fireEvent.click(q(c, 'wipe-device'));
    fireEvent.click(q(c, 'erase-cta'));
    await screen.findByRole('dialog', { name: COPY.save.erasedTitle });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(goHome).toHaveBeenCalledTimes(1));
  });

  it('401 → eraseReauth: 이 기기 연결 기록만 해제(로그아웃 0), 준비 상태 유지 · 채움 1 [인증 메일 다시 보내기] → 빈 입력 화면', async () => {
    routes['DELETE /api/save'] = { status: 401, body: { error: 'no_session' } };
    seedDevice();
    const c = await toEraseConfirm();
    fireEvent.click(q(c, 'erase-cta'));
    const d = await screen.findByRole('dialog', { name: COPY.save.reauthTitle });
    await waitFor(() => expect(document.activeElement).toBe(d.querySelector('h2')));
    expect(d).toHaveTextContent(COPY.save.reauthBody);
    expect(d).toHaveTextContent(COPY.save.reauthKept);
    expect(window.localStorage.getItem(SAVE_STATE_KEY)).toBeNull();
    expect(window.localStorage.getItem('ws.animalType')).toBe(golden.id);
    expect(calls()).not.toContain('DELETE /auth/session');
    expect(d.querySelectorAll('.ws-btn--fill')).toHaveLength(1);
    expect(screen.getByRole('button', { name: COPY.save.backLabel })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: COPY.save.resendVerify }));
    await screen.findByRole('dialog', { name: COPY.save.title });
    expect(screen.getByLabelText(COPY.save.emailLabel)).toHaveValue('');
  });

  it.each([
    [429, 'erase-limited', COPY.save.eraseLimited],
    [500, 'erase-failed', COPY.save.eraseFailed],
    [503, 'erase-failed', COPY.save.eraseFailed],
    [0, 'erase-failed', COPY.save.eraseFailed],
    [400, 'erase-failed', COPY.save.eraseFailed],
  ] as const)('%s → 인라인 오류(%s, role=alert) · 선택 칸 유지 · 포커스 = 버튼 · 로컬 0 변경', async (status, kind, text) => {
    routes['DELETE /api/save'] = { status };
    seedDevice();
    const c = await toEraseConfirm();
    const keysBefore = wsKeys();
    const saveBefore = window.localStorage.getItem(SAVE_STATE_KEY);
    fireEvent.click(q(c, 'wipe-device'));
    const cta = q(c, 'erase-cta');
    cta.focus();
    fireEvent.click(cta);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-ws-error', kind);
    expect(alert).toHaveTextContent(text);
    expect(alert).toHaveClass('ws-save-muted');
    expect(alert).not.toHaveClass('ws-save-error');
    await act(async () => undefined);
    const again = q(screen.getByRole('dialog', { name: COPY.save.eraseTitle }), 'erase-cta');
    expect(again).not.toHaveAttribute('aria-disabled');
    expect(document.activeElement).toBe(again);
    expect((q(screen.getByRole('dialog'), 'wipe-device') as HTMLInputElement).checked).toBe(true);
    expect(wsKeys()).toEqual(keysBefore);
    expect(window.localStorage.getItem(SAVE_STATE_KEY)).toBe(saveBefore);
  });

  it('같은 오류가 다시 나면 오류 줄을 다시 마운트(낭독 재발)', async () => {
    routes['DELETE /api/save'] = { status: 429 };
    const c = await toEraseConfirm();
    fireEvent.click(q(c, 'erase-cta'));
    const first = await screen.findByRole('alert');
    fireEvent.click(q(screen.getByRole('dialog'), 'erase-cta'));
    await waitFor(() => expect(fetchLog.filter((f) => f.method === 'DELETE' && f.path === '/api/save')).toHaveLength(2));
    const second = await screen.findByRole('alert');
    await waitFor(() => expect(first.isConnected).toBe(false));
    expect(second).not.toBe(first);
  });

  it('실패 뒤 자동 저장 재개(연결 유지) — 정지 → 재개', async () => {
    routes['DELETE /api/save'] = { status: 500 };
    const c = await toEraseConfirm();
    fireEvent.click(q(c, 'erase-cta'));
    await screen.findByRole('alert');
    expect(JSON.parse(window.localStorage.getItem(SAVE_STATE_KEY) as string)).toMatchObject({ linked: true });
    expect(saveLayerDeps.sync().isRunning()).toBe(true);
  });

  it('처리 중: 버튼 aria-disabled·aria-busy·"지우고 있어요", 포커스 유지, 다시 눌러도 1회, 선택 칸 변경 무시, 그 사이 자동 저장 정지', async () => {
    let release: () => void = () => undefined;
    gates['DELETE /api/save'] = new Promise<void>((r) => (release = r));
    const c = await toEraseConfirm();
    expect(saveLayerDeps.sync().isRunning()).toBe(true);
    const cta = q(c, 'erase-cta');
    cta.focus();
    fireEvent.click(cta);
    const busy = await screen.findByRole('button', { name: COPY.save.erasing });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(document.activeElement).toBe(busy);
    expect(saveLayerDeps.sync().isRunning()).toBe(false);
    fireEvent.click(busy);
    fireEvent.click(q(screen.getByRole('dialog'), 'wipe-device'));
    expect((q(screen.getByRole('dialog'), 'wipe-device') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: COPY.save.eraseCancel }));
    expect(screen.getByRole('dialog', { name: COPY.save.eraseTitle })).toBeInTheDocument();
    await act(async () => {
      release();
    });
    await screen.findByRole('dialog', { name: COPY.save.erasedTitle });
    expect(fetchLog.filter((f) => f.method === 'DELETE' && f.path === '/api/save')).toHaveLength(1);
  });

  it('[그만둘게요] → 연결 화면 + 포커스 = [저장한 정보 지우기] 링크, 네트워크 DELETE 0', async () => {
    const c = await toEraseConfirm();
    fireEvent.click(within(c).getByRole('button', { name: COPY.save.eraseCancel }));
    const d = await screen.findByRole('dialog', { name: COPY.save.signedInTitle });
    await waitFor(() => expect(document.activeElement).toBe(q(d, 'erase-link')));
    expect(calls()).not.toContain('DELETE /api/save');
    expect(screen.queryByRole('button', { name: COPY.save.backLabel })).toBeNull();
  });

  it('머리 행 [이전 화면으로] → 연결 화면 + 포커스 = 진입 링크', async () => {
    await toEraseConfirm();
    fireEvent.click(screen.getByRole('button', { name: COPY.save.backLabel }));
    const d = await screen.findByRole('dialog', { name: COPY.save.signedInTitle });
    await waitFor(() => expect(document.activeElement).toBe(q(d, 'erase-link')));
  });

  it('닫아도 끝까지 적용(로직은 sync) — 처리 중 닫기 → 응답 뒤 ws.save 삭제', async () => {
    let release: () => void = () => undefined;
    gates['DELETE /api/save'] = new Promise<void>((r) => (release = r));
    const c = await toEraseConfirm();
    fireEvent.click(q(c, 'wipe-device'));
    fireEvent.click(q(c, 'erase-cta'));
    await screen.findByRole('button', { name: COPY.save.erasing });
    act(() => layerStore.resetForTest());
    await act(async () => {
      release();
    });
    await waitFor(() => expect(wsKeys()).toEqual([]));
  });
});

describe('이 기기 정보 지우기', () => {
  it('미연결(입력 화면) → 확인 → 지우기: 네트워크 0 · ws.* 0 · 완료 제목 포커스 · [처음 화면으로] → 처음 화면', async () => {
    seedDevice();
    mount();
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    const d = await screen.findByRole('dialog', { name: COPY.save.title }, { timeout: 15000 });
    await waitFor(() => expect(calls()).toContain('GET /auth/session'));
    fireEvent.click(q(d, 'device-link'));
    const c = await screen.findByRole('dialog', { name: COPY.save.deviceTitle });
    await waitFor(() => expect(document.activeElement).toBe(c.querySelector('h2')));
    expect(c).toHaveTextContent(COPY.save.deviceBody);
    expect(c).not.toHaveTextContent(COPY.save.deviceLinkedNote);
    expect(c.querySelector('[data-ws-save="erase-link"]')).toBeNull();
    expect(c).toHaveTextContent(COPY.save.eraseFinal);
    expect(c.querySelectorAll('.ws-btn--fill')).toHaveLength(0);
    expect(q(c, 'device-cta')).toHaveClass('ws-btn--outline');
    expectNoBanned(c);
    const before = fetchLog.length;
    const evBefore = events.length;
    fireEvent.click(q(c, 'device-cta'));
    const w = await screen.findByRole('dialog', { name: COPY.save.deviceDoneTitle });
    await waitFor(() => expect(document.activeElement).toBe(w.querySelector('h2')));
    expect(w).toHaveTextContent(COPY.save.deviceDoneBody);
    expect(w.querySelector('[data-ws-save="logout-pending"]')).toBeNull();
    expect(fetchLog.slice(before)).toEqual([]);
    expect(events.slice(evBefore)).toEqual([]);
    expect(wsKeys()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: COPY.save.toStart }));
    expect(goHome).toHaveBeenCalledTimes(1);
  });

  it('연결 중 → 연결 안내 + 저장 정보 지우기 링크 → 지우기: DELETE /auth/session 먼저 · ws.* 0 · ESC 로 닫아도 처음 화면', async () => {
    seedDevice();
    const d = await openLinked();
    fireEvent.click(q(d, 'device-link'));
    const c = await screen.findByRole('dialog', { name: COPY.save.deviceTitle });
    expect(c).toHaveTextContent(COPY.save.deviceLinkedNote);
    expect(q(c, 'erase-link')).toHaveTextContent(COPY.save.eraseLink);
    fireEvent.click(q(c, 'device-cta'));
    await screen.findByRole('dialog', { name: COPY.save.deviceDoneTitle });
    expect(calls()).toContain('DELETE /auth/session');
    expect(calls()).not.toContain('DELETE /api/save');
    expect(wsKeys()).toEqual([]);
    expect(saveLayerDeps.sync().isRunning()).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(goHome).toHaveBeenCalledTimes(1));
  });

  it('연결 중 로그아웃 실패(500) → ws.save {linked:false, pendingLogout:true} 만 남고 안내 줄', async () => {
    routes['DELETE /auth/session'] = { status: 500 };
    seedDevice();
    const d = await openLinked();
    fireEvent.click(q(d, 'device-link'));
    const c = await screen.findByRole('dialog', { name: COPY.save.deviceTitle });
    fireEvent.click(q(c, 'device-cta'));
    const w = await screen.findByRole('dialog', { name: COPY.save.deviceDoneTitle });
    expect(q(w, 'logout-pending')).toHaveTextContent(COPY.save.deviceLogoutPending);
    expect(wsKeys()).toEqual([SAVE_STATE_KEY]);
    expect(JSON.parse(window.localStorage.getItem(SAVE_STATE_KEY) as string)).toEqual({ v: 1, linked: false, lastSyncAt: null, pendingLogout: true });
  });

  it('기기 확인 안 [저장한 정보 지우기] → eraseConfirm → [그만둘게요] → 연결 화면 + 포커스 = 저장 정보 지우기 링크', async () => {
    const d = await openLinked();
    fireEvent.click(q(d, 'device-link'));
    const c = await screen.findByRole('dialog', { name: COPY.save.deviceTitle });
    fireEvent.click(q(c, 'erase-link'));
    const e = await screen.findByRole('dialog', { name: COPY.save.eraseTitle });
    fireEvent.click(within(e).getByRole('button', { name: COPY.save.eraseCancel }));
    const l = await screen.findByRole('dialog', { name: COPY.save.signedInTitle });
    await waitFor(() => expect(document.activeElement).toBe(q(l, 'erase-link')));
  });

  it('기기 확인 [그만둘게요] → 들어온 화면 + 포커스 = [이 기기 정보 지우기] 링크', async () => {
    const d = await openLinked();
    fireEvent.click(q(d, 'device-link'));
    const c = await screen.findByRole('dialog', { name: COPY.save.deviceTitle });
    fireEvent.click(within(c).getByRole('button', { name: COPY.save.eraseCancel }));
    const l = await screen.findByRole('dialog', { name: COPY.save.signedInTitle });
    await waitFor(() => expect(document.activeElement).toBe(q(l, 'device-link')));
    expect(wsKeys()).toContain(SAVE_STATE_KEY);
  });

  it('서버 세션만 살아 있는 기기(serverLinked) → 기기 지우기도 로그아웃', async () => {
    routes['GET /auth/session'] = { status: 200, body: { linked: true, maskedEmail: MASKED } };
    seedDevice();
    mount();
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 });
    const d = screen.getByRole('dialog');
    fireEvent.click(q(d, 'device-link'));
    const c = await screen.findByRole('dialog', { name: COPY.save.deviceTitle });
    expect(c).toHaveTextContent(COPY.save.deviceLinkedNote);
    fireEvent.click(q(c, 'device-cta'));
    await screen.findByRole('dialog', { name: COPY.save.deviceDoneTitle });
    expect(calls()).toContain('DELETE /auth/session');
    expect(wsKeys()).toEqual([]);
  });
});

