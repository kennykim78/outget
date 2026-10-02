// 홈 A(F4): ① 섹션 순서 [hero, reviews?, intro, start] + 후기 사다리 0/2/4/8 + reduced-motion ② /save 링크 0 ③ 금지어 0.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { NO_CAPTURE } from '../app/staticCapture';
import { pageOf, testimonial } from '../test/fixtures';
import { layerStore } from '../ui/layer/useLayer';
import { reviewLadder } from './Reviews';

const BANNED = ['괜찮다', '안전하다', '최저가', '판매순', '베스트', '정확도', '회원가입', '구매', '세트'];

function mockMedia(matching: string[]): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: matching.some((m) => q.includes(m)),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function homeWith(n: number) {
  return pageOf('HOME', { testimonials: Array.from({ length: n }, (_, i) => testimonial(i + 1)) });
}

function sectionsOf(): string[] {
  const main = screen.getByRole('main');
  return Array.from(main.children)
    .filter((el) => el.tagName === 'SECTION')
    .map((el) => el.getAttribute('data-ws-section') ?? '');
}

beforeEach(() => {
  localStorage.clear();
  act(() => layerStore.resetForTest());
  mockMedia([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => layerStore.resetForTest());
});

describe('홈 A 섹션', () => {
  it('reviewLadder 경계: 0 none · 1–2 single · 3–5 rail · ≥6 marquee', () => {
    expect([0, 1, 2, 3, 5, 6, 8].map(reviewLadder)).toEqual(['none', 'single', 'single', 'rail', 'rail', 'marquee', 'marquee']);
  });

  it('후기 0: [hero, intro, start] — 후기 섹션 DOM 없음', () => {
    render(<App page={homeWith(0)} captured={NO_CAPTURE} />);
    expect(sectionsOf()).toEqual(['hero', 'intro', 'start']);
    expect(document.querySelector('[data-ws-section="reviews"]')).toBeNull();
  });

  it('후기 2: 정지 단일 / 4: 정지 레일 — 순서 [hero, reviews, intro, start], 별점 없음', () => {
    for (const [n, ladder] of [
      [2, 'single'],
      [4, 'rail'],
    ] as const) {
      const { unmount } = render(<App page={homeWith(n)} captured={NO_CAPTURE} />);
      expect(sectionsOf()).toEqual(['hero', 'reviews', 'intro', 'start']);
      const s = document.querySelector('[data-ws-section="reviews"]');
      expect(s).toHaveAttribute('data-ws-ladder', ladder);
      expect(s?.querySelectorAll('li[data-ws-id^="testimonials#"]')).toHaveLength(n);
      expect(s?.textContent ?? '').not.toMatch(/[★☆]|\d\/5/);
      unmount();
    }
  });

  it('후기 8: 마퀴 문구(copy)가 없거나 reduced-motion 이면 한 줄 수동 레일(정지가 기본)', () => {
    render(<App page={homeWith(8)} captured={NO_CAPTURE} />);
    const s = document.querySelector('[data-ws-section="reviews"]');
    expect(s?.getAttribute('data-ws-ladder')).toMatch(/^marquee/);
    expect(s?.querySelectorAll('li[data-ws-id^="testimonials#"]')).toHaveLength(8);
    // 원본 카드는 정확히 8장(복제 세트는 data-ws-id 없음).
  });

  it('reduced-motion: 애니메이션 트랙 없이 정지 레일', () => {
    mockMedia(['prefers-reduced-motion']);
    render(<App page={homeWith(8)} captured={NO_CAPTURE} />);
    const s = document.querySelector('[data-ws-section="reviews"]');
    expect(s).toHaveAttribute('data-ws-ladder', 'marquee-static');
    expect(s?.querySelector('.ws-marquee-track')).toBeNull();
  });

  it('히어로: h1·채운 CTA 1개(→ L1)·기능 칩 4(→ #ws-intro-i), 저장 타입 없으면 "이어서" 없음', () => {
    render(<App page={homeWith(0)} captured={NO_CAPTURE} />);
    const hero = document.querySelector('[data-ws-section="hero"]') as HTMLElement;
    expect(hero.querySelector('h1')).toHaveTextContent('작은 친구를 처음부터 제대로 준비해요');
    expect(hero.querySelectorAll('.ws-btn--fill')).toHaveLength(1);
    const chips = Array.from(hero.querySelectorAll('.ws-feature-chips a')).map((a) => a.getAttribute('href'));
    expect(chips).toEqual(['#ws-intro-1', '#ws-intro-2', '#ws-intro-3', '#ws-intro-4']);
    expect(hero.querySelector('.ws-continue')).toBeNull();
    fireEvent.click(hero.querySelector('.ws-btn--fill') as Element);
    expect(layerStore.get()?.kind).toBe('L1');
  });

  it('소개: 모바일 세로 4장 article#ws-intro-1..4(제목·본문), ≥1024 sticky 목록 aria-expanded 하나', () => {
    const { unmount } = render(<App page={homeWith(0)} captured={NO_CAPTURE} />);
    const ids = Array.from(document.querySelectorAll('[data-ws-section="intro"] article')).map((a) => a.id);
    expect(ids).toEqual(['ws-intro-1', 'ws-intro-2', 'ws-intro-3', 'ws-intro-4']);
    unmount();
    mockMedia(['min-width: 1024px']);
    render(<App page={homeWith(0)} captured={NO_CAPTURE} />);
    const intro = document.querySelector('[data-ws-section="intro"]') as HTMLElement;
    expect(intro).toHaveAttribute('data-ws-intro', 'sticky');
    const heads = Array.from(intro.querySelectorAll('button[aria-expanded]'));
    expect(heads).toHaveLength(4);
    expect(heads.filter((b) => b.getAttribute('aria-expanded') === 'true')).toHaveLength(1);
    fireEvent.click(heads[2]);
    expect(heads[2]).toHaveAttribute('aria-expanded', 'true');
    expect(heads[0]).toHaveAttribute('aria-expanded', 'false');
  });

  it('/save 링크 0 · 금지어 0 · 시작 배너 "가입 없이 바로 시작해요"', () => {
    const { container } = render(<App page={homeWith(8)} captured={NO_CAPTURE} />);
    expect(container.querySelector('a[href="/save"]')).toBeNull();
    const text = container.textContent ?? '';
    for (const w of BANNED) expect(text).not.toContain(w);
    expect(document.querySelector('[data-ws-section="start"]')).toHaveTextContent('가입 없이 바로 시작해요');
  });
});
