// 305(계획 300 단계 10): /{slug}/tips 라우트 — 정적 본문(StaticMain)·딥링크 레이어 없음·메뉴 활성 없음·데이터 없이 판별하지 않음.
import { describe, expect, it } from 'vitest';
import { ROUTE_KINDS } from '@ws/engine';
import { golden, pageOf } from '../test/fixtures';
import { navCurrentFor } from '../shell/shellType';
import { deepLinkFor } from './deepLink';
import { routeFromLocation } from './pageData';
import { routeView } from './routeView';

describe('TIPS 라우트', () => {
  const page = pageOf('TIPS', {}, { path: '/hamster/golden/tips', typeId: golden.id });

  it('엔진 ROUTE_KINDS 에 TIPS', () => {
    expect(ROUTE_KINDS).toContain('TIPS');
  });

  it('routeView = static(프리렌더 main 보관분), 레이어 딥링크 없음(저장 타입 무관)', () => {
    expect(routeView(page)).toEqual({ view: 'static' });
    expect(deepLinkFor(page, null, null)).toBeNull();
    expect(deepLinkFor(page, null, golden)).toBeNull();
    expect(deepLinkFor(page, { kind: 'L4', wsId: 'x#1' }, golden)).toBeNull();
  });

  it('메뉴 활성 표시 없음(서버 navCurrent 와 같은 null)', () => {
    expect(navCurrentFor('TIPS')).toBeNull();
    expect(navCurrentFor('SETUP')).toBe('home');
  });

  it('ws-data 없이 /…/tips 경로만으로는 판별하지 않는다(NOT_FOUND — 팁을 지어내지 않음)', () => {
    expect(routeFromLocation({ pathname: '/hamster/golden/tips' }).kind).toBe('NOT_FOUND');
    expect(routeFromLocation({ pathname: '/hamster/golden/tips/' }).kind).toBe('NOT_FOUND');
  });
});
