// npm run prerender — 빌드 타임 프리렌더 CLI(계획 §2 F3, D1·D7·D19·D20).
//   사용: node scripts/prerender.mjs [--seed-dir <dir>] [--out <dir>] [--site-origin <url>] [--public-dir <dir>] [--now YYYY-MM-DD] [--allow-past-now]
//   순서: validateSeed(오류 → exit 1) → seedDigest → buildSite → 이전 산출물 정리 → 쓰기 → 검사(ws-data ≤ 32KB, /assets/* 실재).
//   SITE_ORIGIN(env, 기본 http://localhost:3001) · WS_INDEXABLE=1 일 때만 robots Allow(Kenny 항목 §8-1).
//   NODE_ENV=production(도커 빌드)은 SITE_ORIGIN(또는 --site-origin) 필수·https·비 loopback·경로 없는 오리진(R6 N-2) — 아니면 exit 2.
//   exit 0 = 성공, 1 = 시드 오류·산출물 검사 실패, 2 = 사용법·입력 오류. 빌드 시각은 어떤 파일에도 쓰지 않는다.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPhotoUsable, type PhotoRec } from '../engine/index.js';
import { formatIssue, isIsoDate } from '../seed/common.js';
import { asSeedBundle, readSeedDirRaw } from '../seed/read.js';
import { affiliateGate, affiliateMapWarnings, parseAffiliateMapText, toAffiliateLinkMap, type AffiliateLinkMap, type AffiliateMapFile } from './affiliate.js';
import { validateSeed } from '../seed/validate.js';
import { seedDigest } from './digest.js';
import { loadMascots } from './mascot.js';
import { buildSite, type SiteBuild } from './site.js';
import { FEED_MANIFEST_FILE, type ProductFeedInput } from './feed-out.js';
import { DEFAULT_PRODUCT_FEED_DIR, feedGeneratedAt, feedRowsOf, loadProductFeeds, productFeedGate } from './product-feed.js';
import { lintText } from '../seed/lint.js';
import { BODY_MARKER, HEAD_MARKER } from './template.js';
import { seoulToday } from '../config/dates.js';

// seoulToday 는 config/dates.ts 로 이동(277 B) — 기존 import 경로 호환용 재 export.
export { seoulToday };

export interface PrerenderIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  /** 시드 검증·노출 기준일(--now 기본값, M-1) = 오늘(Asia/Seoul, seoulToday). 산출물에는 쓰지 않는다. */
  today: () => string;
  /** 마스코트 원본 디렉터리(기본 DEFAULT_MASCOTS). 테스트 주입용. */
  mascotDir?: string;
  /** 362 N7: 빌드 시각(ms) — 상품 피드 만료 단계(full/noprice/nofeed) 판정에만. 기본 Date.now. 산출물에는 쓰지 않는다. 테스트 주입용. */
  nowMs?: () => number;
}

export const WS_DATA_MAX_BYTES = 32 * 1024;
/** 경고 문턱(실패 아님) — 와이어(v2) 기준 여유 4KB 이하로 줄면 stderr 에 알린다(73 계획 선택안, 오케스트레이터 채택). */
export const WS_DATA_WARN_BYTES = 30 * 1024; // 11/25: 노출 9종(최대 29398B) — 경고선만 상향, 상한 32KB 불변
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
/** 259 제휴 링크 코드 맵(운영자 수동 생성, 커밋되는 ops 데이터). 게이트가 켜졌을 때만 읽는다. */
export const DEFAULT_AFFILIATE_MAP = resolve(HERE, '..', '..', 'affiliate', 'coupang.json');

const USAGE =
  'usage: prerender [--seed-dir <dir>] [--out <dir>] [--site-origin <url>] [--public-dir <dir>] [--now YYYY-MM-DD] [--allow-past-now] [--affiliate-map <file>] [--product-feed-dir <dir>]';

interface Args {
  seedDir: string;
  out: string;
  publicDir: string;
  origin: string | null;
  now: string | null;
  /** 259 제휴 맵 경로(기본 DEFAULT_AFFILIATE_MAP). 게이트 꺼짐이면 읽지 않는다. */
  affiliateMap: string;
  /** 362 N3 상품 피드 디렉터리(기본 DEFAULT_PRODUCT_FEED_DIR). 게이트 꺼짐이면 읽지 않는다. */
  productFeedDir: string;
  /** 테스트·재현용: 운영(NODE_ENV=production)에서도 오늘(서울) 아닌 --now 허용(S-R4 L-B). */
  allowPastNow: boolean;
}

function parseArgs(argv: readonly string[]): Args | string {
  const args: Args = { seedDir: DEFAULT_SEED_DIR, out: DEFAULT_OUT, publicDir: DEFAULT_PUBLIC, origin: null, now: null, allowPastNow: false, affiliateMap: DEFAULT_AFFILIATE_MAP, productFeedDir: DEFAULT_PRODUCT_FEED_DIR };
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
      case '--affiliate-map':
        args.affiliateMap = resolve(v);
        break;
      case '--product-feed-dir':
        args.productFeedDir = resolve(v);
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

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '[::]']);

/**
 * R6 N-2: 운영 프리렌더의 오리진 검사 — canonical·sitemap·OG·robots Sitemap 이 localhost 로 굽히지 않게.
 *   null = 통과, 문자열 = 오류(변수명 SITE_ORIGIN 포함). 기본값(http://localhost:3001)으로의 폴백은 운영에서 없다.
 */
export function productionOriginProblem(origin: string | null | undefined): string | null {
  const raw = (origin ?? '').trim();
  const hint = '— 도커: --build-arg SITE_ORIGIN=https://<도메인>';
  if (raw === '') return `SITE_ORIGIN 미설정: NODE_ENV=production 프리렌더는 SITE_ORIGIN(또는 --site-origin) 필수 ${hint}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return `SITE_ORIGIN 형식 오류(URL 아님): ${raw} ${hint}`;
  }
  if (u.protocol !== 'https:') return `SITE_ORIGIN 은 https 만(NODE_ENV=production): ${raw} ${hint}`;
  const host = u.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost') || /^127\./.test(host)) {
    return `SITE_ORIGIN 이 localhost/loopback(NODE_ENV=production): ${raw} ${hint}`;
  }
  if (u.origin !== raw.replace(/\/$/, '')) return `SITE_ORIGIN 은 경로·쿼리·자격증명 없는 오리진만: ${raw} ${hint}`;
  return null;
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
        // 294: 사전 압축 사본(.br/.gz)도 — 비노출로 바뀐 페이지(/privacy 등)의 옛 사본이 dist 에 남지 않게.
        if (abs) for (const f of [abs, `${abs}.br`, `${abs}.gz`]) rmSync(f, { force: true });
      }
    } catch {
      /* 손상된 manifest — 덮어쓴다 */
    }
  }
  // 362 N7: 이전 빌드의 상품 피드 변형 파일(+압축 사본)과 manifest — 만료·꺼짐으로 바뀐 뒤 옛 피드가 dist 에 남지 않게.
  const feedMan = join(out, FEED_MANIFEST_FILE);
  if (existsSync(feedMan)) {
    try {
      const m = JSON.parse(readFileSync(feedMan, 'utf8')) as { variants?: Record<string, unknown> };
      for (const list of Object.values(m.variants ?? {})) {
        for (const rel of Array.isArray(list) ? list : []) {
          const abs = typeof rel === 'string' && rel.endsWith('.json') ? inside(out, rel) : null;
          if (abs) for (const f of [abs, `${abs}.br`, `${abs}.gz`]) rmSync(f, { force: true });
        }
      }
    } catch {
      /* 손상된 feed manifest — 아래에서 지운다 */
    }
    for (const f of [feedMan, `${feedMan}.br`, `${feedMan}.gz`]) rmSync(f, { force: true });
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

/** 사용 가능 사진(engine isPhotoUsable)의 asset 경로 — 프리렌더가 실재를 확인한다(354). */
export function usablePhotoAssets(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  const out: string[] = [];
  for (const p of photos as PhotoRec[]) {
    if (p && typeof p === 'object' && typeof p.asset === 'string' && isPhotoUsable(p)) out.push(p.asset);
  }
  return out;
}

export async function runPrerenderCli(argv: readonly string[], io: PrerenderIo): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === 'string') {
    io.stderr(`prerender: ${args}`);
    io.stderr(USAGE);
    return 2;
  }
  const explicitOrigin = args.origin ?? io.env.SITE_ORIGIN;
  const indexable = io.env.WS_INDEXABLE === '1';
  const production = io.env.NODE_ENV === 'production';

  // N-2(R6): 운영 빌드는 오리진 폴백 없음 — 미설정·localhost·비 https 면 입력 오류.
  if (production) {
    const problem = productionOriginProblem(explicitOrigin);
    if (problem !== null) {
      io.stderr(`prerender: ${problem}`);
      return 2;
    }
  }
  // 비운영은 기존 의미 그대로(미설정 → 기본값). 운영은 검사 통과 값(끝 슬래시 제거).
  const origin = production ? (explicitOrigin ?? '').trim().replace(/\/$/, '') : (explicitOrigin ?? DEFAULT_ORIGIN);

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
  const { raw, issues, signatures } = readSeedDirRaw(args.seedDir);
  // --now = 시드 검증 기준일이자 노출 기준일(M-1 검수 나이). 산출물에는 쓰지 않는다.
  const asOf = args.now ?? io.today();
  const res = validateSeed(raw, { now: asOf, strict: false, signatures });
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

  // 259 제휴 게이트(기본 꺼짐): production ∧ WS_AFFILIATE_PROVIDERS ∋ COUPANG ∧ origin ∈ WS_AFFILIATE_ORIGINS.
  //   꺼짐이면 맵을 읽지 않는다 — 산출물은 제휴 코드 이전과 바이트 동일. 켜짐인데 맵이 없거나 무효면 입력 오류(exit 2). 네트워크 0.
  const gate = affiliateGate(io.env, origin, production);
  let affFile: AffiliateMapFile | null = null;
  let affiliate: AffiliateLinkMap | undefined;
  if (gate.on) {
    let text: string;
    try {
      text = readFileSync(args.affiliateMap, 'utf8');
      JSON.parse(text);
    } catch {
      io.stderr(`prerender: 제휴 게이트 켜짐인데 맵을 읽을 수 없다(없음·JSON 아님): ${args.affiliateMap}`);
      return 2;
    }
    try {
      affFile = parseAffiliateMapText(text); // 273: 원문 중복 키까지 거부
    } catch (e) {
      io.stderr(`prerender: ${(e as Error).message}`);
      return 2;
    }
    affiliate = toAffiliateLinkMap(affFile);
  } else if ((io.env.WS_AFFILIATE_PROVIDERS ?? '').trim() !== '') {
    io.stderr(`prerender: 제휴 꺼짐(${gate.reason})`);
  }

  // 362 N3 상품 피드 게이트(기본 꺼짐, D-6): production ∧ WS_PRODUCT_FEED=public ∧ origin ∈ WS_AFFILIATE_ORIGINS.
  //   꺼짐이면 피드 디렉터리를 읽지 않는다 — 산출물 바이트 불변. 켜짐인데 파일이 없거나 무효면 입력 오류(exit 2). 네트워크 0.
  const feedGate = productFeedGate(io.env, origin, production);
  let productFeed: ProductFeedInput | undefined;
  if (feedGate.on) {
    try {
      const feeds = loadProductFeeds((name) => readFileSync(join(args.productFeedDir, name), 'utf8'));
      productFeed = {
        rows: feedRowsOf(feeds),
        generatedAt: feedGeneratedAt(feeds),
        buildAtMs: io.nowMs ? io.nowMs() : Date.now(),
        isTitleBanned: (t) => lintText(t).length > 0,
      };
    } catch (e) {
      const msg = (e as { code?: string }).code === 'ENOENT' ? `상품 피드 게이트 켜짐인데 파일 없음: ${args.productFeedDir}` : (e as Error).message;
      io.stderr(`prerender: ${msg}`);
      return 2;
    }
  } else if ((io.env.WS_PRODUCT_FEED ?? '').trim() !== '') {
    io.stderr(`prerender: 상품 피드 꺼짐(${feedGate.reason})`);
  }

  let b: SiteBuild;
  try {
    // G-4: 지도 키는 존재 여부만 넘긴다(값은 프리렌더 산출물에 들어가지 않는다).
    const vetMap = (io.env.VITE_NAVER_MAP_CLIENT_ID ?? '').trim() !== '';
    b = buildSite(asSeedBundle(raw), { template, origin, indexable, seedDigest: seedDigest(args.seedDir), asOf, mascots, vetMap, production, affiliate, productFeed });
  } catch (e) {
    io.stderr(`prerender: ${(e as Error).message}`);
    return 1;
  }

  // 산출물 검사(쓰기 전).
  const fails: string[] = [];
  for (const p of b.pages) {
    if (p.wsDataBytes > WS_DATA_MAX_BYTES) fails.push(`${p.route.path}: ws-data ${p.wsDataBytes}B > ${WS_DATA_MAX_BYTES}B`);
    else if (p.wsDataBytes > WS_DATA_WARN_BYTES) io.stderr(`prerender: 경고 ${p.route.path}: ws-data ${p.wsDataBytes}B > ${WS_DATA_WARN_BYTES}B(상한 ${WS_DATA_MAX_BYTES}B)`);
  }
  // 354: 사용 가능(READY·기록 완전) 사진의 배포 파일도 실재해야 한다 — 화면 연결 전이라도 「기록만 있고 파일 없는 사진」을 막는다.
  const refs = new Set([...referencedAssets(b), ...usablePhotoAssets(raw.photos)]);
  for (const ref of [...refs].sort()) {
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

  if (affFile !== null) {
    const keywords = new Set(b.model.types.flatMap((t) => t.requirements.map((r) => r.pub.searchKeyword)));
    for (const w of affiliateMapWarnings(affFile, keywords, asOf)) io.stderr(`prerender: ${w}`);
    const matched = affFile.entries.filter((e) => keywords.has(e.keyword)).length;
    io.stdout(`prerender — affiliate COUPANG on, map entries ${affFile.entries.length}, matched ${matched}/${keywords.size} keywords`);
  }

  if (productFeed) {
    const m = b.files.get(FEED_MANIFEST_FILE);
    const v = m ? (JSON.parse(m) as { variants: { full: string[]; noprice: string[] } }).variants : { full: [], noprice: [] };
    io.stdout(`prerender — product feed on, rows ${productFeed.rows.length}, files full ${v.full.length} · noprice ${v.noprice.length}`);
  }

  const pages = b.routes.filter((r) => r.kind !== 'NOT_FOUND').length;
  const idx = b.routes.filter((r) => r.indexable).length;
  io.stdout(`prerender — pages ${pages} (+404), indexable ${idx}, types ${b.model.types.length}`);
  return 0;
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
