// scripts/dev/install-gitleaks.mjs — 핀 무결성(작업 247, 계획 243 T6). 네트워크 0: --archive 로 로컬 파일만 검증한다.
//   sha256 이 핀과 다르면 exit 1 + 대상 폴더에 실행 파일 미생성. 핀 형식 오류도 fail-closed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORMS, readPin, assetName } from '../dev/install-gitleaks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', 'dev', 'install-gitleaks.mjs');
const REAL_PIN = resolve(HERE, '..', 'gitleaks-pin.json');
const TMP = mkdtempSync(join(tmpdir(), 'ws-gl-install-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const plat = PLATFORMS[`${process.platform}-${process.arch}`];
const sum = (buf) => createHash('sha256').update(buf).digest('hex');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function pinWith(linux, windows, version = '8.30.1') {
  const p = join(TMP, `pin-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify({ version, sha256: { linux_x64: linux, windows_x64: windows } }));
  return p;
}

test('저장소 핀: version 은 x.y.z, sha256 은 linux_x64·windows_x64 64자 소문자 hex', () => {
  const pin = readPin(REAL_PIN);
  assert.match(pin.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(pin.sha256).sort(), ['linux_x64', 'windows_x64']);
  // C7 자기 오탐 회피 — 핀 파일의 키 이름에 hash·key·secret·token 없음.
  assert.doesNotMatch(readFileSync(REAL_PIN, 'utf8'), /hash|key|secret|token/i);
});

test('자산 이름: 공식 릴리스 형식', () => {
  assert.equal(assetName('8.30.1', PLATFORMS['win32-x64']), 'gitleaks_8.30.1_windows_x64.zip');
  assert.equal(assetName('8.30.1', PLATFORMS['linux-x64']), 'gitleaks_8.30.1_linux_x64.tar.gz');
});

test('T6: sha256 불일치 → exit 1, 설치 거부, 대상 폴더에 실행 파일 미생성', { skip: !plat && 'unsupported platform' }, () => {
  const arc = join(TMP, 'fake-archive.bin');
  writeFileSync(arc, 'not the release archive');
  const wrong = 'f'.repeat(64);
  const dest = join(TMP, 'dest-wrong');
  const r = run(['--pin', pinWith(wrong, wrong), '--dest', dest, '--archive', arc]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /sha256 불일치/);
  assert.ok(!existsSync(dest) || readdirSync(dest).length === 0, '대상 폴더가 비어 있어야 한다');
});

test('핀 형식 오류(짧은 sha·대문자·version 형식) → exit 1, 미생성', { skip: !plat && 'unsupported platform' }, () => {
  const arc = join(TMP, 'fake2.bin');
  writeFileSync(arc, 'x');
  const good = sum(readFileSync(arc));
  for (const pin of [pinWith('abc', good), pinWith(good.toUpperCase(), good.toUpperCase()), pinWith(good, good, 'v8.30.1')]) {
    const dest = join(TMP, `dest-bad-${Math.random().toString(36).slice(2)}`);
    const r = run(['--pin', pin, '--dest', dest, '--archive', arc]);
    assert.equal(r.status, 1, r.stderr);
    assert.ok(!existsSync(dest), '검증 실패면 대상 폴더도 만들지 않는다');
  }
});

test('sha256 은 맞지만 아카이브에 실행 파일이 없음 → exit 1, 실행 파일 미생성(작업 폴더 정리)', { skip: !plat && 'unsupported platform' }, () => {
  const arc = join(TMP, 'not-an-archive.bin');
  writeFileSync(arc, 'plain bytes, not zip or tar');
  const s = sum(readFileSync(arc));
  const dest = join(TMP, 'dest-noexe');
  const r = run(['--pin', pinWith(s, s), '--dest', dest, '--archive', arc]);
  assert.equal(r.status, 1, r.stderr);
  assert.ok(!existsSync(join(dest, plat.exe)), '실행 파일이 없어야 한다');
  assert.deepEqual(existsSync(dest) ? readdirSync(dest) : [], [], '.work- 임시 폴더도 남지 않는다');
});
