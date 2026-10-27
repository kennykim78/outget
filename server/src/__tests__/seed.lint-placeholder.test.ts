// L04 대괄호 자리표시 강화 — 메모리 복사본에만 주입(시드 사실 불변).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSeedDirRaw } from '../seed/read.js';
import { validateSeed } from '../seed/validate.js';
import { isPlaceholder } from '../seed/lint.js';
import type { RawSeed, Rec, SeedKey } from '../seed/common.js';

const here = dirname(fileURLToPath(import.meta.url));
const BASE: RawSeed = readSeedDirRaw(join(here, '..', '..', 'seed')).raw;
const NOW = '2026-10-27';

function fresh(): Required<RawSeed> {
  return structuredClone(BASE) as Required<RawSeed>;
}
function row(s: RawSeed, key: SeedKey, id: string): Rec {
  const r = (s[key] ?? []).find((x) => (x as Rec).id === id);
  if (!r) throw new Error(`fixture: ${key}#${id} 없음`);
  return r as Rec;
}
const l04 = (s: RawSeed): number => validateSeed(s, { now: NOW }).errors.filter((e) => e.rule === 'L04').length;

describe('L04 대괄호 자리표시', () => {
  it('isPlaceholder 원시 판정', () => {
    for (const t of ['[검수 필요]', '[검수자 판단]', '[...]', '[TBD]', '[TODO: 채움]', '[?]', '[ 검수 후 기입 ]', '[]']) {
      expect(isPlaceholder(t), t).toBe(true);
    }
    for (const t of ['[데모] 바닥재 설명입니다.', '바닥재 [참고] 문장', '60×40cm 이상.', '[1] 번호가 붙은 긴 문장입니다']) {
      expect(isPlaceholder(t), t).toBe(false);
    }
  });

  it('실시드 baseline: L04 0건', () => {
    expect(l04(fresh())).toBe(0);
  });

  it('why="[검수 필요]" → L04 ERROR', () => {
    const s = fresh();
    row(s, 'supplyRequirements', 'req-syrian-water').why = '[검수 필요]';
    expect(l04(s)).toBeGreaterThan(0);
  });

  it('taxa koreanName="[검수자 판단]" → L04 ERROR', () => {
    const s = fresh();
    row(s, 'taxa', 'mesocricetus-auratus').koreanName = '[검수자 판단]';
    expect(l04(s)).toBeGreaterThan(0);
  });

  it('setupBundles purpose="[...]" → L04 ERROR', () => {
    const s = fresh();
    row(s, 'setupBundles', 'sb-syrian-budget').purpose = '[...]';
    expect(l04(s)).toBeGreaterThan(0);
  });

  it('정상 문장(문장 속 대괄호 포함) 통과', () => {
    const s = fresh();
    row(s, 'setupBundles', 'sb-syrian-budget').purpose = '[참고] 처음 준비할 때 필요한 것을 묶었다.';
    expect(l04(s)).toBe(0);
  });
});
