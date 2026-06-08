// 보호 API 호출 래퍼 — 신규 라이브러리 0.
// 책임:
//   ① 외부 URL 강제 차단: path 가 `http(s)://` 또는 `//` 로 시작하면 throw(외부 절대 URL 0).
//   ② access 토큰이 있으면 Authorization: Bearer 자동 부착 + JSON 헤더 병합.
//   ③ 401 & 미재시도면 single-flight refresh 1회 → 새 access 저장 → 원요청 1회만 재시도.
//      2차 401 또는 refresh 실패 → clearTokens() + onAuthFailure(logout). 요청당 재시도
//      플래그로 무한루프 차단.
// 불변식: 자사 상대경로(/api·/auth)만. 토큰 하드코딩 0. 좌표·결제 무관(래퍼는 본문 불간섭).
import * as authApi from './authApi';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
} from './tokenStorage';

// 인증 최종 실패 시 호출되는 콜백(AuthProvider 가 logout 으로 배선).
let onAuthFailure: (() => void) | null = null;

/** 인증 최종 실패(refresh 실패/2차 401) 콜백 등록. Provider 가 1회 배선. */
export function setOnAuthFailure(cb: (() => void) | null): void {
  onAuthFailure = cb;
}

// 모듈 single-flight refresh promise — 동시 다발 401 이 refresh 를 1번만 태우게 한다.
let refreshing: Promise<string | null> | null = null;

/**
 * single-flight 로 access 를 재발급한다. 성공 시 새 access 를 저장하고 반환,
 * 실패(refresh 없음/거부) 시 null 반환. 동시 호출은 같은 promise 를 공유한다.
 */
function refreshAccess(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async (): Promise<string | null> => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    try {
      const { accessToken } = await authApi.refresh(refreshToken);
      setAccessToken(accessToken);
      return accessToken;
    } catch {
      return null;
    }
  })();
  // 완료되면 다음 401 이 새 refresh 를 태울 수 있게 잠금 해제.
  refreshing.finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// 외부 절대 URL 가드 — http(s):// 또는 //(protocol-relative) 로 시작하면 거부.
function assertRelative(path: string): void {
  if (/^https?:\/\//i.test(path) || path.startsWith('//')) {
    throw new Error(`apiFetch: 외부 절대 URL 은 허용되지 않습니다: ${path}`);
  }
}

// JSON 기본 헤더 + 호출자 헤더 + (있으면) Bearer 병합.
function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  // 본문이 있고 Content-Type 미지정이면 JSON 으로 둔다(FormData 등은 호출자가 명시).
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const access = getAccessToken();
  if (access && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${access}`);
  }
  return headers;
}

/**
 * 보호 API 호출. 자사 상대경로만 받는다(외부 URL throw).
 * 401 시 single-flight refresh 1회 후 원요청을 1회만 재시도한다.
 */
export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  assertRelative(path);

  const doFetch = (): Promise<Response> =>
    fetch(path, { ...init, headers: buildHeaders(init) });

  let res = await doFetch();
  if (res.status !== 401) return res;

  // 401 → refresh 1회 시도(single-flight). 성공 시 원요청 1회만 재시도.
  const newAccess = await refreshAccess();
  if (!newAccess) {
    // refresh 없음/실패 → 세션 종료.
    clearTokens();
    onAuthFailure?.();
    return res; // 원래 401 응답 그대로 반환(호출부가 상태 매핑 가능).
  }

  res = await doFetch(); // 재시도 1회뿐(루프 없음).
  if (res.status === 401) {
    // 2차 401 → refresh 했는데도 거부 → 세션 종료.
    clearTokens();
    onAuthFailure?.();
  }
  return res;
}
