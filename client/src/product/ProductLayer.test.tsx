// F1-3 L7 React + ♥: 추천 이유 = 템플릿만(상품별 자유 문구 0), count null → 숫자 0 · 10 → "10" · 9 → 0,
//   product_viewed·reaction_like, 케이지 호환 실패해도 노출·순서 불변(③), 가격·"구매" 0, SearchBlock 펼침.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COPY, formatCopy } from '@ws/copy';
import type { Engine, PublicRequirement, WsPageData } from '@ws/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerPageProvider } from '../app/layerPage';
import { layerRegistry, layerWsId } from '../app/layerRegistry';
import { cageKey } from '../context/cageStore';
import { setTrackerForTest, type Tracker } from '../events/track';
import ProductCard from '../home/ProductCard';
import { REACTIONS_KEY, reactionApi, reactionCounts } from '../reaction/reactionStore';
import { compatDeps } from '../supply/useCageCompat';
import { golden, pageOf, product, req } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';

function wheel(): PublicRequirement {
  const base = req('wheel', 'REQUIRED', '쳇바퀴');
  return {
    ...base,
    why: '척추가 휘지 않게 큰 바퀴가 필요해요',
    searchKeyword: '골든햄스터 쳇바퀴 28cm',
    searchLinks: [
      { provider: 'COUPANG', href: 'https://www.coupang.com/np/search?q=x' },
      { provider: 'NAVER', href: 'https://search.shopping.naver.com/search/all?query=x' },
    ],
  };
}

const P1 = { ...product('p1', 'wheel', '합성 바퀴 A'), reasonCodes: ['SPEC_MET', 'PROFILE_MATCH'] as Array<'SPEC_MET' | 'PROFILE_MATCH'>, specVerifiedAt: '2026-09-15' };
const P2 = { ...product('p2', 'wheel', '합성 바퀴 B'), verdict: 'BELOW_RECOMMENDED' as const, reasonCodes: ['SPEC_MET'] as Array<'SPEC_MET' | 'PROFILE_MATCH'> };
const P3 = product('p3', 'wheel', '합성 바퀴 C');

function page(): WsPageData {
  return pageOf('TYPE', { requirements: [wheel()], products: [P1, P2, P3] }, { typeId: golden.id, path: '/hamster/golden' });
}

let calls: Array<[string, Record<string, unknown>]>;
const blockNav = (e: Event) => e.preventDefault();

beforeEach(() => {
  window.localStorage.clear();
  calls = [];
  const fake: Tracker = { track: (n, p) => void calls.push([n, p]), flush: () => undefined, dispose: () => undefined };
  setTrackerForTest(fake);
  vi.spyOn(reactionApi, 'send').mockResolvedValue(undefined);
  vi.spyOn(reactionCounts, 'get').mockResolvedValue({});
  vi.spyOn(compatDeps, 'load').mockRejectedValue(new Error('no catalog in test'));
  document.addEventListener('click', blockNav);
});

afterEach(() => {
  act(() => layerStore.resetForTest());
  setTrackerForTest(null);
  vi.restoreAllMocks();
  document.removeEventListener('click', blockNav);
});

function host(p = page()) {
  return render(
    <LayerPageProvider page={p}>
      <LayerHost registry={layerRegistry} wsIdFor={(k, q) => layerWsId(p, k, q)} />
    </LayerPageProvider>,
  );
}

function openL7(id = 'p1', p = page()): HTMLElement {
  host(p);
  act(() => layerStore.open('L7', { typeId: golden.id, productId: id }));
  return screen.getByRole('dialog', { name: p.data.products.find((x) => x.id === id)?.title });
}

describe('L7 ProductLayer', () => {
  it('구조: 대체 타일 → 용품명 meta → ✓ 기준 충족 + 검수일 + ♥ → 추천 이유(템플릿) → 기준 보기 링크, data-ws-id', () => {
    const d = openL7();
    expect(d).toHaveAttribute('data-ws-id', 'curatedProducts#p1');
    expect(d.querySelector('.ws-tile')).not.toBeNull();
    expect(d.querySelector('img')).toBeNull();
    expect(d.textContent).toContain(COPY.product.badge);
    expect(d.textContent).toContain(`${COPY.supplyLayer.lastVerified} 2026.09`);
    const items = Array.from(d.querySelectorAll('.ws-reasons li')).map((li) => li.textContent);
    expect(items).toEqual([
      `✓${formatCopy(COPY.product.reasonSpecRecommended, { animal: golden.displayName })}`,
      `✓${formatCopy(COPY.product.reasonProfileTpl, { name: '쳇바퀴' })}`,
    ]);
    // DR B-1: 용품 why 는 L7 에 없다(L4 에서 — 아래 기준 보기 링크).
    expect(d.querySelector('[data-ws-part="why"]')).toBeNull();
    expect(d.textContent).not.toContain('척추가 휘지 않게 큰 바퀴가 필요해요');
    expect(within(d).getByRole('link', { name: formatCopy(COPY.product.supplyBasisLink, { name: '쳇바퀴' }) })).toHaveAttribute(
      'href',
      '/hamster/golden/supplies/wheel',
    );
  });

  it('DR B-1: 추천 이유 섹션 = 제목 + ul.ws-reasons(템플릿 li)만, 케이지 없으면 규칙 문구 0', () => {
    const d = openL7();
    const sec = d.querySelector('[data-ws-part="reasons"]') as HTMLElement;
    expect(Array.from(sec.children).map((el) => el.tagName + (el.className ? '.' + el.className.split(' ').join('.') : ''))).toEqual([
      'H3.ws-t-label.ws-supply-head',
      'UL.ws-reasons',
    ]);
    expect(Array.from(sec.querySelectorAll('ul.ws-reasons > *')).every((el) => el.tagName === 'LI')).toBe(true);
    expect(sec.textContent).not.toContain('척추가 휘지');
  });

  it('추천 이유는 템플릿 집합 밖 문구 0(상품별 자유 문구 없음), BELOW_RECOMMENDED = 최소 규격 충족', () => {
    const d = openL7('p2');
    const allowed = new Set(
      [
        formatCopy(COPY.product.reasonSpecRecommended, { animal: golden.displayName }),
        formatCopy(COPY.product.reasonSpecMinimum, { animal: golden.displayName }),
        formatCopy(COPY.product.reasonProfileTpl, { name: '쳇바퀴' }),
        COPY.product.reasonCageOk,
        COPY.product.reasonCageCheck,
        COPY.product.reasonCageBelowMin,
      ].map((x) => x),
    );
    const items = Array.from(d.querySelectorAll('.ws-reasons li')).map((li) => (li.textContent ?? '').replace(/^[✓△✕]/, ''));
    expect(items).toEqual([formatCopy(COPY.product.reasonSpecMinimum, { animal: golden.displayName })]);
    for (const t of items) expect(allowed.has(t)).toBe(true);
  });

  it('가격·판매처·"구매"·별점 0', () => {
    const d = openL7();
    fireEvent.click(within(d).getByRole('button', { name: COPY.product.findWithCondition }));
    expect((d.textContent ?? '').replace(COPY.product.priceNote, '')).not.toMatch(/구매|최저가|판매순|베스트|가격|₩|\d원|별점|★/);
  });

  it('product_viewed{productId, supplyItemId} 1회', () => {
    openL7();
    expect(calls.filter(([n]) => n === 'product_viewed')).toEqual([['product_viewed', { productId: 'p1', supplyItemId: 'wheel' }]]);
  });

  it.each([
    [null, null],
    [9, null],
    [10, '10'],
    [37, '37'],
  ])('♥ 공개 수 %s → 숫자 %s', async (n, shown) => {
    vi.spyOn(reactionCounts, 'get').mockResolvedValue({ p1: n as number | null });
    const d = openL7();
    expect(reactionCounts.get).toHaveBeenCalledWith(['p1']);
    const like = within(d).getByRole('button', { name: COPY.product.likeAria });
    if (shown === null) {
      await act(async () => undefined);
      expect(like.textContent).not.toMatch(/\d/);
    } else {
      await waitFor(() => expect(like.querySelector('.ws-like-count')).toHaveTextContent(shown));
    }
  });

  it('♥ 토글: aria-pressed, 켤 때만 reaction_like{productId}, ws.reactions.like 저장, POST/DELETE', () => {
    const d = openL7();
    const like = within(d).getByRole('button', { name: COPY.product.likeAria });
    fireEvent.click(like);
    expect(like).toHaveAttribute('aria-pressed', 'true');
    expect(like).toHaveTextContent('♥');
    expect(Object.keys(JSON.parse(localStorage.getItem(REACTIONS_KEY) as string).like)).toEqual(['p1']);
    fireEvent.click(like);
    expect(like).toHaveAttribute('aria-pressed', 'false');
    expect(calls.filter(([n]) => n === 'reaction_like')).toEqual([['reaction_like', { productId: 'p1' }]]);
    expect(vi.mocked(reactionApi.send).mock.calls.map((c) => c[0])).toEqual(['POST', 'DELETE']);
    expect(vi.mocked(reactionApi.send).mock.calls[0][1]).toEqual({ targetType: 'PRODUCT', targetId: 'p1', kind: 'LIKE' });
  });

  it('[이 조건으로 찾기](채움 하나) → SearchBlock 펼침 + 가격·판매처 안내 meta', () => {
    const d = openL7();
    expect(d.querySelector('[data-ws-part="search"]')).toBeNull();
    expect(d.querySelectorAll('.ws-btn--fill')).toHaveLength(1);
    fireEvent.click(within(d).getByRole('button', { name: COPY.product.findWithCondition }));
    expect(d.querySelector('[data-ws-part="search"]')).not.toBeNull();
    expect(d.textContent).toContain(COPY.product.priceNote);
    expect(Array.from(d.querySelectorAll('[data-ws-merchant]')).map((a) => a.getAttribute('data-ws-merchant'))).toEqual(['COUPANG', 'NAVER']);
  });

  it('케이지 호환 BELOW_MIN: ✕ 줄 + 규칙 문구, 상품은 그대로 노출 · L4 상품 순서 불변(③)', async () => {
    localStorage.setItem(
      cageKey(golden.id),
      JSON.stringify({ v: 1, type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: '2026-10-01T00:00:00.000Z' }),
    );
    const engine = {
      requirementCompat: () => ({ verdict: 'BELOW_MIN', reasons: [{ message: '케이지 높이가 바퀴보다 낮아요' }], checkedRuleIds: ['r1'] }),
      specCheck: () => ({ compat: { verdict: 'NONE', reasons: [], checkedRuleIds: [] } }),
    } as unknown as Engine;
    vi.spyOn(compatDeps, 'load').mockResolvedValue(engine);
    const d = openL7();
    await waitFor(() => expect(d.querySelector('[data-ws-reason="fail"]')).toHaveTextContent(COPY.product.reasonCageBelowMin));
    expect(d.textContent).toContain('케이지 높이가 바퀴보다 낮아요');
    // DR B-1: 케이지 등록 시 섹션 = 제목 + 템플릿 li + 호환 규칙 문구(p[data-ws-reason-note=compat])뿐.
    const sec = d.querySelector('[data-ws-part="reasons"]') as HTMLElement;
    const kids = Array.from(sec.children);
    expect(kids[0].tagName).toBe('H3');
    expect(kids[1]).toHaveClass('ws-reasons');
    expect(kids.slice(2).every((el) => el.tagName === 'P' && el.getAttribute('data-ws-reason-note') === 'compat')).toBe(true);
    expect(kids.slice(2).map((el) => el.textContent)).toEqual(['케이지 높이가 바퀴보다 낮아요']);
    expect(sec.textContent).not.toContain('척추가 휘지');
    expect(d.textContent).toContain(COPY.product.badge);
    // 같은 엔진으로 L4: 상품 순서 = ws-data
    act(() => layerStore.open('L4', { typeId: golden.id, itemId: 'wheel' }));
    const l4 = screen.getByRole('dialog', { name: '쳇바퀴' });
    const ids = Array.from(l4.querySelectorAll('li.ws-product')).map((li) => li.getAttribute('data-ws-id'));
    expect(ids).toEqual(['curatedProducts#p1', 'curatedProducts#p2', 'curatedProducts#p3']);
  });

  it('이미지는 운영자 자산(/assets/…)만', () => {
    const p = page();
    p.data.products[0] = { ...P1, imageAsset: '/assets/products/p1.webp' };
    p.data.products[1] = { ...P2, imageAsset: 'https://cdn.example.com/x.jpg' };
    let d = openL7('p1', p);
    expect(d.querySelector('img')).toHaveAttribute('src', '/assets/products/p1.webp');
    act(() => layerStore.open('L7', { typeId: golden.id, productId: 'p2' }));
    d = screen.getByRole('dialog', { name: '합성 바퀴 B' });
    expect(d.querySelector('img')).toBeNull();
  });
});

describe('ProductCard ♥(D-38)', () => {
  it('li > a + 형제 button.ws-like(a 안 button 0), 숫자 0, 켜면 reaction_like', () => {
    const { container } = render(
      <ul>
        <ProductCard product={P1} href="/hamster/golden/products/p1" specLine={null} glyph="G" />
      </ul>,
    );
    const li = container.querySelector('li.ws-product') as HTMLElement;
    expect(li.querySelector('a button')).toBeNull();
    const like = li.querySelector(':scope > button.ws-like') as HTMLElement;
    expect(like).toHaveAttribute('aria-label', COPY.product.likeAria);
    expect(like.textContent).not.toMatch(/\d/);
    fireEvent.click(like);
    expect(calls).toEqual([['reaction_like', { productId: 'p1' }]]);
  });
});
