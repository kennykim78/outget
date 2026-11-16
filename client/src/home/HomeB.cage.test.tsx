// 홈 B 지금 필요한 것(DR #38 · R4-2): 낮은 케이지 저장 → 쳇바퀴 카드 △(엔진 requirementCompat, checklist/cageCompat 경로 = ChecklistLayer 와 같음),
//   케이지 없음 → 카탈로그 요청 0. 카드 순서 = derive 순서(상태로 재정렬 없음). 합성 fixture·카탈로그(테스트 전용).
import { act, render, waitFor } from '@testing-library/react';
import type { PublicRequirement, SpecSchema } from '@ws/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { NO_CAPTURE } from '../app/staticCapture';
import { writeSetup, type SetupV2 } from '../checklist/setupStore';
import { cageKey } from '../context/cageStore';
import { wsStorage } from '../lib/storage';
import { clearEngineCacheForTest } from '../speccheck/engine';
import { golden, pageOf, req } from '../test/fixtures';
import { layerStore } from '../ui/layer/useLayer';

const META = { reviewStatus: 'VERIFIED', reviewerType: 'EXPERIENCED_KEEPER', verifiedBy: null, verifiedAt: '2026-09-30', contentKind: 'SPEC', source: [] };
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
  // bath(미체크 REQUIRED) — 필수 전부 ✓ 이면 ① 이 완료 상태가 되어 카드가 없으므로 하나 남긴다.
  { requirements: [preq('cage', '케이지', CAGE_SCHEMA, CAGE_MIN), preq('wheel', '쳇바퀴', WHEEL_SCHEMA, WHEEL_MIN), req('bath', 'REQUIRED', '모래 목욕통')] },
  { typeId: golden.id, path: '/hamster/golden' },
);
const AT = '2026-10-01T00:00:00.000Z';
const ANSWERED: SetupV2 = {
  v: 2,
  firstTime: false,
  owned: ['cage'],
  answeredAt: AT,
  startedAt: AT,
  checks: { cage: { source: 'OWNED', at: AT }, wheel: { source: 'UNKNOWN', at: AT } },
  reached100At: null,
  updatedAt: AT,
};

const card = (id: string) => document.querySelector(`[data-ws-section="now"] li[data-ws-item="${id}"] a.ws-now-card`) as HTMLElement | null;
const line = (k: string) => document.querySelector(`[data-ws-section="now"] [data-ws-line="${k}"]`) as HTMLElement | null;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  clearEngineCacheForTest();
  act(() => layerStore.resetForTest());
  window.history.replaceState(null, '', '/hamster/golden');
  fetchMock = vi.fn(async () => new Response(JSON.stringify(CATALOG), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearEngineCacheForTest();
  act(() => layerStore.resetForTest());
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('홈 B 지금 필요한 것 — 케이지 호환 △(R4-2)', () => {
  it('L3 후 케이지 없음 → 카탈로그 요청 0 · 준비완료(케이지·쳇바퀴)는 ✓ 줄, 카드 = 남은 필수(모래 목욕통)만', async () => {
    writeSetup(wsStorage, golden.id, ANSWERED);
    render(<App page={PAGE} captured={NO_CAPTURE} />);
    expect(card('wheel')).toBeNull();
    expect(card('cage')).toBeNull();
    expect(card('bath')).toHaveAttribute('data-ws-state', 'first');
    expect(Array.from(line('ready')?.querySelectorAll('a.ws-now-link') ?? []).map((a) => a.textContent)).toEqual(['케이지', '쳇바퀴']);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('L3 전(neutral): 카드 = 필수 전부, 글리프 없음', () => {
    render(<App page={PAGE} captured={NO_CAPTURE} />);
    for (const id of ['cage', 'wheel', 'bath']) {
      expect(card(id)).toHaveAttribute('data-ws-state', 'neutral');
      expect(card(id)?.querySelector('[data-ws-glyph]')).toBeNull();
    }
  });

  it('낮은 케이지(높이 35cm) 저장 → 쳇바퀴 카드·모바일 링크 △ + 보이는 단어 「확인 필요」(호환 CHECK), 카탈로그는 동일 출처 정적 파일 1회 · 카드 순서 = 입력 순서', async () => {
    writeSetup(wsStorage, golden.id, ANSWERED);
    localStorage.setItem(
      cageKey(golden.id),
      JSON.stringify({ v: 1, type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: AT }),
    );
    render(<App page={PAGE} captured={NO_CAPTURE} />);
    // 판정 대기 중(compatPending): 숫자 없음, 요약 줄 = L3 전 문구.
    expect(document.querySelector('.ws-now-count')).toHaveTextContent('필수 준비를 먼저 확인해요');
    await waitFor(() => expect(card('wheel')).toHaveAttribute('data-ws-state', 'check'), { timeout: 10000 });
    expect(card('wheel')?.querySelector('[data-ws-glyph="check"]')).not.toBeNull();
    expect(card('wheel')?.querySelector('.ws-now-state')).toHaveTextContent('△확인 필요');
    // qa MED-1: ≤767 에서 보이는 항목 링크 줄도 같은 △ + 단어 + L4 링크
    const mobile = document.querySelector('[data-ws-section="now"] [data-ws-line="pending"] li[data-ws-now-link="wheel"] a.ws-now-link') as HTMLElement;
    expect(mobile).toHaveAttribute('data-ws-state', 'check');
    expect(mobile).toHaveAttribute('href', '/hamster/golden/supplies/wheel');
    expect(mobile.querySelector('.ws-now-state')).toHaveTextContent('△확인 필요');
    expect(card('cage')).toBeNull(); // 케이지 자체는 최소 충족 → ✓
    expect(Array.from(document.querySelectorAll('[data-ws-section="now"] li.ws-now-item')).map((li) => li.getAttribute('data-ws-item'))).toEqual(['wheel', 'bath']);
    expect(document.querySelector('.ws-now-count')).toHaveTextContent('필수 3가지 중 2가지가 남았어요.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(PAGE.catalogUrl);
  }, 20000);
});
