// 작업 192·219 — 호환 규칙 품질 경고 R07c(보유품 의존성 탐침)·R07d(`||` 사용)·R07e(최소·권장 키 혼합). 게이트 아님(WARN).
//   실제 server/seed 를 깊은 복사해 메모리에서만 expr 을 바꾼다(시드 사실 불변). 주입 식은 검증용 자리표시이며 사실값이 아니다.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSeedDirRaw } from '../seed/read.js';
import { unsignRaw } from './fixtures/prerender-seed.js';
import { validateSeed } from '../seed/validate.js';
import { combos, literalValues } from '../seed/validate-compat-quality.js';
import { createCatalog, parseExpr, requirementCompat, type SpecField } from '../engine/index.js';
import { asSeedBundle, type RawSeed, type Rec, type SeedKey } from '../seed/common.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = '2026-11-25'; // 356: 6종 GENERAL_INFO draftedAt(2026-11-23) 이상 — S07 미래 날짜 방지. // 팁 references checkedAt(2026-11-22) 이상 · 실서명일(2026-11-16) 이상 — 디스크 verifiedAt S07 방지(옛 값 2026-11-03, 277: 출처 접근일 2026-11-02 이상) // 368: 2026-11-25 = 8행 출처 접근일(S07 미래 날짜 방지, 옛 값 2026-11-23).
/** 디스크 시드 그대로(2026-11-16 확인표 5종 서명 후). */
const DISK_READ = readSeedDirRaw(SEED_DIR);
const DISK: RawSeed = DISK_READ.raw;
/** 규칙 주입 바탕 = 서명 전 기준(4 패킷 미서명, 메모리 — 주입 시험 의미 보존). */
const BASE: RawSeed = unsignRaw(DISK);
const fresh = (): Required<RawSeed> => structuredClone(BASE) as Required<RawSeed>;
/** 디스크 시드 사본(서명 후 상태 그대로 — 실시드 시험용). */
const disk = (): Required<RawSeed> => structuredClone(DISK) as Required<RawSeed>;

function row(s: RawSeed, key: SeedKey, id: string): Rec {
  const r = (s[key] ?? []).find((x) => (x as Rec).id === id);
  if (!r) throw new Error(`fixture: ${key}#${id} 없음`);
  return r as Rec;
}

const RULE = 'cr-syrian-wheel-cage-bedding'; // a = wheel, b = cage
const withExpr = (expr: string): Required<RawSeed> => {
  const s = fresh();
  (row(s, 'compatibilityRules', RULE).rules as Rec[])[0].expr = expr;
  return s;
};
const issues = (s: RawSeed) => {
  const res = validateSeed(s, { now: NOW });
  const pick = (rule: string) => res.warnings.filter((i) => i.rule === rule).map((i) => `${i.id}|${i.path}`);
  return { errors: res.errors.map((i) => i.rule), r07c: pick('R07c'), r07d: pick('R07d'), r07cMsgs: res.warnings.filter((i) => i.rule === 'R07c').map((i) => i.message) };
};
const AT = `${RULE}|rules[0].expr`;

describe('실시드 — R07c·R07d 0', () => {
  it('호환 규칙 4개 → 경고 없음, ERROR 0(디스크 서명 후 · 서명 전 기준 둘 다)', () => {
    for (const s of [disk(), fresh()]) {
      const q = issues(s);
      expect(q.errors).toEqual([]);
      expect(q.r07c).toEqual([]);
      expect(q.r07d).toEqual([]);
    }
    const r = issues(disk());
    expect(r.errors).toEqual([]);
    expect(r.r07c).toEqual([]);
    expect(r.r07d).toEqual([]);
  });
});

describe('R07c — 결과가 보유품 값과 무관한 식', () => {
  it.each([
    'b.heightCm == b.heightCm',
    '(b.heightCm - b.heightCm) == 0',
    'b.heightCm >= 1000 ? false : true',
  ])('%s → WARN(보유품 b=cage)', (expr) => {
    const r = issues(withExpr(expr));
    expect(r.errors).toEqual([]);
    expect(r.r07c).toEqual([AT]);
    expect(r.r07cMsgs[0]).toContain('b(cage)');
    expect(r.r07d).toEqual([]);
  });

  it('a.diameterCm >= 1 || b.heightCm >= 1000 → R07c(양방향 모두 무관) + R07d', () => {
    const r = issues(withExpr('a.diameterCm >= 1 || b.heightCm >= 1000'));
    expect(r.errors).toEqual([]);
    expect(r.r07c).toEqual([AT, AT]);
    expect(r.r07d).toEqual([AT]);
  });

  it('true || b.heightCm >= 50 → R07c + R07d', () => {
    const r = issues(withExpr('true || b.heightCm >= 50'));
    expect(r.errors).toEqual([]);
    expect(r.r07c).toEqual([AT]);
    expect(r.r07d).toEqual([AT]);
  });

  it('정상 단조식 a.diameterCm + 25 <= b.heightCm → 경고 없음', () => {
    const r = issues(withExpr('a.diameterCm + 25 <= b.heightCm'));
    expect(r.r07c).toEqual([]);
    expect(r.r07d).toEqual([]);
  });

  it('삼항 분기가 보유품을 쓰는 식(a.diameterCm >= 30 ? b.heightCm >= 60 : true) → 경고 없음(용품 표본 중 하나라도 보유품에 따라 바뀜)', () => {
    const r = issues(withExpr('a.diameterCm >= 30 ? b.heightCm >= 60 : true'));
    expect(r.r07c).toEqual([]);
  });
});

describe('R07c — 리터럴 경계·축소 모드 오탐 방지(QA194 LOW-1·2)', () => {
  it.each([
    'b.heightCm != 33',
    'b.heightCm == 37',
    'b.floorWcm >= 150 && b.floorDcm >= 150 && b.heightCm >= 80',
  ])('%s → R07c 없음', (expr) => {
    const r = issues(withExpr(expr));
    expect(r.errors).toEqual([]);
    expect(r.r07c).toEqual([]);
  });
});

describe('R07c — 상수식 경계·혼합 모서리 오탐 방지(Codex 200 결함 4)', () => {
  it.each([
    'b.floorWcm > 100 / 3 && b.floorWcm < 100 / 2', // 재현 A: 상수끼리의 산술 결과 사이(33.3~50)
    'b.floorWcm == 25 && b.floorDcm == 75 && b.heightCm == 25', // 재현 B: 숫자 키 3개의 리터럴 조합
    'b.floorWcm > 100 / 3 && b.floorWcm < 34', // 좁은 구간(33.3~34): 리터럴 ±1 은 밖, 인접 리터럴 중간값만 안 — 중간값 표본 고정
    'b.heightCm == 10 + 20 + 5', // 작업 208 ①: 중첩 상수식(35)
    "b.floorType == 'MESH' && b.floorWcm == 25 && b.floorDcm == 75", // 작업 208 ②: enum 고정 혼합
  ])('%s → R07c 없음', (expr) => {
    const r = issues(withExpr(expr));
    expect(r.errors).toEqual([]);
    expect(r.r07c).toEqual([]);
  });

  it('진짜 무관한 식(b.heightCm > 0 || true)은 여전히 R07c', () => {
    expect(issues(withExpr('b.heightCm > 0 || true')).r07c.length).toBeGreaterThan(0);
  });

  it('경고 문구는 절대 단정이 아니라 표본 한정', () => {
    const r = issues(withExpr('b.heightCm == b.heightCm'));
    expect(r.r07cMsgs[0]).toContain('표본 값에서 결과 변화가 없음');
    expect(r.r07cMsgs[0]).toContain('무관할 수 있음');
  });
});

describe('R07d — `||` 만', () => {
  it('삼항 안 중첩 || → R07d 1건', () => {
    const r = issues(withExpr("a.diameterCm >= 30 ? (b.heightCm >= 50 || b.floorType == 'SOLID') : true"));
    expect(r.errors).toEqual([]);
    expect(r.r07d).toEqual([AT]);
  });

  it('보유품에 의존하는 || 식도 R07d WARN(R07c 없음)', () => {
    const r = issues(withExpr('a.diameterCm + 25 <= b.heightCm || b.floorType == \'SOLID\''));
    expect(r.errors).toEqual([]);
    expect(r.r07c).toEqual([]);
    expect(r.r07d).toEqual([AT]);
  });
});

describe('R07c — Codex night-qa2 #7·#8 오탐 방지(작업 222)', () => {
  it.each([
    'b.heightCm == -(10 - 45)', // #7: 단항 음수 접기(35)
    "b.type == 'GRID_PANEL' && b.floorWcm == 25 && b.floorDcm == 75 && b.heightCm == 35", // #8: 조합 64 초과, enum 직접 비교 선택지 보존
    'b.heightCm == 35', // 동치식 대조
    "b.type != 'GRID_PANEL' && b.floorWcm == 25 && b.floorDcm == 75 && b.heightCm == 35", // QA223 MED-1: != 는 비교된 값이 식을 고정
    "b.type == 'LIVING_BOX' || b.floorWcm == 25 && b.floorDcm == 75 && b.heightCm == 35", // QA223 MED-1: || 형
    "((b.floorDcm <= 70 && b.floorWcm == 162) || b.heightCm != 46 && b.barGapMm < 16 && b.floorWcm >= 192) && a.diameterCm + 23 <= b.heightCm", // QA223 LOW-2: 숫자 축소는 직접 비교 리터럴 우선
  ])('%s → R07c 없음', (expr) => {
    const r = issues(withExpr(expr));
    expect(r.errors).toEqual([]);
    expect(r.r07c).toEqual([]);
  });

  it('단항 음수 접기: 최종값 35 가 리터럴에 들어가고 중간값 -35 는 없음', () => {
    const v = literalValues(parseExpr('b.heightCm == -(10 - 45)'));
    expect(v).toContain(35);
    expect(v).not.toContain(-35);
  });

  it('진짜 무관한 식은 여전히 경고(단항 음수·enum 혼합 포함)', () => {
    expect(issues(withExpr('b.heightCm == b.heightCm || -(1 - 2) == 1')).r07c.length).toBeGreaterThan(0);
    expect(issues(withExpr("b.type == 'GRID_PANEL' && b.floorWcm >= 0 || true")).r07c.length).toBeGreaterThan(0);
  });
});

describe('R07c 표본 — 접기 경계·폴백 경계(QA210 권장, 작업 215)', () => {
  const lits = (expr: string) => literalValues(parseExpr(expr)).sort((x, y) => x - y);
  const num = (key: string, min: number, max: number): SpecField => ({ key, label: key, type: 'number', min, max });
  const en = (n: number): SpecField => ({ key: 'e', label: 'e', type: 'enum', options: Array.from({ length: n }, (_, i) => `O${i}`) });
  // 기준점(전부 중간·최소·최대)에 안 걸리는 "끝에서 두 번째" 선택지가 모든 리터럴과 짝지어졌는가 = 전수(혼합 모서리) 여부
  const coversAllPairs = (enumN: number, litN: number) => {
    const ls = Array.from({ length: litN }, (_, i) => i + 1);
    const out = combos([en(enumN), num('n', 0, 100)], ls);
    const opt = `O${enumN - 2}`;
    return ls.every((l) => out.some((o) => o.e === opt && o.n === l));
  };

  it('INFO-3 회귀: ((1+2)*3) 은 최종값 9 만 리터럴(중간값 3 은 숫자 리터럴 3 과 별개로 섞이지 않음)', () => {
    expect(lits('b.heightCm == (1 + 2) * 3')).toEqual([1, 2, 3, 9]); // 3 은 원래 숫자 리터럴
    expect(lits('b.heightCm == ((1 + 2) * 4) * 5')).toEqual([1, 2, 4, 5, 60]); // 중간값 3·12 없음
  });

  it('64/65 폴백 경계: 곱 64 는 enum 전수, 65 는 중간값 폴백(전수 아님)', () => {
    expect(coversAllPairs(4, 16)).toBe(true);
    expect(coversAllPairs(5, 13)).toBe(false);
  });

  it('키 혼합 부분식은 접지 않음: a.diameterCm + 10 + 5 → 리터럴 [10, 5]', () => {
    expect(lits('b.heightCm == a.diameterCm + 10 + 5')).toEqual([5, 10]);
  });

  it('0 나누기 상수식 → 예외 없음, 리터럴 미추가, R07c 는 유지', () => {
    expect(lits('b.heightCm == 70 / 0')).toEqual([0, 70]);
    const r = issues(withExpr('b.heightCm == 70 / 0'));
    expect(r.errors).toEqual([]);
    expect(r.r07c).toEqual([AT]);
  });
});

// 작업 219 — R07e 최소 규격 키·권장 전용 키 혼합 `&&`·`||`(218 계획서 선택지 D). 엔진 판정 불변, 경고만.
//   골든 wheel 요구사항: 최소 diameterCm·surface, 권장 diameterCm(최소와 겹침) → 실시드에는 권장 전용 키가 없다.
//   §1.1 재현을 위해 메모리 사본에만 권장 `silent eq true` 를 더한다(자리표시, 사실값 아님).
describe('R07e — 최소·권장 키 혼합 && / ||', () => {
  const BANNED = ['괜찮다', '안전하다', '최저가', '판매순', '베스트', '정확도', '회원가입', '구매'];
  const r07e = (s: RawSeed) => {
    const res = validateSeed(s, { now: NOW });
    const w = res.warnings.filter((i) => i.rule === 'R07e');
    return { errors: res.errors.map((i) => i.rule), at: w.map((i) => `${i.id}|${i.path}`), msgs: w.map((i) => i.message) };
  };
  const withSilentRec = (expr: string, onFail?: string): Required<RawSeed> => {
    const s = withExpr(expr);
    ((row(s, 'supplyRequirements', 'req-syrian-wheel').recommendedSpec as Rec).rules as Rec[]).push({
      key: 'silent',
      op: 'eq',
      value: true,
      reason: '검증용 자리표시',
    });
    if (onFail) (row(s, 'compatibilityRules', RULE).rules as Rec[])[0].onFail = onFail;
    return s;
  };
  const compatOf = (s: RawSeed, cageHeightCm: number) =>
    requirementCompat(createCatalog(asSeedBundle(s)), 'hamster-golden', 'wheel', { ownedItems: { cage: { heightCm: cageHeightCm } } });

  it('실시드 → R07e 0(정본 CR 4개에 && · || 없음)', () => {
    expect(r07e(fresh()).at).toEqual([]);
    const r = r07e(disk());
    expect(r.errors).toEqual([]);
    expect(r.at).toEqual([]);
  });

  it('§1.1 재현(최소 false && 권장, onFail BELOW_MIN) → WARN 1건 · 엔진은 실제로 CHECK + usedRecommended(경고가 가리키는 한계)', () => {
    const s = withSilentRec('a.diameterCm + 20 <= b.heightCm && a.silent == true', 'BELOW_MIN');
    const r = r07e(s);
    expect(r.errors).toEqual([]);
    expect(r.at).toEqual([AT]);
    expect(r.msgs[0]).toContain('최소 diameterCm / 권장 silent');
    expect(r.msgs[0]).toContain('엔진 한계');
    expect(r.msgs[0]).toContain('BELOW_MIN 이 CHECK 로 낮아지고');
    const c = compatOf(s, 40); // 27 + 20 <= 40 → false(최소만으로 확정 가능한 실패)
    expect(c.verdict).toBe('CHECK');
    expect(c.usedRecommended).toBe(true);
  });

  it('`&&`·`||` 동시 + BELOW_MIN, `||` 단독, `&&` + 비BELOW_MIN — 문구 분기(1건 합침)', () => {
    const both = r07e(withSilentRec('(a.diameterCm + 20 <= b.heightCm && a.silent == true) && (a.surface == "SOLID" || a.silent == true)', 'BELOW_MIN'));
    expect(both.at).toEqual([AT]);
    expect(both.msgs[0]).toContain('BELOW_MIN 이 CHECK 로 낮아지고');
    expect(both.msgs[0]).toContain('최소 쪽이 참일 때도 권장 채움 표식');
    const orOnly = r07e(withSilentRec('a.diameterCm + 20 <= b.heightCm || a.silent == true', 'BELOW_MIN'));
    expect(orOnly.msgs[0]).not.toContain('BELOW_MIN');
    const andNon = r07e(withSilentRec('a.diameterCm + 20 <= b.heightCm && a.silent == true', 'CHECK'));
    expect(andNon.at).toEqual([AT]);
    expect(andNon.msgs[0]).not.toContain('BELOW_MIN');
    expect(andNon.msgs[0]).toContain('최소 기준값만으로 확정되는 결과에도 권장 채움 표식');
    for (const m of [...both.msgs, ...orOnly.msgs, ...andNon.msgs]) for (const w of BANNED) expect(m).not.toContain(w);
  });

  it('§1.2 짝(최소 true || 권장) → WARN 1건 · 엔진은 OK + usedRecommended', () => {
    const s = withSilentRec('a.diameterCm + 20 <= b.heightCm || a.silent == true');
    const r = r07e(s);
    expect(r.errors).toEqual([]);
    expect(r.at).toEqual([AT]);
    expect(r.msgs[0]).toContain('`||` a(wheel)');
    expect(r.msgs[0]).toContain('권장 채움 표식(usedRecommended)이 붙을 수 있음');
    expect(r.msgs[0]).not.toContain('BELOW_MIN 이 CHECK 로');
    const c = compatOf(s, 60);
    expect(c.verdict).toBe('OK');
    expect(c.usedRecommended).toBe(true);
  });

  it('피연산자 순서 반대(권장 && 최소)·중첩(최소 && (권장 || 보유품)) → WARN', () => {
    expect(r07e(withSilentRec('a.silent == true && a.diameterCm + 20 <= b.heightCm', 'BELOW_MIN')).at).toEqual([AT]);
    expect(r07e(withSilentRec("a.surface == 'SOLID' && (a.silent == true || b.heightCm >= 80)")).at).toEqual([AT]);
  });

  it('실시드 저빌 wheel(최소 surface · 권장 전용 diameterCm) — 시드 사실 그대로 혼합식만 주입 → WARN', () => {
    const s = fresh();
    (row(s, 'compatibilityRules', 'cr-gerbil-wheel-cage-bedding').rules as Rec[])[0].expr = "a.surface == 'SOLID' && a.diameterCm + 20 <= b.heightCm";
    const r = r07e(s);
    expect(r.errors).toEqual([]);
    expect(r.at).toEqual(['cr-gerbil-wheel-cage-bedding|rules[0].expr']);
    expect(r.msgs[0]).toContain('최소 surface / 권장 diameterCm');
  });

  it.each([
    ["최소만: a.diameterCm + 20 <= b.heightCm && a.surface == 'SOLID'", "a.diameterCm + 20 <= b.heightCm && a.surface == 'SOLID'"],
    ['권장만(용품 쪽): a.silent == true && b.heightCm >= 40', 'a.silent == true && b.heightCm >= 40'],
    ['논리 연산 없이 섞음: a.diameterCm + 20 <= b.heightCm', 'a.diameterCm + 20 <= b.heightCm'],
    ['보유품만 섞음: a.diameterCm + 20 <= b.heightCm && b.floorWcm >= 100', 'a.diameterCm + 20 <= b.heightCm && b.floorWcm >= 100'],
  ])('%s → R07e 0', (_label, expr) => {
    const r = r07e(withSilentRec(expr, 'BELOW_MIN'));
    expect(r.errors).toEqual([]);
    expect(r.at).toEqual([]);
  });

  it('권장 전용 키가 없는 요구사항(실시드 골든 wheel)에서는 같은 && 식도 0', () => {
    expect(r07e(withExpr('a.diameterCm + 20 <= b.heightCm && a.silent == true')).at).toEqual([]);
  });

  it('문구에 콘텐츠 린트 금지어 없음', () => {
    const msgs = [
      ...r07e(withSilentRec('a.diameterCm + 20 <= b.heightCm && a.silent == true', 'BELOW_MIN')).msgs,
      ...r07e(withSilentRec('a.diameterCm + 20 <= b.heightCm || a.silent == true')).msgs,
    ];
    expect(msgs.length).toBe(2);
    for (const m of msgs) {
      for (const w of BANNED) expect(m).not.toContain(w);
      expect(m).not.toMatch(/전문가\s*\d+\s*명/);
    }
  });
});
