// shell/pickLink — /pick 상수 parity(레인 A 서버 엔진 상수·라우트 종류와 대조) + 클릭 가로채기 규칙.
import { describe, expect, it, vi } from 'vitest';
import * as engine from '@ws/engine';
import { PICK_PATH, pickLinkClick } from './pickLink';

describe('PICK_PATH parity', () => {
  it("클라이언트 상수 = 엔진 PICK_PATH = '/pick'(K1), 엔진 ROUTE_KINDS 에 'PICK'", () => {
    expect(PICK_PATH).toBe('/pick');
    expect(engine.PICK_PATH).toBe(PICK_PATH);
    expect(engine.ROUTE_KINDS).toContain('PICK');
  });
});

describe('pickLinkClick', () => {
  type Ev = Parameters<ReturnType<typeof pickLinkClick>>[0];
  const ev = (over: Partial<Record<'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented', unknown>> = {}) => {
    const preventDefault = vi.fn();
    const e = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault, ...over };
    return { e: e as unknown as Ev, preventDefault };
  };

  it('일반 좌클릭: preventDefault + open', () => {
    const open = vi.fn();
    const { e, preventDefault } = ev();
    pickLinkClick(open)(e);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }])(
    '%o: 기본 동작 유지(open 없음)',
    (over) => {
      const open = vi.fn();
      const { e, preventDefault } = ev(over);
      pickLinkClick(open)(e);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    },
  );
});
