// 신고 플로우(S9): 트리거 버튼 → 사유 선택(허위/불펌/사기/기타) → 제출 →
// "즉시 블라인드됨 · 이의 신청 가능" 안내. 인라인 패널(라우터 0).
// 불변식:
//   - ①/R1: 제출은 useReport 의 자사 상대경로 호출만. 외부 URL 0.
//   - ③: notice-and-takedown 진입점 — 제출 즉시 블라인드 처리되며 작성자는 이의 신청 가능.
import { useState } from 'react';
import { useReport } from './useReport';
import type { ReportReason, ReportTargetType } from './useReport';
import './governance.css';

interface ReportFlowProps {
  targetType: ReportTargetType;
  targetId: string;
  /** 트리거 버튼 라벨(기본: 신고). */
  triggerLabel?: string;
}

// 사유 옵션 — 표시 카피 ↔ 서버 값 매핑.
const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: '허위정보', label: '허위 정보', hint: '사실과 다른 가격·소식' },
  {
    value: '불펌',
    label: '불펌(무단 도용)',
    hint: '다른 곳의 글·사진을 가져옴',
  },
  { value: '사기', label: '사기 의심', hint: '선입금 유도 등 사기 정황' },
  { value: '기타', label: '기타', hint: '그 밖의 문제' },
];

type Phase = 'idle' | 'picking' | 'done';

export default function ReportFlow({
  targetType,
  targetId,
  triggerLabel = '신고',
}: ReportFlowProps) {
  const { busy, error, report } = useReport();
  const [phase, setPhase] = useState<Phase>('idle');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async () => {
    setLocalError(null);
    if (!reason) {
      setLocalError('신고 사유를 선택해 주세요.');
      return;
    }
    try {
      await report({ targetType, targetId, reason });
      setPhase('done');
    } catch (err: unknown) {
      setLocalError(
        err instanceof Error ? err.message : '신고 접수에 실패했습니다.',
      );
    }
  };

  if (phase === 'idle') {
    return (
      <button
        type="button"
        className="report-flow__trigger"
        onClick={() => setPhase('picking')}
        aria-label="신고하기"
      >
        🚩 {triggerLabel}
      </button>
    );
  }

  if (phase === 'done') {
    return (
      <div className="report-flow__done" role="status">
        <p className="report-flow__done-title">신고가 접수되었습니다.</p>
        <p className="report-flow__done-body">
          해당 게시물은 검토를 위해 즉시 가려집니다(블라인드). 작성자는 이의를
          신청할 수 있으며, 운영자가 복구 또는 삭제를 결정합니다.
        </p>
      </div>
    );
  }

  // picking
  return (
    <div className="report-flow" role="group" aria-label="신고 사유 선택">
      <p className="report-flow__heading">어떤 문제가 있나요?</p>
      <ul className="report-flow__reasons">
        {REASONS.map((r) => (
          <li key={r.value}>
            <label
              className={
                'report-flow__reason' +
                (reason === r.value ? ' report-flow__reason--active' : '')
              }
            >
              <input
                type="radio"
                name={`report-reason-${targetId}`}
                value={r.value}
                checked={reason === r.value}
                onChange={() => {
                  setReason(r.value);
                  setLocalError(null);
                }}
              />
              <span className="report-flow__reason-label">{r.label}</span>
              <span className="report-flow__reason-hint">{r.hint}</span>
            </label>
          </li>
        ))}
      </ul>

      <p className="report-flow__notice" role="note">
        신고하면 해당 게시물은 검토 동안 즉시 가려집니다(블라인드). 작성자는
        이의를 신청할 수 있습니다.
      </p>

      {(localError || error) && (
        <p className="report-flow__error" role="alert">
          {localError ?? error}
        </p>
      )}

      <div className="report-flow__actions">
        <button
          type="button"
          className="report-flow__btn report-flow__btn--ghost"
          onClick={() => {
            setPhase('idle');
            setReason(null);
            setLocalError(null);
          }}
        >
          취소
        </button>
        <button
          type="button"
          className="report-flow__btn report-flow__btn--primary"
          onClick={submit}
          disabled={busy}
        >
          {busy ? '제출 중…' : '신고 제출'}
        </button>
      </div>
    </div>
  );
}
