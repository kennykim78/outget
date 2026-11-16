// 후기 사다리(보존 컴포넌트, 홈 A 비노출 D6 — 286 U3a 에서 HomeA.test 의 사다리 단언을 컴포넌트 단위로 옮김).
//   0 none · 1–2 single · 3–5 rail · ≥6 marquee, 별점 없음, reduced-motion 이면 정지 레일. 제목은 " — " 분리(SplitTitle 내장).
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@ws/copy';
import { golden, testimonial } from '../test/fixtures';
import Reviews, { reviewLadder } from './Reviews';

function mockMedia(matching: string[]): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: matching.some((m) => q.includes(m)),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const list = (n: number) => Array.from({ length: n }, (_, i) => testimonial(i + 1));
const renderN = (n: number) => render(<Reviews testimonials={list(n)} types={[golden]} onAction={() => undefined} vetAvailable={false} />);

afterEach(() => vi.unstubAllGlobals());

describe('Reviews 사다리', () => {
  it('reviewLadder 경계: 0 none · 1–2 single · 3–5 rail · ≥6 marquee', () => {
    expect([0, 1, 2, 3, 5, 6, 8].map(reviewLadder)).toEqual(['none', 'single', 'single', 'rail', 'rail', 'marquee', 'marquee']);
  });

  it('0건이면 아무것도 그리지 않는다', () => {
    mockMedia([]);
    const { container } = renderN(0);
    expect(container.querySelector('[data-ws-section="reviews"]')).toBeNull();
  });

  it('2: 정지 단일 / 4: 정지 레일 — 카드 수 일치, 별점 없음, 제목 분리', () => {
    mockMedia([]);
    for (const [n, ladder] of [
      [2, 'single'],
      [4, 'rail'],
    ] as const) {
      const { unmount, container } = renderN(n);
      const s = container.querySelector('[data-ws-section="reviews"]');
      expect(s).toHaveAttribute('data-ws-ladder', ladder);
      expect(s?.querySelectorAll('li[data-ws-id^="testimonials#"]')).toHaveLength(n);
      expect(s?.textContent ?? '').not.toMatch(/[★☆]|\d\/5/);
      const [t, sub] = COPY.homeA.reviewsTitle.split(' — ');
      expect(s?.querySelector('.ws-split-title')).toHaveTextContent(t);
      expect(s?.querySelector('.ws-split-sub')).toHaveTextContent(sub);
      unmount();
    }
  });

  it('reduced-motion: 8건이어도 애니메이션 트랙 없이 정지 레일', () => {
    mockMedia(['prefers-reduced-motion']);
    const { container } = renderN(8);
    const s = container.querySelector('[data-ws-section="reviews"]');
    expect(s).toHaveAttribute('data-ws-ladder', 'marquee-static');
    expect(s?.querySelector('.ws-marquee-track')).toBeNull();
    expect(s?.querySelectorAll('li[data-ws-id^="testimonials#"]')).toHaveLength(8);
  });
});
