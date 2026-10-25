// R7-B B4·B5 — 실제 시드(드워프 착지) 위 엔진 결과 고정. 값은 패킷 v0.2(Kenny 서명)·v0.3(사전 일괄 승인) 그대로이며,
//   이 테스트는 그 값의 엔진 동작을 고정할 뿐 새 사실 주장이 아니다. 엔진 계산은 상태 무관(드워프 AnimalType 은 디스크 PLANNED).
import { describe, expect, it } from 'vitest';
import { checkAnimalMinSpec, createCatalog, requirementCompat, specCheck } from '../engine/index.js';
import type { Reason, SeedBundle } from '../engine/index.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEED_DIR, dwarfSigned, dwarfSignedWith, realSeed } from './fixtures/prerender-seed.js';

const seed: SeedBundle = realSeed();
const cat = createCatalog(seed);
const D = 'hamster-dwarf';
const ruleIds = (rs: Reason[]) => rs.map((r) => r.ruleId);
const dwarfRows = <T extends { id: string }>(rows: T[], prefix: string) => rows.filter((r) => r.id.startsWith(prefix));

describe('B4 드워프 최소 규격(v0.2 결정 1·2 + 오케스트레이터 when type eq WIRE)', () => {
  const base = { floorWcm: 100, floorDcm: 50, heightCm: 50 };
  it('cage WIRE 100×50×50 · 철망 간격 9.5mm → 미달(BELOW_MIN)', () => {
    const r = checkAnimalMinSpec(cat, D, 'cage', { type: 'WIRE', ...base, barGapMm: 9.5 });
    expect([r.meets, r.verdict]).toEqual([false, 'BELOW_MIN']);
  });
  it('cage OTHER 100×50×50 · 간격 없음 → 충족(when 미적용)', () => {
    const r = checkAnimalMinSpec(cat, D, 'cage', { type: 'OTHER', ...base });
    expect([r.meets, r.verdict]).toEqual([true, 'OK']);
  });
  it('cage WIRE · 간격 없음 → 판단 불가(CHECK, 미충족 — fail-closed)', () => {
    const r = checkAnimalMinSpec(cat, D, 'cage', { type: 'WIRE', ...base });
    expect([r.meets, r.verdict]).toEqual([false, 'CHECK']);
  });
  it('cage WIRE · 간격 6mm → 최소 충족, 권장(type not_in WIRE) 미달', () => {
    const r = checkAnimalMinSpec(cat, D, 'cage', { type: 'WIRE', ...base, barGapMm: 6 });
    expect([r.meets, r.verdict]).toEqual([true, 'BELOW_RECOMMENDED']);
  });
  it('cage 바닥 99.9 → 미달', () => {
    expect(checkAnimalMinSpec(cat, D, 'cage', { type: 'OTHER', ...base, floorWcm: 99.9 }).verdict).toBe('BELOW_MIN');
  });
  it('wheel 22 SOLID → 충족·권장 미달(25), 21.9 → 미달, 25 → OK', () => {
    const at = (d: number) => checkAnimalMinSpec(cat, D, 'wheel', { diameterCm: d, surface: 'SOLID', mount: 'STAND' });
    expect([at(22).meets, at(22).verdict]).toEqual([true, 'BELOW_RECOMMENDED']);
    expect(at(21.9).verdict).toBe('BELOW_MIN');
    expect(at(25).verdict).toBe('OK');
  });
  it('sand-bath-box 짧은 변 20 → OK, 18 → 권장 미달(최소 규칙 0)', () => {
    expect(checkAnimalMinSpec(cat, D, 'sand-bath-box', { shortSideCm: 20 }).verdict).toBe('OK');
    const r = checkAnimalMinSpec(cat, D, 'sand-bath-box', { shortSideCm: 18 });
    expect([r.meets, r.verdict]).toEqual([true, 'BELOW_RECOMMENDED']);
  });
});

describe('B4 드워프 호환 규칙(cr-dwarf-*, CHECK)', () => {
  const cage = (h: number) => ({ ownedItems: { cage: { type: 'OTHER', floorWcm: 100, floorDcm: 50, heightCm: h } } });
  it('wheel 31 + 베딩 20 > 높이 50 → CHECK(cr-dwarf-wheel-cage-bedding#0)', () => {
    const r = specCheck(cat, D, 'wheel', { diameterCm: 31, surface: 'SOLID', mount: 'STAND' }, cage(50));
    expect(r.compat.verdict).toBe('CHECK');
    expect(ruleIds(r.compat.reasons)).toContain('cr-dwarf-wheel-cage-bedding#0');
  });
  it('requirementCompat: 최소 기준(지름 22)으로 높이 42 → OK, 41 → CHECK', () => {
    expect(requirementCompat(cat, D, 'wheel', cage(42)).verdict).toBe('OK');
    const low = requirementCompat(cat, D, 'wheel', cage(41));
    expect(low.verdict).toBe('CHECK');
    expect(ruleIds(low.reasons)).toContain('cr-dwarf-wheel-cage-bedding#0');
  });
  it('tubes 내경 4.9 → CHECK(cr-dwarf-tubes-cage#0), 5 → OK', () => {
    expect(ruleIds(specCheck(cat, D, 'tubes', { innerDiameterCm: 4.9 }, cage(50)).compat.reasons)).toContain('cr-dwarf-tubes-cage#0');
    expect(specCheck(cat, D, 'tubes', { innerDiameterCm: 5 }, cage(50)).compat.verdict).toBe('OK');
  });
  it('골든 프로필에는 드워프 범위 규칙이 걸리지 않는다', () => {
    const r = specCheck(cat, 'hamster-golden', 'tubes', { innerDiameterCm: 6 }, { ownedItems: { cage: { type: 'WIRE', floorWcm: 80, floorDcm: 50, heightCm: 40, barGapMm: 9 } } });
    expect(ruleIds(r.compat.reasons).some((x) => x.startsWith('cr-dwarf-'))).toBe(false);
  });
});

describe('B5 상품 17행 — 엔진 재계산 = 시드 meetsMinSpec = v0.3 5장 기대 판정(불변식 3)', () => {
  const EXPECTED: Record<string, 'OK' | 'BELOW_RECOMMENDED'> = Object.fromEntries(
    Array.from({ length: 17 }, (_, i) => [`cp-dw-${String(i + 1).padStart(3, '0')}`, 'OK' as const]),
  );
  EXPECTED['cp-dw-005'] = 'BELOW_RECOMMENDED'; // W5 TRIXIE 23cm < 권장 25
  const rows = dwarfRows(seed.curatedProducts, 'cp-dw-');
  it('17행, 판정·meetsMinSpec 일치', () => {
    expect(rows.map((p) => p.id)).toEqual(Object.keys(EXPECTED));
    for (const p of rows) {
      const r = checkAnimalMinSpec(cat, D, p.supplyItemId, p.specValues);
      expect([p.id, r.meets, r.verdict]).toEqual([p.id, true, EXPECTED[p.id]]);
      expect(p.meetsMinSpec).toBe(r.meets);
    }
  });
  it('이미지·사용권·가격·자유 문구 0(불변식 1·3·4)', () => {
    for (const p of rows) {
      expect(p.imageAsset).toBeNull();
      expect(p.imageLicense).toBe('NONE');
      expect(p.curationReasons).toEqual([]);
      expect(Object.keys(p).filter((k) => /price|link|href|seller|rating|url/i.test(k))).toEqual([]);
    }
  });
});

describe('R7-B 검수 메타 — 디스크는 Kenny 확인표 수령 전 VERIFIED 0(보안 79 H-1 환원), 서명은 매니페스트로만(불변식 7)', () => {
  type Meta = { id: string; reviewStatus: string; reviewerType: string; verifiedBy: string | null; verifiedAt: string | null; reviewBasis?: string | null };
  const metaOf = (s: SeedBundle): Meta[] =>
    [
      ...s.animalTypes, ...s.taxa, ...s.careProfiles, ...s.supplyItems, ...s.supplyRequirements,
      ...s.compatibilityRules, ...s.setupBundles, ...s.curatedProducts,
    ] as unknown as Meta[];
  const all = metaOf(seed);
  it('디스크: AI_DRAFT ∧ VERIFIED 0건, VERIFIED 0건, reviewBasis 전부 null, 상품 specVerifiedBy/At 전부 null, 매니페스트 []', () => {
    expect(all.filter((r) => r.reviewStatus === 'VERIFIED' && r.reviewerType === 'AI_DRAFT').map((r) => r.id)).toEqual([]);
    expect(all.filter((r) => r.reviewStatus === 'VERIFIED').map((r) => r.id)).toEqual([]);
    expect(all.filter((r) => r.reviewBasis !== null).map((r) => r.id)).toEqual([]);
    expect(seed.curatedProducts.filter((p) => p.specVerifiedBy !== null || p.specVerifiedAt !== null).map((p) => p.id)).toEqual([]);
    expect(seed.curatedProducts.filter((p) => p.status === 'ACTIVE').map((p) => p.id)).toEqual([]);
    expect(JSON.parse(readFileSync(join(SEED_DIR, 'review-signatures.json'), 'utf8'))).toEqual([]);
  });
  it('메모리 서명(가짜 확인표 전 ☑·C): 패킷 50행만 VERIFIED·EXPERIENCED_KEEPER·kenny·2026-10-24, 상품·최소 규격 행 ROW_CHECKED 20 / 나머지 AI_RESEARCH_BULK 30', () => {
    const { seed: signed, manifest } = dwarfSignedWith();
    const v = metaOf(signed).filter((x) => x.reviewStatus === 'VERIFIED');
    expect(v).toHaveLength(50);
    for (const r of v) expect([r.id, r.reviewerType, r.verifiedBy, r.verifiedAt]).toEqual([r.id, 'EXPERIENCED_KEEPER', 'kenny', '2026-10-24']);
    expect(v.filter((r) => r.reviewBasis === 'ROW_CHECKED').map((r) => r.id).sort()).toEqual(
      ['req-dwarf-bedding', 'req-dwarf-cage', 'req-dwarf-wheel', ...signed.curatedProducts.filter((p) => p.id.startsWith('cp-dw-')).map((p) => p.id)].sort(),
    );
    expect(v.filter((r) => r.reviewBasis === 'AI_RESEARCH_BULK')).toHaveLength(30);
    expect(manifest).toHaveLength(50);
  });
  it('DRAFT 유지 행(패킷 밖): 사료(FOOD)·저울(HEALTH)·Taxon 2·cr-wheel-cage·cr-water-cage — 서명해도 DRAFT', () => {
    const byId = new Map(metaOf(dwarfSigned()).map((r) => [r.id, r]));
    for (const id of ['req-dwarf-food', 'req-dwarf-scale', 'phodopus-sungorus', 'phodopus-campbelli', 'cr-wheel-cage', 'cr-water-cage', 'food', 'scale']) {
      expect([id, byId.get(id)?.reviewStatus, byId.get(id)?.reviewerType]).toEqual([id, 'DRAFT', 'AI_DRAFT']);
    }
  });
  it('드워프 AnimalType 은 서명돼도 PLANNED(게이트 G 전), 디스크는 DRAFT', () => {
    const at = dwarfSigned().animalTypes.find((x) => x.id === D);
    expect([at?.status, at?.reviewStatus]).toEqual(['PLANNED', 'VERIFIED']);
    expect(seed.animalTypes.find((x) => x.id === D)?.reviewStatus).toBe('DRAFT');
  });
});
