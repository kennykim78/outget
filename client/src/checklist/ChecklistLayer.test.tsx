// F7 L2 + L3: ① 재마운트 유지, 100% 1회(해제·재도달 재발화 없음), 질문 2 ③ 저장·이벤트에 이메일·좌표 0
//   + 결정 a(건너뛰기 = 답함) · b(완료 = REQUIRED 전부 ✓) · c(기기 저장 문구) · d(L3 전 숫자 0). 합성 fixture.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { COPY } from '@ws/copy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LayerPageProvider } from '../app/layerPage';
import { layerRegistry } from '../app/layerRegistry';
import { setTrackerForTest, type Tracker } from '../events/track';
import { golden, pageOf, req } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';
import { setupKey } from './setupStore';

const NOTNOW = { ...req('ball', 'NOT_NOW', '합성공'), notNowReason: '합성 이유 문장' };
const PAGE = pageOf(
  'TYPE',
  { requirements: [req('cage', 'REQUIRED', '합성케이지'), req('wheel', 'REQUIRED', '합성바퀴'), req('toy', 'OPTIONAL', '합성장난감'), NOTNOW] },
  { typeId: golden.id, path: '/hamster/golden' },
);

let calls: Array<[string, Record<string, unknown>]>;
beforeEach(() => {
  window.localStorage.clear();
  calls = [];
  const fake: Tracker = { track: (n, p) => void calls.push([n, p]), flush: () => undefined, dispose: () => undefined };
  setTrackerForTest(fake);
  render(
    <LayerPageProvider page={PAGE}>
      <LayerHost registry={layerRegistry} />
    </LayerPageProvider>,
  );
});
afterEach(() => {
  act(() => layerStore.resetForTest());
  setTrackerForTest(null);
});

function openL2(): HTMLElement {
  act(() => layerStore.open('L2'));
  return screen.getByRole('dialog');
}
function closeL2(): void {
  act(() => layerStore.resetForTest());
}
const names = () => calls.map(([n]) => n);
const row = (d: HTMLElement, name: string) => within(d).getByRole('checkbox', { name: new RegExp(name) });
const requiredLeft = (n: number) => COPY.checklist.requiredLeft.replace('{n}', String(n));

function answerAlready(d: HTMLElement, owned: string[] = []) {
  fireEvent.click(within(d).getByLabelText(COPY.setupQ.already));
  for (const o of owned) fireEvent.click(within(d).getByRole('checkbox', { name: o }));
  fireEvent.click(within(d).getByRole('button', { name: COPY.setupQ.next }));
}

describe('L2 + L3', () => {
  it('d: 처음 열면 L3 부터, 질문 2개, 숫자·진행바 0, [다음]은 ① 선택 전 비활성', () => {
    const d = openL2();
    expect(d.querySelector('[data-ws-step="L3"]')).not.toBeNull();
    expect(d.querySelectorAll('fieldset')).toHaveLength(2);
    expect(within(d).getByRole('group', { name: COPY.setupQ.q1Title })).toBeInTheDocument();
    // F13: ② 보이는 제목 = q2Title(하나), 그룹 이름 = "이미 가진 것"(visually-hidden legend) — 보이는 중복 제목 0
    const q2 = within(d).getByRole('group', { name: COPY.setupQ.owned });
    expect(within(q2).getByRole('heading', { name: COPY.setupQ.q2Title })).toBeInTheDocument();
    const legend = q2.querySelector('legend') as HTMLElement;
    expect(legend.textContent).toBe(COPY.setupQ.owned);
    expect(legend).toHaveClass('ws-visually-hidden');
    const visibleOwned = Array.from(q2.querySelectorAll('*')).filter(
      (el) => el.textContent === COPY.setupQ.owned && !el.closest('.ws-visually-hidden'),
    );
    expect(visibleOwned).toHaveLength(0);
    expect(within(d).queryByRole('progressbar')).toBeNull();
    expect(d.textContent).not.toMatch(/\d+개/);
    expect(within(d).getByRole('button', { name: COPY.setupQ.next })).toBeDisabled();
    // ② 보유 후보는 노출 요구사항 전체(› 없음)
    expect(within(d).getAllByRole('checkbox')).toHaveLength(4);
    expect(d.querySelector('.ws-check-more')).toBeNull();
  });

  it('[다음]: setup_started 1회(firstTime·ownedCount) → L2 요약 밴드 "필수 N개 미완료", 보유 = ✓', () => {
    const d = openL2();
    answerAlready(d, ['합성케이지']);
    expect(calls).toEqual([['setup_started', { animalTypeId: golden.id, firstTime: false, ownedCount: 1 }]]);
    expect(within(d).getByRole('heading', { name: requiredLeft(1) })).toBeInTheDocument();
    expect(within(d).getByText(COPY.checklist.summaryTitle)).toBeInTheDocument();
    expect(within(d).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(row(d, '합성케이지')).toHaveAttribute('aria-checked', 'true');
    expect(row(d, '합성바퀴')).toHaveAttribute('aria-checked', 'false');
    // 상태 = 글리프 + 문구(glyphLabel) — 색만으로 말하지 않는다
    expect(row(d, '합성케이지')).toHaveAccessibleName(new RegExp(COPY.glyphLabel.ready));
    expect(row(d, '합성바퀴')).toHaveAccessibleName(new RegExp(COPY.glyphLabel.first));
    expect(row(d, '합성장난감')).toHaveAccessibleName(new RegExp(COPY.glyphLabel.later));
    // 그룹 헤더 = copy priority, NOT_NOW 접힘
    const heads = Array.from(d.querySelectorAll('.ws-check-group-head')).map((h) => h.textContent);
    expect(heads).toEqual([COPY.priority.REQUIRED, COPY.priority.OPTIONAL, `${COPY.priority.NOT_NOW} (1) ▸`]);
    expect(within(d).queryByText('합성 이유 문장')).toBeNull();
    fireEvent.click(within(d).getByRole('button', { name: new RegExp(COPY.priority.NOT_NOW) }));
    expect(within(d).getByText('합성 이유 문장')).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: new RegExp(COPY.priority.NOT_NOW) })).toHaveAttribute('aria-expanded', 'true');
    // › = L4 문서 이동
    const more = within(d).getByRole('link', { name: COPY.checklist.itemDetailAria.replace('{name}', '합성케이지') });
    expect(more).toHaveAttribute('href', '/hamster/golden/supplies/cage');
    // 꼬리: 다시 설정 · 기기 저장 문구 · /save 링크
    expect(within(d).getByRole('button', { name: COPY.checklist.resetSetup })).toBeInTheDocument();
    expect(d.querySelector('[data-ws-note="device-only"]')).not.toBeNull();
    expect(within(d).getByRole('link', { name: new RegExp(COPY.checklist.saveAsk) })).toHaveAttribute('href', '/save');
  });

  it('a: 건너뛰기 = 답함(firstTime null, owned []), setup_started 없음, 이후 숫자 표시', () => {
    const d = openL2();
    fireEvent.click(within(d).getByRole('button', { name: COPY.setupQ.skip }));
    const s = JSON.parse(window.localStorage.getItem(setupKey(golden.id)) as string);
    expect(s).toMatchObject({ firstTime: null, owned: [] });
    expect(s.answeredAt).toEqual(expect.any(String));
    expect(calls).toEqual([]);
    expect(within(d).getByRole('heading', { name: requiredLeft(2) })).toBeInTheDocument();
  });

  it('토글: item_checked{UNKNOWN} / item_unchecked{보유면 OWNED}, 즉시 저장, 재마운트 후 유지', () => {
    let d = openL2();
    answerAlready(d, ['합성케이지']);
    calls = [];
    fireEvent.click(row(d, '합성장난감'));
    fireEvent.click(row(d, '합성케이지'));
    expect(calls).toEqual([
      ['item_checked', { animalTypeId: golden.id, supplyItemId: 'toy', priority: 'OPTIONAL', readySource: 'UNKNOWN' }],
      ['item_unchecked', { animalTypeId: golden.id, supplyItemId: 'cage', priority: 'REQUIRED', readySource: 'OWNED' }],
    ]);
    closeL2();
    d = openL2();
    expect(d.querySelector('[data-ws-step="L2"]')).not.toBeNull(); // 답한 뒤엔 L2 부터
    expect(row(d, '합성장난감')).toHaveAttribute('aria-checked', 'true');
    expect(row(d, '합성케이지')).toHaveAttribute('aria-checked', 'false');
  });

  it('b + 100% 1회: REQUIRED 전부 ✓ → "필수 준비 끝" + setup_100_reached 1회, 해제·재도달 재발화 없음', () => {
    const d = openL2();
    answerAlready(d);
    calls = [];
    fireEvent.click(row(d, '합성장난감')); // 선택 항목만으로는 완료 아님
    expect(within(d).getByRole('heading', { name: requiredLeft(2) })).toBeInTheDocument();
    fireEvent.click(row(d, '합성케이지'));
    fireEvent.click(row(d, '합성바퀴'));
    expect(within(d).getByRole('heading', { name: COPY.checklist.requiredDone })).toBeInTheDocument();
    expect(within(d).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    fireEvent.click(row(d, '합성바퀴'));
    fireEvent.click(row(d, '합성바퀴'));
    const reached = calls.filter(([n]) => n === 'setup_100_reached');
    expect(reached).toHaveLength(1);
    expect(reached[0][1]).toEqual({ animalTypeId: golden.id, elapsedSec: expect.any(Number) });
    closeL2();
    openL2();
    expect(names().filter((n) => n === 'setup_100_reached')).toHaveLength(1);
  });

  it('[내 상황 다시 설정] → L3(이전 답 유지) → [다음]: setup_started 재발화 없음', () => {
    const d = openL2();
    answerAlready(d, ['합성케이지']);
    fireEvent.click(within(d).getByRole('button', { name: COPY.checklist.resetSetup }));
    expect(d.querySelector('[data-ws-step="L3"]')).not.toBeNull();
    expect(within(d).getByLabelText(COPY.setupQ.already)).toBeChecked();
    expect(within(d).getByRole('checkbox', { name: '합성케이지' })).toBeChecked();
    fireEvent.click(within(d).getByRole('button', { name: COPY.setupQ.next }));
    expect(names().filter((n) => n === 'setup_started')).toHaveLength(1);
  });

  it('③ 저장 값·이벤트 props 에 이메일·좌표·지역 키 0', () => {
    const d = openL2();
    answerAlready(d, ['합성케이지', '합성공']);
    fireEvent.click(row(d, '합성바퀴'));
    fireEvent.click(row(d, '합성장난감'));
    const banned = /"(lat|lng|latitude|longitude|coords|coordinates|location|region|address|email|phone)"/i;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i) as string;
      const v = window.localStorage.getItem(k) as string;
      expect(k.startsWith('ws.')).toBe(true);
      expect(v).not.toMatch(banned);
      expect(v).not.toMatch(/@/);
    }
    const json = JSON.stringify(calls);
    expect(json).not.toMatch(banned);
    expect(json).not.toMatch(/@/);
    expect(calls.length).toBeGreaterThan(0);
  });
});
