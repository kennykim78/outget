// M-1(R4 A1): seed:validate 의 W-STALE 경계와 노출 요약(--now 기준)이 엔진 강등과 같은 경계(days > STALE_DAYS)를 쓴다.
//   승격 픽스처는 메모리 사본, 기준일은 고정값(실시계 0).
import { describe, expect, it } from 'vitest';
import type { SeedBundle } from '../engine/index.js';
import { SEED_FILES, type RawSeed } from '../seed/common.js';
import { validateSeed } from '../seed/validate.js';
import { FIXTURE_AS_OF, FIXTURE_FIRST_STALE, FIXTURE_LAST_FRESH, promoted } from './fixtures/prerender-seed.js';

const rawOf = (seed: SeedBundle): RawSeed =>
  Object.fromEntries(Object.keys(SEED_FILES).map((k) => [k, seed[k as keyof SeedBundle] as unknown[]])) as RawSeed;

describe('seed:validate — 검수 나이(W-STALE·노출 요약 같은 경계)', () => {
  it('기준일 고정: FIXTURE_AS_OF 에서 승격 픽스처 노출 types 1, W-STALE 0', () => {
    const res = validateSeed(rawOf(promoted({ publishable: true })), { now: FIXTURE_AS_OF });
    expect(res.errors).toEqual([]);
    expect(res.summary.types).toBe(1);
    expect(res.warnings.filter((w) => w.rule === 'W-STALE')).toEqual([]);
  });

  it('+180: 노출 유지·W-STALE 0 / +181: 노출 0·W-STALE ≥ 1 (경계 동일)', () => {
    const edge = validateSeed(rawOf(promoted({ publishable: true })), { now: FIXTURE_LAST_FRESH });
    expect(edge.summary.types).toBe(1);
    expect(edge.summary.products).toBe(1);
    expect(edge.warnings.filter((w) => w.rule === 'W-STALE')).toEqual([]);

    const past = validateSeed(rawOf(promoted({ publishable: true })), { now: FIXTURE_FIRST_STALE });
    expect(past.errors).toEqual([]);
    expect(past.summary.types).toBe(0);
    expect(past.summary.requirements).toBe(0);
    expect(past.summary.products).toBe(0);
    const stale = past.warnings.filter((w) => w.rule === 'W-STALE');
    expect(stale.length).toBeGreaterThan(0);
    expect(stale[0].message).toMatch(/181일 경과\(>180\)/);
  });
});
