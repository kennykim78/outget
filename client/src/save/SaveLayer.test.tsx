// L8 SaveLayer — 입력 → 보냄(주소 무관 같은 응답) · 형식 오류 · 503 저장 불가 · /save#t= (hash 즉시 제거 → verify → GET → 병합 → PUT)
//   · 만료 · 연결 상태 → "이 기기에서 연결 해제" · localStorage 에 토큰·이메일 0 · 금지어 0. 네트워크는 fetch 스텁(동일 출처 경로만).
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COPY, formatCopy } from '@ws/copy';
import type { PublicRequirement, SpecSchema, WsPageData } from '@ws/engine';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 원인 ①(실측): find* 는 DOM 커밋을 보고 풀리는데 save_prompt_view 는 passive effect(useEffect)에서 보낸다 — 부하 시
//   effect 플러시 전에 events 를 단언해 [] 로 실패. → 이벤트 단언은 waitFor.
// 원인 ②: L8 은 registry 의 지연 청크 — 파일 첫 테스트가 SaveLayer 모듈(+의존 그래프) 콜드 변환·로드를 떠안아
//   전체 실행 부하에서 기본 5초(테스트)·1초(find*) 에 가까워진다. 모듈을 beforeAll 에서 미리 올려 lazy import 를 캐시 적중으로 만들고,
//   여유 타임아웃을 둔다(FE2 SpecCheckLayer 와 같은 처치). 2초 디바운스 타이머는 이 파일에서 기다리지 않는다(afterEach 에서 중지).
vi.setConfig({ testTimeout: 30000 });
configure({ asyncUtilTimeout: 10000 });
beforeAll(async () => {
  await import('./SaveLayer');
}, 30000);
import { LayerPageProvider } from '../app/layerPage';
import { layerRegistry } from '../app/layerRegistry';
import { deriveChecklist } from '../checklist/derive';
import { migrateSetup, setupKey } from '../checklist/setupStore';
import { clearEngineCacheForTest } from '../speccheck/engine';
import { setTrackerForTest, type Tracker } from '../events/track';
import { golden, pageOf, req } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';
import { clearMagicToken } from './magicLink';
import { SAVE_STATE_KEY } from './saveStateStore';
import { resetSaveSyncForTest } from './sync';

const TOKEN = 'Zt3'.repeat(14) + 'x'; // 43자 base64url
const EMAIL = 'kenny@example.com';
const BANNED = ['괜찮다', '안전하다', '최저가', '판매순', '베스트', '정확도', '회원가입', '구매'];
const T1 = '2026-10-01T00:00:00.000Z';
const MASKED = 'k***@e***.com';

type Route = { status: number; body?: unknown };
let routes: Record<string, Route>;
let fetchLog: Array<{ method: string; path: string; body: unknown; hashAtCall: string }>;
let events: Array<[string, Record<string, unknown>]>;
async function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = String(input);
  const method = init?.method ?? 'GET';
  fetchLog.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null, hashAtCall: window.location.hash });
  const r = routes[`${method} ${path}`] ?? { status: 404 };
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? null } as unknown as Response;
}
const fetchMock = vi.fn(route);

const CAGE_SCHEMA: SpecSchema = {
  fields: [
    { key: 'type', label: '형태', type: 'enum', options: ['LIVING_BOX', 'WIRE', 'ACRYLIC', 'OTHER'], optionLabels: { LIVING_BOX: '리빙박스', WIRE: '철망', ACRYLIC: '아크릴 케이지', OTHER: '기타' } },
    { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
    { key: 'floorDcm', label: '바닥 세로(cm)', type: 'number', min: 20, max: 120 },
    { key: 'heightCm', label: '높이(cm)', type: 'number', min: 15, max: 100 },
    { key: 'barGapMm', label: '철망 간격(mm)', type: 'number', min: 3, max: 30, optional: true },
  ],
};

function preq(id: string, name: string, specSchema: SpecSchema, minSpec: PublicRequirement['minSpec']): PublicRequirement {
  const base = req(id, 'REQUIRED', name);
  return { ...base, minSpec, item: { ...base.item, specSchema } };
}

function page(): WsPageData {
  return pageOf('TYPE', { requirements: [req('cage', 'REQUIRED', '케이지'), req('wheel', 'REQUIRED', '쳇바퀴')] }, { typeId: golden.id, path: '/hamster/golden' });
}

function mount(p: WsPageData = page()) {
  render(
    <LayerPageProvider page={p}>
      <LayerHost registry={layerRegistry} />
    </LayerPageProvider>,
  );
}

async function openFromHome(): Promise<HTMLElement> {
  act(() => layerStore.open('L8', {}, { url: '/save' }));
  await screen.findByLabelText(COPY.save.emailLabel, undefined, { timeout: 15000 });
  return screen.getByRole('dialog', { name: COPY.save.title });
}

/** ws.* 전체 원문(테스트는 localStorage 직접 읽기 허용 — C9 예외). */
function allWsValues(): string {
  const out: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i) as string;
    if (k.startsWith('ws.')) out.push(`${k}=${window.localStorage.getItem(k) ?? ''}`);
  }
  return out.join('\n');
}

function expectNoSecretsStored(): void {
  const all = allWsValues();
  expect(all).not.toContain(TOKEN);
  expect(all).not.toContain(EMAIL);
  expect(all).not.toMatch(/[^\s@"]+@[^\s@"]+\.[^\s@"]+/);
  expect(all).not.toMatch(/"(?:token|email|sid|ws_sid)"/i);
}

function sessionCalls(): number {
  return fetchLog.filter((f) => f.method === 'GET' && f.path === '/auth/session').length;
}

/** 다른 탭 연결 전환 뒤 정상 상태: 열기 probe + 전환 probe = 정확히 2회 응답 뒤에도 연결 화면 유지 + ws.save.linked. */
async function expectLinkedSettled(): Promise<void> {
  await waitFor(() => expect(sessionCalls()).toBe(2));
  await act(async () => undefined);
  expect(screen.getByRole('dialog', { name: COPY.save.signedInTitle })).toBeInTheDocument();
  expect(screen.queryByLabelText(COPY.save.emailLabel)).toBeNull();
  expect(JSON.parse(window.localStorage.getItem(SAVE_STATE_KEY) as string)).toMatchObject({ linked: true });
  expect(sessionCalls()).toBe(2);
}

function expectNoBanned(el: HTMLElement): void {
  for (const w of BANNED) expect(el.textContent ?? '').not.toContain(w);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/hamster/golden');
  routes = {
    'POST /auth/magic/request': { status: 202, body: { ok: true } },
    'POST /auth/magic/verify': { status: 200, body: { linked: true, maskedEmail: MASKED } },
    'GET /api/save': { status: 200, body: { snapshot: null, updatedAt: null } },
    'PUT /api/save': { status: 204 },
    'DELETE /auth/session': { status: 204 },
    'GET /auth/session': { status: 200, body: { linked: false } },
  };
  fetchLog = [];
  events = [];
  fetchMock.mockClear();
  fetchMock.mockImplementation(route);
  vi.stubGlobal('fetch', fetchMock);
  const fake: Tracker = { track: (n, p) => void events.push([n, p]), flush: () => undefined, dispose: () => undefined };
  setTrackerForTest(fake);
});

afterEach(() => {
  act(() => layerStore.resetForTest());
  resetSaveSyncForTest();
  clearMagicToken();
  setTrackerForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('L8 입력 → 보냄', () => {
  it('제목·설명·라벨·요약(L3 전 숫자 0)·채움 1 + 나중에 + 광고 문구, save_prompt_view{home_band}', async () => {
    window.localStorage.setItem('ws.animalType', golden.id);
    mount();
    const d = await openFromHome();
    expect(d).toHaveTextContent(COPY.save.description);
    expect(screen.getByLabelText(COPY.save.emailLabel)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(COPY.save.emailLabel)).toHaveAttribute('autocomplete', 'email');
    const summary = d.querySelector('[data-ws-save="summary"]') as HTMLElement;
    expect(summary).toHaveTextContent(golden.displayName);
    expect(summary.textContent).not.toMatch(/\d/);
    expect(d.querySelectorAll('.ws-btn--fill')).toHaveLength(1);
    expect(d).toHaveTextContent(COPY.save.later);
    expect(d).toHaveTextContent(COPY.save.noAds);
    expect(d.querySelectorAll('.ws-avatar')).toHaveLength(1);
    await waitFor(() => expect(events).toContainEqual(['save_prompt_view', { entry: 'home_band' }]));
    expectNoBanned(d);
  });

  it('L3 후 요약: 필수 n개 남음 + 내 케이지 W×D×H', async () => {
    window.localStorage.setItem('ws.animalType', golden.id);
    window.localStorage.setItem(
      setupKey(golden.id),
      JSON.stringify({ v: 2, firstTime: true, owned: [], answeredAt: T1, startedAt: T1, checks: { cage: { source: 'OWNED', at: T1 } }, reached100At: null, updatedAt: T1 }),
    );
    window.localStorage.setItem(`ws.context.${golden.id}.cage`, JSON.stringify({ v: 1, type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: T1 }));
    // MAJOR-2: 케이지는 홈 B·L2 처럼 케이지 스키마로 읽는다 — fixture 의 빈 스키마 대신 실제 모양 스키마.
    mount(pageOf('TYPE', { requirements: [preq('cage', '케이지', CAGE_SCHEMA, { rules: [] }), req('wheel', 'REQUIRED', '쳇바퀴')] }, { typeId: golden.id, path: '/hamster/golden' }));
    const d = await openFromHome();
    const summary = d.querySelector('[data-ws-save="summary"]') as HTMLElement;
    expect(summary).toHaveTextContent('필수 1개 남음');
    expect(summary).toHaveTextContent('내 케이지 60×40×35cm');
  });

  it('형식 오류 → 안내 + aria-invalid, 네트워크 0', async () => {
    mount();
    await openFromHome();
    const input = screen.getByLabelText(COPY.save.emailLabel);
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: COPY.save.submit }));
    expect(await screen.findByText(COPY.save.errorFormat)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(fetchLog.filter((f) => f.method === 'POST')).toHaveLength(0);
    await waitFor(() => expect(fetchLog.map((f) => `${f.method} ${f.path}`)).toEqual(['GET /auth/session'])); // 열 때 세션 확인 1회(L-3)
  });

  it('보내기 → POST {email, entry:home} → "메일을 보냈어요" + 60초 쿨다운, 저장소에 이메일 0', async () => {
    mount();
    await openFromHome();
    fireEvent.change(screen.getByLabelText(COPY.save.emailLabel), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: COPY.save.submit }));
    const d = await screen.findByRole('dialog', { name: COPY.save.sentTitle });
    expect(fetchLog.filter((f) => f.method === 'POST')).toEqual([{ method: 'POST', path: '/auth/magic/request', body: { email: EMAIL, entry: 'home' }, hashAtCall: '' }]);
    expect(d).toHaveTextContent(COPY.save.sentBody);
    expect(screen.getByRole('button', { name: COPY.save.resend })).toBeDisabled();
    expect(d).toHaveTextContent('60초 뒤 다시 보낼 수 있어요');
    expect(d.querySelectorAll('.ws-btn--fill')).toHaveLength(0);
    expect(events).toContainEqual(['save_email_submit', {}]);
    expect(JSON.stringify(window.history.state ?? null)).not.toContain(EMAIL);
    expectNoSecretsStored();
    expectNoBanned(d);
    fireEvent.click(screen.getByRole('button', { name: COPY.save.otherAddress }));
    expect(await screen.findByRole('dialog', { name: COPY.save.title })).toBeInTheDocument();
  });

  it('503 SAVE_UNAVAILABLE → 저장 불가 안내(data-ws-error=unavailable), 입력 유지', async () => {
    routes['POST /auth/magic/request'] = { status: 503, body: { code: 'SAVE_UNAVAILABLE' } };
    mount();
    await openFromHome();
    fireEvent.change(screen.getByLabelText(COPY.save.emailLabel), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: COPY.save.submit }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(COPY.save.unavailable);
    expect(alert).not.toHaveTextContent(COPY.save.errorNetwork);
    expect(alert).toHaveAttribute('data-ws-error', 'unavailable');
    expect(screen.getByLabelText(COPY.save.emailLabel)).toHaveValue(EMAIL);
    expect(screen.getByRole('dialog', { name: COPY.save.title })).toBeInTheDocument();
    expectNoSecretsStored();
  });

  it('429·네트워크 → 같은 안내(data-ws-error=network)', async () => {
    routes['POST /auth/magic/request'] = { status: 429 };
    mount();
    await openFromHome();
    fireEvent.change(screen.getByLabelText(COPY.save.emailLabel), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: COPY.save.submit }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-ws-error', 'network');
    expect(alert).toHaveTextContent(COPY.save.errorNetwork);
  });

  it('m-11 보냄 화면에서 다른 탭이 연결하면(storage 이벤트) 연결 상태로 전환', async () => {
    mount();
    await openFromHome();
    fireEvent.change(screen.getByLabelText(COPY.save.emailLabel), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: COPY.save.submit }));
    await screen.findByRole('dialog', { name: COPY.save.sentTitle });
    routes['GET /auth/session'] = { status: 200, body: { linked: true, maskedEmail: MASKED } }; // 다른 탭이 연결한 뒤의 서버 세션
    act(() => {
      window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
      window.dispatchEvent(new StorageEvent('storage', { key: SAVE_STATE_KEY }));
    });
    expect(await screen.findByRole('dialog', { name: COPY.save.signedInTitle })).toBeInTheDocument();
    await expectLinkedSettled();
  });

  it('n-14 다른 탭 연결 전환 시 probe 응답의 마스킹 이메일이 linkedAs 문구로 보인다', async () => {
    mount();
    await openFromHome();
    routes['GET /auth/session'] = { status: 200, body: { linked: true, maskedEmail: MASKED } };
    act(() => {
      window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
      window.dispatchEvent(new StorageEvent('storage', { key: SAVE_STATE_KEY }));
    });
    expect(await screen.findByRole('dialog', { name: COPY.save.signedInTitle })).toBeInTheDocument();
    expect(await screen.findByText(`${MASKED}에 저장하고 있어요`)).toBeInTheDocument();
  });

  it('n-14 전환 시 probe 실패면 마스킹 이메일 줄 없음', async () => {
    mount();
    await openFromHome();
    routes['GET /auth/session'] = { status: 500 };
    act(() => {
      window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
      window.dispatchEvent(new StorageEvent('storage', { key: SAVE_STATE_KEY }));
    });
    expect(await screen.findByRole('dialog', { name: COPY.save.signedInTitle })).toBeInTheDocument();
    await waitFor(() => expect(sessionCalls()).toBe(2));
    expect(screen.queryByText(/에 저장하고 있어요/)).toBeNull();
  });

  it('m-11 후속: 전송 대기(sending) 중 다른 탭이 연결 → 요청이 resolve 돼도 연결 상태 유지(sent 로 덮어쓰지 않음)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/auth/magic/request') await gate;
      return route(input, init);
    });
    mount();
    await openFromHome();
    fireEvent.change(screen.getByLabelText(COPY.save.emailLabel), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: COPY.save.submit }));
    // fetchLog 는 route() 안(gate 뒤)에서 쌓이므로 호출 자체를 본다.
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/auth/magic/request')).toBe(true));
    routes['GET /auth/session'] = { status: 200, body: { linked: true } }; // 다른 탭이 연결한 뒤의 서버 세션(전환 시 probe 가 이를 본다)
    act(() => {
      window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
      window.dispatchEvent(new StorageEvent('storage', { key: SAVE_STATE_KEY }));
    });
    expect(await screen.findByRole('dialog', { name: COPY.save.signedInTitle })).toBeInTheDocument();
    await act(async () => {
      release();
      await gate;
    });
    expect(screen.getByRole('dialog', { name: COPY.save.signedInTitle })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: COPY.save.sentTitle })).toBeNull();
  });

  it('m-11 후속: 입력 화면에서 다른 탭이 연결하면 연결 상태로 전환', async () => {
    mount();
    await openFromHome();
    await waitFor(() => expect(sessionCalls()).toBe(1)); // 열기 probe 응답 뒤
    routes['GET /auth/session'] = { status: 200, body: { linked: true, maskedEmail: MASKED } };
    act(() => {
      window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
      window.dispatchEvent(new StorageEvent('storage', { key: SAVE_STATE_KEY }));
    });
    expect(await screen.findByRole('dialog', { name: COPY.save.signedInTitle })).toBeInTheDocument();
    await expectLinkedSettled();
  });

  it('m-11 서버 불일치: 다른 탭 연결 신호 뒤 서버 세션이 linked:false 면 로컬 해제 → 입력 화면 복귀', async () => {
    mount();
    await openFromHome();
    await waitFor(() => expect(sessionCalls()).toBe(1));
    // GET /auth/session 은 기본 스텁 {linked:false} 그대로 — 로컬 기록만 linked 인 불일치.
    act(() => {
      window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
      window.dispatchEvent(new StorageEvent('storage', { key: SAVE_STATE_KEY }));
    });
    expect(await screen.findByRole('dialog', { name: COPY.save.signedInTitle })).toBeInTheDocument();
    await waitFor(() => expect(sessionCalls()).toBe(2));
    expect(await screen.findByRole('dialog', { name: COPY.save.title })).toBeInTheDocument();
    expect(window.localStorage.getItem(SAVE_STATE_KEY)).toBeNull();
  });

  it('L2 위에서 열면 entry = l2_footer / checklist', async () => {
    mount();
    act(() => layerStore.open('L2', { typeId: golden.id }));
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    await screen.findByRole('dialog', { name: COPY.save.title }, { timeout: 15000 });
    await waitFor(() => expect(events).toContainEqual(['save_prompt_view', { entry: 'l2_footer' }]));
    fireEvent.change(screen.getByLabelText(COPY.save.emailLabel), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: COPY.save.submit }));
    await screen.findByRole('dialog', { name: COPY.save.sentTitle });
    expect(fetchLog.find((f) => f.method === 'POST')?.body).toEqual({ email: EMAIL, entry: 'checklist' });
  });
});

describe('/save#t= 매직링크 복귀', () => {
  async function arrive(): Promise<HTMLElement> {
    window.history.replaceState(null, '', `/save#t=${TOKEN}`);
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    mount(pageOf('SAVE', {}, { path: '/save' }));
    act(() => layerStore.initDeepLink('L8', {}, '/'));
    // SEC-3 M-1: 열기만 해서는 네트워크 0(스캐너가 토큰을 소진·자동 연결하지 못한다) — 클릭해야 verify.
    const btn = await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 });
    await act(async () => undefined);
    expect(fetchLog).toHaveLength(0);
    // DR M-3: 연결 화면 전용 제목·본문 + 꼬리 [이 기기 연결하기] 채움 · [나중에 할게요] 아웃라인.
    const connect = screen.getByRole('dialog', { name: COPY.save.connectTitle });
    expect(connect).toHaveTextContent(COPY.save.connectBody);
    expect(connect).not.toHaveTextContent(COPY.save.description);
    expect(btn).toHaveClass('ws-btn--fill');
    expect(screen.getByRole('button', { name: COPY.save.later })).toHaveClass('ws-btn--outline');
    expect(connect.querySelectorAll('.ws-btn--fill')).toHaveLength(1);
    expect(connect.querySelectorAll('.ws-save-foot > .ws-btn')).toHaveLength(2);
    fireEvent.click(btn);
    const d = await screen.findByRole('dialog', { name: COPY.save.confirmedTitle }, { timeout: 15000 });
    expect(fetchLog.filter((f) => f.path === '/auth/magic/verify')).toHaveLength(1);
    // hash 제거 replaceState 가 첫 fetch 보다 먼저
    const hashCall = replaceSpy.mock.calls.findIndex((c) => c[2] === '/save');
    expect(hashCall).toBeGreaterThanOrEqual(0);
    const firstFetch = fetchMock.mock.invocationCallOrder[0];
    expect(replaceSpy.mock.invocationCallOrder[hashCall]).toBeLessThan(firstFetch);
    return d;
  }

  it('hash 즉시 제거 → verify(토큰) → GET → PUT(로컬 승) → "저장했어요" + save_link_confirm · save_merge{local}', async () => {
    window.localStorage.setItem('ws.animalType', golden.id);
    const d = await arrive();
    expect(window.location.hash).toBe('');
    expect(fetchLog.every((f) => f.hashAtCall === '')).toBe(true);
    expect(fetchLog.map((f) => `${f.method} ${f.path}`)).toEqual(['POST /auth/magic/verify', 'GET /api/save', 'PUT /api/save']);
    expect(fetchLog[0].body).toEqual({ token: TOKEN });
    expect((fetchLog[2].body as { snapshot: { animalTypeId: string } }).snapshot.animalTypeId).toBe(golden.id);
    // H1 계약: 본문 = {snapshot, baseUpdatedAt}, 서버 행 없음(GET updatedAt null) → null
    expect(Object.keys(fetchLog[2].body as object).sort()).toEqual(['baseUpdatedAt', 'snapshot']);
    expect((fetchLog[2].body as { baseUpdatedAt: unknown }).baseUpdatedAt).toBeNull();
    expect(d).toHaveTextContent(COPY.save.confirmedBody);
    expect(d).toHaveTextContent(COPY.save.mergedLocal);
    expect(d).toHaveTextContent(`${MASKED}에 저장하고 있어요`);
    expect(events).toContainEqual(['save_link_confirm', {}]);
    expect(events).toContainEqual(['save_merge', { winner: 'local' }]);
    expect(events.some(([n]) => n === 'save_prompt_view')).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(SAVE_STATE_KEY) as string)).toMatchObject({ v: 1, linked: true });
    expectNoSecretsStored();
    expect(JSON.stringify(window.history.state ?? null)).not.toContain(TOKEN);
    expectNoBanned(d);
  });

  it('서버본이 이기면 "저장해 둔 준비 상태를 불러왔어요", PUT 0, 로컬에 씀', async () => {
    const serverSetup = { v: 2, firstTime: true, owned: [], answeredAt: T1, startedAt: T1, checks: { wheel: { source: 'OWNED', at: T1 } }, reached100At: null, updatedAt: T1 };
    routes['GET /api/save'] = {
      status: 200,
      body: { snapshot: { v: 1, animalTypeId: golden.id, setups: { [golden.id]: serverSetup }, cages: {}, reactions: { like: {}, helpful: {}, updatedAt: null } }, updatedAt: T1 },
    };
    const d = await arrive();
    expect(d).toHaveTextContent(COPY.save.mergedServer);
    expect(fetchLog.some((f) => f.method === 'PUT')).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(setupKey(golden.id)) as string).checks.wheel).toBeDefined();
    expect(window.localStorage.getItem('ws.animalType')).toBe(golden.id);
  });

  it('m-10 확인 중 → 연결 화면 유지(같은 제목·본문) + 채움 버튼 aria-disabled(포커스 유지, D6)·aria-busy "확인하고 있어요" + [나중에 할게요]', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/auth/magic/verify') await gate;
      return route(input, init);
    });
    window.localStorage.setItem('ws.animalType', golden.id); // 저장할 준비가 있는 기기(MAJOR-1 빈 기기는 별도 테스트)
    window.history.replaceState(null, '', `/save#t=${TOKEN}`);
    mount(pageOf('SAVE', {}, { path: '/save' }));
    act(() => layerStore.initDeepLink('L8', {}, '/'));
    const cta = await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 });
    cta.focus();
    fireEvent.click(cta);
    const busy = await screen.findByRole('button', { name: COPY.save.verifying }, { timeout: 15000 });
    const d = screen.getByRole('dialog', { name: COPY.save.connectTitle });
    expect(d).toHaveTextContent(COPY.save.connectBody);
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy); // 확인 중 클릭은 무시 — verify 1회
    expect(fetchMock.mock.calls.filter((c) => String(c[0]) === '/auth/magic/verify')).toHaveLength(1);
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveClass('ws-btn--fill');
    expect(d.querySelectorAll('.ws-btn--fill')).toHaveLength(1);
    expect(screen.getByRole('button', { name: COPY.save.later })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    release();
    expect(await screen.findByRole('dialog', { name: COPY.save.confirmedTitle })).toBeInTheDocument();
  });

  it('만료·사용됨(401) → "링크를 쓸 수 없어요" → [인증 메일 다시 보내기] → 입력', async () => {
    routes['POST /auth/magic/verify'] = { status: 401 };
    window.history.replaceState(null, '', `/save#t=${TOKEN}`);
    mount(pageOf('SAVE', {}, { path: '/save' }));
    act(() => layerStore.initDeepLink('L8', {}, '/'));
    fireEvent.click(await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 }));
    const d = await screen.findByRole('dialog', { name: COPY.save.expiredTitle }, { timeout: 15000 });
    expect(window.location.hash).toBe('');
    expect(d).toHaveTextContent(COPY.save.expiredBody);
    expect(fetchLog.map((f) => f.path)).toEqual(['/auth/magic/verify']);
    expect(window.localStorage.getItem(SAVE_STATE_KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: COPY.save.resendVerify }));
    expect(await screen.findByRole('dialog', { name: COPY.save.title })).toBeInTheDocument();
    await waitFor(() => expect(events).toContainEqual(['save_prompt_view', { entry: 'deeplink' }]));
  });

  it.each([503, 429])('M4 verify %i(네트워크·서버 오류) → 만료 아님: 연결 화면 유지 + 안내, 토큰 유지 → 다시 누르면 verify 재전송 → 저장했어요', async (status) => {
    routes['POST /auth/magic/verify'] = { status };
    window.localStorage.setItem('ws.animalType', golden.id); // 저장할 준비가 있는 기기
    window.history.replaceState(null, '', `/save#t=${TOKEN}`);
    mount(pageOf('SAVE', {}, { path: '/save' }));
    act(() => layerStore.initDeepLink('L8', {}, '/'));
    fireEvent.click(await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 }));
    const alert = await screen.findByRole('alert', undefined, { timeout: 15000 });
    expect(alert).toHaveTextContent(COPY.save.connectError);
    expect(alert).toHaveAttribute('data-ws-error', 'connect');
    const d = screen.getByRole('dialog', { name: COPY.save.connectTitle });
    expect(d).toHaveTextContent(COPY.save.connectBody);
    expect(screen.queryByRole('dialog', { name: COPY.save.expiredTitle })).toBeNull();
    expect(window.localStorage.getItem(SAVE_STATE_KEY)).toBeNull();
    expectNoSecretsStored();
    routes['POST /auth/magic/verify'] = { status: 200, body: { linked: true, maskedEmail: MASKED } };
    fireEvent.click(screen.getByRole('button', { name: COPY.save.connectCta }));
    expect(await screen.findByRole('dialog', { name: COPY.save.confirmedTitle }, { timeout: 15000 })).toBeInTheDocument();
    const verifies = fetchLog.filter((f) => f.path === '/auth/magic/verify');
    expect(verifies).toHaveLength(2);
    expect(verifies[1].body).toEqual({ token: TOKEN });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('m-12 이미 연결된 기기: 사용된 링크(401) → 연결 상태 화면(만료 아님)', async () => {
    routes['POST /auth/magic/verify'] = { status: 401 };
    routes['GET /auth/session'] = { status: 200, body: { linked: true, maskedEmail: MASKED } };
    window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
    window.history.replaceState(null, '', `/save#t=${TOKEN}`);
    mount(pageOf('SAVE', {}, { path: '/save' }));
    act(() => layerStore.initDeepLink('L8', {}, '/'));
    fireEvent.click(await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 }));
    expect(await screen.findByRole('dialog', { name: COPY.save.signedInTitle }, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: COPY.save.expiredTitle })).toBeNull();
  });

  it('m-12 이미 연결된 기기: 형식이 틀린 토큰 → 연결 상태 화면으로 시작', async () => {
    routes['GET /auth/session'] = { status: 200, body: { linked: true, maskedEmail: MASKED } };
    window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
    window.history.replaceState(null, '', '/save#t=bad');
    mount(pageOf('SAVE', {}, { path: '/save' }));
    act(() => layerStore.initDeepLink('L8', {}, '/'));
    expect(await screen.findByRole('dialog', { name: COPY.save.signedInTitle }, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: COPY.save.expiredTitle })).toBeNull();
  });

  it('형식이 틀린 토큰 → 네트워크 0, 만료 화면', async () => {
    window.history.replaceState(null, '', '/save#t=bad');
    mount(pageOf('SAVE', {}, { path: '/save' }));
    act(() => layerStore.initDeepLink('L8', {}, '/'));
    await screen.findByRole('dialog', { name: COPY.save.expiredTitle }, { timeout: 15000 });
    expect(window.location.hash).toBe('');
    expect(fetchLog).toHaveLength(0);
  });
});

describe('같은 탭 매직링크(P2 D1) — 해시만 바뀐 popstate', () => {
  /** 주소창에 /save#t= 붙여넣기 = 같은 문서 프래그먼트 이동(새 항목 push, state null) + popstate(null). */
  function pasteLink(hash: string): void {
    act(() => {
      window.history.pushState(null, '', `/save${hash}`);
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
  }
  function verifyCalls(): number {
    return fetchLog.filter((f) => f.path === '/auth/magic/verify').length;
  }

  it('L8 이 열린 채 붙여넣기 → L8 유지 + 연결 화면, hash·history.state 에 토큰 0, wsDepth 정의, 클릭 전 verify 0 → 클릭 시 1', async () => {
    window.localStorage.setItem('ws.animalType', golden.id); // 저장할 준비가 있는 기기
    mount();
    await openFromHome();
    pasteLink(`#t=${TOKEN}`);
    const btn = await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: COPY.save.connectTitle })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/save');
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.history.state).toMatchObject({ wsLayer: 'L8', wsParent: '/hamster/golden', wsDepth: 2 });
    expect(JSON.stringify(window.history.state)).not.toContain(TOKEN);
    await act(async () => undefined);
    expect(verifyCalls()).toBe(0);
    fireEvent.click(btn);
    await screen.findByRole('dialog', { name: COPY.save.confirmedTitle }, { timeout: 15000 });
    expect(verifyCalls()).toBe(1);
    expect(fetchLog.find((f) => f.path === '/auth/magic/verify')?.body).toEqual({ token: TOKEN });
    expect(fetchLog.every((f) => f.hashAtCall === '')).toBe(true);
    expectNoSecretsStored();
  });

  it('붙여넣은 뒤 ✕ → 원래 부모(/hamster/golden)로 닫힌다(토큰 항목이 부모를 잃지 않음)', async () => {
    mount();
    await openFromHome();
    pasteLink(`#t=${TOKEN}`);
    await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 });
    act(() => layerStore.close());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/hamster/golden');
    expect(verifyCalls()).toBe(0);
  });

  it('L8 이 닫힌 상태에서 /save#t= 이동 → L8 연결 화면이 열린다(verify 0)', async () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    pasteLink(`#t=${TOKEN}`);
    expect(await screen.findByRole('dialog', { name: COPY.save.connectTitle }, { timeout: 15000 })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(window.history.state).toMatchObject({ wsLayer: 'L8', wsDepth: 1 });
    await act(async () => undefined);
    expect(verifyCalls()).toBe(0);
  });

  it('형식이 틀린 토큰 붙여넣기 → 만료 화면, verify 0', async () => {
    mount();
    await openFromHome();
    pasteLink('#t=bad');
    expect(await screen.findByRole('dialog', { name: COPY.save.expiredTitle }, { timeout: 15000 })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(verifyCalls()).toBe(0);
  });
});

describe('연결 상태', () => {
  it('"이메일로 저장 중이에요" + 자동 저장 재개(GET) → [이 기기에서 연결 해제] → DELETE, ws.save 삭제, 입력 화면', async () => {
    routes['GET /auth/session'] = { status: 200, body: { linked: true, maskedEmail: MASKED } };
    window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
    mount();
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    const d = await screen.findByRole('dialog', { name: COPY.save.signedInTitle }, { timeout: 15000 });
    expect(d).toHaveTextContent(COPY.save.signedInNote);
    expect(await screen.findByText(`${MASKED}에 저장하고 있어요`)).toBeInTheDocument();
    expect(d.textContent).not.toContain(EMAIL);
    expectNoSecretsStored();
    expect(d.querySelectorAll('.ws-btn--fill')).toHaveLength(0);
    await waitFor(() => expect(fetchLog.map((f) => `${f.method} ${f.path}`)).toContain('GET /api/save'));
    fireEvent.click(screen.getByRole('button', { name: COPY.save.disconnect }));
    expect(await screen.findByRole('dialog', { name: COPY.save.title })).toBeInTheDocument();
    await waitFor(() => expect(fetchLog.map((f) => `${f.method} ${f.path}`)).toContain('DELETE /auth/session'));
    expect(window.localStorage.getItem(SAVE_STATE_KEY)).toBeNull();
    expectNoBanned(d);
  });

  it('세션이 서버에서 끊겼으면(GET 401) 입력 화면으로', async () => {
    routes['GET /api/save'] = { status: 401 };
    window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
    mount();
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    expect(await screen.findByRole('dialog', { name: COPY.save.title }, { timeout: 15000 })).toBeInTheDocument();
    expect(window.localStorage.getItem(SAVE_STATE_KEY)).toBeNull();
  });

  it('maskedEmail 이 없으면(BE 반영 전) 주소 줄 0', async () => {
    routes['GET /auth/session'] = { status: 200, body: { linked: true } };
    window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
    mount();
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    const d = await screen.findByRole('dialog', { name: COPY.save.signedInTitle }, { timeout: 15000 });
    await waitFor(() => expect(fetchLog.map((f) => f.path)).toContain('/api/save'));
    expect(d.querySelector('[data-ws-save="linked-as"]')).toBeNull();
  });

  it('로컬 기록 없음 + 서버 세션 살아 있음 → [이 기기 연결하기](verify 없이 연결 → GET) | [연결 해제]', async () => {
    routes['GET /auth/session'] = { status: 200, body: { linked: true, maskedEmail: MASKED } };
    mount();
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    const btn = await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 });
    const d = screen.getByRole('dialog');
    expect(d).toHaveTextContent(`${MASKED}에 저장하고 있어요`);
    expect(screen.getByRole('button', { name: COPY.save.disconnect })).toBeInTheDocument();
    expect(d.querySelectorAll('.ws-btn--fill')).toHaveLength(1);
    fireEvent.click(btn);
    expect(await screen.findByRole('dialog', { name: COPY.save.signedInTitle })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(SAVE_STATE_KEY) as string)).toMatchObject({ linked: true });
    await waitFor(() => expect(fetchLog.map((f) => `${f.method} ${f.path}`)).toContain('GET /api/save'));
    expect(fetchLog.some((f) => f.path === '/auth/magic/verify')).toBe(false);
    expectNoSecretsStored();
  });

  it('로컬 기록 없음 + 서버 세션 → [연결 해제] → DELETE, ws.save 없음', async () => {
    routes['GET /auth/session'] = { status: 200, body: { linked: true } };
    mount();
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    fireEvent.click(await screen.findByRole('button', { name: COPY.save.disconnect }, { timeout: 15000 }));
    await waitFor(() => expect(fetchLog.map((f) => `${f.method} ${f.path}`)).toContain('DELETE /auth/session'));
    await waitFor(() => expect(window.localStorage.getItem(SAVE_STATE_KEY)).toBeNull());
  });

  it('SEC-3 L-3: 연결 해제 DELETE 실패 → ws.save {pendingLogout:true}(이메일·토큰 0) → 다시 열면 DELETE 재시도 → 기록 삭제', async () => {
    routes['GET /auth/session'] = { status: 200, body: { linked: true, maskedEmail: MASKED } };
    routes['DELETE /auth/session'] = { status: 500 };
    window.localStorage.setItem(SAVE_STATE_KEY, JSON.stringify({ v: 1, linked: true, lastSyncAt: null }));
    mount();
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    fireEvent.click(await screen.findByRole('button', { name: COPY.save.disconnect }, { timeout: 15000 }));
    await waitFor(() => expect(fetchLog.map((f) => `${f.method} ${f.path}`)).toContain('DELETE /auth/session'));
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(SAVE_STATE_KEY) as string)).toEqual({ v: 1, linked: false, lastSyncAt: null, pendingLogout: true }),
    );
    expectNoSecretsStored();

    act(() => layerStore.resetForTest());
    routes['DELETE /auth/session'] = { status: 204 };
    const before = fetchLog.length;
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    await screen.findByLabelText(COPY.save.emailLabel, undefined, { timeout: 15000 });
    await waitFor(() => expect(window.localStorage.getItem(SAVE_STATE_KEY)).toBeNull());
    // 미전송 로그아웃 재시도가 먼저 — 그 열기에서 세션 GET 은 생략.
    expect(fetchLog.slice(before).map((f) => `${f.method} ${f.path}`)).toEqual(['DELETE /auth/session']);
  });
});

describe('P1 MAJOR-1 빈 기기 연결 · 보냄 화면 안내', () => {
  function arriveEmpty(): void {
    window.history.replaceState(null, '', `/save#t=${TOKEN}`);
    mount(pageOf('SAVE', {}, { path: '/save' }));
    act(() => layerStore.initDeepLink('L8', {}, '/'));
  }

  it('로컬·서버 모두 비어 있음 → PUT 0, "저장했어요" 대신 connectedEmpty, 연결 상태(ws.save linked) 유지', async () => {
    arriveEmpty();
    fireEvent.click(await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 }));
    const d = await screen.findByRole('dialog', { name: COPY.save.signedInTitle }, { timeout: 15000 });
    expect(d).toHaveTextContent(COPY.save.connectedEmpty);
    expect(d).not.toHaveTextContent(COPY.save.confirmedBody);
    expect(d).not.toHaveTextContent(COPY.save.mergedLocal);
    expect(screen.queryByRole('dialog', { name: COPY.save.confirmedTitle })).toBeNull();
    expect(d.querySelector('[data-ws-save="connected-empty"]')).not.toBeNull();
    expect(fetchLog.map((f) => `${f.method} ${f.path}`)).toEqual(['POST /auth/magic/verify', 'GET /api/save']);
    expect(JSON.parse(window.localStorage.getItem(SAVE_STATE_KEY) as string)).toMatchObject({ v: 1, linked: true });
    expect(document.activeElement).toBe(d.querySelector('h2'));
    expectNoBanned(d);
  });

  it('서버 행은 있지만 빈 스냅샷 → PUT 0, connectedEmpty', async () => {
    routes['GET /api/save'] = { status: 200, body: { snapshot: { v: 1, animalTypeId: null, setups: {}, cages: {}, reactions: { like: {}, helpful: {}, updatedAt: null } }, updatedAt: T1 } };
    arriveEmpty();
    fireEvent.click(await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 }));
    const d = await screen.findByRole('dialog', { name: COPY.save.signedInTitle }, { timeout: 15000 });
    expect(d).toHaveTextContent(COPY.save.connectedEmpty);
    expect(fetchLog.some((f) => f.method === 'PUT')).toBe(false);
  });

  it('빈 기기 + 서버 저장본 있음 → 불러오기(mergedServer, 저장했어요), connectedEmpty 0, PUT 0', async () => {
    routes['GET /api/save'] = { status: 200, body: { snapshot: { v: 1, animalTypeId: golden.id, setups: {}, cages: {}, reactions: { like: {}, helpful: {}, updatedAt: null } }, updatedAt: T1 } };
    arriveEmpty();
    fireEvent.click(await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 }));
    const d = await screen.findByRole('dialog', { name: COPY.save.confirmedTitle }, { timeout: 15000 });
    expect(d).toHaveTextContent(COPY.save.mergedServer);
    expect(d).not.toHaveTextContent(COPY.save.connectedEmpty);
    expect(fetchLog.some((f) => f.method === 'PUT')).toBe(false);
    expect(window.localStorage.getItem('ws.animalType')).toBe(golden.id);
  });

  it('보냄 화면: sentBody 아래 sentSameDevice 한 줄(meta)', async () => {
    mount();
    await openFromHome();
    fireEvent.change(screen.getByLabelText(COPY.save.emailLabel), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: COPY.save.submit }));
    const d = await screen.findByRole('dialog', { name: COPY.save.sentTitle });
    const line = d.querySelector('[data-ws-save="same-device"]') as HTMLElement;
    expect(line).toHaveTextContent(COPY.save.sentSameDevice);
    expect(line).toHaveClass('ws-t-body');
    expect(line).not.toHaveClass('ws-save-muted');
    const body = screen.getByText(COPY.save.sentBody);
    expect(body.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expectNoBanned(d);
  });
});

describe('P1 MAJOR-2 요약 개수 = 홈 B(케이지 △ 반영)', () => {
  const META = { reviewStatus: 'VERIFIED', reviewerType: 'EXPERIENCED_KEEPER', verifiedBy: null, verifiedAt: '2026-09-30', contentKind: 'SPEC', source: [] };
  const WHEEL_SCHEMA: SpecSchema = { fields: [{ key: 'diameterCm', label: '지름(cm)', type: 'number', min: 5, max: 60 }] };
  const WHEEL_MIN = { rules: [{ key: 'diameterCm', op: 'gte' as const, value: 28, reason: 'r' }] };
  const CAGE_MIN = { rules: [{ key: 'floorWcm', op: 'gte' as const, value: 60, reason: 'r' }, { key: 'floorDcm', op: 'gte' as const, value: 40, reason: 'r' }] };
  const item = (id: string, specSchema: SpecSchema) => ({ ...META, id, name: id, category: 'CAGE', glyph: 'G', lifecycle: 'DURABLE', specSchema, compatibleAlternativeIds: [], description: 'd' });
  const creq = (id: string, minSpec: unknown) => ({
    ...META,
    id: `r-${id}`,
    careProfileId: golden.careProfileId,
    supplyItemId: id,
    priority: 'REQUIRED',
    orderHint: 'BEFORE_ARRIVAL',
    why: 'w',
    caution: null,
    avoid: null,
    minSpec,
    recommendedSpec: { rules: [] },
    notNowReason: null,
    searchKeyword: null,
  });
  const CATALOG = {
    v: 1,
    seedDigest: 't',
    animalTypes: [{ ...META, id: golden.id, group: 'SMALL_MAMMAL', displayName: golden.displayName, status: 'ACTIVE', aliases: [], taxonId: null, careProfileId: golden.careProfileId, careOverrides: {} }],
    careProfiles: [{ ...META, id: golden.careProfileId, name: 'p', taxonIds: [], facts: {}, careNotes: [] }],
    supplyItems: [item('cage', CAGE_SCHEMA), item('wheel', WHEEL_SCHEMA)],
    supplyRequirements: [creq('cage', CAGE_MIN), creq('wheel', WHEEL_MIN)],
    compatibilityRules: [
      {
        ...META,
        id: 'cr-wheel-cage',
        a: 'wheel',
        b: 'cage',
        rules: [
          { expr: 'a.diameterCm + 4 <= b.heightCm', onFail: 'BELOW_MIN', message: 'm1' },
          { expr: 'a.diameterCm + 15 <= b.heightCm', onFail: 'CHECK', message: 'm2' },
        ],
      },
    ],
  };
  const REQS = [preq('cage', '케이지', CAGE_SCHEMA, CAGE_MIN), preq('wheel', '쳇바퀴', WHEEL_SCHEMA, WHEEL_MIN), req('bath', 'REQUIRED', '모래 목욕통')];
  const PAGE = pageOf('TYPE', { requirements: REQS }, { typeId: golden.id, path: '/hamster/golden' });
  const SETUP = { v: 2, firstTime: false, owned: ['cage'], answeredAt: T1, startedAt: T1, checks: { cage: { source: 'OWNED', at: T1 }, wheel: { source: 'UNKNOWN', at: T1 } }, reached100At: null, updatedAt: T1 };

  beforeEach(() => {
    clearEngineCacheForTest();
    routes[`GET ${PAGE.catalogUrl}`] = { status: 200, body: CATALOG };
    window.localStorage.setItem('ws.animalType', golden.id);
    window.localStorage.setItem(setupKey(golden.id), JSON.stringify(SETUP));
  });
  afterEach(() => clearEngineCacheForTest());

  it('낮은 케이지(높이 35) → 바퀴 △ — L8 "필수 n개 남음" = deriveChecklist(compat) 값(홈 B 와 같은 경로), compat 없는 값과 다름', async () => {
    window.localStorage.setItem(`ws.context.${golden.id}.cage`, JSON.stringify({ v: 1, type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: T1 }));
    const setup = migrateSetup(SETUP);
    const withCompat = deriveChecklist(REQS, setup, { compat: { wheel: 'CHECK' } }).remainingRequired;
    const without = deriveChecklist(REQS, setup).remainingRequired;
    expect(withCompat).not.toBe(without); // 테스트가 의미 있으려면 두 값이 달라야 한다
    mount(PAGE);
    const d = await openFromHome();
    const summary = d.querySelector('[data-ws-save="summary"]') as HTMLElement;
    await waitFor(() => expect(summary).toHaveTextContent(formatCopy(COPY.save.summaryRemaining, { n: withCompat })));
    expect(fetchLog.filter((f) => f.path === PAGE.catalogUrl)).toHaveLength(1);
  });

  it('케이지 없음 → 카탈로그 요청 0', async () => {
    mount(PAGE);
    const d = await openFromHome();
    await waitFor(() => expect(sessionCalls()).toBe(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(d.querySelector('[data-ws-save="summary"]')).toHaveTextContent(formatCopy(COPY.save.summaryRemaining, { n: 1 }));
    expect(fetchLog.filter((f) => f.path === PAGE.catalogUrl)).toHaveLength(0);
  });
});

describe('P3 D6 포커스 · D7 카운트다운 낭독', () => {
  it('전송 후 activeElement = 보냄 제목(h2)', async () => {
    mount();
    await openFromHome();
    fireEvent.change(screen.getByLabelText(COPY.save.emailLabel), { target: { value: EMAIL } });
    const submit = screen.getByRole('button', { name: COPY.save.submit });
    submit.focus();
    fireEvent.click(submit);
    const d = await screen.findByRole('dialog', { name: COPY.save.sentTitle });
    await waitFor(() => expect(document.activeElement).toBe(d.querySelector('h2')));
    expect(document.activeElement).toHaveTextContent(COPY.save.sentTitle);
  });

  it('전송 중 버튼은 aria-disabled(포커스 유지)·클릭 무시', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/auth/magic/request') await gate;
      return route(input, init);
    });
    mount();
    await openFromHome();
    fireEvent.change(screen.getByLabelText(COPY.save.emailLabel), { target: { value: EMAIL } });
    const submit = screen.getByRole('button', { name: COPY.save.submit });
    submit.focus();
    fireEvent.click(submit);
    const busy = await screen.findByRole('button', { name: COPY.save.sending });
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]) === '/auth/magic/request')).toHaveLength(1);
    await act(async () => {
      release();
      await gate;
    });
    await screen.findByRole('dialog', { name: COPY.save.sentTitle });
  });

  it('429 → 포커스는 버튼에 유지 + role=alert', async () => {
    routes['POST /auth/magic/request'] = { status: 429 };
    mount();
    await openFromHome();
    fireEvent.change(screen.getByLabelText(COPY.save.emailLabel), { target: { value: EMAIL } });
    const submit = screen.getByRole('button', { name: COPY.save.submit });
    submit.focus();
    fireEvent.click(submit);
    await screen.findByRole('alert');
    const again = screen.getByRole('button', { name: COPY.save.submit });
    await act(async () => undefined);
    expect(document.activeElement).toBe(again);
  });

  it('연결 확인 후 activeElement = 확인 제목(h2 "저장했어요")', async () => {
    window.localStorage.setItem('ws.animalType', golden.id);
    window.history.replaceState(null, '', `/save#t=${TOKEN}`);
    mount(pageOf('SAVE', {}, { path: '/save' }));
    act(() => layerStore.initDeepLink('L8', {}, '/'));
    const cta = await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 });
    cta.focus();
    fireEvent.click(cta);
    const d = await screen.findByRole('dialog', { name: COPY.save.confirmedTitle }, { timeout: 15000 });
    await waitFor(() => expect(document.activeElement).toBe(d.querySelector('h2')));
    expect(document.activeElement).toHaveTextContent(COPY.save.confirmedTitle);
  });

  it('만료(401) 후 activeElement = 만료 제목(h2)', async () => {
    routes['POST /auth/magic/verify'] = { status: 401 };
    window.history.replaceState(null, '', `/save#t=${TOKEN}`);
    mount(pageOf('SAVE', {}, { path: '/save' }));
    act(() => layerStore.initDeepLink('L8', {}, '/'));
    const cta = await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 });
    cta.focus();
    fireEvent.click(cta);
    const d = await screen.findByRole('dialog', { name: COPY.save.expiredTitle }, { timeout: 15000 });
    await waitFor(() => expect(document.activeElement).toBe(d.querySelector('h2')));
  });

  it('연결 오류(503) → 포커스는 [이 기기 연결하기] 버튼에 유지(BODY 아님) + role=alert', async () => {
    routes['POST /auth/magic/verify'] = { status: 503 };
    window.history.replaceState(null, '', `/save#t=${TOKEN}`);
    mount(pageOf('SAVE', {}, { path: '/save' }));
    act(() => layerStore.initDeepLink('L8', {}, '/'));
    const cta = await screen.findByRole('button', { name: COPY.save.connectCta }, { timeout: 15000 });
    cta.focus();
    fireEvent.click(cta);
    await screen.findByRole('alert', undefined, { timeout: 15000 });
    await act(async () => undefined);
    const again = screen.getByRole('button', { name: COPY.save.connectCta });
    expect(document.activeElement).toBe(again);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('D7: 카운트다운 문구는 aria-live 밖(요소·조상 모두 live 0)', async () => {
    mount();
    await openFromHome();
    fireEvent.change(screen.getByLabelText(COPY.save.emailLabel), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: COPY.save.submit }));
    const d = await screen.findByRole('dialog', { name: COPY.save.sentTitle });
    const countdown = d.querySelector('[data-ws-save="countdown"]') as HTMLElement;
    expect(countdown).toHaveTextContent('60초 뒤 다시 보낼 수 있어요');
    expect(countdown.closest('[aria-live]')).toBeNull();
    expect(countdown.closest('[role="status"], [role="alert"], [role="log"], [role="timer"]')).toBeNull();
  });
});
