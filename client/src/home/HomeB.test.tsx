// 홈 B(F5): ① 섹션 [now, bundles, products, vet, save](컨텍스트 헤더 앞) ② L3 전 ①·컨텍스트·⑤ 숫자 0 ③ 렌더 순서 = 입력 순서
//   ④ ✓ 기준 충족, 가격·"구매" 0 ⑤ /save 는 a. + URL 동물 저장(via url), L3 후 상태 칩.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { NO_CAPTURE } from '../app/staticCapture';
import { setupKey } from '../checklist/setupStore';
import { COPY } from '@ws/copy';
import type { PublicVet } from '@ws/engine';
import { bundle, golden, pageOf, product, req } from '../test/fixtures';
import { wsStorage } from '../lib/storage';
import { writeSaveState } from '../save/saveStateStore';
import { layerStore } from '../ui/layer/useLayer';
import { sortVets } from '../vet/order';
import VetPage from '../vet/VetPage';

const T = '2026-10-02T00:00:00.000Z';

function typePage() {
  return pageOf(
    'TYPE',
    {
      requirements: [req('cage', 'REQUIRED', '케이지'), req('wheel', 'REQUIRED', '쳇바퀴'), req('bath', 'REQUIRED', '모래 목욕통'), req('toy', 'OPTIONAL', '장난감')],
      // 의도적으로 id 역순·섞인 순서 — 화면은 이 순서 그대로여야 한다.
      products: [product('p3', 'cage', 'C 케이지'), product('p1', 'wheel', 'A 쳇바퀴'), product('p2', 'cage', 'B 케이지')],
      bundles: [bundle('b1', 'BUDGET', ['cage', 'wheel']), bundle('b2', 'BALANCED', ['cage']), bundle('b3', 'USED_MIX', ['wheel'])],
    },
    { typeId: golden.id, path: '/hamster/golden' },
  );
}

function vet(id: string): PublicVet {
  return { id, name: `병원 ${id}`, address: '서울 마포구', phone: '02-000-0000', region: 'seoul-mapo', treats: [golden.id], night: null, emergency: null, lat: null, lng: null, verifiedAt: null };
}

function sections(): string[] {
  return Array.from(screen.getByRole('main').children)
    .filter((el) => el.tagName === 'SECTION')
    .map((el) => (el.classList.contains('ws-context') ? 'context' : (el.getAttribute('data-ws-section') ?? '?')));
}

beforeEach(() => {
  localStorage.clear();
  act(() => layerStore.resetForTest());
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => layerStore.resetForTest());
});

describe('홈 B', () => {
  it('① 컨텍스트 헤더 → [now, bundles, products, vet, save]', () => {
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    expect(sections()).toEqual(['context', 'now', 'bundles', 'products', 'vet', 'save']);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('골든햄스터');
  });

  it('② L3 전: ①·컨텍스트·⑤ 에 "N개" 숫자 0, ① 부제 고정 문구, 칩은 neutral(글리프 없음), 상태 줄 = oneLiner', () => {
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const now = document.querySelector('[data-ws-section="now"]') as HTMLElement;
    const ctx = document.querySelector('.ws-context') as HTMLElement;
    const save = document.querySelector('[data-ws-section="save"]') as HTMLElement;
    for (const el of [now, ctx, save]) expect(el.textContent ?? '').not.toMatch(/\d+\s*개/);
    expect(now).toHaveTextContent('필수 준비를 먼저 확인해요');
    const chips = Array.from(now.querySelectorAll('.ws-need'));
    expect(chips.map((c) => c.textContent)).toEqual(['케이지', '쳇바퀴', '모래 목욕통']); // REQUIRED 만
    for (const c of chips) {
      expect(c).toHaveAttribute('data-ws-state', 'neutral');
      expect(c.querySelector('.ws-glyph')).toBeNull();
    }
    expect(ctx).toHaveTextContent('혼자 지내는 걸 좋아하는 친구');
    expect(chips[0]).toHaveAttribute('href', '/hamster/golden/supplies/cage');
  });

  it('L3 후: 칩 상태 글리프(! 먼저, ✓ 뒤로), 숫자 문구는 copy 가 있을 때만', () => {
    localStorage.setItem(
      setupKey(golden.id),
      JSON.stringify({ v: 1, firstTime: true, owned: ['cage'], answeredAt: T, startedAt: T, checks: { cage: { source: 'OWNED', at: T } }, reached100At: null }),
    );
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const chips = Array.from(document.querySelectorAll('[data-ws-section="now"] .ws-need'));
    expect(chips.map((c) => c.getAttribute('data-ws-state'))).toEqual(['first', 'first', 'ready']);
    expect(chips.map((c) => c.querySelector('.ws-glyph')?.textContent)).toEqual(['!', '!', '✓']);
    expect(chips[2]).toHaveTextContent('케이지');
  });

  it('③ 상품 렌더 순서 = ws-data 입력 순서(재정렬 0) ④ 모든 카드에 ✓ 기준 충족, 가격·판매처·"구매" 0, 대체 타일', () => {
    const { container } = render(<App page={typePage()} captured={NO_CAPTURE} />);
    const cards = Array.from(document.querySelectorAll('[data-ws-section="products"] li.ws-product'));
    expect(cards.map((c) => c.getAttribute('data-ws-id'))).toEqual(['curatedProducts#p3', 'curatedProducts#p1', 'curatedProducts#p2']);
    for (const c of cards) {
      expect(c.querySelector('.ws-badge')?.textContent).toBe('✓기준 충족');
      expect(c.querySelector('a')).toHaveAttribute('href', `/hamster/golden/products/${(c.getAttribute('data-ws-id') ?? '').split('#')[1]}`);
      expect(c.querySelector('.ws-tile-label')).toHaveTextContent('이미지 준비 중');
    }
    const text = container.querySelector('[data-ws-section="products"]')?.textContent ?? '';
    expect(text).not.toMatch(/₩|\d+\s*원|가격|판매처|구매|할인/);
    expect(container.querySelector('[data-ws-section="products"] img[src*="mascots"]')).toBeNull();
  });

  it('⑤ /save 는 a(텍스트 링크) 1개, 채운 CTA 는 저장 배너 하나 → L2', () => {
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const saves = document.querySelectorAll('a[href="/save"]');
    expect(saves).toHaveLength(1);
    expect(saves[0].tagName).toBe('A');
    const fills = document.querySelectorAll('main .ws-btn--fill');
    expect(fills).toHaveLength(1);
    fireEvent.click(fills[0]);
    expect(layerStore.get()?.kind).toBe('L2');
  });

  it('DR-3 m-13: 이메일 연결(ws.save linked)이면 "이 기기에만 저장돼요" 0개, 미연결이면 1개', () => {
    const { unmount } = render(<App page={typePage()} captured={NO_CAPTURE} />);
    expect(document.body.textContent?.split('이 기기에만 저장돼요').length).toBe(2);
    unmount();
    writeSaveState(wsStorage, { linked: true, lastSyncAt: null });
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    expect(document.body.textContent ?? '').not.toContain('이 기기에만 저장돼요');
    expect(document.querySelectorAll('a[href="/save"]')).toHaveLength(1);
  });

  it('DR-5 MINOR-2: 연결 시 저장 링크 텍스트 = saveLinked(› 없음), href /save 유지', () => {
    writeSaveState(wsStorage, { linked: true, lastSyncAt: null });
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const a = document.querySelector('a[href="/save"]');
    expect(a?.textContent).toBe(COPY.homeB.saveLinked);
    expect(a?.textContent).not.toContain('›');
  });

  it('K1: L3 후 REQUIRED 0 이면 "필수 준비 끝"·완료 블록·숫자 줄 없음', () => {
    localStorage.setItem(
      setupKey(golden.id),
      JSON.stringify({ v: 1, firstTime: true, owned: [], answeredAt: T, startedAt: T, checks: {}, reached100At: null }),
    );
    const p = typePage();
    render(<App page={{ ...p, data: { ...p.data, requirements: [req('toy', 'OPTIONAL', '장난감')] } }} captured={NO_CAPTURE} />);
    const now = document.querySelector('[data-ws-section="now"]') as HTMLElement;
    expect(now.classList.contains('ws-done')).toBe(false);
    expect(document.body.textContent).not.toContain('필수 준비 끝');
    expect(now.textContent ?? '').not.toMatch(/\d+\s*개/);
  });

  it('K1: L3 후 남은 수 줄(①·상태 줄), 저장 배너엔 숫자 없음', () => {
    localStorage.setItem(
      setupKey(golden.id),
      JSON.stringify({ v: 1, firstTime: false, owned: [], answeredAt: T, startedAt: T, checks: { cage: { source: 'UNKNOWN', at: T } }, reached100At: null }),
    );
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const now = document.querySelector('[data-ws-section="now"]') as HTMLElement;
    expect(now).toHaveTextContent('필수 2개 남았어요');
    expect(document.querySelector('.ws-context')).toHaveTextContent('이미 함께하는 중 · 필수 2개 남았어요');
    // 저장 배너엔 숫자 없음(UX §3.1B⑤ — saveRemaining 삭제)
    expect(document.querySelector('[data-ws-section="save"]')?.textContent ?? '').not.toMatch(/\d+\s*개/);
  });

  it('K1: L3 후 REQUIRED 전부 ✓ → 완료 블록(필수 ≥1)', () => {
    const all = { v: 1, firstTime: true, owned: [], answeredAt: T, startedAt: T, reached100At: null,
      checks: { cage: { source: 'UNKNOWN', at: T }, wheel: { source: 'UNKNOWN', at: T }, bath: { source: 'UNKNOWN', at: T } } };
    localStorage.setItem(setupKey(golden.id), JSON.stringify(all));
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const now = document.querySelector('[data-ws-section="now"]') as HTMLElement;
    expect(now.classList.contains('ws-done')).toBe(true);
    expect(now).toHaveTextContent('필수 준비가 끝났어요');
  });

  it('구성안: 이름·목적·범위·면책, 링크 /setup, "세트" 0 · 병원 ④ 는 /vet 링크', () => {
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const b = document.querySelector('[data-ws-section="bundles"]') as HTMLElement;
    expect(b.querySelectorAll('li[data-ws-tier]')).toHaveLength(3);
    expect(b).toHaveTextContent('참고 범위예요. 실제 가격은 판매처마다 달라요');
    expect(b.querySelector('a[href="/hamster/golden/setup"]')).not.toBeNull();
    expect(b.textContent).not.toContain('세트');
    expect(document.querySelector('[data-ws-section="vet"] a')).toHaveAttribute('href', '/vet');
  });

  it('URL 동물이 저장값과 다르면 ws.animalType 에 저장(via url), [친구 바꾸기] → L1', () => {
    localStorage.setItem('ws.animalType', 'gerbil');
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    expect(localStorage.getItem('ws.animalType')).toBe(golden.id);
    const change = screen.getByRole('link', { name: '친구 바꾸기' });
    expect(change).toHaveAttribute('href', '/pick');
    expect(change).toHaveAttribute('data-ws-action', 'change-animal');
    // K1: 수정 키 클릭은 기본 동작(새 탭) — 가로채지 않는다.
    expect(fireEvent.click(change, { ctrlKey: true })).toBe(true);
    expect(layerStore.get()).toBeNull();
    expect(fireEvent.click(change)).toBe(false); // defaultPrevented
    expect(layerStore.get()?.kind).toBe('L1');
  });

  it('R6 G1 ④ 병원 순서 = /vet 목록 순서(같은 sortVets: 지역 → 이름 → id) — ws-data 가 섞여 와도', () => {
    const p = typePage();
    const mk = (id: string, name: string, region: string): PublicVet => ({ ...vet(id), name, region });
    // 섞인 입력: 기대 순서 = v1(마포·가) → v2(마포·나) → v3(은평·가)
    const vets = [mk('v2', '나 병원', 'seoul-mapo'), mk('v3', '가 병원', 'seoul-yeongdeungpo'), mk('v1', '가 병원', 'seoul-mapo')];
    const home = render(<App page={{ ...p, data: { ...p.data, vets } }} captured={NO_CAPTURE} />);
    const railIds = Array.from(document.querySelectorAll('[data-ws-section="vet"] li.ws-vet')).map((li) => li.getAttribute('data-ws-id'));
    home.unmount();
    const vp = pageOf('VET', { types: [golden], vets }, { path: '/vet' });
    window.history.replaceState(null, '', '/vet');
    render(<VetPage page={vp} capturedMain={null} />);
    const listIds = Array.from(document.querySelectorAll('li.ws-vet')).map((li) => li.getAttribute('data-ws-id'));
    window.history.replaceState(null, '', '/');
    expect(railIds).toEqual(['vetClinics#v1', 'vetClinics#v2', 'vetClinics#v3']);
    expect(listIds).toEqual(railIds);
  });

  it('F1-4 ④ vets 0: 레일 없이 /vet 링크만(섹션 순서 불변)', () => {
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const v = document.querySelector('[data-ws-section="vet"]') as HTMLElement;
    expect(v.querySelectorAll('li.ws-vet')).toHaveLength(0);
    expect(v.querySelector('ul')).toBeNull();
    expect(Array.from(v.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/vet']);
    expect(sections()).toEqual(['context', 'now', 'bundles', 'products', 'vet', 'save']);
  });

  it('F1-4 ④ vets: ws-data 순서 VetCard 레일(≤20, 진료 동물 = 표시명, 원시 id 0) + /vet 링크, 섹션 순서 = 프리렌더(type.ts) [now, bundles, products, vet, save]', () => {
    const p = typePage();
    const vets = Array.from({ length: 22 }, (_, i) => vet(`v${i}`));
    render(<App page={{ ...p, data: { ...p.data, vets } }} captured={NO_CAPTURE} />);
    expect(sections()).toEqual(['context', 'now', 'bundles', 'products', 'vet', 'save']);
    const v = document.querySelector('[data-ws-section="vet"]') as HTMLElement;
    const ids = Array.from(v.querySelectorAll('li.ws-vet')).map((li) => li.getAttribute('data-ws-id'));
    // R6 G1: 순서 = vet/order.ts sortVets(지역 → 이름 → id, /vet·프리렌더와 같은 규칙) 후 ≤20.
    expect(ids).toEqual(sortVets(vets).slice(0, 20).map((x) => `vetClinics#${x.id}`));
    expect(ids.slice(0, 3)).toEqual(['vetClinics#v0', 'vetClinics#v1', 'vetClinics#v10']); // 코드 포인트 비교
    expect(v.querySelector('a[href="/vet"]')).not.toBeNull();
    expect(v.textContent).toContain(golden.displayName);
    expect(v.textContent).not.toContain(golden.id);
    expect(v.querySelector('.ws-vet-name')).toBeNull(); // onSelect 없음 — 지도 선택 버튼 0
  });

  it('F1-4: 칩 → L4 · 상품 카드 → L7 · 저장 링크 → L8(SPA push, URL 갱신)', () => {
    window.history.replaceState(null, '', '/hamster/golden');
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    fireEvent.click(document.querySelector('[data-ws-section="now"] a.ws-need[href="/hamster/golden/supplies/cage"]') as Element);
    expect(layerStore.get()).toMatchObject({ kind: 'L4', props: { typeId: golden.id, itemId: 'cage' } });
    expect(window.location.pathname).toBe('/hamster/golden/supplies/cage');
    act(() => layerStore.resetForTest());
    window.history.replaceState(null, '', '/hamster/golden');
    fireEvent.click(document.querySelector('[data-ws-section="products"] a[href="/hamster/golden/products/p1"]') as Element);
    expect(layerStore.get()).toMatchObject({ kind: 'L7', props: { typeId: golden.id, productId: 'p1' } });
    act(() => layerStore.resetForTest());
    window.history.replaceState(null, '', '/hamster/golden');
    const save = document.querySelector('[data-ws-section="save"] a.ws-save-link') as HTMLElement;
    expect(save).toHaveAttribute('href', '/save');
    fireEvent.click(save);
    expect(layerStore.get()?.kind).toBe('L8');
    expect(window.location.pathname).toBe('/save');
    act(() => layerStore.resetForTest());
    window.history.replaceState(null, '', '/');
  });
});
