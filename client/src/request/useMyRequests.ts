// 내 요청 목록 조회 훅 — 신규 라이브러리 0.
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/requests/me`)만 호출한다. 외부 절대 URL 0.
//   - ⑤/R3: 응답 항목에 좌표 필드가 없다(region 텍스트만). 좌표 전송 경로 없음.
import { useEffect, useState } from 'react';
import type { StoredRequest } from './request.types';

// 자사 API 상대 경로(절대 URL 금지).
const MY_REQUESTS_PATH = '/api/requests/me';

export type MyRequestsStatus = 'loading' | 'error' | 'ready';

export interface UseMyRequestsResult {
  status: MyRequestsStatus;
  data: StoredRequest[];
  error: string | null;
  /** 재조회 트리거(채택/확인가 후 갱신용). */
  reload: () => void;
}

export function useMyRequests(): UseMyRequestsResult {
  const [status, setStatus] = useState<MyRequestsStatus>('loading');
  const [data, setData] = useState<StoredRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    fetch(MY_REQUESTS_PATH, { headers: { Accept: 'application/json' } })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: unknown) => {
        if (cancelled) return;
        const arr = Array.isArray(json) ? (json as StoredRequest[]) : [];
        setData(arr);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setData([]);
        setError(
          e instanceof Error ? e.message : '내 요청을 불러오지 못했습니다.',
        );
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return {
    status,
    data,
    error,
    reload: () => setNonce((n) => n + 1),
  };
}
