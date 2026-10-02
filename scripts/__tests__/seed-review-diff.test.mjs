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

test('이미 VERIFIED 였던 행 유지는 통과(0)', () =>
  withRepo((dir) => {
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-01' })]);
    commit(dir);
    writeSeed(dir, 'taxa.json', [row({ ...V, verifiedAt: '2026-09-01', note: 'x' })]);
    const r = run(dir, '--base', 'HEAD');
    assert.equal(r.code, 0, r.out);
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
