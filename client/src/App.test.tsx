// 셸 렌더 회귀(F3) — 헤더·푸터(크레딧 링크 항상)·탭바, 금지어 0, 외부 호출 0(불변식 ①). AuthProvider 없이(D10).
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicAnimalType, WsPageData } from '@ws/engine';
import App from './App';
import { emptyPageData } from './app/pageData';
import { NO_CAPTURE } from './app/staticCapture';

const BANNED = ['괜찮다', '안전하다', '최저가', '판매순', '베스트', '정확도', '회원가입', '구매'];

const golden: PublicAnimalType = {
  id: 'hamster-golden',
  slug: 'hamster/golden',
  group: 'SMALL_MAMMAL',
  displayName: '골든햄스터',
  aliases: ['시리안햄스터'],
  oneLiner: null,
  mascot: 'hamster-golden',
  careProfileId: 'cp-syrian',
  review: { verifiedAt: '2026-09-01', reviewerType: 'EXPERIENCED_KEEPER' },
};

function page(kind: WsPageData['route']['kind'], typeId?: string): WsPageData {
  const p = emptyPageData({ pathname: '/' });
  return { ...p, route: { kind, path: '/x', ...(typeId ? { typeId } : {}) }, data: { ...p.data, types: [golden] } };
}

describe('App shell', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network disabled in test'))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('헤더(로고·친구 선택 칩·메뉴), 푸터, 탭바를 그린다 — 동물 없음', () => {
    render(<App page={emptyPageData({ pathname: '/' })} captured={NO_CAPTURE} />);
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'WithSmall' })).toHaveAttribute('href', '/');
    const chip = header.querySelector('a[data-ws-chip]');
    expect(chip).toHaveTextContent('친구 선택');
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    expect(within(header).getByRole('link', { name: '용품 찾기' })).toHaveAttribute('href', '/supplies');
    expect(within(header).getByRole('link', { name: '병원' })).toHaveAttribute('href', '/vet');
    expect(document.querySelector('nav.ws-tabbar a.ws-tab')).toHaveAttribute('href', '/');
    expect(screen.getByRole('main')).toHaveAttribute('data-ws-route', 'HOME');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('푸터에 /credits 링크가 항상 있다(F3 ④)', () => {
    for (const p of [emptyPageData({ pathname: '/' }), page('NOT_FOUND'), page('TYPE', 'hamster-golden')]) {
      const { unmount } = render(<App page={p} captured={NO_CAPTURE} />);
      const footer = screen.getByRole('contentinfo');
      expect(footer.querySelector('a[href="/credits"]')).not.toBeNull();
      unmount();
    }
  });

  it('route.typeId 가 data.types 에 있으면 칩에 이름, 탭 홈은 /{slug}, 현재 메뉴 표시', () => {
    render(<App page={page('TYPE', 'hamster-golden')} captured={NO_CAPTURE} />);
    const chip = document.querySelector('a[data-ws-chip]');
    expect(chip).toHaveTextContent('골든햄스터');
    expect(chip).toHaveAttribute('href', '/hamster/golden');
    expect(chip?.querySelector('img')).toHaveAttribute('src', '/mascots/hamster-golden.svg');
    const home = document.querySelector('nav.ws-tabbar a.ws-tab');
    expect(home).toHaveAttribute('href', '/hamster/golden');
    expect(home).toHaveAttribute('aria-current', 'page');
  });

  it('저장된 타입(storedTypeId)도 data.types 안이면 쓰고, 밖이면 무시한다', () => {
    const { unmount } = render(<App page={page('VET')} captured={NO_CAPTURE} storedTypeId="hamster-golden" />);
    expect(document.querySelector('a[data-ws-chip]')).toHaveTextContent('골든햄스터');
    expect(within(screen.getByRole('banner')).getByRole('link', { name: '병원' })).toHaveAttribute('aria-current', 'page');
    unmount();
    render(<App page={page('VET')} captured={NO_CAPTURE} storedTypeId="unknown-type" />);
    expect(document.querySelector('a[data-ws-chip]')).toHaveTextContent('친구 선택');
  });

  it('localStorage ws.animalType(C-1)이 data.types 안이면 칩·탭 홈에 반영된다', () => {
    localStorage.setItem('ws.animalType', 'hamster-golden');
    render(<App page={page('HOME')} captured={NO_CAPTURE} />);
    expect(document.querySelector('a[data-ws-chip]')).toHaveTextContent('골든햄스터');
    expect(document.querySelector('nav.ws-tabbar a.ws-tab')).toHaveAttribute('href', '/hamster/golden');
  });

  it('탭바 아이콘 = 보드 SVG(viewBox 24, stroke 2, 22px, 장식) — 26 F7', () => {
    render(<App page={page('HOME')} captured={NO_CAPTURE} />);
    const svgs = Array.from(document.querySelectorAll('nav.ws-tabbar svg.ws-tab-icon'));
    expect(svgs).toHaveLength(3);
    for (const s of svgs) {
      expect(s).toHaveAttribute('viewBox', '0 0 24 24');
      expect(s).toHaveAttribute('stroke-width', '2');
      expect(s).toHaveAttribute('width', '22');
      expect(s).toHaveAttribute('aria-hidden', 'true');
    }
    expect(svgs[0].querySelector('path')).toHaveAttribute('d', 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z');
    expect(svgs[1].querySelector('rect')).toHaveAttribute('rx', '3');
    expect(svgs[2].querySelector('circle')).toHaveAttribute('r', '2.5');
  });

  it('금지어 0', () => {
    const { container } = render(<App page={page('TYPE', 'hamster-golden')} captured={NO_CAPTURE} />);
    const text = container.textContent ?? '';
    for (const word of BANNED) expect(text).not.toContain(word);
  });
});
