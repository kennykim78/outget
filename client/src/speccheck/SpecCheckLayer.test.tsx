// F2-2 L5 크기 확인(286 U5a 입력 / U5b 결과 상태) + L6 내 케이지 스텝 — 합성 카탈로그(테스트 전용, 노출 시드 아님).
//   경계값(최소 정확히 OK · 1 미만 BELOW_MIN · 최소~권장 사이 BELOW_RECOMMENDED), 60×40×35 리빙박스 + 30cm 쳇바퀴 → CHECK,
//   컨텍스트 없으면 2단 미표시, spec_checker_used 제출당 1, compatibility_checked 규칙당 1, URL·이미지 입력 0,
//   카탈로그 실패 → 폼 비활성 + 안내, D-35(입력 변경 → 결과 제거), 결과에 상품·♥ 0(D-43), L6 저장 키 = 스키마 키만.
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COPY, formatCopy } from '@ws/copy';
import { COUPANG_AFFILIATE_PREFIX, buildSearchLinks, type PublicRequirement, type SpecSchema, type WsPageData } from '@ws/engine';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerPageProvider } from '../app/layerPage';
import { layerRegistry } from '../app/layerRegistry';
import { cageKey, writeCage } from '../context/cageStore';
import { setTrackerForTest, type Tracker } from '../events/track';
import { wsStorage } from '../lib/storage';
import { clearSaveState, writeSaveState } from '../save/saveStateStore';
import { golden, pageOf, product, req } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';
import { clearEngineCacheForTest } from './engine';
import SpecSearch from './SpecSearch';

const META = {
  reviewStatus: 'VERIFIED',
  reviewerType: 'EXPERIENCED_KEEPER',
  verifiedBy: null,
  verifiedAt: '2026-09-30',
  contentKind: 'SPEC',
  source: [],
};

const CAGE_SCHEMA: SpecSchema = {
  fields: [
    {
      key: 'type',
      label: '형태',
      type: 'enum',
      options: ['LIVING_BOX', 'WIRE', 'ACRYLIC', 'OTHER'],
      optionLabels: { LIVING_BOX: '리빙박스', WIRE: '철망', ACRYLIC: '아크릴 케이지', OTHER: '기타' },
    },
    { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
    { key: 'floorDcm', label: '바닥 세로(cm)', type: 'number', min: 20, max: 120 },
    { key: 'heightCm', label: '높이(cm)', type: 'number', min: 15, max: 100 },
    { key: 'barGapMm', label: '철망 간격(mm)', type: 'number', min: 3, max: 30, optional: true },
  ],
};
const WHEEL_SCHEMA: SpecSchema = {
  fields: [
    { key: 'diameterCm', label: '지름(cm)', type: 'number', min: 5, max: 60 },
    {
      key: 'surface',
      label: '바닥면',
      type: 'enum',
      options: ['SOLID', 'MESH', 'BAR'],
      optionLabels: { SOLID: '막힌 판', MESH: '망형', BAR: '봉형' },
    },
    {
      key: 'mount',
      label: '설치',
      type: 'enum',
      options: ['STAND', 'HANG'],
      optionLabels: { STAND: '스탠드형', HANG: '거는형' },
    },
    { key: 'silent', label: '무소음(베어링)', type: 'boolean', optional: true },
  ],
};
const BATH_SCHEMA: SpecSchema = { fields: [{ key: 'widthCm', label: '폭(cm)', type: 'number', min: 5, max: 60 }] };
const SAUCER_SCHEMA: SpecSchema = { fields: [{ key: 'diameterCm', label: '지름(cm)', type: 'number', min: 5, max: 60 }] };
/** QA115: ruleScoped 필드(floorType)를 가진 합성 용품 — 요구사항 minSpec 이 참조할 때만 폼에 보이고 엔진 입력에 들어간다. */
const MAT_SCHEMA: SpecSchema = {
  fields: [
    { key: 'widthCm', label: '매트 폭(cm)', type: 'number', min: 5, max: 100 },
    {
      key: 'floorType',
      label: '매트 바닥',
      type: 'enum',
      options: ['SOLID', 'MESH'],
      optionLabels: { SOLID: '막힌 바닥', MESH: '망 바닥' },
      optional: true,
      ruleScoped: true,
    },
  ],
};
const MAT_MIN = {
  rules: [
    { key: 'widthCm', op: 'gte' as const, value: 20, reason: '합성 매트 폭 사유' },
    { key: 'floorType', op: 'eq' as const, value: 'SOLID', reason: '합성 매트 바닥 사유' },
  ],
};

const WHEEL_MIN = {
  rules: [
    { key: 'diameterCm', op: 'gte' as const, value: 28, reason: '합성 최소 사유' },
    { key: 'surface', op: 'eq' as const, value: 'SOLID', reason: '합성 바닥 사유' },
  ],
};
const WHEEL_REC = { rules: [{ key: 'diameterCm', op: 'gte' as const, value: 30, reason: '합성 권장 사유' }] };
const BATH_MIN = { rules: [{ key: 'widthCm', op: 'gte' as const, value: 15, reason: '합성 폭 사유' }] };
const CAGE_MIN = {
  rules: [
    { key: 'floorWcm', op: 'gte' as const, value: 60, reason: 'r' },
    { key: 'floorDcm', op: 'gte' as const, value: 40, reason: 'r' },
    { key: 'heightCm', op: 'gte' as const, value: 30, reason: 'r' },
  ],
};

function item(id: string, name: string, specSchema: SpecSchema, alts: string[] = []) {
  return { ...META, id, name, category: 'CAGE', glyph: 'G', lifecycle: 'DURABLE', specSchema, compatibleAlternativeIds: alts, description: 'd' };
}
function creq(id: string, itemId: string, minSpec: unknown, recommendedSpec: unknown = { rules: [] }, searchKeyword: string | null = null) {
  return {
    ...META,
    id,
    careProfileId: golden.careProfileId,
    supplyItemId: itemId,
    priority: 'REQUIRED',
    orderHint: 'BEFORE_ARRIVAL',
    why: 'w',
    caution: null,
    avoid: null,
    minSpec,
    recommendedSpec,
    notNowReason: null,
    searchKeyword,
  };
}

/** 합성 공개 카탈로그(JSON — 서버 PublicCatalog 형태). 호환 규칙 2개 모두 wheel ↔ cage. */
const CATALOG = {
  v: 1,
  seedDigest: 'test-digest',
  animalTypes: [
    {
      ...META,
      id: golden.id,
      group: 'SMALL_MAMMAL',
      displayName: golden.displayName,
      status: 'ACTIVE',
      aliases: [],
      taxonId: null,
      careProfileId: golden.careProfileId,
      careOverrides: {},
    },
  ],
  careProfiles: [{ ...META, id: golden.careProfileId, name: '합성 프로필', taxonIds: [], facts: {}, careNotes: [] }],
  supplyItems: [
    item('cage', '합성 케이지', CAGE_SCHEMA),
    item('wheel', '합성 쳇바퀴', WHEEL_SCHEMA, ['saucer']),
    item('bath', '합성 모래 목욕통', BATH_SCHEMA),
    item('saucer', '합성 소서', SAUCER_SCHEMA),
    item('mat', '합성 매트', MAT_SCHEMA),
  ],
  supplyRequirements: [
    creq('r-cage', 'cage', CAGE_MIN),
    creq('r-wheel', 'wheel', WHEEL_MIN, WHEEL_REC, '{animal} 쳇바퀴 30cm'),
    creq('r-bath', 'bath', BATH_MIN),
    creq('r-saucer', 'saucer', { rules: [] }),
    creq('r-mat', 'mat', MAT_MIN),
  ],
  compatibilityRules: [
    {
      ...META,
      id: 'cr-wheel-cage',
      a: 'wheel',
      b: 'cage',
      rules: [
        { expr: 'a.diameterCm + 4 <= b.heightCm', onFail: 'BELOW_MIN', message: '합성 호환 높이 부족 문장' },
        { expr: 'a.diameterCm + 15 <= b.heightCm', onFail: 'CHECK', message: '합성 호환 베딩 문장' },
        { expr: "a.mount == 'HANG' ? b.type == 'WIRE' : true", onFail: 'CHECK', message: '합성 호환 걸이 문장' },
      ],
    },
    {
      ...META,
      id: 'cr-wheel-cage-floor',
      a: 'wheel',
      b: 'cage',
      rules: [{ expr: 'a.diameterCm <= b.floorDcm', onFail: 'CHECK', message: '합성 호환 바닥 문장' }],
    },
    {
      ...META,
      id: 'cr-mat-cage',
      a: 'mat',
      b: 'cage',
      rules: [{ expr: 'a.widthCm <= b.floorWcm', onFail: 'CHECK', message: '합성 매트 호환 문장' }],
    },
  ],
};

function preq(id: string, name: string, specSchema: SpecSchema, minSpec: PublicRequirement['minSpec'], recommendedSpec = { rules: [] } as PublicRequirement['recommendedSpec'], alternativeIds: string[] = []): PublicRequirement {
  const base = req(id, 'REQUIRED', name);
  return {
    ...base,
    minSpec,
    recommendedSpec,
    searchKeyword: `${golden.displayName} ${name}`,
    item: { ...base.item, specSchema, alternativeIds },
    source: [{ url: 'https://example.org/a', title: 'a' }],
    lastVerifiedAt: '2026-09-30',
  };
}

const PAGE = pageOf(
  'TYPE',
  {
    requirements: [
      preq('cage', '합성 케이지', CAGE_SCHEMA, CAGE_MIN),
      preq('wheel', '합성 쳇바퀴', WHEEL_SCHEMA, WHEEL_MIN, WHEEL_REC, ['saucer']),
      preq('bath', '합성 모래 목욕통', BATH_SCHEMA, BATH_MIN),
      preq('saucer', '합성 소서', SAUCER_SCHEMA, { rules: [] }),
      preq('mat', '합성 매트', MAT_SCHEMA, MAT_MIN),
    ],
    products: [product('p-wheel', 'wheel', '합성 상품 바퀴 제목')],
  },
  { typeId: golden.id, path: '/hamster/golden' },
);

// 병렬 레인이 함께 도는 무거운 환경에서도 안정적으로(지연 청크·카탈로그 로드 대기).
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });
// 지연 청크(L5) 변환을 첫 테스트 시간 밖에서 미리 — 부하 환경에서 첫 테스트만 느려지는 것 방지.
beforeAll(async () => {
  await import('./SpecCheckLayer');
}, 120_000);

let calls: Array<[string, Record<string, unknown>]>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/hamster/golden');
  clearEngineCacheForTest();
  calls = [];
  const fake: Tracker = { track: (n, p) => void calls.push([n, p as Record<string, unknown>]), flush: () => undefined, dispose: () => undefined };
  setTrackerForTest(fake);
  fetchMock = vi.fn(async () => new Response(JSON.stringify(CATALOG), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  act(() => layerStore.resetForTest());
  setTrackerForTest(null);
  vi.unstubAllGlobals();
  clearEngineCacheForTest();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

function mount() {
  render(
    <LayerPageProvider page={PAGE}>
      <LayerHost registry={layerRegistry} />
    </LayerPageProvider>,
  );
}

async function openL5(itemId: string): Promise<HTMLElement> {
  mount();
  act(() => layerStore.open('L5', { typeId: golden.id, itemId }, { url: `/hamster/golden/check/${itemId}` }));
  const d = await screen.findByRole('dialog');
  await waitFor(() => expect(d.querySelector('.ws-spec-ask')).not.toBeNull(), { timeout: 15000 }); // 지연 청크 첫 로드(286 U5a 질문 문장)
  return d;
}

const submitBtn = (d: HTMLElement) => within(d).getByRole('button', { name: COPY.checkLayer.submit });

async function ready(d: HTMLElement): Promise<void> {
  await waitFor(() => expect(submitBtn(d)).not.toBeDisabled());
}

// 286 U5b: 결과 상태는 입력 칸·[확인하기]를 걷는다 — 다시 넣으려면 「다시 입력하기」(값 유지). 아래 조작 도우미는 결과 상태면 먼저 누른다.
const reenterBtn = (d: HTMLElement) => within(d).queryByRole('button', { name: COPY.verdict.reenter });
function toInput(d: HTMLElement) {
  const b = reenterBtn(d);
  if (b) fireEvent.click(b);
}
function setNumber(d: HTMLElement, label: RegExp, v: string) {
  toInput(d);
  fireEvent.change(within(d).getByLabelText(label), { target: { value: v } });
}
function pick(d: HTMLElement, label: string) {
  toInput(d);
  fireEvent.click(within(d).getByLabelText(label));
}
function submit(d: HTMLElement) {
  toInput(d);
  fireEvent.click(submitBtn(d));
}

async function checkWheel(d: HTMLElement, diameter: string) {
  setNumber(d, /지름/, diameter);
  pick(d, '막힌 판');
  pick(d, '스탠드형');
  submit(d);
  return within(d).findByRole('region', { name: COPY.verdict.resultRegion });
}

const tiers = (r: HTMLElement) => Array.from(r.querySelectorAll('[data-ws-tier]')).map((e) => e.getAttribute('data-ws-tier'));
const pline = (r: HTMLElement) => r.querySelector('[data-ws-tier="product"]') as HTMLElement;
const named = (n: string) => calls.filter(([x]) => x === n);

function storeCage(c: Record<string, unknown>) {
  expect(writeCage(wsStorage, golden.id, c, CAGE_SCHEMA, '2026-10-03T00:00:00.000Z')).not.toBeNull();
}

describe('L5 판정 — 경계값(제품 규격 단)', () => {
  it('최소만 있는 항목: 정확히 최소 → OK, 1 미만 → BELOW_MIN', async () => {
    const d = await openL5('bath');
    await ready(d);
    setNumber(d, /폭/, '15');
    submit(d);
    let r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    expect(r).toHaveAttribute('data-ws-verdict', 'OK');
    expect(within(pline(r)).getByText(COPY.verdict.markOk)).toBeInTheDocument();

    setNumber(d, /폭/, '14');
    submit(d);
    r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    expect(r).toHaveAttribute('data-ws-verdict', 'BELOW_MIN');
    expect(within(pline(r)).getByText(COPY.verdict.markSmall)).toBeInTheDocument();
    // 286 U5b: 큰 숫자 = 요구사항 minSpec(합성 15) · 내 값 = 입력 14 · 차이 = Reason.expected − actual
    expect(r.querySelector('.ws-verdict-num--min .ws-verdict-num-value')?.textContent).toBe('15');
    expect(r.querySelector('.ws-verdict-num--mine .ws-verdict-num-value')?.textContent).toBe('14');
    expect(within(r).getByText('최소 폭보다 1cm 작아요')).toBeInTheDocument();
  }, 20000); // 파일 첫 테스트 = L5 지연 청크 콜드 로드(openL5 findByText 15s) — 기본 5s 타임아웃 초과(FE1 F1-2, 오케스트레이터 승인).

  // 286 U5b · R4 fix 4상태: OK ○ 기준 충족 · 권장 미만 △ 확인 필요(보조줄) · 최소 미달 ✕ 조금 작아요(+ 차이 줄). 글리프·단어 함께.
  it.each([
    ['30', 'OK', '○', COPY.verdict.markOk, null],
    ['28', 'BELOW_RECOMMENDED', '△', COPY.verdict.markCheck, null],
    ['29', 'BELOW_RECOMMENDED', '△', COPY.verdict.markCheck, null],
    ['27', 'BELOW_MIN', '✕', COPY.verdict.markSmall, '최소 지름보다 1cm 작아요'],
    ['25', 'BELOW_MIN', '✕', COPY.verdict.markSmall, '최소 지름보다 3cm 작아요'],
  ])('쳇바퀴 지름 %s → %s', async (dia, verdict, glyph, label, gap) => {
    const d = await openL5('wheel');
    await ready(d);
    const r = await checkWheel(d, dia);
    expect(r).toHaveAttribute('data-ws-verdict', verdict);
    const line = r.querySelector('[data-ws-tier="product"]') as HTMLElement;
    expect(line.querySelector('.ws-verdict-glyph')?.textContent).toBe(glyph);
    expect(within(line).getByText(label)).toBeInTheDocument();
    // 큰 숫자는 픽스처 요구사항 minSpec(합성 28)에서 — 시안 예시 값(27)이 아니다.
    expect(r.querySelector('.ws-verdict-num--min .ws-verdict-num-value')?.textContent).toBe('28');
    expect(r.querySelector('.ws-verdict-num--mine .ws-verdict-num-value')?.textContent).toBe(dia);
    if (verdict === 'BELOW_RECOMMENDED') expect(within(line).getByText(COPY.verdict.productBelowRecommended)).toBeInTheDocument();
    if (gap) expect(within(line).getByText(gap)).toBeInTheDocument();
    else expect(line.querySelector('.ws-verdict-gap')).toBeNull();
  });

  it('입력 누락 → CHECK(?) "판정할 정보가 더 필요해요", 범위 밖도 엔진 CHECK(D-44)', async () => {
    const d = await openL5('wheel');
    await ready(d);
    setNumber(d, /지름/, '30');
    submit(d);
    let r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    expect(r).toHaveAttribute('data-ws-verdict', 'CHECK');
    expect(within(r).getByRole('heading', { name: COPY.verdict.productCheck })).toBeInTheDocument();
    expect(within(pline(r)).getByText(COPY.verdict.markInput)).toBeInTheDocument();
    expect(pline(r).querySelector('.ws-verdict-glyph')?.textContent).toBe('?');
    // LOW-2: 「? 입력 필요」는 단의 △ 색을 이어받지 않는다 — data-ws-mark=unknown 이 ink-muted 규칙(speccheck.css)의 고리.
    expect(pline(r).querySelector('.ws-verdict-line-mark')).toHaveAttribute('data-ws-mark', 'unknown');

    pick(d, '막힌 판');
    pick(d, '스탠드형');
    setNumber(d, /지름/, '999');
    submit(d);
    r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    expect(r).toHaveAttribute('data-ws-verdict', 'CHECK');
  });
});

describe('L5 판정 — 내 환경 호환 단', () => {
  it('컨텍스트(케이지) 없으면 2단 미표시 · compatibility_checked 0 · 라이브 = 제품 판정어만', async () => {
    const d = await openL5('wheel');
    await ready(d);
    const r = await checkWheel(d, '30');
    expect(tiers(r)).toEqual(['product']);
    expect(within(r).queryByText(COPY.verdict.compatLine)).toBeNull();
    expect(named('compatibility_checked')).toHaveLength(0);
    await waitFor(() => expect(d.querySelector('[data-ws-live]')?.textContent).toBe(COPY.verdict.markOk));
    // 케이지 등록 유도 CageRow(호환 규칙이 있는 용품만) — 결과 상태에선 호환 단 자리(VerdictCard contextRow)
    expect(d.querySelector('[data-ws-cage-row="empty"]')).not.toBeNull();
  });

  it('60×40×35 리빙박스 + 30cm 쳇바퀴 → CHECK(공간 조건 재확인), compatibility_checked 규칙당 1', async () => {
    storeCage({ type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35 });
    const d = await openL5('wheel');
    await ready(d);
    expect(within(d).getByText('60×40×35cm · 리빙박스')).toBeInTheDocument();
    const r = await checkWheel(d, '30');
    expect(r).toHaveAttribute('data-ws-verdict', 'CHECK');
    expect(tiers(r)).toEqual(['product', 'compat']);
    const compat = r.querySelector('[data-ws-tier="compat"]') as HTMLElement;
    expect(within(compat).getByText(COPY.verdict.compatCheck)).toBeInTheDocument();
    expect(within(compat).getByText('합성 호환 베딩 문장')).toBeInTheDocument();
    expect(within(r).getByRole('heading', { name: formatCopy(COPY.verdict.titleOkCompatCheck, { name: '합성 쳇바퀴' }) })).toBeInTheDocument();
    expect(within(r.querySelector('[data-ws-tier="product"]') as HTMLElement).getByText(COPY.verdict.markOk)).toBeInTheDocument();
    expect(compat.querySelector('.ws-verdict-glyph')?.textContent).toBe('△'); // X1 의미: 등록 케이지 60×40×35 → 호환 △
    expect(r.querySelector('[data-ws-cage-row="set"]')).not.toBeNull(); // 2단 입력(내 케이지) 줄이 결과 안에 남는다
    await waitFor(() => expect(d.querySelector('[data-ws-live]')?.textContent).toBe(`${COPY.verdict.markOk}. ${COPY.verdict.compatCheck}`));

    expect(named('spec_checker_used')).toEqual([
      ['spec_checker_used', { animalTypeId: golden.id, supplyItemId: 'wheel', verdict: 'CHECK' }],
    ]);
    expect(named('compatibility_checked')).toEqual([
      ['compatibility_checked', { animalTypeId: golden.id, ruleId: 'cr-wheel-cage', verdict: 'CHECK' }],
      ['compatibility_checked', { animalTypeId: golden.id, ruleId: 'cr-wheel-cage-floor', verdict: 'OK' }],
    ]);
  });

  it('높이 부족 케이지 → 호환 ✕ "현재 케이지 조건에서 최소 요구 미충족"', async () => {
    storeCage({ type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 30 });
    const d = await openL5('wheel');
    await ready(d);
    const r = await checkWheel(d, '30');
    expect(r).toHaveAttribute('data-ws-verdict', 'BELOW_MIN');
    // 제품 충족 + 호환 ✕ → 제목은 성공 문장(titleOk)이 아니라 호환을 반영한 문장, 포커스도 그 제목으로
    const failTitle = within(r).getByRole('heading', { name: formatCopy(COPY.verdict.titleOkCompatBelowMin, { name: '합성 쳇바퀴' }) });
    expect(within(r).queryByRole('heading', { name: formatCopy(COPY.verdict.titleOk, { name: '합성 쳇바퀴' }) })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(failTitle));
    const compat = r.querySelector('[data-ws-tier="compat"]') as HTMLElement;
    expect(compat).toHaveAttribute('data-ws-tone', 'fail');
    expect(within(compat).getByText(COPY.verdict.compatBelowMin)).toBeInTheDocument();
  });
});

describe('L5 낭독 라이브 영역(WCAG 4.1.3)', () => {
  const live = (d: HTMLElement) => d.querySelector('[data-ws-live]') as HTMLElement | null;

  it('판정 전부터 항상 마운트된 status(polite·atomic), 판정 후 갱신, 입력 변경 후에도 유지(비움)', async () => {
    const d = await openL5('wheel');
    await ready(d);
    const el = live(d);
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('aria-live', 'polite');
    expect(el).toHaveAttribute('aria-atomic', 'true');
    expect(el?.textContent).toBe('');

    const r = await checkWheel(d, '30');
    await waitFor(() => expect(live(d)?.textContent).toBe(COPY.verdict.markOk));
    expect(live(d)).toBe(el); // 같은 노드(재삽입 아님)
    // VerdictCard 안에는 판정 라이브 속성 없음(이중 낭독 방지). 265 K6: 검색 패널이 처음부터 그려져 복사 안내 p(aria-live, 비어 있음)
    //   하나만 카드 안에 있다 — 판정 문구가 아니라 복사 확인 전용이고, 검색 블록(.ws-search) 밖에는 0.
    const lives = Array.from(r.querySelectorAll('[aria-live]'));
    expect(lives).toHaveLength(1);
    expect(lives[0].closest('.ws-search')).not.toBeNull();
    expect(lives[0].textContent).toBe('');
    expect(r.querySelector('[role="status"]')).toBeNull();

    setNumber(d, /지름/, '31'); // 다시 입력하기 + 입력 변경 → 결과 제거, 영역은 유지·비움
    expect(within(d).queryByRole('region', { name: COPY.verdict.resultRegion })).toBeNull();
    expect(live(d)).toBe(el);
    await waitFor(() => expect(live(d)?.textContent).toBe(''));

    submit(d); // 같은 문구 재판정도 다시 채워진다
    await waitFor(() => expect(live(d)?.textContent).toBe(COPY.verdict.markOk));
  });

  it('D2: 같은 입력 재제출 → ""로 갔다가 150ms 뒤 같은 문구로 다시 채워짐(변경 2회), 입력 변경 시 비움 유지', async () => {
    const d = await openL5('wheel');
    await ready(d);
    await checkWheel(d, '30');
    await waitFor(() => expect(live(d)?.textContent).toBe(COPY.verdict.markOk));
    const el = live(d) as HTMLElement;
    vi.useFakeTimers();
    try {
      submit(d); // 다시 입력하기 → 같은 입력 재제출 → 변경 1: 비움
      expect(el.textContent).toBe('');
      act(() => void vi.advanceTimersByTime(149));
      expect(el.textContent).toBe('');
      act(() => void vi.advanceTimersByTime(1));
      expect(el.textContent).toBe(COPY.verdict.markOk);

      setNumber(d, /지름/, '31'); // 입력 변경 → 비움 유지
      act(() => void vi.advanceTimersByTime(500));
      expect(el.textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('L5 이벤트', () => {
  it('spec_checker_used 는 제출마다 정확히 1(입력 변경·렌더로는 0)', async () => {
    storeCage({ type: 'LIVING_BOX', floorWcm: 80, floorDcm: 50, heightCm: 60 });
    const d = await openL5('wheel');
    await ready(d);
    expect(named('spec_checker_used')).toHaveLength(0);
    await checkWheel(d, '30');
    expect(named('spec_checker_used')).toHaveLength(1);
    setNumber(d, /지름/, '27');
    expect(named('spec_checker_used')).toHaveLength(1);
    submit(d);
    await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    submit(d); // 다시 입력하기 → 같은 입력 재제출도 제출 1회 = 1건(다시 입력하기 자체는 0)
    expect(named('spec_checker_used').map(([, p]) => p.verdict)).toEqual(['OK', 'BELOW_MIN', 'BELOW_MIN']);
    // 제출 3회 × 확인 규칙 2개
    expect(named('compatibility_checked')).toHaveLength(6);
  });
});

describe('L5 화면 규칙', () => {
  it('286 U5a 입력 상태: 제목행 「크기 확인」 · 「{동물} · {용품}」 · 질문 문장 · 기준 보조줄(요구사항 값) · 단위는 칸 안 · 채운 [확인하기] 1', async () => {
    const d = await openL5('wheel');
    await ready(d);
    expect(d).toHaveAccessibleName(COPY.checkLayer.title);
    expect(d).toHaveAccessibleDescription(`${golden.displayName} · 합성 쳇바퀴`); // 이름은 「크기 확인」 그대로, 동물·용품 줄은 설명
    expect(d.getAttribute('data-ws-layer')).toBe('L5');
    expect(within(d).getByText(`${golden.displayName} · 합성 쳇바퀴`)).toBeInTheDocument();
    expect(within(d).getByRole('heading', { name: formatCopy(COPY.checkLayer.ask, { name: '합성 쳇바퀴' }) })).toBeInTheDocument();
    expect(within(d).getByText(`${golden.displayName} ${COPY.verdict.basisSuffix} · 최소 지름 28cm 이상 · 권장 지름 30cm 이상`)).toBeInTheDocument();
    const dia = within(d).getByLabelText(/지름/) as HTMLInputElement;
    expect(within(d).getByText('지름', { selector: 'label' })).toBeInTheDocument(); // 라벨은 이름만
    const unit = document.getElementById(dia.getAttribute('aria-describedby') ?? '');
    expect(unit).toHaveClass('ws-spec-unit');
    expect(unit?.textContent).toBe('cm');
    expect(dia.closest('.ws-spec-inputwrap')).not.toBeNull();
    expect(submitBtn(d)).toHaveClass('ws-btn--fill');
    expect(submitBtn(d).textContent).toBe(COPY.checkLayer.submit);
    expect(d.querySelectorAll('.ws-btn--fill')).toHaveLength(1);
  });

  it('286 U5b 결과 상태: 입력 칸·[확인하기] 걷힘 → 채운 버튼 1 = [{용품} 기준 살펴보기](L4, 상인 링크 아님) + 「다시 입력하기」(값 유지·첫 칸 포커스, D-35)', async () => {
    const d = await openL5('wheel');
    await ready(d);
    const r = await checkWheel(d, '30');
    expect(d.querySelector('[data-ws-step="L5"]')).toHaveAttribute('data-ws-state', 'result');
    expect(within(d).queryByRole('button', { name: COPY.checkLayer.submit })).toBeNull();
    expect(d.querySelector('[data-ws-spec-form]')).toBeNull();
    // 제출 → 포커스는 결과 제목(사라진 버튼에 남지 않는다)
    const title = within(r).getByRole('heading', { name: formatCopy(COPY.verdict.titleOk, { name: '합성 쳇바퀴' }) });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(within(r).getByText(`${golden.displayName} · 합성 쳇바퀴`)).toBeInTheDocument();
    const fills = d.querySelectorAll('.ws-btn--fill');
    expect(fills).toHaveLength(1);
    expect(fills[0]).toHaveClass('ws-spec-basis');
    expect(fills[0].tagName).toBe('A');
    expect(fills[0]).toHaveAttribute('href', '/hamster/golden/supplies/wheel');
    expect(fills[0].textContent).toBe(formatCopy(COPY.verdict.seeBasis, { name: '합성 쳇바퀴' }));
    expect(fills[0].closest('.ws-search')).toBeNull();
    expect(d.querySelector('[aria-expanded]')).toBeNull();
    // ⑦ 검수 대기·DRAFT 라벨 0
    expect(d.textContent ?? '').not.toMatch(/검수 대기|DRAFT|AI_DRAFT/);

    fireEvent.click(within(d).getByRole('button', { name: COPY.verdict.reenter }));
    expect(within(d).queryByRole('region', { name: COPY.verdict.resultRegion })).toBeNull();
    const dia = within(d).getByLabelText(/지름/) as HTMLInputElement;
    expect(dia.value).toBe('30'); // 값 유지
    await waitFor(() => expect(document.activeElement).toBe(dia));
    expect(submitBtn(d)).toHaveClass('ws-btn--fill');
    expect(named('spec_checker_used')).toHaveLength(1); // 다시 입력하기는 제출이 아님

    // [{용품} 기준 살펴보기] → L4(같은 용품)
    await checkWheel(d, '30');
    fireEvent.click(d.querySelector('a.ws-spec-basis') as HTMLElement);
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-ws-layer', 'L4'));
    expect(window.location.pathname).toBe('/hamster/golden/supplies/wheel');
  });

  it('결과에 상품·♥·추천 문구 0, 대안은 SupplyItem(L4 링크), 고정 meta·검수 meta', async () => {
    const d = await openL5('wheel');
    await ready(d);
    const r = await checkWheel(d, '27');
    const text = r.textContent ?? '';
    expect(text).not.toContain('합성 상품 바퀴 제목');
    expect(text).not.toMatch(/추천|괜찮|안전|♥|♡/);
    expect(r.querySelector('.ws-like, [data-ws-product], li.ws-product')).toBeNull();
    expect(within(r).getByText(COPY.verdict.fixedNote)).toBeInTheDocument();
    expect(within(r).getByText(`${golden.displayName} ${COPY.verdict.basisSuffix} · ${COPY.supplyLayer.lastVerified} 2026.09 · ${COPY.supplyLayer.source} 1`)).toBeInTheDocument();
    const alt = within(r).getByRole('link', { name: '합성 소서' });
    expect(alt).toHaveAttribute('href', '/hamster/golden/supplies/saucer');
    fireEvent.click(alt);
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-ws-layer', 'L4'));
    expect(window.location.pathname).toBe('/hamster/golden/supplies/saucer');
  });

  it('356 일반 참고 정보 요구사항: 검수 meta 자리 = 출처 라벨(마지막 검수·출처 개수 0, 고지 문장 0 — 고지는 종 페이지 헤더 1회)', async () => {
    const giPage = pageOf(
      'TYPE',
      { ...PAGE.data, requirements: PAGE.data.requirements.map((x) => (x.supplyItemId === 'wheel' ? { ...x, lastVerifiedAt: '', source: [], generalInfo: true as const } : x)) },
      { typeId: golden.id, path: '/hamster/golden' },
    );
    render(
      <LayerPageProvider page={giPage}>
        <LayerHost registry={layerRegistry} />
      </LayerPageProvider>,
    );
    act(() => layerStore.open('L5', { typeId: golden.id, itemId: 'wheel' }, { url: '/hamster/golden/check/wheel' }));
    const d = await screen.findByRole('dialog');
    await waitFor(() => expect(d.querySelector('.ws-spec-ask')).not.toBeNull(), { timeout: 15000 });
    await ready(d);
    const r = await checkWheel(d, '27');
    expect(within(r).getByText(`${golden.displayName} ${COPY.verdict.basisSuffix} · ${COPY.supplyLayer.source} ${COPY.generalInfo.sourceLabelNone}`)).toBeInTheDocument();
    expect(r.textContent).not.toContain(COPY.supplyLayer.lastVerified);
    expect(d.textContent).not.toContain(COPY.generalInfo.notice);
  });

  it('검색: buildSearchKeyword 검색어 + 쿠팡·네이버 링크(새 탭·nofollow), external_product_clicked', async () => {
    const d = await openL5('wheel');
    await ready(d);
    const r = await checkWheel(d, '30');
    // 265 K6: 펼침 토글 없음 — 라벨(p) + 패널이 판정 뒤 처음부터. aria-expanded 0, 판정 뒤 채운 CTA 0.
    expect(within(r).queryByRole('button', { name: COPY.supplyLayer.findWithCondition })).toBeNull();
    expect(r.querySelector('[aria-expanded]')).toBeNull();
    expect(r.querySelector('.ws-spec-search > p.ws-t-label.ws-spec-muted')?.textContent).toBe(COPY.supplyLayer.findWithCondition);
    // 판정 뒤 채운 CTA = 꼬리의 [기준 살펴보기] 1개뿐(상한 규칙) — 검색·상인 블록 안 fill 0.
    expect(Array.from(d.querySelectorAll('.ws-btn--fill')).map((x) => x.className)).toEqual(['ws-btn ws-btn--fill ws-spec-basis']);
    expect(r.querySelectorAll('.ws-btn--fill')).toHaveLength(0);
    // 꺼짐(일반 검색 링크만): 고지 0, sponsored·describedby 0.
    expect(d.querySelector('[data-ws-aff]')).toBeNull();
    expect(within(r).getByText('골든햄스터 쳇바퀴 30cm')).toBeInTheDocument();
    const links = [
      within(r).getByRole('link', { name: new RegExp(`^${COPY.supplyLayer.findCoupang} ?[(]새 창[)]$`) }),
      within(r).getByRole('link', { name: new RegExp(`^${COPY.supplyLayer.findNaver} ?[(]새 창[)]$`) }),
    ];
    expect(links[0].getAttribute('href')).toMatch(/^https:\/\/www\.coupang\.com\/np\/search\?q=/);
    expect(links[1].getAttribute('href')).toMatch(/^https:\/\/search\.shopping\.naver\.com\/search\/all\?query=/);
    for (const l of links) {
      expect(l).toHaveAttribute('target', '_blank');
      expect(l.getAttribute('rel')).toBe('noopener noreferrer nofollow');
      expect(l.hasAttribute('aria-describedby')).toBe(false);
    }
    fireEvent.click(links[0]);
    expect(named('external_product_clicked')).toEqual([
      ['external_product_clicked', { animalTypeId: golden.id, supplyItemId: 'wheel', merchant: 'COUPANG' }],
    ]);
    fireEvent.click(links[1]);
    expect(named('external_product_clicked')[1]).toEqual([
      'external_product_clicked',
      { animalTypeId: golden.id, supplyItemId: 'wheel', merchant: 'NAVER' },
    ]);
  });

  it('검색: 허용 호스트 밖 href 링크는 그리지 않는다', () => {
    render(
      <SpecSearch
        animalTypeId={golden.id}
        supplyItemId="wheel"
        keyword="골든햄스터 쳇바퀴 30cm"
        links={[
          { provider: 'COUPANG', href: 'https://evil.example.com/np/search?q=x' },
          { provider: 'NAVER', href: 'https://search.shopping.naver.com/search/all?query=x' },
        ]}
      />,
    );
    expect(screen.queryByRole('button', { name: COPY.supplyLayer.findWithCondition })).toBeNull();
    expect(screen.queryByRole('link', { name: new RegExp(`^${COPY.supplyLayer.findCoupang} ?[(]새 창[)]$`) })).toBeNull();
    expect(screen.getByRole('link', { name: new RegExp(`^${COPY.supplyLayer.findNaver} ?[(]새 창[)]$`) })).toBeInTheDocument();
  });

  it('카탈로그 실패 → 폼 비활성 + 안내, 판정 0', async () => {
    fetchMock.mockImplementation(async () => new Response('nope', { status: 500 }));
    const d = await openL5('wheel');
    const notice = await waitFor(() => {
      const n = d.querySelector('[data-ws-notice="catalog"]') as HTMLElement | null;
      expect(n).not.toBeNull();
      return n as HTMLElement;
    });
    expect(notice).toHaveAttribute('data-ws-notice', 'catalog');
    expect(notice.textContent).toBe(COPY.checkLayer.unavailable);
    expect(d.querySelector('fieldset[data-ws-spec-form]')).toBeDisabled();
    expect(submitBtn(d)).toBeDisabled();
    submit(d);
    expect(named('spec_checker_used')).toHaveLength(0);
    // 요청은 동일 출처 카탈로그 1건뿐
    for (const [url] of fetchMock.mock.calls as Array<[string]>) expect(url).toMatch(/^\/data\/catalog\.v1\.[0-9a-f]{8}\.json$/);
  });
});

describe('L5 ruleScoped 필드 — 해석된 요구사항이 폼·엔진 입력을 함께 정한다(QA115)', () => {
  it('제출(:130): minSpec 이 참조하는 ruleScoped 필드가 폼에 보이고, 입력하면 엔진 판정에 반영(OK) · 비우면 CHECK', async () => {
    const d = await openL5('mat');
    await ready(d);
    expect(within(d).getByLabelText('막힌 바닥')).toBeInTheDocument(); // ruleScoped 필드 노출
    setNumber(d, /매트 폭/, '30');
    submit(d);
    let r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    expect(r).toHaveAttribute('data-ws-verdict', 'CHECK'); // floorType 미입력 → 엔진 MISSING
    expect(within(pline(r)).getByText(COPY.verdict.markInput)).toBeInTheDocument();

    pick(d, '막힌 바닥');
    submit(d);
    r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    expect(r).toHaveAttribute('data-ws-verdict', 'OK'); // 입력값이 엔진에 전달됨
    expect(within(pline(r)).getByText(COPY.verdict.markOk)).toBeInTheDocument();

    pick(d, '망 바닥');
    submit(d);
    r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    expect(r).toHaveAttribute('data-ws-verdict', 'BELOW_MIN');
    expect(named('spec_checker_used').map(([, p]) => p.verdict)).toEqual(['CHECK', 'OK', 'BELOW_MIN']);
  });

  it('케이지 변경 재판정(:80): 같은 입력의 ruleScoped 값을 유지해 다시 계산(제품 OK 유지)', async () => {
    const d = await openL5('mat');
    await ready(d);
    setNumber(d, /매트 폭/, '30');
    pick(d, '막힌 바닥');
    submit(d);
    let r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    expect(r).toHaveAttribute('data-ws-verdict', 'OK');
    expect(tiers(r)).toEqual(['product']);

    // L6 에서 케이지 등록 → L5 복귀 → 같은 입력으로 재계산(제출 아님)
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.register }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L6"]')).not.toBeNull());
    pick(d, '리빙박스');
    setNumber(d, /바닥 가로/, '60');
    setNumber(d, /바닥 세로/, '40');
    setNumber(d, /높이/, '35');
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.emptyCta }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L5"]')).not.toBeNull());

    r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    await waitFor(() => expect(tiers(r)).toEqual(['product', 'compat'])); // 재계산이 일어났다
    expect(r).toHaveAttribute('data-ws-verdict', 'OK'); // floorType 이 재판정 입력에도 남았다
    expect(within(pline(r)).getByText(COPY.verdict.markOk)).toBeInTheDocument();
    expect(named('spec_checker_used')).toHaveLength(1);

    // 케이지 수정(바닥 가로 축소 → 호환 CHECK)으로 한 번 더 재계산 — 제품 단은 여전히 OK(floorType 유지)
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.edit }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L6"]')).not.toBeNull());
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.editCta })); // R4-5: 등록한 케이지 보기 → 폼
    setNumber(d, /바닥 가로/, '25');
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.save }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L5"]')).not.toBeNull());
    r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    await waitFor(() => expect(r).toHaveAttribute('data-ws-verdict', 'CHECK'));
    expect(within(pline(r)).getByText(COPY.verdict.markOk)).toBeInTheDocument();
    expect(within(r.querySelector('[data-ws-tier="compat"]') as HTMLElement).getByText('합성 매트 호환 문장')).toBeInTheDocument();
    expect(named('spec_checker_used')).toHaveLength(1);
  });

  it('케이지 변경 재판정(:80): ruleScoped 값을 입력하지 않은 결과는 재계산 후에도 제품 CHECK', async () => {
    const d = await openL5('mat');
    await ready(d);
    setNumber(d, /매트 폭/, '30');
    submit(d);
    let r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    expect(r).toHaveAttribute('data-ws-verdict', 'CHECK');

    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.register }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L6"]')).not.toBeNull());
    pick(d, '리빙박스');
    setNumber(d, /바닥 가로/, '60');
    setNumber(d, /바닥 세로/, '40');
    setNumber(d, /높이/, '35');
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.emptyCta }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L5"]')).not.toBeNull());

    r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    await waitFor(() => expect(tiers(r)).toEqual(['product', 'compat']));
    expect(r).toHaveAttribute('data-ws-verdict', 'CHECK');
    expect(within(pline(r)).getByText(COPY.verdict.markInput)).toBeInTheDocument();
  });
});

function assertNoUrlOrImageInputs(root: HTMLElement) {
  expect(root.querySelectorAll('input[type="url"], input[type="file"], input[type="image"], textarea')).toHaveLength(0);
  for (const el of Array.from(root.querySelectorAll('input, select'))) {
    const name = el.getAttribute('name') ?? '';
    expect(name).not.toMatch(/url|link|image|img|photo|src/i);
    if (el instanceof HTMLInputElement) expect(['number', 'radio']).toContain(el.type);
  }
}

describe('L6 내 케이지 스텝', () => {
  it('URL·이미지 입력 0(L5·L6), 등록 → 저장 키 = 스키마 키만 → 이전 스텝 + 결과 재계산(이벤트 없음)', async () => {
    const d = await openL5('wheel');
    await ready(d);
    assertNoUrlOrImageInputs(d);
    await checkWheel(d, '30');
    expect(named('spec_checker_used')).toHaveLength(1);

    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.register }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L6"]')).not.toBeNull());
    expect(within(d).getByRole('heading', { name: COPY.cage.title })).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: new RegExp(COPY.cage.stepSpecCheck) })).toBeInTheDocument();
    expect(within(d).getByText(COPY.cage.deviceOnly)).toBeInTheDocument();
    assertNoUrlOrImageInputs(d);

    const save = within(d).getByRole('button', { name: COPY.cage.emptyCta });
    expect(save).toBeDisabled();
    pick(d, '리빙박스');
    expect(within(d).queryByLabelText(/철망 간격/)).toBeNull(); // WIRE 만(D7)
    setNumber(d, /바닥 가로/, '60');
    setNumber(d, /바닥 세로/, '40');
    setNumber(d, /높이/, '35');
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() => expect(d.querySelector('[data-ws-step="L5"]')).not.toBeNull());
    const stored = JSON.parse(window.localStorage.getItem(cageKey(golden.id)) ?? 'null') as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['floorDcm', 'floorWcm', 'heightCm', 'type', 'updatedAt', 'v']);
    expect(stored).toMatchObject({ v: 1, type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35 });

    expect(within(d).getByText('60×40×35cm · 리빙박스')).toBeInTheDocument();
    const r = await within(d).findByRole('region', { name: COPY.verdict.resultRegion });
    await waitFor(() => expect(tiers(r)).toEqual(['product', 'compat']));
    expect(r).toHaveAttribute('data-ws-verdict', 'CHECK');
    expect(named('spec_checker_used')).toHaveLength(1); // 재계산은 제출이 아님
  });

  it('케이지 치수 fieldset 에 legend(접근 이름 = 내 케이지)', async () => {
    const d = await openL5('wheel');
    await ready(d);
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.register }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L6"]')).not.toBeNull());
    const fs = d.querySelector('[data-ws-cage-fields]') as HTMLElement;
    expect(fs.tagName).toBe('FIELDSET');
    expect(fs.querySelector(':scope > legend')?.textContent).toBe(COPY.cage.title);
    expect(within(d).getByRole('group', { name: COPY.cage.title })).toBe(fs);
  });

  it('범위 밖 값은 [저장] 비활성(저장 0), 철망은 간격 칸이 생긴다', async () => {
    const d = await openL5('wheel');
    await ready(d);
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.register }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L6"]')).not.toBeNull());
    pick(d, '철망');
    expect(within(d).getByLabelText(/철망 간격/)).toBeInTheDocument();
    // 빈 필수 칸: 그냥 비활성, 안내 0
    expect(within(d).getByRole('button', { name: COPY.cage.emptyCta })).toBeDisabled();
    expect(within(d).queryByText(COPY.cage.outOfRange)).toBeNull();
    setNumber(d, /바닥 가로/, '300');
    setNumber(d, /바닥 세로/, '40');
    setNumber(d, /높이/, '35');
    expect(within(d).getByRole('button', { name: COPY.cage.emptyCta })).toBeDisabled();
    expect(window.localStorage.getItem(cageKey(golden.id))).toBeNull();
    // DR m-2: 범위 밖 칸만 aria-invalid + fail 테두리 + meta 안내(aria-describedby)
    const bad = within(d).getByLabelText(/바닥 가로/);
    expect(bad).toHaveAttribute('aria-invalid', 'true');
    expect(bad).toHaveClass('ws-spec-input--invalid');
    const msg = document.getElementById(bad.getAttribute('aria-describedby') ?? '');
    expect(msg).toHaveTextContent(COPY.cage.outOfRange);
    expect(within(d).getByLabelText(/바닥 세로/)).not.toHaveAttribute('aria-invalid');
    expect(within(d).getAllByText(COPY.cage.outOfRange)).toHaveLength(1);
    setNumber(d, /철망 간격/, '2');
    expect(within(d).getByLabelText(/철망 간격/)).toHaveAttribute('aria-invalid', 'true');
    // 고치면 안내 제거 + [저장] 활성
    setNumber(d, /바닥 가로/, '80');
    setNumber(d, /철망 간격/, '9');
    expect(within(d).queryByText(COPY.cage.outOfRange)).toBeNull();
    expect(within(d).getByRole('button', { name: COPY.cage.emptyCta })).not.toBeDisabled();
  });

  it('케이지가 있으면 "수정" → "등록 지우기" 로 키 삭제 후 이전 스텝', async () => {
    storeCage({ type: 'WIRE', floorWcm: 80, floorDcm: 50, heightCm: 50, barGapMm: 9 });
    const d = await openL5('wheel');
    await ready(d);
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.edit }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L6"]')).not.toBeNull());
    // R4-5: 케이지가 있으면 보기부터(폼·지우기 0) → 「등록값 수정하기」 → 폼(첫 입력 포커스)
    expect(d.querySelector('[data-ws-cage="summary"]')).not.toBeNull();
    expect(within(d).queryByRole('button', { name: COPY.cage.delete })).toBeNull();
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.editCta }));
    expect(d.querySelector('[data-ws-cage="summary"]')).toBeNull();
    expect(within(d).getByLabelText(/바닥 가로/)).toHaveValue(80);
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.delete }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L5"]')).not.toBeNull());
    expect(window.localStorage.getItem(cageKey(golden.id))).toBeNull();
    expect(d.querySelector('[data-ws-cage-row="empty"]')).not.toBeNull();
  });

  it('"이 기기에만 저장돼요"는 이메일 연결 전에만, 연결(ws.save.linked)되면 숨김 — 연결 상태 변경에 바로 반응', async () => {
    const d = await openL5('wheel');
    await ready(d);
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.register }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L6"]')).not.toBeNull());
    expect(within(d).getByText(COPY.cage.deviceOnly)).toBeInTheDocument();
    act(() => void writeSaveState(wsStorage, { linked: true, lastSyncAt: null }));
    expect(within(d).queryByText(COPY.cage.deviceOnly)).toBeNull();
    act(() => clearSaveState(wsStorage));
    expect(within(d).getByText(COPY.cage.deviceOnly)).toBeInTheDocument();
  });

  it('연결된 기기에서 L6 을 열면 처음부터 기기 저장 문구 0', async () => {
    writeSaveState(wsStorage, { linked: true, lastSyncAt: null });
    const d = await openL5('wheel');
    await ready(d);
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.register }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L6"]')).not.toBeNull());
    expect(within(d).queryByText(COPY.cage.deviceOnly)).toBeNull();
    expect(within(d).getByRole('button', { name: COPY.cage.emptyCta })).toBeInTheDocument();
  });

  it('케이지 호환 규칙이 없는 용품: 케이지 없음 → CageRow 없음', async () => {
    const d = await openL5('bath');
    await ready(d);
    expect(d.querySelector('[data-ws-cage-row]')).toBeNull();
  });

  it('DR m-8: 케이지 있음 · 규칙 없는 용품 → CageRow 자리에 compatNoRule meta(링크 0)', async () => {
    storeCage({ type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35 });
    const d = await openL5('bath');
    await ready(d);
    const row = await waitFor(() => {
      const el = d.querySelector('[data-ws-cage-row="norule"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(row).toHaveTextContent(COPY.verdict.compatNoRule);
    expect(row.querySelectorAll('a, button')).toHaveLength(0);
  });
});

describe('L5 제휴 고지(265 — K6 전부 펼침 + 261 §1·§2.5)', () => {
  const KW = `${golden.displayName} 쳇바퀴 30cm`; // 카탈로그 buildSearchKeyword 결과와 같은 값
  const AFF = buildSearchLinks(KW, { COUPANG: 'FAKE0001' });
  function affPage(keyword: string) {
    const wheel = { ...preq('wheel', '합성 쳇바퀴', WHEEL_SCHEMA, WHEEL_MIN, WHEEL_REC, ['saucer']), searchKeyword: keyword, searchLinks: AFF };
    return pageOf(
      'TYPE',
      { requirements: [preq('cage', '합성 케이지', CAGE_SCHEMA, CAGE_MIN), wheel, preq('saucer', '합성 소서', SAUCER_SCHEMA, { rules: [] })], products: [] },
      { typeId: golden.id, path: '/hamster/golden' },
    );
  }
  async function openWith(page: ReturnType<typeof affPage>): Promise<HTMLElement> {
    render(
      <LayerPageProvider page={page}>
        <LayerHost registry={layerRegistry} />
      </LayerPageProvider>,
    );
    act(() => layerStore.open('L5', { typeId: golden.id, itemId: 'wheel' }, { url: '/hamster/golden/check/wheel' }));
    const d = await screen.findByRole('dialog');
    await waitFor(() => expect(d.querySelector('.ws-spec-ask')).not.toBeNull(), { timeout: 15000 });
    return d;
  }

  it('켜짐: 키워드 일치 → 빌드 타임 제휴 링크, B = 본문 첫 요소(판정 전부터), A = 상인 버튼 바로 앞, 쿠팡 a sponsored + describedby', async () => {
    expect(AFF[0]).toEqual({ provider: 'COUPANG', kind: 'AFFILIATE', href: `${COUPANG_AFFILIATE_PREFIX}FAKE0001` });
    const d = await openWith(affPage(KW));
    const body = d.querySelector('.ws-spec-body') as HTMLElement;
    const b = body.firstElementChild as HTMLElement;
    expect(b.getAttribute('data-ws-aff')).toBe('note-b');
    expect(b.className).toBe('ws-t-meta ws-aff-note');
    expect(b.textContent).toBe(COPY.affiliate.coupang);
    await ready(d);
    const r = await checkWheel(d, '30');
    const notes = Array.from(r.querySelectorAll('[data-ws-aff="note-a"]'));
    expect(notes).toHaveLength(1);
    const a = notes[0] as HTMLElement;
    expect(a.id).toBe('ws-aff-a-wheel');
    expect(a.textContent).toBe(COPY.affiliate.coupang);
    expect(a.nextElementSibling?.className).toBe('ws-search-merchants');
    expect(a.closest('.ws-search')).not.toBeNull();
    const [cp, nv] = Array.from(r.querySelectorAll('.ws-search-merchants a'));
    expect(cp.getAttribute('href')).toBe(`${COUPANG_AFFILIATE_PREFIX}FAKE0001`);
    expect(cp.getAttribute('rel')).toBe('sponsored nofollow noopener noreferrer');
    expect(cp.getAttribute('aria-describedby')).toBe('ws-aff-a-wheel');
    expect(nv.getAttribute('href')).toMatch(/^https:\/\/search\.shopping\.naver\.com\/search\/all\?query=/);
    expect(nv.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(nv.hasAttribute('aria-describedby')).toBe(false);
    // 상인 버튼 동등(D-37): 클래스 같음, 순서 쿠팡 → 네이버.
    expect(cp.className).toBe(nv.className);
    expect(d.querySelectorAll('[data-ws-aff="note-b"]')).toHaveLength(1);
    expect(r.querySelector('[aria-expanded]')).toBeNull();
  });

  it('키워드 재계산 불일치 → 일반 링크로 다시 만들고 고지 A·B 0', async () => {
    const d = await openWith(affPage(`${golden.displayName} 합성 쳇바퀴 다른 검색어`));
    await ready(d);
    const r = await checkWheel(d, '30');
    expect(d.querySelector('[data-ws-aff]')).toBeNull();
    const cp = r.querySelector('.ws-search-merchants a') as HTMLElement;
    expect(cp.getAttribute('href')).toMatch(/^https:\/\/www\.coupang\.com\/np\/search\?q=/);
    expect(cp.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(d.querySelector('[aria-describedby^="ws-aff-a-"]')).toBeNull();
  });

  it('SpecSearch 단독: 코드 형식 위반·하위 경로 AFFILIATE·kind 위조는 그리지 않고 고지도 0', () => {
    render(
      <SpecSearch
        animalTypeId={golden.id}
        supplyItemId="wheel"
        keyword={KW}
        links={[
          { provider: 'COUPANG', kind: 'AFFILIATE', href: `${COUPANG_AFFILIATE_PREFIX}bad/../x` },
          { provider: 'NAVER', kind: 'AFFILIATE', href: `${COUPANG_AFFILIATE_PREFIX}FAKE0001` },
        ]}
      />,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(document.querySelector('[data-ws-aff]')).toBeNull();
    // R4-3(R4 시안 affiliate_candidates): 그릴 상인 링크 0 → 비활성 「상인 링크 준비 중」 1개
    expect(screen.getByRole('button', { name: COPY.supplyLayer.merchantPending })).toBeDisabled();
  });

  it('R4-3 SpecSearch: 검색어가 없으면 블록 없음, 링크가 있으면 비활성 버튼 없음', () => {
    const { container, rerender } = render(<SpecSearch animalTypeId={golden.id} supplyItemId="wheel" keyword="" links={[]} />);
    expect(container.innerHTML).toBe('');
    rerender(
      <SpecSearch
        animalTypeId={golden.id}
        supplyItemId="wheel"
        keyword={KW}
        links={[{ provider: 'NAVER', href: 'https://search.shopping.naver.com/search/all?query=x' }]}
      />,
    );
    expect(screen.queryByRole('button', { name: COPY.supplyLayer.merchantPending })).toBeNull();
  });
});

// D6-B(Kenny 2026-11-14): L5 결과 아래 「크기 확인에 도움 된 점」 — ws-data testimonials(서버 투영 = APPROVED ∧ verifiedUsage) 중
//   이 동물 ∧ SPEC_CHECK 의 첫 1건만. 0건·다른 동물·다른 행동이면 영역째 없음. 입력 상태에는 없음. 선 1개 + 텍스트(버튼·링크·사진·별점 0).
describe('L5 후기 — 크기 확인에 도움 된 점(D6-B)', () => {
  const SPEC_T = { id: 't-spec', quote: '지름을 재 보고 나서 바꿔야 할 걸 알았어요', animalTypeId: golden.id, situation: 'FIRST_TIME', linkedAction: 'SPEC_CHECK', reviewerImage: null } as const;
  function reviewPage(testimonials: WsPageData['data']['testimonials']) {
    return pageOf('TYPE', { ...PAGE.data, testimonials }, { typeId: golden.id, path: '/hamster/golden' });
  }
  async function openWithPage(page: WsPageData): Promise<HTMLElement> {
    render(
      <LayerPageProvider page={page}>
        <LayerHost registry={layerRegistry} />
      </LayerPageProvider>,
    );
    act(() => layerStore.open('L5', { typeId: golden.id, itemId: 'wheel' }, { url: '/hamster/golden/check/wheel' }));
    const d = await screen.findByRole('dialog');
    await waitFor(() => expect(d.querySelector('.ws-spec-ask')).not.toBeNull(), { timeout: 15000 });
    return d;
  }
  const reviewOf = (d: HTMLElement) => d.querySelector('[data-ws-part="review"]');
  const cleanupAll = () => {
    act(() => layerStore.resetForTest());
    cleanup();
  };

  it('0건 → 결과 상태에 영역·제목 없음(DOM 0)', async () => {
    const d = await openWithPage(reviewPage([]));
    await ready(d);
    await checkWheel(d, '26');
    expect(reviewOf(d)).toBeNull();
    expect(d.textContent).not.toContain(COPY.verdict.reviewTitle);
    expect(d.querySelector('[data-ws-id^="testimonials#"]')).toBeNull();
  });

  it('1건 → 결과 상태(BELOW_MIN·OK 모두)에 제목·원문·한 줄, 입력 상태에는 없음', async () => {
    const d = await openWithPage(reviewPage([SPEC_T]));
    await ready(d);
    expect(reviewOf(d)).toBeNull(); // 입력 상태
    let r = await checkWheel(d, '26');
    expect(r.getAttribute('data-ws-verdict')).toBe('BELOW_MIN');
    let s = reviewOf(d) as HTMLElement;
    expect(s).not.toBeNull();
    expect(s.getAttribute('data-ws-id')).toBe('testimonials#t-spec');
    expect(within(s).getByRole('heading', { level: 4 }).textContent).toBe(COPY.verdict.reviewTitle);
    expect(s.querySelector('blockquote')?.textContent).toBe(`“${SPEC_T.quote}”`);
    expect(s.textContent).toContain(`${golden.displayName} · ${COPY.situation.FIRST_TIME}`);
    // 선 1개 + 텍스트: 버튼·링크·사진·폼 없음, 결과 설명 다음 · 대안·검색 링크 앞.
    expect(s.querySelectorAll('button, a, img, input')).toHaveLength(0);
    const order = Array.from(r.querySelectorAll('[data-ws-tier="product"], [data-ws-part="review"], [data-ws-part="alternatives"], .ws-search-merchants'));
    expect(order[0].getAttribute('data-ws-tier')).toBe('product');
    expect(order[1]).toBe(s);
    expect(order.length).toBeGreaterThan(2);
    // 「다시 입력하기」 → 입력 상태: 후기 없음.
    toInput(d);
    expect(reviewOf(d)).toBeNull();
    r = await checkWheel(d, '30');
    expect(r.getAttribute('data-ws-verdict')).toBe('OK');
    s = reviewOf(d) as HTMLElement;
    expect(s).not.toBeNull();
    expect(d.querySelectorAll('[data-ws-part="review"]')).toHaveLength(1);
  });

  it('다른 동물·다른 행동(CHECKLIST·SETUP·VET)·빈 문장 후기는 비노출, 여러 건이면 첫 1건만', async () => {
    const others: WsPageData['data']['testimonials'] = [
      { ...SPEC_T, id: 't-other', animalTypeId: 'hamster-dwarf' },
      { ...SPEC_T, id: 't-cl', linkedAction: 'CHECKLIST' },
      { ...SPEC_T, id: 't-su', linkedAction: 'SETUP' },
      { ...SPEC_T, id: 't-vet', linkedAction: 'VET' },
      { ...SPEC_T, id: 't-empty', quote: '  ' },
    ];
    const d = await openWithPage(reviewPage(others));
    await ready(d);
    await checkWheel(d, '26');
    expect(reviewOf(d)).toBeNull();
    cleanupAll();
    const d2 = await openWithPage(reviewPage([...others, SPEC_T, { ...SPEC_T, id: 't-spec-2', quote: '두 번째 문장이에요' }]));
    await ready(d2);
    await checkWheel(d2, '26');
    const all = d2.querySelectorAll('[data-ws-part="review"]');
    expect(all).toHaveLength(1);
    expect(all[0].getAttribute('data-ws-id')).toBe('testimonials#t-spec');
    expect(d2.textContent).not.toContain('두 번째 문장이에요');
  });

  it('후기 영역 고정 문구에 금지어·별점·시안 자리표시 없음', async () => {
    const d = await openWithPage(reviewPage([SPEC_T]));
    await ready(d);
    await checkWheel(d, '26');
    const text = (reviewOf(d) as HTMLElement).textContent ?? '';
    for (const banned of ['괜찮', '안전하', '최저가', '판매순', '베스트', '정확도', '회원가입', '구매', '★', '별점', '예시 문구', '시안용', '자리표시', '실제 후기 아님']) {
      expect(text, banned).not.toContain(banned);
    }
  });
});
