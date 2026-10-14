// F6 L1 친구 선택: ① "사막다람쥐" → 저빌(합성 별칭), 6매칭 → 5, 0 → 안내 + 그룹 복귀 + unknown_species_clicked,
//   선택 이벤트(picker·alias) + location.assign ② PLANNED·비노출 이름 0. 합성 fixture(시드 아님).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PublicAnimalType } from '@ws/engine';
import { COPY } from '@ws/copy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerPageProvider } from '../app/layerPage';
import { layerRegistry } from '../app/layerRegistry';
import { setTrackerForTest, type Tracker } from '../events/track';
import { golden, pageOf } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';
import { nav } from './navigate';
import { setPickHandler } from './pickHandler';
import { ANIMAL_TYPE_KEY } from './selection';

function synth(id: string, displayName: string, aliases: string[], group: PublicAnimalType['group'] = 'SMALL_MAMMAL'): PublicAnimalType {
  return { ...golden, id, slug: id.replace('-', '/'), displayName, aliases, group, mascot: null, oneLiner: null };
}

const gerbil = synth('gerbil-mongolian', '합성저빌', ['사막다람쥐']);
const budgie = synth('budgie-common', '합성잉꼬', ['사랑새'], 'PARROT');

let calls: Array<[string, Record<string, unknown>]>;
let assign: ReturnType<typeof vi.fn>;
const realAssign = nav.assign;

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/'); // 이전 테스트가 남긴 레이어 state 항목 위에서 열지 않는다(부모 = 레이어 없는 항목)
  calls = [];
  const fake: Tracker = { track: (n, p) => void calls.push([n, p]), flush: () => undefined, dispose: () => undefined };
  setTrackerForTest(fake);
  assign = vi.fn();
  nav.assign = assign as unknown as (href: string) => void;
});

afterEach(() => {
  act(() => layerStore.resetForTest());
  setTrackerForTest(null);
  nav.assign = realAssign;
});

function openL1(types: PublicAnimalType[]) {
  const page = pageOf('HOME', { types });
  render(
    <LayerPageProvider page={page}>
      <LayerHost registry={layerRegistry} />
    </LayerPageProvider>,
  );
  act(() => layerStore.open('L1'));
  return screen.getByRole('dialog');
}

function goUnsure(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(COPY.picker.unsure) }));
  return within(dialog).getByRole('searchbox');
}

describe('L1 친구 선택', () => {
  it('제목 "어떤 친구인가요?", 그룹 2 → 타입 카드 → 선택: 저장 + species_selected{via:picker} + /{slug} 이동', () => {
    const d = openL1([golden, gerbil, budgie]);
    expect(within(d).getByRole('heading', { name: COPY.homeA.heroCta })).toBeInTheDocument();
    const groupButtons = d.querySelectorAll('[data-ws-group]');
    expect(Array.from(groupButtons).map((b) => b.textContent)).toEqual([COPY.groups.SMALL_MAMMAL, COPY.groups.PARROT]);
    // F10: 그룹 마스코트는 자산 원만 — AnimalAvatar 디스크 없음, 리포 자산 경로, lg 96
    for (const [i, g] of (['group-small-mammal', 'group-parrot'] as const).entries()) {
      expect(groupButtons[i].querySelector('.ws-avatar')).toBeNull();
      const img = groupButtons[i].querySelector('img') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe(`/mascots/${g}.svg`);
      expect(img.getAttribute('width')).toBe('96');
      expect(img.getAttribute('alt')).toBe('');
    }
    fireEvent.click(groupButtons[0]);
    expect(within(d).getByRole('heading', { name: COPY.groups.SMALL_MAMMAL })).toBeInTheDocument();
    const cards = Array.from(d.querySelectorAll('[data-ws-type]')).map((c) => c.getAttribute('data-ws-type'));
    expect(cards).toEqual([golden.id, gerbil.id]); // 앵무새 그룹 타입 없음
    expect(within(d).getByText(`${golden.aliases[0]}라고도 불러요`)).toBeInTheDocument();
    fireEvent.click(within(d).getByRole('button', { name: /합성저빌/ }));
    expect(window.localStorage.getItem(ANIMAL_TYPE_KEY)).toBe(gerbil.id);
    expect(calls).toEqual([['species_selected', { animalTypeId: gerbil.id, group: 'SMALL_MAMMAL', via: 'picker' }]]);
    expect(assign).toHaveBeenCalledWith('/gerbil/mongolian');
  });

  it('"사막다람쥐" → 저빌 후보(고정 문구 상시), [이 친구가 맞아요] → via:alias + 이동', () => {
    const d = openL1([golden, gerbil]);
    const input = goUnsure(d);
    expect(within(d).getByText(COPY.picker.candidateNote)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '사막다람쥐' } });
    const rows = d.querySelectorAll('.ws-picker-cand');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-ws-type')).toBe(gerbil.id);
    expect(within(rows[0] as HTMLElement).getByText('사막다람쥐라고도 불러요')).toBeInTheDocument();
    expect(within(d).getByText(COPY.picker.candidateNote)).toBeInTheDocument();
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: COPY.picker.confirm }));
    expect(calls).toEqual([['species_selected', { animalTypeId: gerbil.id, group: 'SMALL_MAMMAL', via: 'alias' }]]);
    expect(assign).toHaveBeenCalledWith('/gerbil/mongolian');
  });

  it('6개 일치 → 후보 최대 5개', () => {
    const six = Array.from({ length: 6 }, (_, i) => synth(`ham-${'abcdef'[i]}`, `합성햄찌${i}`, []));
    const d = openL1(six);
    fireEvent.change(goUnsure(d), { target: { value: '햄찌' } });
    expect(d.querySelectorAll('.ws-picker-cand')).toHaveLength(5);
  });

  it('0개 → "목록에서 찾지 못했어요"(준비 중 아님, MINOR-7) + ‹ 그룹 선택(복귀) + unknown_species_clicked{정제된 query} 1회', async () => {
    const d = openL1([golden, gerbil]);
    const input = goUnsure(d);
    for (const q of ['팬더', '고양이']) {
      fireEvent.change(input, { target: { value: q } });
      expect(within(d).getByText(COPY.picker.noMatch)).toBeInTheDocument();
      expect(within(d).queryByText(COPY.planned.title)).toBeNull();
    }
    fireEvent.change(input, { target: { value: '  고슴도치!!123 ' } });
    expect(within(d).getByText(COPY.picker.noMatch)).toBeInTheDocument();
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    fireEvent.click(within(d).getByRole('button', { name: COPY.picker.backToGroups }));
    expect(calls).toEqual([['unknown_species_clicked', { query: '고슴도치' }]]);
    await waitFor(() => expect(d.querySelectorAll('[data-ws-group]')).toHaveLength(2));
    expect(assign).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(ANIMAL_TYPE_KEY)).toBeNull();
  });

  it('② 노출 타입 밖 이름 0 — 다른 이름·별칭으로 찾아도 data.types 에 없는 친구는 나오지 않는다', () => {
    const d = openL1([golden]);
    fireEvent.click(d.querySelectorAll('[data-ws-group]')[1]); // 앵무새: 노출 타입 없음
    expect(d.querySelectorAll('[data-ws-type]')).toHaveLength(0);
    expect(within(d).getByText(COPY.planned.title)).toBeInTheDocument();
    const input = goUnsure(d);
    for (const q of ['저빌', '사막다람쥐', '잉꼬', '사랑새', '드워프']) {
      fireEvent.change(input, { target: { value: q } });
      expect(d.querySelectorAll('.ws-picker-cand')).toHaveLength(0);
    }
    expect(d.textContent).not.toMatch(/저빌|잉꼬|사랑새|드워프/);
    expect(within(d).queryByText(COPY.planned.badge)).toBeNull(); // "준비 중" 칩 없음(PLANNED 미노출)
  });

  describe('MINOR-6 단계 = L1 히스토리 스텝(뒤로 = 이전 단계, 첫 단계에서 뒤로 = 닫기)', () => {
    const stepOf = (d: HTMLElement) => d.querySelector('[data-ws-step]')?.getAttribute('data-ws-step');
    const headerBack = (d: HTMLElement) => d.querySelector('.ws-layer-back') as HTMLButtonElement;

    it('그룹 → 종류 → 잘 모르겠어요 후 브라우저 뒤로 ×2 → 그룹(L1 유지), 한 번 더 → 닫힘', async () => {
      const d = openL1([golden, gerbil]);
      fireEvent.click(d.querySelectorAll('[data-ws-group]')[0]);
      expect(stepOf(d)).toBe('types');
      goUnsure(d);
      expect(stepOf(d)).toBe('unsure');
      act(() => window.history.back());
      await waitFor(() => expect(stepOf(screen.getByRole('dialog'))).toBe('types'));
      act(() => window.history.back());
      await waitFor(() => expect(stepOf(screen.getByRole('dialog'))).toBe('groups'));
      act(() => window.history.back());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(calls).toEqual([]);
    });

    it('‹ 머리 버튼도 같은 경로 — 잘 모르겠어요 → 종류 → 그룹, 다음 뒤로 → 닫힘', async () => {
      const d = openL1([golden, gerbil]);
      const before = window.history.length;
      fireEvent.click(d.querySelectorAll('[data-ws-group]')[0]);
      goUnsure(d);
      fireEvent.click(headerBack(d));
      await waitFor(() => expect(stepOf(screen.getByRole('dialog'))).toBe('types'));
      fireEvent.click(headerBack(screen.getByRole('dialog')));
      await waitFor(() => expect(stepOf(screen.getByRole('dialog'))).toBe('groups'));
      expect(headerBack(screen.getByRole('dialog'))).toBeNull();
      expect(window.history.length).toBe(before + 2); // ‹ 는 push 가 아니라 뒤로
      act(() => window.history.back());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('종류에서 연 0건 안내의 "‹ 그룹 선택" → 그룹 항목까지 되돌아감(뒤로 다음 = 닫힘)', async () => {
      const d = openL1([golden, gerbil]);
      fireEvent.click(d.querySelectorAll('[data-ws-group]')[0]);
      fireEvent.change(goUnsure(d), { target: { value: '팬더' } });
      fireEvent.click(within(d).getByRole('button', { name: COPY.picker.backToGroups }));
      await waitFor(() => expect(stepOf(screen.getByRole('dialog'))).toBe('groups'));
      act(() => window.history.back());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('딥링크로 종류 단계에 진입 — ‹ 는 그룹으로 교체(닫히지 않음), 그룹에서 ✕ 없이 상태 일관', () => {
      const page = pageOf('HOME', { types: [golden, gerbil] });
      render(
        <LayerPageProvider page={page}>
          <LayerHost registry={layerRegistry} />
        </LayerPageProvider>,
      );
      act(() => layerStore.initDeepLink('L1', { step: 'types:SMALL_MAMMAL' }, '/'));
      const d = screen.getByRole('dialog');
      expect(stepOf(d)).toBe('types');
      const before = window.history.length;
      fireEvent.click(headerBack(d));
      expect(stepOf(screen.getByRole('dialog'))).toBe('groups');
      expect(window.history.length).toBe(before);
    });
  });

  describe('선택 가로채기 setPickHandler(이중 이동 방지)', () => {
    function pickGerbil() {
      const d = openL1([golden, gerbil]);
      fireEvent.click(d.querySelectorAll('[data-ws-group]')[0]);
      fireEvent.click(within(d).getByRole('button', { name: /합성저빌/ }));
    }

    it('핸들러가 true → nav.assign 미호출, 저장·species_selected 는 그대로', () => {
      const seen: Array<[string, string]> = [];
      const off = setPickHandler((t, via) => (seen.push([t.id, via]), true));
      try {
        pickGerbil();
      } finally {
        off();
      }
      expect(seen).toEqual([[gerbil.id, 'picker']]);
      expect(assign).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(ANIMAL_TYPE_KEY)).toBe(gerbil.id);
      expect(calls).toEqual([['species_selected', { animalTypeId: gerbil.id, group: 'SMALL_MAMMAL', via: 'picker' }]]);
    });

    it('핸들러가 false → 기존 이동', () => {
      const off = setPickHandler(() => false);
      try {
        pickGerbil();
      } finally {
        off();
      }
      expect(assign).toHaveBeenCalledWith('/gerbil/mongolian');
    });

    it('해제 후(또는 미등록) → 기존 이동, 늦은 해제는 새 핸들러를 지우지 않는다', () => {
      const offA = setPickHandler(() => true);
      offA();
      pickGerbil();
      expect(assign).toHaveBeenCalledWith('/gerbil/mongolian');
      const offB = setPickHandler(() => true);
      offA(); // 이미 해제된 A — B 유지
      act(() => layerStore.resetForTest());
      cleanup();
      window.history.replaceState(null, '', '/');
      assign.mockClear();
      pickGerbil();
      expect(assign).not.toHaveBeenCalled();
      offB();
    });
  });

  it('지금 페이지의 친구를 다시 고르면 이동 없이 닫는다', () => {
    window.history.replaceState(null, '', '/hamster/golden');
    const d = openL1([golden]);
    fireEvent.click(d.querySelectorAll('[data-ws-group]')[0]);
    fireEvent.click(within(d).getByRole('button', { name: /골든햄스터/ }));
    expect(assign).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/');
  });
});
