// R7-B B4·B5 — 실제 시드(드워프 착지) 위 엔진 결과 고정. 값은 패킷 v0.2(Kenny 서명)·v0.3(사전 일괄 승인) 그대로이며,
//   이 테스트는 그 값의 엔진 동작을 고정할 뿐 새 사실 주장이 아니다. 엔진 계산은 상태 무관(드워프 AnimalType 은 디스크 PLANNED).
import { describe, expect, it } from 'vitest';
import { checkAnimalMinSpec, createCatalog, requirementCompat, specCheck } from '../engine/index.js';
import type { Reason, SeedBundle } from '../engine/index.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REAL_SIGNED_AT, SEED_DIR, dwarfSigned, dwarfSignedWith, realSeed, realSignedTargets } from './fixtures/prerender-seed.js';
import { CONTENT_KEYS, SEED_FILES } from '../seed/common.js';

const seed: SeedBundle = realSeed();
const cat = createCatalog(seed);
const D = 'hamster-dwarf';
const ruleIds = (rs: Reason[]) => rs.map((r) => r.ruleId);
const dwarfRows = <T extends { id: string }>(rows: T[], prefix: string) => rows.filter((r) => r.id.startsWith(prefix));

describe('B4 드워프 최소 규격(v0.2 결정 1·2 + 오케스트레이터 when type eq WIRE)', () => {
  const base = { floorWcm: 100, floorDcm: 50, heightCm: 50 };
  // 2026-10-25: 6mm 는 단일 출처(Vet Times) → 권장으로 강등, 최소는 Blue Cross '1cm 미만' + Vet Times 2출처 → lte 9 when WIRE(골든과 같음).
  it('cage WIRE 100×50×50 · 철망 간격 9.5mm → 미달(BELOW_MIN, 최소 9mm 이하)', () => {
    const r = checkAnimalMinSpec(cat, D, 'cage', { type: 'WIRE', ...base, barGapMm: 9.5 });
    expect([r.meets, r.verdict]).toEqual([false, 'BELOW_MIN']);
  });
  it('cage WIRE · 간격 9mm → 최소 충족·권장(6mm 이하) 미달(BELOW_RECOMMENDED)', () => {
    const r = checkAnimalMinSpec(cat, D, 'cage', { type: 'WIRE', ...base, barGapMm: 9 });
    expect([r.meets, r.verdict]).toEqual([true, 'BELOW_RECOMMENDED']);
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
  it('245(Kenny ORDERS §22-6): tubes 안지름 5cm 는 최소 규격 — 4.9 → BELOW_MIN(추천 영역 제외), 5 → OK, 미입력 → CHECK', () => {
    const req = seed.supplyRequirements.find((r) => r.id === 'req-dwarf-tubes')!;
    expect([req.minSpec.rules.map((x) => [x.key, x.op, x.value]), req.recommendedSpec.rules]).toEqual([[['innerDiameterCm', 'gte', 5]], []]);
    expect(checkAnimalMinSpec(cat, D, 'tubes', { innerDiameterCm: 4.9 })).toMatchObject({ meets: false, verdict: 'BELOW_MIN' });
    expect(checkAnimalMinSpec(cat, D, 'tubes', { innerDiameterCm: 5 })).toMatchObject({ meets: true, verdict: 'OK' });
    expect(checkAnimalMinSpec(cat, D, 'tubes', {})).toMatchObject({ meets: false, verdict: 'CHECK' });
  });
  it('골든 프로필에는 드워프 범위 규칙이 걸리지 않는다', () => {
    const r = specCheck(cat, 'hamster-golden', 'tubes', { innerDiameterCm: 6 }, { ownedItems: { cage: { type: 'WIRE', floorWcm: 80, floorDcm: 50, heightCm: 40, barGapMm: 9 } } });
    expect(ruleIds(r.compat.reasons).some((x) => x.startsWith('cr-dwarf-'))).toBe(false);
  });
});

describe('B5 상품 17행 — 엔진 재계산 = 시드 meetsMinSpec = v0.3 5장 기대 판정(불변식 3)', () => {
  const EXPECTED: Record<string, 'OK' | 'BELOW_RECOMMENDED' | 'CHECK'> = Object.fromEntries(
    Array.from({ length: 17 }, (_, i) => [`cp-dw-${String(i + 1).padStart(3, '0')}`, 'OK' as const]),
  );
  EXPECTED['cp-dw-005'] = 'BELOW_RECOMMENDED'; // W5 TRIXIE 23cm < 권장 25
  EXPECTED['cp-dw-009'] = 'CHECK'; // carefresh: 무향 근거 소멸(scented 제거) → meetsMinSpec=false, 추천 영역 제외
  EXPECTED['cp-dw-016'] = 'CHECK'; // 무규격 → meetsMinSpec=false, 추천 영역 제외
  EXPECTED['cp-dw-017'] = 'CHECK'; // 무규격 → meetsMinSpec=false, 추천 영역 제외
  const rows = dwarfRows(seed.curatedProducts, 'cp-dw-');
  it('17행, 판정·meetsMinSpec 일치', () => {
    expect(rows.map((p) => p.id)).toEqual(Object.keys(EXPECTED));
    for (const p of rows) {
      const r = checkAnimalMinSpec(cat, D, p.supplyItemId, p.specValues);
      expect([p.id, r.meets, r.verdict]).toEqual([p.id, !['cp-dw-009', 'cp-dw-016', 'cp-dw-017'].includes(p.id), EXPECTED[p.id]]);
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

describe('R7-B 검수 메타 — 디스크는 2026-11-16 Kenny 확인표 5종 서명(4 패킷 107행)만 VERIFIED, 서명은 매니페스트로만(불변식 7)', () => {
  type Meta = { id: string; reviewStatus: string; reviewerType: string; verifiedBy: string | null; verifiedAt: string | null; reviewBasis?: string | null };
  const metaOf = (s: SeedBundle): Meta[] =>
    [
      ...s.animalTypes, ...s.taxa, ...s.careProfiles, ...s.supplyItems, ...s.supplyRequirements,
      ...s.compatibilityRules, ...s.setupBundles, ...s.curatedProducts,
    ] as unknown as Meta[];
  const all = metaOf(seed);
  it('디스크: AI_DRAFT ∧ VERIFIED 0건, VERIFIED = 4 패킷 대상 107행 정확히(kenny·2026-11-16·패킷 basis/reviewerType), 나머지 DRAFT·AI_DRAFT·basis null, 드워프 상품 17 specVerified·ACTIVE 14(미달 3 REVIEW), 매니페스트 107', () => {
    const keyed = (s: SeedBundle) => CONTENT_KEYS.flatMap((k) => ((s as unknown as Record<string, Meta[]>)[k]).map((r) => ({ key: `${SEED_FILES[k]}#${r.id}`, r })));
    const targets = realSignedTargets();
    expect(targets.size).toBe(107);
    expect(all.filter((r) => r.reviewStatus === 'VERIFIED' && r.reviewerType === 'AI_DRAFT').map((r) => r.id)).toEqual([]);
    const rows = keyed(seed);
    expect(rows.filter((x) => x.r.reviewStatus === 'VERIFIED').map((x) => x.key).sort()).toEqual([...targets.keys()].sort());
    for (const { key, r } of rows) {
      const t = targets.get(key);
      if (t) expect([key, r.reviewStatus, r.reviewerType, r.verifiedBy, r.verifiedAt, r.reviewBasis]).toEqual([key, 'VERIFIED', t.reviewerType, 'kenny', REAL_SIGNED_AT, t.basis]);
      else expect([key, r.reviewStatus, r.reviewerType, r.verifiedBy, r.verifiedAt, r.reviewBasis]).toEqual([key, 'DRAFT', 'AI_DRAFT', null, null, null]);
    }
    const dw = seed.curatedProducts.filter((p) => p.id.startsWith('cp-dw-'));
    expect(dw).toHaveLength(17);
    expect(seed.curatedProducts.filter((p) => p.specVerifiedBy !== null || p.specVerifiedAt !== null).map((p) => p.id)).toEqual(dw.map((p) => p.id));
    for (const p of dw) expect([p.id, p.specVerifiedBy, p.specVerifiedAt]).toEqual([p.id, 'kenny', REAL_SIGNED_AT]);
    expect(seed.curatedProducts.filter((p) => p.status === 'ACTIVE').map((p) => p.id)).toEqual(dw.filter((p) => p.meetsMinSpec === true).map((p) => p.id));
    expect(dw.filter((p) => p.status === 'REVIEW').map((p) => p.id)).toEqual(['cp-dw-009', 'cp-dw-016', 'cp-dw-017']);
    expect(dw.filter((p) => p.status === 'ACTIVE')).toHaveLength(14);
    const manifest = JSON.parse(readFileSync(join(SEED_DIR, 'review-signatures.json'), 'utf8')) as Array<{ file: string; id: string; signedBy: string; signedAt: string; basis: string }>;
    expect(manifest).toHaveLength(107);
    expect(manifest.map((e) => `${e.file}#${e.id}`).sort()).toEqual([...targets.keys()].sort());
    for (const e of manifest) expect([e.id, e.signedBy, e.signedAt, e.basis]).toEqual([e.id, 'kenny', REAL_SIGNED_AT, targets.get(`${e.file}#${e.id}`)?.basis]);
  });
  it('메모리 서명(가짜 확인표 전 ☑·C·D1, K1 사본): 패킷 52행만 VERIFIED·kenny·2026-10-24 — 사료만 VET_PUBLISHED_SOURCE, 나머지 EXPERIENCED_KEEPER, 상품·최소 규격·사료·재서술 whyShort ROW_CHECKED 26 / 나머지 AI_RESEARCH_BULK 26(BE92: SupplyItem food 추가, 245: req-dwarf-tubes 최소 규격 → A11, K1 2026-11-15: 받침 쳇바퀴(NOT_NOW)·은신처·모래 목욕 2행 행별 확인)', () => {
    const { seed: signed, manifest } = dwarfSignedWith();
    const v = metaOf(signed).filter((x) => x.reviewStatus === 'VERIFIED');
    expect(v).toHaveLength(52);
    for (const r of v) {
      const type = r.id === 'req-dwarf-food' ? 'VET_PUBLISHED_SOURCE' : 'EXPERIENCED_KEEPER';
      expect([r.id, r.reviewerType, r.verifiedBy, r.verifiedAt]).toEqual([r.id, type, 'kenny', '2026-10-24']);
    }
    expect(v.filter((r) => r.reviewBasis === 'ROW_CHECKED').map((r) => r.id).sort()).toEqual(
      ['req-dwarf-bedding', 'req-dwarf-cage', 'req-dwarf-food', 'req-dwarf-hideout', 'req-dwarf-sand-bath', 'req-dwarf-sand-bath-box', 'req-dwarf-saucer', 'req-dwarf-tubes', 'req-dwarf-wheel', ...signed.curatedProducts.filter((p) => p.id.startsWith('cp-dw-')).map((p) => p.id)].sort(),
    );
    expect(v.filter((r) => r.reviewBasis === 'AI_RESEARCH_BULK')).toHaveLength(26);
    expect(manifest).toHaveLength(52);
  });
  // BE92: SupplyItem food 는 C 일괄로 이동(오케스트레이터 90 Q1), 공용 cr-wheel-cage·cr-water-cage 는 삭제(85 근거 없음).
  it('DRAFT 유지 행(패킷 밖): 저울(HEALTH)·SupplyItem scale·Taxon 2·골든 cr-syrian-wheel-cage-bedding — 서명해도 DRAFT', () => {
    const byId = new Map(metaOf(dwarfSigned()).map((r) => [r.id, r]));
    expect(byId.get('food')?.reviewStatus).toBe('VERIFIED');
    for (const id of ['req-dwarf-scale', 'phodopus-sungorus', 'phodopus-campbelli', 'cr-syrian-wheel-cage-bedding', 'scale']) {
      expect([id, byId.get(id)?.reviewStatus, byId.get(id)?.reviewerType]).toEqual([id, 'DRAFT', 'AI_DRAFT']);
    }
  });
  it('드워프 AnimalType 은 서명돼도 PLANNED(게이트 G 전) — 메모리 서명·디스크(2026-11-16 서명) 둘 다 VERIFIED·PLANNED', () => {
    const at = dwarfSigned().animalTypes.find((x) => x.id === D);
    expect([at?.status, at?.reviewStatus]).toEqual(['PLANNED', 'VERIFIED']);
    const disk = seed.animalTypes.find((x) => x.id === D);
    expect([disk?.status, disk?.reviewStatus, disk?.reviewerType, disk?.verifiedAt]).toEqual(['PLANNED', 'VERIFIED', 'EXPERIENCED_KEEPER', REAL_SIGNED_AT]);
  });
});
