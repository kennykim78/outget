// F3-3 헤더 저장 점 — 연결이면 점 1(title·sr-only "이메일로 저장 중"), 아니면 0. 부팅 GET /auth/session 1회(연결 기기만).
//   콜드 홈(동물 없음, 연결 없음) → 저장 진입점·점·네트워크 0.
import { act, render, screen, waitFor } from '@testing-library/react';
import { COPY } from '@ws/copy';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { emptyPageData } from '../app/pageData';
import { NO_CAPTURE } from '../app/staticCapture';
import { setTrackerForTest, type Tracker } from '../events/track';
import { layerStore } from '../ui/layer/useLayer';
import SaveDot from './SaveDot';
import { SAVE_STATE_KEY, writeSaveState } from './saveStateStore';
import { resetSaveSyncForTest } from './sync';
import { wsStorage } from '../lib/storage';

type Route = { status: number; body?: unknown };
let routes: Record<string, Route>;
let log: string[];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const key = `${init?.method ?? 'GET'} ${String(input)}`;
  log.push(key);
  const r = routes[key] ?? { status: 404 };
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? null } as unknown as Response;
});

const LINKED = JSON.stringify({ v: 1, linked: true, lastSyncAt: null });

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  routes = {
    'GET /auth/session': { status: 200, body: { linked: true } },
    'GET /api/save': { status: 200, body: { snapshot: null, updatedAt: null } },
    'PUT /api/save': { status: 204 },
  };
  log = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  const fake: Tracker = { track: () => undefined, flush: () => undefined, dispose: () => undefined };
  setTrackerForTest(fake);
});

afterEach(() => {
  act(() => layerStore.resetForTest());
  resetSaveSyncForTest();
  setTrackerForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dots = () => document.querySelectorAll('.ws-save-dot[data-ws-save-dot]');

describe('SaveDot', () => {
  it('연결 아님 → 점 0, 네트워크 0', async () => {
    render(
      <StrictMode>
        <SaveDot />
      </StrictMode>,
    );
    await act(async () => undefined);
    expect(dots()).toHaveLength(0);
    expect(log).toEqual([]);
  });

  it('연결 → 점 1(title·sr-only), StrictMode 에서도 GET /auth/session 1회 → GET /api/save', async () => {
    window.localStorage.setItem(SAVE_STATE_KEY, LINKED);
    render(
      <StrictMode>
        <SaveDot />
      </StrictMode>,
    );
    expect(dots()).toHaveLength(1);
    const dot = document.querySelector('[data-ws-save-dot]') as HTMLElement;
    expect(dot).toHaveAttribute('title', COPY.save.dotTitle);
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot.nextElementSibling).toHaveClass('ws-visually-hidden');
    expect(dot.nextElementSibling).toHaveTextContent(COPY.save.dotTitle);
    expect(document.querySelector('.ws-save-dot-wrap')).toBeNull();
    await waitFor(() => expect(log).toContain('GET /api/save'));
    expect(log.filter((k) => k === 'GET /auth/session')).toHaveLength(1);
  });

  it('서버 세션이 끊김(linked:false) → 로컬 해제, 점 사라짐', async () => {
    routes['GET /auth/session'] = { status: 200, body: { linked: false } };
    window.localStorage.setItem(SAVE_STATE_KEY, LINKED);
    render(<SaveDot />);
    expect(dots()).toHaveLength(1);
    await waitFor(() => expect(dots()).toHaveLength(0));
    expect(window.localStorage.getItem(SAVE_STATE_KEY)).toBeNull();
    expect(log).toEqual(['GET /auth/session']);
  });

  it('연결 상태가 바뀌면 점이 따라간다(같은 탭)', async () => {
    render(<SaveDot />);
    expect(dots()).toHaveLength(0);
    act(() => void writeSaveState(wsStorage, { linked: true, lastSyncAt: null }));
    expect(dots()).toHaveLength(1);
  });
});

describe('헤더 통합', () => {
  it('콜드 홈(동물·연결 없음) → 점 0, /save 링크 0, 네트워크 0', async () => {
    render(<App page={emptyPageData({ pathname: '/' })} captured={NO_CAPTURE} />);
    await act(async () => undefined);
    expect(dots()).toHaveLength(0);
    expect(document.querySelectorAll('a[href="/save"]')).toHaveLength(0);
    expect(screen.getByRole('main').textContent ?? '').not.toContain(COPY.homeB.saveLink);
    expect(log).toEqual([]);
  });

  it('연결된 기기 → 헤더 안에 점 1(칩 바로 뒤)', async () => {
    window.localStorage.setItem(SAVE_STATE_KEY, LINKED);
    render(<App page={emptyPageData({ pathname: '/' })} captured={NO_CAPTURE} />);
    const header = screen.getByRole('banner');
    expect(header.querySelectorAll('[data-ws-save-dot]')).toHaveLength(1);
    // DR m-4: 칩 안 이름 뒤, 칩 접근 이름에 "이메일로 저장 중" 포함. 점은 링크 자체가 아니라 칩의 일부(U2b: ▾ 없음 — R3·R4 시안).
    const chip = header.querySelector('a[data-ws-chip]') as HTMLElement;
    expect(chip.querySelector('.ws-chip-name + [data-ws-save-dot]')).not.toBeNull();
    expect(chip.querySelector('.ws-chip-caret')).toBeNull();
    expect(screen.getByRole('link', { name: new RegExp(COPY.save.dotTitle) })).toBe(chip);
    await waitFor(() => expect(log).toContain('GET /auth/session'));
  });
});
