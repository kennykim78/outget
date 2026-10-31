#!/usr/bin/env node
// git 훅 등록 — 저장소 로컬 설정 core.hooksPath = .githooks (작업 247 / 계획 243 C2). 멱등. npm 의존성 0.
//   package.json "prepare" 에 넣지 않는다(Dockerfile 의 npm ci 는 .git 이 없는 곳에서 돈다) — 클론마다 한 번 수동 실행.
//   사용: npm run hooks:install            → 등록
//         npm run hooks:install -- --uninstall → 해제(값이 .githooks 일 때만 unset)
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOKS_DIR = '.githooks';
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
const current = () => {
  try {
    return git('config', '--local', '--get', 'core.hooksPath');
  } catch {
    return '';
  }
};

function main(argv) {
  if (argv.includes('--uninstall')) {
    if (current() === HOOKS_DIR) git('config', '--local', '--unset', 'core.hooksPath');
    console.log(`core.hooksPath 해제(현재: ${current() || '(없음)'})`);
    return;
  }
  const hook = join(ROOT, HOOKS_DIR, 'pre-commit');
  if (!existsSync(hook)) throw new Error(`${HOOKS_DIR}/pre-commit 없음`);
  if (process.platform !== 'win32') chmodSync(hook, 0o755);
  if (current() !== HOOKS_DIR) git('config', '--local', 'core.hooksPath', HOOKS_DIR);
  console.log(`core.hooksPath = ${current()}`);
  const bin = ['gitleaks.exe', 'gitleaks'].map((f) => join(ROOT, '.tools', 'gitleaks', f)).find(existsSync);
  if (!bin && !process.env.GITLEAKS_BIN) {
    console.log('참고: .tools/gitleaks 가 없다 — npm run gitleaks:install (없으면 pre-commit 이 커밋을 막는다).');
  }
}

try {
  main(process.argv.slice(2));
} catch (e) {
  console.error(`[hooks:install] ${e.message}`);
  process.exit(1);
}
