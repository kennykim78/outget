// 보안 79 M-3: 인치 표기 상품의 specValues 는 1inch = 2.54cm 환산 후 0.1cm 내림(반올림 금지 — 경계값이 기준을 넘어 보이지 않게).
//   출처 인치값 = 드워프햄스터-검수-패킷-v0.2 7장 원문 인용(:450-:507) · 핵심행-확인표 B. 사실값을 새로 만들지 않는다(환산 규칙만).
//   note "인치 환산" 상품은 전부 아래 표에 있어야 한다(새 인치 상품은 표에 출처 인치값을 먼저 적는다).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProfileMinSpec, createCatalog } from '../engine/index.js';
import { readSeedDir } from '../seed/read.js';

const here = dirname(fileURLToPath(import.meta.url));
const seed = readSeedDir(join(here, '..', '..', 'seed'));
const draft = readSeedDir(join(here, '..', '..', '..', 'docs', 'planning-artifacts', 'seed-draft'));

/** 0.1 인치 단위 인치값 → 0.1cm 내림(정수 연산 — 부동소수 오차 없음): floor(tenthsInch × 254 / 100) / 10. */
function inchToCmFloor(inch: number): number {
  const tenths = Math.round(inch * 10);
  if (Math.abs(tenths - inch * 10) > 1e-9) throw new RangeError(`0.1인치 단위가 아니다: ${inch}`);
  return Math.floor((tenths * 254) / 100) / 10;
}

/** 상품 id → 필드 → 출처 인치값(원문). */
const SOURCE_INCH: Record<string, Record<string, number>> = {
  'cp-dw-001': { floorWcm: 39.4, floorDcm: 19.7, heightCm: 19.7 }, // "M：Inner Size:39.4-inch L x 19.7-inch W x 19.7-inch H"
  'cp-dw-002': { floorWcm: 47.2, floorDcm: 19.7, heightCm: 23.6 }, // "L：Inner Size:47.2-inch L x 19.7-inch W x 23.6-inch H"
  'cp-dw-006': { diameterCm: 10.2 }, // Wooden Wheel M 10.2"
  'cp-dw-007': { diameterCm: 11.6 }, // Wooden Wheel L 11.6"
  'cp-dw-008': { diameterCm: 10 }, // Clouds Series M 10"
  'cp-dw-015': { shortSideCm: 8.6 }, // "12.2-inch L x 8.6-inch W" — 짧은 변
};

describe('M-3 인치 환산 0.1cm 내림', () => {
  it('inchToCmFloor: 내림(반올림 아님)', () => {
    expect(inchToCmFloor(39.4)).toBe(100); // 100.076 → 100.0 (반올림이면 100.1)
    expect(inchToCmFloor(19.7)).toBe(50); // 50.038
    expect(inchToCmFloor(47.2)).toBe(119.8); // 119.888 (반올림이면 119.9)
    expect(inchToCmFloor(23.6)).toBe(59.9); // 59.944
    expect(inchToCmFloor(11.6)).toBe(29.4); // 29.464 (반올림이면 29.5)
    expect(inchToCmFloor(10)).toBe(25.4);
    expect(inchToCmFloor(8.6)).toBe(21.8); // 21.844
    expect(() => inchToCmFloor(10.25)).toThrow(RangeError);
  });

  for (const [label, s] of [['server/seed', seed], ['seed-draft', draft]] as const) {
    it(`${label}: 인치 상품 specValues = 내림 환산값, note "인치 환산" 상품은 전부 표에 있다`, () => {
      const inchProducts = s.curatedProducts.filter((p) => typeof p.note === 'string' && p.note.includes('인치 환산'));
      expect(inchProducts.map((p) => p.id).sort()).toEqual(Object.keys(SOURCE_INCH).sort());
      for (const p of inchProducts) {
        const sv = p.specValues as Record<string, unknown>;
        for (const [field, inch] of Object.entries(SOURCE_INCH[p.id])) {
          expect({ id: p.id, field, v: sv[field] }).toEqual({ id: p.id, field, v: inchToCmFloor(inch) });
        }
      }
    });
  }

  it('내림 후 meetsMinSpec = 엔진 재계산(미달 전환 상품 0 — 2026-10-25 재계산 결과 고정)', () => {
    const cat = createCatalog(seed);
    for (const id of Object.keys(SOURCE_INCH)) {
      const p = seed.curatedProducts.find((x) => x.id === id);
      if (!p) throw new Error(`${id} 없음`);
      for (const cp of p.careProfileIds) {
        const r = checkProfileMinSpec(cat, cp, p.supplyItemId, p.specValues as never);
        expect({ id, meets: r.meets }).toEqual({ id, meets: p.meetsMinSpec });
        expect({ id, verdict: r.verdict }).toEqual({ id, verdict: 'OK' });
      }
    }
  });
});
