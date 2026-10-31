#!/usr/bin/env node
// gitleaks 로컬 설치 — 개발 전용 도구(작업 247, 계획 243 K-1). CI·빌드·서버·컨테이너에 포함하지 않는다.
//   핀(scripts/gitleaks-pin.json)의 버전·sha256 으로 GitHub Releases 의 공식 아카이브 1개를 받아 **검증 후에만**
//   저장소 안 .tools/gitleaks/(git 무시)에 gitleaks 실행 파일 하나만 꺼낸다. 시스템 PATH·winget·scoop 은 건드리지 않는다.
//   sha256 이 핀과 다르면 아무 파일도 쓰지 않고 exit 1. 같은 릴리스의 checksums.txt 는 받지 않는다(같은 출처 — 핀이 기준).
//   불변식 1(크롤링 금지)과 무관: 상품·외부 사이트 본문·이미지가 아니라 개발 도구 바이너리. C1-FETCH 예외는 이 파일·github.com 하나.
//
//   사용: npm run gitleaks:install   (= node scripts/dev/install-gitleaks.mjs)
//   옵션(시험용): --pin <json> · --dest <dir> · --archive <로컬 아카이브 — 내려받기 생략, 같은 sha256 검증>
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PLATFORMS = Object.freeze({
  'win32-x64': Object.freeze({ id: 'windows_x64', ext: 'zip', exe: 'gitleaks.exe' }),
  'linux-x64': Object.freeze({ id: 'linux_x64', ext: 'tar.gz', exe: 'gitleaks' }),
});

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SUM_RE = /^[0-9a-f]{64}$/;

/** 핀 파일 검증 — 형식이 어긋나면 throw(fail-closed). */
export function readPin(path) {
  const pin = JSON.parse(readFileSync(path, 'utf8'));
  if (!pin || typeof pin.version !== 'string' || !VERSION_RE.test(pin.version)) throw new Error('핀 version 형식 오류');
  if (!pin.sha256 || typeof pin.sha256 !== 'object') throw new Error('핀 sha256 누락');
  for (const p of Object.values(PLATFORMS)) {
    if (typeof pin.sha256[p.id] !== 'string' || !SUM_RE.test(pin.sha256[p.id])) throw new Error(`핀 sha256.${p.id} 형식 오류`);
  }
  return pin;
}

export const assetName = (version, plat) => `gitleaks_${version}_${plat.id}.${plat.ext}`;
export const sha256Of = (buf) => createHash('sha256').update(buf).digest('hex');

function parseArgs(argv) {
  const o = { pin: join(ROOT, 'scripts', 'gitleaks-pin.json'), dest: join(ROOT, '.tools', 'gitleaks'), archive: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--pin' && v) { o.pin = resolve(v); i++; }
    else if (a === '--dest' && v) { o.dest = resolve(v); i++; }
    else if (a === '--archive' && v) { o.archive = resolve(v); i++; }
    else throw new Error(`알 수 없는 인수: ${a}`);
  }
  return o;
}

/** Windows 는 내장 bsdtar(zip 지원)를 절대 경로로 — Git Bash 의 GNU tar 는 zip 을 못 푼다. */
function tarBin() {
  if (process.platform !== 'win32') return 'tar';
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
}

async function download(version, asset) {
  const res = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${version}/${asset}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`내려받기 실패: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const plat = PLATFORMS[`${process.platform}-${process.arch}`];
  if (!plat) throw new Error(`지원하지 않는 플랫폼: ${process.platform}-${process.arch} — docs/ops/secret-scan.md 의 수동 설치 절차를 따른다`);
  const pin = readPin(opts.pin);
  const asset = assetName(pin.version, plat);
  const want = pin.sha256[plat.id];

  const buf = opts.archive ? readFileSync(opts.archive) : await download(pin.version, asset);
  const got = sha256Of(buf);
  if (got !== want) {
    // 검증 전에는 디스크에 아무것도 쓰지 않았다 — 바이너리 미생성.
    throw new Error(`sha256 불일치 — 설치 거부(${asset}). 핀: ${want} / 받은 파일: ${got}`);
  }

  mkdirSync(opts.dest, { recursive: true });
  const work = mkdtempSync(join(opts.dest, '.work-'));
  try {
    const arc = join(work, asset);
    writeFileSync(arc, buf);
    // 실행 파일 하나만 꺼낸다(README·LICENSE 는 꺼내지 않음 — 저장소 스캔 대상에 텍스트를 늘리지 않는다).
    execFileSync(tarBin(), ['-xf', arc, '-C', work, plat.exe], { stdio: ['ignore', 'ignore', 'inherit'] });
    const extracted = join(work, plat.exe);
    if (!existsSync(extracted)) throw new Error('아카이브에 실행 파일이 없다');
    if (process.platform !== 'win32') chmodSync(extracted, 0o755);
    const ver = execFileSync(extracted, ['version'], { encoding: 'utf8' }).trim();
    if (ver !== pin.version) throw new Error(`버전 불일치: 핀 ${pin.version} / 실행 파일 ${ver}`);
    const target = join(opts.dest, plat.exe);
    rmSync(target, { force: true });
    renameSync(extracted, target);
    console.log(`gitleaks ${ver} 설치: ${target}`);
    return target;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[gitleaks:install] ${e.message}`);
    process.exit(1);
  });
}
