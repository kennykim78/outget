// 홈 A(R3 시안 v1b, 286 U3a): ① 섹션 순서 [hero, start] — 후기·소개 섹션 없음(후기가 ws-data 에 있어도 비노출, D6)
//   ② 히어로 = h1 + 부제 + 선택 바(a → /pick, 하이드레이션 후 L1) · 기능 칩 0 ③ 하단 CTA = 채운 버튼 1 ④ /save 링크 0 · 금지어 0.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@ws/copy';
import App from '../App';
import { nav } from '../animal/navigate';
import { NO_CAPTURE } from '../app/staticCapture';
import { golden, pageOf, testimonial } from '../test/fixtures';
import { layerStore } from '../ui/layer/useLayer';

const BANNED = ['괜찮다', '안전하다', '최저가', '판매순', '베스트', '정확도', '회원가입', '구매', '세트'];

function mockMedia(matching: string[]): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: matching.some((m) => q.includes(m)),
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const home = (over: Parameters<typeof pageOf>[1] = {}) => pageOf('HOME', over);

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
  it('[hero, start] — 후기·소개 섹션 DOM 없음(PC 폭에서도)', () => {
    for (const media of [[], ['min-width: 1024px']]) {
      mockMedia(media);
      const { unmount } = render(<App page={home()} captured={NO_CAPTURE} />);
      expect(sectionsOf()).toEqual(['hero', 'start']);
      expect(document.querySelector('[data-ws-section="reviews"]')).toBeNull();
      expect(document.querySelector('[data-ws-section="intro"]')).toBeNull();
      unmount();
    }
  });

  it('D6: ws-data 에 후기가 실려 와도 홈에 그리지 않는다(후기 문구·data-ws-id 0)', () => {
    const list = Array.from({ length: 8 }, (_, i) => testimonial(i + 1));
    const { container } = render(<App page={home({ testimonials: list })} captured={NO_CAPTURE} />);
    expect(sectionsOf()).toEqual(['hero', 'start']);
    expect(container.querySelector('[data-ws-id^="testimonials#"]')).toBeNull();
    for (const t of list) expect(container.textContent ?? '').not.toContain(t.quote);
  });

  it('히어로: h1 + 부제 + 선택 바(a[href=/pick], 입력 아님) — 기능 칩·채운 버튼 0, 저장 타입 없으면 "이어서" 없음', () => {
    render(<App page={home()} captured={NO_CAPTURE} />);
    const hero = document.querySelector('[data-ws-section="hero"]') as HTMLElement;
    expect(hero.querySelector('h1')).toHaveTextContent(COPY.homeA.heroTitle);
    expect(hero.querySelector('.ws-hero-sub')).toHaveTextContent(COPY.homeA.heroSub);
    expect(hero.querySelectorAll('input, textarea, [role="searchbox"], [role="combobox"]')).toHaveLength(0);
    expect(hero.querySelector('.ws-feature-chips')).toBeNull();
    expect(hero.querySelectorAll('.ws-btn--fill')).toHaveLength(0);
    const bar = hero.querySelector('a.ws-pick-bar') as HTMLAnchorElement;
    expect(bar).toHaveAttribute('href', '/pick');
    expect(bar).toHaveAttribute('data-ws-action', 'pick-animal');
    expect(bar).toHaveAccessibleName(COPY.homeA.heroBar);
    expect(hero.querySelector('.ws-continue')).toBeNull();
    fireEvent.click(bar);
    expect(layerStore.get()?.kind).toBe('L1');
  });

  it('히어로 "이어서": 저장 타입이 있으면 타입 홈 링크(자동 이동 없음)', () => {
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => undefined);
    render(<App page={home()} captured={NO_CAPTURE} storedTypeId={golden.id} />);
    const cont = document.querySelector('[data-ws-section="hero"] a.ws-continue');
    expect(cont).toHaveAttribute('href', '/hamster/golden');
    expect(cont).toHaveTextContent(golden.displayName);
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it('하단 CTA: 제목 + 한 줄 + 채운 버튼 1(친구 선택하기 → L1) — 화면 전체 채운 CTA 정확히 1개', () => {
    render(<App page={home()} captured={NO_CAPTURE} />);
    const start = document.querySelector('[data-ws-section="start"]') as HTMLElement;
    expect(start.querySelector('h2#ws-start-title')).toHaveTextContent(COPY.homeA.startTitle);
    expect(start).toHaveTextContent(COPY.homeA.startBody);
    expect(document.querySelectorAll('main .ws-btn--fill')).toHaveLength(1);
    const btn = start.querySelector('a.ws-btn--fill') as HTMLAnchorElement;
    expect(btn).toHaveTextContent(COPY.homeA.startCta);
    fireEvent.click(btn);
    expect(layerStore.get()?.kind).toBe('L1');
  });

  it('K1: 친구 선택 링크 2개 = a[data-ws-action=pick-animal][href="/pick"] — 일반 클릭 L1(defaultPrevented), 수정 키·중클릭은 기본 동작', () => {
    render(<App page={home()} captured={NO_CAPTURE} />);
    const ctas = Array.from(document.querySelectorAll('main a[data-ws-action="pick-animal"][href="/pick"]'));
    expect(ctas).toHaveLength(2);
    expect(document.querySelectorAll('main button[data-ws-action="pick-animal"]')).toHaveLength(0);
    // 접근 이름 유지(링크 역할).
    expect(ctas.map((a) => screen.getByRole('link', { name: a === ctas[0] ? COPY.homeA.heroBar : COPY.homeA.startCta }))).toEqual(ctas);
    for (const a of ctas) {
      for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        expect(fireEvent.click(a, mod)).toBe(true); // defaultPrevented=false
        expect(layerStore.get()).toBeNull();
      }
      let ev: MouseEvent | null = null;
      a.addEventListener('click', (e) => (ev = e as MouseEvent), { once: true });
      act(() => {
        fireEvent.click(a);
      });
      expect(ev).not.toBeNull();
      expect((ev as unknown as MouseEvent).defaultPrevented).toBe(true);
      expect(layerStore.get()?.kind).toBe('L1');
      act(() => layerStore.resetForTest());
    }
  });

  it('L1 에서 선택(히어로 선택 바) → 기본 이동(typeHome) 정확히 1회', () => {
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => undefined);
    render(<App page={home()} captured={NO_CAPTURE} />);
    fireEvent.click(document.querySelector('[data-ws-section="hero"] a.ws-pick-bar') as Element);
    const d = screen.getByRole('dialog');
    fireEvent.click(d.querySelector(`[data-ws-group="${golden.group}"]`) as Element);
    fireEvent.click(screen.getByRole('dialog').querySelector(`[data-ws-type="${golden.id}"]`) as Element);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/hamster/golden');
    assign.mockRestore();
  });

  it('/save 링크 0 · 금지어 0', () => {
    const { container } = render(<App page={home({ testimonials: [testimonial(1)] })} captured={NO_CAPTURE} />);
    expect(container.querySelector('a[href="/save"]')).toBeNull();
    const text = container.textContent ?? '';
    for (const w of BANNED) expect(text).not.toContain(w);
  });
});
