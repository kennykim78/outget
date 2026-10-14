// npm run prerender — 빌드 타임 프리렌더 CLI(계획 §2 F3, D1·D7·D19·D20).
//   사용: node scripts/prerender.mjs [--seed-dir <dir>] [--out <dir>] [--site-origin <url>] [--public-dir <dir>] [--now YYYY-MM-DD] [--allow-past-now]
//   순서: validateSeed(오류 → exit 1) → seedDigest → buildSite → 이전 산출물 정리 → 쓰기 → 검사(ws-data ≤ 32KB, /assets/* 실재).
//   SITE_ORIGIN(env, 기본 http://localhost:3001) · WS_INDEXABLE=1 일 때만 robots Allow(Kenny 항목 §8-1).
//   exit 0 = 성공, 1 = 시드 오류·산출물 검사 실패, 2 = 사용법·입력 오류. 빌드 시각은 어떤 파일에도 쓰지 않는다.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatIssue, isIsoDate } from '../seed/common.js';
import { asSeedBundle, readSeedDirRaw } from '../seed/read.js';
import { validateSeed } from '../seed/validate.js';
import { seedDigest } from './digest.js';
import { loadMascots } from './mascot.js';
import { buildSite, type SiteBuild } from './site.js';
import { BODY_MARKER, HEAD_MARKER } from './template.js';

export interface PrerenderIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  /** 시드 검증·노출 기준일(--now 기본값, M-1) = 오늘(Asia/Seoul, seoulToday). 산출물에는 쓰지 않는다. */
  today: () => string;
  /** 마스코트 원본 디렉터리(기본 DEFAULT_MASCOTS). 테스트 주입용. */
  mascotDir?: string;
}

export const WS_DATA_MAX_BYTES = 32 * 1024;
/** 원본 템플릿 보존본 — index.html 이 홈 프리렌더로 덮이므로 재실행·/save 셸이 이것을 쓴다. */
export const SHELL_FILE = 'shell.html';

const HERE = dirname(fileURLToPath(import.meta.url));
// src/prerender 와 dist/prerender 모두 server/ 아래 두 단계.
export const DEFAULT_SEED_DIR = resolve(HERE, '..', '..', 'seed');
export const DEFAULT_OUT = resolve(HERE, '..', '..', '..', 'client', 'dist');
export const DEFAULT_PUBLIC = resolve(HERE, '..', '..', '..', 'client', 'public');
/** 마스코트 원본(리포 디자인 자산, 스펙22 §2.16) — 히어로·컨텍스트 헤더 인라인 SVG. */
export const DEFAULT_MASCOTS = resolve(HERE, '..', '..', '..', 'docs', 'design', 'mascots');
const DEFAULT_ORIGIN = 'http://localhost:3001';

const USAGE =
  'usage: prerender [--seed-dir <dir>] [--out <dir>] [--site-origin <url>] [--public-dir <dir>] [--now YYYY-MM-DD] [--allow-past-now]';

interface Args {
  seedDir: string;
  out: string;
  publicDir: string;
  origin: string | null;
  now: string | null;
  /** 테스트·재현용: 운영(NODE_ENV=production)에서도 오늘(서울) 아닌 --now 허용(S-R4 L-B). */
  allowPastNow: boolean;
}

function parseArgs(argv: readonly string[]): Args | string {
  const args: Args = { seedDir: DEFAULT_SEED_DIR, out: DEFAULT_OUT, publicDir: DEFAULT_PUBLIC, origin: null, now: null, allowPastNow: false };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === '--allow-past-now') {
      args.allowPastNow = true;
      continue;
    }
    const eq = raw.indexOf('=');
    const flag = raw.startsWith('--') && eq > 0 ? raw.slice(0, eq) : raw;
    const inline = raw.startsWith('--') && eq > 0 ? raw.slice(eq + 1) : null;
    const value = (): string | null => inline ?? (i + 1 < argv.length ? argv[++i] : null);
    const v = flag.startsWith('--') ? value() : null;
    if (v === null || v === '') return `${flag} 값이 없다`;
    switch (flag) {
      case '--seed-dir':
        args.seedDir = resolve(v);
        break;
      case '--out':
        args.out = resolve(v);
        break;
      case '--public-dir':
        args.publicDir = resolve(v);
        break;
      case '--site-origin':
        args.origin = v;
        break;
      case '--now':
        if (!isIsoDate(v)) return `--now 는 YYYY-MM-DD: ${v}`;
        args.now = v;
        break;
      default:
        return `알 수 없는 인자: ${raw}`;
    }
  }
  return args;
}

const hasMarkers = (html: string): boolean => html.includes(HEAD_MARKER) && html.includes(BODY_MARKER);

/** 템플릿: 새 client 빌드면 index.html(마커 있음), 이미 프리렌더됐으면 shell.html. */
function loadTemplate(out: string): string | null {
  const index = join(out, 'index.html');
  const shell = join(out, SHELL_FILE);
  if (existsSync(index)) {
    const html = readFileSync(index, 'utf8');
    if (hasMarkers(html)) return html;
  }
  if (existsSync(shell)) {
    const html = readFileSync(shell, 'utf8');
    if (hasMarkers(html)) return html;
  }
  return null;
}

/** out 내부 경로만(경로 이탈 방지). */
function inside(out: string, rel: string): string | null {
  const abs = resolve(out, rel);
  return abs.startsWith(out + sep) ? abs : null;
}

/** 이전 실행 산출물 제거(manifest 의 라우트 파일 + data/catalog.v1.*.json) — 비노출로 바뀐 페이지가 남지 않게. */
function cleanPrevious(out: string): void {
  const manPath = join(out, 'prerender-manifest.json');
  if (existsSync(manPath)) {
    try {
      const m = JSON.parse(readFileSync(manPath, 'utf8')) as { routes?: Array<{ file?: unknown }> };
      for (const r of Array.isArray(m.routes) ? m.routes : []) {
        if (typeof r.file !== 'string' || r.file === 'index.html') continue; // index.html 은 아래에서 덮어씀
        const abs = inside(out, r.file);
        if (abs) rmSync(abs, { force: true });
      }
    } catch {
      /* 손상된 manifest — 덮어쓴다 */
    }
  }
  const dataDir = join(out, 'data');
  if (existsSync(dataDir)) {
    for (const f of readdirSync(dataDir)) if (/^catalog\.v1\.[0-9a-f]{8}\.json$/.test(f)) rmSync(join(dataDir, f), { force: true });
  }
}

/** 산출물이 참조하는 /assets/* 경로(HTML src/href, ws-data·카탈로그의 imageAsset·reviewerImage). */
export function referencedAssets(b: SiteBuild): string[] {
  const refs = new Set<string>();
  for (const p of b.pages) {
    for (const m of p.html.matchAll(/\b(?:src|href)="(\/assets\/[^"?#]+)/g)) refs.add(m[1]);
    for (const x of p.data.data.products) if (x.imageAsset) refs.add(x.imageAsset);
    for (const t of p.data.data.testimonials) if (t.reviewerImage) refs.add(t.reviewerImage);
  }
  return [...refs].sort();
}

export async function runPrerenderCli(argv: readonly string[], io: PrerenderIo): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === 'string') {
    io.stderr(`prerender: ${args}`);
    io.stderr(USAGE);
    return 2;
  }
  const origin = args.origin ?? io.env.SITE_ORIGIN ?? DEFAULT_ORIGIN;
  const indexable = io.env.WS_INDEXABLE === '1';
  const production = io.env.NODE_ENV === 'production';

  // L-B(S-R4): 운영 빌드는 오늘(서울)만 — 과거·미래 --now 로 강등을 늦추지 못하게. 테스트·재현은 --allow-past-now.
  if (production && args.now !== null && !args.allowPastNow && args.now !== io.today()) {
    io.stderr(`prerender: NODE_ENV=production 에서 --now(${args.now}) 는 오늘(Asia/Seoul ${io.today()})만 — 의도한 재현이면 --allow-past-now`);
    return 2;
  }

  // L-F(S-R4): 마스코트 원본 — 운영에서 디렉터리가 없으면 실패(빈 마스코트로 조용히 배포 금지). 정제 실패도 입력 오류.
  const mascotDir = io.mascotDir ?? DEFAULT_MASCOTS;
  let mascots: Map<string, string>;
  try {
    mascots = loadMascots(mascotDir, { required: production });
  } catch (e) {
    io.stderr(`prerender: ${(e as Error).message}`);
    return 2;
  }

  // D20 — 시드 검증 선행.
  const { raw, issues } = readSeedDirRaw(args.seedDir);
  // --now = 시드 검증 기준일이자 노출 기준일(M-1 검수 나이). 산출물에는 쓰지 않는다.
  const asOf = args.now ?? io.today();
  const res = validateSeed(raw, { now: asOf, strict: false });
  const errors = [...issues, ...res.errors];
  if (errors.length > 0) {
    for (const i of errors) io.stderr(formatIssue(i));
    io.stderr(`prerender: seed:validate errors ${errors.length} — 프리렌더 중단`);
    return 1;
  }

  const template = loadTemplate(args.out);
  if (template === null) {
    io.stderr(`prerender: ${args.out} 에 마커(${HEAD_MARKER}, ${BODY_MARKER})가 있는 index.html/${SHELL_FILE} 없음 — npm run build -w client 먼저`);
    return 2;
  }

  let b: SiteBuild;
  try {
    // G-4: 지도 키는 존재 여부만 넘긴다(값은 프리렌더 산출물에 들어가지 않는다).
    const vetMap = (io.env.VITE_NAVER_MAP_CLIENT_ID ?? '').trim() !== '';
    b = buildSite(asSeedBundle(raw), { template, origin, indexable, seedDigest: seedDigest(args.seedDir), asOf, mascots, vetMap });
  } catch (e) {
    io.stderr(`prerender: ${(e as Error).message}`);
    return 1;
  }

  // 산출물 검사(쓰기 전).
  const fails: string[] = [];
  for (const p of b.pages) {
    if (p.wsDataBytes > WS_DATA_MAX_BYTES) fails.push(`${p.route.path}: ws-data ${p.wsDataBytes}B > ${WS_DATA_MAX_BYTES}B`);
  }
  for (const ref of referencedAssets(b)) {
    const rel = ref.slice(1);
    const inOut = inside(args.out, rel);
    const inPublic = inside(args.publicDir, rel);
    if (!(inOut && existsSync(inOut)) && !(inPublic && existsSync(inPublic))) fails.push(`참조 자산 없음: ${ref}`);
  }
  if (fails.length > 0) {
    for (const f of fails) io.stderr(`prerender: ${f}`);
    return 1;
  }

  cleanPrevious(args.out);
  writeFileSync(join(args.out, SHELL_FILE), template);
  for (const [rel, content] of b.files) {
    const abs = inside(args.out, rel);
    if (!abs) {
      io.stderr(`prerender: out 밖 경로 ${rel}`);
      return 1;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  const pages = b.routes.filter((r) => r.kind !== 'NOT_FOUND').length;
  const idx = b.routes.filter((r) => r.indexable).length;
  io.stdout(`prerender — pages ${pages} (+404), indexable ${idx}, types ${b.model.types.length}`);
  return 0;
}

/**
 * 오늘(Asia/Seoul) YYYY-MM-DD — CI `TZ=Asia/Seoul date +%F` 와 같은 뜻(S-R4 L-A). 러너 로컬 시간대(UTC 등)와 무관.
 *   scripts/compliance-scan.mjs seoulToday 와 같은 구현(패리티 테스트).
 */
export function seoulToday(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const norm = (u: string): string => (process.platform === 'win32' ? u.toLowerCase() : u);
  return norm(pathToFileURL(resolve(entry)).href) === norm(import.meta.url);
}

if (isMain()) {
  process.exitCode = await runPrerenderCli(process.argv.slice(2), {
    stdout: (l) => process.stdout.write(`${l}\n`),
    stderr: (l) => process.stderr.write(`${l}\n`),
    env: process.env,
    today: () => seoulToday(),
  });
}
