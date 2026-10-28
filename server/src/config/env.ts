// 공용 실행 환경 판정(SEC-3 L-5·L-6·M-2). 서버의 모든 "운영이면 엄격" 분기는 이 파일을 거친다.
//   isProdLike: NODE_ENV 가 정확히 'development' 또는 'test' 가 아니면 운영으로 본다 — 미설정·오타·staging 도 fail-closed.
//   parseTrustProxy: Express 'trust proxy' 정수 홉 수만(기본 0 = X-Forwarded-For 무시). true 는 XFF 위조 허용이라 거부.
//   assertJwtSecrets: 운영에서 JWT 시크릿 32자 미만이면 기동 실패.
//   collectEnvProblems(R6 A3): 기동 전 누락·무효 env 를 한 번에 모은다(개별 throw 를 목록화 — 규칙 원본은 각 모듈 그대로).
//     직접 실행(`node dist/config/env.js`, docker-entrypoint 의 첫 단계) 시 목록 출력 후 exit 1. 시크릿 값은 출력하지 않는다.
//   privacyPlaceholderCheck(계획 86 P11 후속, 오케스트레이터 2026-10-25): 운영 기동 시 프리렌더 /privacy/index.html 에 Kenny 미정
//     자리표시({{KENNY:)가 있으면 기동 거부. 예외는 WS_ALLOW_PRIVACY_PLACEHOLDER=1(CI 도커 스모크·점검용, 경고 로그). 빌드(compliance C9)는 WARN 만.
//     101 MED-3: 검사 대상 경로 = SPA 서빙과 같은 resolveClientDist(middleware/spa.ts 가 이 함수를 쓴다). 운영에서 페이지가 없어도 기동 거부.
//     101 L-1: 판정은 '{{KENNY:' 포함 여부(키 모양 무관) — 키 목록은 표시용 보조.
//     139 MED-2: 공개 전환(WS_INDEXABLE=1 또는 빌드 산출 prerender-manifest.json 의 indexable:true)이면 허용 변수를 무시하고 기동 거부.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type Env = Record<string, string | undefined>;

const NON_PROD = new Set(['development', 'test']);

export function isProdLike(env: Env = process.env): boolean {
  return !NON_PROD.has(env.NODE_ENV ?? '');
}

/** 프록시 홉 상한 — 이보다 큰 값은 구성 오류로 본다. */
export const TRUST_PROXY_MAX = 10;

export function parseTrustProxy(env: Env = process.env): number {
  const raw = (env.TRUST_PROXY ?? '').trim();
  if (raw === '') return 0;
  if (!/^\d{1,2}$/.test(raw)) {
    throw new Error(`TRUST_PROXY: 0 이상 정수 홉 수만 허용(true·CIDR·이름 금지) — 값은 출력하지 않음(SEC-6 L-1)`);
  }
  const n = Number(raw);
  if (n > TRUST_PROXY_MAX) throw new Error(`TRUST_PROXY: ${TRUST_PROXY_MAX} 이하만 허용`);
  return n;
}

export const JWT_SECRET_MIN = 32;

export function assertJwtSecrets(env: Env = process.env): void {
  if (!isProdLike(env)) return;
  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const v = env[name] ?? '';
    if (v.length < JWT_SECRET_MIN) {
      throw new Error(`${name}: 운영에서는 ${JWT_SECRET_MIN}자 이상 필수(SEC-3 L-5)`);
    }
  }
}

export interface EnvReport {
  /** 기동을 막는 문제(각 줄은 변수명으로 시작, 값 미포함 — 시크릿 0). */
  problems: string[];
  /** 기동은 하되 확인이 필요한 항목. */
  warnings: string[];
}

const KNOWN_NODE_ENV = new Set(['development', 'test', 'production']);
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 오리진 비교용(끝 슬래시·대소문자 무시). URL 이 아니면 원문 trim. */
function normOrigin(raw: string): string {
  const v = raw.trim();
  try {
    return new URL(v).origin;
  } catch {
    return v.replace(/\/$/, '');
  }
}

/**
 * 기동 전 env 검사 — 개별 모듈의 throw 규칙을 그대로 호출해 첫 오류에서 멈추지 않고 모두 모은다.
 *   규칙 원본: PUBLIC_ORIGIN·MAIL_TRANSPORT = save/config.ts resolveSaveConfig, REACTION_KEY_SECRET = reaction/anon-key.ts,
 *   JWT_* = JWT_SECRET_MIN, TRUST_PROXY = parseTrustProxy. 동적 import 로 순환 의존(이 모듈 ← save·reaction)을 피한다.
 */
export const ALLOW_PRIVACY_PLACEHOLDER_ENV = 'WS_ALLOW_PRIVACY_PLACEHOLDER';
/** 사이트 색인 허용(공개 전환) 변수 — prerender/cli.ts 와 같은 이름. */
export const INDEXABLE_ENV = 'WS_INDEXABLE';
/** 자리표시 판정 표식(L-1: 이것만 있으면 거부 — 닫는 괄호·키 문자 모양 무관). */
const PLACEHOLDER_MARK = '{{KENNY:';
/** 표시용 키 추출(보조). 닫는 }} 까지 최대 64자, 못 찾으면 '?'. */
const PLACEHOLDER_KEY_RE = /\{\{KENNY:([^{}\s]{0,64})\}\}/g;

/** 클라이언트 빌드 경로 해석 입력(테스트 주입용 — 기본 = 이 모듈 위치·process.cwd()·existsSync). */
export interface ClientDistBase {
  here?: string;
  cwd?: string;
  exists?: (path: string) => boolean;
}

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));
/** WS_CLIENT_DIST: 비운영(development·test)에서만 존중하는 클라이언트 빌드 경로 덮어쓰기. */
export const CLIENT_DIST_ENV = 'WS_CLIENT_DIST';

/**
 * 후보(앞에서부터 index.html 이 있는 첫 디렉터리):
 *   ① <cwd>/../client/dist — npm -w server start·도커(cwd=/app/server → /app/client/dist)
 *   ② <here>/../../../client/dist — server/{src,dist}/<config|middleware> → <repo>/client/dist, 도커 /app/server/dist/x → /app/client/dist
 *   ③ <here>/../../client/dist · ④ <cwd>/client/dist — 그 밖의 복사 레이아웃
 *   (config/ 와 middleware/ 는 같은 깊이라 ②③은 어느 쪽에서 불러도 같다.)
 */
export function clientDistCandidates(base: ClientDistBase = {}): string[] {
  const here = base.here ?? CONFIG_DIR;
  const cwd = base.cwd ?? process.cwd();
  return [
    resolve(cwd, '..', 'client', 'dist'),
    resolve(here, '..', '..', '..', 'client', 'dist'),
    resolve(here, '..', '..', 'client', 'dist'),
    resolve(cwd, 'client', 'dist'),
  ];
}

/**
 * 클라이언트 빌드(프리렌더 산출) 디렉터리 — SPA 서빙(middleware/spa.ts mountSpa)과 기동 검사(privacyPlaceholderCheck)가 같은 값을 쓴다(101 MED-3).
 *   WS_CLIENT_DIST 는 비운영에서만 존중(운영은 무시 — 검사한 파일과 서빙하는 파일이 갈라지지 않게).
 *   후보 중 index.html 있는 첫 디렉터리, 없으면 ②(설치 위치 기준) — 그 경우 운영 기동 검사가 페이지 없음으로 거부한다.
 */
export function resolveClientDist(env: Env = process.env, base: ClientDistBase = {}): string {
  const override = (env[CLIENT_DIST_ENV] ?? '').trim();
  if (override !== '' && !isProdLike(env)) return resolve(override);
  const exists = base.exists ?? existsSync;
  const candidates = clientDistCandidates(base);
  return candidates.find((d) => exists(join(d, 'index.html'))) ?? candidates[1];
}

/** @deprecated 101 MED-3 이후 resolveClientDist 와 같다(기존 호출 호환). */
export const bootClientDist = (env: Env = process.env): string => resolveClientDist(env);

/**
 * 운영(isProdLike)에서 <clientDist>/privacy/index.html 검사:
 *   · 파일 없음 → problems(기동 거부, 101 MED-3 — 처리방침 없이 공개 운영 금지)
 *   · '{{KENNY:' 포함 → problems(기동 거부, 키 목록 표시). WS_ALLOW_PRIVACY_PLACEHOLDER=1 이면 이 항목만 warnings 로 강등.
 *     단 공개 전환(publicIndexing: WS_INDEXABLE=1 또는 manifest indexable:true)이면 강등하지 않는다(139 MED-2).
 *   비운영은 검사 안 함.
 */
export function privacyPlaceholderCheck(env: Env, clientDist: string): EnvReport {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!isProdLike(env)) return { problems, warnings };
  const file = join(clientDist, 'privacy', 'index.html');
  if (!existsSync(file)) {
    problems.push(`privacy: 처리방침 페이지 없음(${file}) — 운영 기동 거부. 클라이언트 빌드·프리렌더(/privacy) 후 다시 배포`);
    return { problems, warnings };
  }
  const text = readFileSync(file, 'utf8');
  if (!text.includes(PLACEHOLDER_MARK)) return { problems, warnings };
  const keys = [...new Set([...text.matchAll(PLACEHOLDER_KEY_RE)].map((m) => m[1] || '?'))];
  const list = keys.length > 0 ? keys.join(', ') : '?';
  const pub = publicIndexing(env, clientDist);
  if ((env[ALLOW_PRIVACY_PLACEHOLDER_ENV] ?? '').trim() === '1' && pub === null) {
    warnings.push(`${ALLOW_PRIVACY_PLACEHOLDER_ENV}=1: 처리방침 자리표시 {{KENNY:…}}(${list}) 가 남은 채 기동 — 공개 운영 금지(점검·CI 전용)`);
  } else {
    problems.push(
      pub === null
        ? `privacy: 처리방침(/privacy)에 Kenny 미정 자리표시 {{KENNY:…}}(${list}) — 운영 기동 거부. 값을 채워 다시 빌드하거나, 점검용이면 ${ALLOW_PRIVACY_PLACEHOLDER_ENV}=1`
        : `privacy: 처리방침(/privacy)에 Kenny 미정 자리표시 {{KENNY:…}}(${list}) — 공개 전환(${pub}) 상태라 ${ALLOW_PRIVACY_PLACEHOLDER_ENV} 무시, 운영 기동 거부(139 MED-2). 값을 채워 다시 빌드`,
    );
  }
  return { problems, warnings };
}

/**
 * 공개 전환 여부(139 MED-2) — 근거 문자열, 아니면 null.
 *   · env WS_INDEXABLE 이 '1'(앞뒤 공백 무시 — 거부 쪽으로 넓게)
 *   · <clientDist>/prerender-manifest.json 의 indexable === true(빌드가 이미 색인 허용으로 나간 경우 — 런타임 env 와 무관)
 *   manifest 없음·손상은 근거 아님(그 경우는 env 만 본다).
 */
export function publicIndexing(env: Env, clientDist: string): string | null {
  if ((env[INDEXABLE_ENV] ?? '').trim() === '1') return `${INDEXABLE_ENV}=1`;
  try {
    const m = JSON.parse(readFileSync(join(clientDist, 'prerender-manifest.json'), 'utf8')) as { indexable?: unknown } | null;
    if (m !== null && typeof m === 'object' && m.indexable === true) return 'prerender-manifest indexable:true';
  } catch {
    // 없음·손상 → 근거 아님
  }
  return null;
}

export interface CollectEnvOptions {
  /** 주면 privacyPlaceholderCheck 도 실행(직접 실행 = bootClientDist). 생략·null 이면 건너뜀(단위 테스트·라이브러리 호출). */
  clientDist?: string | null;
}

export async function collectEnvProblems(env: Env = process.env, opts: CollectEnvOptions = {}): Promise<EnvReport> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const prod = isProdLike(env);
  const nodeEnv = env.NODE_ENV;

  if (typeof opts.clientDist === 'string') {
    const pr = privacyPlaceholderCheck(env, opts.clientDist);
    problems.push(...pr.problems);
    warnings.push(...pr.warnings);
  }
  if (prod && (env[CLIENT_DIST_ENV] ?? '').trim() !== '') {
    warnings.push(`${CLIENT_DIST_ENV}: 운영에서는 무시(SPA 서빙·기동 검사 모두 기본 경로) — 101 MED-3`);
  }

  if (!KNOWN_NODE_ENV.has(nodeEnv ?? '')) {
    warnings.push(`NODE_ENV: ${nodeEnv === undefined || nodeEnv === '' ? '미설정' : '알 수 없는 값'} — 운영(production)으로 취급(fail-closed)`);
  }

  if (prod && (env.DATABASE_URL ?? '').trim() === '') problems.push('DATABASE_URL: 운영에서 필수(예: file:/data/prod.db)');

  try {
    parseTrustProxy(env);
  } catch (e) {
    problems.push(errMsg(e));
  }

  if (prod) {
    for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const v = env[name] ?? '';
      if (v.length < JWT_SECRET_MIN) problems.push(`${name}: ${v === '' ? '누락' : `${JWT_SECRET_MIN}자 미만`} — 운영에서는 ${JWT_SECRET_MIN}자 이상 필수`);
    }
  }

  const { resolveReactionSecret } = await import('../reaction/anon-key.js');
  try {
    resolveReactionSecret(env.REACTION_KEY_SECRET, nodeEnv);
  } catch {
    const v = (env.REACTION_KEY_SECRET ?? '').trim();
    problems.push(`REACTION_KEY_SECRET: ${v === '' ? '누락' : '32자 미만'} — 운영에서는 32자 이상 필수`);
  }

  // PUBLIC_ORIGIN 과 MAIL_TRANSPORT 는 resolveSaveConfig 가 순서대로 throw — 각각 따로 판정해 둘 다 보이게 한다.
  const { resolveSaveConfig } = await import('../save/config.js');
  const MAIL_OK = { MAIL_TRANSPORT: '' };
  const ORIGIN_OK = { PUBLIC_ORIGIN: prod ? 'https://origin-check.invalid' : 'http://localhost:5173' };
  try {
    resolveSaveConfig({ ...env, ...MAIL_OK });
  } catch (e) {
    problems.push(errMsg(e));
  }
  try {
    resolveSaveConfig({ ...env, ...ORIGIN_OK });
  } catch (e) {
    problems.push(errMsg(e));
  }

  // SITE_ORIGIN(빌드 인자 → 이미지 ENV) 과 PUBLIC_ORIGIN(메일 링크) 이 다르면 경고 — 오리진은 시크릿이 아니므로 값 표시.
  const site = (env.SITE_ORIGIN ?? '').trim();
  const pub = (env.PUBLIC_ORIGIN ?? '').trim();
  if (site !== '' && pub !== '' && normOrigin(site) !== normOrigin(pub)) {
    warnings.push(`SITE_ORIGIN(${normOrigin(site)}, 프리렌더 canonical) ≠ PUBLIC_ORIGIN(${normOrigin(pub)}, 메일 링크) — 같은 도메인이어야 해요`);
  }

  return { problems, warnings };
}

export interface EnvCheckIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** 검사 실행 + 출력. 반환 = exit code(0 통과, 1 문제 있음). */
export async function runEnvCheck(env: Env, io: EnvCheckIo, opts: CollectEnvOptions = {}): Promise<number> {
  const { problems, warnings } = await collectEnvProblems(env, opts);
  for (const w of warnings) io.stderr(`[withsmall] env 경고: ${w}`);
  if (problems.length > 0) {
    io.stderr(`[withsmall] env 검사 실패 ${problems.length}건 — 기동 중단(.env.example 표 참조):`);
    for (const p of problems) io.stderr(`  - ${p}`);
    return 1;
  }
  io.stdout(`[withsmall] env ok (NODE_ENV=${env.NODE_ENV ?? '미설정'})`);
  return 0;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const norm = (u: string): string => (process.platform === 'win32' ? u.toLowerCase() : u);
  return norm(pathToFileURL(resolve(entry)).href) === norm(import.meta.url);
}

// top-level await 금지: collectEnvProblems 가 동적 import 하는 save·reaction 모듈이 이 파일을 정적으로 import 한다 —
//   이 모듈 평가가 await 로 멈춰 있으면 그 모듈들이 이 평가 완료를 기다려 교착(컨테이너에서 "unsettled top-level await" 로 확인).
if (isMain()) {
  void runEnvCheck(
    process.env,
    {
      stdout: (l) => process.stdout.write(`${l}\n`),
      stderr: (l) => process.stderr.write(`${l}\n`),
    },
    // 운영 기동 검사(docker-entrypoint 0단계)에서만 처리방침 자리표시를 본다. 경로 = SPA 서빙과 같은 resolveClientDist.
    { clientDist: resolveClientDist(process.env) },
  ).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`[withsmall] env 검사 자체 실패: ${errMsg(e)}\n`);
      process.exitCode = 1;
    },
  );
}
