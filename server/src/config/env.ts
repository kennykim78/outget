// 공용 실행 환경 판정(SEC-3 L-5·L-6·M-2). 서버의 모든 "운영이면 엄격" 분기는 이 파일을 거친다.
//   isProdLike: NODE_ENV 가 정확히 'development' 또는 'test' 가 아니면 운영으로 본다 — 미설정·오타·staging 도 fail-closed.
//   parseTrustProxy: Express 'trust proxy' 정수 홉 수만(기본 0 = X-Forwarded-For 무시). true 는 XFF 위조 허용이라 거부.
//   assertJwtSecrets: 운영에서 JWT 시크릿 32자 미만이면 기동 실패.

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
    throw new Error(`TRUST_PROXY: 0 이상 정수 홉 수만 허용(true·CIDR·이름 금지): ${raw}`);
  }
  const n = Number(raw);
  if (n > TRUST_PROXY_MAX) throw new Error(`TRUST_PROXY: ${TRUST_PROXY_MAX} 이하만 허용: ${raw}`);
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
