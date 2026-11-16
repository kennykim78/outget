// 셸 렌더 회귀(F3 · U2b) — 헤더(메뉴 3 + 칩/CTA + ≤767 메뉴 단추)·푸터(처리방침·크레딧 항상), 탭바 없음(D2), 금지어 0, 외부 호출 0(불변식 ①). AuthProvider 없이(D10).
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicAnimalType, WsPageData } from '@ws/engine';
import { COPY } from '@ws/copy';
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

  it('헤더(로고·메뉴 3·친구 선택하기 CTA·메뉴 단추), 푸터를 그린다, 탭바 없음 — 동물 없음', () => {
    render(<App page={emptyPageData({ pathname: '/' })} captured={NO_CAPTURE} />);
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'WithSmall' })).toHaveAttribute('href', '/');
    const chip = header.querySelector('a[data-ws-chip]');
    expect(chip).toHaveTextContent('친구 선택하기');
    expect(chip).toHaveClass('ws-btn', 'ws-btn--fill');
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    const nav = within(header).getByRole('navigation', { name: COPY.nav.menuLabel });
    expect(Array.from(nav.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['준비물', '/supplies'],
      ['크기 확인', '/pick'],
      ['병원', '/vet'],
      ['친구 선택하기', '/pick'],
    ]);
    expect(document.querySelector('.ws-tabbar, .ws-tab')).toBeNull();
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

  it('route.typeId 가 data.types 에 있으면 칩 = 이름(D1: CTA 자리, 아바타·▾ 없음 — R4 시안), 크기 확인 = 타입 기준', () => {
    render(<App page={page('TYPE', 'hamster-golden')} captured={NO_CAPTURE} />);
    const chip = document.querySelector('a[data-ws-chip]');
    expect(chip).toHaveTextContent('골든햄스터');
    expect(chip).toHaveClass('ws-chip--selected');
    expect(chip).not.toHaveClass('ws-btn--fill');
    expect(chip).toHaveAttribute('href', '/pick'); // K1: no-JS 대상 = /pick(하이드레이션 후 L1)
    expect(chip?.querySelector('img, .ws-avatar, .ws-chip-caret')).toBeNull();
    // 이 문서에 요구사항이 없으면 크기 확인 = 타입 홈(intent.ts 폴백, 서버 specCheckHref 와 같은 규칙).
    expect(document.querySelector('a[data-ws-nav="spec-check"]')).toHaveAttribute('href', '/hamster/golden');
  });

  it('저장된 타입(storedTypeId)도 data.types 안이면 쓰고, 밖이면 무시한다', () => {
    const { unmount } = render(<App page={page('VET')} captured={NO_CAPTURE} storedTypeId="hamster-golden" />);
    expect(document.querySelector('a[data-ws-chip]')).toHaveTextContent('골든햄스터');
    expect(within(screen.getByRole('banner')).getByRole('link', { name: '병원' })).toHaveAttribute('aria-current', 'page');
    unmount();
    render(<App page={page('VET')} captured={NO_CAPTURE} storedTypeId="unknown-type" />);
    expect(document.querySelector('a[data-ws-chip]')).toHaveTextContent('친구 선택');
  });

  it('localStorage ws.animalType(C-1)이 data.types 안이면 칩·크기 확인에 반영된다', () => {
    localStorage.setItem('ws.animalType', 'hamster-golden');
    render(<App page={page('HOME')} captured={NO_CAPTURE} />);
    expect(document.querySelector('a[data-ws-chip]')).toHaveTextContent('골든햄스터');
    expect(document.querySelector('a[data-ws-nav="spec-check"]')).toHaveAttribute('href', '/hamster/golden');
  });

  it('금지어 0', () => {
    const { container } = render(<App page={page('TYPE', 'hamster-golden')} captured={NO_CAPTURE} />);
    const text = container.textContent ?? '';
    for (const word of BANNED) expect(text).not.toContain(word);
  });
});
