// 바운티 목록 페치 훅 — 신규 라이브러리 0(React Query 등 금지).
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/bounties`)만 호출한다. 외부 절대 URL 0.
//   - ②/R2: 응답은 미션·상태뿐 — 금액·정산 필드를 다루지 않는다.
//   - 모든 호출은 apiFetch 경유(자사 /api·Bearer·refresh).
import { useEffect, useState } from 'react';
import { apiFetch } from '../auth/apiFetch';
import type { Bounty } from './bounty.types';

// 자사 API 상대 경로(절대 URL 금지). 인증 헤더는 apiFetch 가 부착한다.
const BOUNTIES_PATH = '/api/bounties';

export type BountiesStatus = 'loading' | 'error' | 'ready';

export interface UseBountiesResult {
  status: BountiesStatus;
  data: Bounty[];
  error: string | null;
  /** 재조회 트리거(제출/작성 후 갱신). */
  reload: () => void;
}

/** 바운티 목록(GET /api/bounties)을 자사 상대경로에서 불러온다. */
export function useBounties(): UseBountiesResult {
  const [status, setStatus] = useState<BountiesStatus>('loading');
  const [data, setData] = useState<Bounty[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    apiFetch(BOUNTIES_PATH)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: unknown) => {
        if (cancelled) return;
        setData(Array.isArray(json) ? (json as Bounty[]) : []);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setData([]);
        setError(e instanceof Error ? e.message : '바운티를 불러오지 못했습니다.');
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
