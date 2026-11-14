// qa MED-1: 레일은 사용자가 직접 움직이기 전까지 시작(scrollLeft 0)에 고정 — 하이드레이션 뒤 칩 재정렬 시
//   Chrome scroll-snap 재스냅이 원래 첫 칩을 따라가 새 첫 칩이 왼쪽으로 잘리던 결함. jsdom 은 레이아웃이 없어 scrollLeft 를 흉내 낸다.
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RailSection from './RailSection';

function fakeScroll(el: HTMLElement): { set(v: number): void; get(): number } {
  let v = 0;
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => v,
    set: (n: number) => {
      v = n;
    },
  });
  return { set: (n) => (v = n), get: () => v };
}

function rail(items: string[]) {
  return (
    <RailSection id="now" kind="need" title="지금 필요한 것" prevLabel={null} nextLabel={null}>
      {items.map((x) => (
        <li key={x} data-ws-item={x}>
          <a href={`#${x}`}>{x}</a>
        </li>
      ))}
    </RailSection>
  );
}

describe('RailSection 시작 고정(MED-1)', () => {
  it('재정렬 렌더 뒤 재스냅으로 밀린 위치를 시작으로 되돌린다', () => {
    const { container, rerender } = render(rail(['wheel', 'cage']));
    const ul = container.querySelector('ul')!;
    const s = fakeScroll(ul);
    s.set(36); // 브라우저 재스냅(이전 스냅 대상 따라감)
    rerender(rail(['cage', 'wheel']));
    expect(s.get()).toBe(0);
  });

  it('렌더 밖 재스냅(스크롤 이벤트)도 시작으로 되돌린다', () => {
    const { container } = render(rail(['a', 'b']));
    const ul = container.querySelector('ul')!;
    const s = fakeScroll(ul);
    s.set(36);
    fireEvent.scroll(ul);
    expect(s.get()).toBe(0);
  });

  it.each(['pointerDown', 'wheel', 'touchStart', 'keyDown', 'focusIn'] as const)('사용자 의도(%s) 뒤에는 위치를 건드리지 않는다', (ev) => {
    const { container, rerender } = render(rail(['a', 'b']));
    const ul = container.querySelector('ul')!;
    const s = fakeScroll(ul);
    fireEvent[ev](ul);
    s.set(36);
    fireEvent.scroll(ul);
    rerender(rail(['b', 'a']));
    expect(s.get()).toBe(36);
  });
});
