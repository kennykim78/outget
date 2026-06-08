// 운영자 신고 큐 훅(거버넌스) — 신규 라이브러리 0.
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/reports`)만 호출한다. 외부 절대 URL 0.
//   - ⑤/R3: 본문/응답에 좌표 없음. ②: 자금 흐름 키 없음.
//   - ③: 운영자 복구/삭제는 notice-and-takedown 의 사후 판단(완전 방치 금지).
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../auth/apiFetch';
import type { ReportReason, ReportTargetType } from './useReport';

// 자사 API 상대 경로(절대 URL 금지). 인증 헤더는 apiFetch 가 부착한다.
const REPORTS_PATH = '/api/reports';

/** 운영자가 다루는 신고 항목(미러) — 상태·대상·사유. */
export interface AdminReport {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  status: string;
  createdAt: string;
}

export type AdminReportsStatus = 'loading' | 'error' | 'ready';

export interface UseAdminReportsResult {
  status: AdminReportsStatus;
  data: AdminReport[];
  error: string | null;
  /** 현재 상태 필터(빈 문자열=전체). */
  filter: string;
  setFilter: (status: string) => void;
  reload: () => void;
  /** 복구(POST /api/reports/:id/restore). */
  restore: (id: string) => Promise<void>;
  /** 삭제(POST /api/reports/:id/remove). */
  remove: (id: string) => Promise<void>;
  /** 마지막 액션 오류(복구/삭제). */
  actionError: string | null;
}

export function useAdminReports(): UseAdminReportsResult {
  const [status, setStatus] = useState<AdminReportsStatus>('loading');
  const [data, setData] = useState<AdminReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('블라인드');
  const [actionError, setActionError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    const qs = filter ? `?status=${encodeURIComponent(filter)}` : '';
    apiFetch(`${REPORTS_PATH}${qs}`)
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          throw new Error('운영자만 신고 큐를 볼 수 있어요.');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: unknown) => {
        if (cancelled) return;
        const arr = Array.isArray(json) ? (json as AdminReport[]) : [];
        setData(arr);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setData([]);
        setError(
          e instanceof Error ? e.message : '신고 큐를 불러오지 못했습니다.',
        );
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [filter, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const act = useCallback(
    async (id: string, verb: 'restore' | 'remove') => {
      setActionError(null);
      try {
        const res = await apiFetch(
          `${REPORTS_PATH}/${encodeURIComponent(id)}/${verb}`,
          { method: 'POST' },
        );
        if (res.status === 401 || res.status === 403) {
          throw new Error('운영자만 처리할 수 있어요.');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        reload();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '처리에 실패했습니다.';
        setActionError(msg);
        throw new Error(msg);
      }
    },
    [reload],
  );

  return {
    status,
    data,
    error,
    filter,
    setFilter,
    reload,
    restore: (id) => act(id, 'restore'),
    remove: (id) => act(id, 'remove'),
    actionError,
  };
}
