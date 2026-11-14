// 홈 A(R3 시안 v1b, 286 U3a/U3b): ① 섹션 순서 [hero, starters, start] — 후기·소개 섹션 없음(후기가 ws-data 에 있어도 비노출, D6)
//   ② 히어로 = h1 + 부제 + 선택 바(a → /pick, 하이드레이션 후 L1) · 기능 칩 0 ③ 하단 CTA = 채운 버튼 1 ④ /save 링크 0 · 금지어 0
//   ⑤ 시작 카드 3(U3b): 노출 판정 fail-closed · 선택됨 = 대상 직행 링크 · 미선택 = L1 경유 의도 보존(intent.ts).
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@ws/copy';
import App from '../App';
import { nav } from '../animal/navigate';
import { runPickHandler } from '../animal/pickHandler';
import { NO_CAPTURE } from '../app/staticCapture';
import { bundle, golden, pageOf, req, testimonial } from '../test/fixtures';
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
  it('[hero, starters, start] — 후기·소개 섹션 DOM 없음(PC 폭에서도)', () => {
    for (const media of [[], ['min-width: 1024px']]) {
      mockMedia(media);
      const { unmount } = render(<App page={home()} captured={NO_CAPTURE} />);
      expect(sectionsOf()).toEqual(['hero', 'starters', 'start']);
      expect(document.querySelector('[data-ws-section="reviews"]')).toBeNull();
      expect(document.querySelector('[data-ws-section="intro"]')).toBeNull();
      unmount();
    }
  });

  it('D6: ws-data 에 후기가 실려 와도 홈에 그리지 않는다(후기 문구·data-ws-id 0)', () => {
    const list = Array.from({ length: 8 }, (_, i) => testimonial(i + 1));
    const { container } = render(<App page={home({ testimonials: list })} captured={NO_CAPTURE} />);
    expect(sectionsOf()).toEqual(['hero', 'starters', 'start']);
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
    // 접근 이름 유지(링크 역할). main 안에서 찾는다 — 헤더 CTA(U2b)도 같은 「친구 선택하기」.
    const main = screen.getByRole('main');
    expect(ctas.map((a) => within(main).getByRole('link', { name: a === ctas[0] ? COPY.homeA.heroBar : COPY.homeA.startCta }))).toEqual(ctas);
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
    fireEvent.click(d.querySelector('[data-ws-action="pick-group"]') as Element);
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

describe('홈 A 시작 카드(286 U3b)', () => {
  // 홈 ws-data 는 요구사항·구성안 없이 types[].specCheckItemId·setupAvailable 만 싣는다(서버 homeTypes).
  const full = () => pageOf('HOME', { types: [{ ...golden, specCheckItemId: 'cage-1', setupAvailable: true }] });
  const other = { ...golden, id: 'other', slug: 'other/x' };
  const TARGETS: ReadonlyArray<['CHECKLIST' | 'SPEC_CHECK' | 'SETUP', string]> = [
    ['CHECKLIST', '/hamster/golden'],
    ['SPEC_CHECK', '/hamster/golden/check/cage-1'],
    ['SETUP', '/hamster/golden/setup'],
  ];
  const card = (intent: string) =>
    document.querySelector(`[data-ws-section="starters"] a.ws-starter[data-ws-intent="${intent}"]`) as HTMLAnchorElement;
  const intents = () =>
    Array.from(document.querySelectorAll('[data-ws-section="starters"] a.ws-starter')).map((a) => a.getAttribute('data-ws-intent'));

  function pickGolden(): void {
    const d = screen.getByRole('dialog');
    fireEvent.click(d.querySelector(`[data-ws-group="${golden.group}"]`) as Element);
    fireEvent.click(d.querySelector('[data-ws-action="pick-group"]') as Element);
    fireEvent.click(screen.getByRole('dialog').querySelector(`[data-ws-type="${golden.id}"]`) as Element);
  }

  it('구조: kind=starter layout=grid3 · h2 고정 문구 · 카드 3(빈 사진 자리 + 제목 + 한 줄) · 채운 버튼·상태 칩·숫자·카드 속 카드 0', () => {
    render(<App page={full()} captured={NO_CAPTURE} />);
    const s = document.querySelector('[data-ws-section="starters"]') as HTMLElement;
    expect(s).toHaveClass('ws-rail-section', 'ws-rail-section--starter', 'ws-rail-section--grid3');
    expect(s.querySelector('h2')).toHaveTextContent(COPY.homeA.startersTitle);
    expect(s.querySelector('ul')).toHaveClass('ws-rail', 'ws-starters');
    expect(intents()).toEqual(['CHECKLIST', 'SPEC_CHECK', 'SETUP']);
    for (const [x] of TARGETS) {
      const a = card(x);
      expect(a.querySelector('.ws-starter-title')).toHaveTextContent(COPY.homeA.starters[x].title);
      expect(a.querySelector('.ws-starter-sub')).toHaveTextContent(COPY.homeA.starters[x].sub);
      // 사진 = 빈 자리표시(사용권 사진 없음 — 생성 이미지 금지 ①).
      expect(a.querySelector('span.ws-photo.ws-starter-photo[aria-hidden="true"]')).not.toBeNull();
      expect(a.querySelector('img')).toBeNull();
    }
    expect(s.querySelectorAll('.ws-btn--fill, .ws-chip, .ws-pill-chip, [data-ws-glyph]')).toHaveLength(0);
    expect(s.querySelectorAll('li li, a a')).toHaveLength(0);
    expect(s.textContent ?? '').not.toMatch(/\d/);
    for (const w of BANNED) expect(s.textContent ?? '').not.toContain(w);
    expect(document.querySelectorAll('main .ws-btn--fill')).toHaveLength(1);
  });

  it('fail-closed(D12 ①): 노출 타입 0 → 섹션 없음 · 규격 항목·구성안 없으면 해당 카드는 자리표시 없이 빠짐', () => {
    const { unmount } = render(<App page={pageOf('HOME', { types: [] })} captured={NO_CAPTURE} />);
    expect(sectionsOf()).toEqual(['hero', 'start']);
    unmount();
    render(<App page={home()} captured={NO_CAPTURE} />);
    expect(intents()).toEqual(['CHECKLIST']);
    expect(document.querySelectorAll('[data-ws-section="starters"] li')).toHaveLength(1);
  });

  it('미선택: 카드 href = /pick(정적과 같음) · data-ws-action=start-card, 수정 키·중클릭은 기본 동작', () => {
    render(<App page={full()} captured={NO_CAPTURE} />);
    for (const [x] of TARGETS) {
      const a = card(x);
      expect(a).toHaveAttribute('href', '/pick');
      expect(a).toHaveAttribute('data-ws-action', 'start-card');
      for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
        expect(fireEvent.click(a, mod)).toBe(true);
        expect(layerStore.get()).toBeNull();
      }
    }
  });

  it.each(TARGETS)('동물 선택됨: "%s" 카드 = %s 직행 링크, 눌러도 L1 안 열림', (intent, href) => {
    render(<App page={full()} captured={NO_CAPTURE} storedTypeId={golden.id} />);
    const a = card(intent);
    expect(a).toHaveAttribute('href', href);
    fireEvent.click(a);
    expect(layerStore.get()).toBeNull();
  });

  it.each(TARGETS)('미선택: "%s" → L1 열림, 선택하면 %s 로 정확히 1회 이동', (intent, href) => {
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => undefined);
    render(<App page={full()} captured={NO_CAPTURE} />);
    fireEvent.click(card(intent));
    expect(layerStore.get()?.kind).toBe('L1');
    expect(assign).not.toHaveBeenCalled();
    pickGolden();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(href);
    assign.mockRestore();
  });

  it('SPEC_CHECK: 고른 타입에 specCheckItemId·요구사항이 없으면 /{slug} 폴백(다른 타입이 카드를 열어 둔 경우)', () => {
    render(<App page={pageOf('HOME', { types: [golden, { ...other, specCheckItemId: 'wheel-1' }] })} captured={NO_CAPTURE} storedTypeId={golden.id} />);
    expect(card('SPEC_CHECK')).toHaveAttribute('href', '/hamster/golden');
  });

  it('SPEC_CHECK: 요구사항이 실린 문서는 규격 필드가 있는 첫 요구사항으로(타입 데이터 폴백)', () => {
    const r = req('cage-2', 'REQUIRED');
    const specReq = { ...r, item: { ...r.item, specSchema: { fields: [{ key: 'w' }] } } } as unknown as typeof r;
    render(
      <App
        page={pageOf('HOME', { types: [golden, { ...other, specCheckItemId: 'wheel-1' }], requirements: [specReq] })}
        captured={NO_CAPTURE}
        storedTypeId={golden.id}
      />,
    );
    expect(card('SPEC_CHECK')).toHaveAttribute('href', '/hamster/golden/check/cage-2');
  });

  it('SETUP: 고른 타입에 setupAvailable 이 없으면 /{slug} 폴백(404 대신), 문서에 구성안이 실렸으면 /setup', () => {
    const types = [golden, { ...other, setupAvailable: true as const }];
    const { unmount } = render(<App page={pageOf('HOME', { types })} captured={NO_CAPTURE} storedTypeId={golden.id} />);
    expect(card('SETUP')).toHaveAttribute('href', '/hamster/golden');
    unmount();
    // 구성안이 실린 문서의 타입이 고른 타입과 다르면(다른 타입의 구성안) /setup 으로 보내지 않는다.
    const second = render(<App page={pageOf('HOME', { types, bundles: [bundle('b1', 'BUDGET', [])] }, { typeId: 'other' })} captured={NO_CAPTURE} storedTypeId={golden.id} />);
    expect(card('SETUP')).toHaveAttribute('href', '/hamster/golden');
    second.unmount();
    render(<App page={pageOf('HOME', { types, bundles: [bundle('b1', 'BUDGET', [])] }, { typeId: golden.id })} captured={NO_CAPTURE} storedTypeId={golden.id} />);
    expect(card('SETUP')).toHaveAttribute('href', '/hamster/golden/setup');
  });

  it('미선택: L1 을 선택 없이 닫으면 의도 폐기·핸들러 해제 — 이후 선택은 기본 이동(typeHome)', () => {
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => undefined);
    render(<App page={full()} captured={NO_CAPTURE} />);
    fireEvent.click(card('SETUP'));
    expect(layerStore.get()?.kind).toBe('L1');
    act(() => layerStore.resetForTest());
    expect(assign).not.toHaveBeenCalled();
    expect(runPickHandler(golden, 'picker')).toBe(false);
    assign.mockRestore();
  });

  it('언마운트 시 핸들러 해제', () => {
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => undefined);
    const { unmount } = render(<App page={full()} captured={NO_CAPTURE} />);
    fireEvent.click(card('SETUP'));
    unmount();
    expect(runPickHandler(golden, 'picker')).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it('의도 없이 L1 에서 선택(히어로 선택 바) → 카드가 있어도 기본 이동(typeHome) 정확히 1회', () => {
    const assign = vi.spyOn(nav, 'assign').mockImplementation(() => undefined);
    render(<App page={full()} captured={NO_CAPTURE} />);
    fireEvent.click(document.querySelector('[data-ws-section="hero"] a.ws-pick-bar') as Element);
    pickGolden();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/hamster/golden');
    assign.mockRestore();
  });
});
