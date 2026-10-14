// 매직링크 복귀(/save#t=<token> — 계약 C-R5-2 · 스펙33 §7 · D1).
//   토큰은 URL 프래그먼트에만 온다. 읽는 즉시 history.replaceState 로 URL·히스토리에서 지운다 — 어떤 네트워크 요청보다 먼저.
//   토큰은 이 모듈의 메모리에만 머문다(localStorage·history.state·이벤트·로그 0, 불변식 ⑧ / K4).
//   부팅 경로(app/boot)가 가장 먼저 captureMagicToken() 을 부르면 지연 청크 요청 전에도 지워진다. L8 도 마운트 때 다시 부른다(멱등).

/** 서버 발급 형식 = base64url 32B(43자). 다르면 verify 를 보내지 않는다(만료 화면). */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const HASH_TOKEN_RE = /(?:^#|&)t=([^&]*)/;

export type CapturedToken = { token: string } | { invalid: true };

let pending: CapturedToken | null = null;
/** 새 토큰을 붙잡았을 때 알림(같은 탭 해시 이동 — 이미 열린 L8 이 연결 화면으로 전환). 값은 넘기지 않는다(captureMagicToken 으로 읽음). */
const listeners = new Set<() => void>();

/** /save 프래그먼트에 t= 가 있는지(같은 탭 해시 이동 감지용). 토큰 값은 보지 않는다. */
export function hasMagicHash(loc: Pick<Location, 'pathname' | 'hash'> = window.location): boolean {
  return (loc.pathname === '/save' || loc.pathname === '/save/') && HASH_TOKEN_RE.test(loc.hash ?? '');
}

/** 새로 붙잡은 토큰 구독(L8). 반환 = 해제. */
export function subscribeMagicToken(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

type Loc = Pick<Location, 'pathname' | 'search' | 'hash'>;
type Hist = Pick<History, 'replaceState' | 'state'>;

/**
 * 프래그먼트에 t= 가 있으면 즉시 지우고(replaceState, state 보존) 메모리에 붙잡는다. 이미 붙잡은 것이 있으면 그것을 돌려준다.
 * /save 가 아닌 경로에서도 t= 프래그먼트는 지운다(방어). 붙잡는 것은 /save 만.
 */
export function captureMagicToken(loc: Loc = window.location, hist: Hist = window.history): CapturedToken | null {
  const m = HASH_TOKEN_RE.exec(loc.hash ?? '');
  if (m) {
    const raw = m[1] ?? '';
    hist.replaceState(hist.state, '', `${loc.pathname}${loc.search}`);
    if (loc.pathname === '/save' || loc.pathname === '/save/') {
      pending = TOKEN_RE.test(raw) ? { token: raw } : { invalid: true };
      for (const l of listeners) l();
    }
  }
  return pending;
}

/** 처리가 끝난 토큰을 잊는다(다시 연 L8 이 재검증하지 않게). */
export function clearMagicToken(): void {
  pending = null;
}
