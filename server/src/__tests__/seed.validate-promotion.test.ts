// R7 A3 — 승격 무결성: S03 학명 빈 문자열 금지(DRAFT 포함) · V06 VERIFIED Taxon 학명·legal boolean · V07 VERIFIED CareProfile facts 키·careNotes.
//   실제 server/seed 를 깊은 복사해 메모리에서만 주입한다(시드 사실은 바꾸지 않는다).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSeedDirRaw } from '../seed/read.js';
import { validateSeed, type ValidateResult } from '../seed/validate.js';
import { CARE_FACT_KEYS, CARE_FACT_KEYS_SOURCE } from '../seed/validate-promotion.js';
import type { RawSeed, Rec, SeedKey } from '../seed/common.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = '2026-10-01';
const BASE: RawSeed = readSeedDirRaw(SEED_DIR).raw;

const TAXON = 'mesocricetus-auratus';
const CP = 'cp-hamster-syrian';

function fresh(): Required<RawSeed> {
  return structuredClone(BASE) as Required<RawSeed>;
}
function row(s: RawSeed, key: SeedKey, id: string): Rec {
  const r = (s[key] ?? []).find((x) => (x as Rec).id === id);
  if (!r) throw new Error(`fixture: ${key}#${id} 없음`);
  return r as Rec;
}
function verify(r: Rec, reviewerType: string): void {
  r.reviewStatus = 'VERIFIED';
  r.reviewerType = reviewerType;
  r.verifiedBy = 'reviewer-handle';
  r.verifiedAt = '2026-09-30';
}
const run = (s: RawSeed): ValidateResult => validateSeed(s, { now: NOW, strict: false });
const errs = (r: ValidateResult, rule: string): ValidateResult['errors'] => r.errors.filter((i) => i.rule === rule);

function verifiedTaxon(): Required<RawSeed> {
  const s = fresh();
  verify(row(s, 'taxa', TAXON), 'OFFICIAL_SOURCE');
  return s;
}
function verifiedCare(): Required<RawSeed> {
  const s = fresh();
  verify(row(s, 'careProfiles', CP), 'EXPERIENCED_KEEPER');
  return s;
}

describe('seed:validate — 승격 무결성(R7 A3)', () => {
  it('실시드: errors 0 · warnings 14 · V06/V07 0건(현재 VERIFIED 0)', () => {
    const res = run(fresh());
    expect(res.errors).toEqual([]);
    expect(res.warnings).toHaveLength(14);
    expect(res.errors.concat(res.warnings).filter((i) => i.rule === 'V06' || i.rule === 'V07')).toEqual([]);
  });

  it('실시드 골든 Taxon 학명은 이미 비어 있지 않다', () => {
    expect(String(row(fresh(), 'taxa', TAXON).scientificName).trim().length).toBeGreaterThan(0);
  });

  it('S03: 빈 학명은 DRAFT 여도 ERROR (""·공백만)', () => {
    for (const v of ['', '   ']) {
      const s = fresh();
      const t = row(s, 'taxa', TAXON);
      expect(t.reviewStatus).toBe('DRAFT');
      t.scientificName = v;
      const res = run(s);
      expect(errs(res, 'S03').some((i) => i.id === TAXON && i.path === 'scientificName')).toBe(true);
    }
  });

  it('V06: VERIFIED Taxon legal.animalProtectionAct6 null → ERROR', () => {
    const s = verifiedTaxon();
    (row(s, 'taxa', TAXON).legal as Rec).animalProtectionAct6 = null;
    const v = errs(run(s), 'V06');
    expect(v.map((i) => i.path)).toEqual(['legal.animalProtectionAct6']);
  });

  it('V06: VERIFIED Taxon legal.cites 누락 → ERROR', () => {
    const s = verifiedTaxon();
    delete (row(s, 'taxa', TAXON).legal as Rec).cites;
    expect(errs(run(s), 'V06').map((i) => i.path)).toEqual(['legal.cites']);
  });

  it('V06: VERIFIED Taxon 빈 학명 → V06(+ S03)', () => {
    const s = verifiedTaxon();
    row(s, 'taxa', TAXON).scientificName = '';
    const res = run(s);
    expect(errs(res, 'V06').map((i) => i.path)).toEqual(['scientificName']);
    expect(errs(res, 'S03').some((i) => i.path === 'scientificName')).toBe(true);
  });

  it('V06: designatedWildlifeWhitelist null 은 허용(골든 관례)', () => {
    const s = verifiedTaxon();
    expect((row(s, 'taxa', TAXON).legal as Rec).designatedWildlifeWhitelist).toBeNull();
    expect(errs(run(s), 'V06')).toEqual([]);
  });

  it('V06: DRAFT Taxon 은 legal null 이어도 V06 대상 아님', () => {
    const s = fresh();
    (row(s, 'taxa', TAXON).legal as Rec).cites = null;
    expect(errs(run(s), 'V06')).toEqual([]);
  });

  it('V07: 키 기준은 골든 6키이고 출처를 밝힌다', () => {
    expect([...CARE_FACT_KEYS]).toEqual(['social', 'activity', 'adultLengthCm', 'tempC', 'humidityPct', 'lifespanYears']);
    expect(CARE_FACT_KEYS_SOURCE).toMatch(/golden-seed/);
    expect(Object.keys(row(fresh(), 'careProfiles', CP).facts as Rec).sort()).toEqual([...CARE_FACT_KEYS].sort());
  });

  it('V07: VERIFIED CareProfile facts 키 누락 → ERROR(키마다)', () => {
    const s = verifiedCare();
    const facts = row(s, 'careProfiles', CP).facts as Rec;
    delete facts.tempC;
    facts.lifespanYears = null;
    expect(errs(run(s), 'V07').map((i) => i.path).sort()).toEqual(['facts.lifespanYears', 'facts.tempC']);
  });

  it('V07: VERIFIED CareProfile careNotes [] → ERROR', () => {
    const s = verifiedCare();
    row(s, 'careProfiles', CP).careNotes = [];
    expect(errs(run(s), 'V07').map((i) => i.path)).toEqual(['careNotes']);
  });

  it('V07: DRAFT CareProfile 은 careNotes [] 여도 V07 대상 아님', () => {
    const s = fresh();
    row(s, 'careProfiles', CP).careNotes = [];
    expect(errs(run(s), 'V07')).toEqual([]);
  });

  it('정상 VERIFIED Taxon + CareProfile 은 V06·V07 없이 통과(errors 0)', () => {
    const s = fresh();
    verify(row(s, 'taxa', TAXON), 'OFFICIAL_SOURCE');
    verify(row(s, 'careProfiles', CP), 'EXPERIENCED_KEEPER');
    const res = run(s);
    expect(res.errors).toEqual([]);
  });
});
