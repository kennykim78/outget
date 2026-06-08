// 신고 액션 훅(거버넌스 S9) — 신규 라이브러리 0(라우터 금지).
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/reports` 및 그 하위)만 호출한다. 외부 절대 URL 0.
//   - ⑤/R3: 본문에 좌표 없음(대상 식별자·사유만).
//   - ③: 신고는 notice-and-takedown 진입점 — 신고 시 서버가 즉시 블라인드 처리한다.
import { useState } from 'react';

// 자사 API 상대 경로(절대 URL 금지).
const REPORTS_PATH = '/api/reports';

const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

/** 신고 대상 종류 — 서버 Report.targetType 미러. */
export type ReportTargetType = 'discount' | 'message' | 'profile' | 'request';

/** 신고 사유(미러). 표시 카피는 ReportFlow 가 매핑한다. */
export type ReportReason = '허위정보' | '불펌' | '사기' | '기타';

/** 신고 입력 — 대상 식별자·종류·사유만(좌표 0, 자금 0). */
export interface ReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
}

/** 신고 응답(미러) — 상태·식별자(이의 신청용). */
export interface ReportResult {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  status: string;
  createdAt: string;
}

export interface UseReportResult {
  busy: boolean;
  error: string | null;
  /** 신고 제출(POST /api/reports). 401 은 로그인 안내로 매핑. */
  report: (input: ReportInput) => Promise<ReportResult>;
}

export function useReport(): UseReportResult {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const report = async (input: ReportInput): Promise<ReportResult> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(REPORTS_PATH, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(input),
      });
      if (res.status === 401) {
        throw new Error('로그인 후 신고할 수 있어요.');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ReportResult;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '신고 접수에 실패했습니다.';
      setError(msg);
      throw new Error(msg);
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, report };
}
