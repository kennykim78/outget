#!/usr/bin/env node
// seed-draft 사본 동등성 가드(R6 레인 H): server/seed(정본)와 docs/planning-artifacts/seed-draft(사본)의
// **사실 필드**가 같은지 검사한다. 라벨·식별·검수 메타 편집(id·slug·searchKeyword·orderHint·optionLabels·category·reviewer 등)은 무시.
//
//   node scripts/seed-equivalence.mjs [--seed <dir>] [--draft <dir>]
//
// 최상위 *.json 파일만 비교한다(하위 폴더는 무시). 행은 id로 짝짓는다.
// exit 0 동등 · 1 사실 필드 불일치/행·파일 누락 · 2 인수 오류. 의존성 0, 네트워크 0.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// 사실 필드(PRD 부록 B 기준) — 단일 출처 server/src/seed/fact-fields.json(서명 매니페스트 factHash 와 공유, 보안 79 H-1).
//   이 목록의 키만 비교한다. 목록에 없는 키(id·slug·keyword·orderHint·optionLabels·category·
//   reviewStatus/reviewerType/verifiedBy/verifiedAt/reviewBasis/source 등)는 무시.
//   specSchema 는 따로 비교한다(QA170 LOW-3 — 필드 key·type·options·min/max·ruleScoped 가 규칙 판정을 바꾼다).
//   FACT_FIELDS 에 넣지 않는 이유: 그 목록은 서명 factHash 와 공유되어 넣으면 기존 서명 해시가 바뀐다.
//   표시 키(optionLabels — SIGNATURE_STRIP_KEYS)는 canonicalJson 이 제거하고 키 순서는 무시.
//   범위(scope) careProfileId(s)·taxonId(s) 포함 — 적용 대상이 바뀌면 사실 의미가 바뀐다(M456 지적: cr-tubes-cage careProfileId).
import { FACT_FIELDS, SIGNATURE_FILE, canonicalJson } from './lib/review-signature.mjs';

/** FACT_FIELDS 밖에서 추가로 비교하는 구조 필드(정규 JSON 비교). */
export const SCHEMA_FIELDS = Object.freeze(['specSchema']);

export { FACT_FIELDS };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { seed: join(ROOT, 'server/seed'), draft: join(ROOT, 'docs/planning-artifacts/seed-draft') };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if ((k !== '--seed' && k !== '--draft') || argv[i + 1] === undefined) return null;
    out[k.slice(2)] = resolve(argv[i + 1]);
  }
  return out;
}

function topLevelJson(dir) {
  return readdirSync(dir).filter((n) => n.endsWith('.json') && statSync(join(dir, n)).isFile()).sort();
}

function pick(row) {
  const o = {};
  for (const k of FACT_FIELDS) if (k in row) o[k] = row[k];
  return o;
}

export function compareDirs(seedDir, draftDir) {
  const problems = [];
  const draftFiles = new Set(topLevelJson(draftDir));
  for (const file of topLevelJson(seedDir)) {
    if (!draftFiles.has(file)) { problems.push(`${file}: seed-draft 사본 없음`); continue; }
    const a = JSON.parse(readFileSync(join(seedDir, file), 'utf8'));
    const b = JSON.parse(readFileSync(join(draftDir, file), 'utf8'));
    // 서명 매니페스트는 행 사실이 아니라 서명 기록 — 사본과 통째로 같아야 한다.
    if (file === SIGNATURE_FILE) {
      if (!isDeepStrictEqual(a, b)) problems.push(`${file}: 서명 매니페스트가 정본과 사본이 다름`);
      continue;
    }
    if (!Array.isArray(a) || !Array.isArray(b)) { problems.push(`${file}: JSON 배열 아님`); continue; }
    const bById = new Map(b.map((r) => [r.id, r]));
    for (const r of a) {
      const d = bById.get(r.id);
      if (!d) { problems.push(`${file}#${r.id}: 사본에 행 없음`); continue; }
      const fa = pick(r);
      const fb = pick(d);
      for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
        if (!isDeepStrictEqual(fa[k], fb[k])) problems.push(`${file}#${r.id}.${k}: 정본과 사본이 다름`);
      }
      for (const k of SCHEMA_FIELDS) {
        if (!(k in r) && !(k in d)) continue;
        if (!(k in r) || !(k in d) || canonicalJson(r[k]) !== canonicalJson(d[k])) problems.push(`${file}#${r.id}.${k}: 정본과 사본이 다름`);
      }
    }
    const aIds = new Set(a.map((r) => r.id));
    for (const r of b) if (!aIds.has(r.id)) problems.push(`${file}#${r.id}: 정본에 없는 행`);
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) { console.error('usage: node scripts/seed-equivalence.mjs [--seed <dir>] [--draft <dir>]'); process.exit(2); }
  if (!existsSync(args.seed) || !existsSync(args.draft)) { console.error('seed-equivalence: 디렉터리 없음'); process.exit(2); }
  const problems = compareDirs(args.seed, args.draft);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exit(1);
  }
  console.log(`seed-equivalence: OK (${topLevelJson(args.seed).length} files, 사실 필드 ${FACT_FIELDS.length}종 + ${SCHEMA_FIELDS.join('·')} 동등)`);
}
