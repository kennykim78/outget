// 작업 192 — 호환 규칙 품질 경고 R07c(보유품 의존성 탐침)·R07d(`||` 사용). 게이트 아님(WARN).
//   실제 server/seed 를 깊은 복사해 메모리에서만 expr 을 바꾼다(시드 사실 불변). 주입 식은 검증용 자리표시이며 사실값이 아니다.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSeedDirRaw } from '../seed/read.js';
import { validateSeed } from '../seed/validate.js';
import type { RawSeed, Rec, SeedKey } from '../seed/common.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = '2026-10-27';
const BASE: RawSeed = readSeedDirRaw(SEED_DIR).raw;
const fresh = (): Required<RawSeed> => structuredClone(BASE) as Required<RawSeed>;

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
  it('호환 규칙 4개 → 경고 없음, ERROR 0', () => {
    const r = issues(fresh());
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
