// save/magicLink — /save#t= 토큰은 읽는 즉시 URL 에서 지운다(replaceState, state 보존). 메모리에만.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureMagicToken, clearMagicToken, hasMagicHash, subscribeMagicToken } from './magicLink';

const TOKEN = 'A'.repeat(20) + '_-' + 'b'.repeat(21); // 43자 base64url

afterEach(() => {
  clearMagicToken();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('captureMagicToken', () => {
  it('/save#t=<token> → 토큰 반환 + location.hash === "" + history.state 보존', () => {
    window.history.replaceState({ keep: 1 }, '', `/save#t=${TOKEN}`);
    const spy = vi.spyOn(window.history, 'replaceState');
    expect(captureMagicToken()).toEqual({ token: TOKEN });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/save');
    expect(window.history.state).toEqual({ keep: 1 });
    // 멱등 — 이미 지웠으니 다시 replaceState 하지 않고 같은 토큰.
    expect(captureMagicToken()).toEqual({ token: TOKEN });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('형식이 틀린 토큰도 지우고 invalid 로 표시', () => {
    window.history.replaceState(null, '', '/save#t=short');
    expect(captureMagicToken()).toEqual({ invalid: true });
    expect(window.location.hash).toBe('');
  });

  it('/save 가 아닌 경로의 t= 프래그먼트도 지우되 붙잡지 않는다', () => {
    window.history.replaceState(null, '', `/hamster/golden#t=${TOKEN}`);
    expect(captureMagicToken()).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('프래그먼트 없음 → replaceState 0, null', () => {
    window.history.replaceState(null, '', '/save');
    const spy = vi.spyOn(window.history, 'replaceState');
    expect(captureMagicToken()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('clearMagicToken 뒤엔 null', () => {
    window.history.replaceState(null, '', `/save#t=${TOKEN}`);
    captureMagicToken();
    clearMagicToken();
    expect(captureMagicToken()).toBeNull();
  });
});

describe('hasMagicHash · subscribeMagicToken (같은 탭 D1)', () => {
  it('hasMagicHash: /save + t= 만 true(토큰 형식 무관), 다른 경로·다른 해시는 false', () => {
    expect(hasMagicHash({ pathname: '/save', hash: `#t=${TOKEN}` })).toBe(true);
    expect(hasMagicHash({ pathname: '/save/', hash: '#t=bad' })).toBe(true);
    expect(hasMagicHash({ pathname: '/save', hash: '#top' })).toBe(false);
    expect(hasMagicHash({ pathname: '/hamster/golden', hash: `#t=${TOKEN}` })).toBe(false);
  });

  it('새 토큰을 붙잡을 때만 알림(멱등 재호출·다른 경로는 알림 0), 해제 후 0', () => {
    const l = vi.fn();
    const off = subscribeMagicToken(l);
    window.history.replaceState(null, '', `/save#t=${TOKEN}`);
    captureMagicToken();
    expect(l).toHaveBeenCalledTimes(1);
    captureMagicToken();
    expect(l).toHaveBeenCalledTimes(1);
    window.history.replaceState(null, '', `/hamster/golden#t=${TOKEN}`);
    captureMagicToken();
    expect(l).toHaveBeenCalledTimes(1);
    off();
    window.history.replaceState(null, '', '/save#t=bad');
    captureMagicToken();
    expect(l).toHaveBeenCalledTimes(1);
  });
});
