// scripts/prune-backups.sh — 개수 + 나이 정리, 짝 파일 동반 삭제, 잘못된 설정 거부(L-4).
// sh 는 PATH 의 sh, Windows 에선 Git Bash 경로를 찾는다. 없으면 skip 이 아니라 실패(CI = Linux).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, utimesSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = resolve(ROOT, 'scripts', 'prune-backups.sh').replace(/\\/g, '/');
const DAY = 86400;

function findSh() {
  const candidates = ['sh'];
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')]) {
      if (base) candidates.push(join(base, 'Git', 'usr', 'bin', 'sh.exe'), join(base, 'Git', 'bin', 'sh.exe'));
    }
  }
  for (const c of candidates) {
    if (c !== 'sh' && !existsSync(c)) continue;
    const r = spawnSync(c, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === 'ok') return c;
  }
  throw new Error('POSIX sh 를 찾지 못했다(Windows 는 Git for Windows 필요)');
}

const SH = findSh();

function run(dir, env) {
  return spawnSync(SH, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, WS_BACKUP_DIR: dir.replace(/\\/g, '/'), ...env },
  });
}

function touchAged(dir, name, ageDays) {
  const p = join(dir, name);
  writeFileSync(p, 'x');
  const t = Date.now() / 1000 - ageDays * DAY - 3600;
  utimesSync(p, t, t);
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ws-prune-'));
  // 이름 = 시간순(사전순). age(일): 10, 9, 6, 5, 4, 3, 2, 1
  const ages = [10, 9, 6, 5, 4, 3, 2, 1];
  ages.forEach((age, i) => touchAged(dir, `prod-20260101T0000${String(i).padStart(2, '0')}Z.db`, age));
  touchAged(dir, 'prod-20260101T000000Z.db-journal', 10); // 나이로 삭제될 것의 짝
  touchAged(dir, 'prod-20260101T000002Z.db-wal', 6); // 개수로 삭제될 것의 짝
  touchAged(dir, 'prod-20260101T000003Z.db-wal', 5); // 보존될 것의 짝
  return dir;
}

test('나이(7일)·개수(5) 규칙 + 짝 파일 동반 삭제', () => {
  const dir = fixture();
  try {
    const r = run(dir, { WS_BACKUP_KEEP: '5', WS_BACKUP_MAX_AGE_DAYS: '7' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(dir).sort(), [
      'prod-20260101T000003Z.db',
      'prod-20260101T000003Z.db-wal',
      'prod-20260101T000004Z.db',
      'prod-20260101T000005Z.db',
      'prod-20260101T000006Z.db',
      'prod-20260101T000007Z.db',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('개수만 좁히면(KEEP=2) 최신 2개만 남는다', () => {
  const dir = fixture();
  try {
    const r = run(dir, { WS_BACKUP_KEEP: '2', WS_BACKUP_MAX_AGE_DAYS: '7' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(dir).sort(), ['prod-20260101T000006Z.db', 'prod-20260101T000007Z.db']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('나이만 좁히면(MAX_AGE=3, KEEP=99) 3일 넘은 것이 사라진다', () => {
  const dir = fixture();
  try {
    const r = run(dir, { WS_BACKUP_KEEP: '99', WS_BACKUP_MAX_AGE_DAYS: '3' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(
      readdirSync(dir).filter((f) => f.endsWith('.db')).sort(),
      ['prod-20260101T000006Z.db', 'prod-20260101T000007Z.db'], // 3일+1시간 된 것도 now − 3×24h 보다 오래라 삭제
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WS_BACKUP_KEEP 0·음수·비숫자 / MAX_AGE 잘못된 값은 거부(에러 종료, 삭제 0)', () => {
  const dir = fixture();
  try {
    const before = readdirSync(dir).sort();
    for (const env of [
      { WS_BACKUP_KEEP: '0' },
      { WS_BACKUP_KEEP: '-1' },
      { WS_BACKUP_KEEP: 'abc' },
      { WS_BACKUP_KEEP: '' + '2.5' },
      { WS_BACKUP_MAX_AGE_DAYS: '0' },
      { WS_BACKUP_MAX_AGE_DAYS: 'x' },
    ]) {
      const r = run(dir, env);
      assert.notEqual(r.status, 0, JSON.stringify(env));
      assert.match(r.stderr, /invalid WS_BACKUP_/, JSON.stringify(env));
      assert.deepEqual(readdirSync(dir).sort(), before, JSON.stringify(env));
    }
    assert.equal(run(dir, { WS_BACKUP_KEEP: '0' }).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--check 는 검증만 하고 지우지 않는다', () => {
  const dir = fixture();
  try {
    const before = readdirSync(dir).sort();
    const ok = spawnSync(SH, [SCRIPT, '--check'], { encoding: 'utf8', env: { ...process.env, WS_BACKUP_DIR: dir.replace(/\\/g, '/') } });
    assert.equal(ok.status, 0);
    assert.deepEqual(readdirSync(dir).sort(), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('나이 경계: 정확히 7일 − 1시간은 남고, 7일 + 1시간은 지워진다(런타임 now − N×24h 와 일치)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ws-prune-'));
  try {
    const set = (name, ageSec) => {
      const p = join(dir, name);
      writeFileSync(p, 'x');
      const t = Date.now() / 1000 - ageSec;
      utimesSync(p, t, t);
    };
    set('prod-20260101T000001Z.db', 7 * DAY + 3600); // 7일 1시간 → 삭제
    set('prod-20260101T000002Z.db', 7 * DAY - 3600); // 6일 23시간 → 보존
    set('prod-20260101T000003Z.db', 7.5 * DAY); // 7.5일 → 삭제(-mtime +7 은 8일부터라 남겼을 경계)
    const r = run(dir, { WS_BACKUP_KEEP: '99', WS_BACKUP_MAX_AGE_DAYS: '7' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(dir).sort(), ['prod-20260101T000002Z.db']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('101 MED-1: MAX_AGE > 정책 7일은 거부(종료 2, 삭제 0) — --check 도 같은 규칙, 7 은 통과', () => {
  const dir = fixture();
  try {
    const before = readdirSync(dir).sort();
    for (const age of ['8', '30']) {
      const r = run(dir, { WS_BACKUP_MAX_AGE_DAYS: age });
      assert.equal(r.status, 2, age);
      assert.match(r.stderr, /invalid WS_BACKUP_MAX_AGE_DAYS='\d+' \(7 이하/);
      assert.deepEqual(readdirSync(dir).sort(), before, age);
      const chk = spawnSync(SH, [SCRIPT, '--check'], {
        encoding: 'utf8',
        env: { ...process.env, WS_BACKUP_DIR: dir.replace(/\\/g, '/'), WS_BACKUP_MAX_AGE_DAYS: age },
      });
      assert.equal(chk.status, 2, `--check ${age}`);
    }
    const ok = spawnSync(SH, [SCRIPT, '--check'], { encoding: 'utf8', env: { ...process.env, WS_BACKUP_DIR: dir.replace(/\\/g, '/'), WS_BACKUP_MAX_AGE_DAYS: '7' } });
    assert.equal(ok.status, 0, ok.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('101 MED-1 패리티: sh POLICY_MAX_AGE = policy.ts BACKUP_RETENTION_DAYS', () => {
  const sh = readFileSync(SCRIPT, 'utf8').match(/^POLICY_MAX_AGE=(\d+)$/m);
  const ts = readFileSync(resolve(ROOT, 'server', 'src', 'privacy', 'policy.ts'), 'utf8').match(/export const BACKUP_RETENTION_DAYS = (\d+);/);
  assert.ok(sh && ts);
  assert.equal(sh[1], ts[1]);
});
