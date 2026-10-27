// deploy/deploy.sh(배포·헬스·자동 롤백·배포 전 백업 복원) + deploy/deploy-gate.sh(SSH 강제 명령 허용 목록).
//   실제 도커 대신 fixtures/fake-docker.sh. sh 는 PATH 의 sh, Windows 는 Git Bash(없으면 실패 — CI = Linux).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fwd = (p) => p.replace(/\\/g, '/');
const DEPLOY_SH = fwd(resolve(ROOT, 'deploy', 'deploy.sh'));
const GATE_SH = fwd(resolve(ROOT, 'deploy', 'deploy-gate.sh'));
const FAKE = fwd(resolve(ROOT, 'scripts', '__tests__', 'fixtures', 'fake-docker.sh'));
const REPO = 'ghcr.io/owner/withsmall';
const T1 = 'sha-aaaaaaaaaaaa';
const T2 = 'sha-bbbbbbbbbbbb';
const T3 = 'sha-cccccccccccc';
const WIN = process.platform === 'win32';

function findSh() {
  const candidates = ['sh'];
  if (WIN) {
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
try {
  chmodSync(FAKE, 0o755);
} catch {
  /* Windows: 모드 비트 무관(shebang 실행) */
}

function host() {
  const root = mkdtempSync(join(tmpdir(), 'ws-deploy-'));
  const fake = join(root, '_fake');
  mkdirSync(join(fake, 'mig'), { recursive: true });
  mkdirSync(join(root, 'data', 'backup'), { recursive: true });
  writeFileSync(join(root, 'deploy.conf'), `WS_IMAGE_REPO=${REPO}\n`);
  writeFileSync(join(root, 'server.env'), 'NODE_ENV=production\nJWT_ACCESS_SECRET=x\n', { mode: 0o600 });
  writeFileSync(join(root, 'caddy.env'), "WS_BASIC_USER=u\nWS_BASIC_HASH='h'\n", { mode: 0o600 });
  writeFileSync(join(root, 'compose.yaml'), 'name: withsmall\n');
  writeFileSync(join(root, 'Caddyfile'), '');
  return { root, fake };
}

function deploy(h, args, extraEnv = {}) {
  return spawnSync(SH, [DEPLOY_SH, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      WS_ROOT: fwd(h.root),
      WS_DOCKER: FAKE,
      WS_HOST_ARCH: 'aarch64',
      WS_HEALTH_TIMEOUT: '2',
      WS_HEALTH_INTERVAL: '0',
      WS_SKIP_MODE_CHECK: WIN ? '1' : '0',
      FAKE_DIR: fwd(h.fake),
      FAKE_DATA: fwd(join(h.root, 'data')),
      ...extraEnv,
    },
  });
}

const st = (h, name) => (existsSync(join(h.root, 'state', name)) ? readFileSync(join(h.root, 'state', name), 'utf8').trim() : null);
const running = (h) => readFileSync(join(h.fake, 'running'), 'utf8').trim();
const calls = (h) => (existsSync(join(h.fake, 'calls.log')) ? readFileSync(join(h.fake, 'calls.log'), 'utf8') : '');
const out = (r) => `${r.stdout}\n${r.stderr}`;

test('첫 배포: pull → up → healthy → state current, previous 없음', () => {
  const h = host();
  try {
    const r = deploy(h, ['deploy', T1]);
    assert.equal(r.status, 0, out(r));
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
    assert.equal(st(h, 'previous'), null);
    assert.equal(running(h), `${REPO}:${T1}`);
    assert.equal(readFileSync(join(h.root, 'state', 'image.env'), 'utf8'), `WS_IMAGE=${REPO}:${T1}\n`);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('두 번째 배포: 배포 전 백업(prod-*-predeploy.db) + previous 기록 + 이전 2개 밖 이미지 정리', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(join(h.root, 'data', 'prod.db'), 'v1');
    assert.equal(deploy(h, ['deploy', T2]).status, 0);
    writeFileSync(join(h.root, 'data', 'prod.db'), 'v2');
    const r = deploy(h, ['deploy', T3]);
    assert.equal(r.status, 0, out(r));
    assert.equal(st(h, 'current'), `${REPO}:${T3}`);
    assert.equal(st(h, 'previous'), `${REPO}:${T2}`);
    const pre = st(h, 'predeploy');
    assert.match(pre, /^prod-\d{8}T\d{6}Z-predeploy\.db$/);
    assert.equal(readFileSync(join(h.root, 'data', 'backup', pre), 'utf8'), 'v2');
    // 이름이 prod-*.db 라 컨테이너 prune-backups.sh(7일·5개)가 함께 정리한다.
    assert.match(pre, /^prod-.*\.db$/);
    const imgs = readFileSync(join(h.fake, 'images'), 'utf8').trim().split('\n').sort();
    assert.deepEqual(imgs, [`${REPO}:${T2}`, `${REPO}:${T3}`]);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('헬스 실패(마이그레이션 같음): 이전 이미지로 자동 롤백, 종료 1, state 그대로, DB 복원 안 함', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(join(h.root, 'data', 'prod.db'), 'v1');
    writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T2}\n`);
    const r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /자동 롤백/);
    assert.equal(running(h), `${REPO}:${T1}`);
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
    assert.equal(st(h, 'previous'), null);
    assert.equal(readFileSync(join(h.root, 'data', 'prod.db'), 'utf8'), 'v1');
    assert.doesNotMatch(out(r), /배포 전 백업 복원/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('헬스 실패(마이그레이션 다름): 배포 전 백업을 복원한 뒤 이전 이미지로 기동', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(join(h.root, 'data', 'prod.db'), 'v1');
    writeFileSync(join(h.fake, 'mig', T2), '0001_init 0002_new ');
    writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T2}\n`);
    writeFileSync(join(h.fake, 'mutate'), `${REPO}:${T2}\n`);
    const r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /배포 전 백업 복원/);
    assert.equal(readFileSync(join(h.root, 'data', 'prod.db'), 'utf8'), 'v1');
    assert.equal(running(h), `${REPO}:${T1}`);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('롤백도 실패하면 종료 3', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T1}\n${REPO}:${T2}\n`);
    const r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 3, out(r));
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('아키텍처 불일치·pull 실패·잘못된 태그·env 자리표시는 기동 전에 멈춘다', () => {
  const h = host();
  try {
    let r = deploy(h, ['deploy', T1], { FAKE_ARCH: 'amd64' });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /아키텍처/);
    assert.doesNotMatch(calls(h), /compose .* up/);

    writeFileSync(join(h.fake, 'nopull'), `${REPO}:${T1}\n`);
    r = deploy(h, ['deploy', T1]);
    assert.equal(r.status, 1);
    assert.match(out(r), /pull 실패/);
    rmSync(join(h.fake, 'nopull'));

    for (const bad of ['sha-AAAAAAAAAAAA', 'sha-aaaa', 'sha-aaaaaaaaaaaaa', 'latest', 'sha-aaaaaaaaaaa;']) {
      r = deploy(h, ['deploy', bad]);
      assert.equal(r.status, 2, bad);
    }
    assert.equal(deploy(h, ['deploy', T1, 'extra']).status, 2);
    assert.equal(deploy(h, ['nope']).status, 2);

    writeFileSync(join(h.root, 'caddy.env'), "WS_BASIC_USER=__SET_ME__\nWS_BASIC_HASH='__SET_ME__'\n", { mode: 0o600 });
    r = deploy(h, ['deploy', T1]);
    assert.equal(r.status, 1);
    assert.match(out(r), /__SET_ME__/);
    assert.equal(st(h, 'current'), null);
    assert.doesNotMatch(calls(h), /compose .* up/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('env 파일 권한이 600 이 아니면 거부(Linux 만 — Windows 는 모드 비트 없음)', { skip: WIN }, () => {
  const h = host();
  try {
    chmodSync(join(h.root, 'server.env'), 0o644);
    const r = deploy(h, ['deploy', T1]);
    assert.equal(r.status, 1);
    assert.match(out(r), /600/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('rollback: current ↔ previous, 마이그레이션 다르면 배포 전 백업 복원', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(join(h.root, 'data', 'prod.db'), 'v1');
    writeFileSync(join(h.fake, 'mig', T2), '0001_init 0002_new ');
    assert.equal(deploy(h, ['deploy', T2]).status, 0);
    writeFileSync(join(h.root, 'data', 'prod.db'), 'v2-migrated');
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 0, out(r));
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
    assert.equal(st(h, 'previous'), `${REPO}:${T2}`);
    assert.equal(st(h, 'predeploy'), null);
    assert.equal(readFileSync(join(h.root, 'data', 'prod.db'), 'utf8'), 'v1');
    assert.equal(running(h), `${REPO}:${T1}`);
    // 백업 파일이 남아 있지 않으면(정리됨) 마이그레이션이 다른 롤백은 거부.
    writeFileSync(join(h.fake, 'mig', T1), '0001_init ');
    const again = deploy(h, ['rollback']);
    assert.equal(again.status, 1);
    assert.match(out(again), /배포 전 백업 기록 없음/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

/** T1 배포 → prod.db v1 → 마이그레이션 다른 T2 배포(배포 전 백업 생성) → prod.db v2-migrated. */
function migratedTwo() {
  const h = host();
  assert.equal(deploy(h, ['deploy', T1]).status, 0);
  writeFileSync(join(h.root, 'data', 'prod.db'), 'v1');
  writeFileSync(join(h.fake, 'mig', T2), '0001_init 0002_new ');
  assert.equal(deploy(h, ['deploy', T2]).status, 0);
  writeFileSync(join(h.root, 'data', 'prod.db'), 'v2-migrated');
  return h;
}
const stopped = (h) => existsSync(join(h.fake, 'stopped'));

test('rollback: restore 가 -journal·-wal·-shm 잔여 파일을 지운다', () => {
  const h = migratedTwo();
  try {
    for (const x of ['-wal', '-shm', '-journal']) writeFileSync(join(h.root, 'data', `prod.db${x}`), 'stale');
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 0, out(r));
    assert.equal(readFileSync(join(h.root, 'data', 'prod.db'), 'utf8'), 'v1');
    for (const x of ['-wal', '-shm', '-journal']) assert.equal(existsSync(join(h.root, 'data', `prod.db${x}`)), false, x);
    assert.equal(existsSync(join(h.root, 'data', 'prod.db.restore')), false);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA122 MED-1: 배포 전 백업 파일이 정리됐으면 rollback 은 app 을 멈추지 않고 거부(서비스 유지)', () => {
  const h = migratedTwo();
  try {
    const pre = st(h, 'predeploy');
    assert.ok(pre);
    rmSync(join(h.root, 'data', 'backup', pre)); // 엔트리포인트 prune(7일·5개)로 지워진 상황
    const before = calls(h).length;
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /배포 전 백업 파일 없음/);
    assert.match(out(r), /app 은 그대로/);
    assert.equal(stopped(h), false, 'app 이 멈췄다');
    assert.equal(running(h), `${REPO}:${T2}`);
    assert.doesNotMatch(calls(h).slice(before), /compose .* (stop|up)/);
    assert.equal(st(h, 'current'), `${REPO}:${T2}`);
    assert.equal(st(h, 'previous'), `${REPO}:${T1}`);
    assert.equal(readFileSync(join(h.root, 'data', 'prod.db'), 'utf8'), 'v2-migrated');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('rollback: 이전 이미지를 pull 할 수 없으면 app 을 멈추지 않고 거부', () => {
  const h = migratedTwo();
  try {
    writeFileSync(join(h.fake, 'images'), `${REPO}:${T2}\n`); // T1 이 로컬에서 사라짐
    writeFileSync(join(h.fake, 'nopull'), `${REPO}:${T1}\n`);
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /pull 실패/);
    assert.equal(stopped(h), false);
    assert.equal(running(h), `${REPO}:${T2}`);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('rollback: 복원 스크립트가 실패하면 원래 이미지로 재기동(종료 1), DB 그대로', () => {
  const h = migratedTwo();
  try {
    writeFileSync(join(h.fake, 'norestore'), '');
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /복원 실패/);
    assert.equal(running(h), `${REPO}:${T2}`);
    assert.equal(stopped(h), false);
    assert.equal(st(h, 'current'), `${REPO}:${T2}`);
    assert.equal(readFileSync(join(h.root, 'data', 'prod.db'), 'utf8'), 'v2-migrated');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('배포 실패 + 마이그레이션 다름 + 복원 실패 → 이전 이미지를 새 스키마 DB 위에 띄우지 않는다(정지, 종료 3)', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(join(h.root, 'data', 'prod.db'), 'v1');
    writeFileSync(join(h.fake, 'mig', T2), '0001_init 0002_new ');
    writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T2}\n`);
    writeFileSync(join(h.fake, 'mutate'), `${REPO}:${T2}\n`);
    writeFileSync(join(h.fake, 'norestore'), '');
    const r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 3, out(r));
    assert.match(out(r), /복원 못 함/);
    assert.equal(stopped(h), true);
    assert.equal(running(h), `${REPO}:${T2}`); // 마지막 up 은 T2 — T1 을 다시 띄우지 않았다
    assert.doesNotMatch(out(r), /자동 롤백/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('배포 전 백업이 실패하면(DB 있음) 배포하지 않고 이전 이미지 재기동(종료 1)', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(join(h.root, 'data', 'prod.db'), 'v1');
    rmSync(join(h.root, 'data', 'backup'), { recursive: true });
    writeFileSync(join(h.root, 'data', 'backup'), 'not a dir'); // mkdir -p /data/backup 실패
    const r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /배포 전 백업 실패/);
    assert.equal(running(h), `${REPO}:${T1}`);
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
    assert.equal(readFileSync(join(h.root, 'state', 'image.env'), 'utf8'), `WS_IMAGE=${REPO}:${T1}\n`);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('BE124: 실제 server.env.example 형태(머리 주석에 __SET_ME__ 낱말) + 값 채움 → 사전 점검 통과, 값 줄 __SET_ME__ 는 거부', () => {
  const h = host();
  try {
    const example = readFileSync(resolve(ROOT, 'deploy', 'server.env.example'), 'utf8').replace(/\r\n/g, '\n');
    assert.match(example, /^#.*__SET_ME__/m, '전제: 주석에 낱말이 있다');
    const filled = example.replace(/^([A-Z_]+_SECRET)=__SET_ME__$/gm, (_, k) => `${k}=${'a'.repeat(64)}`);
    writeFileSync(join(h.root, 'server.env'), filled, { mode: 0o600 });
    let r = deploy(h, ['deploy', T1]);
    assert.equal(r.status, 0, out(r));
    writeFileSync(join(h.root, 'server.env'), example, { mode: 0o600 });
    r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /server\.env 에 __SET_ME__/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('deploy.conf 가 CRLF 여도 저장소 이름을 읽는다', () => {
  const h = host();
  try {
    writeFileSync(join(h.root, 'deploy.conf'), `# c\r\nWS_IMAGE_REPO=${REPO}\r\n`);
    const r = deploy(h, ['deploy', T1]);
    assert.equal(r.status, 0, out(r));
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

for (const [sig, code] of [['SIGTERM', 143], ['SIGHUP', 129], ['SIGINT', 130]]) {
  test(`QA122 LOW-1: ${sig} → 잠금 해제 후 즉시 종료(${code}), 다음 단계(up) 실행 0`, { skip: WIN }, async () => {
    const h = host();
    try {
      writeFileSync(join(h.fake, 'slow_pull'), '2');
      const child = spawn(SH, [DEPLOY_SH, 'deploy', T1], {
        env: {
          ...process.env,
          WS_ROOT: fwd(h.root),
          WS_DOCKER: FAKE,
          WS_HOST_ARCH: 'aarch64',
          WS_HEALTH_TIMEOUT: '2',
          WS_HEALTH_INTERVAL: '0',
          FAKE_DIR: fwd(h.fake),
          FAKE_DATA: fwd(join(h.root, 'data')),
        },
      });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d));
      const exited = new Promise((r) => child.on('exit', (c) => r(c)));
      // pull(대기) 이 시작된 뒤 = 잠금을 잡은 상태에서 신호.
      for (let i = 0; i < 200 && !/pull/.test(calls(h)); i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok(existsSync(join(h.root, 'state', '.lock')), 'pull 중 잠금');
      child.kill(sig);
      const status = await exited;
      assert.equal(status, code, stderr);
      assert.match(stderr, /신호/);
      assert.equal(existsSync(join(h.root, 'state', '.lock')), false, '잠금 잔존');
      assert.doesNotMatch(calls(h), /compose .* up/, '신호 뒤 계속 실행');
      assert.equal(st(h, 'current'), null);
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });
}

test('previous 없으면 rollback 거부', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 1);
    assert.match(out(r), /previous 없음/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('동시 실행 잠금: state/.lock 이 있으면 거부, 끝나면 잠금 해제', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    assert.equal(existsSync(join(h.root, 'state', '.lock')), false);
    mkdirSync(join(h.root, 'state', '.lock'));
    const r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 1);
    assert.match(out(r), /다른 배포/);
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

// ── QA127 (BE128): SIGPIPE·남은 잠금·dbchange·복원 짝 파일·nodb·복원 전 사본 ─────────────────
const envFor = (h, extra = {}) => ({
  ...process.env,
  WS_ROOT: fwd(h.root),
  WS_DOCKER: FAKE,
  WS_HOST_ARCH: 'aarch64',
  WS_HEALTH_TIMEOUT: '2',
  WS_HEALTH_INTERVAL: '0',
  WS_SKIP_MODE_CHECK: WIN ? '1' : '0',
  FAKE_DIR: fwd(h.fake),
  FAKE_DATA: fwd(join(h.root, 'data')),
  ...extra,
});
const data = (h, f) => join(h.root, 'data', f);
const readData = (h, f) => readFileSync(data(h, f), 'utf8');
const backups = (h, re) => readdirSync(join(h.root, 'data', 'backup')).filter((f) => re.test(f));
const lockDir = (h) => join(h.root, 'state', '.lock');
const deployLog = (h) => (existsSync(join(h.root, 'state', 'deploy.log')) ? readFileSync(join(h.root, 'state', 'deploy.log'), 'utf8') : '');
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

test('QA127 MED-3: SSH 끊김(출력 읽는 쪽이 첫 줄 뒤 닫힘 = SIGPIPE) → 끝까지 배포, 잠금 해제, app 정지로 남지 않음', { skip: WIN }, async () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(data(h, 'prod.db'), 'v1');
    writeFileSync(join(h.fake, 'slow_pull'), '1'); // 첫 줄('시작') 뒤 pull 대기 중에 채널이 닫힌다
    const child = spawn(SH, [DEPLOY_SH, 'deploy', T2], { env: envFor(h), stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = new Promise((r) => child.on('exit', (c, s) => r({ c, s })));
    let first = '';
    await new Promise((r) => child.stdout.once('data', (d) => { first = String(d); r(); }));
    child.stdout.destroy();
    child.stderr.destroy();
    child.stdin.destroy();
    const { c, s } = await exited;
    assert.match(first, /\[deploy\]/);
    assert.equal(s, null, `신호로 죽음: ${s}`);
    assert.equal(c, 0, deployLog(h));
    assert.equal(existsSync(lockDir(h)), false, '잠금 잔존');
    assert.equal(stopped(h), false, 'app 정지 상태로 남음');
    assert.equal(running(h), `${REPO}:${T2}`);
    assert.equal(st(h, 'current'), `${REPO}:${T2}`);
    assert.equal(st(h, 'dbchange'), null);
    assert.match(deployLog(h), /배포 전 백업 data\/backup\/prod-/);
    assert.match(deployLog(h), new RegExp(`OK ${REPO}:${T2}`));
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA127 MED-3: docker 출력은 화면(SSH)이 아니라 state/deploy.log 로만, 직전 실행은 deploy.log.1', () => {
  const h = host();
  try {
    let r = deploy(h, ['deploy', T1]);
    assert.equal(r.status, 0, out(r));
    assert.doesNotMatch(out(r), /Container withsmall-app-1/);
    assert.match(deployLog(h), /Container withsmall-app-1 {2}Started/);
    assert.doesNotMatch(out(r), /Pulling from/);
    assert.match(deployLog(h), /Pulling from fake/);
    assert.match(out(r), /\[deploy\] OK /);
    r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 0, out(r));
    assert.match(readFileSync(join(h.root, 'state', 'deploy.log.1'), 'utf8'), new RegExp(`OK ${REPO}:${T1}`));
    assert.match(deployLog(h), new RegExp(`OK ${REPO}:${T2}`));
    assert.doesNotMatch(deployLog(h), new RegExp(`OK ${REPO}:${T1}`));
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA127 MED-3: 남은 잠금(pid 없음 + 오래됨)은 같은 명령으로 회수, 최근 잠금은 거부', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    mkdirSync(lockDir(h));
    const old = Math.floor(Date.now() / 1000) - 3600;
    writeFileSync(join(lockDir(h), 'info'), `999999 ${old}\n`);
    // 최근(기준 1시간보다 덜 됨) → 거부, 잠금 그대로.
    let r = deploy(h, ['deploy', T2], { WS_LOCK_STALE_SEC: '7200' });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /막 중단됐다/);
    assert.ok(existsSync(join(lockDir(h), 'info')));
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
    // 기본 기준(600초) → 회수 후 배포.
    r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /남은 잠금 회수\(pid 999999/);
    assert.equal(st(h, 'current'), `${REPO}:${T2}`);
    assert.equal(existsSync(lockDir(h)), false);
    assert.deepEqual(readdirSync(join(h.root, 'state')).filter((f) => f.startsWith('.lock')), [], '.lock.stale.* 잔여');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA127 MED-3: info 없는 옛 잠금은 폴더 수정 시각으로 — 오래되면 회수', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    mkdirSync(lockDir(h));
    const t = new Date(Date.now() - 3600 * 1000);
    utimesSync(lockDir(h), t, t);
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 1, out(r)); // 잠금은 풀렸고, previous 가 없어 rollback 자체가 거부
    assert.match(out(r), /남은 잠금 회수/);
    assert.match(out(r), /previous 없음/);
    assert.equal(existsSync(lockDir(h)), false);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA127 MED-3: 잠금 pid 의 deploy.sh 가 살아 있으면 오래돼도 거부, deploy.sh 가 아닌 프로세스(PID 재사용)면 회수', { skip: WIN }, async () => {
  const h = host();
  const live = spawn('sh', ['-c', 'sleep 20; :', 'deploy.sh']); // /proc/<pid>/cmdline 에 deploy.sh
  const other = spawn('sh', ['-c', 'sleep 20; :', 'unrelated']);
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    await sleepMs(100);
    const old = Math.floor(Date.now() / 1000) - 3600;
    mkdirSync(lockDir(h));
    writeFileSync(join(lockDir(h), 'info'), `${live.pid} ${old}\n`);
    let r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), new RegExp(`진행 중\\(잠금 pid ${live.pid}`));
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
    writeFileSync(join(lockDir(h), 'info'), `${other.pid} ${old}\n`);
    r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /남은 잠금 회수/);
  } finally {
    live.kill('SIGKILL');
    other.kill('SIGKILL');
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA127 MED-3: app 정지 뒤 kill -9 로 잠금이 남아도 배포 키 명령 재실행으로 서비스 복구', { skip: WIN }, async () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(data(h, 'prod.db'), 'v1');
    writeFileSync(join(h.fake, 'slow_backup'), '1');
    const child = spawn(SH, [DEPLOY_SH, 'deploy', T2], { env: envFor(h), stdio: 'ignore' });
    const exited = new Promise((r) => child.on('exit', () => r()));
    for (let i = 0; i < 200 && !/predeploy/.test(calls(h)); i++) await sleepMs(20);
    assert.equal(stopped(h), true, '백업 단계 = app 정지');
    child.kill('SIGKILL');
    await exited;
    await sleepMs(1300); // 남은 가짜 docker(백업) 종료 대기
    assert.ok(existsSync(lockDir(h)), '전제: 잠금 잔존');
    assert.equal(stopped(h), true, '전제: app 정지');
    rmSync(join(h.fake, 'slow_backup'));
    const r = deploy(h, ['deploy', T2], { WS_LOCK_STALE_SEC: '0' });
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /남은 잠금 회수/);
    assert.equal(stopped(h), false);
    assert.equal(running(h), `${REPO}:${T2}`);
    assert.equal(existsSync(lockDir(h)), false);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA127 MED-3: DB 를 바꾸는 단계 도중 중단(state/dbchange 남음) → 다음 실행은 app 을 건드리지 않고 거부, 표시 유지', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    assert.equal(st(h, 'dbchange'), null, '정상 종료면 표시 없음');
    writeFileSync(join(h.root, 'state', 'dbchange'), `deploy ${REPO}:${T2} (x) 2026-10-27T00:00:00Z\n`);
    const before = calls(h).length;
    for (const args of [['deploy', T2], ['rollback']]) {
      const r = deploy(h, args);
      assert.equal(r.status, 1, out(r));
      assert.match(out(r), /DB 를 바꾸는 단계에서 중단/);
    }
    assert.equal(calls(h).slice(before), '', 'docker 호출 0');
    assert.ok(existsSync(join(h.root, 'state', 'dbchange')), '표시가 지워졌다');
    assert.equal(existsSync(lockDir(h)), false);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA127 LOW-5: 복원 mv 가 실패하면 지금 DB 와 -journal·-wal·-shm 이 그대로(지우지 않음), 원래 이미지 재기동', () => {
  const h = migratedTwo();
  try {
    for (const [x, v] of [['-journal', 'HOTJOURNAL'], ['-wal', 'WAL'], ['-shm', 'SHM']]) writeFileSync(data(h, `prod.db${x}`), v);
    writeFileSync(join(h.fake, 'restore_mvfail'), '');
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /복원 실패/);
    assert.equal(readData(h, 'prod.db'), 'v2-migrated');
    assert.equal(readData(h, 'prod.db-journal'), 'HOTJOURNAL');
    assert.equal(readData(h, 'prod.db-wal'), 'WAL');
    assert.equal(readData(h, 'prod.db-shm'), 'SHM');
    assert.deepEqual(readdirSync(join(h.root, 'data')).filter((f) => /prerestore|\.restore$/.test(f)), []);
    assert.equal(running(h), `${REPO}:${T2}`);
    assert.equal(stopped(h), false);
    assert.equal(st(h, 'dbchange'), null);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA127 LOW-5: 남은 prod.db.restore(폴더)가 있어도 복원 성공 — 시작 시 치운다', () => {
  const h = migratedTwo();
  try {
    mkdirSync(data(h, 'prod.db.restore'));
    writeFileSync(data(h, 'prod.db-journal'), 'HOTJOURNAL');
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 0, out(r));
    assert.equal(readData(h, 'prod.db'), 'v1');
    assert.equal(existsSync(data(h, 'prod.db.restore')), false);
    assert.equal(existsSync(data(h, 'prod.db-journal')), false, '새 스키마 DB 의 journal 이 복원 DB 에 섞임');
    assert.equal(running(h), `${REPO}:${T1}`);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA127 LOW-7: rollback 복원 전 지금 DB(+ -journal) 를 prod-<UTC>-prerollback.db 로 복사(prune 대상 이름)', () => {
  const h = migratedTwo();
  try {
    writeFileSync(data(h, 'prod.db-journal'), 'HOTJOURNAL');
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 0, out(r));
    const pr = backups(h, /^prod-\d{8}T\d{6}Z-prerollback\.db$/);
    assert.equal(pr.length, 1, readdirSync(join(h.root, 'data', 'backup')).join(','));
    assert.match(pr[0], /^prod-.*\.db$/);
    assert.equal(readFileSync(join(h.root, 'data', 'backup', pr[0]), 'utf8'), 'v2-migrated');
    assert.equal(readFileSync(join(h.root, 'data', 'backup', `${pr[0]}-journal`), 'utf8'), 'HOTJOURNAL');
    assert.equal(readData(h, 'prod.db'), 'v1');
    assert.match(out(r), /prerollback/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA127 LOW-7: 배포 실패 자동 롤백 복원도 실패한 배포의 DB 를 prerollback 사본으로 남긴다', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(data(h, 'prod.db'), 'v1');
    writeFileSync(join(h.fake, 'mig', T2), '0001_init 0002_new ');
    writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T2}\n`);
    writeFileSync(join(h.fake, 'mutate'), `${REPO}:${T2}\n`);
    const r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 1, out(r));
    assert.equal(readData(h, 'prod.db'), 'v1');
    const pr = backups(h, /-prerollback\.db$/);
    assert.equal(pr.length, 1);
    assert.equal(readFileSync(join(h.root, 'data', 'backup', pr[0]), 'utf8'), 'MUTATED');
    assert.equal(st(h, 'dbchange'), null);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA127 LOW-6: 배포 전 DB 없음 + 마이그레이션 다름 + 헬스 실패 → 새 이미지가 만든 DB 를 치우고 이전 이미지 기동(종료 1)', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0); // DB 없음
    writeFileSync(join(h.fake, 'mig', T2), '0001_init 0002_new ');
    writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T2}\n`);
    writeFileSync(join(h.fake, 'mutate'), `${REPO}:${T2}\n`); // 새 이미지가 prod.db 를 만든다
    const r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /faileddeploy/);
    assert.equal(existsSync(data(h, 'prod.db')), false, '이전 이미지가 새 스키마 DB 위에서 기동');
    const fd = backups(h, /^prod-\d{8}T\d{6}Z-faileddeploy\.db$/);
    assert.equal(fd.length, 1);
    assert.equal(readFileSync(join(h.root, 'data', 'backup', fd[0]), 'utf8'), 'MUTATED');
    assert.equal(running(h), `${REPO}:${T1}`);
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA127 LOW-6: 새 DB 를 치우지 못하면 이전 이미지를 띄우지 않는다(정지, 종료 3)', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(join(h.fake, 'mig', T2), '0001_init 0002_new ');
    writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T2}\n`);
    writeFileSync(join(h.fake, 'mutate'), `${REPO}:${T2}\n`);
    writeFileSync(join(h.fake, 'nodiscard'), '');
    const r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 3, out(r));
    assert.equal(stopped(h), true);
    assert.equal(running(h), `${REPO}:${T2}`);
    assert.doesNotMatch(out(r), /자동 롤백/);
    assert.equal(readData(h, 'prod.db'), 'MUTATED');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

// ── QA131 (BE132): 종료 3 에서 dbchange 유지(MED-4) · 표시를 쓰는 쪽·회수 배타성(LOW-9) · 거부 시 기록 회전 안 함(LOW-11) ──
const upCount = (h) => (calls(h).match(/^compose .* up -d/gm) || []).length;
const dbchangeFile = (h) => join(h.root, 'state', 'dbchange');
// 표시를 남긴 이유(QA133 LOW-13): 확인 지점(settle) 전에 끝남 — 종료 코드 겹과 따로 SETTLED 겹을 고정한다.
const KEPT_BEFORE = /state\/dbchange 남김\(DB·image\.env 확인 지점 전에 끝남\)/;

/** T1 + DB v1 → 마이그레이션 다른 T2 배포, 헬스 실패, 복원 실패 → 종료 3(app 정지, image.env=T2, DB=MUTATED). */
function exit3Deploy() {
  const h = host();
  assert.equal(deploy(h, ['deploy', T1]).status, 0);
  writeFileSync(data(h, 'prod.db'), 'v1');
  writeFileSync(join(h.fake, 'mig', T2), '0001_init 0002_new ');
  writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T2}\n`);
  writeFileSync(join(h.fake, 'mutate'), `${REPO}:${T2}\n`);
  writeFileSync(join(h.fake, 'norestore'), '');
  const r = deploy(h, ['deploy', T2]);
  assert.equal(r.status, 3, out(r));
  return { h, r };
}

test('QA131 MED-4: 종료 3(복원 못 함, app 정지)이면 state/dbchange 가 남고 종료 코드·남김 사실이 deploy.log 에 남는다', () => {
  const { h, r } = exit3Deploy();
  try {
    assert.ok(existsSync(dbchangeFile(h)), `종료 3 인데 표시가 지워졌다\n${out(r)}`);
    assert.match(st(h, 'dbchange'), new RegExp(`^deploy ${REPO}:${T2} `));
    assert.match(deployLog(h), KEPT_BEFORE);
    assert.match(deployLog(h), /종료 코드 3$/m);
    assert.match(out(r), /sudo -u deploy rm /);
    assert.equal(existsSync(lockDir(h)), false);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA131 MED-4 N1(a): 종료 3 뒤 복원 장애가 풀려 같은 deploy 를 다시 보내도 거부(docker 0) — 새 스키마 DB 위 "롤백 OK" 없음', () => {
  const { h } = exit3Deploy();
  try {
    rmSync(join(h.fake, 'norestore')); // 일시적 장애가 풀림
    const before = calls(h).length;
    for (const args of [['deploy', T2], ['rollback']]) {
      const r = deploy(h, args);
      assert.equal(r.status, 1, out(r));
      assert.match(out(r), /DB 를 바꾸는 단계에서 중단/);
      assert.doesNotMatch(out(r), /롤백 OK|\] OK /);
    }
    assert.equal(calls(h).slice(before), '', 'docker 호출 0');
    assert.equal(readData(h, 'prod.db'), 'MUTATED');
    assert.equal(stopped(h), true, 'app 이 다시 떴다');
    assert.ok(existsSync(dbchangeFile(h)));
    assert.equal(existsSync(lockDir(h)), false);
    // 원래 v1 백업은 그대로 하나(재시도가 새 스키마 DB 를 predeploy 로 찍지 않았다).
    const pre = backups(h, /-predeploy\.db$/);
    assert.equal(pre.length, 1, pre.join(','));
    assert.equal(readFileSync(join(h.root, 'data', 'backup', pre[0]), 'utf8'), 'v1');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA131 MED-4 N1(b): 종료 3 뒤 지금 current 태그(T1)를 다시 보내도 거부 — T1 을 새 스키마 DB 위에 "OK" 로 띄우지 않는다', () => {
  const { h } = exit3Deploy();
  try {
    const before = calls(h).length;
    const r = deploy(h, ['deploy', T1]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /DB 를 바꾸는 단계에서 중단/);
    assert.doesNotMatch(out(r), /\] OK /);
    assert.equal(calls(h).slice(before), '');
    assert.equal(running(h), `${REPO}:${T2}`);
    assert.equal(stopped(h), true);
    // 관리자가 확인·복원 뒤 표시를 지우면 같은 명령으로 진행.
    writeFileSync(data(h, 'prod.db'), 'v1');
    rmSync(dbchangeFile(h));
    const ok = deploy(h, ['deploy', T1]);
    assert.equal(ok.status, 0, out(ok));
    assert.equal(running(h), `${REPO}:${T1}`);
    assert.equal(existsSync(dbchangeFile(h)), false);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA131 MED-4: rollback 복원 뒤 이전 이미지 헬스 실패(종료 3) → 표시 남음, 다음 실행 거부', () => {
  const h = migratedTwo();
  try {
    writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T1}\n`);
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 3, out(r));
    assert.match(st(h, 'dbchange') ?? '', new RegExp(`^rollback ${REPO}:${T2} -> ${REPO}:${T1} `));
    assert.match(deployLog(h), KEPT_BEFORE);
    const before = calls(h).length;
    const again = deploy(h, ['rollback']);
    assert.equal(again.status, 1, out(again));
    assert.match(out(again), /DB 를 바꾸는 단계에서 중단/);
    assert.equal(calls(h).slice(before), '');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA131 MED-4: DB 와 image.env 가 맞는 채 끝난 종료 0·1 은 표시를 지운다(자동 롤백 OK·복원 실패 후 원래 이미지 재기동)', () => {
  let h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(data(h, 'prod.db'), 'v1');
    writeFileSync(join(h.fake, 'mig', T2), '0001_init 0002_new ');
    writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T2}\n`);
    writeFileSync(join(h.fake, 'mutate'), `${REPO}:${T2}\n`);
    const r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /롤백 OK/);
    assert.equal(existsSync(dbchangeFile(h)), false);
    assert.match(deployLog(h), /종료 코드 1$/m);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
  h = migratedTwo();
  try {
    writeFileSync(join(h.fake, 'norestore'), '');
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 1, out(r));
    assert.equal(existsSync(dbchangeFile(h)), false);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA131 LOW-11: dbchange 로 거부된 실행은 deploy.log 를 돌리지 않고 덧붙인다(중단된 실행 기록 유지)', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(join(h.root, 'state', 'deploy.log'), 'CRASHED-RUN up ghcr.io/owner/withsmall:sha-bbbbbbbbbbbb\n');
    writeFileSync(join(h.root, 'state', 'deploy.log.1'), 'OLDER\n');
    writeFileSync(dbchangeFile(h), `deploy ${REPO}:${T2} (x) 2026-10-27T00:00:00Z\n`);
    for (let i = 0; i < 3; i++) assert.equal(deploy(h, ['deploy', T2]).status, 1);
    const log = deployLog(h);
    assert.match(log, /^CRASHED-RUN /);
    assert.equal((log.match(/거부된 실행: deploy /g) || []).length, 3, log);
    assert.equal(readFileSync(join(h.root, 'state', 'deploy.log.1'), 'utf8'), 'OLDER\n');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA131 LOW-9: 새 이미지 기동(DB 를 바꾸는 단계) 도중 kill -9 → dbchange 남음, 잠금 회수 뒤에도 거부(docker 0)', { skip: WIN }, async () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(data(h, 'prod.db'), 'v1');
    writeFileSync(join(h.fake, 'slow_up'), '1');
    const ups = upCount(h);
    const child = spawn(SH, [DEPLOY_SH, 'deploy', T2], { env: envFor(h), stdio: 'ignore' });
    const exited = new Promise((r) => child.on('exit', () => r()));
    for (let i = 0; i < 250 && upCount(h) === ups; i++) await sleepMs(20);
    assert.equal(upCount(h), ups + 1, '전제: 새 이미지 up 진행 중');
    child.kill('SIGKILL');
    await exited;
    await sleepMs(1300); // 남은 가짜 docker(up) 종료 대기
    rmSync(join(h.fake, 'slow_up'));
    assert.match(st(h, 'dbchange') ?? '', new RegExp(`^deploy ${REPO}:${T2} \\(이전 ${REPO}:${T1}, 배포 전 백업 prod-`));
    assert.ok(existsSync(lockDir(h)), '전제: 잠금 잔존');
    const before = calls(h).length;
    const r = deploy(h, ['deploy', T2], { WS_LOCK_STALE_SEC: '0' });
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /DB 를 바꾸는 단계에서 중단/);
    assert.equal(calls(h).slice(before), '', 'docker 호출 0');
    assert.equal(existsSync(lockDir(h)), false);
    assert.ok(existsSync(dbchangeFile(h)));
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA131 LOW-9: 새 이미지 기동 도중 HUP → 129, 잠금 해제, dbchange 남음, 종료 처리 한 번(EXIT 트랩 다시 안 돎)', { skip: WIN }, async () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(data(h, 'prod.db'), 'v1');
    writeFileSync(join(h.fake, 'slow_up'), '1');
    const ups = upCount(h);
    const child = spawn(SH, [DEPLOY_SH, 'deploy', T2], { env: envFor(h), stdio: 'ignore' });
    const exited = new Promise((r) => child.on('exit', (c) => r(c)));
    for (let i = 0; i < 250 && upCount(h) === ups; i++) await sleepMs(20);
    assert.equal(upCount(h), ups + 1, '전제: 새 이미지 up 진행 중');
    child.kill('SIGHUP');
    const code = await exited;
    await sleepMs(1300);
    rmSync(join(h.fake, 'slow_up'));
    assert.equal(code, 129, deployLog(h));
    assert.equal(existsSync(lockDir(h)), false);
    assert.ok(existsSync(dbchangeFile(h)), 'HUP 뒤 표시가 지워졌다');
    // 기록 줄(시각 붙은 줄)만 센다 — 신호가 docker 출력 재지정(>>deploy.log 2>&1) 도중 오면 화면 사본도 그 파일로 간다.
    const log = deployLog(h);
    assert.equal((log.match(/Z \[deploy\] 종료 코드 /g) || []).length, 1, log);
    assert.match(log, /Z \[deploy\] 종료 코드 129$/m);
    assert.equal((log.match(/Z \[deploy\] state\/dbchange 남김/g) || []).length, 1, log);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

/** 오래된 죽은 잠금 + WS_LOCK_TEST_PAUSE 로 회수자를 멈춰 둔 채 띄운다. */
function staleLockReclaimer(h, pauseSec) {
  mkdirSync(lockDir(h));
  writeFileSync(join(lockDir(h), 'info'), `999999 ${Math.floor(Date.now() / 1000) - 3600}\n`);
  const child = spawn(SH, [DEPLOY_SH, 'deploy', T2], { env: envFor(h, { WS_LOCK_TEST_PAUSE: String(pauseSec) }), stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', (d) => (text += d));
  child.stderr.on('data', (d) => (text += d));
  const exited = new Promise((r) => child.on('exit', (c) => r({ code: c, text: () => text })));
  return exited;
}

test('QA131 LOW-9: 회수 판정 뒤 다른 실행이 잠금을 새로 잡았으면(info 다름) 회수자는 되돌리고 거부', { skip: WIN }, async () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    const before = calls(h).length;
    const exited = staleLockReclaimer(h, 2);
    await sleepMs(700); // 회수자는 info 를 읽고 첫 멈춤 중
    rmSync(lockDir(h), { recursive: true, force: true });
    mkdirSync(lockDir(h));
    const fresh = `424242 ${Math.floor(Date.now() / 1000)}`;
    writeFileSync(join(lockDir(h), 'info'), `${fresh}\n`);
    const { code, text } = await exited;
    assert.equal(code, 1, text());
    assert.match(text(), /잠금 회수 중 경합/);
    assert.equal(readFileSync(join(lockDir(h), 'info'), 'utf8').trim(), fresh, '새 잠금을 지웠다');
    assert.equal(calls(h).slice(before), '', '회수자가 진행했다');
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA131 LOW-9: 회수자가 옛 잠금을 지운 뒤 다른 실행이 먼저 mkdir 하면 회수자는 들어가지 않는다(mkdir -p 금지)', { skip: WIN }, async () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    const before = calls(h).length;
    const exited = staleLockReclaimer(h, 2);
    // 옛 잠금이 치워지면(회수자 두 번째 멈춤) 새 실행이 평범한 mkdir 로 잡는다.
    for (let i = 0; i < 300 && existsSync(lockDir(h)); i++) await sleepMs(10);
    assert.equal(existsSync(lockDir(h)), false, '전제: 회수자가 옛 잠금을 치움');
    mkdirSync(lockDir(h));
    const fresh = `424242 ${Math.floor(Date.now() / 1000)}`;
    writeFileSync(join(lockDir(h), 'info'), `${fresh}\n`);
    const { code, text } = await exited;
    assert.equal(code, 1, text());
    assert.match(text(), /회수 직후 경합/);
    assert.equal(readFileSync(join(lockDir(h), 'info'), 'utf8').trim(), fresh);
    assert.equal(calls(h).slice(before), '', '두 실행이 동시에 진행');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA131 INFO-5: info 가 pid 만이면 폴더 수정 시각으로 나이를 잰다(최근 = 거부, 오래됨 = 회수), 알 수 없는 형태는 거부', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    mkdirSync(lockDir(h));
    writeFileSync(join(lockDir(h), 'info'), '999999\n');
    let r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /막 중단됐다/);
    writeFileSync(join(lockDir(h), 'info'), 'garbage\n');
    const t = new Date(Date.now() - 3600 * 1000);
    utimesSync(lockDir(h), t, t);
    r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /나이를 알 수 없음.*sudo -u deploy rm -r/);
    writeFileSync(join(lockDir(h), 'info'), '999999\n');
    utimesSync(lockDir(h), t, t);
    r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /남은 잠금 회수\(pid 999999/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

// ── QA133 (BE134): 마이그레이션 목록 못 읽음 = 거부(LOW-12) · 표시 단독 경로·첫 배포 실패(LOW-13) · 표시 쓰기 실패 = 중단(INFO-10) ──
const lsCount = (h) => (calls(h).match(/^image ls/gm) || []).length;

/** T1 + DB v1 → (마이그레이션 다른, 기동 시 DB 를 바꾸고 헬스 실패하는) T2 준비. */
function t1ThenBadT2() {
  const h = host();
  assert.equal(deploy(h, ['deploy', T1]).status, 0);
  writeFileSync(data(h, 'prod.db'), 'v1');
  writeFileSync(join(h.fake, 'mig', T2), '0001_init 0002_new ');
  writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T2}\n`);
  writeFileSync(join(h.fake, 'mutate'), `${REPO}:${T2}\n`);
  return h;
}

/** 거부 = app 을 멈추지 않았고 아무 이미지도 띄우지 않았고 표시 없음. */
function assertUntouched(h, r, ups) {
  assert.equal(r.status, 1, out(r));
  assert.match(out(r), /마이그레이션 목록을 읽지 못함/);
  assert.doesNotMatch(out(r), /롤백 OK|\] OK /);
  assert.equal(upCount(h), ups, 'compose up 실행됨');
  assert.equal(stopped(h), false, 'app 이 멈췄다');
  assert.equal(existsSync(dbchangeFile(h)), false);
  assert.equal(existsSync(lockDir(h)), false);
}

test('QA133 LOW-12 P1: 두 이미지의 마이그레이션 목록 조회가 모두 실패 → 배포 거부(app·DB 그대로) — 새 스키마 DB 위 "롤백 OK" 없음', () => {
  const h = t1ThenBadT2();
  try {
    writeFileSync(join(h.fake, 'migfail'), '');
    const ups = upCount(h);
    const r = deploy(h, ['deploy', T2]);
    assertUntouched(h, r, ups);
    assert.equal(running(h), `${REPO}:${T1}`);
    assert.equal(readData(h, 'prod.db'), 'v1');
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
    assert.deepEqual(backups(h, /-predeploy\.db$/), []);
    // 장애가 풀리면 같은 명령으로 정상 경로(복원 → 롤백 OK, DB v1).
    rmSync(join(h.fake, 'migfail'));
    const again = deploy(h, ['deploy', T2]);
    assert.equal(again.status, 1, out(again));
    assert.match(out(again), /배포 전 백업 복원/);
    assert.equal(readData(h, 'prod.db'), 'v1');
    assert.equal(running(h), `${REPO}:${T1}`);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA133 LOW-12: 한쪽 조회 실패·빈 목록(docker 성공, 출력 없음)도 "알 수 없음" → 거부', () => {
  for (const setup of [
    (h) => writeFileSync(join(h.fake, 'migfail'), `${T2}\n`),
    (h) => writeFileSync(join(h.fake, 'migfail'), `${T1}\n`),
    (h) => {
      writeFileSync(join(h.fake, 'mig', T1), '');
      writeFileSync(join(h.fake, 'mig', T2), '');
    },
  ]) {
    const h = t1ThenBadT2();
    try {
      setup(h);
      const ups = upCount(h);
      assertUntouched(h, deploy(h, ['deploy', T2]), ups);
      assert.equal(readData(h, 'prod.db'), 'v1');
      assert.equal(running(h), `${REPO}:${T1}`);
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }
});

test('QA133 LOW-12: rollback 도 마이그레이션 목록을 못 읽으면 app 을 멈추기 전에 거부(DB·current 그대로)', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(data(h, 'prod.db'), 'v1');
    assert.equal(deploy(h, ['deploy', T2]).status, 0); // 마이그레이션 같음 — predeploy 기록은 있다
    writeFileSync(data(h, 'prod.db'), 'v2');
    writeFileSync(join(h.fake, 'migfail'), '');
    const ups = upCount(h);
    const r = deploy(h, ['rollback']);
    assertUntouched(h, r, ups);
    assert.equal(running(h), `${REPO}:${T2}`);
    assert.equal(readData(h, 'prod.db'), 'v2');
    assert.equal(st(h, 'current'), `${REPO}:${T2}`);
    assert.equal(st(h, 'previous'), `${REPO}:${T1}`);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA133 LOW-13 P7: 표시를 쓴 뒤 예상 못 한 set -e 종료(state_put 실패) → 종료 0 아님, dbchange 남음(확인 지점 전), 다음 실행 거부', () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(data(h, 'prod.db'), 'v1');
    mkdirSync(join(h.root, 'state', 'previous.tmp')); // state_put previous 가 실패하게
    const r = deploy(h, ['deploy', T2]);
    assert.notEqual(r.status, 0, out(r));
    assert.match(st(h, 'dbchange') ?? '', new RegExp(`^deploy ${REPO}:${T2} `), deployLog(h));
    assert.match(deployLog(h), KEPT_BEFORE);
    assert.equal(existsSync(lockDir(h)), false);
    rmSync(join(h.root, 'state', 'previous.tmp'), { recursive: true });
    const before = calls(h).length;
    const again = deploy(h, ['deploy', T2]);
    assert.equal(again.status, 1, out(again));
    assert.match(out(again), /DB 를 바꾸는 단계에서 중단/);
    assert.equal(calls(h).slice(before), '');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA133 LOW-13: 첫 배포 헬스 실패(되돌릴 이미지 없음, 정지) → 종료 1, 표시 지움(같은 명령 재시도 가능)', () => {
  const h = host();
  try {
    writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T1}\n`);
    const r = deploy(h, ['deploy', T1]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /되돌릴 이전 이미지 없음/);
    assert.equal(stopped(h), true);
    assert.equal(existsSync(dbchangeFile(h)), false);
    assert.doesNotMatch(deployLog(h), /dbchange 남김/);
    rmSync(join(h.fake, 'unhealthy'));
    const again = deploy(h, ['deploy', T1]);
    assert.equal(again.status, 0, out(again));
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA133 LOW-13: rollback 복원 실패 + 원래 이미지 재기동도 헬스 실패(종료 3) → 표시 남음(확인 지점 전)', () => {
  const h = migratedTwo();
  try {
    writeFileSync(join(h.fake, 'norestore'), '');
    writeFileSync(join(h.fake, 'unhealthy'), `${REPO}:${T2}\n`);
    const r = deploy(h, ['rollback']);
    assert.equal(r.status, 3, out(r));
    assert.ok(existsSync(dbchangeFile(h)));
    assert.match(deployLog(h), KEPT_BEFORE);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA133 LOW-13: 성공 확인 지점(settle) 뒤 TERM(143) → 표시는 남기되 "확인 지점은 지났으나 종료 코드 143" 으로 기록', { skip: WIN }, async () => {
  const h = host();
  try {
    assert.equal(deploy(h, ['deploy', T1]).status, 0);
    writeFileSync(join(h.fake, 'slow_prune'), '1');
    const ls0 = lsCount(h);
    const child = spawn(SH, [DEPLOY_SH, 'deploy', T2], { env: envFor(h), stdio: 'ignore' });
    const exited = new Promise((r) => child.on('exit', (c) => r(c)));
    for (let i = 0; i < 250 && lsCount(h) === ls0; i++) await sleepMs(20);
    assert.equal(lsCount(h), ls0 + 1, '전제: 성공 기록 뒤 정리 단계(image ls) 진행 중');
    assert.equal(st(h, 'current'), `${REPO}:${T2}`);
    child.kill('SIGTERM');
    const code = await exited;
    rmSync(join(h.fake, 'slow_prune'));
    assert.equal(code, 143, deployLog(h));
    assert.ok(existsSync(dbchangeFile(h)), '신호 종료인데 표시가 지워졌다');
    assert.match(deployLog(h), /state\/dbchange 남김\(DB·image\.env 확인 지점은 지났으나 종료 코드 143\)/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('QA133 INFO-10: state/dbchange 를 못 쓰면 DB 를 바꾸는 단계로 가지 않는다 — 이전 이미지 재기동, 종료 1, "남김" 기록 없음', () => {
  const h = t1ThenBadT2();
  try {
    mkdirSync(dbchangeFile(h)); // 디렉터리 → 쓰기 실패
    const ups = upCount(h);
    const r = deploy(h, ['deploy', T2]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /state\/dbchange 쓰기 실패/);
    assert.equal(upCount(h), ups + 1, '이전 이미지 재기동 한 번만(새 이미지 up 없음)');
    assert.equal(running(h), `${REPO}:${T1}`);
    assert.equal(stopped(h), false);
    assert.equal(readData(h, 'prod.db'), 'v1', 'DB 를 바꾸는 단계로 갔다');
    assert.equal(st(h, 'current'), `${REPO}:${T1}`);
    assert.doesNotMatch(deployLog(h), /dbchange 남김|파일이 없다/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
  const f = host();
  try {
    mkdirSync(dbchangeFile(f), { recursive: true });
    const r = deploy(f, ['deploy', T1]);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /state\/dbchange 를 쓰지 못해 중단/);
    assert.equal(upCount(f), 0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
  const m = migratedTwo();
  try {
    mkdirSync(dbchangeFile(m));
    const ups = upCount(m);
    const r = deploy(m, ['rollback']);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /state\/dbchange 쓰기 실패/);
    assert.equal(upCount(m), ups + 1);
    assert.equal(running(m), `${REPO}:${T2}`);
    assert.equal(stopped(m), false);
    assert.equal(readData(m, 'prod.db'), 'v2-migrated');
    assert.equal(st(m, 'current'), `${REPO}:${T2}`);
  } finally {
    rmSync(m.root, { recursive: true, force: true });
  }
});

// ── deploy-gate.sh ─────────────────────────────────────────────
function gate(cmd) {
  const dir = mkdtempSync(join(tmpdir(), 'ws-gate-'));
  const stub = join(dir, 'stub.sh');
  writeFileSync(stub, '#!/bin/sh\nprintf "ARGS:%s|" "$@"\n');
  const env = { ...process.env, WS_DEPLOY_SH: fwd(stub) };
  if (cmd === undefined) delete env.SSH_ORIGINAL_COMMAND;
  else env.SSH_ORIGINAL_COMMAND = cmd;
  const r = spawnSync(SH, [GATE_SH], { encoding: 'utf8', env });
  rmSync(dir, { recursive: true, force: true });
  return r;
}

test('deploy-gate: 허용 두 형태만 deploy.sh 로 넘긴다', () => {
  let r = gate(`deploy ${T1}`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `ARGS:deploy|ARGS:${T1}|`);
  r = gate('rollback');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'ARGS:rollback|');
});

test('deploy-gate: 그 밖은 전부 거부(종료 2, deploy.sh 실행 0)', () => {
  for (const bad of [
    undefined,
    '',
    'deploy',
    'deploy sha-AAAAAAAAAAAA',
    'deploy sha-aaaaaaaaaaa',
    'deploy sha-aaaaaaaaaaaaa',
    `deploy ${T1} extra`,
    `deploy ${T1}\nrm -rf /`,
    `rollback\nid`,
    'rollback ',
    ' rollback',
    `deploy ${T1};id`,
    `deploy  ${T1}`,
    'sh',
    'scp -t /tmp',
    `deploy $(id)`,
  ]) {
    const r = gate(bad);
    assert.equal(r.status, 2, JSON.stringify(bad));
    assert.equal(r.stdout, '', JSON.stringify(bad));
  }
});
