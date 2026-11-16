// D9 ② — 이유 한 줄 = whyShort ?? firstSentence(why)(engine reasonLine, 프리렌더 type.ts 와 같은 함수).
//   홈 B 지금 필요한 것 카드 · 나중에 필요한 것(NOT_NOW: notNowReason 우선) · L2 체크리스트 행(호환 이유 > notNowReason > whyShort > 첫 문장).
//   whyShort 값은 합성 fixture 에만(실시드 아님).
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { COPY } from '@ws/copy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PublicRequirement } from '@ws/engine';
import App from '../App';
import { LayerPageProvider } from '../app/layerPage';
import { layerRegistry } from '../app/layerRegistry';
import { NO_CAPTURE } from '../app/staticCapture';
import { reasonLine } from '../checklist/reasonLine';
import { golden, pageOf, req } from '../test/fixtures';
import LayerHost from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';

const CAGE: PublicRequirement = { ...req('cage', 'REQUIRED', '합성케이지'), why: '합성 첫 문장이에요. 둘째 문장.', whyShort: '합성 짧은 이유예요.' };
const WHEEL: PublicRequirement = { ...req('wheel', 'REQUIRED', '합성바퀴'), why: '바퀴 첫 문장이에요. 둘째 문장.' };
const LATER_WITH_REASON: PublicRequirement = {
  ...req('ball', 'NOT_NOW', '합성공'),
  notNowReason: '나중 이유 문장',
  whyShort: '공 짧은 이유예요.',
};
const LATER_NO_REASON: PublicRequirement = { ...req('disc', 'NOT_NOW', '합성원반'), why: '원반 첫 문장. 둘째.', whyShort: '원반 짧은 이유예요.' };

const PAGE = pageOf(
  'TYPE',
  { requirements: [CAGE, WHEEL, LATER_WITH_REASON, LATER_NO_REASON] },
  { typeId: golden.id, path: '/hamster/golden' },
);

beforeEach(() => {
  localStorage.clear();
  act(() => layerStore.resetForTest());
});
afterEach(() => {
  act(() => layerStore.resetForTest());
});

describe('reasonLine 재노출(client)', () => {
  it('whyShort 우선, 없으면 첫 문장', () => {
    expect(reasonLine(CAGE)).toBe('합성 짧은 이유예요.');
    expect(reasonLine(WHEEL)).toBe('바퀴 첫 문장이에요.');
  });
});

describe('홈 B — 이유 줄', () => {
  it('지금 필요한 것 카드: whyShort 행은 whyShort, 없는 행은 why 첫 문장', () => {
    render(<App page={PAGE} captured={NO_CAPTURE} />);
    const now = document.querySelector('[data-ws-section="now"]') as HTMLElement;
    const reasonOf = (item: string) => now.querySelector(`li[data-ws-item="${item}"] .ws-now-reason`)?.textContent;
    expect(reasonOf('cage')).toBe('합성 짧은 이유예요.');
    expect(reasonOf('wheel')).toBe('바퀴 첫 문장이에요.');
    expect(now).not.toHaveTextContent('합성 첫 문장이에요.');
  });

  it('나중에 필요한 것: notNowReason 우선 그대로, 없으면 whyShort', () => {
    render(<App page={PAGE} captured={NO_CAPTURE} />);
    const later = document.querySelector('[data-ws-section="later"]') as HTMLElement;
    const reasonOf = (item: string) => later.querySelector(`li[data-ws-item="${item}"] .ws-later-reason`)?.textContent;
    expect(reasonOf('ball')).toBe('나중 이유 문장');
    expect(reasonOf('disc')).toBe('원반 짧은 이유예요.');
  });
});

describe('L2 체크리스트 행 — 이유 줄', () => {
  it('REQUIRED: whyShort > 첫 문장 · NOT_NOW: notNowReason > whyShort', () => {
    render(
      <LayerPageProvider page={PAGE}>
        <LayerHost registry={layerRegistry} />
      </LayerPageProvider>,
    );
    act(() => layerStore.open('L2'));
    const d = screen.getByRole('dialog');
    // L3(질문) 먼저 — 「이미 있어요」 + 보유 0 → [다음] → L2 행.
    fireEvent.click(within(d).getByLabelText(COPY.setupQ.already));
    fireEvent.click(within(d).getByRole('button', { name: COPY.setupQ.next }));
    const row = (name: string) => within(d).getByRole('checkbox', { name: new RegExp(name) });
    expect(row('합성케이지')).toHaveTextContent('합성 짧은 이유예요.');
    expect(row('합성케이지')).not.toHaveTextContent('합성 첫 문장이에요.');
    expect(row('합성바퀴')).toHaveTextContent('바퀴 첫 문장이에요.');
    expect(row('합성공')).toHaveTextContent('나중 이유 문장');
    expect(row('합성공')).not.toHaveTextContent('공 짧은 이유예요.');
    expect(row('합성원반')).toHaveTextContent('원반 짧은 이유예요.');
  });
});
