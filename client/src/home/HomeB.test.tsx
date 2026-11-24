// 홈 B(R4-2 시안 톤 + R4-2b PRD US-003 섹션 복원): 컨텍스트 헤더 → [now, later?, bundles?, spec?, products?, vet, save]. 숫자·이름·이유는 ws-data 에서만(하드코딩 0).
//   L3 전 숫자 0 · 항목 카드 = 필수(neutral) · L3 후 요약 카드 「필수 {total}가지 중 {n}가지가 남았어요.」 + 주 버튼 「남은 준비 {n}개 살펴보기」 → L2.
//   남은 항목 = 글리프 + 보이는 단어(! 먼저 준비 · △ 확인 필요), ≤767 항목 줄은 이름마다 L4 링크 · 구성안 레일 → /setup + bundle_viewed
//   · 상품 레일(ws-data 순서, ○ 기준 충족, 가격 0) → L7 · 병원 레일(sortVets ≤20) 또는 「확인된 병원이 아직 없어요」 · /save 는 a(텍스트 링크).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { NO_CAPTURE } from '../app/staticCapture';
import { setupKey } from '../checklist/setupStore';
import { COPY } from '@ws/copy';
import type { PublicRequirement, PublicVet, SpecSchema } from '@ws/engine';
import { bundle, golden, pageOf, product, req } from '../test/fixtures';
import { wsStorage } from '../lib/storage';
import { writeSaveState } from '../save/saveStateStore';
import { layerStore } from '../ui/layer/useLayer';
import { specTarget, vetHrefFor } from './HomeB';
import { parseVetFilter } from '../vet/filters';
import { sortVets } from '../vet/order';
import * as trackMod from '../events/track';

const T = '2026-10-02T00:00:00.000Z';
const CAGE_SCHEMA: SpecSchema = {
  fields: [
    { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
    { key: 'floorDcm', label: '바닥 세로(cm)', type: 'number', min: 20, max: 200 },
  ],
};

function withSpec(r: PublicRequirement, specSchema: SpecSchema, minSpec: PublicRequirement['minSpec'], why = r.why): PublicRequirement {
  return { ...r, why, minSpec, item: { ...r.item, specSchema } };
}

function typePage(extra: PublicRequirement[] = []) {
  return pageOf(
    'TYPE',
    {
      requirements: [
        withSpec(req('cage', 'REQUIRED', '케이지'), CAGE_SCHEMA, { rules: [{ key: 'floorWcm', op: 'gte', value: 61, reason: 'r' }, { key: 'floorDcm', op: 'gte', value: 41, reason: 'r' }] }, '바닥이 넓어야 해요. 두 번째 문장.'),
        req('wheel', 'REQUIRED', '쳇바퀴'),
        req('bath', 'REQUIRED', '모래 목욕통'),
        req('toy', 'OPTIONAL', '장난감'),
        ...extra,
      ],
      products: [product('p3', 'cage', 'C 케이지'), product('p1', 'wheel', 'A 쳇바퀴')],
      bundles: [bundle('b1', 'BUDGET', ['cage', 'wheel'])],
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

const now = () => document.querySelector('[data-ws-section="now"]') as HTMLElement;
const cards = () => Array.from(now().querySelectorAll('li.ws-now-item a.ws-now-card'));
const links = (line: string) => Array.from(now().querySelectorAll(`[data-ws-line="${line}"] li[data-ws-now-link] a.ws-now-link`));

function answer(checks: Record<string, { source: string; at: string }>, firstTime = true) {
  localStorage.setItem(setupKey(golden.id), JSON.stringify({ v: 1, firstTime, owned: [], answeredAt: T, startedAt: T, checks, reached100At: null }));
}

beforeEach(() => {
  localStorage.clear();
  act(() => layerStore.resetForTest());
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => layerStore.resetForTest());
});

describe('홈 B(R4-2)', () => {
  it('컨텍스트 헤더(눈썹 · h1 · 바꾸기) → PRD 순서 [now, bundles, spec, products, vet, save] — 마스코트 없음', () => {
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    expect(sections()).toEqual(['context', 'now', 'bundles', 'spec', 'products', 'vet', 'save']);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('골든햄스터');
    const ctx = document.querySelector('.ws-context') as HTMLElement;
    expect(ctx).toHaveTextContent(COPY.homeB.contextEyebrow);
    expect(ctx.querySelector('img, .ws-avatar')).toBeNull();
    // 레일 섹션도 다른 섹션과 같은 머리(display 제목) · 같은 간격 클래스
    for (const id of ['bundles', 'products']) {
      const sec = document.querySelector(`[data-ws-section="${id}"]`) as HTMLElement;
      expect(sec).toHaveClass('ws-home-sec');
      expect(sec.querySelector('h2')).toHaveClass('ws-t-display', 'ws-home-sec-title');
    }
  });

  it('데이터 없는 구성안·상품 섹션은 그리지 않는다(실시드 DRAFT → 노출 0), 병원은 빈 안내', () => {
    const p = typePage();
    render(<App page={{ ...p, data: { ...p.data, products: [], bundles: [], vets: [] } }} captured={NO_CAPTURE} />);
    expect(sections()).toEqual(['context', 'now', 'spec', 'vet', 'save']);
  });

  it('L3 전: 숫자 0, 요약 줄 고정 문구, 항목 카드 = 필수 전부 neutral(글리프 없음, 입력 순서), 이유 = 시드 why 첫 문장', () => {
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    for (const el of [now(), document.querySelector('.ws-context') as HTMLElement, document.querySelector('[data-ws-section="save"]') as HTMLElement]) {
      expect(el.textContent ?? '').not.toMatch(/\d+\s*(개|가지)/);
    }
    expect(now()).toHaveTextContent(COPY.homeB.nowBeforeSetup);
    expect(now().querySelector('.ws-now-cta')).toHaveTextContent(COPY.homeB.nowCtaStart);
    expect(cards().map((c) => c.querySelector('.ws-now-name')?.textContent)).toEqual(['케이지', '쳇바퀴', '모래 목욕통']); // REQUIRED 만
    for (const c of cards()) {
      expect(c).toHaveAttribute('data-ws-state', 'neutral');
      expect(c.querySelector('.ws-glyph')).toBeNull();
    }
    expect(cards()[0].querySelector('.ws-now-reason')).toHaveTextContent(/^바닥이 넓어야 해요\.$/);
    expect(cards()[0]).toHaveAttribute('href', '/hamster/golden/supplies/cage');
    expect(cards()[0].closest('li')).toHaveAttribute('data-ws-id', 'supplyRequirements#req-cage');
    // ≤767 항목 줄(MED-1): 필수 전부, 이름마다 L4 링크 · neutral(상태 표시 없음)
    expect(links('all').map((a) => a.textContent)).toEqual(['케이지', '쳇바퀴', '모래 목욕통']);
    expect(links('all').map((a) => a.getAttribute('href'))).toEqual(['/hamster/golden/supplies/cage', '/hamster/golden/supplies/wheel', '/hamster/golden/supplies/bath']);
    for (const a of links('all')) expect(a).toHaveAttribute('data-ws-state', 'neutral');
    expect(now().querySelector('.ws-now-state')).toBeNull();
  });

  // 359 T15(감사 356r M2): 사진 = ws-data(types[].photos·requirements[].photo)만, 고정 id 0. 합성 사진 id·경로(시드 아님).
  it('359 T15: 사진 키 없음 → 사진 자리 전부 빈 블록, data-ws-photo·ph-NN 0(앵무 등 다른 종에 장면 id 가 실리던 경로 닫힘)', () => {
    const p = typePage();
    const parrot = { ...golden, id: 'fixture-parrot', slug: 'parrot/fixture', group: 'PARROT' as const, displayName: '픽스처앵무', careProfileId: 'cp-fixture-parrot' };
    const asParrot = { ...p, route: { ...p.route, typeId: parrot.id, path: '/parrot/fixture' }, data: { ...p.data, types: [parrot], requirements: p.data.requirements.map((r) => ({ ...r, animalTypeId: parrot.id })) } };
    for (const page of [p, asParrot]) {
      const { container, unmount } = render(<App page={page} captured={NO_CAPTURE} />);
      expect(container.innerHTML).not.toMatch(/ph-\d\d\b/);
      expect(container.querySelectorAll('[data-ws-photo], img.ws-photo, .ws-photo-frame')).toHaveLength(0);
      expect(container.querySelectorAll('main span.ws-photo[aria-hidden="true"]').length).toBeGreaterThanOrEqual(5); // now-lead + 카드 3 + 규격
      unmount();
    }
  });

  it('359 T15: photos.nowLead·spec·cage 요구사항 photo → 그 자리만 img(cage 카드 1장), 생성 이미지는 틀 + 표기 1', () => {
    const p = typePage();
    const photos = {
      nowLead: { photoId: 'ph-fx-now', asset: '/assets/photos/fx-now.webp' },
      spec: { photoId: 'ph-fx-spec', asset: '/assets/photos/fx-spec.webp', aiGenerated: true as const },
    };
    const reqs = p.data.requirements.map((r) => (r.supplyItemId === 'cage' ? { ...r, photo: { photoId: 'ph-fx-cage', asset: '/assets/items/fx-cage.webp' } } : r));
    render(<App page={{ ...p, data: { ...p.data, types: [{ ...golden, photos }], requirements: reqs } }} captured={NO_CAPTURE} />);
    expect(now().querySelector('li.ws-now-lead > img.ws-photo.ws-now-photo')?.getAttribute('data-ws-photo')).toBe('ph-fx-now');
    expect(cards().map((c) => c.querySelector('img.ws-photo.ws-now-photo')?.getAttribute('data-ws-photo') ?? null)).toEqual(['ph-fx-cage', null, null]);
    const spec = document.querySelector('[data-ws-section="spec"]') as HTMLElement;
    const frame = spec.querySelector('.ws-photo-frame.ws-spec-sec-photo') as HTMLElement;
    expect(frame.querySelector('img.ws-photo')?.getAttribute('data-ws-photo')).toBe('ph-fx-spec');
    expect(spec.querySelectorAll('.ws-photo-notice')).toHaveLength(1);
    expect(document.querySelectorAll('main .ws-photo-notice')).toHaveLength(1);
  });

  it('L3 후: 요약 「필수 3가지 중 2가지가 남았어요.」, 주 버튼 「남은 준비 2개 살펴보기」 → L2, 카드 = 남은 필수(입력 순서, ! 먼저 준비), 줄 = ✓ 준비완료 / 아직 준비 중(링크)', () => {
    answer({ wheel: { source: 'UNKNOWN', at: T } }, false);
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    expect(now()).toHaveTextContent('필수 3가지 중 2가지가 남았어요.');
    expect(cards().map((c) => c.getAttribute('data-ws-state'))).toEqual(['first', 'first']);
    expect(cards().map((c) => c.querySelector('.ws-now-name')?.textContent)).toEqual(['케이지', '모래 목욕통']);
    // L-1: FIRST 카드 = ! 글리프 + 보이는 단어(R4-1 GLYPH 표 first)
    for (const c of cards()) {
      const tag = c.querySelector('.ws-now-state') as HTMLElement;
      expect(tag.querySelector('[data-ws-glyph="first"]')).toHaveTextContent('!');
      expect(tag).toHaveTextContent(`!${COPY.glyphLabel.first}`);
      expect(tag.querySelector('.ws-visually-hidden')).toBeNull();
    }
    const ready = now().querySelector('[data-ws-line="ready"]') as HTMLElement;
    expect(ready.querySelector('[data-ws-glyph="ready"]')).toHaveTextContent('✓');
    expect(ready).toHaveTextContent('준비완료쳇바퀴');
    expect(links('ready').map((a) => a.getAttribute('href'))).toEqual(['/hamster/golden/supplies/wheel']);
    const pending = now().querySelector('[data-ws-line="pending"]') as HTMLElement;
    expect(pending.querySelector('.ws-now-line-label')).toHaveTextContent(COPY.homeB.nowPendingLabel);
    expect(
      links('pending').map((a) => [a.querySelector('.ws-now-link-name')?.textContent, a.getAttribute('data-ws-state'), a.querySelector('.ws-now-state')?.textContent]),
    ).toEqual([
      ['케이지', 'first', `!${COPY.glyphLabel.first}`],
      ['모래 목욕통', 'first', `!${COPY.glyphLabel.first}`],
    ]);
    const cta = now().querySelector('.ws-now-cta') as HTMLElement;
    expect(cta).toHaveTextContent('남은 준비 2개 살펴보기');
    expect(cta.tagName).toBe('BUTTON');
    fireEvent.click(cta);
    expect(layerStore.get()?.kind).toBe('L2');
  });

  it('채운 CTA 는 페이지에 하나(요약 카드), /save 는 a(텍스트 링크) 1개', () => {
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    expect(document.querySelectorAll('main .ws-btn--fill')).toHaveLength(1);
    const saves = document.querySelectorAll('a[href="/save"]');
    expect(saves).toHaveLength(1);
    expect(saves[0].tagName).toBe('A');
  });

  it('DR-5 MINOR-2: 연결 시 저장 링크 텍스트 = saveLinked(화살표·› 없음), href /save 유지', () => {
    writeSaveState(wsStorage, { linked: true, lastSyncAt: null });
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const a = document.querySelector('a[href="/save"]');
    expect(a?.textContent).toBe(COPY.homeB.saveLinked);
    expect(a?.textContent).not.toMatch(/›|→/);
  });

  it('K1: L3 후 REQUIRED 0 이면 완료 문구·숫자 없음, 항목 카드·이름 줄 없음', () => {
    answer({});
    const p = typePage();
    render(<App page={{ ...p, data: { ...p.data, requirements: [req('toy', 'OPTIONAL', '장난감')] } }} captured={NO_CAPTURE} />);
    expect(document.body.textContent).not.toContain(COPY.homeB.doneLine);
    expect(now()).toHaveTextContent(COPY.homeB.nowEmpty);
    expect(now().textContent ?? '').not.toMatch(/\d+\s*(개|가지)/);
    expect(cards()).toHaveLength(0);
    expect(now().querySelector('.ws-now-lines')).toBeNull();
    expect(sections()).toEqual(['context', 'now', 'bundles', 'products', 'vet', 'save']); // 규격 숫자 없음 → spec 섹션 없음
  });

  it('K1: L3 후 REQUIRED 전부 ✓ → 완료 줄 + 「권장 항목 보기」, 항목 카드 0', () => {
    answer({ cage: { source: 'UNKNOWN', at: T }, wheel: { source: 'UNKNOWN', at: T }, bath: { source: 'UNKNOWN', at: T } });
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    expect(now()).toHaveTextContent(COPY.homeB.doneLine);
    expect(now().querySelector('.ws-now-cta')).toHaveTextContent(COPY.homeB.doneCta);
    expect(cards()).toHaveLength(0);
  });

  it('나중에 필요한 것: NOT_NOW 시드 레코드만(이름 + notNowReason), 없으면 섹션 없음', () => {
    const saucer: PublicRequirement = { ...req('saucer', 'NOT_NOW', '원반형 쳇바퀴'), notNowReason: '세워진 쳇바퀴를 먼저 갖춘 뒤 필요할 때 고려해요.' };
    render(<App page={typePage([saucer])} captured={NO_CAPTURE} />);
    expect(sections()).toEqual(['context', 'now', 'later', 'bundles', 'spec', 'products', 'vet', 'save']);
    const later = document.querySelector('[data-ws-section="later"]') as HTMLElement;
    expect(Array.from(later.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['원반형 쳇바퀴세워진 쳇바퀴를 먼저 갖춘 뒤 필요할 때 고려해요.']);
    expect(later.querySelector('li')).toHaveAttribute('data-ws-id', 'supplyRequirements#req-saucer');
  });

  it('규격 확인: 숫자 = 시드 minSpec 규칙 값 그대로(엔진 minSpecFigure), 링크 L5 /check/{item}, 시드 값이 바뀌면 화면도 바뀐다', () => {
    const { unmount } = render(<App page={typePage()} captured={NO_CAPTURE} />);
    const spec = document.querySelector('[data-ws-section="spec"]') as HTMLElement;
    expect(spec.querySelector('h2')).toHaveTextContent('케이지 규격 확인');
    expect(spec).toHaveTextContent(`${golden.displayName} 기준`);
    expect(spec.querySelector('.ws-spec-sec-label')).toHaveTextContent(COPY.verdict.minSpecLabel);
    expect(spec.querySelector('.ws-spec-sec-value')).toHaveTextContent('61×41');
    expect(spec.querySelector('.ws-spec-sec-unit')).toHaveTextContent('cm');
    expect(spec.querySelector('a')).toHaveAttribute('href', '/hamster/golden/check/cage');
    expect(spec.querySelector('a')).toHaveTextContent('내 케이지 확인하기');
    unmount();
    const p = typePage();
    const reqs = p.data.requirements.map((r) => (r.supplyItemId === 'cage' ? { ...r, minSpec: { rules: [{ key: 'floorWcm', op: 'gte' as const, value: 77, reason: 'r' }] } } : r));
    render(<App page={{ ...p, data: { ...p.data, requirements: reqs } }} captured={NO_CAPTURE} />);
    expect(document.querySelector('.ws-spec-sec-value')).toHaveTextContent(/^77$/);
    expect(document.querySelector('.ws-spec-sec-label')).toHaveTextContent('최소 바닥 가로');
  });

  it('specTarget: REQUIRED 중 숫자 gte 규칙이 있는 첫 항목 — 없으면 null', () => {
    expect(specTarget([req('a', 'REQUIRED'), req('b', 'OPTIONAL')])).toBeNull();
    const r = withSpec(req('cage', 'RECOMMENDED'), CAGE_SCHEMA, { rules: [{ key: 'floorWcm', op: 'gte', value: 50, reason: 'r' }] });
    expect(specTarget([r])).toBeNull(); // REQUIRED 아님
  });

  it('병원 0(실시드 SLOT 뿐): 제목 「{동물}를 진료하는 병원」 + 「확인된 병원이 아직 없어요」 + /vet?treats= 링크 하나, 카드 0(허구 병원 0)', () => {
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const v = document.querySelector('[data-ws-section="vet"]') as HTMLElement;
    expect(v.querySelector('h2')).toHaveTextContent('골든햄스터를 진료하는 병원');
    expect(v).toHaveTextContent(COPY.homeB.vetEmpty);
    expect(v.querySelectorAll('li')).toHaveLength(0);
    expect(Array.from(v.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([`/vet?treats=${golden.id}`]);
  });

  it('병원 ≥1: VetCard 레일(sortVets 후 ≤20, 진료 동물 = 표시명) + 안내 + /vet?treats= 링크, 빈 안내 없음', () => {
    const p = typePage();
    const vets = [...Array.from({ length: 21 }, (_, i) => vet(`v${i}`)), { ...vet('va'), region: 'aaa' }];
    render(<App page={{ ...p, data: { ...p.data, vets } }} captured={NO_CAPTURE} />);
    const v = document.querySelector('[data-ws-section="vet"]') as HTMLElement;
    expect(v.querySelector('h2')).toHaveTextContent('골든햄스터를 진료하는 병원');
    const ids = Array.from(v.querySelectorAll('li.ws-vet')).map((li) => li.getAttribute('data-ws-id'));
    expect(ids).toEqual(sortVets(vets).slice(0, 20).map((x) => `vetClinics#${x.id}`));
    expect(ids[0]).toBe('vetClinics#va');
    expect(v).toHaveTextContent(COPY.homeB.vetAsk);
    expect(v).not.toHaveTextContent(COPY.homeB.vetEmpty);
    expect(v.textContent).toContain(golden.displayName);
    expect(v.querySelector(`a.ws-rail-foot[href="/vet?treats=${golden.id}"]`)).not.toBeNull();
  });

  it('처음 준비한다면: 노출 구성안 카드(이름·목적·개수·참고 범위+면책) + /setup 링크, 「세트」 0 · 노출 시 bundle_viewed{animalTypeId, tier} tier 별 1회', () => {
    const observed: Element[] = [];
    let cb: IntersectionObserverCallback = () => undefined;
    class IO {
      constructor(c: IntersectionObserverCallback) {
        cb = c;
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', IO);
    const spy = vi.spyOn(trackMod, 'track');
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const b = document.querySelector('[data-ws-section="bundles"]') as HTMLElement;
    expect(b.querySelector('h2')).toHaveTextContent(COPY.homeB.bundlesTitle);
    expect(b.querySelectorAll('li[data-ws-tier]')).toHaveLength(1);
    expect(b).toHaveTextContent('구성 b1');
    expect(b).toHaveTextContent(COPY.setup.priceNote);
    expect(b.querySelector('a.ws-rail-foot')).toHaveAttribute('href', '/hamster/golden/setup');
    expect(b.textContent).not.toContain('세트');
    const tiers = observed.filter((el) => el.hasAttribute('data-ws-tier')).map((el) => el.getAttribute('data-ws-tier'));
    expect(tiers).toEqual(['BUDGET']);
    const li = observed.find((el) => el.hasAttribute('data-ws-tier')) as Element;
    const entry = (target: Element) => ({ isIntersecting: true, target }) as unknown as IntersectionObserverEntry;
    act(() => cb([entry(li), entry(li)], {} as IntersectionObserver));
    expect(spy.mock.calls.filter(([n]) => n === 'bundle_viewed')).toEqual([['bundle_viewed', { animalTypeId: golden.id, tier: 'BUDGET' }]]);
    spy.mockRestore();
  });

  it('기준에 맞는 준비물: ws-data 순서 그대로(재정렬 0), 모든 카드 ○ 기준 충족 · L7 링크 · 대체 타일, 가격·판매처·구매 0', () => {
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const sec = document.querySelector('[data-ws-section="products"]') as HTMLElement;
    expect(sec.querySelector('h2')).toHaveTextContent(COPY.homeB.productsTitle);
    const items = Array.from(sec.querySelectorAll('li.ws-product'));
    expect(items.map((c) => c.getAttribute('data-ws-id'))).toEqual(['curatedProducts#p3', 'curatedProducts#p1']);
    for (const c of items) {
      expect(c.querySelector('.ws-badge')?.textContent).toBe(`○${COPY.product.badge}`);
      expect(c.querySelector('a')).toHaveAttribute('href', `/hamster/golden/products/${(c.getAttribute('data-ws-id') ?? '').split('#')[1]}`);
      expect(c.querySelector('.ws-tile-label')).toHaveTextContent(COPY.product.imagePending);
    }
    expect(sec.textContent ?? '').not.toMatch(/₩|\d+\s*원|가격|판매처|구매|할인|최저가|베스트/);
    expect(sec.querySelector('img[src*="mascots"]')).toBeNull();
  });

  it('④ 병원 링크 href 에 동물 필터 쿼리(?treats=), VetPage 가 그 쿼리를 그대로 읽는다', () => {
    expect(vetHrefFor(golden.id)).toBe(`/vet?treats=${golden.id}`);
    const q = vetHrefFor(golden.id).split('?')[1];
    expect(parseVetFilter(`?${q}`, [golden.id]).treats).toBe(golden.id);
  });

  it('URL 동물이 저장값과 다르면 ws.animalType 에 저장(via url), [바꾸기](접근 이름 친구 바꾸기) → L1', () => {
    localStorage.setItem('ws.animalType', 'gerbil');
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    expect(localStorage.getItem('ws.animalType')).toBe(golden.id);
    const change = screen.getByRole('link', { name: '친구 바꾸기' });
    expect(change).toHaveTextContent(COPY.homeB.change);
    expect(change).toHaveAttribute('href', '/pick');
    expect(change).toHaveAttribute('data-ws-action', 'change-animal');
    // K1: 수정 키 클릭은 기본 동작(새 탭) — 가로채지 않는다.
    expect(fireEvent.click(change, { ctrlKey: true })).toBe(true);
    expect(layerStore.get()).toBeNull();
    expect(fireEvent.click(change)).toBe(false); // defaultPrevented
    expect(layerStore.get()?.kind).toBe('L1');
  });

  it('항목 카드 → L4 · 규격 링크 → L5 · 저장 링크 → L8(SPA push, URL 갱신)', () => {
    window.history.replaceState(null, '', '/hamster/golden');
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    fireEvent.click(document.querySelector('[data-ws-section="now"] a.ws-now-card[href="/hamster/golden/supplies/cage"]') as Element);
    expect(layerStore.get()).toMatchObject({ kind: 'L4', props: { typeId: golden.id, itemId: 'cage' } });
    expect(window.location.pathname).toBe('/hamster/golden/supplies/cage');
    act(() => layerStore.resetForTest());
    window.history.replaceState(null, '', '/hamster/golden');
    fireEvent.click(document.querySelector('[data-ws-section="spec"] a[href="/hamster/golden/check/cage"]') as Element);
    expect(layerStore.get()).toMatchObject({ kind: 'L5', props: { typeId: golden.id, itemId: 'cage' } });
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

  it('금지어·가격 0: 홈 B 본문에 가격·판매처·구매 표현 없음 — 구성안 카드의 참고 범위 면책 문구(COPY.setup.priceNote)만 예외', () => {
    render(<App page={typePage()} captured={NO_CAPTURE} />);
    const text = (screen.getByRole('main').textContent ?? '').split(COPY.setup.priceNote).join('');
    expect(text).not.toMatch(/₩|\d+\s*원|가격|판매처|구매|할인|최저가|베스트/);
  });
});
