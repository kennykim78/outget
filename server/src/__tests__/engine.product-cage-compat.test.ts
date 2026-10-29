// 작업 185(QA184 MEDIUM-1): L7 전용 productCageCompat = 상품 실제 규격값 × 보유품, specCheck 호환 단계(CHECK 모드)와 같은 평가
//   + 보유품 근거 단계(③). 실시드 값은 엔진 동작 고정용일 뿐 새 사실 주장이 아니다(CR 전부 DRAFT, 계산은 상태 무관).
//   변이 표적: P1(보유품 근거 단계 제거 → tubes OK) P2(비운 결과 UNKNOWN 이면 미판정으로 반전 → wheel NONE)
//             P3(판정 항목 0 규칙도 checked → tubes OK) P4(CHECK 모드 UNKNOWN 제외 → 지름 미입력 NONE)
//             P5(187: 보유품 무관 실패도 미판정 → tubes d4 NONE·LOW-2 혼합 규칙 OK).
import { describe, expect, it } from 'vitest';
import { createCatalog, createEngine, EngineLookupError, productCageCompat, specCheck } from '../engine/index.js';
import type { CompatibilityRuleRec, SeedBundle, UserContext } from '../engine/index.js';
import { META, makeBundle } from './fixtures/engine-catalog.js';
import { realSeed } from './fixtures/prerender-seed.js';

const NONE = { verdict: 'NONE', reasons: [], checkedRuleIds: [] };
const seed: SeedBundle = realSeed();
const cat = createCatalog(seed);
const cage = (v: Record<string, number | string>): UserContext => ({ ownedItems: { cage: v } });
const CAGE_60_40 = (heightCm: number) => cage({ type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm });

describe('productCageCompat — 실시드', () => {
  it('드워프 tubes 안지름 6 + 케이지 h40 → NONE(규칙이 케이지를 참조하지 않음, P1·P3)', () => {
    expect(productCageCompat(cat, 'hamster-dwarf', 'tubes', { innerDiameterCm: 6 }, CAGE_60_40(40))).toEqual(NONE);
  });
  it('드워프 tubes 안지름 6 + 케이지 {} → NONE', () => {
    expect(productCageCompat(cat, 'hamster-dwarf', 'tubes', { innerDiameterCm: 6 }, cage({}))).toEqual(NONE);
  });
  it('드워프 tubes 안지름 4(규칙 false) + 케이지 h40 → CHECK(보유품 무관 실패는 판정 유지, 187 — HEAD specCheck.compat 와 같음)', () => {
    const c = productCageCompat(cat, 'hamster-dwarf', 'tubes', { innerDiameterCm: 4 }, CAGE_60_40(40));
    expect([c.verdict, c.checkedRuleIds, c.reasons.map((r) => [r.ruleId, r.verdict])]).toEqual([
      'CHECK',
      ['cr-dwarf-tubes-cage'],
      [['cr-dwarf-tubes-cage#0', 'CHECK']],
    ]);
    expect(c).toEqual(specCheck(cat, 'hamster-dwarf', 'tubes', { innerDiameterCm: 4 }, CAGE_60_40(40)).compat);
    expect(productCageCompat(cat, 'hamster-dwarf', 'tubes', { innerDiameterCm: 4 }, cage({})).verdict).toBe('CHECK');
  });
  it('드워프 tubes 경계: 안지름 5 → NONE(통과는 케이지 근거 없음), 4.9 → CHECK', () => {
    expect(productCageCompat(cat, 'hamster-dwarf', 'tubes', { innerDiameterCm: 5 }, CAGE_60_40(40))).toEqual(NONE);
    expect(productCageCompat(cat, 'hamster-dwarf', 'tubes', { innerDiameterCm: 4.9 }, CAGE_60_40(40)).verdict).toBe('CHECK');
  });
  it('LOW-2 혼합 규칙(실시드 복제): wheel d20 × h80 → BELOW_MIN(보유품 무관 BELOW_MIN 이 빠져 OK 가 되면 안 됨)', () => {
    const s = structuredClone(realSeed());
    const r = s.compatibilityRules.find((x) => x.id === 'cr-syrian-wheel-cage-bedding')!;
    r.rules = [
      { expr: 'a.diameterCm >= 28', onFail: 'BELOW_MIN', message: '지름 확인.' },
      { expr: 'a.diameterCm + 25 <= b.heightCm', onFail: 'CHECK', message: '높이 확인.' },
    ];
    const mixed = createCatalog(s);
    const W20 = { diameterCm: 20, surface: 'SOLID', mount: 'STAND' };
    const c = productCageCompat(mixed, 'hamster-golden', 'wheel', W20, CAGE_60_40(80));
    expect([c.verdict, c.reasons.map((x) => [x.ruleId, x.verdict])]).toEqual([
      'BELOW_MIN',
      [['cr-syrian-wheel-cage-bedding#0', 'BELOW_MIN']],
    ]);
    expect(c.verdict).toBe(specCheck(mixed, 'hamster-golden', 'wheel', W20, CAGE_60_40(80)).compat.verdict);
    // 통과하는 보유품 무관 항목만 빠짐: d30 × h80 → OK(#1 판정), d30 × h50 → CHECK(#1 만).
    const W30m = { ...W20, diameterCm: 30 };
    expect(productCageCompat(mixed, 'hamster-golden', 'wheel', W30m, CAGE_60_40(80)).verdict).toBe('OK');
    const chk = productCageCompat(mixed, 'hamster-golden', 'wheel', W30m, CAGE_60_40(50));
    expect([chk.verdict, chk.reasons.map((x) => x.ruleId)]).toEqual(['CHECK', ['cr-syrian-wheel-cage-bedding#1']]);
  });
  it('전제: specCheck 호환 단계(L5, 불변)는 같은 입력을 OK 로 본다 — L7 이 이것을 쓰면 근거 없는 호환', () => {
    expect(specCheck(cat, 'hamster-dwarf', 'tubes', { innerDiameterCm: 6 }, CAGE_60_40(40)).compat.verdict).toBe('OK');
  });

  const W30 = { diameterCm: 30, surface: 'SOLID', mount: 'STAND' };
  it('골든 wheel 30cm SOLID STAND + 케이지 h53 → CHECK(30+25 > 53, P2)', () => {
    const c = productCageCompat(cat, 'hamster-golden', 'wheel', W30, CAGE_60_40(53));
    expect([c.verdict, c.checkedRuleIds, c.reasons.map((r) => [r.ruleId, r.verdict])]).toEqual([
      'CHECK',
      ['cr-syrian-wheel-cage-bedding'],
      [['cr-syrian-wheel-cage-bedding#0', 'CHECK']],
    ]);
    expect('usedRecommended' in c).toBe(false);
  });
  it('골든 wheel 30cm + 케이지 h55 → OK(P2)', () => {
    expect(productCageCompat(cat, 'hamster-golden', 'wheel', W30, CAGE_60_40(55))).toEqual({
      verdict: 'OK',
      reasons: [],
      checkedRuleIds: ['cr-syrian-wheel-cage-bedding'],
    });
  });
  it('골든 wheel 지름 미입력 + 케이지 h200 → CHECK(UNKNOWN → CHECK 유지, P4)', () => {
    expect(productCageCompat(cat, 'hamster-golden', 'wheel', { surface: 'SOLID', mount: 'STAND' }, CAGE_60_40(200)).verdict).toBe('CHECK');
  });
  it('보유품 참조 규칙에서 케이지 높이 미입력({}) → UNKNOWN → CHECK 판정 유지(비운 결과 UNKNOWN = 보유품 사용)', () => {
    expect(productCageCompat(cat, 'hamster-golden', 'wheel', W30, cage({})).verdict).toBe('CHECK');
  });
  it('보유품을 참조하는 규칙은 specCheck 호환 단계와 같다(골든 wheel × 높이 20~80, 지름 미입력 포함)', () => {
    for (const input of [W30, { diameterCm: 28 }, { diameterCm: 34 }, {}]) {
      for (let h = 20; h <= 80; h++) {
        const ctx = CAGE_60_40(h);
        expect([h, productCageCompat(cat, 'hamster-golden', 'wheel', input, ctx)]).toEqual([h, specCheck(cat, 'hamster-golden', 'wheel', input, ctx).compat]);
      }
    }
  });
  it('케이지 없음(컨텍스트 없음·케이지 미보유) → NONE, 케이지 자신 → NONE', () => {
    expect(productCageCompat(cat, 'hamster-golden', 'wheel', W30)).toEqual(NONE);
    expect(productCageCompat(cat, 'hamster-golden', 'wheel', W30, { ownedItems: {} })).toEqual(NONE);
    expect(productCageCompat(cat, 'hamster-golden', 'cage', { heightCm: 50 }, CAGE_60_40(50))).toEqual(NONE);
  });
  it('요구사항 없음 → EngineLookupError', () => {
    expect(() => productCageCompat(cat, 'hamster-golden', 'no-such-item', {}, CAGE_60_40(50))).toThrow(EngineLookupError);
  });
  it('createEngine 메서드 = 함수, 결정적', () => {
    const e = createEngine(cat);
    for (const [t, i, v, h] of [
      ['hamster-golden', 'wheel', W30, 53],
      ['hamster-golden', 'wheel', W30, 55],
      ['hamster-dwarf', 'tubes', { innerDiameterCm: 6 }, 40],
    ] as const) {
      const a = e.productCageCompat(t, i, v, CAGE_60_40(h));
      expect(a).toEqual(productCageCompat(cat, t, i, v, CAGE_60_40(h)));
      expect(JSON.stringify(a)).toBe(JSON.stringify(e.productCageCompat(t, i, v, CAGE_60_40(h))));
    }
  });
});

// ---- 합성(값 임의): spinner(a) × box(b) 규칙만 갈아 끼움 ----
function withRules(rules: CompatibilityRuleRec['rules'], reverse = false) {
  const b = makeBundle();
  b.compatibilityRules = [
    reverse ? { ...META, id: 'cx-t', a: 'box', b: 'spinner', rules } : { ...META, id: 'cx-t', a: 'spinner', b: 'box', rules },
  ];
  return createCatalog(b);
}
const box = (heightCm?: number): UserContext => ({ ownedItems: { box: heightCm === undefined ? {} : { heightCm } } });
const S = { sizeCm: 25, face: 'FLAT', mount: 'FLOOR' };

describe('productCageCompat — 합성', () => {
  it('onFail BELOW_MIN 은 그대로(CHECK 상한 없음 — 실제 상품 값)', () => {
    const c = withRules([{ expr: 'a.sizeCm + 5 <= b.heightCm', onFail: 'BELOW_MIN', message: '큼' }]);
    expect(productCageCompat(c, 'critter-plain', 'spinner', S, box(20)).verdict).toBe('BELOW_MIN');
    expect(productCageCompat(c, 'critter-plain', 'spinner', S, box(30)).verdict).toBe('OK');
  });
  it('한 규칙 안에서 보유품 미참조 "통과" 항목만 빠진다(참조 항목은 판정)', () => {
    const c = withRules([
      { expr: 'a.sizeCm >= 10', onFail: 'BELOW_MIN', message: '미참조' },
      { expr: 'a.sizeCm + 5 <= b.heightCm', onFail: 'CHECK', message: '참조' },
    ]);
    const r = productCageCompat(c, 'critter-plain', 'spinner', S, box(20));
    expect([r.verdict, r.reasons.map((x) => x.ruleId)]).toEqual(['CHECK', ['cx-t#1']]);
    expect(productCageCompat(c, 'critter-plain', 'spinner', S, box(30)).verdict).toBe('OK');
  });
  it('보유품 미참조 "실패" 항목은 판정 유지(187, fail-closed): 등급 그대로, 단독 규칙도 checked', () => {
    const c = withRules([
      { expr: 'a.sizeCm >= 99', onFail: 'BELOW_MIN', message: '미참조' },
      { expr: 'a.sizeCm + 5 <= b.heightCm', onFail: 'CHECK', message: '참조' },
    ]);
    const lo = productCageCompat(c, 'critter-plain', 'spinner', S, box(20));
    expect([lo.verdict, lo.reasons.map((x) => [x.ruleId, x.verdict])]).toEqual(['BELOW_MIN', [['cx-t#0', 'BELOW_MIN'], ['cx-t#1', 'CHECK']]]);
    const hi = productCageCompat(c, 'critter-plain', 'spinner', S, box(30));
    expect([hi.verdict, hi.reasons.map((x) => x.ruleId)]).toEqual(['BELOW_MIN', ['cx-t#0']]);
    const solo = withRules([{ expr: 'a.sizeCm >= 99', onFail: 'CHECK', message: '미참조' }]);
    expect(productCageCompat(solo, 'critter-plain', 'spinner', S, box(30))).toEqual({
      verdict: 'CHECK',
      reasons: [{ stage: 'COMPAT', kind: 'RULE', verdict: 'CHECK', ruleId: 'cx-t#0', message: '미참조' }],
      checkedRuleIds: ['cx-t'],
    });
  });
  it('삼항식: 선택된 분기가 보유품을 참조하지 않으면 미판정, 참조하면 판정', () => {
    const c = withRules([{ expr: "a.face == 'FLAT' ? a.sizeCm >= 20 : a.sizeCm + 5 <= b.heightCm", onFail: 'CHECK', message: 'm' }]);
    expect(productCageCompat(c, 'critter-plain', 'spinner', S, box(10))).toEqual(NONE);
    expect(productCageCompat(c, 'critter-plain', 'spinner', { ...S, face: 'GRID' }, box(10)).verdict).toBe('CHECK');
  });
  it('역방향(a=보유품, b=상품)도 같은 규칙', () => {
    const ref = withRules([{ expr: 'b.sizeCm + 5 <= a.heightCm', onFail: 'CHECK', message: 'm' }], true);
    expect(productCageCompat(ref, 'critter-plain', 'spinner', S, box(20)).verdict).toBe('CHECK');
    expect(productCageCompat(ref, 'critter-plain', 'spinner', S, box(30)).verdict).toBe('OK');
    const noRef = withRules([{ expr: 'b.sizeCm >= 5', onFail: 'CHECK', message: 'm' }], true);
    expect(productCageCompat(noRef, 'critter-plain', 'spinner', S, box(30))).toEqual(NONE);
  });
  it('항목 0 규칙 → NONE(specCheck 는 OK — 근거 없는 OK 방지, P3)', () => {
    const c = withRules([]);
    expect(productCageCompat(c, 'critter-plain', 'spinner', S, box(30))).toEqual(NONE);
    expect(specCheck(c, 'critter-plain', 'spinner', S, box(30)).compat.verdict).toBe('OK');
  });
});
