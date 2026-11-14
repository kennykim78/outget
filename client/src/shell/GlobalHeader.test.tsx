// shell/GlobalHeader(U2b · Kenny D1·D2·D3 2026-11-14)
//   ① 건너뛰기 링크(WCAG 2.4.1) ② 메뉴 3 라벨·금지어 0 ③ ≤767 메뉴 단추 a11y — aria-expanded·aria-controls, 열면 첫 링크 포커스,
//   Esc = 닫고 단추 복귀, 헤더 밖 포커스 = 닫힘 ④ 「크기 확인」: 미선택 = /pick + L1 경유 의도(골라도 L5 대상으로 1회 이동),
//   선택 = 타입 기준 L5 경로(ws-data 의 specCheckItemId → 요구사항 → 타입 홈) ⑤ 칩/크기 확인으로 레이어를 열면 메뉴는 닫히고 포커스는 단추.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@ws/copy';
import App from '../App';
import { nav } from '../animal/navigate';
import { NO_CAPTURE } from '../app/staticCapture';
import { golden, pageOf, req } from '../test/fixtures';
import { layerStore } from '../ui/layer/useLayer';
import GlobalHeader, { NAV_ID } from './GlobalHeader';

const BANNED = ['괜찮다', '안전하다', '최저가', '판매순', '베스트', '정확도', '회원가입', '구매'];

beforeEach(() => {
  localStorage.clear();
  act(() => layerStore.resetForTest());
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => layerStore.resetForTest());
});

const home = () => pageOf('HOME', { types: [{ ...golden, specCheckItemId: 'cage-1' }] });
const menuBtn = () => within(screen.getByRole('banner')).getByRole('button', { name: COPY.nav.menu });
const specLink = () => document.querySelector('a[data-ws-nav="spec-check"]') as HTMLAnchorElement;

describe('GlobalHeader 건너뛰기 링크', () => {
  it('header 첫 a = .ws-skip-link[href=#main], 라벨은 COPY.nav.skipToMain', () => {
    render(
      <GlobalHeader type={null} current={null} page={pageOf('HOME')} chipExpanded={false} onChipOpen={() => {}} onSpecCheckIntent={() => {}} />,
    );
    const header = screen.getByRole('banner');
    const first = header.querySelector('a');
    expect(first).toHaveClass('ws-skip-link');
    expect(first).toHaveAttribute('href', '#main');
    expect(within(header).getByRole('link', { name: COPY.nav.skipToMain })).toBe(first);
  });
});

describe('GlobalHeader 메뉴(U2b)', () => {
  it('메뉴 3 = 준비물·크기 확인·병원(시안 순서) + 칩, 현재 메뉴 aria-current, 금지어 0', () => {
    render(<App page={pageOf('VET')} captured={NO_CAPTURE} />);
    const navEl = screen.getByRole('navigation', { name: COPY.nav.menuLabel });
    expect(navEl.id).toBe(NAV_ID);
    const links = Array.from(navEl.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual([COPY.nav.menuSupplies, COPY.nav.menuSpecCheck, COPY.nav.vet, COPY.nav.chooseFriend]);
    expect(links[2]).toHaveAttribute('aria-current', 'page');
    expect(links.filter((a) => a.hasAttribute('aria-current'))).toHaveLength(1);
    const text = screen.getByRole('banner').textContent ?? '';
    for (const w of BANNED) expect(text).not.toContain(w);
  });

  it('메뉴 단추: aria-controls=nav id · aria-expanded 토글 · 열면 첫 메뉴 링크로 포커스 · Esc = 닫고 단추로 복귀', () => {
    render(<App page={home()} captured={NO_CAPTURE} />);
    const btn = menuBtn();
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveAttribute('aria-controls', NAV_ID);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    btn.focus();
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toHaveTextContent(COPY.nav.menuSupplies);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('헤더 밖으로 포커스가 나가면 닫힘(포커스는 빼앗지 않음), 헤더 안 이동은 유지 — 포커스 트랩 없음(모달 아님)', () => {
    render(<App page={home()} captured={NO_CAPTURE} />);
    const btn = menuBtn();
    fireEvent.click(btn);
    const first = document.activeElement as HTMLElement;
    fireEvent.blur(first, { relatedTarget: btn });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    const outside = screen.getByRole('main').querySelector('a') as HTMLElement;
    fireEvent.blur(first, { relatedTarget: outside });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('미선택 「크기 확인」: href=/pick · 일반 클릭 = 메뉴 닫힘 + L1, 동물을 고르면 L5 대상으로 정확히 1회 이동', () => {
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => undefined);
    render(<App page={home()} captured={NO_CAPTURE} />);
    const btn = menuBtn();
    fireEvent.click(btn);
    expect(specLink()).toHaveAttribute('href', '/pick');
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      expect(fireEvent.click(specLink(), mod)).toBe(true);
      expect(layerStore.get()).toBeNull();
    }
    act(() => {
      fireEvent.click(specLink());
    });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(layerStore.get()?.kind).toBe('L1');
    const d = screen.getByRole('dialog');
    fireEvent.click(d.querySelector(`[data-ws-group="${golden.group}"]`) as Element);
    fireEvent.click(d.querySelector('[data-ws-action="pick-group"]') as Element);
    fireEvent.click(screen.getByRole('dialog').querySelector(`[data-ws-type="${golden.id}"]`) as Element);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/hamster/golden/check/cage-1');
  });

  it('L1 이 선택 없이 닫히면 의도를 버린다(다음 선택은 기본 이동)', () => {
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => undefined);
    render(<App page={home()} captured={NO_CAPTURE} />);
    act(() => {
      fireEvent.click(specLink());
    });
    expect(layerStore.get()?.kind).toBe('L1');
    act(() => layerStore.resetForTest());
    act(() => {
      fireEvent.click(document.querySelector('a[data-ws-chip]') as Element);
    });
    const d = screen.getByRole('dialog');
    fireEvent.click(d.querySelector(`[data-ws-group="${golden.group}"]`) as Element);
    fireEvent.click(d.querySelector('[data-ws-action="pick-group"]') as Element);
    fireEvent.click(screen.getByRole('dialog').querySelector(`[data-ws-type="${golden.id}"]`) as Element);
    expect(assign).not.toHaveBeenCalledWith('/hamster/golden/check/cage-1');
  });

  it('선택 「크기 확인」: ws-data specCheckItemId → 요구사항(규격 필드 첫 항목) → 타입 홈 순, 눌러도 L1 안 열림', () => {
    const { unmount } = render(<App page={home()} captured={NO_CAPTURE} storedTypeId={golden.id} />);
    expect(specLink()).toHaveAttribute('href', '/hamster/golden/check/cage-1');
    unmount();
    const noSpec = req('bowl', 'REQUIRED');
    const base = req('cage-2', 'REQUIRED');
    const withSpec = { ...base, item: { ...base.item, specSchema: { fields: [{ key: 'floorWcm', label: '바닥 가로', type: 'number', min: 1, max: 500 }] } } } as typeof base;
    const typePage = pageOf('TYPE', { requirements: [noSpec, withSpec] }, { typeId: golden.id, path: '/hamster/golden' });
    const second = render(<App page={typePage} captured={NO_CAPTURE} />);
    expect(specLink()).toHaveAttribute('href', '/hamster/golden/check/cage-2');
    second.unmount();
    render(<App page={pageOf('VET')} captured={NO_CAPTURE} storedTypeId={golden.id} />);
    expect(specLink()).toHaveAttribute('href', '/hamster/golden');
    expect(layerStore.get()).toBeNull();
  });

  it('메뉴에서 칩으로 L1 을 열면 메뉴는 닫히고 포커스는 메뉴 단추(레이어 닫힘 뒤 복귀 대상)', () => {
    render(<App page={home()} captured={NO_CAPTURE} />);
    const btn = menuBtn();
    fireEvent.click(btn);
    act(() => {
      fireEvent.click(document.querySelector('a[data-ws-chip]') as Element);
    });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(layerStore.get()?.kind).toBe('L1');
  });
});
