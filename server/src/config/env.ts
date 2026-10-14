// 공용 실행 환경 판정(SEC-3 L-5·L-6·M-2). 서버의 모든 "운영이면 엄격" 분기는 이 파일을 거친다.
//   isProdLike: NODE_ENV 가 정확히 'development' 또는 'test' 가 아니면 운영으로 본다 — 미설정·오타·staging 도 fail-closed.
//   parseTrustProxy: Express 'trust proxy' 정수 홉 수만(기본 0 = X-Forwarded-For 무시). true 는 XFF 위조 허용이라 거부.
//   assertJwtSecrets: 운영에서 JWT 시크릿 32자 미만이면 기동 실패.
//   collectEnvProblems(R6 A3): 기동 전 누락·무효 env 를 한 번에 모은다(개별 throw 를 목록화 — 규칙 원본은 각 모듈 그대로).
//     직접 실행(`node dist/config/env.js`, docker-entrypoint 의 첫 단계) 시 목록 출력 후 exit 1. 시크릿 값은 출력하지 않는다.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
export async function collectEnvProblems(env: Env = process.env): Promise<EnvReport> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const prod = isProdLike(env);
  const nodeEnv = env.NODE_ENV;

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
export async function runEnvCheck(env: Env, io: EnvCheckIo): Promise<number> {
  const { problems, warnings } = await collectEnvProblems(env);
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
  void runEnvCheck(process.env, {
    stdout: (l) => process.stdout.write(`${l}\n`),
    stderr: (l) => process.stderr.write(`${l}\n`),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`[withsmall] env 검사 자체 실패: ${errMsg(e)}\n`);
      process.exitCode = 1;
    },
  );
}
