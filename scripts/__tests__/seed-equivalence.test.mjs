// scripts/seed-equivalence.mjs 테스트 — 임시 폴더 픽스처만 사용(실제 시드 변경 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'seed-equivalence.mjs');

const row = (over = {}) => ({
  id: 'req-1', slug: 'a', supplyItemId: 'cage', orderHint: 'BEFORE_ARRIVAL',
  searchKeyword: '{animal} 케이지', why: '이유', caution: '주의', avoid: null,
  minSpec: { rules: [{ key: 'floorWcm', op: 'gte', value: 60, reason: 'r' }] },
  ...over,
});

function fixture(seedRows, draftRows) {
  const dir = mkdtempSync(join(tmpdir(), 'seed-eq-'));
  const seed = join(dir, 'seed');
  const draft = join(dir, 'draft');
  mkdirSync(seed);
  mkdirSync(join(draft, 'sub'), { recursive: true });
  writeFileSync(join(seed, 'supply-requirements.json'), JSON.stringify(seedRows));
  writeFileSync(join(draft, 'supply-requirements.json'), JSON.stringify(draftRows));
  // 하위 폴더는 무시되어야 한다(불일치 내용이어도).
  writeFileSync(join(draft, 'sub', 'supply-requirements.json'), JSON.stringify([row({ why: '다른 값' })]));
  return { dir, seed, draft };
}

const run = (f) => spawnSync(process.execPath, [SCRIPT, '--seed', f.seed, '--draft', f.draft], { encoding: 'utf8' });

test('라벨 편집만 다르면 exit 0', () => {
  const f = fixture([row()], [row({ slug: 'b', orderHint: 'AFTER_SETTLING', searchKeyword: '햄스터 케이지' })]);
  try { assert.equal(run(f).status, 0); } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('사실 필드(minSpec 값) 1개 변경이면 exit 1', () => {
  const changed = row({ minSpec: { rules: [{ key: 'floorWcm', op: 'gte', value: 50, reason: 'r' }] } });
  const f = fixture([row()], [changed]);
  try {
    const r = run(f);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /req-1\.minSpec/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('사실 필드 why 변경이면 exit 1, 사본에 행이 없어도 exit 1', () => {
  const f1 = fixture([row()], [row({ why: '바뀜' })]);
  const f2 = fixture([row()], []);
  try {
    assert.equal(run(f1).status, 1);
    assert.equal(run(f2).status, 1);
  } finally {
    rmSync(f1.dir, { recursive: true, force: true });
    rmSync(f2.dir, { recursive: true, force: true });
  }
});

test('인수 오류는 exit 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('서명 매니페스트 review-signatures.json: 정본·사본 통째로 같으면 0, 다르면 1(행 사실 비교 대신 전체 비교)', () => {
  const e = { file: 'supply-items.json', id: 'x', basis: 'ROW_CHECKED', signedBy: 'kenny', signedAt: '2026-10-01', factHash: 'a'.repeat(64) };
  const f = fixture([row()], [row()]);
  try {
    writeFileSync(join(f.seed, 'review-signatures.json'), JSON.stringify([e]));
    writeFileSync(join(f.draft, 'review-signatures.json'), JSON.stringify([e]));
    assert.equal(run(f).status, 0);
    writeFileSync(join(f.draft, 'review-signatures.json'), JSON.stringify([{ ...e, signedAt: '2026-10-02' }]));
    const r = run(f);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /review-signatures\.json: 서명 매니페스트가 정본과 사본이 다름/);
    rmSync(join(f.draft, 'review-signatures.json'));
    assert.equal(run(f).status, 1);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
