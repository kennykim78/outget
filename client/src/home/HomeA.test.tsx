// 홈 A(R3 시안 v1b, 286 U3a~U3e): ① 섹션 순서 [hero, starters, (설명 섹션), start] — 후기·소개 섹션 없음(후기가 ws-data 에 있어도 비노출, D6)
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
  it('[hero, starters, habitats, vet-split, start](homeExplain 없음) — 후기·소개 섹션 DOM 없음(PC 폭에서도)', () => {
    for (const media of [[], ['min-width: 1024px']]) {
      mockMedia(media);
      const { unmount } = render(<App page={home()} captured={NO_CAPTURE} />);
      expect(sectionsOf()).toEqual(['hero', 'starters', 'habitats', 'vet-split', 'start']);
      expect(document.querySelector('[data-ws-section="reviews"]')).toBeNull();
      expect(document.querySelector('[data-ws-section="intro"]')).toBeNull();
      unmount();
    }
  });

  it('D6: ws-data 에 후기가 실려 와도 홈에 그리지 않는다(후기 문구·data-ws-id 0)', () => {
    const list = Array.from({ length: 8 }, (_, i) => testimonial(i + 1));
    const { container } = render(<App page={home({ testimonials: list })} captured={NO_CAPTURE} />);
    expect(sectionsOf()).toEqual(['hero', 'starters', 'habitats', 'vet-split', 'start']);
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

// 286 U3c·U3d·U3e — 설명 섹션. 데이터는 ws-data types[0].homeExplain(서버 엔진 homeAExplainOf 결과)·types·vets 그대로.
//   아래 이름·숫자는 화면 하드코딩이 아니라 합성 ws-data 값이다(바꾸면 화면이 따라 바뀌는지 본다).
describe('홈 A 설명 섹션(286 U3c·U3d·U3e)', () => {
  const explain = {
    figures: [
      { requirementId: 'r-cage', itemId: 'cage-x', itemName: '합성케이지', values: [91, 41, 31], unit: 'cm', base: null },
      { requirementId: 'r-wheel', itemId: 'wheel-x', itemName: '합성바퀴', values: [23], unit: 'cm', base: '지름' },
    ],
    need: [
      { requirementId: 'r-cage', name: '합성케이지' },
      { requirementId: 'r-bed', name: '합성베딩' },
    ],
    notNow: [{ requirementId: 'r-later', name: '합성나중' }],
  };
  const vet = { id: 'v1', name: '합성병원', address: '합성주소', phone: '000', region: '합성구', treats: [golden.id], night: null, emergency: null, lat: 1, lng: 2, verifiedAt: null };
  const full = (over: Parameters<typeof pageOf>[1] = {}) => home({ types: [{ ...golden, homeExplain: explain }], ...over });

  it('섹션 순서 = R3 시안 v1b(필요/불필요 → 숫자 → 함께 살 집 → 병원)', () => {
    render(<App page={full()} captured={NO_CAPTURE} />);
    expect(sectionsOf()).toEqual(['hero', 'starters', 'need-split', 'figures', 'habitats', 'vet-split', 'start']);
  });

  it('노출 타입 0 → 설명 섹션 0(D12 ①)', () => {
    render(<App page={home({ types: [] })} captured={NO_CAPTURE} />);
    expect(sectionsOf()).toEqual(['hero', 'start']);
  });

  it('숫자 = homeExplain.figures 값 그대로(이름 + 숫자 + 「cm 이상」), 링크 → 첫 행 L5 문서', () => {
    render(<App page={full()} captured={NO_CAPTURE} />);
    const sec = document.querySelector('[data-ws-section="figures"]') as HTMLElement;
    const rows = Array.from(sec.querySelectorAll('li.ws-figure')).map((li) => [
      li.getAttribute('data-ws-id'),
      li.querySelector('.ws-figure-label')?.textContent,
      li.querySelector('.ws-figure-value')?.textContent,
      li.querySelector('.ws-figure-unit')?.textContent,
    ]);
    expect(rows).toEqual([
      ['supplyRequirements#r-cage', '합성케이지', '91×41×31', 'cm 이상'],
      ['supplyRequirements#r-wheel', '합성바퀴 지름', '23', 'cm 이상'],
    ]);
    expect(within(sec).getByText(COPY.homeA.figuresEyebrow.replace('{animal}', golden.displayName))).toBeInTheDocument();
    expect(sec.querySelector('a.ws-home-link')).toHaveAttribute('href', '/hamster/golden/check/cage-x');
  });

  it('필요해요 / 지금은 필요 없어요 = homeExplain.need·notNow 이름 그대로, 한 열이라도 비면 섹션 없음', () => {
    const { unmount } = render(<App page={full()} captured={NO_CAPTURE} />);
    const sec = document.querySelector('[data-ws-section="need-split"]') as HTMLElement;
    const col = (k: string) => Array.from(sec.querySelectorAll(`[data-ws-col="${k}"] li`)).map((li) => li.textContent);
    expect(col('need')).toEqual(['합성케이지', '합성베딩']);
    expect(col('not-now')).toEqual(['합성나중']);
    expect(sec.querySelector('a.ws-home-link')).toHaveAttribute('href', '/hamster/golden');
    unmount();
    render(<App page={home({ types: [{ ...golden, homeExplain: { ...explain, need: [], notNow: [] } }] })} captured={NO_CAPTURE} />);
    expect(document.querySelector('[data-ws-section="need-split"]')).toBeNull();
    expect(document.querySelector('[data-ws-section="figures"]')).not.toBeNull();
  });

  it('함께 살 집 = 노출 타입 카드(→ 타입 홈) + oneLiner, 버튼·채운 CTA 0', () => {
    render(<App page={full()} captured={NO_CAPTURE} />);
    const sec = document.querySelector('[data-ws-section="habitats"]') as HTMLElement;
    const links = Array.from(sec.querySelectorAll('a.ws-habitat')).map((x) => [x.getAttribute('href'), x.getAttribute('data-ws-id')]);
    expect(links).toEqual([['/hamster/golden', `animalTypes#${golden.id}`]]);
    expect(sec).toHaveTextContent(golden.oneLiner as string);
    expect(sec.querySelectorAll('button, .ws-btn--fill')).toHaveLength(0);
  });

  it('병원 = 그룹별 진료 타입 집계(이름·주소·전화 0), 0곳이면 「확인된 병원이 아직 없어요」', () => {
    const { unmount } = render(<App page={full({ vets: [vet] })} captured={NO_CAPTURE} />);
    let sec = document.querySelector('[data-ws-section="vet-split"]') as HTMLElement;
    const row = sec.querySelector('li[data-ws-group="SMALL_MAMMAL"]') as HTMLElement;
    expect(row.querySelector('.ws-vet-row-name')).toHaveTextContent(COPY.homeA.vetRow.replace('{name}', COPY.groups.SMALL_MAMMAL));
    expect(row.querySelector('.ws-vet-row-types')).toHaveTextContent(golden.displayName);
    for (const x of [vet.name, vet.address, vet.region]) expect(sec.textContent ?? '').not.toContain(x);
    expect(sec.querySelector('img, iframe')).toBeNull();
    expect(sec.querySelector('a.ws-home-link')).toHaveAttribute('href', '/vet');
    unmount();
    render(<App page={full({ vets: [{ ...vet, treats: ['not-exposed'] }] })} captured={NO_CAPTURE} />);
    sec = document.querySelector('[data-ws-section="vet-split"]') as HTMLElement;
    expect(sec.querySelector('li[data-ws-group]')).toBeNull();
    expect(sec).toHaveTextContent(COPY.homeB.vetEmpty);
  });

  it('287 S4: 합성 PARROT 타입 노출 + 그 타입 진료 병원 → 병원 행 이름 「조류 진료 병원」, 같은 페이지 L1 그룹 머리도 「조류」', () => {
    // 합성 시드(실제 데이터 아님, 앵무새 사실 창작 없음 — 그룹·표시명만).
    const parrot = { ...golden, id: 'fixture-parrot', slug: 'parrot/fixture', group: 'PARROT' as const, displayName: '픽스처앵무', aliases: [], careProfileId: 'cp-fixture-parrot' };
    const pVet = { ...vet, id: 'v2', treats: [parrot.id] };
    render(<App page={home({ types: [{ ...golden, homeExplain: explain }, parrot], vets: [vet, pVet] })} captured={NO_CAPTURE} />);
    const sec = document.querySelector('[data-ws-section="vet-split"]') as HTMLElement;
    const row = sec.querySelector('li[data-ws-group="PARROT"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(COPY.groups.PARROT).toBe('조류');
    expect('vetGroups' in COPY.homeA).toBe(false);
    expect(row.querySelector('.ws-vet-row-name')?.textContent).toBe('조류 진료 병원');
    expect(row.querySelector('.ws-vet-row-types')).toHaveTextContent(parrot.displayName);
    expect(sec.querySelector('li[data-ws-group="SMALL_MAMMAL"] .ws-vet-row-name')?.textContent).toBe('소동물 진료 병원');
    expect(sec.textContent ?? '').not.toContain('앵무새');
    // L1(AnimalPicker) 그룹 머리도 같은 키 COPY.groups 「조류」(ORDERS 11/16 O3).
    fireEvent.click(document.querySelector('[data-ws-section="hero"] a.ws-pick-bar') as Element);
    const d = screen.getByRole('dialog');
    const head = d.querySelector('[data-ws-group="PARROT"] [data-ws-name]') as HTMLElement;
    expect(head.textContent).toBe('조류');
    expect(d.textContent ?? '').not.toContain('앵무새');
  });

  // 359 T17(감사 356r M2): 사진은 ws-data 값(engine resolvePhoto)만 — 고정 id 0. 합성 사진 id·경로(시드 아님).
  it('359 T17: habitat 카드 = 종별 photos.habitat(있는 종만 img), 시작 카드·설명 = 대표 타입 homeScenes, 없으면 빈 블록·ph-NN 0', () => {
    const habitat = { photoId: 'ph-fx-habitat', asset: '/assets/photos/fx-habitat.webp' };
    const scenes = {
      startChecklist: { photoId: 'ph-fx-start', asset: '/assets/photos/fx-start.webp', aiGenerated: true as const },
      explainNeed: { photoId: 'ph-fx-need', asset: '/assets/photos/fx-need.webp' },
      explainFigures: { photoId: 'ph-fx-fig', asset: '/assets/photos/fx-fig.webp' },
    };
    const parrot = { ...golden, id: 'fixture-parrot', slug: 'parrot/fixture', group: 'PARROT' as const, displayName: '픽스처앵무', aliases: [], careProfileId: 'cp-fixture-parrot' };
    const types = [{ ...golden, homeExplain: explain, specCheckItemId: 'cage-x', setupAvailable: true as const, photos: { habitat }, homeScenes: scenes }, parrot];
    const { unmount } = render(<App page={home({ types })} captured={NO_CAPTURE} />);
    const habCard = (id: string) => document.querySelector(`[data-ws-section="habitats"] a[data-ws-id="animalTypes#${id}"]`) as HTMLElement;
    expect(habCard(golden.id).querySelector('img.ws-photo.ws-starter-photo')?.getAttribute('data-ws-photo')).toBe('ph-fx-habitat');
    expect(habCard(parrot.id).querySelector('img')).toBeNull();
    expect(habCard(parrot.id).querySelector('span.ws-photo.ws-starter-photo[aria-hidden="true"]')).not.toBeNull();
    const start = (x: string) => document.querySelector(`[data-ws-section="starters"] a[data-ws-intent="${x}"]`) as HTMLElement;
    // 생성 이미지 → 틀 + 표기 1(359d)
    expect(start('CHECKLIST').querySelector('.ws-photo-frame.ws-starter-photo img')?.getAttribute('data-ws-photo')).toBe('ph-fx-start');
    expect(start('CHECKLIST').querySelectorAll('.ws-photo-notice')).toHaveLength(1);
    for (const x of ['SPEC_CHECK', 'SETUP']) {
      expect(start(x).querySelector('img')).toBeNull();
      expect(start(x).querySelector('span.ws-photo.ws-starter-photo[aria-hidden="true"]')).not.toBeNull();
    }
    expect(document.querySelector('[data-ws-section="need-split"] img.ws-photo.ws-explain-photo')?.getAttribute('data-ws-photo')).toBe('ph-fx-need');
    expect(document.querySelector('[data-ws-section="figures"] img.ws-photo.ws-explain-photo')?.getAttribute('data-ws-photo')).toBe('ph-fx-fig');
    // 고정 장면 id(ph-01~12) 0 — 앵무 카드에 골든 장면이 실리던 경로(H2) 닫힘
    expect(document.body.innerHTML).not.toMatch(/ph-\d\d\b/);
    unmount();
    // 사진 키 없음 → 시작 카드 span 3, img·data-ws-photo 0
    render(<App page={home({ types: [{ ...golden, homeExplain: explain, specCheckItemId: 'cage-x', setupAvailable: true }, parrot] })} captured={NO_CAPTURE} />);
    expect(document.querySelectorAll('[data-ws-section="starters"] span.ws-photo.ws-starter-photo[aria-hidden="true"]')).toHaveLength(3);
    expect(document.querySelectorAll('main img.ws-photo, main [data-ws-photo], main .ws-photo-frame')).toHaveLength(0);
  });

  it('금지어 0 · 채운 버튼은 하단 CTA 1개뿐', () => {
    const { container } = render(<App page={full({ vets: [vet] })} captured={NO_CAPTURE} />);
    const main = screen.getByRole('main');
    for (const w of BANNED) expect(main.textContent ?? '', w).not.toContain(w);
    expect(main.querySelectorAll('.ws-btn--fill')).toHaveLength(1);
    expect(container.querySelector('[data-ws-section="start"] .ws-btn--fill')).not.toBeNull();
  });
});
