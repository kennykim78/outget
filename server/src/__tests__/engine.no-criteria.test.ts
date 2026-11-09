// arch-23 결정 ②(Codex 점검 #1) — 최소·권장 규칙이 모두 빈 품목 = 「기준 없음」.
//   제품 단계 verdict CHECK + NO_CRITERIA(verdict CHECK) 1건(OK 아님), isNoCriteria 단일 판별(D-1),
//   minSpecResult meets=false → checkProfileMinSpec(P01)·checkAnimalMinSpec(노출) 모두 제외(불변식 ③ fail-closed),
//   기준 없음 + 호환 NONE·OK 면 대안 0, 호환 BELOW_MIN·CHECK 면 대안 유지(D-3).
//   실시드 사실값은 바꾸지 않는다(메모리 사본만). 합성 규칙 값은 엔진 경로 시험용 임의값.
import { describe, expect, it } from 'vitest';
import {
  checkAnimalMinSpec,
  checkProfileMinSpec,
  createCatalog,
  isNoCriteria,
  isProductExposable,
  orderExposableProducts,
  specCheck,
} from '../engine/index.js';
import { makeBundle } from './fixtures/engine-catalog.js';
import { DWARF_PREVIEW_AS_OF, dwarfPreview, realSeed } from './fixtures/prerender-seed.js';

const G = 'hamster-golden';
const CP_SYRIAN = 'cp-hamster-syrian';

describe('실시드 — 골든 carrier(최소·권장 규칙 0)', () => {
  const cat = createCatalog(realSeed());

  it('specCheck → verdict CHECK · isNoCriteria · 대안 0, 입력(예·아니오·빈 값) 무관 같은 제품 단계', () => {
    const no = specCheck(cat, G, 'carrier', { ventilated: false });
    expect(no.verdict).toBe('CHECK');
    expect(no.product).toEqual({
      verdict: 'CHECK',
      reasons: [{ stage: 'PRODUCT', kind: 'NO_CRITERIA', verdict: 'CHECK', message: '등록된 규격 기준이 없는 용품이에요.' }],
    });
    expect(isNoCriteria(no.product)).toBe(true);
    expect(no.alternatives).toEqual([]);
    expect(no.compat.verdict).toBe('NONE');
    for (const input of [{ ventilated: true }, {}]) expect(specCheck(cat, G, 'carrier', input).product).toEqual(no.product);
  });

  it('checkAnimalMinSpec · checkProfileMinSpec → meets false · verdict CHECK', () => {
    const a = checkAnimalMinSpec(cat, G, 'carrier', {});
    const p = checkProfileMinSpec(cat, CP_SYRIAN, 'carrier', {});
    expect([a.meets, a.verdict, isNoCriteria(a)]).toEqual([false, 'CHECK', true]);
    expect([p.meets, p.verdict, isNoCriteria(p)]).toEqual([false, 'CHECK', true]);
  });

  it('한쪽에 규칙이 있는 품목(드워프 carrier: 권장만)은 기준 없음이 아니다', () => {
    const r = specCheck(cat, 'hamster-dwarf', 'carrier', { ventilated: true });
    expect(isNoCriteria(r.product)).toBe(false);
    expect(r.product.reasons.some((x) => x.kind === 'NO_CRITERIA')).toBe(false);
  });
});

describe('careOverrides 로 규칙이 생긴 동물은 정상 판정(resolveRequirement 경유, 불변식 ⑥)', () => {
  it('critter 에만 disc 최소 규칙 override → critter 는 OK/meets, critter-plain 은 기준 없음', () => {
    const b = makeBundle();
    const critter = b.animalTypes.find((a) => a.id === 'critter')!;
    critter.careOverrides.requirements!.disc = {
      ...critter.careOverrides.requirements!.disc,
      minSpec: { rules: [{ key: 'sizeCm', op: 'gte', value: 10, reason: '합성 규칙' }] },
    };
    const cat = createCatalog(b);
    expect(checkAnimalMinSpec(cat, 'critter', 'disc', { sizeCm: 12 })).toMatchObject({ meets: true, verdict: 'OK' });
    const plain = checkAnimalMinSpec(cat, 'critter-plain', 'disc', { sizeCm: 12 });
    expect([plain.meets, plain.verdict, isNoCriteria(plain)]).toEqual([false, 'CHECK', true]);
    // 프로필 기준(P01)은 override 를 보지 않는다 — 기준 없음 그대로.
    expect(checkProfileMinSpec(cat, 'pf-test', 'disc', { sizeCm: 12 }).meets).toBe(false);
  });
});

describe('D-3 대안 경계 — 기준 없음 × 호환 판정(합성 카탈로그, 메모리)', () => {
  const box = { ownedItems: { box: { type: 'BOX', widthCm: 60, heightCm: 40 } } };
  /** gadget(규칙 0)에 같은 프로필 대안 disc 를 붙이고, 호환 규칙을 바꿔 끼운다. */
  const catWith = (rules: Array<{ expr: string; onFail: 'BELOW_MIN' | 'CHECK'; message: string }>) => {
    const b = makeBundle();
    b.supplyItems.find((i) => i.id === 'gadget')!.compatibleAlternativeIds = ['disc'];
    const cx = b.compatibilityRules.find((r) => r.id === 'cx-broken')!;
    cx.rules = rules;
    return createCatalog(b);
  };

  it('호환 NONE(보유품 없음) → 대안 0', () => {
    const r = specCheck(catWith([{ expr: 'false', onFail: 'BELOW_MIN', message: '합성 실패' }]), 'critter-plain', 'gadget', {});
    expect([r.verdict, r.compat.verdict, r.alternatives]).toEqual(['CHECK', 'NONE', []]);
  });

  it('호환 OK → 종합 CHECK 지만 대안 0', () => {
    const r = specCheck(catWith([{ expr: 'b.heightCm >= 10', onFail: 'BELOW_MIN', message: '합성 통과' }]), 'critter-plain', 'gadget', {}, box);
    expect([r.verdict, r.compat.verdict, r.alternatives]).toEqual(['CHECK', 'OK', []]);
    expect(isNoCriteria(r.product)).toBe(true);
  });

  it('호환 BELOW_MIN → 종합 BELOW_MIN · 대안 유지', () => {
    const r = specCheck(catWith([{ expr: 'false', onFail: 'BELOW_MIN', message: '합성 실패' }]), 'critter-plain', 'gadget', {}, box);
    expect([r.verdict, r.compat.verdict]).toEqual(['BELOW_MIN', 'BELOW_MIN']);
    expect(r.alternatives).toEqual([{ supplyItemId: 'disc', name: '원반' }]);
  });

  it('호환 CHECK(해석 불가 식) → 종합 CHECK · 대안 유지', () => {
    const r = specCheck(catWith([{ expr: 'a.x +', onFail: 'BELOW_MIN', message: '깨진 식' }]), 'critter-plain', 'gadget', {}, box);
    expect([r.verdict, r.compat.verdict]).toEqual(['CHECK', 'CHECK']);
    expect(r.alternatives).toEqual([{ supplyItemId: 'disc', name: '원반' }]);
  });
});

describe('노출 — 드워프 미리보기(메모리)에서 water 상품을 ACTIVE·meetsMinSpec true 로 강제해도 추천 영역 0(불변식 ③)', () => {
  it('cp-dw-016·017 강제 승격 → isProductExposable false, 같은 미리보기의 cp-dw-012(hideout)는 노출(대조군)', () => {
    const s = dwarfPreview();
    const cat = createCatalog(s);
    const forced = s.curatedProducts
      .filter((p) => p.id === 'cp-dw-016' || p.id === 'cp-dw-017')
      .map((p) => ({ ...p, status: 'ACTIVE' as const, meetsMinSpec: true }));
    expect(forced.map((p) => [p.id, p.reviewStatus])).toEqual([['cp-dw-016', 'VERIFIED'], ['cp-dw-017', 'VERIFIED']]);
    for (const p of forced) expect([p.id, isProductExposable(cat, 'hamster-dwarf', p, DWARF_PREVIEW_AS_OF)]).toEqual([p.id, false]);
    expect(orderExposableProducts(cat, 'hamster-dwarf', forced, DWARF_PREVIEW_AS_OF)).toEqual([]);
    const control = s.curatedProducts.find((p) => p.id === 'cp-dw-012')!;
    expect(isProductExposable(cat, 'hamster-dwarf', control, DWARF_PREVIEW_AS_OF)).toBe(true);
  });

  it('디스크 시드: cp-dw-016·017 meetsMinSpec false(재계산과 일치), 서명 미리보기에서도 status REVIEW', () => {
    const disk = realSeed().curatedProducts.filter((p) => p.id === 'cp-dw-016' || p.id === 'cp-dw-017');
    expect(disk.map((p) => [p.id, p.meetsMinSpec])).toEqual([['cp-dw-016', false], ['cp-dw-017', false]]);
    const prev = dwarfPreview().curatedProducts.filter((p) => p.id === 'cp-dw-016' || p.id === 'cp-dw-017');
    expect(prev.map((p) => [p.id, p.status])).toEqual([['cp-dw-016', 'REVIEW'], ['cp-dw-017', 'REVIEW']]);
  });
});
