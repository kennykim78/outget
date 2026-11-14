// F1-2 L4 React: 섹션 DOM 순서, NOT_NOW 이유, 상품 순서 = ws-data(앞 3), 가격·"구매" 0, external_product_clicked props,
//   [준비했어요] = PURCHASED(기존 ✓ 유지), data-ws-id, 👍·⚠, 내 케이지 서브카드(엔진 주입). 합성 fixture.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COPY } from '@ws/copy';
import { COUPANG_AFFILIATE_PREFIX, buildSearchLinks, type Engine, type PublicRequirement, type WsPageData } from '@ws/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerPageProvider } from '../app/layerPage';
import { layerRegistry, layerWsId } from '../app/layerRegistry';
import { setupKey } from '../checklist/setupStore';
import { setTrackerForTest, type Tracker } from '../events/track';
import { reactionApi } from '../reaction/reactionStore';
import { golden, pageOf, product, req } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';
import { splitChipText } from './SupplyLayer';
import { cageCompatOf, compatDeps } from './useCageCompat';
import Footer from '../shell/Footer';
import { layerAffiliateOn } from './searchLinks';

const loadSpecCatalogMock = vi.hoisted(() => vi.fn());
vi.mock('../speccheck/engine', async (orig) => ({ ...(await orig<typeof import('../speccheck/engine')>()), loadSpecCatalog: loadSpecCatalogMock }));

const NUM_SCHEMA ={ fields: [{ key: 'diameterCm', label: '지름(cm)', type: 'number' as const, min: 1, max: 100 }] };

function wheel(over: Partial<PublicRequirement> = {}): PublicRequirement {
  const base = req('wheel', 'REQUIRED', '쳇바퀴');
  return {
    ...base,
    why: '척추가 휘지 않게 큰 바퀴가 필요해요',
    caution: '틈에 발이 끼지 않는지 봐 주세요',
    avoid: '살 사이가 벌어진 바퀴',
    minSpec: { rules: [{ key: 'diameterCm', op: 'gte', value: 28, reason: '등이 굽지 않는 최소 지름' }] },
    recommendedSpec: { rules: [{ key: 'diameterCm', op: 'gte', value: 30, reason: '여유 있는 지름' }] },
    searchKeyword: '골든햄스터 쳇바퀴 28cm',
    searchLinks: [
      { provider: 'NAVER', href: 'https://search.shopping.naver.com/search/all?query=x' },
      { provider: 'COUPANG', href: 'https://www.coupang.com/np/search?q=x' },
    ],
    source: [{ url: 'https://example.org/a', title: '출처 A' }],
    lastVerifiedAt: '2026-09-30',
    item: { ...base.item, specSchema: NUM_SCHEMA, alternativeIds: ['saucer'] },
    ...over,
  };
}

function pageWith(reqs: PublicRequirement[], products = [product('p3', 'wheel'), product('p1', 'wheel'), product('x', 'cage'), product('p4', 'wheel'), product('p2', 'wheel')]): WsPageData {
  return pageOf('TYPE', { requirements: reqs, products }, { typeId: golden.id, path: '/hamster/golden' });
}

let calls: Array<[string, Record<string, unknown>]>;
const blockNav = (e: Event) => e.preventDefault();

beforeEach(() => {
  window.localStorage.clear();
  calls = [];
  const fake: Tracker = { track: (n, p) => void calls.push([n, p]), flush: () => undefined, dispose: () => undefined };
  setTrackerForTest(fake);
  vi.spyOn(reactionApi, 'send').mockResolvedValue(undefined);
  loadSpecCatalogMock.mockReset();
  loadSpecCatalogMock.mockRejectedValue(new Error('no catalog in test'));
  vi.spyOn(compatDeps, 'load').mockRejectedValue(new Error('no catalog in test'));
  document.addEventListener('click', blockNav);
});

afterEach(() => {
  act(() => layerStore.resetForTest());
  setTrackerForTest(null);
  vi.restoreAllMocks();
  document.removeEventListener('click', blockNav);
});

function openL4(page: WsPageData, itemId = 'wheel'): HTMLElement {
  render(
    <LayerPageProvider page={page}>
      <LayerHost registry={layerRegistry} wsIdFor={(k, p) => layerWsId(page, k, p)} />
    </LayerPageProvider>,
  );
  act(() => layerStore.open('L4', { typeId: golden.id, itemId }));
  return screen.getByRole('dialog', { name: page.data.requirements.find((r) => r.supplyItemId === itemId)?.item.name });
}

const parts = (d: HTMLElement) => Array.from(d.querySelectorAll('[data-ws-part]')).map((el) => el.getAttribute('data-ws-part'));

describe('L4 SupplyLayer', () => {
  it('섹션 DOM 순서: 왜 → 조건 → 주의 → 피할 것 → 대안 → [준비했어요] → 찾기 → 검수 → 상품', () => {
    const d = openL4(pageWith([wheel(), req('saucer', 'OPTIONAL', '접시형 바퀴')]));
    expect(parts(d)).toEqual(['why', 'conditions', 'caution', 'avoid', 'alternatives', 'ready', 'search', 'verified', 'products']);
    expect(d).toHaveAttribute('data-ws-id', 'supplyRequirements#req-wheel');
    // 꼬리: 채운 CTA 하나 = 규격 확인(→ L5 URL)
    const fills = d.querySelectorAll('.ws-btn--fill');
    expect(fills).toHaveLength(1);
    expect(fills[0]).toHaveTextContent(COPY.supplyLayer.checkSpec);
    expect(fills[0]).toHaveAttribute('href', '/hamster/golden/check/wheel');
    // 대안 → L4 링크(같은 타입)
    expect(within(d).getByRole('link', { name: '접시형 바퀴' })).toHaveAttribute('href', '/hamster/golden/supplies/saucer');
  });

  it('조건: 최소|권장 칩 텍스트 + ruleText — 이유 목록(엔진 단일 소스)', () => {
    const d = openL4(pageWith([wheel()]));
    const cond = d.querySelector('[data-ws-part="conditions"]') as HTMLElement;
    expect(cond.querySelectorAll('.ws-cond-cell')).toHaveLength(2);
    expect(cond.textContent).toContain('28cm 이상');
    expect(cond.textContent).toContain('30cm 이상');
    expect(cond.textContent).toContain('— 등이 굽지 않는 최소 지름');
    expect(cond.textContent).not.toContain('↑');
  });

  it('DR m-1: 표 값 = 숫자 span.ws-t-spec-lg("28cm") + span.ws-t-meta("이상"), dd 전체가 spec-lg 아님', () => {
    const d = openL4(pageWith([wheel()]));
    const dds = Array.from(d.querySelectorAll('.ws-cond-cell dd')) as HTMLElement[];
    expect(dds).toHaveLength(2);
    for (const dd of dds) expect(dd).not.toHaveClass('ws-t-spec-lg');
    expect(dds.map((dd) => dd.querySelector('.ws-t-spec-lg')?.textContent)).toEqual(['28cm', '30cm']);
    expect(dds.map((dd) => dd.querySelector('.ws-t-meta')?.textContent)).toEqual([COPY.spec.gte, COPY.spec.gte]);
    expect(splitChipText('60×40cm 이상')).toEqual({ value: '60×40cm', suffix: '이상' });
    expect(splitChipText('28cm')).toEqual({ value: '28cm', suffix: null });
  });

  it('NOT_NOW: 글리프 없이 "지금은 필요 없어요 — 이유"가 왜보다 앞(R4-1 — ○ 는 기준 충족 전용)', () => {
    const d = openL4(pageWith([wheel({ priority: 'NOT_NOW', notNowReason: '첫 주에는 필요 없어요' })]));
    expect(parts(d).slice(0, 2)).toEqual(['notNow', 'why']);
    const nn = d.querySelector('[data-ws-part="notNow"]') as HTMLElement;
    expect(nn.textContent).toContain(`${COPY.supplyLayer.notNow} — 첫 주에는 필요 없어요`);
    expect(nn.querySelector('.ws-glyph')).toBeNull();
    expect(nn.textContent).not.toContain('○');
  });

  it('상품 = ws-data 순서 그대로 이 용품 것만 앞 3, 링크 → L7 URL', () => {
    const d = openL4(pageWith([wheel()]));
    const ids = Array.from(d.querySelectorAll('[data-ws-part="products"] li.ws-product')).map((li) => li.getAttribute('data-ws-id'));
    expect(ids).toEqual(['curatedProducts#p3', 'curatedProducts#p1', 'curatedProducts#p4']);
    expect(d.querySelector('[data-ws-part="products"] a')).toHaveAttribute('href', '/hamster/golden/products/p3');
  });

  it('가격·판매처·"구매" 0, 금지어 0', () => {
    const d = openL4(pageWith([wheel()]));
    const text = d.textContent ?? '';
    expect(text).not.toMatch(/구매|최저가|판매순|베스트|괜찮|안전하|가격|₩|\d원/);
  });

  it('머천트 버튼: 쿠팡 → 네이버 순서 고정, 새 창 nofollow, external_product_clicked{animalTypeId, supplyItemId, merchant}', () => {
    const d = openL4(pageWith([wheel()]));
    const links = Array.from(d.querySelectorAll('[data-ws-merchant]')) as HTMLAnchorElement[];
    expect(links.map((a) => a.textContent)).toEqual([`${COPY.supplyLayer.findCoupang} ${COPY.a11y.newWindow}`, `${COPY.supplyLayer.findNaver} ${COPY.a11y.newWindow}`]);
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('rel')).toContain('nofollow');
      expect(a).toHaveClass('ws-btn--outline');
    }
    fireEvent.click(links[0]);
    expect(calls).toEqual([['external_product_clicked', { animalTypeId: golden.id, supplyItemId: 'wheel', merchant: 'COUPANG' }]]);
  });

  it('허용 호스트 밖 searchLinks 는 그리지 않는다', () => {
    const d = openL4(pageWith([wheel({ searchLinks: [{ provider: 'COUPANG', href: 'https://evil.example/x' }] })]));
    expect(d.querySelectorAll('[data-ws-merchant]')).toHaveLength(0);
  });

  it('[준비했어요]: 미체크 → PURCHASED ✓, 이미 ✓(UNKNOWN)면 그대로', () => {
    const d = openL4(pageWith([wheel(), req('cage', 'REQUIRED', '케이지')]));
    const btn = within(d).getByRole('button', { name: COPY.supplyLayer.markReady });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(JSON.parse(localStorage.getItem(setupKey(golden.id)) as string).checks.wheel.source).toBe('PURCHASED');
    expect(within(d).getByRole('button', { name: new RegExp(COPY.supplyLayer.markReady) })).toHaveAttribute('aria-pressed', 'true');
  });

  it('[준비했어요]: 기존 ✓ 출처 유지', () => {
    localStorage.setItem(
      setupKey(golden.id),
      JSON.stringify({ v: 2, firstTime: true, owned: [], answeredAt: '2026-10-01T00:00:00.000Z', startedAt: '2026-10-01T00:00:00.000Z', checks: { wheel: { source: 'OWNED', at: '2026-10-01T00:00:00.000Z' } }, reached100At: null, updatedAt: '2026-10-01T00:00:00.000Z' }),
    );
    const d = openL4(pageWith([wheel()]));
    // L3 후: 상태 칩 ✓ 준비완료
    expect(d.querySelector('.ws-state-chip')).toHaveTextContent(COPY.glyphLabel.ready);
    fireEvent.click(within(d).getByRole('button', { name: new RegExp(COPY.supplyLayer.markReady) }));
    expect(JSON.parse(localStorage.getItem(setupKey(golden.id)) as string).checks.wheel.source).toBe('OWNED');
  });

  it('L3 전: 상태 칩 없음', () => {
    const d = openL4(pageWith([wheel()]));
    expect(d.querySelector('.ws-state-chip')).toBeNull();
  });

  it('👍·⚠: aria-pressed 토글, 켤 때만 이벤트, ⚠ 후 고마움 문구, 숫자 0', () => {
    const d = openL4(pageWith([wheel()]));
    const up = within(d).getByRole('button', { name: COPY.reaction.helpful });
    const warn = within(d).getByRole('button', { name: COPY.reaction.recheck });
    fireEvent.click(up);
    expect(up).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(up);
    expect(up).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(warn);
    expect(d.textContent).toContain(COPY.reaction.recheckThanks);
    expect(calls).toEqual([
      ['reaction_helpful', { targetType: 'SUPPLY_ITEM', targetId: 'wheel' }],
      ['reaction_recheck', { targetType: 'SUPPLY_ITEM', targetId: 'wheel' }],
    ]);
    expect(d.querySelector('.ws-reactions')?.textContent).not.toMatch(/\d/);
  });

  it('내 케이지 서브카드: 케이지 없고 규칙 있으면 등록 링크(→ L5)가 대안 뒤·준비했어요 앞', async () => {
    const engine = {
      specCheck: () => ({ compat: { verdict: 'CHECK', reasons: [], checkedRuleIds: ['r1'] } }),
      requirementCompat: () => ({ verdict: 'NONE', reasons: [], checkedRuleIds: [] }),
    } as unknown as Engine;
    vi.spyOn(compatDeps, 'load').mockResolvedValue(engine);
    const d = openL4(pageWith([wheel()]));
    await waitFor(() => expect(d.querySelector('[data-ws-part="compat"]')).not.toBeNull());
    expect(parts(d)).toEqual(['why', 'conditions', 'caution', 'avoid', 'compat', 'ready', 'search', 'verified', 'products']);
    expect(within(d).getByRole('link', { name: COPY.supplyLayer.compatRegisterLink })).toHaveAttribute('href', '/hamster/golden/check/wheel');
  });
});

describe('L4 상태 칩 — 케이지 △ (홈B·L2 와 일치)', () => {
  const READY_SETUP = JSON.stringify({ v: 2, firstTime: true, owned: [], answeredAt: '2026-10-01T00:00:00.000Z', startedAt: '2026-10-01T00:00:00.000Z', checks: { wheel: { source: 'OWNED', at: '2026-10-01T00:00:00.000Z' } }, reached100At: null, updatedAt: '2026-10-01T00:00:00.000Z' });
  const CAGE = JSON.stringify({ v: 1, type: 'WIRE', floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: '2026-10-01T00:00:00.000Z' });
  const CAGE_SCHEMA = {
    fields: [
      { key: 'type', label: '형태', type: 'enum' as const, options: ['WIRE', 'LIVING_BOX'], optionLabels: { WIRE: '철망', LIVING_BOX: '리빙박스' } },
      { key: 'floorWcm', label: '가로', type: 'number' as const, min: 1, max: 300 },
      { key: 'floorDcm', label: '세로', type: 'number' as const, min: 1, max: 300 },
      { key: 'heightCm', label: '높이', type: 'number' as const, min: 1, max: 300 },
    ],
  };
  const engine = {
    specCheck: () => ({ compat: { verdict: 'CHECK', reasons: [], checkedRuleIds: [] } }),
    requirementCompat: () => ({ verdict: 'CHECK', reasons: [], checkedRuleIds: ['r1'] }),
  } as unknown as Engine;

  it('케이지 있음 + 호환 CHECK: 준비했어도 칩이 △ 확인 필요', async () => {
    localStorage.setItem(setupKey(golden.id), READY_SETUP);
    localStorage.setItem(`ws.context.${golden.id}.cage`, CAGE);
    loadSpecCatalogMock.mockResolvedValue({ engine, catalog: {} });
    const cageReq = req('cage', 'REQUIRED', '케이지');
    cageReq.item = { ...cageReq.item, specSchema: CAGE_SCHEMA };
    const d = openL4(pageWith([wheel(), cageReq]));
    await waitFor(() => expect(d.querySelector('.ws-state-chip')).toHaveTextContent(COPY.glyphLabel.check));
  });

  it('케이지 있음 + 카탈로그 로드 중: 거짓 ✓ 확정 없음(칩 보류)', async () => {
    localStorage.setItem(setupKey(golden.id), READY_SETUP);
    localStorage.setItem(`ws.context.${golden.id}.cage`, CAGE);
    loadSpecCatalogMock.mockReturnValue(new Promise(() => undefined));
    const cageReq = req('cage', 'REQUIRED', '케이지');
    cageReq.item = { ...cageReq.item, specSchema: CAGE_SCHEMA };
    const d = openL4(pageWith([wheel(), cageReq]));
    await waitFor(() => expect(loadSpecCatalogMock).toHaveBeenCalled());
    expect(d.querySelector('.ws-state-chip')).toBeNull();
  });

  it('케이지 없음: 기존 ✓ 준비완료, 체크리스트용 카탈로그 요청 0', () => {
    localStorage.setItem(setupKey(golden.id), READY_SETUP);
    loadSpecCatalogMock.mockClear();
    const d = openL4(pageWith([wheel()]));
    expect(d.querySelector('.ws-state-chip')).toHaveTextContent(COPY.glyphLabel.ready);
    expect(loadSpecCatalogMock).not.toHaveBeenCalled();
  });
});

describe('cageCompatOf(엔진 위임)', () => {
  const ctx = { ownedItems: { cage: { type: 'WIRE', floorWcm: 60, floorDcm: 40, heightCm: 35 } } };
  it('케이지 있음: requirementCompat 결과, NONE → 서브카드 없음', () => {
    const e = (verdict: string) =>
      ({ requirementCompat: () => ({ verdict, reasons: [{ message: 'm' }], checkedRuleIds: ['r'] }) }) as unknown as Engine;
    expect(cageCompatOf(e('CHECK'), golden.id, 'wheel', ctx)).toMatchObject({ state: 'result', verdict: 'CHECK' });
    expect(cageCompatOf(e('NONE'), golden.id, 'wheel', ctx)).toEqual({ state: 'none' });
  });
  it('케이지 용품 자신·엔진 오류 → none', () => {
    const boom = { requirementCompat: () => { throw new Error('x'); } } as unknown as Engine;
    expect(cageCompatOf(boom, golden.id, 'wheel', ctx)).toEqual({ state: 'none' });
    expect(cageCompatOf(boom, golden.id, 'cage', ctx)).toEqual({ state: 'none' });
  });
});

describe('L4 내 케이지 서브카드 meta 문구 — usedRecommended(작업 179, 디자인 177: 문구 출처만 분기)', () => {
  const CAGE = JSON.stringify({ v: 1, type: 'WIRE', floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: '2026-10-01T00:00:00.000Z' });
  const CAGE_SCHEMA = {
    fields: [
      { key: 'type', label: '형태', type: 'enum' as const, options: ['WIRE', 'LIVING_BOX'], optionLabels: { WIRE: '철망', LIVING_BOX: '리빙박스' } },
      { key: 'floorWcm', label: '가로', type: 'number' as const, min: 1, max: 300 },
      { key: 'floorDcm', label: '세로', type: 'number' as const, min: 1, max: 300 },
      { key: 'heightCm', label: '높이', type: 'number' as const, min: 1, max: 300 },
    ],
  };
  const withCage = () => {
    const cageReq = req('cage', 'REQUIRED', '케이지');
    cageReq.item = { ...cageReq.item, specSchema: CAGE_SCHEMA };
    return pageWith([wheel(), cageReq]);
  };
  const engineWith = (compat: Record<string, unknown>) =>
    ({
      specCheck: () => ({ compat: { verdict: 'CHECK', reasons: [], checkedRuleIds: ['r1'] } }),
      requirementCompat: () => compat,
    }) as unknown as Engine;
  const metaTexts = (d: HTMLElement) => Array.from(d.querySelectorAll('[data-ws-part="compat"] .ws-t-meta')).map((el) => el.textContent);

  it('usedRecommended true → 권장 규격 문구, 기존 문구 없음', async () => {
    localStorage.setItem(`ws.context.${golden.id}.cage`, CAGE);
    vi.spyOn(compatDeps, 'load').mockResolvedValue(engineWith({ verdict: 'OK', reasons: [], checkedRuleIds: ['r1'], usedRecommended: true }));
    const d = openL4(withCage());
    await waitFor(() => expect(d.querySelector('.ws-compat')).not.toBeNull());
    expect(metaTexts(d)).toContain(COPY.supplyLayer.compatSubNoteRecommended);
    expect(metaTexts(d)).not.toContain(COPY.supplyLayer.compatSubNote);
    // R4-1: 호환 OK = L5 호환 단과 같은 ○(✓ 아님).
    expect(d.querySelector('.ws-compat-verdict [data-ws-glyph="ok"]')).toHaveTextContent('○');
  });

  it('usedRecommended 없음 → 기존 최소 규격 문구', async () => {
    localStorage.setItem(`ws.context.${golden.id}.cage`, CAGE);
    vi.spyOn(compatDeps, 'load').mockResolvedValue(engineWith({ verdict: 'CHECK', reasons: [], checkedRuleIds: ['r1'] }));
    const d = openL4(withCage());
    await waitFor(() => expect(d.querySelector('.ws-compat')).not.toBeNull());
    expect(metaTexts(d)).toContain(COPY.supplyLayer.compatSubNote);
    expect(metaTexts(d)).not.toContain(COPY.supplyLayer.compatSubNoteRecommended);
  });

  it('케이지 없음 → 등록 링크 유지, 두 문구 모두 없음', async () => {
    vi.spyOn(compatDeps, 'load').mockResolvedValue(engineWith({ verdict: 'OK', reasons: [], checkedRuleIds: ['r1'], usedRecommended: true }));
    const d = openL4(withCage());
    await waitFor(() => expect(d.querySelector('[data-ws-part="compat"]')).not.toBeNull());
    expect(within(d).getByRole('link', { name: COPY.supplyLayer.compatRegisterLink })).toHaveAttribute('href', '/hamster/golden/check/wheel');
    expect(d.querySelector('.ws-compat')).toBeNull();
    expect(d.textContent).not.toContain(COPY.supplyLayer.compatSubNoteRecommended);
    expect(d.textContent).not.toContain(COPY.supplyLayer.compatSubNote);
  });

  it('cageCompatOf: 엔진 usedRecommended 를 그대로 전달, 없으면 필드 생략', () => {
    const ctx = { ownedItems: { cage: { type: 'WIRE', floorWcm: 60, floorDcm: 40, heightCm: 35 } } };
    const on = engineWith({ verdict: 'OK', reasons: [], checkedRuleIds: ['r'], usedRecommended: true });
    const off = engineWith({ verdict: 'OK', reasons: [], checkedRuleIds: ['r'] });
    expect(cageCompatOf(on, golden.id, 'wheel', ctx)).toEqual({ state: 'result', verdict: 'OK', reasons: [], usedRecommended: true });
    expect(cageCompatOf(off, golden.id, 'wheel', ctx)).toEqual({ state: 'result', verdict: 'OK', reasons: [] });
  });
});

describe('L4 제휴 고지(265 — 261 §1·§2.2)', () => {
  it('켜짐: B = .ws-supply 첫 자식, A = 상인 버튼 바로 앞, 쿠팡 a sponsored + describedby', () => {
    const d = openL4(pageWith([wheel({ searchLinks: buildSearchLinks('골든햄스터 쳇바퀴 28cm', { COUPANG: 'FAKE0001' }) })]));
    const b = (d.querySelector('.ws-supply') as HTMLElement).firstElementChild as HTMLElement;
    expect(b.getAttribute('data-ws-aff')).toBe('note-b');
    expect(b.className).toBe('ws-t-meta ws-aff-note');
    expect(b.textContent).toBe(COPY.affiliate.coupang);
    const a = d.querySelector('[data-ws-aff="note-a"]') as HTMLElement;
    expect(a.id).toBe('ws-aff-a-wheel');
    expect(a.nextElementSibling?.className).toBe('ws-search-merchants');
    const cp = d.querySelector('[data-ws-merchant="COUPANG"]') as HTMLElement;
    expect(cp.getAttribute('href')).toBe(`${COUPANG_AFFILIATE_PREFIX}FAKE0001`);
    expect(cp.getAttribute('rel')).toBe('sponsored nofollow noopener noreferrer');
    expect(cp.getAttribute('aria-describedby')).toBe('ws-aff-a-wheel');
    const nv = d.querySelector('[data-ws-merchant="NAVER"]') as HTMLElement;
    expect(nv.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(Array.from(d.querySelectorAll('[data-ws-merchant]')).map((x) => x.getAttribute('data-ws-merchant'))).toEqual(['COUPANG', 'NAVER']);
  });

  it('꺼짐(일반 검색 링크만): 고지 0, sponsored·describedby 0', () => {
    const d = openL4(pageWith([wheel()]));
    expect(d.querySelector('[data-ws-aff]')).toBeNull();
    expect(d.querySelector('[aria-describedby^="ws-aff-a-"]')).toBeNull();
    for (const x of Array.from(d.querySelectorAll('[data-ws-merchant]'))) expect(x.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });
});

// R4-3(R4 시안 affiliate_candidates): 상인 링크(URL) 0 → 비활성 「상인 링크 준비 중」, 푸터 고지 F 판정(layerAffiliateOn)·Footer 렌더.
describe('R4-3 상인 링크 준비 중 · 푸터 고지 F', () => {
  it('렌더 필터를 통과한 링크 0(빈 배열·허용 밖 href) → disabled 버튼 1, 상인 a·고지 0', () => {
    for (const links of [[], [{ provider: 'COUPANG' as const, href: 'https://evil.example/np/search?q=x' }]]) {
      const d = openL4(pageWith([wheel({ searchLinks: links })]));
      const merchants = d.querySelector('.ws-search-merchants') as HTMLElement;
      const btn = within(merchants).getByRole('button', { name: COPY.supplyLayer.merchantPending });
      expect(btn).toBeDisabled();
      expect(merchants.querySelectorAll('a')).toHaveLength(0);
      expect(d.querySelector('[data-ws-aff]')).toBeNull();
      act(() => layerStore.resetForTest());
      cleanup();
    }
  });

  it('링크가 있으면 비활성 버튼 없음(꺼짐·켜짐 모두)', () => {
    const off = openL4(pageWith([wheel()]));
    expect(within(off).queryByRole('button', { name: COPY.supplyLayer.merchantPending })).toBeNull();
  });

  it('layerAffiliateOn: L4·L7 의 요구사항에 제휴 링크가 그려질 때만 true(L5·닫힘·대상 없음 false)', () => {
    const aff = wheel({ searchLinks: buildSearchLinks('골든햄스터 쳇바퀴 28cm', { COUPANG: 'FAKE0001' }) });
    const on = pageWith([aff]);
    const off = pageWith([wheel()]);
    expect(layerAffiliateOn(on, { kind: 'L4', props: { typeId: golden.id, itemId: 'wheel' } })).toBe(true);
    expect(layerAffiliateOn(on, { kind: 'L7', props: { typeId: golden.id, productId: 'p1' } })).toBe(true);
    expect(layerAffiliateOn(on, { kind: 'L7', props: { typeId: golden.id, productId: 'x' } })).toBe(false); // cage 요구사항 없음
    expect(layerAffiliateOn(on, { kind: 'L5', props: { typeId: golden.id, itemId: 'wheel' } })).toBe(false);
    expect(layerAffiliateOn(on, null)).toBe(false);
    expect(layerAffiliateOn(off, { kind: 'L4', props: { typeId: golden.id, itemId: 'wheel' } })).toBe(false);
    // 허용 필터 밖 AFFILIATE 는 고지도 켜지 않는다(A·B 와 같은 판정)
    const forged = pageWith([wheel({ searchLinks: [{ provider: 'COUPANG', kind: 'AFFILIATE', href: `${COUPANG_AFFILIATE_PREFIX}bad/../x` }] })]);
    expect(layerAffiliateOn(forged, { kind: 'L4', props: { typeId: golden.id, itemId: 'wheel' } })).toBe(false);
  });

  it('Footer: affNote 일 때만 © 바로 앞에 원문 고지 F(전부 펼침), 아니면 이전과 같은 DOM', () => {
    const { container, rerender } = render(<Footer />);
    const f = container.querySelector('footer.ws-footer') as HTMLElement;
    expect(f.querySelector('[data-ws-aff]')).toBeNull();
    const offHtml = f.innerHTML;
    rerender(<Footer affNote />);
    const note = f.querySelector('[data-ws-aff="note-f"]') as HTMLElement;
    expect(note.className).toBe('ws-t-meta ws-aff-note');
    expect(note.textContent).toBe(COPY.affiliate.coupang);
    expect(note.children).toHaveLength(0);
    expect(note.nextElementSibling?.className).toBe('ws-footer-copy');
    expect(note.parentElement).toBe(f);
    rerender(<Footer affNote={false} />);
    expect(f.innerHTML).toBe(offHtml);
  });
});
