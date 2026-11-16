// E2E 글로벌 셋업 — (1) 현재 트리 클라이언트를 리포 밖 임시 폴더로 빌드 (2) 시드 사이트 생성 + (3) 실제 서버(createApp) 기동.
//   E2E_SEED=demo(기본) | real   — demo: 메모리 승격 데모 시드, real: server/seed 그대로(review 단계 NEEDS_REVIEW·DRAFT, VERIFIED 0 → 빈 상태).
//   E2E_CLIENT_DIST=<dir>        — 이미 빌드된 클라이언트 재사용(로컬 반복용, 리포 밖 경로만). 미지정이면 매번 새로 빌드.
//   E2E_KEEP=1                   — 종료 후 임시 폴더를 지우지 않는다(디버깅).
//   E2E_BELOW_MIN=0              — 데모 시드의 최소 규격 미달 상품 변형(serve.mts --below-min)을 끈다(기본 켬).
//   테스트에 넘기는 값(env): E2E_BASE_URL · E2E_SITE_DIR · E2E_MAIL_FILE · E2E_WORK_DIR · E2E_SEED_MODE · E2E_SEED_DIGEST_BEFORE · E2E_BELOW_MIN_SEEDED(1|0).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { REPO_ROOT, isInsideRepo, seedFilesDigest } from './repo';

const READY = 'E2E_READY ';
const READY_TIMEOUT_MS = 120_000;

function seedMode(): 'demo' | 'real' {
  const v = (process.env.E2E_SEED ?? 'demo').trim();
  if (v !== 'demo' && v !== 'real') throw new Error(`E2E_SEED 는 demo | real: ${v}`);
  return v;
}

function buildClient(outDir: string): void {
  const clientDir = join(REPO_ROOT, 'client');
  const viteBin = join(dirname(require.resolve('vite/package.json', { paths: [clientDir] })), 'bin', 'vite.js');
  const r = spawnSync(process.execPath, [viteBin, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: clientDir,
    // 지도 키는 비운다(외부 스크립트 0 — 병원 페이지는 목록만). client/.env 값보다 process.env 가 우선한다.
    env: { ...process.env, VITE_NAVER_MAP_CLIENT_ID: '' },
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`e2e: 클라이언트 빌드 실패(exit ${r.status})`);
}

function startServer(args: string[]): Promise<{ child: ChildProcess; origin: string }> {
  const tsxCli = require.resolve('tsx/cli', { paths: [REPO_ROOT] });
  const child = spawn(process.execPath, [tsxCli, join(REPO_ROOT, 'e2e', 'support', 'serve.mts'), ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`e2e: 서버가 ${READY_TIMEOUT_MS}ms 안에 준비되지 않았다`));
    }, READY_TIMEOUT_MS);
    const onExit = (code: number | null): void => {
      clearTimeout(timer);
      fail(new Error(`e2e: 서버 프로세스가 준비 전에 종료(exit ${code})`));
    };
    child.once('exit', onExit);
    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      if (line.startsWith(READY)) {
        clearTimeout(timer);
        child.off('exit', onExit);
        const { origin } = JSON.parse(line.slice(READY.length)) as { origin: string };
        ok({ child, origin });
        return;
      }
      process.stdout.write(`[e2e-server] ${line}\n`);
    });
  });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((done) => {
    const force = setTimeout(() => {
      child.kill('SIGKILL');
      done();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(force);
      done();
    });
    child.stdin?.end();
    child.kill('SIGTERM');
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const t0 = Date.now();
  const lap = (what: string): void => {
    process.stdout.write(`[e2e] ${what} +${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  };
  const mode = seedMode();
  const work = mkdtempSync(join(tmpdir(), 'ws-e2e-'));
  if (isInsideRepo(work)) throw new Error(`e2e: 임시 폴더가 리포 안이다(${work})`);

  const cleanup = (): void => {
    if (process.env.E2E_KEEP !== '1') rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  };

  let child: ChildProcess;
  let origin: string;
  let site: string;
  let mail: string;
  let digestBefore: string;
  try {
    let clientDist = process.env.E2E_CLIENT_DIST?.trim();
    if (clientDist) {
      if (isInsideRepo(clientDist)) throw new Error(`e2e: E2E_CLIENT_DIST 는 리포 밖만(${clientDist})`);
      if (!existsSync(join(clientDist, 'index.html'))) throw new Error(`e2e: ${clientDist}/index.html 없음`);
    } else {
      clientDist = join(work, 'client-dist');
      buildClient(clientDist);
    }
    lap('client ready');

    site = join(work, 'site');
    mail = join(work, 'mail.jsonl');
    digestBefore = seedFilesDigest();
    // 데모: 최소 규격 미달 상품 1건을 메모리 시드에 더한다(X2 불변식 ③ — 추천 영역 0 단언). E2E_BELOW_MIN=0 이면 끈다.
    const belowMin = mode === 'demo' && process.env.E2E_BELOW_MIN !== '0' ? 'on' : 'off';
    process.env.E2E_BELOW_MIN_SEEDED = belowMin === 'on' ? '1' : '0';
    ({ child, origin } = await startServer(['--mode', mode, '--client', clientDist, '--site', site, '--mail', mail, '--below-min', belowMin]));
  } catch (e) {
    // 셋업 실패 시 teardown 이 불리지 않는다 — 임시 폴더를 여기서 정리.
    cleanup();
    throw e;
  }

  lap('server ready');
  process.env.E2E_BASE_URL = origin;
  process.env.E2E_SITE_DIR = site;
  process.env.E2E_MAIL_FILE = mail;
  process.env.E2E_WORK_DIR = work;
  process.env.E2E_SEED_MODE = mode;
  process.env.E2E_SEED_DIGEST_BEFORE = digestBefore;
  process.stdout.write(`[e2e] seed=${mode} base=${origin} work=${work}\n`);

  return async () => {
    const t1 = Date.now();
    await stopServer(child);
    cleanup();
    process.stdout.write(`[e2e] teardown ${((Date.now() - t1) / 1000).toFixed(1)}s\n`);
  };
}
