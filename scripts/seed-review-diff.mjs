#!/usr/bin/env node
// M4 재라벨 가드(D13, PRD US-020): 시드 검수 상태 전이를 base ref 대비 행(id) 단위로 검사한다.
//
//   node scripts/seed-review-diff.mjs --base <ref> [--head <ref>]
//
// base의 server/seed/*.json은 `git show <ref>:server/seed/<file>`로 읽고(없으면 신규 파일),
// head는 --head ref(지정 시) 또는 작업 트리에서 읽는다.
//
// FAIL 규칙(head reviewStatus=VERIFIED 인 행에 대해):
//   R1 base가 VERIFIED가 아니고 NEEDS_REVIEW도 아님(DRAFT→VERIFIED 직행, 신규 행/신규 파일 포함)
//   R2 base reviewerType=AI_DRAFT  (AI 초안은 같은 base 기준 한 번에 VERIFIED 불가 — 재라벨 후 별도 PR)
//   R3 verifiedBy가 AI 핸들 /\b(ai|gpt|claude|bot|llm)\b/i
//   + 무결성: head 파일 내 중복 id / id 없는 VERIFIED 행 / JSON 배열 아님 → FAIL
//
// exit 0 통과(새로 VERIFIED된 행 목록 출력) · 1 위반 · 2 인수/ref 오류.
// 의존성 0, 네트워크 0. git은 execFileSync 인수 배열로만 호출(셸 미경유).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SEED_DIR = 'server/seed';
// 서명 매니페스트(보안 79 H-1)는 콘텐츠 행 파일이 아니다(항목 id 가 파일 간 겹칠 수 있음) — 전이 검사 대상 밖, seed:validate G01~G06 이 검사.
const SIGNATURE_FILE = 'review-signatures.json';
const AI_HANDLE = /\b(ai|gpt|claude|bot|llm)\b/i;
const REF_SAFE = /^[A-Za-z0-9._\/~^@{}:+-]+$/;

const USAGE = 'usage: node scripts/seed-review-diff.mjs --base <ref> [--head <ref>]';

class ArgError extends Error {}

function parseArgs(argv) {
  const out = { base: null, head: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base' || a === '--head') {
      const v = argv[i + 1];
      if (v === undefined) throw new ArgError(`${a} requires a value`);
      out[a.slice(2)] = v;
      i++;
    } else if (a === '-h' || a === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else {
      throw new ArgError(`unknown argument: ${a}`);
    }
  }
  if (!out.base) throw new ArgError('--base is required');
  for (const k of ['base', 'head']) {
    const v = out[k];
    if (v === null) continue;
    if (v.startsWith('-') || !REF_SAFE.test(v) || v.includes('..')) {
      throw new ArgError(`invalid --${k} ref: ${JSON.stringify(v)}`);
    }
  }
  return out;
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function resolveCommit(cwd, ref) {
  try {
    return git(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]).trim();
  } catch {
    throw new ArgError(`unknown git ref: ${ref}`);
  }
}

function listFilesAtCommit(cwd, sha) {
  const out = git(cwd, ['ls-tree', '--name-only', sha, `${SEED_DIR}/`]);
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p.endsWith('.json'))
    .map((p) => p.slice(SEED_DIR.length + 1))
    .filter((f) => f && !f.includes('/') && f !== SIGNATURE_FILE);
}

function listFilesWorktree(root) {
  const dir = join(root, SEED_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.json'))
    .map((d) => d.name)
    .filter((f) => f !== SIGNATURE_FILE);
}

function readAtCommit(cwd, sha, file) {
  return git(cwd, ['show', `${sha}:${SEED_DIR}/${file}`]);
}

function parseRows(text, label, errors) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    errors.push(`${label}: invalid JSON (${e.message})`);
    return null;
  }
  if (!Array.isArray(data)) {
    errors.push(`${label}: top-level is not an array`);
    return null;
  }
  return data;
}

function indexById(rows, label, errors) {
  const map = new Map();
  const dups = new Set();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r.id !== 'string' || r.id === '') {
      if (r.reviewStatus === 'VERIFIED') errors.push(`${label}: VERIFIED row without id`);
      continue;
    }
    if (map.has(r.id)) dups.add(r.id);
    else map.set(r.id, r);
  }
  for (const id of dups) errors.push(`${label}#${id}: duplicate id`);
  return map;
}

function main() {
  let args;
  let root;
  let baseSha;
  let headSha = null;
  try {
    args = parseArgs(process.argv.slice(2));
    try {
      root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
    } catch {
      throw new ArgError('not inside a git repository');
    }
    baseSha = resolveCommit(root, args.base);
    if (args.head) headSha = resolveCommit(root, args.head);
  } catch (e) {
    if (e instanceof ArgError) {
      console.error(`seed-review-diff: ${e.message}\n${USAGE}`);
      process.exit(2);
    }
    throw e;
  }

  const headLabel = args.head ?? '(worktree)';
  const baseFiles = new Set(listFilesAtCommit(root, baseSha));
  const headFiles = headSha ? listFilesAtCommit(root, headSha) : listFilesWorktree(root);

  const fails = [];
  const promoted = [];

  for (const file of [...headFiles].sort()) {
    const headText = headSha ? readAtCommit(root, headSha, file) : readFileSync(join(root, SEED_DIR, file), 'utf8');
    const headRows = parseRows(headText, `${file}@${headLabel}`, fails);
    if (!headRows) continue;
    const headMap = indexById(headRows, file, fails);

    let baseMap = new Map();
    if (baseFiles.has(file)) {
      const baseErrs = [];
      const baseRows = parseRows(readAtCommit(root, baseSha, file), `${file}@${args.base}`, baseErrs);
      // base 파싱 실패 시 base 행이 없는 것으로 간주 → head VERIFIED 행은 R1로 FAIL(fail-closed).
      if (baseRows) baseMap = indexById(baseRows, `${file}@${args.base}`, baseErrs);
      for (const m of baseErrs) console.error(`seed-review-diff: warn: ${m}`);
    }

    for (const [id, h] of headMap) {
      if (h.reviewStatus !== 'VERIFIED') continue;
      const b = baseMap.get(id);
      const where = `${file}#${id}`;
      const baseStatus = b ? b.reviewStatus : '(new)';
      const wasVerified = b?.reviewStatus === 'VERIFIED';

      if (!wasVerified && baseStatus !== 'NEEDS_REVIEW') {
        fails.push(`${where}: R1 ${baseStatus} -> VERIFIED (must pass NEEDS_REVIEW at base first)`);
      }
      if (b?.reviewerType === 'AI_DRAFT') {
        fails.push(`${where}: R2 base reviewerType=AI_DRAFT -> VERIFIED (AI_DRAFT can never be VERIFIED; relabel in a separate PR)`);
      }
      if (typeof h.verifiedBy === 'string' && AI_HANDLE.test(h.verifiedBy)) {
        fails.push(`${where}: R3 verifiedBy=${JSON.stringify(h.verifiedBy)} looks like an AI/bot handle`);
      }
      if (!wasVerified) {
        promoted.push(`${where} (${baseStatus} -> VERIFIED, reviewerType=${h.reviewerType ?? '?'}, verifiedBy=${h.verifiedBy ?? '?'}, verifiedAt=${h.verifiedAt ?? '?'})`);
      }
    }
  }

  console.log(`seed-review-diff: base=${args.base} (${baseSha.slice(0, 12)}) head=${headLabel}${headSha ? ` (${headSha.slice(0, 12)})` : ''}`);
  if (fails.length) {
    for (const f of fails) console.log(`FAIL ${f}`);
    console.log(`seed-review-diff: ${fails.length} violation(s)`);
    process.exit(1);
  }
  if (promoted.length) {
    console.log(`Newly VERIFIED rows (${promoted.length}):`);
    for (const p of promoted) console.log(`- ${p}`);
  } else {
    console.log('Newly VERIFIED rows: none');
  }
  console.log('seed-review-diff: OK');
  process.exit(0);
}

main();
