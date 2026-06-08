// 인증 API 클라이언트 — 신규 라이브러리 0(raw fetch).
// 불변식:
//   - ①/R1: 자사 상대경로(`/auth/...`·`/auth/me`)만 호출한다. 외부 절대 URL 0.
//   - 여기서는 apiFetch 를 쓰지 않는다(apiFetch 의 refresh 가 이 모듈을 부르므로 순환 회피).
//   - 토큰 리터럴 하드코딩 0 — 인자/응답 값만 다룬다.
//   - 좌표·결제·정산 필드 없음(인증 본문은 자격증명·역할뿐).

// 서버 역할 5종(미러). 서버 권위 — 클라는 표시·게이팅에만 사용.
export type Role =
  | '구매자'
  | '개인대행자'
  | '전문대행자'
  | '소식알림자'
  | '운영자';

// 자사 인증 상대 경로(절대 URL 금지).
const LOGIN_PATH = '/auth/login';
const REGISTER_PATH = '/auth/register';
const REFRESH_PATH = '/auth/refresh';
const ME_PATH = '/auth/me';

const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

/** 로그인/회원가입 응답 — 토큰 + 역할. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  role: Role;
}

/** refresh 응답 — 새 access 토큰만. */
export interface RefreshResult {
  accessToken: string;
}

/** /auth/me 응답 — 사용자 식별자 + 역할. */
export interface AuthMe {
  sub: string;
  role: Role;
}

// HTTP 상태를 보존하는 에러 — 호출부(LoginView)가 401/409/400 을 매핑한다.
export class AuthError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'AuthError';
    this.status = status;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new AuthError(res.status);
  return (await res.json()) as T;
}

/** 로그인(POST /auth/login). 자격증명만 — 좌표·결제 없음. */
export function login(email: string, password: string): Promise<AuthTokens> {
  return postJson<AuthTokens>(LOGIN_PATH, { email, password });
}

/** 회원가입(POST /auth/register). 자격증명 + 역할. */
export function register(
  email: string,
  password: string,
  role: Role,
): Promise<AuthTokens> {
  return postJson<AuthTokens>(REGISTER_PATH, { email, password, role });
}

/** access 재발급(POST /auth/refresh). refresh 토큰 → 새 access. */
export function refresh(refreshToken: string): Promise<RefreshResult> {
  return postJson<RefreshResult>(REFRESH_PATH, { refreshToken });
}

/** 현재 사용자 조회(GET /auth/me). 인자 access 로 Bearer 부착. */
export async function me(accessToken: string): Promise<AuthMe> {
  const res = await fetch(ME_PATH, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) throw new AuthError(res.status);
  return (await res.json()) as AuthMe;
}
