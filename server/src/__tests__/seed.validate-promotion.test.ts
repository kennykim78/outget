// R7 A3 — 승격 무결성: S03 학명 빈 문자열 금지(DRAFT 포함) · V06 VERIFIED Taxon 학명·legal 형태(280: 불리언 필수 아님) · V07 VERIFIED CareProfile facts 키·careNotes.
//   실제 server/seed 를 깊은 복사해 메모리에서만 주입한다(시드 사실은 바꾸지 않는다).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSeedDirRaw } from '../seed/read.js';
import { unsignRaw } from './fixtures/prerender-seed.js';
import { validateSeed, type ValidateResult } from '../seed/validate.js';
import { CARE_FACT_KEYS, CARE_FACT_KEYS_SOURCE } from '../seed/validate-promotion.js';
import type { RawSeed, Rec, SeedKey } from '../seed/common.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = '2026-11-23'; // 356: 6종 GENERAL_INFO draftedAt(2026-11-23) 이상 — S07 미래 날짜 방지. // 팁 references checkedAt(2026-11-22) 이상 · 실서명일(2026-11-16) 이상 — 디스크 verifiedAt S07 방지(옛 값 2026-11-03, 277: 출처 접근일 2026-11-02 이상)
/** 디스크 시드 그대로(2026-11-16 확인표 5종 서명 후). */
const DISK_READ = readSeedDirRaw(SEED_DIR);
const DISK: RawSeed = DISK_READ.raw;
/** 규칙 주입 바탕 = 서명 전 기준(4 패킷 미서명, 메모리 — 주입 시험 의미 보존). */
const BASE: RawSeed = unsignRaw(DISK);

const TAXON = 'mesocricetus-auratus';
const CP = 'cp-hamster-syrian';

function fresh(): Required<RawSeed> {
  return structuredClone(BASE) as Required<RawSeed>;
}
/** 디스크 시드 사본(서명 후 상태 그대로 — 실시드 시험용). */
const disk = (): Required<RawSeed> => structuredClone(DISK) as Required<RawSeed>;
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
  r.reviewBasis = 'ROW_CHECKED';
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
  it('실시드: errors 0 · warnings 19(서명 전 20) · V06/V07 0건(R7-B: cp-hamster-dwarf VERIFIED — facts·careNotes 3 통과, Taxon VERIFIED 0; BE90 사료 caution 2문장 L03 +1; BE92 골든 초안 편집 −3; 기니피그 S3 W-RULESCOPED +6; S7 기니피그 Taxon note L03 +1 · S8 playpen floorType W-RULESCOPED +1 · S9 기니피그 요구사항 W-RULESCOPED −6 · cage caution(Kenny 확정 2문장) L03 +1 · 저빌(126) Taxon note L03 +1 · 2026-11-15 UNIT_RE 「곳」 추가로 드워프 hideout why L03 −1 — seed.validate.test baseline 참고)', () => {
    // 2026-11-16 서명 후 디스크: 골든 노출로 W-EXPOSURE-ZERO 1 해소 → 18. 308: budget-tips 5행 W-TIP-CAT +1 → 19.
    const res = run(disk());
    expect(res.errors).toEqual([]);
    expect(res.warnings).toHaveLength(59); // 356 6종 활성화 → 59(seed.validate.test byRule). 이전: 315 총괄 11/22: W-TIP-SC 5 · W-TIP-VET 1 · 354 I07 1(빈 사진 칸 수)
    expect(res.warnings.filter((i) => i.rule === 'W-EXPOSURE-ZERO')).toEqual([]);
    expect(res.errors.concat(res.warnings).filter((i) => i.rule === 'V06' || i.rule === 'V07')).toEqual([]);
    const pre = run(fresh());
    expect(pre.errors).toEqual([]);
    expect(pre.warnings).toHaveLength(60); // 356 → 60(+W-EXPOSURE-ZERO). 이전: 354 I07 +1(빈 사진 칸 수). 315 W-TIP-SC 5 · W-TIP-VET 1.  308 W-TIP-CAT +1. 「곳」 단위 −1(hideout why). 271: bird-food.forSpecies W-RULESCOPED +1(앵무 요구사항 행 0 — 사실값 대기)
    expect(pre.errors.concat(pre.warnings).filter((i) => i.rule === 'V06' || i.rule === 'V07')).toEqual([]);
  });

  it('실시드 골든 Taxon 학명은 이미 비어 있지 않다', () => {
    expect(String(row(disk(), 'taxa', TAXON).scientificName).trim().length).toBeGreaterThan(0);
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

  // 280(Kenny ORDERS §47): 법 불리언은 정보용 메모 — VERIFIED Taxon 이라도 null·누락을 요구하지 않는다(공개 조건 아님).
  it('V06(280): VERIFIED Taxon legal 불리언 전부 null → V06 0 · errors 0', () => {
    const s = verifiedTaxon();
    Object.assign(row(s, 'taxa', TAXON).legal as Rec, { animalProtectionAct6: null, cites: null, designatedWildlifeWhitelist: null });
    const res = run(s);
    expect(errs(res, 'V06')).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  it('V06(280): VERIFIED Taxon legal 불리언 키 누락(빈 객체) → V06 0 · errors 0', () => {
    const s = verifiedTaxon();
    row(s, 'taxa', TAXON).legal = {};
    const res = run(s);
    expect(errs(res, 'V06')).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  it('V06(280): 형태만 본다 — legal.cites 가 문자열 "false" 면 V06(타입 오류)', () => {
    const s = verifiedTaxon();
    (row(s, 'taxa', TAXON).legal as Rec).cites = 'false';
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

  it('V07: 키 기준은 골든 5키이고 출처를 밝힌다(2026-10-25 Kenny: 골든 humidityPct 삭제 → 필수 키에서 제외)', () => {
    expect([...CARE_FACT_KEYS]).toEqual(['social', 'activity', 'adultLengthCm', 'tempC', 'lifespanYears']);
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
