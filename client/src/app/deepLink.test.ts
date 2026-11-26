// app/deepLink — 딥링크 레이어 판정(C-R5-5 · D-55).
import { describe, expect, it } from 'vitest';
import { golden, pageOf } from '../test/fixtures';
import { deepLinkFor } from './deepLink';
import { routeView } from './routeView';

describe('deepLinkFor', () => {
  it('TYPE + L4: 부모 = 타입 홈, 보관 aside 의 data-ws-id 는 종류가 같을 때만', () => {
    const p = pageOf('TYPE', {}, { typeId: golden.id, path: '/hamster/golden/supplies/cage', layer: { kind: 'L4', typeId: golden.id, itemId: 'cage' } });
    expect(deepLinkFor(p, { kind: 'L4', wsId: 'supplyRequirements#r1' }, null)).toEqual({
      kind: 'L4',
      props: { typeId: golden.id, itemId: 'cage' },
      parent: '/hamster/golden',
      documentParent: false,
      wsId: 'supplyRequirements#r1',
    });
    expect(deepLinkFor(p, { kind: 'L7', wsId: 'curatedProducts#x' }, null)?.wsId).toBeNull();
  });

  it('TYPE + L7: productId props', () => {
    const p = pageOf('TYPE', {}, { typeId: golden.id, layer: { kind: 'L7', typeId: golden.id, productId: 'p1' } });
    expect(deepLinkFor(p, null, null)?.props).toEqual({ typeId: golden.id, productId: 'p1' });
  });

  it('SAVE: 저장 타입 있으면 부모 = 타입 홈(다른 문서), 없으면 "/"(같은 문서)', () => {
    const p = pageOf('SAVE', {}, { path: '/save' });
    expect(deepLinkFor(p, null, golden)).toMatchObject({ kind: 'L8', parent: '/hamster/golden', documentParent: true });
    expect(deepLinkFor(p, null, null)).toMatchObject({ kind: 'L8', parent: '/', documentParent: false });
  });

  it('K1 PICK(/pick): L1, 부모 = "/"(같은 문서 = 홈 A, 저장 타입 무관), 보관 aside wsId 는 L1 일 때만 · NOT_FOUND 는 null', () => {
    const p = pageOf('PICK', {}, { path: '/pick' });
    expect(deepLinkFor(p, null, golden)).toEqual({ kind: 'L1', props: {}, parent: '/', documentParent: false, wsId: null });
    expect(deepLinkFor(p, { kind: 'L1', wsId: 'pick#1' }, null)?.wsId).toBe('pick#1');
    expect(deepLinkFor(p, { kind: 'L4', wsId: 'x#1' }, null)?.wsId).toBeNull();
    expect(deepLinkFor(pageOf('NOT_FOUND', {}, { path: '/pick' }), null, null)).toBeNull();
    expect(routeView(p)).toEqual({ view: 'homeA' });
  });

  // 383(PRD 183-187): 용품으로 찾기의 /supplies/{item}/{type} 도 같은 L4. 부모 = /supplies/{item}(프리렌더 misc.ts 가 선언한 부모, 같은 문서).
  it('SUPPLY_ITEM_TYPE + L4: 부모 = /supplies/{item}(같은 문서), L4 아닌 레이어 → null', () => {
    const extra = { typeId: golden.id, path: '/supplies/cage/hamster-golden' };
    const p = pageOf('SUPPLY_ITEM_TYPE', {}, { ...extra, layer: { kind: 'L4', typeId: golden.id, itemId: 'cage' } });
    expect(deepLinkFor(p, { kind: 'L4', wsId: 'supplyRequirements#r1' }, golden)).toEqual({
      kind: 'L4',
      props: { typeId: golden.id, itemId: 'cage' },
      parent: '/supplies/cage',
      documentParent: false,
      wsId: 'supplyRequirements#r1',
      backToParent: true,
    });
    expect(deepLinkFor(pageOf('SUPPLY_ITEM_TYPE', {}, { ...extra, layer: { kind: 'L5', typeId: golden.id, itemId: 'cage' } }), null, null)).toBeNull();
  });

  it('레이어 없는 TYPE·HOME·타입 불일치 → null', () => {
    expect(deepLinkFor(pageOf('TYPE', {}, { typeId: golden.id }), null, null)).toBeNull();
    expect(deepLinkFor(pageOf('HOME'), null, null)).toBeNull();
    const mismatch = pageOf('TYPE', {}, { typeId: golden.id, layer: { kind: 'L4', typeId: 'other', itemId: 'cage' } });
    expect(deepLinkFor(mismatch, null, null)).toBeNull();
  });
});
