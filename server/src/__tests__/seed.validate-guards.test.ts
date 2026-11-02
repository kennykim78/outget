// R7-B 후속 방어 규칙(76): X01(QA 72 G-2 · K-B4) · V08(G-3) · X02(보안 71 M-1) · R01 taxonId(L-1).
//   실시드는 디스크 그대로 읽고, 위반은 메모리 사본에만 주입한다(디스크 시드 사실 불변).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalog, listResolvedRequirements, type SeedBundle } from '../engine/index.js';
import { SEED_FILES, asSeedBundle, type RawSeed, type Rec, type SeedKey } from '../seed/common.js';
import { readSeedDirRaw } from '../seed/read.js';
import { isDomesticDomain } from '../seed/validate-review.js';
import {
  REQUIRED_ITEMS_BY_PROFILE,
  TRIVIAL_LEGAL_SPECIES,
  TRIVIAL_LEGAL_TAXON_ID,
  genusOf,
  isLegalNotGating,
  isLegalTrivial,
  isTaxonLegallyTrivial,
  speciesOf,
} from '../seed/validate-gates.js';
import { validateSeed, type ValidateResult } from '../seed/validate.js';
import { DWARF_PREVIEW_AS_OF, FIXTURE_AS_OF, SECOND, dwarfPreview, promoted, promotedTwo } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = '2026-11-03';
const BASE = readSeedDirRaw(SEED_DIR).raw;
const fresh = (): Required<RawSeed> => structuredClone(BASE) as Required<RawSeed>;
const rawOf = (seed: SeedBundle): Required<RawSeed> =>
  Object.fromEntries(Object.keys(SEED_FILES).map((k) => [k, seed[k as keyof SeedBundle] as unknown[]])) as Required<RawSeed>;

function row(s: RawSeed, key: SeedKey, id: string): Rec {
  const r = (s[key] ?? []).find((x) => (x as Rec).id === id);
  if (!r) throw new Error(`fixture: ${key}#${id} 없음`);
  return r as Rec;
}
const verify = (r: Rec, reviewerType: string): void => {
  Object.assign(r, { reviewStatus: 'VERIFIED', reviewerType, verifiedBy: 'reviewer-handle', verifiedAt: '2026-09-30', reviewBasis: 'ROW_CHECKED' });
};
const errs = (res: ValidateResult, rule: string) => res.errors.filter((i) => i.rule === rule);
/** 드워프 미리보기에서 사료 행만 D1 미☑ 상태(DRAFT·AI_DRAFT)로 — BE92 이후 미리보기(전 ☑·C)는 SupplyItem food 도 C 일괄로 서명돼 X01 0. */
const dwarfPreviewFoodDraft = (): Required<RawSeed> => {
  const s = rawOf(dwarfPreview());
  Object.assign(row(s, 'supplyRequirements', 'req-dwarf-food'), { reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, reviewBasis: null });
  return s;
};

describe('실시드 — 새 규칙 오탐 0', () => {
  it('server/seed: X01·X02·V08·R01 ERROR 0 (골든 ACTIVE 비노출, 드워프 PLANNED)', () => {
    const res = validateSeed(fresh(), { now: NOW });
    expect(res.errors).toEqual([]);
    for (const rule of ['X01', 'X02', 'V08', 'R01']) expect(errs(res, rule)).toEqual([]);
  });
});

describe('X01 — 노출 타입의 REQUIRED 요구사항 비노출 금지(G-2, K-B4)', () => {
  it('드워프 ACTIVE(미리보기 전 ☑·C·D1) → X01 0 — BE92: SupplyItem food 가 C 일괄(31행)에 들어가 사료 체인 완성', () => {
    const res = validateSeed(rawOf(dwarfPreview()), { now: DWARF_PREVIEW_AS_OF });
    expect(errs(res, 'X01')).toEqual([]);
    expect(errs(res, 'X02')).toEqual([]);
  });

  it('드워프 ACTIVE + 사료 D1 미☑(DRAFT) → X01 은 사료(req-dwarf-food, FOOD DRAFT) 1건만', () => {
    const res = validateSeed(dwarfPreviewFoodDraft(), { now: DWARF_PREVIEW_AS_OF });
    const x = errs(res, 'X01');
    expect(x.map((i) => `${i.id} ${i.path}`)).toEqual(['hamster-dwarf requirements.food']);
    expect(x[0].message).toContain('req-dwarf-food');
    // 드워프 Taxon 은 6종·CITES false·화이트리스트 null → X02 오탐 없음.
    expect(errs(res, 'X02')).toEqual([]);
  });

  it('M-1: careOverrides 로 DRAFT food 를 RECOMMENDED 로 낮춰도 X01(비검수 행 priority 는 보지 않음 — 우회 차단)', () => {
    const s = dwarfPreviewFoodDraft();
    row(s, 'animalTypes', 'hamster-dwarf').careOverrides = { requirements: { food: { priority: 'RECOMMENDED' } } };
    const x = errs(validateSeed(s, { now: DWARF_PREVIEW_AS_OF }), 'X01');
    expect(x.map((i) => `${i.id} ${i.path}`)).toEqual(['hamster-dwarf requirements.food']);
  });

  it('M-1: DRAFT 행 자체의 priority 를 NOT_NOW 로 낮춰도 X01', () => {
    const s = dwarfPreviewFoodDraft();
    row(s, 'supplyRequirements', 'req-dwarf-food').priority = 'NOT_NOW';
    const x = errs(validateSeed(s, { now: DWARF_PREVIEW_AS_OF }), 'X01');
    expect(x.map((i) => `${i.id} ${i.path}`)).toEqual(['hamster-dwarf requirements.food']);
  });

  it('M-1: 필수 항목 요구사항 행 삭제 → X01(행 없음)', () => {
    const s = rawOf(promoted({ publishable: true }));
    s.supplyRequirements = (s.supplyRequirements as Rec[]).filter((r) => r.id !== 'req-syrian-hideout');
    // 참조 정리(R08 번들 itemIds·R09 상품) — 참조 오류 없이 행만 깔끔히 지운 경우에도 X01 이 잡는지 본다.
    for (const b of s.setupBundles as Rec[]) {
      if (b.careProfileId === 'cp-hamster-syrian') b.itemIds = (b.itemIds as string[]).filter((i) => i !== 'hideout');
    }
    s.curatedProducts = (s.curatedProducts as Rec[]).filter((p) => p.supplyItemId !== 'hideout');
    const res = validateSeed(s, { now: FIXTURE_AS_OF });
    expect(res.errors.filter((i) => i.rule !== 'X01')).toEqual([]);
    const x = errs(res, 'X01');
    expect(x.map((i) => i.path)).toEqual(['requirements.hideout']);
    expect(x[0].message).toContain('행이 없다');
  });

  it('M-1: VERIFIED 필수 항목이라도 priority 가 REQUIRED 미만이면 X01(행 하향·타입 override 하향 모두)', () => {
    const a = rawOf(promoted({ publishable: true }));
    row(a, 'supplyRequirements', 'req-syrian-water').priority = 'RECOMMENDED';
    const xa = errs(validateSeed(a, { now: FIXTURE_AS_OF }), 'X01');
    expect(xa.map((i) => i.path)).toEqual(['requirements.water']);
    expect(xa[0].message).toContain('RECOMMENDED');
    const b = rawOf(promoted({ publishable: true }));
    row(b, 'animalTypes', 'hamster-golden').careOverrides = { requirements: { bedding: { priority: 'OPTIONAL' } } };
    expect(errs(validateSeed(b, { now: FIXTURE_AS_OF }), 'X01').map((i) => i.path)).toEqual(['requirements.bedding']);
  });

  it('M-1: 필수 항목 행을 DRAFT(AI_DRAFT)로 되돌리고 OPTIONAL 로 낮추면 X01(비노출)', () => {
    const s = rawOf(promoted({ publishable: true }));
    Object.assign(row(s, 'supplyRequirements', 'req-syrian-water'), {
      reviewStatus: 'DRAFT',
      reviewerType: 'AI_DRAFT',
      verifiedBy: null,
      verifiedAt: null,
      reviewBasis: null,
      priority: 'OPTIONAL',
    });
    const x = errs(validateSeed(s, { now: FIXTURE_AS_OF }), 'X01');
    expect(x.map((i) => i.path)).toEqual(['requirements.water']);
    expect(x[0].message).toContain('노출 불가');
  });

  it('M-1: 필수 항목 집합이 코드에 없는 CareProfile 의 노출 타입 → X01(careProfileId, fail-closed)', () => {
    expect(Object.prototype.hasOwnProperty.call(REQUIRED_ITEMS_BY_PROFILE, SECOND.careProfileId)).toBe(false);
    const x = errs(validateSeed(rawOf(promotedTwo()), { now: FIXTURE_AS_OF }), 'X01').filter((i) => i.id === SECOND.typeId);
    expect(x.map((i) => i.path)).toEqual(['careProfileId']);
  });

  it('M-1: 집합은 코드 고정·동결(골든·드워프 = cage·food·water·bedding·hideout·wheel)', () => {
    const six = ['bedding', 'cage', 'food', 'hideout', 'water', 'wheel'];
    expect([...REQUIRED_ITEMS_BY_PROFILE['cp-hamster-syrian']].sort()).toEqual(six);
    expect([...REQUIRED_ITEMS_BY_PROFILE['cp-hamster-dwarf']].sort()).toEqual(six);
    expect(Object.isFrozen(REQUIRED_ITEMS_BY_PROFILE)).toBe(true);
    expect(Object.isFrozen(REQUIRED_ITEMS_BY_PROFILE['cp-hamster-dwarf'])).toBe(true);
  });

  it('M-1 오탐 0: 드워프 실시드 + 사료만 검수 승격(메모리) → X01 0', () => {
    const s = rawOf(dwarfPreview());
    const req = row(s, 'supplyRequirements', 'req-dwarf-food');
    verify(req, 'VET_PUBLISHED_SOURCE');
    req.verifiedAt = DWARF_PREVIEW_AS_OF;
    req.source = [
      { url: 'https://www.rspca.org.uk/a', title: 'a', accessedAt: '2026-09-30' },
      { url: 'https://www.example.kr/a', title: 'b', accessedAt: '2026-09-30' },
    ];
    const item = row(s, 'supplyItems', 'food');
    verify(item, 'EXPERIENCED_KEEPER');
    item.verifiedAt = DWARF_PREVIEW_AS_OF;
    expect(errs(validateSeed(s, { now: DWARF_PREVIEW_AS_OF }), 'X01')).toEqual([]);
  });

  it('반대로 override 로 OPTIONAL 을 REQUIRED 로 올리면(비노출 행) X01', () => {
    const s = rawOf(promoted({ publishable: true }));
    // 골든 req-syrian-scale(OPTIONAL, DRAFT) 을 타입 override 로 REQUIRED 로.
    row(s, 'animalTypes', 'hamster-golden').careOverrides = { requirements: { scale: { priority: 'REQUIRED' } } };
    const x = errs(validateSeed(s, { now: FIXTURE_AS_OF }), 'X01');
    expect(x.map((i) => i.path)).toEqual(['requirements.scale']);
  });

  it('승격 픽스처(cage·wheel 만 VERIFIED, 나머지 REQUIRED 그대로) → 나머지 REQUIRED 마다 X01', () => {
    const s = rawOf(promoted());
    // 픽스처가 낮춘 priority 를 디스크 값으로 되돌린다.
    for (const r of s.supplyRequirements as Rec[]) {
      const disk = (BASE.supplyRequirements as Rec[]).find((d) => d.id === r.id);
      if (disk) r.priority = disk.priority;
    }
    const paths = errs(validateSeed(s, { now: FIXTURE_AS_OF }), 'X01').map((i) => i.path).sort();
    // BE92: 골든 사료 그릇 RECOMMENDED(85·Kenny) → REQUIRED 목록에서 빠짐.
    expect(paths).toEqual(['requirements.bedding', 'requirements.food', 'requirements.hideout', 'requirements.water']);
  });

  it('REQUIRED 하나가 만료(verifiedAt +181일)되고 나머지는 유효 → X01', () => {
    const s = rawOf(promoted({ publishable: true }));
    row(s, 'supplyRequirements', 'req-syrian-wheel').verifiedAt = '2026-04-20';
    const x = errs(validateSeed(s, { now: FIXTURE_AS_OF }), 'X01');
    expect(x.map((i) => i.path)).toEqual(['requirements.wheel']);
  });

  it('타입 자체가 비노출(동물 DRAFT)이면 대상 아님 — X01 0', () => {
    const s = rawOf(promoted({ typeDraft: true }));
    for (const r of s.supplyRequirements as Rec[]) {
      const disk = (BASE.supplyRequirements as Rec[]).find((d) => d.id === r.id);
      if (disk) r.priority = disk.priority;
    }
    expect(errs(validateSeed(s, { now: FIXTURE_AS_OF }), 'X01')).toEqual([]);
  });

  it('정상: 승격 픽스처(publishable — 필수 6항목 전부 노출) → errors 0', () => {
    expect(validateSeed(rawOf(promoted({ publishable: true })), { now: FIXTURE_AS_OF }).errors).toEqual([]);
  });

  it('M-1: 부분 체인 승격(cage·wheel 만, 나머지 REQUIRED 를 메모리에서 RECOMMENDED 로 낮춤) → 필수 4항목 X01', () => {
    const paths = errs(validateSeed(rawOf(promoted()), { now: FIXTURE_AS_OF }), 'X01').map((i) => i.path).sort();
    expect(paths).toEqual(['requirements.bedding', 'requirements.food', 'requirements.hideout', 'requirements.water']);
  });
});

/** 기니피그를 메모리에서 ACTIVE + 체인(타입·사육 프로필·REQUIRED 요구사항 전부(필수 6 + carrier)·용품) VERIFIED 로 — 디스크 시드는 DRAFT 그대로. */
const GP_FIXED = ['bedding', 'cage', 'food', 'hay', 'hideout', 'water'];
const guineaPigActive = (): Required<RawSeed> => {
  const s = fresh();
  const at = row(s, 'animalTypes', 'guinea-pig');
  at.status = 'ACTIVE';
  verify(at, 'EXPERIENCED_KEEPER');
  verify(row(s, 'careProfiles', 'cp-guineapig'), 'EXPERIENCED_KEEPER');
  for (const r of s.supplyRequirements as Rec[]) {
    if (r.careProfileId !== 'cp-guineapig' || r.priority !== 'REQUIRED') continue;
    verify(r, 'VET_PUBLISHED_SOURCE');
    verify(row(s, 'supplyItems', r.supplyItemId as string), 'EXPERIENCED_KEEPER');
  }
  return s;
};

describe('기니피그 ACTIVE 전 게이트(QA118 X01·X02)', () => {
  it('X01 집합: cp-guineapig = cage·food·water·bedding·hideout·hay(쳇바퀴 없음), 동결', () => {
    expect([...REQUIRED_ITEMS_BY_PROFILE['cp-guineapig']].sort()).toEqual(GP_FIXED);
    expect(REQUIRED_ITEMS_BY_PROFILE['cp-guineapig']).not.toContain('wheel');
    expect(Object.isFrozen(REQUIRED_ITEMS_BY_PROFILE['cp-guineapig'])).toBe(true);
  });

  it('실시드 16행이 집합을 충족: 각 항목에 cp-guineapig 요구사항 행이 있고 priority REQUIRED(해석 전·후)', () => {
    const rows = (BASE.supplyRequirements as Rec[]).filter((r) => r.careProfileId === 'cp-guineapig');
    expect(rows.length).toBe(16);
    for (const id of REQUIRED_ITEMS_BY_PROFILE['cp-guineapig']) {
      const r = rows.find((x) => x.supplyItemId === id);
      expect(r, id).toBeDefined();
      expect(r?.priority, id).toBe('REQUIRED');
    }
    expect(rows.some((x) => x.supplyItemId === 'wheel')).toBe(false);
    // 해석 후(SupplyItem 기본 → 요구사항 → careOverrides)도 REQUIRED — resolveRequirement 단일 경로로 확인.
    const cat = createCatalog(asSeedBundle(BASE));
    const resolved = new Map(listResolvedRequirements(cat, 'guinea-pig').map((r) => [r.supplyItemId, r.priority]));
    for (const id of REQUIRED_ITEMS_BY_PROFILE['cp-guineapig']) expect(resolved.get(id), id).toBe('REQUIRED');
  });

  it('메모리 ACTIVE + REQUIRED 체인 VERIFIED → X01 0(기니피그) · X02 0(Cavia 미검수 Taxon, 자명)', () => {
    const res = validateSeed(guineaPigActive(), { now: NOW });
    expect(errs(res, 'X01').filter((i) => i.id === 'guinea-pig')).toEqual([]);
    expect(errs(res, 'X02').filter((i) => i.id === 'guinea-pig')).toEqual([]);
    expect(row(BASE, 'taxa', 'cavia-porcellus').reviewStatus).not.toBe('VERIFIED');
  });

  it('메모리 ACTIVE + 건초(hay) 행 DRAFT 로 되돌림 → X01 requirements.hay', () => {
    const s = guineaPigActive();
    Object.assign(row(s, 'supplyRequirements', 'req-guineapig-hay'), { reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, reviewBasis: null });
    const x = errs(validateSeed(s, { now: NOW }), 'X01').filter((i) => i.id === 'guinea-pig');
    expect(x.map((i) => i.path)).toEqual(['requirements.hay']);
  });

  // QA122 LOW-3: 위 DRAFT 테스트는 일반 REQUIRED 체인 검사로도 잡혀 집합의 hay 를 빼도 통과한다.
  //   hay 행을 VERIFIED 그대로 두고 priority 만 낮추면 '필수 항목 집합'만 잡는다 — 집합에서 hay 를 빼면 이 테스트가 실패한다.
  for (const lowered of ['RECOMMENDED', 'OPTIONAL', 'NOT_NOW']) {
    it(`M-1(기니피그): VERIFIED 건초(hay) 행 priority REQUIRED → ${lowered} → X01 requirements.hay (집합 기반)`, () => {
      const s = guineaPigActive();
      const hay = row(s, 'supplyRequirements', 'req-guineapig-hay');
      expect(hay.reviewStatus).toBe('VERIFIED');
      hay.priority = lowered;
      const x = errs(validateSeed(s, { now: NOW }), 'X01').filter((i) => i.id === 'guinea-pig');
      expect(x.map((i) => i.path)).toEqual(['requirements.hay']);
    });
  }

  it('M-1(기니피그): careOverrides 로 hay 를 RECOMMENDED 로 낮춰도 X01 requirements.hay', () => {
    const s = guineaPigActive();
    const at = row(s, 'animalTypes', 'guinea-pig');
    const prev = (at.careOverrides as Rec | null | undefined) ?? {};
    at.careOverrides = { ...prev, requirements: { ...((prev.requirements as Rec | undefined) ?? {}), hay: { priority: 'RECOMMENDED' } } };
    const x = errs(validateSeed(s, { now: NOW }), 'X01').filter((i) => i.id === 'guinea-pig');
    expect(x.map((i) => i.path)).toEqual(['requirements.hay']);
  });

  it('X02: 기니피그 ACTIVE + 미검수 Taxon cites true 주입 → X02(Cavia 라도 불리언이 자명이 아니면 차단)', () => {
    const s = guineaPigActive();
    (row(s, 'taxa', 'cavia-porcellus').legal as Rec).cites = true;
    const x = errs(validateSeed(s, { now: NOW }), 'X02');
    expect(x.map((i) => `${i.id} ${i.path}`)).toEqual(['guinea-pig taxonId']);
  });

  it('isTaxonLegallyTrivial: 실시드 Cavia porcellus legal → true', () => {
    const t = row(BASE, 'taxa', 'cavia-porcellus');
    expect(genusOf(t.scientificName)).toBe('Cavia');
    expect(isTaxonLegallyTrivial(t)).toBe(true);
  });
});

/** 저빌(126 S2)을 메모리에서 ACTIVE + 체인(타입·사육 프로필·REQUIRED 요구사항 전부·용품) VERIFIED 로 — 디스크 시드는 DRAFT·PLANNED 그대로. */
const GB_FIXED = ['bedding', 'cage', 'food', 'hideout', 'sand-bath', 'water'];
const gerbilActive = (): Required<RawSeed> => {
  const s = fresh();
  const at = row(s, 'animalTypes', 'gerbil-mongolian');
  at.status = 'ACTIVE';
  verify(at, 'EXPERIENCED_KEEPER');
  verify(row(s, 'careProfiles', 'cp-gerbil-mongolian'), 'EXPERIENCED_KEEPER');
  for (const r of s.supplyRequirements as Rec[]) {
    if (r.careProfileId !== 'cp-gerbil-mongolian' || r.priority !== 'REQUIRED') continue;
    verify(r, 'VET_PUBLISHED_SOURCE');
    verify(row(s, 'supplyItems', r.supplyItemId as string), 'EXPERIENCED_KEEPER');
  }
  // 사료(FOOD) 행: 104 는 국내(.kr) 수의 출처를 찾지 못했다 → 디스크 행은 VERIFIED 가 되면 V08. 게이트(X01·X02)만 보려고
  //   메모리 사본에만 자리표시 국내 출처를 붙인다(실제 출처 아님 — 디스크·패킷에는 없음, ACTIVE 전 보강 필요는 확인표 D).
  const food = row(s, 'supplyRequirements', 'req-gerbil-food');
  food.source = [...(food.source as Rec[]), { url: 'https://fixture.example.kr/gerbil-food', title: '픽스처 국내 출처(메모리 전용)', accessedAt: '2026-10-27' }];
  return s;
};
const gerbilX = (s: RawSeed, rule: string) => errs(validateSeed(s, { now: NOW }), rule).filter((i) => i.id === 'gerbil-mongolian');

describe('저빌 ACTIVE 전 게이트(126 S2 — X01 sand-bath · X02 NOT_GATING_KENNY)', () => {
  it('디스크: gerbil-mongolian PLANNED · Taxon meriones-unguiculatus DRAFT·AI_DRAFT · legal act6 false/cites false/화이트리스트 null', () => {
    const at = row(BASE, 'animalTypes', 'gerbil-mongolian');
    expect([at.status, at.taxonId, at.careProfileId, at.reviewStatus, at.reviewerType]).toEqual(['PLANNED', 'meriones-unguiculatus', 'cp-gerbil-mongolian', 'DRAFT', 'AI_DRAFT']);
    const t = row(BASE, 'taxa', 'meriones-unguiculatus');
    expect([t.reviewStatus, t.reviewerType, t.verifiedBy, t.verifiedAt]).toEqual(['DRAFT', 'AI_DRAFT', null, null]);
    expect(t.legal).toMatchObject({ animalProtectionAct6: false, cites: false, designatedWildlifeWhitelist: null });
    expect(isTaxonLegallyTrivial(t)).toBe(true);
  });

  it('X01 집합: cp-gerbil-mongolian = cage·food·water·bedding·hideout·sand-bath(쳇바퀴·건초 없음), 동결', () => {
    expect([...REQUIRED_ITEMS_BY_PROFILE['cp-gerbil-mongolian']].sort()).toEqual(GB_FIXED);
    expect(REQUIRED_ITEMS_BY_PROFILE['cp-gerbil-mongolian']).not.toContain('wheel');
    expect(REQUIRED_ITEMS_BY_PROFILE['cp-gerbil-mongolian']).not.toContain('hay');
    expect(Object.isFrozen(REQUIRED_ITEMS_BY_PROFILE['cp-gerbil-mongolian'])).toBe(true);
  });

  it('실시드 14행이 집합을 충족: 각 항목 행 있음·REQUIRED(해석 전·후), wheel 은 RECOMMENDED', () => {
    const rows = (BASE.supplyRequirements as Rec[]).filter((r) => r.careProfileId === 'cp-gerbil-mongolian');
    expect(rows.length).toBe(14);
    for (const id of REQUIRED_ITEMS_BY_PROFILE['cp-gerbil-mongolian']) {
      const r = rows.find((x) => x.supplyItemId === id);
      expect(r, id).toBeDefined();
      expect(r?.priority, id).toBe('REQUIRED');
    }
    expect(rows.find((x) => x.supplyItemId === 'wheel')?.priority).toBe('RECOMMENDED');
    const cat = createCatalog(asSeedBundle(BASE));
    const resolved = new Map(listResolvedRequirements(cat, 'gerbil-mongolian').map((r) => [r.supplyItemId, r.priority]));
    for (const id of REQUIRED_ITEMS_BY_PROFILE['cp-gerbil-mongolian']) expect(resolved.get(id), id).toBe('REQUIRED');
  });

  it('(a·b) 메모리 ACTIVE + REQUIRED 체인 VERIFIED, 미검수 Taxon act6 false(디스크) / null → X01 0 · X02 0', () => {
    expect(gerbilX(gerbilActive(), 'X01')).toEqual([]);
    expect(gerbilX(gerbilActive(), 'X02')).toEqual([]);
    const s = gerbilActive();
    (row(s, 'taxa', 'meriones-unguiculatus').legal as Rec).animalProtectionAct6 = null;
    expect(gerbilX(s, 'X02')).toEqual([]);
    expect(validateSeed(s, { now: NOW }).errors.filter((i) => i.id === 'gerbil-mongolian')).toEqual([]);
  });

  const x02Cases: Array<[string, (t: Rec) => void]> = [
    ['(c) act6 true(6종이라는 사실과 다른 값)', (t) => ((t.legal as Rec).animalProtectionAct6 = true)],
    ['(d) cites true', (t) => ((t.legal as Rec).cites = true)],
    ['화이트리스트 true', (t) => ((t.legal as Rec).designatedWildlifeWhitelist = true)],
    ['act6 키 누락', (t) => delete (t.legal as Rec).animalProtectionAct6],
    ['(e) 허용목록 밖 속 Pachyuromys duprasi(펫테일저빌)', (t) => (t.scientificName = 'Pachyuromys duprasi')],
    ['같은 속 다른 종 Meriones crassus', (t) => (t.scientificName = 'Meriones crassus')],
  ];
  for (const [name, mutate] of x02Cases) {
    it(`X02: 저빌 ACTIVE + 미검수 Taxon ${name} → X02(gerbil-mongolian taxonId)`, () => {
      const s = gerbilActive();
      mutate(row(s, 'taxa', 'meriones-unguiculatus'));
      expect(gerbilX(s, 'X02').map((i) => `${i.id} ${i.path}`)).toEqual(['gerbil-mongolian taxonId']);
    });
  }

  it('legal null → 구조 단계에서 ERROR(게이트 전 차단, fail-closed)', () => {
    const s = gerbilActive();
    row(s, 'taxa', 'meriones-unguiculatus').legal = null;
    const e = validateSeed(s, { now: NOW }).errors.filter((i) => i.id === 'meriones-unguiculatus');
    expect(e.length).toBeGreaterThan(0);
  });

  it('X02: 같은 값이라도 Taxon VERIFIED(OFFICIAL_SOURCE) → X02 0 (act6 true 주입)', () => {
    const s = gerbilActive();
    const t = row(s, 'taxa', 'meriones-unguiculatus');
    (t.legal as Rec).animalProtectionAct6 = true;
    verify(t, 'OFFICIAL_SOURCE');
    expect(gerbilX(s, 'X02')).toEqual([]);
  });

  it('(g) X01: 메모리 ACTIVE 에서 sand-bath 요구사항 행 삭제 → X01 requirements.sand-bath', () => {
    const s = gerbilActive();
    s.supplyRequirements = (s.supplyRequirements as Rec[]).filter((r) => r.id !== 'req-gerbil-sand-bath');
    expect(gerbilX(s, 'X01').map((i) => i.path)).toEqual(['requirements.sand-bath']);
  });

  for (const lowered of ['RECOMMENDED', 'OPTIONAL', 'NOT_NOW']) {
    it(`X01(집합 기반): VERIFIED sand-bath 행 priority REQUIRED → ${lowered} → X01 requirements.sand-bath`, () => {
      const s = gerbilActive();
      const sb = row(s, 'supplyRequirements', 'req-gerbil-sand-bath');
      expect(sb.reviewStatus).toBe('VERIFIED');
      sb.priority = lowered;
      expect(gerbilX(s, 'X01').map((i) => i.path)).toEqual(['requirements.sand-bath']);
    });
  }

  it('V08: 디스크 사료 행(국내 출처 0)을 그대로 VERIFIED 로 올리면 V08 — 국내 수의 출처 없이는 사료 체인이 열리지 않는다', () => {
    const s = gerbilActive();
    const food = row(s, 'supplyRequirements', 'req-gerbil-food');
    food.source = (food.source as Array<{ url: string }>).filter((x) => !x.url.includes('.kr/'));
    expect(errs(validateSeed(s, { now: NOW }), 'V08').map((i) => i.id)).toEqual(['req-gerbil-food']);
    expect((row(BASE, 'supplyRequirements', 'req-gerbil-food').source as Array<{ url: string }>).some((x) => new URL(x.url).hostname.endsWith('.kr'))).toBe(false);
  });

  it('X01: 사료 행 DRAFT(FOOD 미검수) → X01 requirements.food', () => {
    const s = gerbilActive();
    Object.assign(row(s, 'supplyRequirements', 'req-gerbil-food'), { reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, reviewBasis: null });
    expect(gerbilX(s, 'X01').map((i) => i.path)).toEqual(['requirements.food']);
  });

  it('PLANNED(디스크) 저빌은 대상 아님 — Taxon cites true 주입해도 X02 0', () => {
    const s = fresh();
    (row(s, 'taxa', 'meriones-unguiculatus').legal as Rec).cites = true;
    expect(gerbilX(s, 'X02')).toEqual([]);
  });
});

describe('V08 — FOOD/HEALTH VERIFIED 국내 출처 1개 이상(G-3)', () => {
  it('isDomesticDomain: .kr·.한국(punycode) 만', () => {
    expect(isDomesticDomain('snu.ac.kr')).toBe(true);
    expect(isDomesticDomain('example.kr')).toBe(true);
    expect(isDomesticDomain('xn--3e0b707e')).toBe(true); // TLD 자체도 접미사로는 .한국
    expect(isDomesticDomain('example.xn--3e0b707e')).toBe(true);
    expect(isDomesticDomain('example.com')).toBe(false);
    expect(isDomesticDomain('kr.example.com')).toBe(false);
    expect(isDomesticDomain('rspca.org.uk')).toBe(false);
  });

  for (const domestic of ['https://vet.snu.ac.kr/x', 'https://수의.한국/x', 'https://www.example.kr/a']) {
    it(`정상: 서로 다른 도메인 2 + 국내 1(${domestic}) → V04·V08 0`, () => {
      const s = fresh();
      const r = row(s, 'supplyRequirements', 'req-syrian-food');
      verify(r, 'VET_PUBLISHED_SOURCE');
      r.source = [
        { url: 'https://www.rspca.org.uk/a', title: 'a', accessedAt: '2026-09-30' },
        { url: domestic, title: 'b', accessedAt: '2026-09-30' },
      ];
      const res = validateSeed(s, { now: NOW });
      expect(res.errors).toEqual([]);
    });
  }

  it('국내 1개뿐(도메인 1) → V04 만(국내는 충족) / 국외 2개 → V08 만', () => {
    const one = fresh();
    const r1 = row(one, 'supplyRequirements', 'req-syrian-food');
    verify(r1, 'VET_PUBLISHED_SOURCE');
    r1.source = [{ url: 'https://vet.snu.ac.kr/x', title: 'a', accessedAt: '2026-09-30' }];
    expect(validateSeed(one, { now: NOW }).errors.map((i) => i.rule)).toEqual(['V04']);

    const two = fresh();
    const r2 = row(two, 'supplyRequirements', 'req-syrian-food');
    verify(r2, 'VET_PUBLISHED_SOURCE');
    // BE92 Q3: 디스크에 국내 K1 이 붙어 → 국외 출처만 남긴다.
    r2.source = (r2.source as Array<{ url: string }>).filter((x) => !x.url.includes('.kr/'));
    expect(validateSeed(two, { now: NOW }).errors.map((i) => i.rule)).toEqual(['V08']);
  });

  it('SPEC/CARE 는 대상 아님(국외 출처 1개 VERIFIED 통과)', () => {
    const s = fresh();
    const r = row(s, 'supplyRequirements', 'req-syrian-cage');
    verify(r, 'EXPERIENCED_KEEPER');
    expect(errs(validateSeed(s, { now: NOW }), 'V08')).toEqual([]);
  });

  it('DRAFT FOOD 는 대상 아님(실시드 req-dwarf-food·req-syrian-food)', () => {
    expect(errs(validateSeed(fresh(), { now: NOW }), 'V08')).toEqual([]);
  });
});

describe('X02 — ACTIVE 타입 Taxon 미검수 ∧ 법 판단 필요(M-1, 제품기획 §9)', () => {
  it('isLegalTrivial: 6종 ∧ CITES false ∧ 화이트리스트 null/false 만 자명', () => {
    expect(isLegalTrivial({ animalProtectionAct6: true, cites: false, designatedWildlifeWhitelist: null })).toBe(true);
    expect(isLegalTrivial({ animalProtectionAct6: true, cites: false, designatedWildlifeWhitelist: false })).toBe(true);
    expect(isLegalTrivial({ animalProtectionAct6: true, cites: true, designatedWildlifeWhitelist: null })).toBe(false);
    expect(isLegalTrivial({ animalProtectionAct6: true, cites: null, designatedWildlifeWhitelist: null })).toBe(false);
    expect(isLegalTrivial({ animalProtectionAct6: null, cites: false, designatedWildlifeWhitelist: null })).toBe(false);
    expect(isLegalTrivial({ animalProtectionAct6: false, cites: false, designatedWildlifeWhitelist: false })).toBe(false);
    expect(isLegalTrivial({ animalProtectionAct6: true, cites: false, designatedWildlifeWhitelist: true })).toBe(false);
    expect(isLegalTrivial({ animalProtectionAct6: true, cites: false })).toBe(false); // 누락 = 판단 필요
    expect(isLegalTrivial(null)).toBe(false);
  });

  it('M-2 · 보안 129 LOW-1: 종 허용목록(앞 두 단어) — 햄스터 3종·Cavia porcellus = PET_ACT6, Meriones unguiculatus = NOT_GATING_KENNY, 동결', () => {
    expect(TRIVIAL_LEGAL_SPECIES).toEqual({
      'Mesocricetus auratus': 'PET_ACT6',
      'Phodopus sungorus': 'PET_ACT6',
      'Phodopus campbelli': 'PET_ACT6',
      'Cavia porcellus': 'PET_ACT6',
      'Meriones unguiculatus': 'NOT_GATING_KENNY',
    });
    expect(Object.isFrozen(TRIVIAL_LEGAL_SPECIES)).toBe(true);
    // 허용목록 ⊆ 실시드 Taxon 학명(Taxon 없는 종은 넣지 않는다). 밖에 남는 실시드 종 = 앵무 2종(K-2) · 로보(272-B·Kenny 전, 271 LOW #4) — Taxon 검수 경로.
    const taxaNames = (BASE.taxa as Rec[]).map((t) => t.scientificName as string);
    for (const sp of Object.keys(TRIVIAL_LEGAL_SPECIES)) expect([sp, taxaNames.includes(sp)]).toEqual([sp, true]);
    expect(taxaNames.filter((n) => !Object.prototype.hasOwnProperty.call(TRIVIAL_LEGAL_SPECIES, n)).sort()).toEqual(['Melopsittacus undulatus', 'Nymphicus hollandicus', 'Phodopus roborovskii']);
    // 271 LOW #5: 허용 쌍(학명 → Taxon id)도 동결 · 키 = 허용목록 · 각 쌍이 실시드 행과 일치.
    expect(Object.isFrozen(TRIVIAL_LEGAL_TAXON_ID)).toBe(true);
    expect(Object.keys(TRIVIAL_LEGAL_TAXON_ID).sort()).toEqual(Object.keys(TRIVIAL_LEGAL_SPECIES).sort());
    for (const [sp, tid] of Object.entries(TRIVIAL_LEGAL_TAXON_ID)) expect([sp, row(fresh(), 'taxa', tid).scientificName]).toEqual([sp, sp]);
    expect(genusOf('Mesocricetus auratus')).toBe('Mesocricetus');
    expect(genusOf('Phodopus')).toBe('Phodopus');
    expect(genusOf('mesocricetus auratus')).toBeNull();
    expect(genusOf('Meso-cricetus auratus')).toBeNull();
    expect(genusOf(null)).toBeNull();
    expect(speciesOf('Mesocricetus auratus')).toBe('Mesocricetus auratus');
    expect(speciesOf('  Cavia porcellus  ')).toBe('Cavia porcellus');
    expect(speciesOf('Phodopus sungorus sungorus')).toBe('Phodopus sungorus'); // 아종 이하 무시
    expect(speciesOf('Meriones unguiculatus (Milne-Edwards, 1867)')).toBe('Meriones unguiculatus');
    expect(speciesOf('Mesocricetus auratus Waterhouse, 1839')).toBe('Mesocricetus auratus');
    // 교잡·기타 꼬리는 첫 종으로 읽지 않는다(QA137 LOW-2, 보안 144 LOW-1 — 허용 목록).
    for (const hybrid of [
      'Meriones unguiculatus × Meriones crassus',
      'Meriones unguiculatus x Meriones crassus',
      'Meriones unguiculatus X Meriones crassus',
      'Meriones unguiculatus ✕ Meriones crassus',
      'Meriones unguiculatus х Meriones crassus',
      'Meriones unguiculatus x',
      'Meriones unguiculatus (x Meriones crassus)',
      'Meriones unguiculatus x​Meriones',
      'Meriones unguiculatus hybrid',
      'Cavia porcellus×aperea',
    ])
      expect([hybrid, speciesOf(hybrid)]).toEqual([hybrid, null]);
    for (const bad of ['Phodopus', 'Cavia Porcellus', 'cavia porcellus', 'Cavia  porcellus', 'Cavia porcellus2', null, 3]) expect([bad, speciesOf(bad)]).toEqual([bad, null]);
  });

  it('M-2 · LOW-1 isTaxonLegallyTrivial: 같은 속의 다른 종·허용목록 밖 종은 불리언이 자명이어도 false', () => {
    const ok = { animalProtectionAct6: true, cites: false, designatedWildlifeWhitelist: null };
    const ng = { animalProtectionAct6: false, cites: false, designatedWildlifeWhitelist: null };
    expect(isTaxonLegallyTrivial({ id: 'phodopus-sungorus', scientificName: 'Phodopus sungorus', legal: ok })).toBe(true);
    expect(isTaxonLegallyTrivial({ id: 'phodopus-campbelli', scientificName: 'Phodopus campbelli', legal: ok })).toBe(true);
    expect(isTaxonLegallyTrivial({ id: 'mesocricetus-auratus', scientificName: 'Mesocricetus auratus', legal: ok })).toBe(true);
    expect(isTaxonLegallyTrivial({ id: 'cavia-porcellus', scientificName: 'Cavia porcellus', legal: ok })).toBe(true);
    // 271 LOW #5: 허용 학명이라도 (taxonId, 학명) 쌍이 아니면 false — id 누락·다른 행 id 모두.
    expect(isTaxonLegallyTrivial({ scientificName: 'Phodopus sungorus', legal: ok })).toBe(false);
    expect(isTaxonLegallyTrivial({ id: 'melopsittacus-undulatus', scientificName: 'Phodopus sungorus', legal: ok })).toBe(false);
    expect(isTaxonLegallyTrivial({ id: 'phodopus-campbelli', scientificName: 'Phodopus sungorus', legal: ok })).toBe(false);
    for (const sci of ['Cavia aperea', 'Mesocricetus brandti', 'Pachyuromys duprasi', 'Phodopus roborovskii', 'Phodopus przewalskii', 'Melopsittacus undulatus', 'Nymphicus hollandicus', 'Meriones crassus', 'Mesocricetusx auratus', 'Cavia', 'Cavia porcellusx']) {
      for (const id of [undefined, 'phodopus-roborovskii', 'melopsittacus-undulatus', 'mesocricetus-auratus']) {
        expect([sci, id, isTaxonLegallyTrivial({ id, scientificName: sci, legal: ok })]).toEqual([sci, id, false]);
        expect([sci, id, isTaxonLegallyTrivial({ id, scientificName: sci, legal: ng })]).toEqual([sci, id, false]);
      }
    }
    expect(isTaxonLegallyTrivial({ id: 'phodopus-sungorus', scientificName: 'Phodopus sungorus', legal: { ...ok, cites: true } })).toBe(false);
    // 근거가 섞이지 않는다: PET_ACT6 종에 6종 밖(false) 값 → false, NOT_GATING_KENNY 종(저빌)에 6종(true) 값 → false.
    expect(isTaxonLegallyTrivial({ id: 'cavia-porcellus', scientificName: 'Cavia porcellus', legal: ng })).toBe(false);
    expect(isTaxonLegallyTrivial({ id: 'meriones-unguiculatus', scientificName: 'Meriones unguiculatus', legal: ok })).toBe(false);
    expect(isTaxonLegallyTrivial({ id: 'meriones-unguiculatus', scientificName: 'Meriones unguiculatus', legal: ng })).toBe(true);
  });

  it('isLegalNotGating(Kenny 2026-10-27 저빌): act6·cites·화이트리스트 모두 null/false 만 — act6 true·cites true·화이트리스트 true·키 누락 거부', () => {
    for (const act6 of [null, false]) {
      for (const cites of [null, false]) {
        for (const w of [null, false]) expect(isLegalNotGating({ animalProtectionAct6: act6, cites, designatedWildlifeWhitelist: w })).toBe(true);
      }
    }
    expect(isLegalNotGating({ animalProtectionAct6: true, cites: false, designatedWildlifeWhitelist: null })).toBe(false);
    expect(isLegalNotGating({ animalProtectionAct6: false, cites: true, designatedWildlifeWhitelist: null })).toBe(false);
    expect(isLegalNotGating({ animalProtectionAct6: false, cites: false, designatedWildlifeWhitelist: true })).toBe(false);
    expect(isLegalNotGating({ animalProtectionAct6: 'false', cites: false, designatedWildlifeWhitelist: null })).toBe(false);
    expect(isLegalNotGating({ cites: false, designatedWildlifeWhitelist: null })).toBe(false); // act6 누락
    expect(isLegalNotGating({ animalProtectionAct6: false, designatedWildlifeWhitelist: null })).toBe(false); // cites 누락
    expect(isLegalNotGating({ animalProtectionAct6: false, cites: false })).toBe(false); // 화이트리스트 누락
    expect(isLegalNotGating(null)).toBe(false);
  });

  for (const sci of ['Psittacula krameri', 'mesocricetus auratus', 'Cavia aperea', 'Mesocricetus brandti', 'Pachyuromys duprasi']) {
    it(`M-2 · LOW-1: 허용목록 밖 학명(${sci}) + 자명 불리언 + 미검수 Taxon → X02`, () => {
      const s = fresh();
      row(s, 'taxa', 'mesocricetus-auratus').scientificName = sci;
      const x = errs(validateSeed(s, { now: NOW }), 'X02');
      expect(x.map((i) => `${i.id} ${i.path}`)).toEqual(['hamster-golden taxonId']);
      expect(x[0].message).toContain('허용목록');
    });
  }

  it('271 LOW #5 · R11: 다른 Taxon 행의 학명을 복제하면 R11(학명 유일) — 게이트 전 차단', () => {
    const s = fresh();
    row(s, 'taxa', 'mesocricetus-auratus').scientificName = 'Meriones unguiculatus';
    const res = validateSeed(s, { now: NOW });
    expect(errs(res, 'R11').map((i) => `${i.id} ${i.path}`)).toEqual(['meriones-unguiculatus scientificName']);
    expect(errs(res, 'X02')).toEqual([]); // 구조·참조 ERROR 라 게이트 미실행(fail-closed: errors ≠ 0)
    // 종 기준: 아종 꼬리만 다른 같은 종도 중복.
    const s2 = fresh();
    row(s2, 'taxa', 'phodopus-campbelli').scientificName = 'Phodopus sungorus sungorus';
    expect(errs(validateSeed(s2, { now: NOW }), 'R11').map((i) => i.id)).toEqual(['phodopus-campbelli']);
  });

  it('271 LOW #5: 허용 학명을 다른 Taxon 행으로 옮겨도(원 행은 개명) X02 — 판정은 (taxonId, 학명) 쌍', () => {
    const s = fresh();
    row(s, 'taxa', 'meriones-unguiculatus').scientificName = 'Meriones crassus';
    row(s, 'taxa', 'mesocricetus-auratus').scientificName = 'Meriones unguiculatus';
    Object.assign(row(s, 'taxa', 'mesocricetus-auratus').legal as Rec, { animalProtectionAct6: false, cites: false, designatedWildlifeWhitelist: null });
    const res = validateSeed(s, { now: NOW });
    expect(errs(res, 'R11')).toEqual([]);
    const x = errs(res, 'X02');
    expect(x.map((i) => `${i.id} ${i.path}`)).toEqual(['hamster-golden taxonId']);
    expect(x[0].message).toContain('허용 쌍 아님');
  });

  it('M-2: 허용목록 밖이라도 Taxon VERIFIED(OFFICIAL_SOURCE) → X02 0', () => {
    const s = fresh();
    const t = row(s, 'taxa', 'mesocricetus-auratus');
    t.scientificName = 'Pachyuromys duprasi';
    verify(t, 'OFFICIAL_SOURCE');
    expect(errs(validateSeed(s, { now: NOW }), 'X02')).toEqual([]);
  });

  it('M-2 오탐 0: 드워프 ACTIVE(Phodopus, 미검수 Taxon) → X02 0', () => {
    expect(errs(validateSeed(rawOf(dwarfPreview()), { now: DWARF_PREVIEW_AS_OF }), 'X02')).toEqual([]);
  });

  const cases: Array<[string, Rec]> = [
    ['cites true(CITES 부속서)', { cites: true }],
    ['cites null(미판단)', { cites: null }],
    ['animalProtectionAct6 null(미판단)', { animalProtectionAct6: null }],
    ['animalProtectionAct6 false(6종 밖 — 지정관리 판단 필요)', { animalProtectionAct6: false }],
    ['designatedWildlifeWhitelist true(백색목록 종)', { designatedWildlifeWhitelist: true }],
  ];
  for (const [name, p] of cases) {
    it(`ACTIVE 골든 + 미검수 Taxon ${name} → X02`, () => {
      const s = fresh();
      Object.assign(row(s, 'taxa', 'mesocricetus-auratus').legal as Rec, p);
      const x = errs(validateSeed(s, { now: NOW }), 'X02');
      expect(x.map((i) => `${i.id} ${i.path}`)).toEqual(['hamster-golden taxonId']);
    });
  }

  it('같은 법 값이라도 Taxon VERIFIED(OFFICIAL_SOURCE) → X02 0', () => {
    const s = fresh();
    const t = row(s, 'taxa', 'mesocricetus-auratus');
    (t.legal as Rec).cites = true;
    verify(t, 'OFFICIAL_SOURCE');
    expect(errs(validateSeed(s, { now: NOW }), 'X02')).toEqual([]);
  });

  it('VERIFIED 라도 만료(+181일)면 미검수로 본다 → X02', () => {
    const s = fresh();
    const t = row(s, 'taxa', 'mesocricetus-auratus');
    (t.legal as Rec).cites = true;
    verify(t, 'OFFICIAL_SOURCE');
    t.verifiedAt = '2026-04-20';
    expect(errs(validateSeed(s, { now: NOW }), 'X02').length).toBe(1);
  });

  it('PLANNED 타입은 대상 아님(드워프 Taxon cites true 주입해도 X02 0)', () => {
    const s = fresh();
    (row(s, 'taxa', 'phodopus-sungorus').legal as Rec).cites = true;
    expect(errs(validateSeed(s, { now: NOW }), 'X02')).toEqual([]);
  });
});

describe('L-1 — ACTIVE(노출 후보) 타입은 taxonId 비어 있지 않음(R01)', () => {
  for (const v of [null, '']) {
    it(`taxonId ${JSON.stringify(v)} → R01`, () => {
      const s = fresh();
      row(s, 'animalTypes', 'hamster-golden').taxonId = v;
      const r01 = errs(validateSeed(s, { now: NOW }), 'R01');
      expect(r01.some((i) => i.id === 'hamster-golden' && i.path === 'status')).toBe(true);
    });
  }
});

describe('271 1차 종 게이트 — 로보·앵무 X02 fail-closed(허용목록 밖) · 앵무 X01 fail-closed', () => {
  // 위반·승격은 메모리 사본에만. NOW_W1 = 작업일(271).
  const NOW_W1 = '2026-11-02';
  const active = (typeId: string): Required<RawSeed> => {
    const s = fresh();
    row(s, 'animalTypes', typeId).status = 'ACTIVE';
    return s;
  };
  const x02Of = (s: RawSeed, typeId: string) => errs(validateSeed(s, { now: NOW_W1 }), 'X02').filter((i) => i.id === typeId);
  /** 로보 ACTIVE(메모리): 디스크는 careProfileId null(271 보안 MED #2 — 드워프 프로필과 분리)이라 R01 을 피하려 메모리에서만 드워프 프로필에 잇는다. */
  const roboActive = (legal?: Rec): Required<RawSeed> => {
    const s = active('hamster-robo');
    row(s, 'animalTypes', 'hamster-robo').careProfileId = 'cp-hamster-dwarf';
    (row(s, 'careProfiles', 'cp-hamster-dwarf').taxonIds as string[]).push('phodopus-roborovskii');
    if (legal) Object.assign(row(s, 'taxa', 'phodopus-roborovskii').legal as Rec, legal);
    return s;
  };

  it('(i) 디스크: 로보는 드워프 프로필과 분리(careProfileId null · cp-hamster-dwarf.taxonIds 에 없음) · 별칭 유지 · legal act6 null(272-B 미확정)·cites false·화이트리스트 null', () => {
    const s = fresh();
    const at = row(s, 'animalTypes', 'hamster-robo');
    expect([at.status, at.careProfileId, at.aliases]).toEqual(['PLANNED', null, ['로보', '로보로브스키']]);
    expect(row(s, 'careProfiles', 'cp-hamster-dwarf').taxonIds).toEqual(['phodopus-sungorus', 'phodopus-campbelli']);
    const t = row(s, 'taxa', 'phodopus-roborovskii');
    expect([t.reviewStatus, t.reviewerType]).toEqual(['DRAFT', 'AI_DRAFT']);
    // 277(271 보류분 적용): 1차 출처(시행규칙 제3조·Species+·CITES 고시·야생생물법·백색목록 고시) 접근일 2026-11-02. act6 은 Kenny 확인 전 null.
    expect(t.legal).toEqual({ animalProtectionAct6: null, cites: false, designatedWildlifeWhitelist: null, note: null });
    expect((t.source as Rec[]).map((x) => x.accessedAt)).toEqual(Array(5).fill('2026-11-02'));
    expect(t.verifiedBy).toBeNull();
    // 디스크 그대로 ACTIVE 로 올리면 careProfileId 가 없어 R01(공개 불가).
    expect(errs(validateSeed(active('hamster-robo'), { now: NOW_W1 }), 'R01').map((i) => `${i.id} ${i.path}`)).toContain('hamster-robo status');
  });

  it('(i) 로보 ACTIVE(메모리 연결): 허용목록 밖(271 LOW #4) → 디스크 null · 드워프 선례값 · 어떤 불리언이든 X02 · Taxon VERIFIED(OFFICIAL_SOURCE) → X02 0', () => {
    expect(Object.prototype.hasOwnProperty.call(TRIVIAL_LEGAL_SPECIES, 'Phodopus roborovskii')).toBe(false);
    const dwarfLegal = { ...(row(fresh(), 'taxa', 'phodopus-sungorus').legal as Rec), note: null };
    for (const p of [undefined, dwarfLegal, { animalProtectionAct6: true, cites: false }, { animalProtectionAct6: false, cites: false }]) {
      const res = validateSeed(roboActive(p), { now: NOW_W1 });
      expect([p, res.errors.filter((i) => i.rule !== 'X02')]).toEqual([p, []]); // 게이트가 실제로 돌았다
      const x = errs(res, 'X02').filter((i) => i.id === 'hamster-robo');
      expect([p, x.map((i) => i.path)]).toEqual([p, ['taxonId']]);
      expect(x[0].message).toContain('허용목록');
    }
    expect(isTaxonLegallyTrivial({ id: 'phodopus-roborovskii', scientificName: 'Phodopus roborovskii', legal: dwarfLegal })).toBe(false);
    const reviewed = roboActive(dwarfLegal);
    const tx = row(reviewed, 'taxa', 'phodopus-roborovskii');
    verify(tx, 'OFFICIAL_SOURCE');
    tx.source = structuredClone(row(reviewed, 'taxa', 'phodopus-sungorus').source);
    expect(validateSeed(reviewed, { now: NOW_W1 }).errors).toEqual([]);
  });

  it('(i) 271 LOW #5 회귀: budgie Taxon 행에 학명 Phodopus roborovskii·act6 true 위조 → R11(학명 중복) · 허용 학명(Phodopus sungorus) 위조 → X02(허용 쌍 아님)', () => {
    const s = active('budgie');
    Object.assign(row(s, 'taxa', 'melopsittacus-undulatus'), { scientificName: 'Phodopus roborovskii' });
    Object.assign(row(s, 'taxa', 'melopsittacus-undulatus').legal as Rec, { animalProtectionAct6: true, cites: false, designatedWildlifeWhitelist: null });
    const res = validateSeed(s, { now: NOW_W1 });
    expect(errs(res, 'R11').map((i) => i.path)).toEqual(['scientificName']);
    expect(res.errors.length).toBeGreaterThan(0);
    // 원 행을 개명해 중복을 피해도 (taxonId, 학명) 쌍이 아니라 X02.
    const s2 = active('budgie');
    row(s2, 'taxa', 'phodopus-sungorus').scientificName = 'Phodopus przewalskii';
    Object.assign(row(s2, 'taxa', 'melopsittacus-undulatus'), { scientificName: 'Phodopus sungorus' });
    Object.assign(row(s2, 'taxa', 'melopsittacus-undulatus').legal as Rec, { animalProtectionAct6: true, cites: false, designatedWildlifeWhitelist: null });
    const r2 = validateSeed(s2, { now: NOW_W1 });
    expect(errs(r2, 'R11')).toEqual([]);
    const x = errs(r2, 'X02').filter((i) => i.id === 'budgie');
    expect(x.map((i) => i.path)).toEqual(['taxonId']);
    expect(x[0].message).toContain('허용 쌍 아님');
  });

  for (const [typeId, taxonId] of [
    ['budgie', 'melopsittacus-undulatus'],
    ['cockatiel', 'nymphicus-hollandicus'],
  ] as const) {
    it(`(ii) 디스크: ${taxonId} DRAFT·AI_DRAFT · legal act6 false·cites false·화이트리스트 null · 출처 4(접근일 2026-11-02, 277)`, () => {
      const t = row(fresh(), 'taxa', taxonId);
      expect([t.reviewStatus, t.reviewerType, t.verifiedBy, t.verifiedAt]).toEqual(['DRAFT', 'AI_DRAFT', null, null]);
      expect(t.legal).toEqual({ animalProtectionAct6: false, cites: false, designatedWildlifeWhitelist: null, note: null });
      expect((t.source as Rec[]).map((x) => x.accessedAt)).toEqual(Array(4).fill('2026-11-02'));
    });
    it(`(ii) ${typeId} ACTIVE + DRAFT(AI_DRAFT) Taxon → X02(허용목록 밖, 불리언 무관) · Taxon VERIFIED(OFFICIAL_SOURCE) → X02 0`, () => {
      const x = x02Of(active(typeId), typeId);
      expect(x.map((i) => i.path)).toEqual(['taxonId']);
      expect(x[0].message).toContain('허용목록');
      // 불리언을 PET_ACT6 모양으로 바꿔도 허용목록 밖이라 X02(시드 편집으로 우회 불가).
      const forged = active(typeId);
      Object.assign(row(forged, 'taxa', taxonId).legal as Rec, { animalProtectionAct6: true, cites: false, designatedWildlifeWhitelist: null });
      expect(x02Of(forged, typeId).map((i) => i.path)).toEqual(['taxonId']);
      // VERIFIED 경로: V06(불리언)·V04(출처)를 형식만 채운 합성값 — 게이트가 실제로 돌았는지(구조·참조·검수 오류 0)도 확인.
      const reviewed = active(typeId);
      const tx = row(reviewed, 'taxa', taxonId);
      verify(tx, 'OFFICIAL_SOURCE');
      Object.assign(tx.legal as Rec, { animalProtectionAct6: false, cites: false });
      tx.source = structuredClone(row(reviewed, 'taxa', 'mesocricetus-auratus').source);
      const res = validateSeed(reviewed, { now: NOW_W1 });
      expect(res.errors).toEqual([]);
    });
  }

  it('(iii) budgie ACTIVE·노출 가능(합성 승격) + X01 집합 없는 cp-parrot-budgie → X01 careProfileId(fail-closed)', () => {
    expect(Object.prototype.hasOwnProperty.call(REQUIRED_ITEMS_BY_PROFILE, 'cp-parrot-budgie')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(REQUIRED_ITEMS_BY_PROFILE, 'cp-parrot-cockatiel')).toBe(false);
    const s = active('budgie');
    const src = structuredClone(row(s, 'animalTypes', 'hamster-golden').source);
    // 형식만 채우는 합성값(V07·V04 통과용) — 앵무 사실이 아니다. 디스크 시드는 그대로.
    const at = row(s, 'animalTypes', 'budgie');
    verify(at, 'EXPERIENCED_KEEPER');
    at.source = structuredClone(src);
    const cp = row(s, 'careProfiles', 'cp-parrot-budgie');
    verify(cp, 'EXPERIENCED_KEEPER');
    Object.assign(cp, { facts: structuredClone(row(s, 'careProfiles', 'cp-hamster-dwarf').facts), careNotes: ['합성 시험 문장이다.'], source: structuredClone(src) });
    const item = row(s, 'supplyItems', 'bird-cage');
    verify(item, 'EXPERIENCED_KEEPER');
    item.source = structuredClone(src);
    const req = structuredClone(row(s, 'supplyRequirements', 'req-dwarf-cage'));
    Object.assign(req, {
      id: 'req-synth-bird-cage',
      careProfileId: 'cp-parrot-budgie',
      supplyItemId: 'bird-cage',
      priority: 'REQUIRED',
      notNowReason: null,
      minSpec: { rules: [{ key: 'heightCm', op: 'gte', value: 111, reason: '합성 규칙이다.' }] },
      recommendedSpec: { rules: [] },
      source: structuredClone(src),
    });
    verify(req, 'EXPERIENCED_KEEPER');
    (s.supplyRequirements as Rec[]).push(req);
    const res = validateSeed(s, { now: NOW_W1 });
    // 게이트가 실제로 돌았는지(구조·참조 오류 0) — 남는 ERROR 는 X01(집합 없음) · X02(앵무 Taxon 미검수)뿐.
    expect(res.errors.filter((i) => i.rule !== 'X01' && i.rule !== 'X02')).toEqual([]);
    expect(errs(res, 'X01').filter((i) => i.id === 'budgie').map((i) => i.path)).toEqual(['careProfileId']);
    expect(errs(res, 'X02').filter((i) => i.id === 'budgie').map((i) => i.path)).toEqual(['taxonId']);
  });

  it('실시드(디스크): 새 타입 3은 PLANNED → X01·X02 대상 아님(ERROR 0)', () => {
    const res = validateSeed(fresh(), { now: NOW_W1 });
    expect(res.errors).toEqual([]);
    for (const id of ['budgie', 'cockatiel', 'hamster-robo']) expect([id, row(fresh(), 'animalTypes', id).status]).toEqual([id, 'PLANNED']);
  });
});
