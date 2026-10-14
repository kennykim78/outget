// 저장 API(계약 C-R5-2) — 동일 출처 상대 경로만(외부 호스트 0, 불변식 ①). 세션은 HttpOnly 쿠키(ws_sid) — JS 는 읽지 않는다.
//   이메일은 POST /auth/magic/request 본문에만 실린다(저장·history·이벤트 0). 토큰은 verify 본문에만.
//   status 0 = 네트워크 오류. 응답 본문은 쓰는 곳만 읽는다.
import type { SaveGetResponse, SavePutRequest, SavePutResult, SaveV1 } from './contract';

export type MagicEntry = 'home' | 'checklist' | 'direct';

export interface SaveApi {
  requestMagic(email: string, entry: MagicEntry): Promise<{ status: number }>;
  /** maskedEmail(SEC-3 M-1): 서버가 준 마스킹 주소 — 화면 표시 전용, 저장 0. 없으면 undefined. */
  verify(token: string): Promise<{ status: number; maskedEmail?: string }>;
  session(): Promise<{ status: number; linked: boolean; maskedEmail?: string }>;
  logout(): Promise<{ status: number }>;
  getSave(): Promise<{ status: number; body: SaveGetResponse | null }>;
  /** H1: baseUpdatedAt = 마지막으로 본 서버 행 시각(행 없음 null). 409 면 current = 지금 서버본. */
  putSave(snapshot: SaveV1, baseUpdatedAt: string | null): Promise<SavePutResult>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function call(path: string, init: RequestInit): Promise<Response | null> {
  if (typeof fetch !== 'function') return null;
  try {
    return await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    return null;
  }
}

async function jsonOf(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);

/** 표시용 마스킹 주소만 받는다(문자열·길이·공백 없음). */
function maskedOf(body: unknown): string | undefined {
  if (!isObj(body)) return undefined;
  const m = body.maskedEmail;
  return typeof m === 'string' && m.length > 0 && m.length <= 254 && !/\s/.test(m) ? m : undefined;
}

export const fetchSaveApi: SaveApi = {
  async requestMagic(email, entry) {
    const res = await call('/auth/magic/request', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ email, entry }) });
    return { status: res?.status ?? 0 };
  },
  async verify(token) {
    const res = await call('/auth/magic/verify', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ token }) });
    if (!res) return { status: 0 };
    const maskedEmail = res.ok ? maskedOf(await jsonOf(res)) : undefined;
    return maskedEmail ? { status: res.status, maskedEmail } : { status: res.status };
  },
  async session() {
    const res = await call('/auth/session', { method: 'GET' });
    if (!res) return { status: 0, linked: false };
    const body = res.ok ? await jsonOf(res) : null;
    const linked = isObj(body) && body.linked === true;
    const maskedEmail = linked ? maskedOf(body) : undefined;
    return maskedEmail ? { status: res.status, linked, maskedEmail } : { status: res.status, linked };
  },
  async logout() {
    const res = await call('/auth/session', { method: 'DELETE' });
    return { status: res?.status ?? 0 };
  },
  async getSave() {
    const res = await call('/api/save', { method: 'GET' });
    if (!res) return { status: 0, body: null };
    if (!res.ok) return { status: res.status, body: null };
    const body = snapshotOf(await jsonOf(res));
    return { status: res.status, body };
  },
  async putSave(snapshot, baseUpdatedAt) {
    const req: SavePutRequest = { snapshot, baseUpdatedAt };
    const res = await call('/api/save', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(req) });
    if (!res) return { status: 0 };
    if (res.ok) {
      const body = await jsonOf(res);
      return isObj(body) && typeof body.updatedAt === 'string' ? { status: res.status, updatedAt: body.updatedAt } : { status: res.status };
    }
    if (res.status === 409) {
      const current = snapshotOf(await jsonOf(res));
      return current ? { status: 409, current } : { status: 409 };
    }
    return { status: res.status };
  },
};

/** {snapshot, updatedAt} 본문(GET 200 · PUT 409). 모양이 아니면 null. */
function snapshotOf(body: unknown): SaveGetResponse | null {
  if (!isObj(body)) return null;
  const snapshot = isObj(body.snapshot) ? (body.snapshot as unknown as SaveV1) : null;
  const updatedAt = typeof body.updatedAt === 'string' ? body.updatedAt : null;
  return { snapshot, updatedAt };
}
