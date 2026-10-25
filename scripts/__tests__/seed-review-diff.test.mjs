// scripts/seed-review-diff.mjs — M4 재라벨 가드(D13) 테스트. 임시 git repo에서 base 커밋 vs 작업트리/head 비교.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'seed-review-diff.mjs');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function row(over = {}) {
  return {
    id: 'r1',
    reviewStatus: 'DRAFT',
    reviewerType: 'EXPERIENCED_KEEPER',
    verifiedBy: null,
    verifiedAt: null,
    ...over,
  };
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'seed-review-diff-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.invalid');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'server', 'seed'), { recursive: true });
  return dir;
}

function writeSeed(dir, file, rows) {
  writeFileSync(join(dir, 'server', 'seed', file), JSON.stringify(rows, null, 2) + '\n');
}

function commit(dir, msg = 'c') {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', msg);
}

function run(dir, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function withRepo(fn) {
  const dir = makeRepo();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const V = { reviewStatus: 'VERIFIED', verifiedBy: 'kenny', verifiedAt: '2026-10-01' };

test('DRAFT -> VERIFIED 직행은 FAIL(1)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row()]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [row(V)]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /taxa\.json/);
    assert.match(r.out, /r1/);
  }));

test('NEEDS_REVIEW -> VERIFIED 는 통과(0)하고 새 VERIFIED 목록 출력', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ reviewStatus: 'NEEDS_REVIEW' })]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [row(V)]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /taxa\.json.*r1/);
    assert.match(r.out, /kenny/);
  }));

test('AI_DRAFT -> EXPERIENCED_KEEPER + VERIFIED 한 커밋은 FAIL(1)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'care-profiles.json', [row({ reviewerType: 'AI_DRAFT' })]);
    commit(dir);
    writeSeed(dir, 'care-profiles.json', [row({ ...V, reviewerType: 'EXPERIENCED_KEEPER' })]);
    commit(dir, 'relabel');
    const r = run(dir, '--base', 'HEAD~1', '--head', 'HEAD');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /AI_DRAFT/);
  }));

test('base가 AI_DRAFT 이면 NEEDS_REVIEW 였어도 같은 base 기준 VERIFIED 는 FAIL(1)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ reviewerType: 'AI_DRAFT', reviewStatus: 'NEEDS_REVIEW' })]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [row({ ...V, reviewerType: 'EXPERIENCED_KEEPER' })]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 1, r.out);
  }));

test("verifiedBy 'claude' 는 FAIL(1)", () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ reviewStatus: 'NEEDS_REVIEW' })]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedBy: 'claude' })]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /verifiedBy/);
  }));

test('verifiedBy AI 핸들 변형(GPT-4, ops bot)은 FAIL, 일반 이름(Maida)은 FAIL 목록에 없음', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [
      row({ id: 'id-a', reviewStatus: 'NEEDS_REVIEW' }),
      row({ id: 'id-b', reviewStatus: 'NEEDS_REVIEW' }),
      row({ id: 'id-c', reviewStatus: 'NEEDS_REVIEW' }),
    ]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [
      row({ ...V, id: 'id-a', verifiedBy: 'GPT-4' }),
      row({ ...V, id: 'id-b', verifiedBy: 'ops bot' }),
      row({ ...V, id: 'id-c', verifiedBy: 'Maida' }),
    ]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL[^\n]*id-a/);
    assert.match(r.out, /FAIL[^\n]*id-b/);
    assert.doesNotMatch(r.out, /FAIL[^\n]*id-c/);
  }));

test('변경 없음은 통과(0)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ reviewerType: 'AI_DRAFT' })]);
    commit(dir);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 0, r.out);
  }));

test('신규 행이 바로 VERIFIED 면 FAIL(1)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row()]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [row(), row({ ...V, id: 'r2' })]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL[^\n]*r2/);
  }));

test('base에 없는 신규 파일의 VERIFIED 행도 FAIL(1)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row()]);
    commit(dir);
    writeSeed(dir, 'new-kind.json', [row({ ...V, id: 'n1' })]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /new-kind\.json/);
  }));

test('head 중복 id로 base 행을 가리는 우회는 FAIL(1)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ reviewStatus: 'NEEDS_REVIEW' })]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [row(V), row(V)]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /duplicate/i);
  }));

test('이미 VERIFIED 였던 행 유지(서명 밖 키만 변경)는 통과(0)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-01' })]);
    commit(dir);
    // displayOrder 는 서명 해시 필드가 아니다(fact-fields.json) → factHash 불변.
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-01', displayOrder: 2 })]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /Re-signed/);
  }));

// ── R4(QA 82 D1): VERIFIED→VERIFIED 사실 변경은 base 보다 새 날짜의 재서명 필요 ──
const SIG = (over = {}) => ({ file: 'taxa.json', id: 'r1', basis: 'ROW_CHECKED', signedBy: 'kenny', signedAt: '2026-09-01', factHash: 'a'.repeat(64), ...over });

test('R4: VERIFIED 행 사실 변경 + 날짜 그대로(해시만 교체)는 FAIL(1)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-01' })]);
    writeSeed(dir, 'review-signatures.json', [SIG()]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-01', note: 'x' })]);
    writeSeed(dir, 'review-signatures.json', [SIG({ factHash: 'b'.repeat(64) })]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL taxa\.json#r1: R4 [^\n]*verifiedAt="2026-09-01"[^\n]*signedAt="2026-09-01"/);
  }));

test('R4: verifiedAt 만 새 날짜, 매니페스트 signedAt 그대로면 FAIL(1)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-01' })]);
    writeSeed(dir, 'review-signatures.json', [SIG()]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-10-02', note: 'x' })]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /R4 [^\n]*manifest signedAt="2026-09-01"/);
    assert.doesNotMatch(r.out, /R4 [^\n]*verifiedAt=/);
  }));

test('R4: 매니페스트 signedAt 이 base 보다 늦어도 행 verifiedAt 이 base 매니페스트 signedAt 이하면 FAIL(1)', () =>
  withRepo((dir) => {
    // base 기준일 = max(행 verifiedAt 2026-09-01, 매니페스트 signedAt 2026-09-10) = 2026-09-10
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-01' })]);
    writeSeed(dir, 'review-signatures.json', [SIG({ signedAt: '2026-09-10' })]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-10', note: 'x' })]);
    writeSeed(dir, 'review-signatures.json', [SIG({ signedAt: '2026-10-02' })]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /R4 [^\n]*base 2026-09-10[^\n]*verifiedAt="2026-09-10"/);
  }));

test('R4: head 매니페스트 항목 없음(또는 파일 없음)은 FAIL(1, fail-closed)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-01' })]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-10-02', note: 'x' })]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /R4 [^\n]*no manifest entry at head/);
  }));

test('R4: 행 verifiedAt·매니페스트 signedAt 모두 새 날짜면 통과(0)하고 재서명 목록에 출력', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-01' })]);
    writeSeed(dir, 'review-signatures.json', [SIG()]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-10-02', note: 'x' })]);
    writeSeed(dir, 'review-signatures.json', [SIG({ signedAt: '2026-10-02', factHash: 'b'.repeat(64) })]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Re-signed VERIFIED rows \(1\):\n- taxa\.json#r1/);
  }));

test('R4: --head ref 모드에서도 같은 판정(커밋된 위조는 FAIL)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-01' })]);
    writeSeed(dir, 'review-signatures.json', [SIG()]);
    commit(dir, 'base');
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-01', note: 'x' })]);
    writeSeed(dir, 'review-signatures.json', [SIG({ factHash: 'b'.repeat(64) })]);
    commit(dir, 'forge');
    const r = run(dir, '--base', base, '--head', 'HEAD');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /R4/);
  }));

test('R3(QA 82 D2): chatgpt·claude3·ai_kenny·specVerifiedBy AI 핸들은 FAIL, kenny·daisy·maia 는 통과', () =>
  withRepo((dir) => {
    const ids = ['h-chatgpt', 'h-claude3', 'h-aikenny', 'h-spec', 'h-kenny', 'h-daisy', 'h-maia'];
    writeSeed(dir, 'taxa.json', ids.map((id) => row({ id, reviewStatus: 'NEEDS_REVIEW' })));
    commit(dir);
    writeSeed(dir, 'taxa.json', [
      row({ ...V, id: 'h-chatgpt', verifiedBy: 'chatgpt' }),
      row({ ...V, id: 'h-claude3', verifiedBy: 'claude3' }),
      row({ ...V, id: 'h-aikenny', verifiedBy: 'ai_kenny' }),
      row({ ...V, id: 'h-spec', verifiedBy: 'kenny', specVerifiedBy: 'Gemini-Pro' }),
      row({ ...V, id: 'h-kenny', verifiedBy: 'kenny' }),
      row({ ...V, id: 'h-daisy', verifiedBy: 'daisy' }),
      row({ ...V, id: 'h-maia', verifiedBy: 'maia' }),
    ]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 1, r.out);
    for (const id of ['h-chatgpt', 'h-claude3', 'h-aikenny']) assert.match(r.out, new RegExp(`FAIL taxa\\.json#${id}: R3 verifiedBy`));
    assert.match(r.out, /FAIL taxa\.json#h-spec: R3 specVerifiedBy/);
    for (const id of ['h-kenny', 'h-daisy', 'h-maia']) assert.doesNotMatch(r.out, new RegExp(`FAIL[^\\n]*${id}`));
  }));

test('잘못된 ref 는 exit 2', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row()]);
    commit(dir);
    assert.equal(run(dir, '--base', 'no-such-ref-xyz').code, 2);
    assert.equal(run(dir, '--base', 'HEAD', '--head', 'nope-xyz').code, 2);
  }));

test('인수 오류(--base 누락, 옵션처럼 보이는 ref, 알 수 없는 인수)는 exit 2', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row()]);
    commit(dir);
    assert.equal(run(dir).code, 2);
    assert.equal(run(dir, '--base').code, 2);
    assert.equal(run(dir, '--base', '--upload-pack=x').code, 2);
    assert.equal(run(dir, '--base', 'HEAD', '--bogus').code, 2);
  }));

test('서명 매니페스트 review-signatures.json 은 전이 검사 밖(항목 id 가 파일 간 겹쳐도 중복 id FAIL 아님)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ reviewerType: 'AI_DRAFT' })]);
    writeSeed(dir, 'review-signatures.json', []);
    commit(dir);
    const h = 'a'.repeat(64);
    writeSeed(dir, 'review-signatures.json', [
      { file: 'supply-items.json', id: 'x', basis: 'ROW_CHECKED', signedBy: 'kenny', signedAt: '2026-10-01', factHash: h },
      { file: 'setup-bundles.json', id: 'x', basis: 'AI_RESEARCH_BULK', signedBy: 'kenny', signedAt: '2026-10-01', factHash: h },
    ]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 0, r.out);
  }));
