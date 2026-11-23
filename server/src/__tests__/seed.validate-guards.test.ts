// R7-B 후속 방어 규칙(76): X01(QA 72 G-2 · K-B4) · V08(G-3) · R01 taxonId(L-1).
//   X02(법 상태 게이트)는 280 에서 제거(Kenny ORDERS §47) — 여기서는 「법 상태는 노출을 막지 않는다」를 반대 단언으로 고정한다.
//   실시드는 디스크 그대로 읽고, 위반은 메모리 사본에만 주입한다(디스크 시드 사실 불변).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalog, isAnimalTypeExposable, isTaxonExposable, listResolvedRequirements, type SeedBundle } from '../engine/index.js';
import { SEED_FILES, asSeedBundle, type RawSeed, type Rec, type SeedKey } from '../seed/common.js';
import { readSeedDirRaw } from '../seed/read.js';
import { isDomesticDomain } from '../seed/validate-review.js';
import * as gates from '../seed/validate-gates.js';
import { REQUIRED_ITEMS_BY_PROFILE, speciesOf } from '../seed/validate-gates.js';
import { validateSeed, type ValidateResult } from '../seed/validate.js';
import { DWARF_PREVIEW_AS_OF, FIXTURE_AS_OF, SECOND, dwarfPreview, promoted, promotedTwo, unsignRaw } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = '2026-11-22'; // 팁 references checkedAt(2026-11-22) 이상 · 실서명일(2026-11-16) 이상 — 디스크 verifiedAt S07 방지(옛 값 2026-11-03, 277: 출처 접근일 2026-11-02 이상)
/** 디스크 시드 그대로(2026-11-16 확인표 5종 서명 후). */
const DISK_READ = readSeedDirRaw(SEED_DIR);
const DISK: RawSeed = DISK_READ.raw;
/** 규칙 주입 바탕 = 서명 전 기준(4 패킷 미서명, 메모리 — 주입 시험 의미 보존). */
const BASE = unsignRaw(DISK);
const fresh = (): Required<RawSeed> => structuredClone(BASE) as Required<RawSeed>;
/** 디스크 시드 사본(서명 후 상태 그대로 — 실시드 시험용). */
const disk = (): Required<RawSeed> => structuredClone(DISK) as Required<RawSeed>;
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
  it('server/seed(서명 후, 매니페스트 포함): X01·V08·R01 ERROR 0 · X02 없음(280 제거) — 골든 ACTIVE 노출(필수 6 VERIFIED, 사료 VET_PUBLISHED_SOURCE·국내 출처), 2026-11-23 활성화로 드워프·기니피그도 ACTIVE 노출(X01 0), 저빌 PLANNED', () => {
    const res = validateSeed(disk(), { now: NOW, signatures: DISK_READ.signatures });
    expect(res.errors).toEqual([]);
    for (const rule of ['X01', 'X02', 'V08', 'R01']) expect(errs(res, rule)).toEqual([]);
    expect(res.summary.types).toBe(3);
  });
  it('서명 전 기준(메모리): 같은 규칙 ERROR 0 (골든 ACTIVE 비노출)', () => {
    const res = validateSeed(fresh(), { now: NOW });
    expect(res.errors).toEqual([]);
    for (const rule of ['X01', 'X02', 'V08', 'R01']) expect(errs(res, rule)).toEqual([]);
    expect(res.summary.types).toBe(0);
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
    // 280: 법 게이트 X02 제거 — Taxon 법 값과 무관하게 X02 는 나지 않는다.
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
    // 308: budget-tips 의 hideout 팁도 참조 정리(V-TIP-0 「요구사항 없음」) — 행만 깔끔히 지운 경우.
    s.budgetTips = ((s.budgetTips ?? []) as Rec[]).filter((t) => t.supplyItemId !== 'hideout');
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

describe('기니피그 ACTIVE 전 게이트(QA118 X01 — X02 는 280 에서 제거)', () => {
  it('X01 집합: cp-guineapig = cage·food·water·bedding·hideout·hay(쳇바퀴 없음), 동결', () => {
    expect([...REQUIRED_ITEMS_BY_PROFILE['cp-guineapig']].sort()).toEqual(GP_FIXED);
    expect(REQUIRED_ITEMS_BY_PROFILE['cp-guineapig']).not.toContain('wheel');
    expect(Object.isFrozen(REQUIRED_ITEMS_BY_PROFILE['cp-guineapig'])).toBe(true);
  });

  it('실시드 16행이 집합을 충족: 각 항목에 cp-guineapig 요구사항 행이 있고 priority REQUIRED(해석 전·후)', () => {
    const rows = (DISK.supplyRequirements as Rec[]).filter((r) => r.careProfileId === 'cp-guineapig');
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

  it('메모리 ACTIVE + REQUIRED 체인 VERIFIED → X01 0(기니피그) · 미검수 Taxon 이어도 기니피그 ERROR 0(280)', () => {
    const res = validateSeed(guineaPigActive(), { now: NOW });
    expect(errs(res, 'X01').filter((i) => i.id === 'guinea-pig')).toEqual([]);
    expect(res.errors.filter((i) => i.id === 'guinea-pig')).toEqual([]);
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

  it('280: 기니피그 ACTIVE + 미검수 Taxon legal 변형(cites true · 전부 null) → 기니피그 ERROR 0(법 상태는 노출 조건 아님)', () => {
    for (const p of [{ cites: true }, { animalProtectionAct6: null, cites: null, designatedWildlifeWhitelist: null }]) {
      const s = guineaPigActive();
      Object.assign(row(s, 'taxa', 'cavia-porcellus').legal as Rec, p);
      const res = validateSeed(s, { now: NOW });
      expect([p, res.errors.filter((i) => i.id === 'guinea-pig' || i.id === 'cavia-porcellus')]).toEqual([p, []]);
      expect([p, isAnimalTypeExposable(createCatalog(asSeedBundle(s)), 'guinea-pig', NOW)]).toEqual([p, true]);
    }
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
  // 사료(FOOD) 행: 104 는 국내(.kr) 수의 출처를 찾지 못했다 → 디스크 행은 VERIFIED 가 되면 V08. 게이트(X01)만 보려고
  //   메모리 사본에만 자리표시 국내 출처를 붙인다(실제 출처 아님 — 디스크·패킷에는 없음, ACTIVE 전 보강 필요는 확인표 D).
  const food = row(s, 'supplyRequirements', 'req-gerbil-food');
  food.source = [...(food.source as Rec[]), { url: 'https://fixture.example.kr/gerbil-food', title: '픽스처 국내 출처(메모리 전용)', accessedAt: '2026-10-27' }];
  return s;
};
const gerbilX = (s: RawSeed, rule: string) => errs(validateSeed(s, { now: NOW }), rule).filter((i) => i.id === 'gerbil-mongolian');

describe('저빌 ACTIVE 전 게이트(126 S2 — X01 sand-bath · X02 는 280 에서 제거)', () => {
  it('디스크(2026-11-16 서명 후): gerbil-mongolian PLANNED·VERIFIED(EXPERIENCED_KEEPER·C 일괄) · Taxon meriones-unguiculatus VERIFIED·OFFICIAL_SOURCE(행 확인) · legal act6 false/cites false/화이트리스트 null', () => {
    const at = row(DISK, 'animalTypes', 'gerbil-mongolian');
    expect([at.status, at.taxonId, at.careProfileId, at.reviewStatus, at.reviewerType, at.verifiedBy, at.verifiedAt, at.reviewBasis]).toEqual(['PLANNED', 'meriones-unguiculatus', 'cp-gerbil-mongolian', 'VERIFIED', 'EXPERIENCED_KEEPER', 'kenny', '2026-11-16', 'AI_RESEARCH_BULK']);
    const t = row(DISK, 'taxa', 'meriones-unguiculatus');
    expect([t.reviewStatus, t.reviewerType, t.verifiedBy, t.verifiedAt, t.reviewBasis]).toEqual(['VERIFIED', 'OFFICIAL_SOURCE', 'kenny', '2026-11-16', 'ROW_CHECKED']);
    expect(t.legal).toMatchObject({ animalProtectionAct6: false, cites: false, designatedWildlifeWhitelist: null });
    // 서명 전 기준(메모리)은 DRAFT·AI_DRAFT — 아래 주입 시험의 바탕.
    expect([row(BASE, 'animalTypes', 'gerbil-mongolian').reviewStatus, row(BASE, 'taxa', 'meriones-unguiculatus').reviewerType]).toEqual(['DRAFT', 'AI_DRAFT']);
    expect(t.legal).toMatchObject({ animalProtectionAct6: false, cites: false, designatedWildlifeWhitelist: null });
  });

  it('X01 집합: cp-gerbil-mongolian = cage·food·water·bedding·hideout·sand-bath(쳇바퀴·건초 없음), 동결', () => {
    expect([...REQUIRED_ITEMS_BY_PROFILE['cp-gerbil-mongolian']].sort()).toEqual(GB_FIXED);
    expect(REQUIRED_ITEMS_BY_PROFILE['cp-gerbil-mongolian']).not.toContain('wheel');
    expect(REQUIRED_ITEMS_BY_PROFILE['cp-gerbil-mongolian']).not.toContain('hay');
    expect(Object.isFrozen(REQUIRED_ITEMS_BY_PROFILE['cp-gerbil-mongolian'])).toBe(true);
  });

  it('실시드 14행이 집합을 충족: 각 항목 행 있음·REQUIRED(해석 전·후), wheel 은 RECOMMENDED', () => {
    const rows = (DISK.supplyRequirements as Rec[]).filter((r) => r.careProfileId === 'cp-gerbil-mongolian');
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

  it('(a·b) 메모리 ACTIVE + REQUIRED 체인 VERIFIED, 미검수 Taxon act6 false(디스크) / null → X01 0 · 저빌 ERROR 0', () => {
    expect(gerbilX(gerbilActive(), 'X01')).toEqual([]);
    expect(gerbilX(gerbilActive(), 'X02')).toEqual([]);
    const s = gerbilActive();
    (row(s, 'taxa', 'meriones-unguiculatus').legal as Rec).animalProtectionAct6 = null;
    expect(gerbilX(s, 'X02')).toEqual([]);
    expect(validateSeed(s, { now: NOW }).errors.filter((i) => i.id === 'gerbil-mongolian')).toEqual([]);
  });

  // 280: 예전 X02 차단 사례 — 이제 전부 통과(법 상태·학명은 공개 조건 아님). 남는 차단은 X01·검수뿐.
  const x02Cases: Array<[string, (t: Rec) => void]> = [
    ['(c) act6 true', (t) => ((t.legal as Rec).animalProtectionAct6 = true)],
    ['(d) cites true', (t) => ((t.legal as Rec).cites = true)],
    ['화이트리스트 true', (t) => ((t.legal as Rec).designatedWildlifeWhitelist = true)],
    ['act6 키 누락', (t) => delete (t.legal as Rec).animalProtectionAct6],
    ['(e) 허용목록 밖 속 Pachyuromys duprasi(펫테일저빌)', (t) => (t.scientificName = 'Pachyuromys duprasi')],
    ['같은 속 다른 종 Meriones crassus', (t) => (t.scientificName = 'Meriones crassus')],
  ];
  for (const [name, mutate] of x02Cases) {
    it(`280: 저빌 ACTIVE + 미검수 Taxon ${name} → ERROR 0 · 노출 유지`, () => {
      const s = gerbilActive();
      mutate(row(s, 'taxa', 'meriones-unguiculatus'));
      expect(validateSeed(s, { now: NOW }).errors).toEqual([]);
      expect(isAnimalTypeExposable(createCatalog(asSeedBundle(s)), 'gerbil-mongolian', NOW)).toBe(true);
    });
  }

  it('legal null → 구조 단계(S — legal 은 객체 형태여야 함, 법 게이트 아님)에서 ERROR', () => {
    const s = gerbilActive();
    row(s, 'taxa', 'meriones-unguiculatus').legal = null;
    const e = validateSeed(s, { now: NOW }).errors.filter((i) => i.id === 'meriones-unguiculatus');
    expect(e.length).toBeGreaterThan(0);
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

  it('PLANNED(디스크) 저빌 — Taxon cites true 주입해도 ERROR 0 · 비노출(PLANNED)', () => {
    const s = fresh();
    (row(s, 'taxa', 'meriones-unguiculatus').legal as Rec).cites = true;
    expect(validateSeed(s, { now: NOW }).errors).toEqual([]);
    expect(isAnimalTypeExposable(createCatalog(asSeedBundle(s)), 'gerbil-mongolian', NOW)).toBe(false);
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

  it('DRAFT FOOD 는 대상 아님(서명 전 기준 req-dwarf-food·req-syrian-food DRAFT) / 디스크(서명 후)는 FOOD 4행 VERIFIED·VET_PUBLISHED_SOURCE 인데 국내 출처가 있어 V08 0', () => {
    expect(errs(validateSeed(fresh(), { now: NOW }), 'V08')).toEqual([]);
    const food = (DISK.supplyRequirements as Rec[]).filter((r) => r.contentKind === 'FOOD' && r.reviewStatus === 'VERIFIED');
    expect(food.map((r) => [r.id, r.reviewerType]).sort()).toEqual([['req-dwarf-food', 'VET_PUBLISHED_SOURCE'], ['req-guineapig-food', 'VET_PUBLISHED_SOURCE'], ['req-guineapig-hay', 'VET_PUBLISHED_SOURCE'], ['req-syrian-food', 'VET_PUBLISHED_SOURCE']]);
    expect(errs(validateSeed(disk(), { now: NOW }), 'V08')).toEqual([]);
  });
});

describe('280 — 법 상태는 노출을 막지 않는다(X02 제거, Kenny ORDERS §47)', () => {
  // 위드스몰은 분양·양도·매칭을 하지 않는다(decisions.md 「10-27」) → Taxon.legal 은 정보용 메모. 공개를 막는 것은 검수뿐.
  const anyX02 = (res: ValidateResult) => res.errors.concat(res.warnings).filter((i) => i.rule === 'X02');

  it('validate-gates.ts 공개 API = X01 집합 · checkPublishGates · speciesOf(R11 용) — 법 허용목록·판정 함수 없음', () => {
    expect(Object.keys(gates).sort()).toEqual(['REQUIRED_ITEMS_BY_PROFILE', 'checkPublishGates', 'speciesOf']);
  });

  it('speciesOf(R11 학명 유일 키): 종 앞 두 단어 · 아종·명명자 무시 · 교잡·형식 밖은 null', () => {
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

  it('Taxon.legal 데이터는 정보용으로 남아 있다(지우지 않음) — 디스크 Taxon 전부 legal 객체', () => {
    for (const t of DISK.taxa as Rec[]) expect([t.id, typeof t.legal, t.legal === null]).toEqual([t.id, 'object', false]);
  });

  const legalVariants: Array<[string, Rec]> = [
    ['전부 null(중립)', { animalProtectionAct6: null, cites: null, designatedWildlifeWhitelist: null }],
    ['cites true', { cites: true }],
    ['act6 false(6종 밖)', { animalProtectionAct6: false }],
    ['화이트리스트 true', { designatedWildlifeWhitelist: true }],
    ['act6·cites·화이트리스트 모두 true', { animalProtectionAct6: true, cites: true, designatedWildlifeWhitelist: true }],
  ];
  for (const [name, p] of legalVariants) {
    it(`ACTIVE 골든 + 미검수(DRAFT·AI_DRAFT) Taxon legal ${name} → ERROR 0 · X02 0`, () => {
      const s = fresh();
      const t = row(s, 'taxa', 'mesocricetus-auratus');
      expect([t.reviewStatus, t.reviewerType]).toEqual(['DRAFT', 'AI_DRAFT']);
      Object.assign(t.legal as Rec, p);
      const res = validateSeed(s, { now: NOW });
      expect(res.errors).toEqual([]);
      expect(anyX02(res)).toEqual([]);
    });
  }

  it('legal 빈 객체({} — 키 전부 누락) + 미검수 Taxon + ACTIVE 골든 → ERROR 0', () => {
    const s = fresh();
    row(s, 'taxa', 'mesocricetus-auratus').legal = {};
    expect(validateSeed(s, { now: NOW }).errors).toEqual([]);
  });

  for (const sci of ['Psittacula krameri', 'Cavia aperea', 'Mesocricetus brandti', 'Pachyuromys duprasi']) {
    it(`예전 허용목록 밖 학명(${sci}) + 미검수 Taxon + ACTIVE 골든 → ERROR 0(학명은 법 게이트가 아니다)`, () => {
      const s = fresh();
      row(s, 'taxa', 'mesocricetus-auratus').scientificName = sci;
      expect(validateSeed(s, { now: NOW }).errors).toEqual([]);
    });
  }

  it('R11(학명 유일)은 유지 — 다른 Taxon 행의 학명 복제 → R11 · 아종 꼬리만 다른 같은 종도 중복', () => {
    const s = fresh();
    row(s, 'taxa', 'mesocricetus-auratus').scientificName = 'Meriones unguiculatus';
    const res = validateSeed(s, { now: NOW });
    expect(res.errors.map((i) => `${i.rule} ${i.id} ${i.path}`)).toEqual(['R11 meriones-unguiculatus scientificName']);
    const s2 = fresh();
    row(s2, 'taxa', 'phodopus-campbelli').scientificName = 'Phodopus sungorus sungorus';
    expect(errs(validateSeed(s2, { now: NOW }), 'R11').map((i) => i.id)).toEqual(['phodopus-campbelli']);
  });

  it('예전 허용 쌍(taxonId, 학명) 규칙 없음 — 학명을 다른 행으로 옮겨도(중복 없음) ERROR 0', () => {
    const s = fresh();
    row(s, 'taxa', 'meriones-unguiculatus').scientificName = 'Meriones crassus';
    row(s, 'taxa', 'mesocricetus-auratus').scientificName = 'Meriones unguiculatus';
    expect(validateSeed(s, { now: NOW }).errors).toEqual([]);
  });

  it('VERIFIED Taxon 만료(+181일) + 법 값 무관 → X02 0(만료는 Taxon 내용 비노출일 뿐, 타입 공개 조건 아님)', () => {
    const s = fresh();
    const t = row(s, 'taxa', 'mesocricetus-auratus');
    (t.legal as Rec).cites = true;
    verify(t, 'OFFICIAL_SOURCE');
    t.verifiedAt = '2026-04-20';
    const res = validateSeed(s, { now: NOW });
    expect(anyX02(res)).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  it('남는 차단은 검수뿐: 노출 골든(픽스처) + Taxon DRAFT·AI_DRAFT·legal 전부 null → 타입 노출 · Taxon 내용 비노출 · ERROR 0', () => {
    const s = rawOf(promoted({ publishable: true }));
    const t = row(s, 'taxa', 'mesocricetus-auratus');
    Object.assign(t, { reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, reviewBasis: null });
    Object.assign(t.legal as Rec, { animalProtectionAct6: null, cites: null, designatedWildlifeWhitelist: null });
    expect(validateSeed(s, { now: FIXTURE_AS_OF }).errors).toEqual([]);
    const cat = createCatalog(asSeedBundle(s));
    expect(isAnimalTypeExposable(cat, 'hamster-golden', FIXTURE_AS_OF)).toBe(true);
    expect(isTaxonExposable(cat, 'mesocricetus-auratus', FIXTURE_AS_OF)).toBe(false); // 불변식 7: 미검수 Taxon 내용은 싣지 않는다
  });

  it('남는 차단은 검수뿐: 같은 상태에서 필수 요구사항(water)을 DRAFT(AI_DRAFT)로 → X01 · AnimalType 을 DRAFT 로 → 비노출', () => {
    const base = rawOf(promoted({ publishable: true }));
    Object.assign(row(base, 'taxa', 'mesocricetus-auratus').legal as Rec, { animalProtectionAct6: null, cites: null, designatedWildlifeWhitelist: null });
    const a = structuredClone(base);
    Object.assign(row(a, 'supplyRequirements', 'req-syrian-water'), { reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, reviewBasis: null });
    expect(validateSeed(a, { now: FIXTURE_AS_OF }).errors.map((i) => `${i.rule} ${i.path}`)).toEqual(['X01 requirements.water']);
    const b = structuredClone(base);
    Object.assign(row(b, 'animalTypes', 'hamster-golden'), { reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, reviewBasis: null });
    expect(isAnimalTypeExposable(createCatalog(asSeedBundle(b)), 'hamster-golden', FIXTURE_AS_OF)).toBe(false);
  });

  it('불변식 7 유지: AI_DRAFT Taxon 을 VERIFIED 로 → V01(법 값과 무관)', () => {
    const s = fresh();
    const t = row(s, 'taxa', 'mesocricetus-auratus');
    Object.assign(t, { reviewStatus: 'VERIFIED', verifiedBy: 'reviewer-handle', verifiedAt: '2026-09-30', reviewBasis: 'ROW_CHECKED' });
    expect(t.reviewerType).toBe('AI_DRAFT');
    expect(errs(validateSeed(s, { now: NOW }), 'V01').map((i) => i.id)).toContain('mesocricetus-auratus');
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

describe('271 1차 종 — 로보·앵무: 법 게이트 없음(280) · 공개 차단은 검수(노출 판정·X01·R01)뿐 · 앵무 X01 fail-closed', () => {
  // 위반·승격은 메모리 사본에만. NOW_W1 = 작업일(271) — 308: budget-tips checkedAt 2026-11-22 가 미래(S07)가 되지 않게 11-02→11-22(시드 checkedAt 은 그대로).
  const NOW_W1 = '2026-11-22';
  /**
   * 354b(356 ⑦ 충돌 H): 앵무(PARROT) 자리는 장면 행(햄스터 사진)으로 메우지 않는다 — ACTIVE 앵무는 종 단위 사진 행이 없으면 I06.
   *   이 묶음은 법·검수 게이트를 보는 시험이라, 앵무를 올릴 때 종 자리 3개의 빈 사진 행(SLOT)을 메모리에서 함께 둔다.
   *   (사진 자리 규칙 자체는 engine.photo-ai.test.ts 「I06(356 ⑦ 충돌 H)」.)
   */
  const parrotPhotoSlots = (s: Required<RawSeed>, typeId: string): void => {
    const rows: Array<[string, Rec]> = [
      ...(['habitat', 'now-lead', 'spec'] as const).map((use): [string, Rec] => [`ph-${typeId}-${use}`, { use, animalTypeId: typeId }]),
    ];
    for (const [id, scope] of rows) {
      (s.photos as Rec[]).push({ id, scene: '합성 빈 자리', query: id, slot: id, status: 'SLOT', license: null, source: null, sourceUrl: null, author: null, licenseUrl: null, downloadedAt: null, modified: false, scope });
    }
  };
  const active = (typeId: string): Required<RawSeed> => {
    const s = fresh();
    const at = row(s, 'animalTypes', typeId);
    at.status = 'ACTIVE';
    if (at.group === 'PARROT') parrotPhotoSlots(s, typeId);
    return s;
  };
  const exposable = (s: RawSeed, typeId: string): boolean => isAnimalTypeExposable(createCatalog(asSeedBundle(s)), typeId, NOW_W1);
  /** 로보 ACTIVE(메모리): 디스크는 careProfileId null(271 보안 MED #2 — 드워프 프로필과 분리)이라 R01 을 피하려 메모리에서만 드워프 프로필에 잇는다. */
  const roboActive = (legal?: Rec): Required<RawSeed> => {
    const s = active('hamster-robo');
    row(s, 'animalTypes', 'hamster-robo').careProfileId = 'cp-hamster-dwarf';
    (row(s, 'careProfiles', 'cp-hamster-dwarf').taxonIds as string[]).push('phodopus-roborovskii');
    if (legal) Object.assign(row(s, 'taxa', 'phodopus-roborovskii').legal as Rec, legal);
    return s;
  };

  it('(i) 디스크: 로보는 드워프 프로필과 분리(careProfileId null · cp-hamster-dwarf.taxonIds 에 없음) · 별칭 유지 · legal 정보용 메모 그대로(act6 null·cites false·화이트리스트 null)', () => {
    const s = disk();
    const at = row(s, 'animalTypes', 'hamster-robo');
    expect([at.status, at.careProfileId, at.aliases]).toEqual(['PLANNED', null, ['로보', '로보로브스키']]);
    expect(row(s, 'careProfiles', 'cp-hamster-dwarf').taxonIds).toEqual(['phodopus-sungorus', 'phodopus-campbelli']);
    const t = row(s, 'taxa', 'phodopus-roborovskii');
    expect([t.reviewStatus, t.reviewerType]).toEqual(['DRAFT', 'AI_DRAFT']);
    // 277(271 보류분 적용): 1차 출처 접근일 2026-11-02. 280: legal 은 정보용 메모(지우지 않음) — 공개 조건 아님.
    expect(t.legal).toEqual({ animalProtectionAct6: null, cites: false, designatedWildlifeWhitelist: null, note: null });
    expect((t.source as Rec[]).map((x) => x.accessedAt)).toEqual(Array(5).fill('2026-11-02'));
    expect(t.verifiedBy).toBeNull();
    // 디스크 그대로 ACTIVE 로 올리면 careProfileId 가 없어 R01(공개 불가) — 데이터 연결 규칙(법 아님).
    expect(errs(validateSeed(active('hamster-robo'), { now: NOW_W1 }), 'R01').map((i) => `${i.id} ${i.path}`)).toContain('hamster-robo status');
  });

  it('(i) 로보 ACTIVE(메모리 연결): legal 값 무엇이든(디스크 null·드워프 선례값·act6 true/false) ERROR 0 · X02 0 — 타입 미검수라 비노출(검수가 유일한 차단)', () => {
    const dwarfLegal = { ...(row(fresh(), 'taxa', 'phodopus-sungorus').legal as Rec), note: null };
    for (const p of [undefined, dwarfLegal, { animalProtectionAct6: true, cites: false }, { animalProtectionAct6: false, cites: false }, { animalProtectionAct6: null, cites: null }]) {
      const s = roboActive(p);
      const res = validateSeed(s, { now: NOW_W1 });
      expect([p, res.errors]).toEqual([p, []]);
      expect([p, res.warnings.filter((i) => i.rule === 'X02')]).toEqual([p, []]);
      expect([p, exposable(s, 'hamster-robo')]).toEqual([p, false]); // AnimalType hamster-robo 미검수(DRAFT·AI_DRAFT)
    }
    expect(row(fresh(), 'animalTypes', 'hamster-robo').reviewStatus).not.toBe('VERIFIED');
  });

  it('(i) 271 LOW #5 회귀: budgie Taxon 행에 학명 Phodopus roborovskii 위조 → R11(학명 중복, 유지) · 원 행 개명 뒤 위조 → ERROR 0(허용 쌍 규칙 없음, 280)', () => {
    const s = active('budgie');
    Object.assign(row(s, 'taxa', 'melopsittacus-undulatus'), { scientificName: 'Phodopus roborovskii' });
    const res = validateSeed(s, { now: NOW_W1 });
    expect(errs(res, 'R11').map((i) => i.path)).toEqual(['scientificName']);
    const s2 = active('budgie');
    row(s2, 'taxa', 'phodopus-sungorus').scientificName = 'Phodopus przewalskii';
    Object.assign(row(s2, 'taxa', 'melopsittacus-undulatus'), { scientificName: 'Phodopus sungorus' });
    expect(validateSeed(s2, { now: NOW_W1 }).errors).toEqual([]);
  });

  for (const [typeId, taxonId] of [
    ['budgie', 'melopsittacus-undulatus'],
    ['cockatiel', 'nymphicus-hollandicus'],
  ] as const) {
    it(`(ii) 디스크: ${taxonId} DRAFT·AI_DRAFT · legal 정보용 메모 그대로(act6 false·cites false·화이트리스트 null) · 출처 4(접근일 2026-11-02, 277)`, () => {
      const t = row(disk(), 'taxa', taxonId);
      expect([t.reviewStatus, t.reviewerType, t.verifiedBy, t.verifiedAt]).toEqual(['DRAFT', 'AI_DRAFT', null, null]);
      expect(t.legal).toEqual({ animalProtectionAct6: false, cites: false, designatedWildlifeWhitelist: null, note: null });
      expect((t.source as Rec[]).map((x) => x.accessedAt)).toEqual(Array(4).fill('2026-11-02'));
    });
    it(`(ii) ${typeId} ACTIVE + DRAFT(AI_DRAFT) Taxon → ERROR 0 · X02 0(legal 값 무관) · 체인 미검수라 비노출 · Taxon VERIFIED(불리언 null)로도 ERROR 0`, () => {
      for (const p of [{}, { animalProtectionAct6: true, cites: false }, { animalProtectionAct6: null, cites: null, designatedWildlifeWhitelist: null }, { cites: true }]) {
        const s = active(typeId);
        Object.assign(row(s, 'taxa', taxonId).legal as Rec, p);
        const res = validateSeed(s, { now: NOW_W1 });
        expect([p, res.errors]).toEqual([p, []]);
        expect([p, exposable(s, typeId)]).toEqual([p, false]); // AnimalType·CareProfile 미검수 — 검수 전 공개 차단
      }
      // VERIFIED 경로: V04(출처)를 형식만 채운 합성값. legal 불리언은 null(280: V06 필수 아님).
      const reviewed = active(typeId);
      const tx = row(reviewed, 'taxa', taxonId);
      verify(tx, 'OFFICIAL_SOURCE');
      Object.assign(tx.legal as Rec, { animalProtectionAct6: null, cites: null });
      tx.source = structuredClone(row(reviewed, 'taxa', 'mesocricetus-auratus').source);
      expect(validateSeed(reviewed, { now: NOW_W1 }).errors).toEqual([]);
    });
  }

  // 356 M10: cp-parrot-small·medium 에 필수 집합이 생겼다 → X01 이 「집합 없음」 대신 빠진 필수 항목(perch·bird-food·water)을 보고.
  //   「집합 없음 → careProfileId」 fail-closed 는 cp-parrot-large(집합 없음)로 계속 지킨다(아래 첫 expect).
  it('(iii) budgie ACTIVE·노출 가능(합성 승격) + cp-parrot-small 필수 집합(356 M10) 중 bird-cage 만 → X01 빠진 필수 3 · Taxon 미검수여도 X02 0', () => {
    expect(Object.prototype.hasOwnProperty.call(REQUIRED_ITEMS_BY_PROFILE, 'cp-parrot-large')).toBe(false);
    expect(REQUIRED_ITEMS_BY_PROFILE['cp-parrot-small']).toEqual(['bird-cage', 'perch', 'bird-food', 'water']);
    expect(REQUIRED_ITEMS_BY_PROFILE['cp-parrot-medium']).toEqual(['bird-cage', 'perch', 'bird-food', 'water']);
    const s = active('budgie');
    const src = structuredClone(row(s, 'animalTypes', 'hamster-golden').source);
    // 형식만 채우는 합성값(V07·V04 통과용) — 앵무 사실이 아니다. 디스크 시드는 그대로.
    const at = row(s, 'animalTypes', 'budgie');
    verify(at, 'EXPERIENCED_KEEPER');
    at.source = structuredClone(src);
    const cp = row(s, 'careProfiles', 'cp-parrot-small');
    verify(cp, 'EXPERIENCED_KEEPER');
    Object.assign(cp, { facts: structuredClone(row(s, 'careProfiles', 'cp-hamster-dwarf').facts), careNotes: ['합성 시험 문장이다.'], source: structuredClone(src) });
    const item = row(s, 'supplyItems', 'bird-cage');
    verify(item, 'EXPERIENCED_KEEPER');
    item.source = structuredClone(src);
    const req = structuredClone(row(s, 'supplyRequirements', 'req-dwarf-cage'));
    Object.assign(req, {
      id: 'req-synth-bird-cage',
      careProfileId: 'cp-parrot-small',
      supplyItemId: 'bird-cage',
      priority: 'REQUIRED',
      notNowReason: null,
      minSpec: { rules: [{ key: 'heightCm', op: 'gte', value: 111, reason: '합성 규칙이다.' }] },
      recommendedSpec: { rules: [] },
      source: structuredClone(src),
    });
    verify(req, 'EXPERIENCED_KEEPER');
    (s.supplyRequirements as Rec[]).push(req);
    // 품목 자리(bird-cage)도 종 단위 빈 행 — 장면 대체 없음(354b). 종 자리 3개는 active() 가 이미 둠.
    (s.photos as Rec[]).push({ id: 'ph-budgie-bird-cage', scene: '합성 빈 자리', query: 'ph-budgie-bird-cage', slot: 'ph-budgie-bird-cage', status: 'SLOT', license: null, source: null, sourceUrl: null, author: null, licenseUrl: null, downloadedAt: null, modified: false, scope: { use: 'item', animalTypeId: 'budgie', supplyItemId: 'bird-cage' } });
    // 앵무 Taxon 은 DRAFT·AI_DRAFT 그대로 — 280 이전엔 X02 도 났다.
    expect(row(s, 'taxa', 'melopsittacus-undulatus').reviewStatus).toBe('DRAFT');
    expect(exposable(s, 'budgie')).toBe(true);
    const res = validateSeed(s, { now: NOW_W1 });
    expect(res.errors.map((i) => `${i.rule} ${i.id} ${i.path}`).sort()).toEqual([
      'X01 budgie requirements.bird-food',
      'X01 budgie requirements.perch',
      'X01 budgie requirements.water',
    ]);
  });

  it('실시드(디스크, 서명 후): 새 타입 3은 PLANNED·DRAFT(서명 대상 밖) → X01 대상 아님(ERROR 0)', () => {
    const res = validateSeed(disk(), { now: NOW, signatures: DISK_READ.signatures });
    expect(res.errors).toEqual([]);
    for (const id of ['budgie', 'cockatiel', 'hamster-robo']) expect([id, row(disk(), 'animalTypes', id).status, row(disk(), 'animalTypes', id).reviewStatus]).toEqual([id, 'PLANNED', 'DRAFT']);
    expect(validateSeed(fresh(), { now: NOW_W1 }).errors).toEqual([]);
  });
});
