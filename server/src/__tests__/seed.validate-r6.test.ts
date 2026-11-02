// R6 B2(SEC-5 I-2) — S10: 엔티티 id·참조 키가 저장 금지 키(shared/forbidden-keys.ts) 또는 JS 프로토타입 속성명이면 ERROR.
//   실제 server/seed 를 깊은 복사해 메모리에만 주입한다(시드 사실 불변).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSeedDirRaw } from '../seed/read.js';
import { validateSeed } from '../seed/validate.js';
import { PROTO_KEYS, reservedIdProblem } from '../seed/validate-structure.js';
import { FORBIDDEN_KEY_LIST } from '../shared/forbidden-keys.js';
import type { RawSeed, Rec, SeedKey } from '../seed/common.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = '2026-11-03';
const BASE: RawSeed = readSeedDirRaw(SEED_DIR).raw;

const fresh = (): Required<RawSeed> => structuredClone(BASE) as Required<RawSeed>;

function row(s: RawSeed, key: SeedKey, id: string): Rec {
  const r = (s[key] ?? []).find((x) => (x as Rec).id === id);
  if (!r) throw new Error(`fixture: ${key}#${id} 없음`);
  return r as Rec;
}

function s10(s: RawSeed): Array<{ file: string; path: string }> {
  return validateSeed(s, { now: NOW }).errors.filter((i) => i.rule === 'S10').map((i) => ({ file: i.file, path: i.path }));
}

describe('S10 reservedIdProblem', () => {
  it('금지 키 전부·프로토타입 속성명 → 문제, 대소문자 무시', () => {
    for (const k of FORBIDDEN_KEY_LIST) {
      expect(reservedIdProblem(k)).not.toBeNull();
      expect(reservedIdProblem(k.toUpperCase())).not.toBeNull();
    }
    for (const k of PROTO_KEYS) expect(reservedIdProblem(k)).not.toBeNull();
    expect(reservedIdProblem('Constructor')).not.toBeNull();
  });

  it('정확 일치만 — 부분 문자열·kebab 확장은 통과, 비문자열은 무시', () => {
    for (const ok of ['quote', 'ip-camera', 'region-map', 'cage', 'hamster-golden', 'constructors', 'proto']) {
      expect(reservedIdProblem(ok)).toBeNull();
    }
    expect(reservedIdProblem(null)).toBeNull();
    expect(reservedIdProblem(42)).toBeNull();
  });
});

describe('S10 seed:validate', () => {
  it('실제 시드: S10 0, errors 0', () => {
    const res = validateSeed(BASE, { now: NOW });
    expect(res.errors).toEqual([]);
    expect(s10(BASE)).toEqual([]);
  });

  const cases: Array<{ name: string; inject: (s: Required<RawSeed>) => void; file: string; path: string }> = [
    { name: '행 id = 금지 키(region)', inject: (s) => { row(s, 'supplyItems', 'cage').id = 'region'; }, file: 'supply-items.json', path: 'id' },
    { name: '행 id = constructor(kebab 통과형)', inject: (s) => { row(s, 'taxa', 'mesocricetus-auratus').id = 'constructor'; }, file: 'taxa.json', path: 'id' },
    { name: '행 id = __proto__', inject: (s) => { row(s, 'setupBundles', 'sb-syrian-budget').id = '__proto__'; }, file: 'setup-bundles.json', path: 'id' },
    { name: '행 id = prototype', inject: (s) => { row(s, 'animalTypes', 'hamster-dwarf').id = 'prototype'; }, file: 'animal-types.json', path: 'id' },
    { name: 'SLOT 행 id = 금지 키(ip)', inject: (s) => { row(s, 'vetClinics', 'vc-mapo-01').id = 'ip'; }, file: 'vet-clinics.json', path: 'id' },
    { name: '참조 문자열(careProfileId = token)', inject: (s) => { row(s, 'supplyRequirements', 'req-syrian-cage').careProfileId = 'token'; }, file: 'supply-requirements.json', path: 'careProfileId' },
    { name: '참조 배열(itemIds 에 prototype)', inject: (s) => { (row(s, 'setupBundles', 'sb-syrian-budget').itemIds as string[]).push('prototype'); }, file: 'setup-bundles.json', path: 'itemIds' },
    { name: '병원 treats 에 q', inject: (s) => { row(s, 'vetClinics', 'vc-mapo-02').treats = ['q']; }, file: 'vet-clinics.json', path: 'treats[0]' },
    { name: '사진 slot = search', inject: (s) => { row(s, 'photos', 'ph-01').slot = 'search'; }, file: 'photos.json', path: 'slot' },
    {
      name: 'careOverrides.requirements 맵 키 = __proto__(JSON.parse 자기 속성)',
      inject: (s) => { row(s, 'animalTypes', 'hamster-golden').careOverrides = JSON.parse('{"requirements":{"__proto__":{}}}') as Rec; },
      file: 'animal-types.json',
      path: 'careOverrides.requirements.__proto__',
    },
  ];

  for (const c of cases) {
    it(`${c.name} → S10 ERROR`, () => {
      const s = fresh();
      c.inject(s);
      const hits = s10(s);
      expect(hits.some((h) => h.file === c.file && (h.path === c.path || h.path.startsWith(`${c.path}[`)))).toBe(true);
    });
  }

  it('부분 일치 id(ip-camera)는 S10 없음', () => {
    const s = fresh();
    row(s, 'photos', 'ph-01').slot = 'ip-camera';
    expect(s10(s)).toEqual([]);
  });
});

// 다동물 감사 54 M6 — R01b·R07b·P03b. 주입은 메모리 복사본에만, 합성 id(fixture-*)는 자리표시이며 사실값이 아니다.
const issuesOf = (s: RawSeed, rule: string) => {
  const res = validateSeed(s, { now: NOW });
  return {
    errors: res.errors.filter((i) => i.rule === rule).map((i) => `${i.id}|${i.path}`),
    warnings: res.warnings.filter((i) => i.rule === rule).map((i) => `${i.id}|${i.path}`),
    allErrors: res.errors.map((i) => i.rule),
  };
};
const clone = <T,>(v: T): T => structuredClone(v);

describe('M6 R01b — ACTIVE AnimalType.taxonId ∈ CareProfile.taxonIds (K-1 안 A)', () => {
  /** 합성 taxon(골든 taxon 복제, id 와 학명만 바꿈 — 학명 유일 R11 과 겹치지 않게 합성 학명). */
  const addTaxon = (s: Required<RawSeed>, id: string) => {
    s.taxa.push({ ...clone(row(s, 'taxa', 'mesocricetus-auratus')), id, scientificName: `Fixtura ${id.replace(/[^a-z]/g, '')}` } as Rec);
  };

  it('실제 시드: R01b 0', () => {
    expect(issuesOf(BASE, 'R01b')).toEqual({ errors: [], warnings: [], allErrors: [] });
  });

  it('FAIL: 대표 종이 프로필 taxonIds 밖 → ERROR', () => {
    const s = fresh();
    addTaxon(s, 'fixture-taxon-b');
    row(s, 'animalTypes', 'hamster-golden').taxonId = 'fixture-taxon-b';
    const r = issuesOf(s, 'R01b');
    expect(r.errors).toEqual(['hamster-golden|taxonId']);
    expect(r.allErrors).toEqual(['R01b']);
  });

  it('PASS: 프로필 taxonIds 가 여러 종(K-1)이고 대표 종이 그중 하나 → 0', () => {
    const s = fresh();
    addTaxon(s, 'fixture-taxon-b');
    (row(s, 'careProfiles', 'cp-hamster-syrian').taxonIds as string[]).push('fixture-taxon-b');
    row(s, 'animalTypes', 'hamster-golden').taxonId = 'fixture-taxon-b';
    // R01b 는 0. 합성 학명은 법 게이트 허용 (taxonId, 학명) 쌍 밖이라 X02 만 남는다 — 271 R11·쌍 규칙이 의도한 동작(학명 복제로 X02 우회 불가).
    expect(issuesOf(s, 'R01b')).toEqual({ errors: [], warnings: [], allErrors: ['X02'] });
  });

  it('PASS: ACTIVE 아닌(PLANNED) 타입은 검사 안 함', () => {
    const s = fresh();
    addTaxon(s, 'fixture-taxon-b');
    Object.assign(row(s, 'animalTypes', 'hamster-dwarf'), { taxonId: 'fixture-taxon-b', careProfileId: 'cp-hamster-syrian' });
    expect(issuesOf(s, 'R01b').errors).toEqual([]);
  });
});

describe('M6 R07b — careProfileId 없는 호환 규칙(동물명 문구 ERROR · 단측 expr WARN)', () => {
  const rules = (s: RawSeed, id: string) => row(s, 'compatibilityRules', id).rules as Array<Record<string, unknown>>;

  it('실제 시드(M5 후): R07b 0', () => {
    expect(issuesOf(BASE, 'R07b')).toEqual({ errors: [], warnings: [], allErrors: [] });
  });

  // BE92: 범위 없는 규칙(cr-wheel-cage·cr-water-cage)·cr-tubes-cage 삭제(85 근거 없음) → 실시드에 범위 없는 규칙이 없다.
  //   범위 있는 실시드 규칙의 careProfileId 를 메모리에서 지워 같은 경로를 검사한다(단측 = cr-dwarf-tubes-cage, 양측 = cr-syrian-wheel-cage-bedding).
  const ONE = 'cr-dwarf-tubes-cage';
  const TWO = 'cr-syrian-wheel-cage-bedding';

  it('FAIL: cr-dwarf-tubes-cage 범위 제거 + 문구에 동물명(드워프햄스터) → ERROR + a.* 단측 WARN', () => {
    const s = fresh();
    delete row(s, 'compatibilityRules', ONE).careProfileId;
    rules(s, ONE)[0].message = '드워프햄스터는 터널 안쪽 폭을 확인해요.';
    const r = issuesOf(s, 'R07b');
    expect(r.errors).toEqual([`${ONE}|rules[0].message`]);
    expect(r.warnings).toEqual([`${ONE}|rules`]);
    expect(r.allErrors).toEqual(['R07b']);
  });

  it('WARN 만: 범위 없음 + 중립 문구 + 단측 expr', () => {
    const s = fresh();
    delete row(s, 'compatibilityRules', ONE).careProfileId;
    rules(s, ONE)[0].message = '튜브 안쪽이 좁으면 낄 수 있어요.';
    const r = issuesOf(s, 'R07b');
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([`${ONE}|rules`]);
  });

  it('ERROR 만: 양측 expr 규칙 문구에 PLANNED 동물 별칭(드햄) → ERROR, 단측 WARN 없음', () => {
    const s = fresh();
    delete row(s, 'compatibilityRules', TWO).careProfileId;
    rules(s, TWO)[0].message = '베딩을 깊게 깔면 쳇바퀴 위가 닿을 수 있어요. 드햄';
    const r = issuesOf(s, 'R07b');
    expect(r.errors).toEqual([`${TWO}|rules[0].message`]);
    expect(r.warnings).toEqual([]);
  });

  it('ERROR: 별칭 대소문자 무시(Syrian Hamster)', () => {
    const s = fresh();
    delete row(s, 'compatibilityRules', TWO).careProfileId;
    rules(s, TWO)[0].message = 'Syrian Hamster 는 베딩을 깊게 깔아요.';
    expect(issuesOf(s, 'R07b').errors).toEqual([`${TWO}|rules[0].message`]);
  });

  it('PASS: careProfileId 가 있으면 문구에 동물명·단측 expr 이어도 0', () => {
    const s = fresh();
    rules(s, TWO)[0].expr = 'a.diameterCm >= 27';
    rules(s, TWO)[0].message = '골든햄스터 쳇바퀴가 작아요.';
    expect(issuesOf(s, 'R07b')).toEqual({ errors: [], warnings: [], allErrors: [] });
  });
});

describe('M6 P03b — 다프로필 상품의 프로필별 판정 불일치 WARN', () => {
  /** 합성 두 번째 프로필 + cage 요구사항(골든 행 복제, minSpec floorWcm 만 자리표시값으로 조정 가능). */
  const addProfileB = (s: Required<RawSeed>, floorW: number | null) => {
    s.careProfiles.push({ ...clone(row(s, 'careProfiles', 'cp-hamster-syrian')), id: 'cp-fixture-b' } as Rec);
    const req = { ...clone(row(s, 'supplyRequirements', 'req-syrian-cage')), id: 'req-fixture-b-cage', careProfileId: 'cp-fixture-b' } as Rec;
    if (floorW !== null) {
      const ms = req.minSpec as { rules: Array<Record<string, unknown>> };
      for (const r of ms.rules) if (r.key === 'floorWcm') r.value = floorW;
    }
    s.supplyRequirements.push(req);
  };
  const reviewCp004 = (s: Required<RawSeed>, meetsMinSpec: boolean) => {
    Object.assign(row(s, 'curatedProducts', 'cp-004'), {
      status: 'REVIEW', title: '상품 A', meetsMinSpec, careProfileIds: ['cp-hamster-syrian', 'cp-fixture-b'],
    });
  };

  it('실제 시드: P03b 0', () => {
    expect(issuesOf(BASE, 'P03b')).toEqual({ errors: [], warnings: [], allErrors: [] });
  });

  it('WARN: 골든 충족·B 미달(AND=false, P01 일치) → P03b 1, 오류 0', () => {
    const s = fresh();
    addProfileB(s, 101); // cp-004 floorWcm 100(BE92 목표 규격) → B 에서만 미달
    reviewCp004(s, false);
    const r = issuesOf(s, 'P03b');
    expect(r.warnings).toEqual(['cp-004|careProfileIds']);
    expect(r.allErrors).toEqual([]);
  });

  it('PASS: 두 프로필 판정 같음(둘 다 충족) → 0', () => {
    const s = fresh();
    addProfileB(s, null);
    reviewCp004(s, true);
    expect(issuesOf(s, 'P03b')).toEqual({ errors: [], warnings: [], allErrors: [] });
  });

  it('PASS: 단일 프로필 상품은 검사 안 함', () => {
    const s = fresh();
    addProfileB(s, 101);
    Object.assign(row(s, 'curatedProducts', 'cp-004'), { status: 'REVIEW', title: '상품 A', meetsMinSpec: false, careProfileIds: ['cp-fixture-b'] });
    expect(issuesOf(s, 'P03b').warnings).toEqual([]);
  });
});
