// 역경매 요청 액션 훅 — 신규 라이브러리 0(React Query 등 금지).
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/requests` 및 그 하위)만 호출한다.
//     외부 절대 URL(http(s)://...)은 절대 구성/호출하지 않는다.
//   - ⑤/R3: 어떤 요청 본문에도 위치 좌표를 싣지 않는다(폼 DTO 에 좌표 필드 자체가 없음).
//   - ②: create/adopt/verified-price/reject 본문에 결제·정산·예치 흐름 키가 없다.
//     hopePrice·확인 금액은 표시값일 뿐(자금 보유 아님).
//   - ④: 확인가 제시 본문은 금액·메모만. 책임 주체(agentId)·시각은 서버가 부여한다.
import { useState } from 'react';
import type { RequestInput, StoredRequest } from './request.types';

// 자사 API 상대 경로(절대 URL 금지).
const REQUESTS_PATH = '/api/requests';

const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

/** 확인가 제시 입력 — 금액·메모만(책임 주체·시각은 서버 부여, 좌표 0). */
export interface VerifiedPriceInput {
  price: number;
  note?: string;
}

export interface UseRequestActionsResult {
  busy: boolean;
  error: string | null;
  /** 구매자: 새 요청 등록(POST /api/requests). 본문은 폼 DTO 뿐 — 좌표 0. */
  create: (input: RequestInput) => Promise<StoredRequest>;
  /** 대행자: 요청 채택(POST /api/requests/:id/adopt). 본문 없음. */
  adopt: (requestId: string) => Promise<StoredRequest>;
  /** 대행자: 확인가 제시(POST /api/requests/:id/verified-price). 금액·메모만. */
  setVerifiedPrice: (
    requestId: string,
    input: VerifiedPriceInput,
  ) => Promise<StoredRequest>;
  /** 대행자: 요청 거절(POST /api/requests/:id/reject). 본문 없음. */
  reject: (requestId: string) => Promise<StoredRequest>;
}

export function useRequestActions(): UseRequestActionsResult {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 공통 POST 헬퍼 — 자사 상대경로만 받는다(절대 URL 호출 경로 없음).
  const post = async (
    path: string,
    body?: unknown,
  ): Promise<StoredRequest> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as StoredRequest;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '요청 처리에 실패했습니다.';
      setError(msg);
      throw new Error(msg);
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    error,
    create: (input) => post(REQUESTS_PATH, input),
    adopt: (requestId) =>
      post(`${REQUESTS_PATH}/${encodeURIComponent(requestId)}/adopt`),
    setVerifiedPrice: (requestId, input) =>
      post(
        `${REQUESTS_PATH}/${encodeURIComponent(requestId)}/verified-price`,
        input,
      ),
    reject: (requestId) =>
      post(`${REQUESTS_PATH}/${encodeURIComponent(requestId)}/reject`),
  };
}
