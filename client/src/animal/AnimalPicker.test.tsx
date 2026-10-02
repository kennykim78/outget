// F6 L1 친구 선택: ① "사막다람쥐" → 저빌(합성 별칭), 6매칭 → 5, 0 → 안내 + 그룹 복귀 + unknown_species_clicked,
//   선택 이벤트(picker·alias) + location.assign ② PLANNED·비노출 이름 0. 합성 fixture(시드 아님).
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

  it('0개 → "아직 준비 중인 친구예요" + ‹ 그룹 선택(복귀) + unknown_species_clicked{정제된 query} 1회', () => {
    const d = openL1([golden, gerbil]);
    const input = goUnsure(d);
    fireEvent.change(input, { target: { value: '  고슴도치!!123 ' } });
    expect(within(d).getByText(COPY.planned.title)).toBeInTheDocument();
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    fireEvent.click(within(d).getByRole('button', { name: COPY.picker.backToGroups }));
    expect(calls).toEqual([['unknown_species_clicked', { query: '고슴도치' }]]);
    expect(d.querySelectorAll('[data-ws-group]')).toHaveLength(2);
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

  it('지금 페이지의 친구를 다시 고르면 이동 없이 닫는다', () => {
    window.history.replaceState(null, '', '/hamster/golden');
    const d = openL1([golden]);
    fireEvent.click(d.querySelectorAll('[data-ws-group]')[0]);
    fireEvent.click(within(d).getByRole('button', { name: /골든햄스터/ }));
    expect(assign).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/');
  });
});
