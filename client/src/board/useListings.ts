// 경량 데이터 페치 훅 — 신규 라이브러리 0(React Query 등 금지).
// 불변식 ①(무크롤링)/R1:
//   - 자사 상대경로 `/api/agents|requests|discounts` 만 호출한다.
//   - 외부 절대 URL(http(s)://...) 은 절대 구성/호출하지 않는다.
//   - region 쿼리만 서버 필터로 전달(좌표 아님 — 지역 문자열).
//   - 좌표(lat/lng)는 어떤 요청에도 싣지 않는다(R3/⑤).
import { useEffect, useState } from 'react';
import type {
  AgentProfile,
  DiscountPost,
  LayerKind,
  RequestItem,
} from './board.types';

// 레이어별 응답 항목 타입 매핑.
interface LayerItemMap {
  agents: AgentProfile;
  requests: RequestItem;
  discounts: DiscountPost;
}

// 자사 API 상대 경로(절대 URL 금지). 레이어→엔드포인트.
const ENDPOINT: Record<LayerKind, string> = {
  agents: '/api/agents',
  requests: '/api/requests',
  discounts: '/api/discounts',
};

export type ListingsStatus = 'loading' | 'error' | 'ready';

export interface UseListingsResult<L extends LayerKind> {
  status: ListingsStatus;
  data: LayerItemMap[L][];
  error: string | null;
  /** 재시도 트리거. */
  reload: () => void;
}

/**
 * 한 레이어의 목록을 자사 /api 상대경로에서 불러온다.
 * @param layer 레이어 종류.
 * @param region 서버측 지역 필터(문자열, 좌표 아님). 비우면 전체.
 */
export function useListings<L extends LayerKind>(
  layer: L,
  region?: string,
): UseListingsResult<L> {
  const [status, setStatus] = useState<ListingsStatus>('loading');
  const [data, setData] = useState<LayerItemMap[L][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    // 상대경로 + region 쿼리만. URL 은 자사 경로로만 구성된다.
    const path = ENDPOINT[layer];
    const qs =
      region && region.trim().length > 0
        ? `?region=${encodeURIComponent(region.trim())}`
        : '';

    fetch(path + qs, { headers: { Accept: 'application/json' } })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: unknown) => {
        if (cancelled) return;
        const arr = Array.isArray(json) ? (json as LayerItemMap[L][]) : [];
        setData(arr);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setData([]);
        setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [layer, region, nonce]);

  return {
    status,
    data,
    error,
    reload: () => setNonce((n) => n + 1),
  };
}
