// shell/AnimalChip — K1: 헤더 칩 = a[data-ws-chip][href="/pick"](선택 여부 무관), 일반 클릭 → L1, 수정 키·중클릭은 기본 동작.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { NO_CAPTURE } from '../app/staticCapture';
import { golden, pageOf } from '../test/fixtures';
import { layerStore } from '../ui/layer/useLayer';

beforeEach(() => {
  localStorage.clear();
  act(() => layerStore.resetForTest());
});

afterEach(() => {
  act(() => layerStore.resetForTest());
});

describe('AnimalChip /pick', () => {
  it.each([
    ['미선택(홈)', pageOf('HOME'), '친구 선택'],
    ['선택(타입 홈)', pageOf('TYPE', {}, { typeId: golden.id, path: '/hamster/golden' }), '골든햄스터'],
  ])('%s: href=/pick, 접근 이름 유지, 일반 클릭 L1(defaultPrevented) · ctrl/meta/shift/alt/중클릭은 기본 동작', (_l, page, name) => {
    render(<App page={page} captured={NO_CAPTURE} />);
    const chip = within(screen.getByRole('banner')).getByRole('link', { name: new RegExp(name) });
    expect(chip).toHaveAttribute('data-ws-chip');
    expect(chip).toHaveAttribute('href', '/pick');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      expect(fireEvent.click(chip, mod)).toBe(true);
      expect(layerStore.get()).toBeNull();
    }
    let notPrevented = true;
    act(() => {
      notPrevented = fireEvent.click(chip);
    });
    expect(notPrevented).toBe(false); // defaultPrevented=true
    expect(layerStore.get()?.kind).toBe('L1');
    expect(chip).toHaveAttribute('aria-expanded', 'true');
  });
});
