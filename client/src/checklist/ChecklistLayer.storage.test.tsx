// F7 ② 저장 불가(localStorage 쓰기 throw) → 세션 메모리로 동작 + 저장 불가 안내 1회, "이 기기에만 저장돼요" 동시 표시 0(결정 c).
//   wsStorage 는 모듈 단일 객체 — 이 파일은 별도 모듈 그래프(vitest 파일 격리)라 다른 테스트에 영향 없음.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { COPY } from '@ws/copy';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LayerPageProvider } from '../app/layerPage';
import { layerRegistry } from '../app/layerRegistry';
import { setTrackerForTest } from '../events/track';
import { golden, pageOf, req } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';

const PAGE = pageOf('TYPE', { requirements: [req('cage', 'REQUIRED', '합성케이지'), req('wheel', 'REQUIRED', '합성바퀴')] }, { typeId: golden.id });

beforeAll(() => {
  window.localStorage.clear();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
  setTrackerForTest({ track: () => undefined, flush: () => undefined, dispose: () => undefined });
});
afterAll(() => {
  vi.restoreAllMocks();
  setTrackerForTest(null);
});

describe('L2 저장 불가', () => {
  it('메모리로 답·토글 유지, 안내 1회, 기기 저장 문구 없음 — 다시 열어도 안내 재표시·기기 문구 없음', () => {
    render(
      <LayerPageProvider page={PAGE}>
        <LayerHost registry={layerRegistry} />
      </LayerPageProvider>,
    );
    act(() => layerStore.open('L2'));
    let d = screen.getByRole('dialog');
    fireEvent.click(within(d).getByLabelText(COPY.setupQ.firstTime));
    fireEvent.click(within(d).getByRole('button', { name: COPY.setupQ.next }));
    fireEvent.click(within(d).getByRole('checkbox', { name: /합성케이지/ }));
    expect(within(d).getByRole('checkbox', { name: /합성케이지/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(d).getAllByText(new RegExp(COPY.checklist.storageUnavailable))).toHaveLength(1);
    expect(d.textContent).not.toContain(COPY.homeB.deviceOnly);
    expect(window.localStorage.length).toBe(0);

    act(() => layerStore.resetForTest());
    act(() => layerStore.open('L2'));
    d = screen.getByRole('dialog');
    expect(d.querySelector('[data-ws-step="L2"]')).not.toBeNull(); // 세션 메모리 유지
    expect(within(d).getByRole('checkbox', { name: /합성케이지/ })).toHaveAttribute('aria-checked', 'true');
    expect(d.textContent).not.toContain(COPY.checklist.storageUnavailable);
    expect(d.textContent).not.toContain(COPY.homeB.deviceOnly);
    act(() => layerStore.resetForTest());
  });
});
