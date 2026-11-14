// D9 ② — whyShort 시드 검사: S03(타입·null 불허) · S08(SupplyItem 금지) · R03(override) · W01(6~30자·한 문장) ·
//   W02(원문에 없는 숫자·단위) · W03(첫 문장 중복 WARN) · W04(FOOD/HEALTH 첫 라운드 제외, K3) · L01(금지어) · V01(AI_DRAFT) · G05(서명 뒤 수정).
//   실시드는 디스크 그대로 읽고, 가짜 whyShort 는 메모리 사본에만 주입한다(실시드 파일 불변 — 콘텐츠는 Kenny 채택 뒤 별도 단계).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RawSeed, type Rec, type SeedKey } from '../seed/common.js';
import { readSeedDirRaw } from '../seed/read.js';
import { factHash } from '../seed/signatures.js';
import { validateSeed, type ValidateResult } from '../seed/validate.js';
import { graphemeLength, whyShortFormProblem, whyShortNumberProblems } from '../seed/validate-why-short.js';
import { DWARF_PREVIEW_AS_OF, dwarfSignedWith } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-11-03';
const BASE = readSeedDirRaw(join(here, '..', '..', 'seed')).raw;
const DRAFT_BASE = readSeedDirRaw(join(here, '..', '..', '..', 'docs', 'planning-artifacts', 'seed-draft')).raw;
const fresh = (): Required<RawSeed> => structuredClone(BASE) as Required<RawSeed>;
const row = (s: RawSeed, key: SeedKey, id: string): Rec => {
  const r = (s[key] ?? []).find((x) => (x as Rec).id === id);
  if (!r) throw new Error(`fixture: ${key}#${id} 없음`);
  return r as Rec;
};
const run = (s: RawSeed): ValidateResult => validateSeed(s, { now: NOW });
const of = (res: ValidateResult, rule: string, sev: 'errors' | 'warnings' = 'errors') => res[sev].filter((i) => i.rule === rule);
const W_RULES = ['W01', 'W02', 'W03', 'W04'];

/** 요구사항 1행에 whyShort 를 넣고 검사. */
function withShort(id: string, v: unknown, mut?: (s: Required<RawSeed>) => void): ValidateResult {
  const s = fresh();
  row(s, 'supplyRequirements', id).whyShort = v;
  mut?.(s);
  return run(s);
}

describe('실시드(코드 단계) — whyShort 0건, 새 규칙 오탐 0', () => {
  it('server/seed · seed-draft: whyShort 키 0, W01~W04 0, errors 0', () => {
    for (const raw of [BASE, DRAFT_BASE]) {
      expect((raw.supplyRequirements as Rec[]).filter((r) => Object.prototype.hasOwnProperty.call(r, 'whyShort'))).toEqual([]);
      const res = validateSeed(structuredClone(raw), { now: NOW });
      expect(res.errors).toEqual([]);
      for (const rule of W_RULES) expect([...of(res, rule), ...of(res, rule, 'warnings')]).toEqual([]);
    }
  });
});

describe('S03 · S08 · R03 — 소유 모델과 타입', () => {
  it('정상 whyShort(SPEC 행, 원문 숫자만) → errors 0', () => {
    expect(withShort('req-syrian-cage', '바닥을 넓게 쓰는 동물이라 넓어야 해요.').errors).toEqual([]);
    expect(withShort('req-syrian-cage', '철망 간격은 1cm 미만으로 봐요.').errors).toEqual([]);
    expect(withShort('req-syrian-cage', '가로는 몸길이의 2.5배 이상이에요.').errors).toEqual([]);
  });
  it('null → S03(null 불허 — 미작성은 키 생략)', () => {
    const res = withShort('req-syrian-cage', null);
    expect(of(res, 'S03').map((i) => i.path)).toEqual(['whyShort']);
  });
  it('문자열 아님 → S03', () => {
    expect(of(withShort('req-syrian-cage', 42), 'S03').map((i) => i.path)).toEqual(['whyShort']);
  });
  it('SupplyItem.whyShort → S08(동물 무관 모델에 이유 금지, 불변식 6)', () => {
    const s = fresh();
    row(s, 'supplyItems', 'cage').whyShort = '케이지 짧은 이유예요.';
    const res = run(s);
    expect(of(res, 'S08').map((i) => `${i.id} ${i.path}`)).toEqual(['cage whyShort']);
  });
  it('careOverrides whyShort: null·빈 문자열 → R03, 정상 문자열 → errors 0', () => {
    for (const [v, n] of [[null, 1], ['', 1], ['덮어쓴 짧은 이유예요.', 0]] as const) {
      const s = fresh();
      row(s, 'animalTypes', 'hamster-golden').careOverrides = { requirements: { cage: { whyShort: v } } };
      const res = run(s);
      expect(of(res, 'R03')).toHaveLength(n);
      if (n === 0) expect(res.errors).toEqual([]);
    }
  });
});

describe('W01 — 6~30자(grapheme)·한 문장·한 줄', () => {
  it('경계: 6자·30자 통과, 5자·31자 W01', () => {
    expect(graphemeLength('물이 필요.')).toBe(6);
    expect(withShort('req-syrian-water', '물이 필요.').errors).toEqual([]);
    expect(graphemeLength('가'.repeat(29) + '.')).toBe(30);
    expect(withShort('req-syrian-water', '가'.repeat(29) + '.').errors).toEqual([]);
    expect(graphemeLength('물 필요.')).toBe(5);
    expect(of(withShort('req-syrian-water', '물 필요.'), 'W01')).toHaveLength(1);
    const long = of(withShort('req-syrian-water', '가'.repeat(30) + '.'), 'W01');
    expect(long).toHaveLength(1);
    expect(long[0].message).toContain('31자');
  });
  it('두 문장·개행·앞뒤 공백 → W01', () => {
    expect(of(withShort('req-syrian-water', '물이 필요해요. 매일 봐요.'), 'W01')).toHaveLength(1);
    expect(of(withShort('req-syrian-water', '물이 필요해요\n매일 봐요'), 'W01')).toHaveLength(1);
    expect(of(withShort('req-syrian-water', ' 물이 꼭 필요해요.'), 'W01')).toHaveLength(1);
  });
  it('합성 이모지·결합 문자는 1자(grapheme)', () => {
    expect(graphemeLength('👨‍👩‍👧')).toBe(1);
    expect(whyShortFormProblem('👨‍👩‍👧가나다라.')).toBeNull();
  });
});

describe('W02 — 같은 행 원문에 없는 숫자·단위', () => {
  it('원문(why·caution)에 없는 숫자 → W02, 단위가 다르면 W02, 단위 없는 숫자 → W02', () => {
    expect(of(withShort('req-syrian-cage', '철망 간격은 2cm 미만으로 봐요.'), 'W02')).toHaveLength(1);
    expect(of(withShort('req-syrian-cage', '철망 간격은 1mm 미만으로 봐요.'), 'W02')).toHaveLength(1);
    const bare = of(withShort('req-syrian-cage', '가로는 몸길이 2.5 이상이에요.'), 'W02');
    expect(bare).toHaveLength(1);
    expect(bare[0].message).toContain('단위 없는');
  });
  it('notNowReason 도 원문이다(NOT_NOW 행)', () => {
    // 원문에 숫자가 없으니 어떤 숫자든 W02.
    expect(of(withShort('req-syrian-saucer', '쳇바퀴 뒤 1개 더 봐요.'), 'W02')).toHaveLength(1);
    expect(withShort('req-syrian-saucer', '쳇바퀴를 먼저 갖춰요.').errors).toEqual([]);
  });
  it('override: resolve 후 원문(override why) 기준', () => {
    const s = fresh();
    row(s, 'animalTypes', 'hamster-golden').careOverrides = {
      requirements: { water: { why: '물은 하루 2번 확인해요.', whyShort: '하루 2번 확인해요.' } },
    };
    expect(run(s).errors).toEqual([]);
    row(s, 'animalTypes', 'hamster-golden').careOverrides = { requirements: { water: { whyShort: '하루 3번 확인해요.' } } };
    const res = run(s);
    expect(of(res, 'W02').map((i) => i.path)).toEqual(['careOverrides.requirements.water.whyShort']);
  });
  it('순수 함수: 공백 차이는 무시', () => {
    expect(whyShortNumberProblems('60 × 40cm 이상이에요.', ['가로·세로 60×40 cm 이상'])).toEqual([]);
  });
  it('순수 함수: 토큰 단위 비교 — 부분 문자열로 통과하지 않는다, 묶음 구성 숫자는 같은 단위면 허용', () => {
    expect(whyShortNumberProblems('몸길이의 5배예요.', ['몸길이의 2.5배·2배 이상'])).toHaveLength(1);
    expect(whyShortNumberProblems('베딩 0cm 이상.', ['베딩을 20cm 이상'])).toHaveLength(1);
    expect(whyShortNumberProblems('가로 60cm 이상이에요.', ['가로·세로 60×40cm 이상'])).toEqual([]);
    expect(whyShortNumberProblems('가로 60mm 이상이에요.', ['가로·세로 60×40cm 이상'])).toHaveLength(1);
  });
});

describe('W03 · W04 · L01 — 중복·의료 인접·금지어', () => {
  it('whyShort = why 첫 문장 → W03 WARN(오류 아님)', () => {
    const res = withShort('req-syrian-water', '항상 신선한 물이 있어야 해요.');
    expect(res.errors).toEqual([]);
    expect(of(res, 'W03', 'warnings')).toHaveLength(1);
  });
  it('FOOD·HEALTH 행 → W04(K3 첫 라운드 제외)', () => {
    const food = of(withShort('req-syrian-food', '전용 주식이 꼭 있어야 해요.'), 'W04');
    expect(food.map((i) => i.id)).toEqual(['req-syrian-food']);
    expect(of(withShort('req-syrian-scale', '매주 체중을 재 두면 좋아요.'), 'W04').map((i) => i.id)).toEqual(['req-syrian-scale']);
  });
  it('금지어 → L01(why 와 같은 린트), 자리표시자 → L04', () => {
    const res = withShort('req-syrian-cage', '이 크기면 안전하다고 봐요.');
    expect(of(res, 'L01').map((i) => i.path)).toEqual(['whyShort']);
    expect(of(withShort('req-syrian-cage', 'TODO 짧은 이유'), 'L04').map((i) => i.path)).toEqual(['whyShort']);
  });
  it('override 금지어 → L01 경로 careOverrides…whyShort', () => {
    const s = fresh();
    row(s, 'animalTypes', 'hamster-golden').careOverrides = { requirements: { cage: { whyShort: '최저가 케이지면 돼요.' } } };
    expect(of(run(s), 'L01').map((i) => i.path)).toEqual(['careOverrides.requirements.cage.whyShort']);
  });
});

describe('V01 · G05 — 검수 메타는 행 것을 따른다', () => {
  it('AI_DRAFT 행에 whyShort 가 있어도 VERIFIED 불가(V01)', () => {
    const res = withShort('req-syrian-cage', '바닥을 넓게 쓰는 동물이라 넓어야 해요.', (s) => {
      Object.assign(row(s, 'supplyRequirements', 'req-syrian-cage'), {
        reviewStatus: 'VERIFIED',
        reviewerType: 'AI_DRAFT',
        verifiedBy: 'someone',
        verifiedAt: '2026-10-01',
        reviewBasis: 'ROW_CHECKED',
      });
    });
    expect(of(res, 'V01').map((i) => i.id)).toEqual(['req-syrian-cage']);
  });
  it('factHash: 키 없는 행은 불변, whyShort 추가 시 바뀐다', () => {
    const r = structuredClone(row(BASE, 'supplyRequirements', 'req-syrian-cage'));
    const h0 = factHash('supply-requirements.json', r);
    expect(factHash('supply-requirements.json', structuredClone(r))).toBe(h0);
    expect(factHash('supply-requirements.json', { ...r, whyShort: '바닥을 넓게 쓰는 동물이라 넓어야 해요.' })).not.toBe(h0);
  });
  it('서명 뒤 whyShort 추가 → G05(재서명 요구)', () => {
    const { seed, manifest } = dwarfSignedWith();
    const raw = structuredClone(seed) as unknown as RawSeed;
    const sig = { missing: false as const, data: structuredClone(manifest) };
    expect(validateSeed(raw, { now: DWARF_PREVIEW_AS_OF, signatures: sig }).errors).toEqual([]);
    row(raw, 'supplyRequirements', 'req-dwarf-cage').whyShort = '바닥이 넓고 높이가 필요해요.';
    const res = validateSeed(raw, { now: DWARF_PREVIEW_AS_OF, signatures: sig });
    expect([...new Set(res.errors.map((i) => i.rule))]).toEqual(['G05']);
    expect(of(res, 'G05').map((i) => i.id)).toEqual(['req-dwarf-cage']);
  });
});
