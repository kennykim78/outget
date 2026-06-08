// 토큰 저장 캡슐화 — 신규 라이브러리 0.
// 정책:
//   - access 토큰은 **메모리(모듈 변수)** 에만 둔다. localStorage/sessionStorage 등
//     영속 저장소에 절대 기록하지 않는다(XSS 탈취면 적용 최소화 + 새로고침 시 refresh 로 복구).
//   - refresh 토큰만 localStorage(키 'outget.refresh') 에 둔다. 새로고침 후 세션 복구용.
//   - 토큰 리터럴 하드코딩 0 — 런타임 값만 저장한다.
//   - 후속 httpOnly 쿠키 전환 시 이 파일만 교체하면 된다(호출부는 이 인터페이스만 의존).

// access 는 모듈 메모리에만 보관(영속 저장 금지).
let accessToken: string | null = null;

// refresh 영속 저장소 키.
const REFRESH_KEY = 'outget.refresh';

/** 현재 access 토큰(메모리). 없으면 null. */
export function getAccessToken(): string | null {
  return accessToken;
}

/** access 토큰 설정/해제(메모리만). null 이면 해제. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** refresh 토큰(localStorage) 조회. 없으면 null. */
export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

/** refresh 토큰 설정/해제. null 이면 제거. */
export function setRefreshToken(token: string | null): void {
  try {
    if (token === null) {
      localStorage.removeItem(REFRESH_KEY);
    } else {
      localStorage.setItem(REFRESH_KEY, token);
    }
  } catch {
    // 저장소 접근 불가(프라이빗 모드 등) — 조용히 무시(메모리 access 로만 동작).
  }
}

/** access(메모리) + refresh(localStorage) 모두 제거. 로그아웃/인증 실패 시. */
export function clearTokens(): void {
  accessToken = null;
  setRefreshToken(null);
}
