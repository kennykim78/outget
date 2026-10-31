// gitleaks CI·훅 구조 단언(작업 247, 계획 243 C3 단계 7). 네트워크 0 — ci.yml·훅·핀 파일을 텍스트로만 본다.
//   핀 단일 원본: CI 는 scripts/gitleaks-pin.json 을 jq 로 읽는다(버전·sha256 을 ci.yml 에 중복 기재하지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const CI = read('.github/workflows/ci.yml');
const HOOK = read('.githooks/pre-commit');
const PIN = JSON.parse(read('scripts/gitleaks-pin.json'));

/** ci 잡의 단계 이름 순서(첫 잡 블록만 — docker·e2e 잡 제외). */
function ciStepNames() {
  const job = CI.slice(CI.indexOf('\n  ci:\n'), CI.indexOf('\n  docker:\n'));
  assert.ok(job.length > 0, 'ci 잡 블록 없음');
  return [...job.matchAll(/\n      - name: (.+)/g)].map((m) => m[1].trim());
}
/** 이름으로 단계 본문(다음 "- name:" 전까지). */
function stepBody(name) {
  const i = CI.indexOf(`- name: ${name}\n`);
  assert.ok(i >= 0, `단계 없음: ${name}`);
  const rest = CI.slice(i + 1);
  const j = rest.indexOf('\n      - name: ');
  return j < 0 ? rest : rest.slice(0, j);
}
const INSTALL = 'Install gitleaks (pinned version, sha256 verified)';
const HIST = 'Secret scan (gitleaks, full history)';
const DIST = 'Secret scan (gitleaks, build output)';

test('ci 잡: 설치 → 이력 스캔이 Checkout 바로 뒤·npm ci 앞, dist 스캔은 Build 뒤·Test 앞', () => {
  const n = ciStepNames();
  const at = (s) => { const k = n.indexOf(s); assert.ok(k >= 0, `단계 없음: ${s} / ${n.join(' | ')}`); return k; };
  assert.equal(at(INSTALL), at('Checkout') + 1);
  assert.equal(at(HIST), at(INSTALL) + 1);
  assert.ok(at(HIST) < at('Install (npm ci)'));
  assert.ok(at(DIST) > at('Build'));
  assert.ok(at(DIST) < at('Test (client)'));
});

test('ci 잡: 이력 스캔은 fetch-depth 0 + --log-opts=--all, 두 스캔 모두 --redact·--exit-code 1·--config .gitleaks.toml', () => {
  const ciJob = CI.split(/\n  docker:\n/)[0];
  assert.match(ciJob, /fetch-depth: 0/);
  const h = stepBody(HIST);
  assert.match(h, /gitleaks git /);
  assert.match(h, /--log-opts="--all"/);
  const d = stepBody(DIST);
  assert.match(d, /gitleaks dir [^\n]* client\/dist\n/);
  assert.match(d, /gitleaks dir [^\n]* server\/dist\n/);
  const calls = [...(h + d).matchAll(/gitleaks (?:git|dir) [^\n]*/g)].map((m) => m[0]);
  assert.equal(calls.length, 3);
  for (const c of calls) {
    for (const f of ['--redact', '--exit-code 1', '--config .gitleaks.toml', '--no-banner']) assert.ok(c.includes(f), `${f} 없음: ${c}`);
  }
});

test('설치 단계: 핀 파일에서 버전·linux sha256 을 읽고 sha256sum -c 로 검증한 뒤에만 푼다 — 버전·sha 하드코딩 0', () => {
  const s = stepBody(INSTALL);
  assert.match(s, /jq -er \.version "\$pin"/);
  assert.match(s, /jq -er \.sha256\.linux_x64 "\$pin"/);
  assert.match(s, /pin=scripts\/gitleaks-pin\.json/);
  assert.match(s, /set -eu/);
  const verify = s.indexOf('sha256sum -c');
  const extract = s.indexOf('tar -xzf');
  assert.ok(verify > 0 && extract > verify, '검증이 해제보다 먼저');
  assert.match(s, /test "\$\("\$dir\/gitleaks" version\)" = "\$ver"/);
  assert.ok(!s.includes(PIN.version), '버전 하드코딩 금지(핀이 단일 원본)');
  for (const v of Object.values(PIN.sha256)) assert.ok(!CI.includes(v), 'sha256 하드코딩 금지');
  assert.doesNotMatch(s, /checksums\.txt/);
  assert.match(s, /https:\/\/github\.com\/gitleaks\/gitleaks\/releases\/download\/v\$\{ver\}\/gitleaks_\$\{ver\}_linux_x64\.tar\.gz/);
});

test('공급망·권한: 서드파티 gitleaks 액션 미사용, 워크플로 권한 contents: read 만, gitleaks 단계에 secrets·토큰 0', () => {
  assert.doesNotMatch(CI, /uses:\s*[^\n]*gitleaks/i);
  assert.match(CI, /\npermissions:\n  contents: read\n\njobs:/);
  assert.doesNotMatch(CI.split(/\njobs:\n/)[1], /\n    permissions:/);
  for (const name of [INSTALL, HIST, DIST]) {
    const b = stepBody(name);
    assert.doesNotMatch(b, /secrets\.|github\.token|GITHUB_TOKEN|env:/, name);
  }
  // checkout 은 자격 증명을 남기지 않는다(이력 스캔이 git 을 돌려도 토큰 0).
  for (const m of CI.matchAll(/uses: actions\/checkout@[^\n]+\n        with:\n((?:          [^\n]+\n)+)/g)) {
    assert.match(m[1], /persist-credentials: false/);
  }
});

test('pre-commit 훅: --pre-commit --staged·--redact·--exit-code 1, 바이너리 없으면 exit 1(fail-closed), 우회 안내 금지', () => {
  assert.ok(HOOK.startsWith('#!/bin/sh\n'));
  assert.ok(!/\r/.test(readFileSync(resolve(ROOT, '.githooks/pre-commit'), 'utf8')), '훅은 LF');
  assert.match(HOOK, /git --pre-commit --staged /);
  for (const f of ['--redact', '--exit-code 1', '--config "$root/.gitleaks.toml"']) assert.ok(HOOK.includes(f), f);
  assert.match(HOOK, /gitleaks 를 찾지 못해 커밋을 막았다[\s\S]*?exit 1/);
  assert.doesNotMatch(HOOK, /\n[^#\n]*--no-verify[^\n]*로 (?:넘|건너)/);
  assert.match(read('.gitattributes'), /^\.githooks\/\* text eol=lf$/m);
});

test('.gitleaks.toml: 기본 규칙 유지, 허용 경로는 파일 단위 3개 이하(폴더 와일드카드 0)', () => {
  const t = read('.gitleaks.toml');
  assert.match(t, /\[extend\]\nuseDefault = true/);
  assert.doesNotMatch(t, /disabledRules/);
  const paths = [...t.matchAll(/'''(\^[^']+)'''/g)].map((m) => m[1]).filter((p) => p.startsWith('^') && p.endsWith('$'));
  assert.ok(paths.length >= 1 && paths.length <= 3, String(paths));
  for (const p of paths) assert.doesNotMatch(p, /\.\*|\*\*|\/\$$/, `폴더 와일드카드 금지: ${p}`);
});

test('.gitleaksignore: 지문 줄마다 바로 위에 사유 주석 2줄(사유 / 판정일·판정자)', () => {
  const lines = read('.gitleaksignore').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || lines[i].startsWith('#')) continue;
    assert.match(lines[i], /^[0-9a-f]{40}:[^:]+:[a-z0-9-]+:\d+$/, `지문 형식: 줄 ${i + 1}`);
    assert.ok(lines[i - 1]?.startsWith('# ') && lines[i - 2]?.startsWith('# '), `사유 주석 없음: 줄 ${i + 1}`);
    assert.match(lines[i - 1], /\d{4}-\d{2}-\d{2}/, `판정일 없음: 줄 ${i + 1}`);
  }
});
