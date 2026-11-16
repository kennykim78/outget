// F2-3 L2 통합: 행 › → L4 push(뒤로 L2) · 꼬리 저장 → L8 push + save_prompt_view{l2_footer} ·
//   케이지 "보유" 행 → "내 케이지 등록 ›" → L6 스텝(뒤로 = 지금 필요한 것) → 저장 → L2 △(엔진 requirementCompat) ·
//   케이지 없으면 카탈로그 요청 0·상태 영향 0. 합성 fixture·카탈로그(테스트 전용).
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COPY, GLYPH } from '@ws/copy';
import type { PublicRequirement, SpecSchema } from '@ws/engine';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerPageProvider } from '../app/layerPage';
import { layerRegistry } from '../app/layerRegistry';
import { cageKey, writeCage } from '../context/cageStore';
import { setTrackerForTest, type Tracker } from '../events/track';
import { wsStorage } from '../lib/storage';
import { writeSaveState } from '../save/saveStateStore';
import { clearEngineCacheForTest } from '../speccheck/engine';
import { golden, pageOf, req } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';
import { writeSetup, type SetupV2 } from './setupStore';

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
    { key: 'type', label: '형태', type: 'enum', options: ['LIVING_BOX', 'WIRE', 'ACRYLIC', 'OTHER'], optionLabels: { LIVING_BOX: '리빙박스', WIRE: '철망', ACRYLIC: '아크릴 케이지', OTHER: '기타' } },
    { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
    { key: 'floorDcm', label: '바닥 세로(cm)', type: 'number', min: 20, max: 120 },
    { key: 'heightCm', label: '높이(cm)', type: 'number', min: 15, max: 100 },
    { key: 'barGapMm', label: '철망 간격(mm)', type: 'number', min: 3, max: 30, optional: true },
  ],
};
const WHEEL_SCHEMA: SpecSchema = { fields: [{ key: 'diameterCm', label: '지름(cm)', type: 'number', min: 5, max: 60 }] };
const WHEEL_MIN = { rules: [{ key: 'diameterCm', op: 'gte' as const, value: 28, reason: 'r' }] };
const CAGE_MIN = { rules: [{ key: 'floorWcm', op: 'gte' as const, value: 60, reason: 'r' }, { key: 'floorDcm', op: 'gte' as const, value: 40, reason: 'r' }] };

const item = (id: string, specSchema: SpecSchema) => ({ ...META, id, name: id, category: 'CAGE', glyph: 'G', lifecycle: 'DURABLE', specSchema, compatibleAlternativeIds: [], description: 'd' });
const creq = (id: string, minSpec: unknown) => ({
  ...META,
  id: `r-${id}`,
  careProfileId: golden.careProfileId,
  supplyItemId: id,
  priority: 'REQUIRED',
  orderHint: 'BEFORE_ARRIVAL',
  why: 'w',
  caution: null,
  avoid: null,
  minSpec,
  recommendedSpec: { rules: [] },
  notNowReason: null,
  searchKeyword: null,
});
const CATALOG = {
  v: 1,
  seedDigest: 't',
  animalTypes: [{ ...META, id: golden.id, group: 'SMALL_MAMMAL', displayName: golden.displayName, status: 'ACTIVE', aliases: [], taxonId: null, careProfileId: golden.careProfileId, careOverrides: {} }],
  careProfiles: [{ ...META, id: golden.careProfileId, name: 'p', taxonIds: [], facts: {}, careNotes: [] }],
  supplyItems: [item('cage', CAGE_SCHEMA), item('wheel', WHEEL_SCHEMA)],
  supplyRequirements: [creq('cage', CAGE_MIN), creq('wheel', WHEEL_MIN)],
  compatibilityRules: [
    {
      ...META,
      id: 'cr-wheel-cage',
      a: 'wheel',
      b: 'cage',
      rules: [
        { expr: 'a.diameterCm + 4 <= b.heightCm', onFail: 'BELOW_MIN', message: 'm1' },
        { expr: 'a.diameterCm + 15 <= b.heightCm', onFail: 'CHECK', message: 'm2' },
      ],
    },
  ],
};

function preq(id: string, name: string, specSchema: SpecSchema, minSpec: PublicRequirement['minSpec']): PublicRequirement {
  const base = req(id, 'REQUIRED', name);
  return { ...base, minSpec, item: { ...base.item, specSchema } };
}
const PAGE = pageOf(
  'TYPE',
  { requirements: [preq('cage', '합성케이지', CAGE_SCHEMA, CAGE_MIN), preq('wheel', '합성바퀴', WHEEL_SCHEMA, WHEEL_MIN)] },
  { typeId: golden.id, path: '/hamster/golden' },
);

function answered(checks: Record<string, 'OWNED' | 'UNKNOWN'>): SetupV2 {
  const at = '2026-10-01T00:00:00.000Z';
  return {
    v: 2,
    firstTime: false,
    owned: Object.keys(checks).filter((k) => checks[k] === 'OWNED'),
    answeredAt: at,
    startedAt: at,
    checks: Object.fromEntries(Object.entries(checks).map(([k, s]) => [k, { source: s, at }])),
    reached100At: null,
    updatedAt: at,
  };
}

// 병렬 레인이 함께 도는 무거운 환경에서도 안정적으로(지연 청크·카탈로그 로드 대기).
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });
// 지연 청크(L8·L5) 변환을 테스트 시간 밖에서 미리.
beforeAll(async () => {
  await Promise.all([import('../save/SaveLayer'), import('../speccheck/SpecCheckLayer')]);
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
  fetchMock = vi.fn(async () => new Response(JSON.stringify(CATALOG), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <LayerPageProvider page={PAGE}>
      <LayerHost registry={layerRegistry} />
    </LayerPageProvider>,
  );
});
afterEach(() => {
  act(() => layerStore.resetForTest());
  setTrackerForTest(null);
  vi.unstubAllGlobals();
  clearEngineCacheForTest();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

function openL2(): HTMLElement {
  act(() => layerStore.open('L2', { typeId: golden.id }));
  return screen.getByRole('dialog');
}
const rowState = (d: HTMLElement, id: string) => d.querySelector(`[data-ws-id="supplyRequirements#${id}"]`)?.getAttribute('data-ws-state');

describe('L2 통합(F2-3)', () => {
  it('행 › → L4 push(URL·제목), 뒤로 = L2', async () => {
    writeSetup(wsStorage, golden.id, answered({}));
    const d = openL2();
    const more = d.querySelector('[data-ws-id="supplyRequirements#wheel"] a.ws-check-more') as HTMLAnchorElement;
    fireEvent.click(more);
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-ws-layer', 'L4'));
    expect(window.location.pathname).toBe('/hamster/golden/supplies/wheel');
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-ws-layer', 'L2'));
  });

  it('꼬리 저장 링크 → L8 push, save_prompt_view{entry:l2_footer} 정확히 1회', async () => {
    writeSetup(wsStorage, golden.id, answered({}));
    const d = openL2();
    fireEvent.click(within(d).getByRole('link', { name: new RegExp(COPY.checklist.saveAsk) }));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-ws-layer', 'L8'));
    expect(window.location.pathname).toBe('/save');
    // L8(SaveLayer, 지연 청크)이 깊이로 l2_footer 를 판정해 1회 — 진입점은 따로 보내지 않는다(중복 0).
    await waitFor(() => expect(calls.filter(([n]) => n === 'save_prompt_view').length).toBeGreaterThan(0), { timeout: 15000 });
    expect(calls.filter(([n]) => n === 'save_prompt_view')).toEqual([['save_prompt_view', { entry: 'l2_footer' }]]);
  });

  it('DR-3 m-13: L2 — 연결 전 "이 기기에만 저장돼요" 1개, 이메일 연결(ws.save linked) 후 0개', () => {
    writeSetup(wsStorage, golden.id, answered({}));
    const d = openL2();
    expect((d.textContent ?? '').split(COPY.homeB.deviceOnly).length).toBe(2);
    act(() => void writeSaveState(wsStorage, { linked: true, lastSyncAt: null }));
    expect(d.textContent ?? '').not.toContain(COPY.homeB.deviceOnly);
    expect(within(d).getByRole('link', { name: COPY.checklist.saveLinked })).toHaveAttribute('href', '/save');
    expect(within(d).queryByRole('link', { name: new RegExp(COPY.checklist.saveAsk) })).toBeNull();
  });

  it('저장 링크 문구: 미연결 → saveAsk ›, 연결 → saveLinked(› 중복 없음)', () => {
    writeSetup(wsStorage, golden.id, answered({}));
    const d = openL2();
    expect(within(d).getByRole('link', { name: `${COPY.checklist.saveAsk} ›` })).toHaveAttribute('href', '/save');
    expect(within(d).queryByRole('link', { name: COPY.checklist.saveLinked })).toBeNull();
    act(() => void writeSaveState(wsStorage, { linked: true, lastSyncAt: null }));
    const a = within(d).getByRole('link', { name: COPY.checklist.saveLinked });
    expect(a.textContent).toBe(COPY.checklist.saveLinked);
    expect(a.textContent).not.toContain('››');
  });

  it('케이지 없음 → 카탈로그 요청 0, 상태 = 체크 그대로, 케이지 링크 0(보유 아님)', () => {
    writeSetup(wsStorage, golden.id, answered({ wheel: 'UNKNOWN' }));
    const d = openL2();
    expect(rowState(d, 'wheel')).toBe('READY');
    expect(rowState(d, 'cage')).toBe('FIRST');
    expect(within(d).queryByRole('button', { name: COPY.supplyLayer.cageEntryRegister })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('케이지 "보유" → 등록 › → L6(뒤로 = 지금 필요한 것) → 저장 → L2, 바퀴 △(호환 CHECK)', async () => {
    writeSetup(wsStorage, golden.id, answered({ cage: 'OWNED', wheel: 'UNKNOWN' }));
    const d = openL2();
    expect(rowState(d, 'wheel')).toBe('READY');
    fireEvent.click(within(d).getByRole('button', { name: COPY.supplyLayer.cageEntryRegister }));
    await waitFor(() => expect(d.querySelector('[data-ws-step="L6"]')).not.toBeNull());
    expect(within(d).getByRole('heading', { name: COPY.cage.title })).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: new RegExp(COPY.cage.stepNow) })).toBeInTheDocument();
    expect(d.querySelectorAll('input[type="url"], input[type="file"], input[type="image"]')).toHaveLength(0);

    fireEvent.click(within(d).getByLabelText('리빙박스'));
    fireEvent.change(within(d).getByLabelText(/바닥 가로/), { target: { value: '60' } });
    fireEvent.change(within(d).getByLabelText(/바닥 세로/), { target: { value: '40' } });
    fireEvent.change(within(d).getByLabelText(/높이/), { target: { value: '35' } });
    fireEvent.click(within(d).getByRole('button', { name: COPY.cage.emptyCta }));

    await waitFor(() => expect(d.querySelector('[data-ws-step="L2"]')).not.toBeNull());
    expect(window.localStorage.getItem(cageKey(golden.id))).not.toBeNull();
    expect(within(d).getByRole('button', { name: COPY.supplyLayer.cageEntryEdit })).toBeInTheDocument();
    await waitFor(() => expect(rowState(d, 'wheel')).toBe('CHECK'));
    expect(rowState(d, 'cage')).toBe('READY'); // 케이지 자신은 호환 대상 아님
    // DR n-5: 호환이 만든 △ 의 이유 meta
    const wheelRow = d.querySelector('[data-ws-id="supplyRequirements#wheel"]') as HTMLElement;
    expect(within(wheelRow).getByText(COPY.product.reasonCageCheck)).toHaveAttribute('data-ws-compat', 'CHECK');
    // 286 U6: 상태칩 없이 △ 글리프 + 상태 문구(시각 숨김) + 이유 한 줄 — 색만으로 말하지 않는다.
    expect(wheelRow.querySelector('[data-ws-glyph="check"]')).toHaveTextContent(GLYPH.check);
    expect(within(wheelRow).getByRole('checkbox')).toHaveAccessibleName(new RegExp(COPY.glyphLabel.check));
    expect(d.querySelector('[data-ws-id="supplyRequirements#cage"] [data-ws-compat]')).toBeNull();
  });

  it('arch-23 ③: 등록 케이지가 최소 규격 미달(가로 50 < 60) → 케이지 행 △ + "내 케이지 · 최소 규격 미달", 충족하는 값으로 고치면 ✓ 복귀', async () => {
    writeSetup(wsStorage, golden.id, answered({ cage: 'OWNED' }));
    const d = openL2();
    expect(rowState(d, 'cage')).toBe('READY');
    act(() => {
      writeCage(wsStorage, golden.id, { type: 'LIVING_BOX', floorWcm: 50, floorDcm: 40, heightCm: 60 }, CAGE_SCHEMA, '2026-10-13T00:00:00.000Z');
    });
    await waitFor(() => expect(rowState(d, 'cage')).toBe('CHECK'));
    const row = d.querySelector('[data-ws-id="supplyRequirements#cage"]') as HTMLElement;
    expect(within(row).getByText(`${COPY.cage.title} · ${COPY.verdict.productBelowMin}`)).toHaveAttribute('data-ws-compat', 'SPEC_FAIL');
    act(() => {
      writeCage(wsStorage, golden.id, { type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 60 }, CAGE_SCHEMA, '2026-10-13T00:00:00.000Z');
    });
    await waitFor(() => expect(rowState(d, 'cage')).toBe('READY'));
    expect(row.querySelector('[data-ws-compat]')).toBeNull();
  });

  it('arch-23 ③ 미연결: 케이지 미등록이면 L5 에서 미달 값을 넣어도 케이지 행은 READY 그대로(저장소 무변경)', async () => {
    writeSetup(wsStorage, golden.id, answered({ cage: 'OWNED' }));
    const d = openL2();
    await waitFor(() => expect(rowState(d, 'cage')).toBe('READY'));
    expect(window.localStorage.getItem(cageKey(golden.id))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled(); // 케이지 없음 → 판정 경로 자체가 없다
  });

  it('DR m-3: 보유 아님 + 케이지 저장됨 → "내 케이지 수정 ›" 표시, 저장이 행을 보유로 바꾸지 않음', async () => {
    writeSetup(wsStorage, golden.id, answered({}));
    const d = openL2();
    expect(within(d).queryByRole('button', { name: COPY.supplyLayer.cageEntryRegister })).toBeNull();
    act(() => {
      writeCage(wsStorage, golden.id, { type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 30 }, CAGE_SCHEMA, '2026-10-13T00:00:00.000Z');
    });
    const edit = await within(d).findByRole('button', { name: COPY.supplyLayer.cageEntryEdit });
    expect(within(d).queryByRole('button', { name: COPY.supplyLayer.cageEntryRegister })).toBeNull();
    const cageToggle = within(d.querySelector('[data-ws-id="supplyRequirements#cage"]') as HTMLElement).getByRole('checkbox');
    expect(cageToggle).toHaveAttribute('aria-checked', 'false');
    expect(JSON.parse(window.localStorage.getItem('ws.setup.hamster-golden') ?? '{}').checks).toEqual({});
    // 높이 30 → 바퀴 BELOW_MIN → △ + "현재 케이지 조건에서 최소 요구 미충족"
    await waitFor(() => expect(rowState(d, 'wheel')).toBe('CHECK'));
    expect(within(d.querySelector('[data-ws-id="supplyRequirements#wheel"]') as HTMLElement).getByText(COPY.verdict.compatBelowMin)).toBeInTheDocument();
    expect(edit).toBeInTheDocument();
  });
});
