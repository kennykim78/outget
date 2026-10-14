// 다동물 격리(M2, 감사 #23): page.data 에 두 타입(golden · fixture-second) 요구사항이 섞여도 A 화면은 A 만 센다.
//   ① 홈 B ② L2 ③ L8 요약 ④ setupStore 키 격리 ⑤ cageStore 키 격리 ⑥ L5 대안 href(타입별 inPage). 합성 fixture(실제 데이터 아님).
import { act, configure, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { COPY, formatCopy } from '@ws/copy';
import type { PublicRequirement, SpecSchema, WsPageData } from '@ws/engine';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { LayerPageProvider } from '../app/layerPage';
import { layerRegistry } from '../app/layerRegistry';
import { NO_CAPTURE } from '../app/staticCapture';
import { setupKey, useSetup } from '../checklist/setupStore';
import { cageKey, readCage, useCage, writeCage } from '../context/cageStore';
import { setTrackerForTest, type Tracker } from '../events/track';
import { wsStorage } from '../lib/storage';
import { clearEngineCacheForTest } from '../speccheck/engine';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';
import { golden, pageOf, req, second, secondReq } from './fixtures';

vi.setConfig({ testTimeout: 30000 });
configure({ asyncUtilTimeout: 10000 });
beforeAll(async () => {
  await import('../save/SaveLayer');
  await import('../speccheck/SpecCheckLayer');
}, 120000);

const T = '2026-10-02T00:00:00.000Z';
const CAGE_SCHEMA: SpecSchema = {
  fields: [
    { key: 'type', label: '형태', type: 'enum', options: ['LIVING_BOX', 'WIRE', 'ACRYLIC', 'OTHER'], optionLabels: { LIVING_BOX: '리빙박스', WIRE: '철망', ACRYLIC: '아크릴 케이지', OTHER: '기타' } },
    { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
    { key: 'floorDcm', label: '바닥 세로(cm)', type: 'number', min: 20, max: 120 },
    { key: 'heightCm', label: '높이(cm)', type: 'number', min: 15, max: 100 },
    { key: 'barGapMm', label: '철망 간격(mm)', type: 'number', min: 3, max: 30, optional: true },
  ],
};

/** A(golden) = 필수 2 + 선택 1 / B(second) = 필수 3. 개수가 달라 섞이면 숫자가 달라진다. */
const A_REQS = [req('cage', 'REQUIRED', '골든케이지'), req('wheel', 'REQUIRED', '골든바퀴'), req('toy', 'OPTIONAL', '골든장난감')];
const B_REQS = [secondReq('cage', 'REQUIRED', '픽스처케이지'), secondReq('wheel', 'REQUIRED', '픽스처바퀴'), secondReq('bath', 'REQUIRED', '픽스처목욕통')];

function mixedPage(typeId: string = golden.id, path = '/hamster/golden'): WsPageData {
  return pageOf('TYPE', { types: [golden, second], requirements: [...A_REQS, ...B_REQS] }, { typeId, path });
}
function answered(checks: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, firstTime: false, owned: [], answeredAt: T, startedAt: T, checks, reached100At: null });
}
function mountLayers(page: WsPageData) {
  render(
    <LayerPageProvider page={page}>
      <LayerHost registry={layerRegistry} />
    </LayerPageProvider>,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/hamster/golden');
  clearEngineCacheForTest();
  setTrackerForTest({ track: () => undefined, flush: () => undefined, dispose: () => undefined } satisfies Tracker);
  fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => null }) as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  act(() => layerStore.resetForTest());
});
afterEach(() => {
  act(() => layerStore.resetForTest());
  setTrackerForTest(null);
  vi.unstubAllGlobals();
  clearEngineCacheForTest();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('다동물 격리 — 섞인 page.data 에서 A 만', () => {
  it('① 홈 B(A): 칩 = A 필수만, "필수 2개 남았어요"(B 3 이 섞이면 5)', () => {
    window.localStorage.setItem(setupKey(golden.id), answered());
    render(<App page={mixedPage()} captured={NO_CAPTURE} />);
    const now = document.querySelector('[data-ws-section="now"]') as HTMLElement;
    const chips = Array.from(now.querySelectorAll('.ws-need')).map((c) => c.textContent ?? '');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toContain('골든케이지');
    expect(chips[1]).toContain('골든바퀴');
    expect(now).toHaveTextContent('필수 2개 남았어요');
    expect(document.body.textContent ?? '').not.toContain('픽스처');
  });

  it('② L2(A): 체크리스트 행 = A 만, B 이름 0', () => {
    window.localStorage.setItem(setupKey(golden.id), answered());
    mountLayers(mixedPage());
    act(() => layerStore.open('L2'));
    const d = screen.getByRole('dialog');
    expect(within(d).getByRole('checkbox', { name: /골든케이지/ })).toBeInTheDocument();
    expect(within(d).getByRole('checkbox', { name: /골든바퀴/ })).toBeInTheDocument();
    expect(d.textContent ?? '').not.toContain('픽스처');
    expect(d).toHaveTextContent(COPY.checklist.requiredLeft.replace('{n}', '2'));
  });

  it('③ L8 요약(A): "필수 2개 남음"', async () => {
    window.localStorage.setItem('ws.animalType', golden.id);
    window.localStorage.setItem(setupKey(golden.id), answered());
    mountLayers(mixedPage());
    act(() => layerStore.open('L8', {}, { url: '/save' }));
    await screen.findByLabelText(COPY.save.emailLabel, undefined, { timeout: 15000 });
    const summary = document.querySelector('[data-ws-save="summary"]') as HTMLElement;
    expect(summary).toHaveTextContent(golden.displayName);
    expect(summary).toHaveTextContent(formatCopy(COPY.save.summaryRemaining, { n: 2 }));
    expect(summary.textContent ?? '').not.toContain('픽스처');
  });

  it('④ setupStore: ws.setup.{A} / ws.setup.{B} 키 격리 — A 체크가 B 에 영향 0, 역도 같다', () => {
    const a = renderHook(() => useSetup(golden.id));
    const b = renderHook(() => useSetup(second.id));
    act(() => a.result.current.toggle('cage'));
    expect(Object.keys(a.result.current.setup?.checks ?? {})).toEqual(['cage']);
    expect(b.result.current.setup).toBeNull();
    expect(window.localStorage.getItem(setupKey(second.id))).toBeNull();
    const aRaw = window.localStorage.getItem(setupKey(golden.id));
    act(() => b.result.current.toggle('wheel'));
    expect(Object.keys(b.result.current.setup?.checks ?? {})).toEqual(['wheel']);
    expect(Object.keys(a.result.current.setup?.checks ?? {})).toEqual(['cage']);
    expect(window.localStorage.getItem(setupKey(golden.id))).toBe(aRaw);
    act(() => b.result.current.reset());
    // R6 레인 D: reset = 리셋 레코드(체크 0 + 해제 tombstone) — 키 삭제 아님. B 만 비고 A 는 그대로.
    expect(Object.keys(b.result.current.setup?.checks ?? {})).toEqual([]);
    expect(Object.keys(b.result.current.setup?.uncheckedAt ?? {})).toEqual(['wheel']);
    expect(Object.keys(a.result.current.setup?.checks ?? {})).toEqual(['cage']);
    expect(window.localStorage.getItem(setupKey(golden.id))).toBe(aRaw);
  });

  it('⑤ cageStore: ws.context.{A}.cage / {B}.cage 키 격리', () => {
    expect(writeCage(wsStorage, golden.id, { type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35 }, CAGE_SCHEMA, T)).not.toBeNull();
    expect(cageKey(golden.id)).toBe('ws.context.hamster-golden.cage');
    expect(window.localStorage.getItem(cageKey(second.id))).toBeNull();
    expect(readCage(wsStorage, second.id, CAGE_SCHEMA)).toBeNull();
    const a = renderHook(() => useCage(golden.id, { schema: CAGE_SCHEMA }));
    const b = renderHook(() => useCage(second.id, { schema: CAGE_SCHEMA }));
    expect(a.result.current.cage).not.toBeNull();
    expect(b.result.current.cage).toBeNull();
    act(() => void b.result.current.save({ type: 'WIRE', floorWcm: 80, floorDcm: 50, heightCm: 40 }));
    expect(b.result.current.cage).toMatchObject({ floorWcm: 80 });
    expect(a.result.current.cage).toMatchObject({ floorWcm: 60 });
    act(() => a.result.current.remove());
    expect(a.result.current.cage).toBeNull();
    expect(b.result.current.cage).toMatchObject({ floorWcm: 80 });
  });
});

// ── ⑥ L5 대안 href: 대안이 "그 타입 요구사항"에 있을 때만 링크 ─────────────────
const META = { reviewStatus: 'VERIFIED', reviewerType: 'EXPERIENCED_KEEPER', verifiedBy: null, verifiedAt: '2026-09-30', contentKind: 'SPEC', source: [] };
const WHEEL_SCHEMA: SpecSchema = { fields: [{ key: 'diameterCm', label: '지름(cm)', type: 'number', min: 5, max: 60 }] };
const SAUCER_SCHEMA: SpecSchema = { fields: [{ key: 'diameterCm', label: '지름(cm)', type: 'number', min: 5, max: 60 }] };
const WHEEL_MIN = { rules: [{ key: 'diameterCm', op: 'gte' as const, value: 28, reason: '합성 최소 사유' }] };
const cItem = (id: string, name: string, specSchema: SpecSchema, alts: string[] = []) => ({ ...META, id, name, category: 'CAGE', glyph: 'G', lifecycle: 'DURABLE', specSchema, compatibleAlternativeIds: alts, description: 'd' });
const cReq = (profile: string, itemId: string, minSpec: unknown) => ({ ...META, id: `r-${profile}-${itemId}`, careProfileId: profile, supplyItemId: itemId, priority: 'REQUIRED', orderHint: 'BEFORE_ARRIVAL', why: 'w', caution: null, avoid: null, minSpec, recommendedSpec: { rules: [] }, notNowReason: null, searchKeyword: null });
const cType = (t: typeof golden) => ({ ...META, id: t.id, group: 'SMALL_MAMMAL', displayName: t.displayName, status: 'ACTIVE', aliases: [], taxonId: null, careProfileId: t.careProfileId, careOverrides: {} });
const CATALOG = {
  v: 1,
  seedDigest: 'mt',
  animalTypes: [cType(golden), cType(second)],
  careProfiles: [golden, second].map((t) => ({ ...META, id: t.careProfileId, name: 'p', taxonIds: [], facts: {}, careNotes: [] })),
  supplyItems: [cItem('wheel', '합성 쳇바퀴', WHEEL_SCHEMA, ['saucer']), cItem('saucer', '합성 소서', SAUCER_SCHEMA)],
  supplyRequirements: [golden, second].flatMap((t) => [cReq(t.careProfileId, 'wheel', WHEEL_MIN), cReq(t.careProfileId, 'saucer', { rules: [] })]),
  compatibilityRules: [],
};
function wheelReq(r: PublicRequirement): PublicRequirement {
  return { ...r, minSpec: WHEEL_MIN, item: { ...r.item, name: '합성 쳇바퀴', specSchema: WHEEL_SCHEMA, alternativeIds: ['saucer'] } };
}
function saucerReq(r: PublicRequirement): PublicRequirement {
  return { ...r, item: { ...r.item, name: '합성 소서', specSchema: SAUCER_SCHEMA } };
}
// A 페이지 = wheel + saucer, B = wheel 만(saucer 는 카탈로그에만 있다).
const L5_PAGE = (typeId: string, path: string) =>
  pageOf('TYPE', { types: [golden, second], requirements: [wheelReq(req('wheel', 'REQUIRED')), saucerReq(req('saucer', 'REQUIRED')), wheelReq(secondReq('wheel', 'REQUIRED'))] }, { typeId, path });

async function failWheel(typeId: string, slug: string): Promise<HTMLElement> {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(CATALOG), { status: 200, headers: { 'content-type': 'application/json' } }));
  mountLayers(L5_PAGE(typeId, `/${slug}`));
  act(() => layerStore.open('L5', { typeId, itemId: 'wheel' }, { url: `/${slug}/check/wheel` }));
  const d = await screen.findByRole('dialog');
  await within(d).findByText(COPY.checkLayer.intro, {}, { timeout: 15000 });
  const submit = within(d).getByRole('button', { name: COPY.checkLayer.submit });
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.change(within(d).getByLabelText(/지름/), { target: { value: '27' } });
  fireEvent.click(submit);
  return within(d).findByRole('region', { name: COPY.verdict.resultRegion });
}

describe('⑥ L5 대안 href — 타입별 inPage', () => {
  it('A: 대안(saucer)이 A 요구사항에 있으면 /hamster/golden/supplies/saucer 링크', async () => {
    const r = await failWheel(golden.id, 'hamster/golden');
    expect(within(r).getByRole('link', { name: '합성 소서' })).toHaveAttribute('href', '/hamster/golden/supplies/saucer');
  });

  it('B: 대안(saucer)이 B 요구사항에 없으면 href null → 링크 아님(텍스트만)', async () => {
    const r = await failWheel(second.id, 'hamster/fixture');
    expect(within(r).queryByRole('link', { name: '합성 소서' })).toBeNull();
    expect(within(r).getByText('합성 소서')).toBeInTheDocument();
  });
});
