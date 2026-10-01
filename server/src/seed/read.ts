// 시드 디렉터리 읽기 — fs 를 쓰는 유일한 seed 모듈(검증 로직은 validate.ts, 순수).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedBundle } from '../engine/types.js';
import { asSeedBundle, Collector, SEED_FILES, SEED_KEYS, type Issue, type RawSeed } from './common.js';

export { asSeedBundle };

export interface SeedReadResult {
  raw: RawSeed;
  /** S01: 파싱 실패·배열 아님(누락 파일은 validateSeed 가 S01 로 보고). */
  issues: Issue[];
}

export function readSeedDirRaw(dir: string): SeedReadResult {
  const out = new Collector();
  const raw: RawSeed = {};
  for (const key of SEED_KEYS) {
    const path = join(dir, SEED_FILES[key]);
    if (!existsSync(path)) continue;
    let parsed: unknown;
    try {
      const text = readFileSync(path, 'utf8');
      parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch (e) {
      out.error('S01', key, null, '', `JSON 파싱 실패: ${(e as Error).message}`);
      continue;
    }
    if (!Array.isArray(parsed)) {
      out.error('S01', key, null, '', '최상위가 JSON 배열이 아니다');
      continue;
    }
    raw[key] = parsed;
  }
  return { raw, issues: out.issues };
}

/** 계획 §B 시그니처: 읽기 실패·누락이 있으면 throw. 내용 검증은 하지 않는다(validateSeed 사용). */
export function readSeedDir(dir: string): SeedBundle {
  const { raw, issues } = readSeedDirRaw(dir);
  const missing = SEED_KEYS.filter((k) => raw[k] === undefined).map((k) => SEED_FILES[k]);
  if (issues.length > 0 || missing.length > 0) {
    throw new Error(
      `seed dir ${dir}: ${[...issues.map((i) => `${i.file}: ${i.message}`), ...missing.map((f) => `${f}: 없음`)].join('; ')}`,
    );
  }
  return asSeedBundle(raw);
}
