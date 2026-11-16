// D9 ② — whyShort 시드 검사: S03(타입·null 불허) · S08(SupplyItem 금지) · R03(override) · W01(6~30자·한 문장) ·
//   W02(원문에 없는 숫자·단위) · W03(첫 문장 중복 WARN) · W04(FOOD/HEALTH 첫 라운드 제외, K3) · L01(금지어) · V01(AI_DRAFT) · G05(서명 뒤 수정).
//   실시드는 디스크 그대로 읽고, 가짜 whyShort 는 메모리 사본에만 주입한다(실시드 파일 불변).
//   실시드 whyShort 17건 = Kenny 2026-11-15 채택분 14(ORDERS §14:0x 결정 2) + req-dwarf-hideout(총괄 14:1x 「곳」 셈 단위 판정 뒤 입력)
//   + req-dwarf-saucer(NOT_NOW, 재서술)·req-gerbil-thermo(원문 발췌)(Kenny 결정 뒤 PM 입력). 2026-11-16 확인표 5종 서명의 review 단계라
//   17행 전부 NEEDS_REVIEW(패킷 대상, VERIFIED 아님) — 공개 0.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RawSeed, type Rec, type SeedKey } from '../seed/common.js';
import { readSeedDirRaw } from '../seed/read.js';
import { factHash } from '../seed/signatures.js';
import { validateSeed, type ValidateResult } from '../seed/validate.js';
import { disguisedNumbers, numbersWithoutUnit, sentenceCount, strictSentenceCount } from '../seed/lint.js';
import { graphemeLength, whyShortFormProblem, whyShortNumberProblems } from '../seed/validate-why-short.js';
import { buildSite } from '../prerender/site.js';
import { REAL_AS_OF, baseOptions } from './fixtures/affiliate/baseline.js';
import { DWARF_PREVIEW_AS_OF, dwarfSignedWith, realSeed, realSignedTargets } from './fixtures/prerender-seed.js';

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

/** 2026-11-15 채택 whyShort 행(요구사항 17행 = 14 + hideout(「곳」 판정 뒤) + saucer·gerbil-thermo(PM 입력), override 0). 시드 파일 순서. */
const ADOPTED = [
  'req-syrian-wheel',
  'req-syrian-food-bowl',
  'req-dwarf-cage',
  'req-dwarf-wheel',
  'req-dwarf-saucer',
  'req-dwarf-bedding',
  'req-dwarf-hideout',
  'req-dwarf-sand-bath',
  'req-dwarf-sand-bath-box',
  'req-dwarf-carrier',
  'req-dwarf-thermo',
  'req-guineapig-playpen',
  'req-gerbil-cage',
  'req-gerbil-bedding',
  'req-gerbil-food-bowl',
  'req-gerbil-hideout',
  'req-gerbil-thermo',
];

describe('실시드 — whyShort 17건(Kenny 2026-11-15 채택 14 + 「곳」 판정 뒤 hideout + saucer·gerbil-thermo), 새 규칙 오탐 0, 공개 0(review 단계 NEEDS_REVIEW)', () => {
  it('server/seed · seed-draft: whyShort 17건(같은 값), W01~W04 0, errors 0', () => {
    const shorts = (raw: RawSeed): Array<[unknown, unknown]> =>
      (raw.supplyRequirements as Rec[]).filter((r) => Object.prototype.hasOwnProperty.call(r, 'whyShort')).map((r) => [r.id, r.whyShort]);
    expect(shorts(BASE).map(([id]) => id)).toEqual(ADOPTED);
    expect(shorts(DRAFT_BASE)).toEqual(shorts(BASE));
    for (const raw of [BASE, DRAFT_BASE]) {
      for (const a of raw.animalTypes as Rec[]) expect(JSON.stringify(a.careOverrides ?? null).includes('whyShort'), String(a.id)).toBe(false);
      const res = validateSeed(structuredClone(raw), { now: NOW });
      expect(res.errors).toEqual([]);
      for (const rule of W_RULES) expect([...of(res, rule), ...of(res, rule, 'warnings')]).toEqual([]);
    }
  });
  it('17행 전부 NEEDS_REVIEW(4 패킷 대상, 패킷/행 reviewerType, 검수자·날짜·basis null — VERIFIED 0) — 공개 산출물(프리렌더 전 파일)에 whyShort 키·값 0', () => {
    const targets = realSignedTargets();
    for (const id of ADOPTED) {
      const t = targets.get(`supply-requirements.json#${id}`);
      expect([id, t !== undefined]).toEqual([id, true]);
      expect(row(BASE, 'supplyRequirements', id)).toMatchObject({ reviewStatus: 'NEEDS_REVIEW', reviewerType: t?.reviewerType, verifiedBy: null, verifiedAt: null, reviewBasis: null });
    }
    const b = buildSite(realSeed(), baseOptions(REAL_AS_OF));
    const values = ADOPTED.map((id) => row(BASE, 'supplyRequirements', id).whyShort as string);
    for (const [f, c] of b.files) {
      expect(c.includes('whyShort'), f).toBe(false);
      for (const v of values) expect(c.includes(v), `${f} ⊃ ${v}`).toBe(false);
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
  it('총괄 2026-11-15: 「곳」은 셈 단위 — 원문의 「3곳」을 인용하면 통과, 「3」 단독은 여전히 W02', () => {
    expect(of(withShort('req-dwarf-hideout', '드워프에겐 숨을 곳이 적어도 3곳 필요해요.'), 'W02')).toEqual([]);
    expect(of(withShort('req-dwarf-hideout', '드워프에겐 숨을 곳이 적어도 3 필요해요.'), 'W02')).toHaveLength(1);
    expect(of(withShort('req-dwarf-hideout', '드워프에겐 숨을 곳이 적어도 4곳 필요해요.'), 'W02')).toHaveLength(1);
  });
  it('notNowReason 에만 있는 숫자를 whyShort 가 인용 → 통과(출처에서 notNowReason 을 빼면 W02 — 변이 고정)', () => {
    const setReason = (s: Required<RawSeed>) => {
      row(s, 'supplyRequirements', 'req-syrian-saucer').notNowReason = '쳇바퀴를 2주 먼저 써 본 뒤 고려해요.';
    };
    const ok = withShort('req-syrian-saucer', '쳇바퀴를 2주 먼저 써 봐요.', setReason);
    const saucer = row(BASE, 'supplyRequirements', 'req-syrian-saucer');
    expect(saucer.priority).toBe('NOT_NOW');
    // why·caution 에는 그 숫자가 없다 — notNowReason 만이 출처.
    expect(whyShortNumberProblems('쳇바퀴를 2주 먼저 써 봐요.', [saucer.why as string, saucer.caution as string | null])).toHaveLength(1);
    expect(of(ok, 'W02')).toEqual([]);
    expect(ok.errors).toEqual([]);
    // 같은 숫자라도 notNowReason 에 없으면 W02.
    expect(of(withShort('req-syrian-saucer', '쳇바퀴를 3주 먼저 써 봐요.', setReason), 'W02')).toHaveLength(1);
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
  it('Kenny 2026-11-16 결정 6: 범위 묶음(~ - – ～)은 단일 숫자 부분 일치 금지 — 범위 전체 일치만, 곱 묶음은 부분 일치 유지', () => {
    const SRC_T = ['온도는 18~26℃로 맞춰요.'];
    // (메시지 단위는 NFKC 뒤 값이라 ℃ → °C)
    expect(whyShortNumberProblems('온도는 18℃ 이상이에요.', SRC_T)).toEqual(['원문에 없는 숫자·단위 "18°C"']);
    expect(whyShortNumberProblems('온도는 26℃까지예요.', SRC_T)).toHaveLength(1);
    expect(whyShortNumberProblems('온도는 18~26℃로 맞춰요.', SRC_T)).toEqual([]);
    expect(whyShortNumberProblems('온도는 18 ~ 26℃로 맞춰요.', SRC_T)).toEqual([]);
    expect(whyShortNumberProblems('베딩은 15cm 이상이에요.', ['베딩은 15-20cm 깔아요.'])).toHaveLength(1);
    expect(whyShortNumberProblems('베딩은 20cm 깔아요.', ['베딩은 15–20cm 깔아요.'])).toHaveLength(1);
    expect(whyShortNumberProblems('베딩은 15-20cm 깔아요.', ['베딩은 15-20cm 깔아요.'])).toEqual([]);
    // 전각 물결은 NFKC 로 ~ — 원문 쪽 범위도 부분 일치 금지.
    expect(whyShortNumberProblems('온도는 18℃ 이상이에요.', [`온도는 18${String.fromCodePoint(0xff5e)}26℃로 맞춰요.`])).toHaveLength(1);
    // 같은 숫자가 원문에 단독으로도 있으면 그 토큰으로 통과(범위 규칙은 범위 묶음에서만 부분 일치를 끈다).
    expect(whyShortNumberProblems('온도는 18℃ 이상이에요.', ['18~26℃, 겨울엔 18℃ 이상'])).toEqual([]);
    // 곱 묶음 부분 일치 유지.
    expect(whyShortNumberProblems('가로 40cm 이상이에요.', ['가로·세로 60×40cm 이상'])).toEqual([]);
    expect(whyShortNumberProblems('가로 60cm 이상이에요.', ['가로·세로 60x40cm 이상'])).toEqual([]);
  });
  it('QA G1: 범위 구분자 〜(U+301C)·−(U+2212)·—(U+2014)도 범위 — 한쪽 숫자만 쓰면 W02, 전체 일치는 통과', () => {
    const wave = String.fromCodePoint(0x301c);
    const minus = String.fromCodePoint(0x2212);
    const em = String.fromCodePoint(0x2014);
    const T = (sep: string) => [`온도는 18${sep}26℃로 맞춰요.`];
    expect(whyShortNumberProblems('온도는 26℃까지예요.', T(wave))).toHaveLength(1);
    expect(whyShortNumberProblems('온도는 18℃ 이상이에요.', T(minus))).toHaveLength(1);
    expect(whyShortNumberProblems('온도는 26℃까지예요.', T(em))).toHaveLength(1);
    for (const sep of [wave, minus, em]) {
      expect(whyShortNumberProblems(`온도는 18${sep}26℃로 맞춰요.`, T(sep))).toEqual([]);
    }
  });
  it('결정 6 실시드: 숫자 whyShort 3행(req-dwarf-cage 20cm · req-dwarf-hideout 3곳 · req-gerbil-thermo 20~24℃) W02 0', () => {
    const res = run(fresh());
    for (const id of ['req-dwarf-cage', 'req-dwarf-hideout', 'req-gerbil-thermo']) {
      const r = row(BASE, 'supplyRequirements', id);
      expect(/\d/.test(r.whyShort as string), id).toBe(true);
      expect(whyShortNumberProblems(r.whyShort as string, [r.why as string, r.caution as string | null, r.notNowReason as string | null]), id).toEqual([]);
      expect(of(res, 'W02').filter((i) => i.id === id), id).toEqual([]);
    }
  });
});

describe('W02 · L03 — 비ASCII 숫자·한글 수사 우회(NFKC 뒤 판정)', () => {
  const SRC = ['가로·세로 60×40cm 이상, 베딩은 15cm 이상'];
  const BYPASS = ['가로 ９９cm 이상이에요.', '가로 𝟗𝟗cm 이상이에요.', '가로 ⑨cm 이상이에요.', '가로 ٩٩cm 이상이에요.', '가로 ❾cm 이상이에요.', '가로 아흔cm 이상이에요.', '가로 구십 cm 이상이에요.', '가로 스물다섯 센티예요.', '베딩 열 cm는 깔아요.'];
  it.each(BYPASS)('원문에 없는 숫자 우회 "%s" → W02(순수 함수)', (v) => {
    expect(whyShortNumberProblems(v, SRC).length).toBeGreaterThan(0);
  });
  it('Kenny 2026-11-16 결정 5(의도된 강화): NFKC 로 펴지는 표기(전각·수학 굵은)도 값이 원문과 같아도 표기 자체로 W02, 남는 비ASCII 숫자·한글 수사도 W02', () => {
    // 이전엔 「６０cm」「𝟔𝟎cm」가 원문 60 과 값 대조로 통과했다 — 이제 정규화 전 원문 기준 호환 숫자(compatDigits)로 막는다.
    const fw = whyShortNumberProblems('가로 ６０cm 이상이에요.', SRC);
    expect(fw).toHaveLength(1);
    expect(fw[0]).toContain('숫자 표기 우회(호환 숫자) "６０"');
    const bold = whyShortNumberProblems('가로 𝟔𝟎cm 이상이에요.', SRC);
    expect(bold).toHaveLength(1);
    expect(bold[0]).toContain('호환 숫자');
    // 비ASCII 숫자는 compatDigits 와 disguisedNumbers 양쪽 대상이지만 한 번만 보고.
    expect(whyShortNumberProblems('가로 ٦٠cm 이상이에요.', SRC).filter((p) => p.includes('숫자 표기 우회'))).toHaveLength(1);
    expect(whyShortNumberProblems('가로 ٦٠cm 이상이에요.', SRC)[0]).toContain('숫자 표기 우회');
    expect(whyShortNumberProblems('가로 예순cm 이상이에요.', SRC)[0]).toContain('숫자 표기 우회');
  });
  it('정상 문장(ASCII 숫자·자연어 수 세기·"높이 cm" 같은 낱말) → 통과', () => {
    expect(whyShortNumberProblems('가로 60cm 이상이에요.', SRC)).toEqual([]);
    expect(whyShortNumberProblems('한 번 더 살펴봐요.', SRC)).toEqual([]);
    expect(whyShortNumberProblems('두 개를 두면 좋아요.', SRC)).toEqual([]);
    expect(whyShortNumberProblems('세 마리면 넓게 봐요.', SRC)).toEqual([]);
    expect(whyShortNumberProblems('높이 cm 를 재어 봐요.', SRC)).toEqual([]);
    expect(disguisedNumbers('하루 한 번 확인해요. 열을 맞춰요.')).toEqual([]);
  });
  it('validate: whyShort 우회 → W02 error, why 우회 → L03 warning(오류 아님)', () => {
    expect(of(withShort('req-syrian-cage', '가로는 아흔cm 넘게 봐요.'), 'W02')).toHaveLength(1);
    // 전각 ９９ = 표기(호환 숫자) + 값(원문에 없는 99cm) 두 문제 → W02 2건(결정 5 전엔 값 1건).
    expect(of(withShort('req-syrian-cage', '가로는 ９９cm 넘게 봐요.'), 'W02').map((i) => i.message)).toEqual([
      expect.stringMatching(/^숫자 표기 우회\(호환 숫자\)/),
      expect.stringMatching(/^원문에 없는 숫자·단위/),
    ]);
    // 원문(caution)과 같은 값 1cm 를 전각으로 → 표기만 W02 1건, whyShort 도 lint 대상이라 L07 ERROR 도 함께.
    const fw1 = withShort('req-syrian-cage', '철망 간격은 １cm 미만으로 봐요.');
    expect(of(fw1, 'W02').map((i) => i.message)).toEqual([expect.stringContaining('호환 숫자')]);
    expect(of(fw1, 'L07').map((i) => i.path)).toEqual(['whyShort']);
    expect(withShort('req-syrian-cage', '철망 간격은 1cm 미만으로 봐요.').errors).toEqual([]);
    const s = fresh();
    const cage = row(s, 'supplyRequirements', 'req-syrian-cage');
    cage.why = `${cage.why as string} 가로는 ٩٩cm 넘게 봐요.`;
    const res = run(s);
    expect(of(res, 'L03', 'warnings').filter((i) => i.id === 'req-syrian-cage' && i.path === 'why').map((i) => i.message).join(' ')).toContain('숫자 표기 우회');
    // 전각 숫자 단위 누락도 L03(NFKC 뒤 ASCII 규칙).
    expect(numbersWithoutUnit('가로 ９９ 이상')).toEqual(['99']);
  });
});

describe('W01 — 줄바꿈·문장 경계·보이지 않는 문자 우회', () => {
  it.each([
    ['U+2029', '물이 필요해요\u2029매일 봐요'],
    ['U+2028', '물이 필요해요\u2028매일 봐요'],
    ['NEL', '물이 필요해요\u0085매일 봐요'],
    ['VT', '물이 필요해요\u000B매일 봐요'],
    ['FF', '물이 필요해요\u000C매일 봐요'],
  ])('%s → 개행 W01', (_n, v) => {
    expect(whyShortFormProblem(v)).toContain('개행');
  });
  it('마침표 뒤 공백 없는 두 문장·전각 마침표 → 한 문장 아님 W01, 소수점은 경계 아님', () => {
    expect(whyShortFormProblem('물이 필요해요.먹이도 봐요.')).toContain('한 문장');
    expect(whyShortFormProblem('물이 필요해요．먹이도 봐요．')).toContain('한 문장');
    expect(whyShortFormProblem('물이 필요해요!먹이도 봐요.')).toContain('한 문장');
    expect(whyShortFormProblem('가로는 몸길이의 2.5배예요.')).toBeNull();
    expect(whyShortFormProblem('물이 꼭 필요해요．')).toBeNull();
    expect(strictSentenceCount('물이 필요해요.먹이도 봐요.')).toBe(2);
    // why·caution 용 sentenceCount 는 그대로(공백 없는 마침표는 경계 아님 — 실시드 L03 결과 불변).
    expect(sentenceCount('물이 필요해요.먹이도 봐요.')).toBe(1);
  });
  it.each([
    ['ZWSP', '물이 꼭\u200B필요해요.'],
    ['ZWNJ', '물이 꼭\u200C필요해요.'],
    ['ZWJ(글자 사이)', '물이 꼭\u200D필요해요.'],
    ['LRM', '물이 꼭 필요해요.\u200E'],
    ['RLO', '물이 꼭 \u202E필요해요.'],
    ['RLI', '물이 꼭 \u2067필요해요.'],
    ['BOM', '\uFEFF물이 꼭 필요해요.'],
    ['WJ', '물이 꼭\u2060필요해요.'],
    ['SHY', '물이 꼭 필\u00AD요해요.'],
  ])('%s → W01(제로폭·방향 제어)', (_n, v) => {
    expect(whyShortFormProblem(v)).toContain('제로폭');
    expect(of(withShort('req-syrian-water', v), 'W01')).toHaveLength(1);
  });
  it('정상: 이모지 ZWJ 결합은 허용', () => {
    expect(whyShortFormProblem('👨‍👩‍👧가나다라.')).toBeNull();
    expect(whyShortFormProblem('물이 꼭 필요해요.')).toBeNull();
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
  it('서명 뒤 whyShort 추가(키 없던 행)·변경(채택 값 있던 행) → G05(재서명 요구)', () => {
    const { seed, manifest } = dwarfSignedWith();
    const sig = { missing: false as const, data: structuredClone(manifest) };
    const base = structuredClone(seed) as unknown as RawSeed;
    expect(validateSeed(base, { now: DWARF_PREVIEW_AS_OF, signatures: sig }).errors).toEqual([]);
    for (const [id, hadKey] of [['req-dwarf-tubes', false], ['req-dwarf-cage', true]] as const) {
      const raw = structuredClone(base);
      const r = row(raw, 'supplyRequirements', id);
      expect([id, Object.prototype.hasOwnProperty.call(r, 'whyShort')]).toEqual([id, hadKey]);
      expect(r.reviewBasis).toBe('ROW_CHECKED'); // 최소 규격 행 — 재서술 whyShort 여도 V10 아님(G05 만 남게)
      r.whyShort = '바닥이 넓고 높이가 필요해요.';
      const res = validateSeed(raw, { now: DWARF_PREVIEW_AS_OF, signatures: sig });
      expect([...new Set(res.errors.map((i) => i.rule))]).toEqual(['G05']);
      expect(of(res, 'G05').map((i) => i.id)).toEqual([id]);
    }
  });
});
