// 데모 사이트(화면 검수용, R4 D1) — vitest 수집 대상 아님(파일명에 .test 없음).
//   사용: npm run demo:site -w server [-- --out <dir>] [--port 4173] [--now YYYY-MM-DD]
//   promoted() 승격 시드를 메모리에서만 확장(후기 8건·병원 3건 자리표시) → buildSite → client/dist 사본(OS 임시폴더)에 출력 → express+mountSpa 서빙.
//   디스크의 시드 파일·리포 어떤 파일도 쓰지 않는다(불변식 ⑦: 승격·자리표시는 메모리·임시폴더에만). --out 이 리포 안이면 exit 2.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { SeedBundle } from '../../engine/index.js';
import { loadMascots } from '../../prerender/mascot.js';
import { buildSite } from '../../prerender/site.js';
import { BODY_MARKER, HEAD_MARKER } from '../../prerender/template.js';
import { mountSpa } from '../../middleware/spa.js';
import { FIXTURE_AS_OF, promoted } from '../fixtures/prerender-seed.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const CLIENT_DIST = join(REPO_ROOT, 'client', 'dist');
const MASCOTS = join(REPO_ROOT, 'docs', 'design', 'mascots');

const isInsideRepo = (p: string): boolean => {
  const rel = relative(REPO_ROOT, p);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

function parseArgs(argv: string[]): { out: string | null; port: number; now: string } | string {
  const a = { out: null as string | null, port: 4173, now: FIXTURE_AS_OF };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const v = argv[i + 1];
    if (v === undefined) return `${flag} 값이 없다`;
    i++;
    if (flag === '--out') a.out = resolve(v);
    else if (flag === '--port') a.port = Number(v);
    else if (flag === '--now') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return `--now 는 YYYY-MM-DD: ${v}`;
      a.now = v;
    } else return `알 수 없는 인자: ${flag}`;
  }
  if (!Number.isInteger(a.port) || a.port < 1 || a.port > 65535) return '--port 는 1~65535';
  return a;
}

/** 메모리 확장: 후기 8건("[데모] 후기 자리 N")·병원 3건("[데모] 병원 N"). 실제 문장·병원 사실 창작 없음. */
function demoSeed(): SeedBundle {
  const s = promoted();
  const base = s.testimonials.slice(0, 8);
  if (base.length < 8) throw new Error('demo: 시드 후기 슬롯이 8건 미만');
  s.testimonials = base.map((t, i) => ({
    ...t,
    quote: `[데모] 후기 자리 ${i + 1}`,
    status: 'APPROVED',
    verifiedUsage: true,
    consentAt: '2026-09-26',
  }));
  const regions = ['서울 마포구', '서울 강남구', '서울 서초구'];
  s.vetClinics = regions.map((region, i) => ({
    id: `vc-demo-0${i + 1}`,
    name: `[데모] 병원 ${i + 1}`,
    region,
    treats: ['hamster-golden'],
    night: null,
    emergency: null,
    phone: '[데모] 전화 자리',
    address: '[데모] 주소 자리',
    lat: null,
    lng: null,
    verification: { status: 'VERIFIED', method: 'PHONE_CALL', verifiedAt: '2026-09-28', note: null },
  }));
  return s;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(`demo-site: ${args}`);
    console.error('usage: demo-site [--out <dir>] [--port 4173] [--now YYYY-MM-DD]');
    return 2;
  }
  if (args.out !== null && isInsideRepo(args.out)) {
    console.error(`demo-site: --out 이 리포 안이다(${args.out}) — OS 임시폴더 하위만 허용`);
    return 2;
  }
  if (!existsSync(CLIENT_DIST)) {
    console.error('demo-site: client/dist 없음 — npm run build -w client 먼저');
    return 2;
  }
  const out = args.out ?? mkdtempSync(join(tmpdir(), 'ws-demo-'));
  mkdirSync(out, { recursive: true });
  cpSync(CLIENT_DIST, out, { recursive: true });

  const pick = (f: string): string | null => {
    const p = join(out, f);
    if (!existsSync(p)) return null;
    const h = readFileSync(p, 'utf8');
    return h.includes(HEAD_MARKER) && h.includes(BODY_MARKER) ? h : null;
  };
  const template = pick('index.html') ?? pick('shell.html');
  if (template === null) {
    console.error('demo-site: client/dist 에 마커 있는 index.html/shell.html 없음');
    return 2;
  }

  const seed = demoSeed();
  const digest = createHash('sha256').update(JSON.stringify(seed)).digest('hex');
  const build = buildSite(seed, {
    template,
    origin: `http://localhost:${args.port}`,
    indexable: false,
    seedDigest: digest,
    asOf: args.now,
    mascots: loadMascots(MASCOTS),
  });
  writeFileSync(join(out, 'shell.html'), template);
  for (const [rel, content] of build.files) {
    const abs = resolve(out, rel);
    if (!abs.startsWith(resolve(out))) throw new Error(`demo-site: out 밖 경로 ${rel}`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  const app = express();
  mountSpa(app, { clientDist: out });
  const server = app.listen(args.port, '127.0.0.1', () => {
    console.log(`demo-site: http://127.0.0.1:${args.port}/  (asOf ${args.now}, 출력 ${out})`);
    console.log('routes:');
    for (const r of build.routes) console.log(`  ${r.path}  [${r.kind}]`);
    console.log('Ctrl+C 로 종료');
  });
  const stop = (): void => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return await new Promise<number>(() => {
    /* 서버가 떠 있는 동안 대기 */
  });
}

process.exitCode = await main();
