// .gitleaks.toml 프로젝트 규칙 적중 확인(N14). 가짜 값은 실행 시 조립 — 소스에 비밀 모양 문자열 0, 파일 쓰기 0(stdin).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const local = ['gitleaks.exe', 'gitleaks'].map((f) => resolve(ROOT, '.tools', 'gitleaks', f)).find((p) => existsSync(p));
const BIN = process.env.GITLEAKS_BIN || local || 'gitleaks';
const skip = spawnSync(BIN, ['version']).status === 0 ? false : 'gitleaks 바이너리 없음';

/** 걸린 규칙 id 목록(값은 --redact). */
function ruleIds(text) {
  const r = spawnSync(BIN, ['stdin', '--config', resolve(ROOT, '.gitleaks.toml'), '--redact', '--no-banner', '--log-level', 'error',
    '--exit-code', '0', '--report-format', 'json', '--report-path', '-'], { input: text, encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, 'gitleaks 실행 실패');
  return JSON.parse(r.stdout || '[]').map((x) => x.RuleID);
}
const fake = (n) => Array.from({ length: n }, (_, i) => 'q7Zk2mXv9RtB4nLc'[(i * 5) % 16]).join('');

const CASES = [
  ['COUPANG_PARTNERS_SECRET_KEY', 'withsmall-coupang-partners-secret', 40],
  ['ALIEXPRESS_APP_SECRET', 'withsmall-aliexpress-app-secret', 32],
];

for (const [name, id, len] of CASES) {
  test(`${id}: 가짜 값 적중(= · : · 따옴표)`, { skip }, () => {
    for (const line of [`${name}=${fake(len)}`, `${name}: '${fake(len)}'`, `${name} = "${fake(len)}"`]) {
      assert.ok(ruleIds(`${line}\n`).includes(id), `${id} 미적중`);
    }
  });
  test(`${id}: 빈 값·자리표시·env 참조는 적중 0`, { skip }, () => {
    const text = [`${name}=`, `${name}=<your-secret-here>`, `${name}=\${${name}}`, `${name}: env.${name}.trim()`, ''].join('\n');
    assert.ok(!ruleIds(text).includes(id));
  });
}

// 377 S5: *_SECRET 이 아닌 키 이름과 transport 자격 필드 이름(secretKey·appSecret — shop-api.mjs CRED_FIELD).
const ENV_ID_CASES = [
  ['COUPANG_PARTNERS_ACCESS_KEY', fake(36)],
  ['ALIEXPRESS_APP_KEY', fake(32)],
  ['ALIEXPRESS_APP_KEY', ['50', '1937', '28'].join('')],
  ['ALIEXPRESS_TRACKING_ID', fake(20)],
];
for (const [name, value] of ENV_ID_CASES) {
  test(`withsmall-shop-api-id: ${name} 가짜 값(${value.length}자) 적중`, { skip }, () => {
    for (const line of [`${name}=${value}`, `${name}: '${value}'`, `${name} = "${value}"`]) {
      assert.ok(ruleIds(`${line}\n`).includes('withsmall-shop-api-id'), '미적중');
    }
  });
}
for (const name of ['secretKey', 'appSecret']) {
  test(`withsmall-shop-api-secret-field: ${name} 따옴표 값 적중`, { skip }, () => {
    for (const line of [`{"${name}": "${fake(40)}"}`, `{ ${name}: '${fake(32)}' }`, `const ${name} = "${fake(32)}";`]) {
      assert.ok(ruleIds(`${line}\n`).includes('withsmall-shop-api-secret-field'), '미적중');
    }
  });
}
test('377 S5: 빈 값·자리표시·env 참조·필드 이름 매핑은 적중 0', { skip }, () => {
  const names = ['COUPANG_PARTNERS_ACCESS_KEY', 'ALIEXPRESS_APP_KEY', 'ALIEXPRESS_TRACKING_ID'];
  const text = [
    ...names.flatMap((n) => [`${n}=`, `# ${n}=`, `${n}=<your-value-here>`, `${n}=\${${n}}`, `${n}: env.${n}.trim()`]),
    "  COUPANG_PARTNERS_ACCESS_KEY: 'accessKey',",
    "  ALIEXPRESS_APP_KEY: 'appKey',",
    "  ALIEXPRESS_TRACKING_ID: 'trackingId',",
    '{"secretKey": ""}',
    '{"appSecret": "<your-secret>"}',
    'const o = { secretKey: creds.secretKey, appSecret: env.ALIEXPRESS_APP_SECRET };',
    "  COUPANG_PARTNERS_SECRET_KEY: 'secretKey',",
    "  ALIEXPRESS_APP_SECRET: 'appSecret',",
    '',
  ].join('\n');
  assert.deepEqual(ruleIds(text).filter((id) => id.startsWith('withsmall-')), []);
});
