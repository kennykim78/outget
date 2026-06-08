// 공동대행 슬롯 목록 페치 훅 — 신규 라이브러리 0.
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/group-slots`)만 호출한다. 외부 절대 URL 0.
//   - ②/R2: 응답은 일정·지역·정원·상태뿐 — 금액·정산 필드 없음.
//   - 모든 호출 apiFetch 경유(자사 /api·Bearer·refresh).
import { useEffect, useState } from 'react';
import { apiFetch } from '../auth/apiFetch';
import type { GroupSlot } from './groupslot.types';

// 자사 API 상대 경로(절대 URL 금지). 인증 헤더는 apiFetch 가 부착한다.
const GROUP_SLOTS_PATH = '/api/group-slots';

export type GroupSlotsStatus = 'loading' | 'error' | 'ready';

export interface UseGroupSlotsResult {
  status: GroupSlotsStatus;
  data: GroupSlot[];
  error: string | null;
  /** 재조회 트리거(개설/참여 후 갱신). */
  reload: () => void;
}

/** 공동대행 슬롯 목록(GET /api/group-slots)을 자사 상대경로에서 불러온다. */
export function useGroupSlots(): UseGroupSlotsResult {
  const [status, setStatus] = useState<GroupSlotsStatus>('loading');
  const [data, setData] = useState<GroupSlot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    apiFetch(GROUP_SLOTS_PATH)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: unknown) => {
        if (cancelled) return;
        setData(Array.isArray(json) ? (json as GroupSlot[]) : []);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setData([]);
        setError(
          e instanceof Error ? e.message : '공동대행 슬롯을 불러오지 못했습니다.',
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
