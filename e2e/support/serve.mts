// E2E 서버 프로세스(글로벌 셋업이 tsx 로 띄운다). 사이트 생성 → 실제 createApp(인메모리 repos) 서빙.
//   사용: tsx e2e/support/serve.mts --mode demo|real --client <clientDist> --site <siteDir> --mail <mailFile.jsonl> [--below-min on|off]
//   --below-min on(demo 만): 데모 시드에 최소 규격 미달 상품 1건을 메모리로 더한다(X2 불변식 ③ 런타임 단언, demo-seed.mts BELOW_MIN_PRODUCT).
//   demo: demoSeed()(메모리 승격) → buildSite → siteDir.   real: 실제 prerender CLI(server/seed 그대로 — review 단계 VERIFIED 0) → siteDir.
//   siteDir 는 리포 밖이어야 한다(아니면 exit 2). 리포의 어떤 파일도 쓰지 않는다.
//   준비되면 stdout 에 한 줄: E2E_READY {"port":N,"origin":"http://127.0.0.1:N"}. SIGTERM/SIGINT/stdin 종료 시 닫는다.
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/src/app.js';
import { makeInMemoryRepos } from '../../server/src/db/repos.js';
import { loadMascots } from '../../server/src/prerender/mascot.js';
import { buildSite } from '../../server/src/prerender/site.js';
import { BODY_MARKER, HEAD_MARKER } from '../../server/src/prerender/template.js';
import { runPrerenderCli, seoulToday } from '../../server/src/prerender/cli.js';
import type { MailMessage } from '../../server/src/save/mail.js';
import { FIXTURE_AS_OF } from '../../server/src/__tests__/fixtures/prerender-seed.js';
import { demoSeed, withBelowMinProduct } from './demo-seed.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MASCOTS = join(REPO_ROOT, 'docs', 'design', 'mascots');

const insideRepo = (p: string): boolean => {
  const rel = relative(REPO_ROOT, resolve(p));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

interface Args {
  mode: 'demo' | 'real';
  client: string;
  site: string;
  mail: string;
  belowMin: boolean;
}

function parseArgs(argv: string[]): Args {
  const m = new Map<string, string>();
  for (let i = 0; i + 1 < argv.length; i += 2) m.set(argv[i], argv[i + 1]);
  const mode = m.get('--mode');
  const client = m.get('--client');
  const site = m.get('--site');
  const mail = m.get('--mail');
  const belowMin = m.get('--below-min') ?? 'off';
  if ((mode !== 'demo' && mode !== 'real') || !client || !site || !mail || (belowMin !== 'on' && belowMin !== 'off')) {
    throw new Error('usage: serve.mts --mode demo|real --client <dir> --site <dir> --mail <file> [--below-min on|off]');
  }
  if (belowMin === 'on' && mode !== 'demo') throw new Error('serve.mts: --below-min on 은 --mode demo 에서만');
  return { mode, client: resolve(client), site: resolve(site), mail: resolve(mail), belowMin: belowMin === 'on' };
}

/** 빈 포트 하나(127.0.0.1). 프리렌더 origin·manifest 가 기동 전에 필요해서 먼저 정한다. */
function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => ok(port));
    });
  });
}

function buildDemo(site: string, origin: string, belowMin: boolean): void {
  const pick = (f: string): string | null => {
    const p = join(site, f);
    if (!existsSync(p)) return null;
    const h = readFileSync(p, 'utf8');
    return h.includes(HEAD_MARKER) && h.includes(BODY_MARKER) ? h : null;
  };
  const template = pick('index.html') ?? pick('shell.html');
  if (template === null) throw new Error('e2e serve: 클라이언트 빌드에 마커 있는 index.html 없음');
  const seed = belowMin ? withBelowMinProduct(demoSeed()) : demoSeed();
  const build = buildSite(seed, {
    template,
    origin,
    indexable: false,
    seedDigest: createHash('sha256').update(JSON.stringify(seed)).digest('hex'),
    asOf: FIXTURE_AS_OF,
    mascots: loadMascots(MASCOTS),
  });
  writeFileSync(join(site, 'shell.html'), template);
  const root = resolve(site);
  for (const [rel, content] of build.files) {
    const abs = resolve(root, rel);
    if (!abs.startsWith(root)) throw new Error(`e2e serve: site 밖 경로 ${rel}`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

async function buildReal(site: string, origin: string): Promise<void> {
  const err: string[] = [];
  const code = await runPrerenderCli(['--out', site], {
    stdout: (l) => process.stderr.write(`[prerender] ${l}\n`),
    stderr: (l) => err.push(l),
    // 운영 env 를 섞지 않는다: 지도 키 없음·색인 끔·SITE_ORIGIN 만.
    env: { SITE_ORIGIN: origin },
    today: () => seoulToday(),
  });
  if (code !== 0) throw new Error(`e2e serve: real prerender exit ${code}\n${err.join('\n')}`);
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  for (const p of [a.site, a.mail]) {
    if (insideRepo(p)) {
      process.stderr.write(`e2e serve: 출력 경로가 리포 안이다(${p}) — OS 임시 폴더만 허용\n`);
      process.exit(2);
    }
  }
  if (!existsSync(join(a.client, 'index.html'))) throw new Error(`e2e serve: ${a.client}/index.html 없음`);

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  mkdirSync(a.site, { recursive: true });
  cpSync(a.client, a.site, { recursive: true });
  if (a.mode === 'demo') buildDemo(a.site, origin, a.belowMin);
  else await buildReal(a.site, origin);

  writeFileSync(a.mail, '');
  const transport = {
    async send(m: MailMessage): Promise<void> {
      appendFileSync(a.mail, `${JSON.stringify(m)}\n`);
    },
  };
  const app = createApp(makeInMemoryRepos(), {
    clientDist: a.site,
    rateLimits: false,
    trustProxy: 0,
    reaction: { secret: 'e2e-secret-e2e-secret-e2e-secret-e2e', nodeEnv: 'test' },
    save: { config: { publicOrigin: origin, transport, secureCookie: false } },
  });
  const server = app.listen(port, '127.0.0.1', () => {
    process.stdout.write(`E2E_READY ${JSON.stringify({ port, origin })}\n`);
  });
  const stop = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  // 부모(플레이라이트)가 죽으면 stdin 이 닫힌다 — 고아 서버를 남기지 않는다.
  process.stdin.on('end', stop);
  process.stdin.resume();
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
