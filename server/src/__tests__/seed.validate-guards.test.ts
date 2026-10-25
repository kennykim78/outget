// R7-B 후속 방어 규칙(76): X01(QA 72 G-2 · K-B4) · V08(G-3) · X02(보안 71 M-1) · R01 taxonId(L-1).
//   실시드는 디스크 그대로 읽고, 위반은 메모리 사본에만 주입한다(디스크 시드 사실 불변).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SeedBundle } from '../engine/index.js';
import { SEED_FILES, type RawSeed, type Rec, type SeedKey } from '../seed/common.js';
import { readSeedDirRaw } from '../seed/read.js';
import { isDomesticDomain } from '../seed/validate-review.js';
import { REQUIRED_ITEMS_BY_PROFILE, TRIVIAL_LEGAL_GENERA, genusOf, isLegalTrivial, isTaxonLegallyTrivial } from '../seed/validate-gates.js';
import { validateSeed, type ValidateResult } from '../seed/validate.js';
import { DWARF_PREVIEW_AS_OF, FIXTURE_AS_OF, SECOND, dwarfPreview, promoted, promotedTwo } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = '2026-10-24';
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

describe('실시드 — 새 규칙 오탐 0', () => {
  it('server/seed: X01·X02·V08·R01 ERROR 0 (골든 ACTIVE 비노출, 드워프 PLANNED)', () => {
    const res = validateSeed(fresh(), { now: NOW });
    expect(res.errors).toEqual([]);
    for (const rule of ['X01', 'X02', 'V08', 'R01']) expect(errs(res, rule)).toEqual([]);
  });
});

describe('X01 — 노출 타입의 REQUIRED 요구사항 비노출 금지(G-2, K-B4)', () => {
  it('드워프 ACTIVE(미리보기 상태) → X01 은 사료(req-dwarf-food, FOOD DRAFT) 1건만', () => {
    const res = validateSeed(rawOf(dwarfPreview()), { now: DWARF_PREVIEW_AS_OF });
    const x = errs(res, 'X01');
    expect(x.map((i) => `${i.id} ${i.path}`)).toEqual(['hamster-dwarf requirements.food']);
    expect(x[0].message).toContain('req-dwarf-food');
    // 드워프 Taxon 은 6종·CITES false·화이트리스트 null → X02 오탐 없음.
    expect(errs(res, 'X02')).toEqual([]);
  });

  it('M-1: careOverrides 로 DRAFT food 를 RECOMMENDED 로 낮춰도 X01(비검수 행 priority 는 보지 않음 — 우회 차단)', () => {
    const s = rawOf(dwarfPreview());
    row(s, 'animalTypes', 'hamster-dwarf').careOverrides = { requirements: { food: { priority: 'RECOMMENDED' } } };
    const x = errs(validateSeed(s, { now: DWARF_PREVIEW_AS_OF }), 'X01');
    expect(x.map((i) => `${i.id} ${i.path}`)).toEqual(['hamster-dwarf requirements.food']);
  });

  it('M-1: DRAFT 행 자체의 priority 를 NOT_NOW 로 낮춰도 X01', () => {
    const s = rawOf(dwarfPreview());
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
    expect(paths).toEqual(['requirements.bedding', 'requirements.food', 'requirements.food-bowl', 'requirements.hideout', 'requirements.water']);
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
    verify(row(two, 'supplyRequirements', 'req-syrian-food'), 'VET_PUBLISHED_SOURCE');
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

  it('M-2 genusOf·isTaxonLegallyTrivial: 허용목록 속(Mesocricetus·Phodopus) ∧ 불리언 자명만', () => {
    expect(TRIVIAL_LEGAL_GENERA).toEqual(['Mesocricetus', 'Phodopus']);
    expect(Object.isFrozen(TRIVIAL_LEGAL_GENERA)).toBe(true);
    expect(genusOf('Mesocricetus auratus')).toBe('Mesocricetus');
    expect(genusOf('Phodopus')).toBe('Phodopus');
    expect(genusOf('mesocricetus auratus')).toBeNull();
    expect(genusOf('Meso-cricetus auratus')).toBeNull();
    expect(genusOf(null)).toBeNull();
    const ok = { animalProtectionAct6: true, cites: false, designatedWildlifeWhitelist: null };
    expect(isTaxonLegallyTrivial({ scientificName: 'Phodopus sungorus', legal: ok })).toBe(true);
    expect(isTaxonLegallyTrivial({ scientificName: 'Mesocricetus auratus', legal: ok })).toBe(true);
    expect(isTaxonLegallyTrivial({ scientificName: 'Meriones unguiculatus', legal: ok })).toBe(false);
    expect(isTaxonLegallyTrivial({ scientificName: 'Mesocricetusx auratus', legal: ok })).toBe(false);
    expect(isTaxonLegallyTrivial({ scientificName: 'Phodopus sungorus', legal: { ...ok, cites: true } })).toBe(false);
  });

  for (const sci of ['Meriones unguiculatus', 'Melopsittacus undulatus', 'mesocricetus auratus']) {
    it(`M-2: 허용목록 밖 학명(${sci}) + 자명 불리언 + 미검수 Taxon → X02`, () => {
      const s = fresh();
      row(s, 'taxa', 'mesocricetus-auratus').scientificName = sci;
      const x = errs(validateSeed(s, { now: NOW }), 'X02');
      expect(x.map((i) => `${i.id} ${i.path}`)).toEqual(['hamster-golden taxonId']);
      expect(x[0].message).toContain('허용목록');
    });
  }

  it('M-2: 허용목록 밖이라도 Taxon VERIFIED(OFFICIAL_SOURCE) → X02 0', () => {
    const s = fresh();
    const t = row(s, 'taxa', 'mesocricetus-auratus');
    t.scientificName = 'Meriones unguiculatus';
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
