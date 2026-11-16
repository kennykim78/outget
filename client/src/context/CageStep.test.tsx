// context/CageStep — 형태 옵션 = schema.options ∩ CAGE_TYPES (L6 저장 계약 밖 값은 노출·저장 시도 안 함).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { SpecSchema } from '@ws/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@ws/copy';
import { createStorage, wsStorage } from '../lib/storage';

vi.mock('../ui/layer/Layer', () => ({
  useLayerChrome: () => ({ setTitle: () => {}, setBack: () => {} }),
  LayerBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LayerFoot: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import CageStep, { CAGE_REVIEW_LOADING_DELAY_MS, cageStepDeps } from './CageStep';
import { cageKey, CAGE_TYPES } from './cageStore';

const TYPE_ID = 'hamster-golden';
const LABELS = {
  LIVING_BOX: '리빙박스',
  WIRE: '철망',
  ACRYLIC: '아크릴 케이지',
  GLASS_TANK: '유리 수조',
  GRID_PANEL: '그리드 패널',
  OTHER: '기타',
};
const SCHEMA: SpecSchema = {
  fields: [
    {
      key: 'type',
      label: '형태',
      type: 'enum',
      options: ['LIVING_BOX', 'WIRE', 'ACRYLIC', 'GLASS_TANK', 'GRID_PANEL', 'OTHER'],
      optionLabels: LABELS,
    },
    { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
    { key: 'floorDcm', label: '바닥 세로(cm)', type: 'number', min: 20, max: 120 },
    { key: 'heightCm', label: '높이(cm)', type: 'number', min: 15, max: 100 },
    { key: 'barGapMm', label: '철망 간격(mm)', type: 'number', min: 3, max: 30, optional: true },
  ],
};

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

function setup() {
  const onBack = vi.fn();
  const utils = render(<CageStep typeId={TYPE_ID} schema={SCHEMA} backLabel="뒤로" onBack={onBack} />);
  return { onBack, ...utils };
}

describe('CageStep type 옵션', () => {
  it('schema 에 GLASS_TANK·GRID_PANEL 이 있어도 L6 에는 노출하지 않는다', () => {
    setup();
    const values = screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value);
    expect(values).toEqual([...CAGE_TYPES]);
    expect(values).not.toContain('GLASS_TANK');
    expect(values).not.toContain('GRID_PANEL');
    expect(screen.queryByText(LABELS.GLASS_TANK)).toBeNull();
    expect(screen.queryByText(LABELS.GRID_PANEL)).toBeNull();
  });

  it.each([...CAGE_TYPES])('기존 옵션 %s 는 저장에 성공한다', (type) => {
    const { onBack } = setup();
    fireEvent.click(screen.getByDisplayValue(type));
    const fill = (name: RegExp, v: string) => fireEvent.change(screen.getByLabelText(name), { target: { value: v } });
    fill(/바닥 가로/, '80');
    fill(/바닥 세로/, '50');
    fill(/높이/, '40');
    if (type === 'WIRE') fill(/철망 간격/, '9');
    const save = screen.getAllByRole('button').find((b) => !(b as HTMLButtonElement).disabled && /저장|케이지 등록하기/.test(b.textContent ?? ''));
    expect(save).toBeDefined();
    fireEvent.click(save as HTMLElement);
    expect(onBack).toHaveBeenCalled();
    const stored = JSON.parse(wsStorage.get(cageKey(TYPE_ID)) ?? 'null') as { type: string } | null;
    expect(stored?.type).toBe(type);
  });

  it('계약 밖 값은 저장 시도되지 않는다', () => {
    setup();
    expect(screen.queryByDisplayValue('GLASS_TANK')).toBeNull();
    expect(screen.queryByDisplayValue('GRID_PANEL')).toBeNull();
    expect(wsStorage.get(cageKey(TYPE_ID))).toBeNull();
  });
});

describe('CageStep 저장소 쓰기 실패(#7)', () => {
  it('localStorage 쓰기 실패 → "이 기기에만 저장돼요" 대신 저장 불가 안내, 이전 화면으로 돌아가지 않는다', () => {
    const failing = createStorage(
      () =>
        ({
          length: 0,
          key: () => null,
          getItem: () => null,
          setItem: () => {
            throw new Error('quota');
          },
          removeItem: () => {
            throw new Error('quota');
          },
          clear: () => {},
        }) as unknown as Storage,
    );
    const onBack = vi.fn();
    render(<CageStep typeId={TYPE_ID} schema={SCHEMA} backLabel="뒤로" onBack={onBack} storage={failing} />);
    expect(screen.getByText(COPY.cage.deviceOnly)).toBeInTheDocument();
    const fill = (name: RegExp, v: string) => fireEvent.change(screen.getByLabelText(name), { target: { value: v } });
    fireEvent.click(screen.getByDisplayValue('LIVING_BOX'));
    fill(/바닥 가로/, '80');
    fill(/바닥 세로/, '50');
    fill(/높이/, '40');
    fireEvent.click(screen.getAllByRole('button').find((b) => !(b as HTMLButtonElement).disabled && /저장|케이지 등록하기/.test(b.textContent ?? '')) as HTMLElement);
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByText(COPY.checklist.storageUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(COPY.cage.deviceOnly)).toBeNull();
  });
});

describe('CageStep 등록한 케이지 보기(R4-5)', () => {
  const CATALOG = '/data/catalog.v1.0000abcd.json';
  const stored = { type: 'LIVING_BOX', floorWcm: 80, floorDcm: 45, heightCm: 33 } as const;
  function storeIt() {
    wsStorage.set(cageKey(TYPE_ID), JSON.stringify({ v: 1, ...stored, updatedAt: '2026-11-14T00:00:00.000Z' }));
  }
  const cageReq = {
    requirementId: 'req-cage',
    animalTypeId: TYPE_ID,
    supplyItemId: 'cage',
    priority: 'REQUIRED',
    orderHint: 'BEFORE_ARRIVAL',
    notNowReason: null,
    minSpec: { rules: [{ key: 'floorWcm', op: 'gte', value: 71, reason: 'r' }] },
    recommendedSpec: { rules: [] },
    why: 'w',
    caution: null,
    avoid: null,
    searchKeyword: 'k',
    searchLinks: [],
    item: { id: 'cage', name: '케이지', category: 'CAGE', glyph: 'G', specSchema: SCHEMA, alternativeIds: [] },
    source: [],
    lastVerifiedAt: '2026-09-30',
  } as const;
  const wheelReq = { ...cageReq, requirementId: 'req-wheel', supplyItemId: 'wheel', minSpec: { rules: [] }, item: { ...cageReq.item, id: 'wheel', name: '쳇바퀴' } };

  afterEach(() => vi.restoreAllMocks());

  it('케이지 없음 → 폼부터(보기 0)', () => {
    setup();
    expect(document.querySelector('[data-ws-cage="summary"]')).toBeNull();
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
  });

  it('케이지 있음 → 저장값 숫자 · 자체 최소 규격 ○ · 용품 간 호환 △(엔진 결과만) · 채운 버튼 1 → 「등록값 수정하기」 → 폼(저장값 채움)', async () => {
    storeIt();
    const specCheck = vi.fn(() => ({ verdict: 'OK', product: { verdict: 'OK', reasons: [] }, compat: { verdict: 'NONE', reasons: [], checkedRuleIds: [] }, reasons: [], alternatives: [] }));
    const requirementCompat = vi.fn(() => ({ verdict: 'CHECK', reasons: [{ stage: 'COMPAT', kind: 'RULE', verdict: 'CHECK', ruleId: 'cr#0', message: '합성 호환 문장' }], checkedRuleIds: ['cr'] }));
    vi.spyOn(cageStepDeps, 'load').mockResolvedValue({ specCheck, requirementCompat } as never);
    const onBack = vi.fn();
    render(
      <CageStep typeId={TYPE_ID} schema={SCHEMA} backLabel="뒤로" onBack={onBack} animalName="골든햄스터" reqs={[cageReq, wheelReq] as never} catalogUrl={CATALOG} />,
    );
    const summary = document.querySelector('[data-ws-cage="summary"]') as HTMLElement;
    expect(summary).not.toBeNull();
    expect(screen.getByRole('heading', { name: COPY.cage.registeredTitle })).toBeInTheDocument();
    expect(screen.getByText('골든햄스터 · 리빙박스')).toBeInTheDocument();
    expect(summary.querySelector('[data-ws-cage-part="floor"]')?.textContent).toBe('80×45cm');
    expect(summary.querySelector('[data-ws-cage-part="height"]')?.textContent).toBe('높이 33cm');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: COPY.cage.delete })).toBeNull();

    const self = await waitFor(() => {
      const el = summary.querySelector('[data-ws-cage-part="self"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(self.textContent).toContain('케이지 최소 규격 충족');
    expect(self.querySelector('[data-ws-glyph="ok"]')?.textContent).toBe('○');
    expect(self.textContent).toContain(`최소 바닥 가로 71cm ${COPY.spec.gte}`); // 해석된 minSpec 값만(규칙 1개 → 필드명)
    expect(self.textContent).toContain(COPY.cage.selfNote);
    const compat = summary.querySelector('[data-ws-cage-part="compat"]') as HTMLElement;
    expect(compat.getAttribute('data-ws-item')).toBe('wheel');
    expect(compat.textContent).toContain('쳇바퀴와 함께 확인해요');
    expect(compat.querySelector('[data-ws-glyph="check"]')?.textContent).toBe('△');
    expect(compat.textContent).toContain('합성 호환 문장');
    expect(compat.textContent).toContain(COPY.supplyLayer.compatSubNote);
    expect(summary.textContent).not.toMatch(/검수 대기|100×50|27|55/); // 시안 예시 숫자·검수 대기 줄 0

    const fills = screen.getAllByRole('button').filter((b) => b.className.includes('ws-btn--fill'));
    expect(fills.map((b) => b.textContent)).toEqual([COPY.cage.editCta]);
    fireEvent.click(fills[0]);
    expect(document.querySelector('[data-ws-cage="summary"]')).toBeNull();
    expect(screen.getByLabelText(/바닥 가로/)).toHaveValue(80);
    expect(screen.getByDisplayValue('LIVING_BOX')).toHaveFocus(); // 첫 입력(형태)
    expect(screen.getByRole('button', { name: COPY.cage.delete })).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('R4-8 카탈로그 로드 실패 → 저장값 숫자 유지 + △ 「호환 정보를 불러오지 못했어요」(alert) + 채운 버튼 「다시 시도하기」 하나 → 다시 불러와 판정', async () => {
    storeIt();
    const specCheck = vi.fn(() => ({ verdict: 'OK', product: { verdict: 'OK', reasons: [] }, compat: { verdict: 'NONE', reasons: [], checkedRuleIds: [] }, reasons: [], alternatives: [] }));
    const requirementCompat = vi.fn(() => ({ verdict: 'NONE', reasons: [], checkedRuleIds: [] }));
    const load = vi.spyOn(cageStepDeps, 'load').mockRejectedValueOnce(new Error('x')).mockResolvedValue({ specCheck, requirementCompat } as never);
    render(<CageStep typeId={TYPE_ID} schema={SCHEMA} backLabel="뒤로" onBack={() => {}} reqs={[cageReq] as never} catalogUrl={CATALOG} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-ws-error', 'cage-review');
    expect(alert).toHaveTextContent(COPY.cage.loadFailTitle);
    expect(alert).toHaveTextContent(COPY.cage.loadFailBody);
    expect(alert.querySelector('[data-ws-glyph="check"]')?.textContent).toBe('△');
    expect(screen.getByRole('heading', { level: 4, name: COPY.cage.loadFailTitle })).toBeInTheDocument();
    expect(document.querySelector('[data-ws-cage-part="floor"]')?.textContent).toBe('80×45cm'); // 「입력한 크기는 그대로」
    expect(document.querySelector('[data-ws-cage-part="self"]')).toBeNull();
    expect(alert.textContent).not.toMatch(/catalog|fetch|error|오류 코드|JSON|\d{3}/i); // 개발 용어·상태 코드 0
    // 채운 버튼 = 다시 시도하기 하나, 수정은 텍스트 링크
    const fills = screen.getAllByRole('button').filter((b) => b.className.includes('ws-btn--fill'));
    expect(fills.map((b) => b.textContent)).toEqual([COPY.cage.retry]);
    const edit = screen.getByRole('button', { name: COPY.cage.editCta });
    expect(edit.className).not.toContain('ws-btn--fill');
    fireEvent.click(fills[0]);
    expect(edit).toHaveFocus(); // 사라지는 버튼 대신 같은 자리 수정 버튼
    await waitFor(() => expect(document.querySelector('[data-ws-cage-part="self"]')).not.toBeNull());
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: COPY.cage.retry })).toBeNull();
    expect(screen.getByRole('button', { name: COPY.cage.editCta }).className).toContain('ws-btn--fill');
  });

  it('R4-8 판정 불러오기가 늦으면 「확인 중이에요」(status·aria-busy, 숫자 없는 막대, 행동 버튼은 수정 하나뿐), 빠르면 로딩 머리 0', async () => {
    storeIt();
    let resolve: (e: unknown) => void = () => {};
    vi.spyOn(cageStepDeps, 'load').mockReturnValue(new Promise((r) => (resolve = r)) as never);
    render(<CageStep typeId={TYPE_ID} schema={SCHEMA} backLabel="뒤로" onBack={() => {}} reqs={[cageReq] as never} catalogUrl={CATALOG} />);
    expect(document.querySelector('[data-ws-state-kind="loading"]')).toBeNull(); // 지연 전 0(깜박임 방지)
    const status = await screen.findByRole('status', {}, { timeout: CAGE_REVIEW_LOADING_DELAY_MS + 1000 });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent(COPY.cage.loadingTitle);
    expect(status).toHaveTextContent(COPY.cage.loadingBody);
    expect(status).toHaveTextContent(COPY.cage.loadingWait);
    expect(status.querySelector('.ws-state-bar')).toHaveAttribute('aria-hidden', 'true');
    expect(status.textContent).not.toMatch(/%|\d/); // 진행률 숫자 0
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([COPY.cage.editCta]);
    const specCheck = vi.fn(() => ({ verdict: 'OK', product: { verdict: 'OK', reasons: [] }, compat: { verdict: 'NONE', reasons: [], checkedRuleIds: [] }, reasons: [], alternatives: [] }));
    resolve({ specCheck, requirementCompat: vi.fn(() => ({ verdict: 'NONE', reasons: [], checkedRuleIds: [] })) });
    await waitFor(() => expect(document.querySelector('[data-ws-cage-part="self"]')).not.toBeNull());
    expect(document.querySelector('[data-ws-state-kind="loading"]')).toBeNull();
  });

  it('R4-8 케이지 없음 → 폼 위 빈 상태 머리(「등록한 케이지가 없어요」) + 저장 버튼 「케이지 등록하기」, 있으면 머리 0·「저장」', () => {
    setup();
    const head = document.querySelector('[data-ws-state-kind="empty"]') as HTMLElement;
    expect(head).not.toBeNull();
    expect(head).not.toHaveAttribute('role');
    expect(screen.getByRole('heading', { level: 3, name: COPY.cage.emptyTitle })).toBeInTheDocument();
    expect(head).toHaveTextContent(COPY.cage.emptyBody);
    expect(head.compareDocumentPosition(document.querySelector('form.ws-cage-form') as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const fills = screen.getAllByRole('button').filter((b) => b.className.includes('ws-btn--fill'));
    expect(fills.map((b) => b.textContent)).toEqual([COPY.cage.emptyCta]);
    expect(screen.queryByRole('button', { name: COPY.cage.save })).toBeNull();
  });
});
