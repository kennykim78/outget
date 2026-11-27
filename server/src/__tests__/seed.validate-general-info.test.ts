// 356 M7~M10 — seed:validate 의 GENERAL_INFO(일반 참고 정보) 규칙.
//   M7 V12: 네 파일(animalTypes·careProfiles·supplyItems·supplyRequirements) 한정 · animalTypes 는 코드 고정 6종만 ·
//           verifiedBy·verifiedAt null · draftedAt 필수 · LEGAL 불가 · FOOD·HEALTH crossCheck 필수(draftedAt ≤ checkedAt) ·
//           draftedAt·crossCheck 는 GENERAL_INFO 행에만 · draftedAt 180일 초과 W-GENERAL-STALE.
//   M8 V07: GENERAL_INFO CareProfile 도 facts 5키·careNotes ≥1.
//   M9 S03·S07·S09: draftedAt(string|null)·crossCheck 형식·미래 날짜·네 파일 밖 키.
//   M10 X01: cp-hamster-robo·cp-parrot-small·cp-parrot-medium 필수 집합.
//   실시드는 메모리에서만 바꾼다. 주입 값은 시험 전용 자리표시(사육 사실 아님).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSeedDirRaw } from '../seed/read.js';
import { unsignRaw } from './fixtures/prerender-seed.js';
import { validateSeed, type ValidateResult } from '../seed/validate.js';
import { REQUIRED_ITEMS_BY_PROFILE } from '../seed/validate-gates.js';
import { SEED_FILES, type RawSeed, type Rec, type SeedKey } from '../seed/common.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = '2026-11-25'; // 356: 6종 GENERAL_INFO draftedAt(2026-11-23) 이상 — S07 미래 날짜 방지. // 368: 2026-11-25 = 8행 출처 접근일(S07 미래 날짜 방지, 옛 값 2026-11-23).
const DISK: RawSeed = readSeedDirRaw(SEED_DIR).raw;
const BASE: RawSeed = unsignRaw(DISK);
const DRAFTED = '2026-11-20';
const CC = { tool: 'CODEX_DISCUSS', checkedAt: '2026-11-21', result: 'AGREE' };

const fresh = (): Required<RawSeed> => structuredClone(BASE) as Required<RawSeed>;
const disk = (): Required<RawSeed> => structuredClone(DISK) as Required<RawSeed>;
function row(s: RawSeed, key: SeedKey, id: string): Rec {
  const r = (s[key] ?? []).find((x) => (x as Rec).id === id);
  if (!r) throw new Error(`fixture: ${key}#${id} 없음`);
  return r as Rec;
}
function gi(r: Rec, extra: Rec = {}): Rec {
  Object.assign(r, { reviewStatus: 'GENERAL_INFO', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, reviewBasis: null, draftedAt: DRAFTED }, extra);
  return r;
}
const run = (s: RawSeed): ValidateResult => validateSeed(s, { now: NOW, strict: false });
const errs = (r: ValidateResult, rule: string): ValidateResult['errors'] => r.errors.filter((i) => i.rule === rule);
const warns = (r: ValidateResult, rule: string): ValidateResult['warnings'] => r.warnings.filter((i) => i.rule === rule);
const at = (r: ValidateResult, rule: string, key: SeedKey, id: string, field?: string) =>
  r.errors.filter((i) => i.rule === rule && i.file === SEED_FILES[key] && i.id === id && (field === undefined || i.path === field));

describe('디스크 시드 — 356 6종 GENERAL_INFO 착지 후: 새 규칙 위반 0', () => {
  it('errors 0 · V12·W-GENERAL-STALE 0', () => {
    const res = run(disk());
    expect(res.errors).toEqual([]);
    expect(errs(res, 'V12')).toEqual([]);
    expect(warns(res, 'W-GENERAL-STALE')).toEqual([]);
  });
});

describe('M7 V12 — 허용', () => {
  it('6종 타입(PLANNED budgie)·사랑앵무 프로필(facts 채움)·앵무 용품·저빌 사료(FOOD+crossCheck) GENERAL_INFO → V12·S 오류 0', () => {
    const s = fresh();
    gi(row(s, 'animalTypes', 'budgie'));
    gi(row(s, 'careProfiles', 'cp-parrot-small'), {
      facts: { social: 'X', activity: 'X', adultLengthCm: 1, tempC: [1, 2], lifespanYears: [1, 2] },
      careNotes: ['자리표시'],
    });
    gi(row(s, 'supplyItems', 'bird-cage'));
    gi(row(s, 'supplyRequirements', 'req-gerbil-food'), { crossCheck: { ...CC } });
    const res = run(s);
    expect(errs(res, 'V12')).toEqual([]);
    expect(res.errors.filter((i) => /^S0[3479]$/.test(i.rule))).toEqual([]);
    expect(res.warnings.filter((i) => i.rule === 'S09' && ['draftedAt', 'crossCheck'].includes(i.path))).toEqual([]);
  });

  it('crossCheck 는 CARE 행에도 둘 수 있다(온도 수치 교차 확인) · result REVISED', () => {
    const s = fresh();
    gi(row(s, 'animalTypes', 'budgie'), { crossCheck: { ...CC, result: 'REVISED' } });
    expect(errs(run(s), 'V12')).toEqual([]);
  });
});

describe('M7 V12 — 거부', () => {
  it.each([
    ['taxa', 'melopsittacus-undulatus'],
    ['setupBundles', null],
    ['compatibilityRules', null],
    ['curatedProducts', null],
  ] as const)('GENERAL_INFO 가 %s 에 → V12', (key, id) => {
    const s = fresh();
    const r = (id ? row(s, key, id) : (s[key][0] as Rec)) as Rec;
    gi(r);
    expect(at(run(s), 'V12', key, r.id as string, 'reviewStatus').length).toBe(1);
  });

  it.each(['hamster-golden', 'hamster-dwarf', 'guinea-pig'])('6종 밖 animalType %s GENERAL_INFO → V12', (id) => {
    const s = fresh();
    gi(row(s, 'animalTypes', id));
    expect(at(run(s), 'V12', 'animalTypes', id, 'reviewStatus').length).toBe(1);
  });

  it.each([
    ['verifiedBy', 'kenny'],
    ['verifiedAt', '2026-11-20'],
  ])('%s 값 있음 → V12', (f, v) => {
    const s = fresh();
    gi(row(s, 'supplyItems', 'bird-cage'), { [f]: v });
    expect(at(run(s), 'V12', 'supplyItems', 'bird-cage', f).length).toBe(1);
  });

  it('reviewBasis 값 있음 → V09(비VERIFIED 는 null)', () => {
    const s = fresh();
    gi(row(s, 'supplyItems', 'bird-cage'), { reviewBasis: 'ROW_CHECKED' });
    expect(at(run(s), 'V09', 'supplyItems', 'bird-cage', 'reviewBasis').length).toBe(1);
  });

  it.each([[undefined], [null]])('draftedAt %s → V12', (v) => {
    const s = fresh();
    const r = gi(row(s, 'supplyItems', 'bird-cage'));
    if (v === undefined) delete r.draftedAt;
    else r.draftedAt = v;
    expect(at(run(s), 'V12', 'supplyItems', 'bird-cage', 'draftedAt').length).toBe(1);
  });

  it('FOOD 인데 crossCheck 없음 → V12', () => {
    const s = fresh();
    gi(row(s, 'supplyRequirements', 'req-gerbil-food'));
    delete row(s, 'supplyRequirements', 'req-gerbil-food').crossCheck; // 356: 디스크 행엔 crossCheck 가 있다
    expect(at(run(s), 'V12', 'supplyRequirements', 'req-gerbil-food', 'crossCheck').length).toBe(1);
  });

  it('HEALTH 인데 crossCheck null → V12', () => {
    const s = fresh();
    gi(row(s, 'supplyItems', 'scale'), { contentKind: 'HEALTH', crossCheck: null });
    expect(at(run(s), 'V12', 'supplyItems', 'scale', 'crossCheck').length).toBe(1);
  });

  it('crossCheck.checkedAt < draftedAt → V12', () => {
    const s = fresh();
    gi(row(s, 'supplyRequirements', 'req-gerbil-food'), { crossCheck: { ...CC, checkedAt: '2026-11-19' } });
    expect(at(run(s), 'V12', 'supplyRequirements', 'req-gerbil-food', 'crossCheck').length).toBe(1);
  });

  it.each([
    ['tool 다름', { ...CC, tool: 'GPT' }],
    ['result DISAGREE', { ...CC, result: 'DISAGREE' }],
    ['키 추가', { ...CC, by: 'x' }],
    ['checkedAt 없음', { tool: CC.tool, result: CC.result }],
    ['배열', [CC]],
  ])('crossCheck 형식 오류(%s) → S03', (_n, cc) => {
    const s = fresh();
    gi(row(s, 'supplyRequirements', 'req-gerbil-food'), { crossCheck: cc });
    expect(at(run(s), 'S03', 'supplyRequirements', 'req-gerbil-food', 'crossCheck').length).toBe(1);
  });

  it('draftedAt 형식 오류 → S07 · 타입 오류 → S03', () => {
    const s = fresh();
    gi(row(s, 'supplyItems', 'bird-cage'), { draftedAt: '2026-02-30' });
    gi(row(s, 'supplyItems', 'perch'), { draftedAt: 20261120 });
    const res = run(s);
    expect(at(res, 'S07', 'supplyItems', 'bird-cage', 'draftedAt').length).toBe(1);
    expect(at(res, 'S03', 'supplyItems', 'perch', 'draftedAt').length).toBe(1);
  });

  it('draftedAt·crossCheck.checkedAt 미래 → S07', () => {
    const s = fresh();
    gi(row(s, 'supplyItems', 'bird-cage'), { draftedAt: '2026-11-26' }); // NOW 다음 날
    gi(row(s, 'supplyRequirements', 'req-gerbil-food'), { crossCheck: { ...CC, checkedAt: '2026-11-30' } });
    const res = run(s);
    expect(at(res, 'S07', 'supplyItems', 'bird-cage', 'draftedAt').length).toBe(1);
    expect(at(res, 'S07', 'supplyRequirements', 'req-gerbil-food', 'crossCheck.checkedAt').length).toBe(1);
  });

  it('draftedAt·crossCheck 가 GENERAL_INFO 아닌 행에 → V12', () => {
    const s = fresh();
    row(s, 'supplyItems', 'cage').draftedAt = DRAFTED;
    row(s, 'supplyRequirements', 'req-gerbil-cage').crossCheck = { ...CC };
    const res = run(s);
    expect(at(res, 'V12', 'supplyItems', 'cage', 'draftedAt').length).toBe(1);
    expect(at(res, 'V12', 'supplyRequirements', 'req-gerbil-cage', 'crossCheck').length).toBe(1);
  });

  it('draftedAt 이 네 파일 밖(상품)에 → S08(허용목록) · 구성안 → V12', () => {
    const s = fresh();
    const p = s.curatedProducts[0] as Rec;
    p.draftedAt = DRAFTED;
    const b = s.setupBundles[0] as Rec;
    b.draftedAt = DRAFTED;
    const res = run(s);
    expect(at(res, 'S08', 'curatedProducts', p.id as string, 'draftedAt').length).toBe(1);
    expect(at(res, 'V12', 'setupBundles', b.id as string, 'draftedAt').length).toBe(1);
  });

  it('AI_DRAFT 는 여전히 VERIFIED 불가(V01) — GENERAL_INFO 경로와 무관', () => {
    const s = fresh();
    Object.assign(row(s, 'supplyItems', 'bird-cage'), { reviewStatus: 'VERIFIED', verifiedBy: 'kenny', verifiedAt: '2026-11-20', reviewBasis: 'ROW_CHECKED' });
    expect(at(run(s), 'V01', 'supplyItems', 'bird-cage').length).toBe(1);
  });

  it('draftedAt 181일 → W-GENERAL-STALE 경고(오류 아님)', () => {
    const s = fresh();
    gi(row(s, 'supplyItems', 'bird-cage'), { draftedAt: '2026-05-25' });
    const res = run(s);
    expect(errs(res, 'V12')).toEqual([]);
    expect(warns(res, 'W-GENERAL-STALE').filter((i) => i.id === 'bird-cage').length).toBe(1);
  });
});

describe('M8 V07 — GENERAL_INFO CareProfile 도 facts 5키·careNotes', () => {
  it('cp-parrot-small 빈 facts·careNotes → V07 6건', () => {
    const s = fresh();
    gi(row(s, 'careProfiles', 'cp-parrot-small'), { facts: {}, careNotes: [] }); // 356: 디스크엔 facts·careNotes 가 채워져 있다 — 메모리에서 비운다
    const v = at(run(s), 'V07', 'careProfiles', 'cp-parrot-small');
    expect(v.length).toBe(6);
  });
  it('DRAFT CareProfile 은 대상 아님(기존 동작)', () => {
    const s = fresh();
    Object.assign(row(s, 'careProfiles', 'cp-parrot-small'), { reviewStatus: 'DRAFT', facts: {}, careNotes: [] });
    delete row(s, 'careProfiles', 'cp-parrot-small').draftedAt;
    delete row(s, 'careProfiles', 'cp-parrot-small').crossCheck;
    expect(at(run(s), 'V07', 'careProfiles', 'cp-parrot-small')).toEqual([]);
  });
});

describe('M10 X01 — 6종 필수 집합(코드 고정)', () => {
  it('집합 정의: cp-hamster-robo·cp-parrot-small·cp-parrot-medium', () => {
    expect(REQUIRED_ITEMS_BY_PROFILE['cp-hamster-robo']).toEqual(['cage', 'food', 'water', 'bedding', 'hideout', 'wheel']);
    expect(REQUIRED_ITEMS_BY_PROFILE['cp-parrot-small']).toEqual(['bird-cage', 'perch', 'bird-food', 'water']);
    expect(REQUIRED_ITEMS_BY_PROFILE['cp-parrot-medium']).toEqual(['bird-cage', 'perch', 'bird-food', 'water']);
    expect(Object.isFrozen(REQUIRED_ITEMS_BY_PROFILE)).toBe(true);
  });

  it('사랑앵무 ACTIVE·GENERAL_INFO 체인에 bird-cage 요구사항만 → X01(perch·bird-food·water 빠짐)', () => {
    // 356: 디스크에 필수 4행이 있다 — 메모리에서 perch·bird-food·water 행(과 그 행 품목 사진 칸)만 뺀다.
    const s = disk();
    expect(row(s, 'animalTypes', 'budgie').status).toBe('ACTIVE');
    const drop = new Set(['perch', 'bird-food', 'water']);
    s.supplyRequirements = (s.supplyRequirements as Rec[]).filter((r) => !(r.careProfileId === 'cp-parrot-small' && drop.has(r.supplyItemId as string)));
    s.photos = (s.photos as Rec[]).filter((p) => {
      const sc = p.scope as Rec | null;
      return !(sc && sc.careProfileId === 'cp-parrot-small' && drop.has(sc.supplyItemId as string));
    });
    const res = run(s);
    const x = errs(res, 'X01').filter((i) => i.id === 'budgie');
    expect(x.map((i) => i.path).sort()).toEqual(['requirements.bird-food', 'requirements.perch', 'requirements.water']);
  });
});

describe('V12 출처 — GENERAL_INFO FOOD·HEALTH 는 출처 1곳 이상(Kenny 2026-11-25, 356r M3)', () => {
  const SRC = { url: 'https://example.org/placeholder', title: '자리표시', accessedAt: '2026-11-20' };
  it.each(['FOOD', 'HEALTH'])('%s 출처 0곳 → V12 source', (kind) => {
    const s = fresh();
    gi(row(s, 'supplyRequirements', 'req-gerbil-food'), { contentKind: kind, crossCheck: { ...CC }, source: [] });
    expect(at(run(s), 'V12', 'supplyRequirements', 'req-gerbil-food', 'source').length).toBe(1);
  });
  it.each([
    ['source 없음', undefined],
    ['url 없음', [{ title: SRC.title, accessedAt: SRC.accessedAt }]],
    ['http', [{ ...SRC, url: 'http://example.org/placeholder' }]],
    ['빈 url', [{ ...SRC, url: '' }]],
  ])('FOOD %s → V12 source', (_n, source) => {
    const s = fresh();
    const r = gi(row(s, 'supplyRequirements', 'req-gerbil-food'), { crossCheck: { ...CC } });
    if (source === undefined) delete r.source;
    else r.source = source;
    expect(at(run(s), 'V12', 'supplyRequirements', 'req-gerbil-food', 'source').length).toBe(1);
  });
  it('요구사항 밖 체인 파일(supplyItems HEALTH)도 같은 규칙', () => {
    const s = fresh();
    gi(row(s, 'supplyItems', 'scale'), { contentKind: 'HEALTH', crossCheck: { ...CC }, source: [] });
    expect(at(run(s), 'V12', 'supplyItems', 'scale', 'source').length).toBe(1);
  });
  it('출처 1곳이면 통과 · SPEC·CARE 는 출처 0곳이어도 대상 아님', () => {
    const s = fresh();
    gi(row(s, 'supplyRequirements', 'req-gerbil-food'), { crossCheck: { ...CC }, source: [SRC] });
    gi(row(s, 'supplyItems', 'bird-cage'), { source: [] });
    expect(errs(run(s), 'V12')).toEqual([]);
  });
  it('디스크 시드: GENERAL_INFO FOOD·HEALTH 전 행에 출처 1곳 이상', () => {
    const empty = (['animalTypes', 'careProfiles', 'supplyItems', 'supplyRequirements'] as const).flatMap((k) =>
      ((DISK[k] ?? []) as Rec[])
        .filter((r) => r.reviewStatus === 'GENERAL_INFO' && (r.contentKind === 'FOOD' || r.contentKind === 'HEALTH'))
        .filter((r) => !Array.isArray(r.source) || r.source.length === 0)
        .map((r) => r.id),
    );
    expect(empty).toEqual([]);
  });
});
