// 신고 버튼(거버넌스) — 채팅 메시지/스레드 신고. 자사 /api/reports 로 실제 POST(①).
// 신고 시 서버가 즉시 블라인드 처리(notice-and-takedown)하며 작성자는 이의 신청 가능.
// 미인증(401)은 "로그인 후 신고" 안내로 매핑한다.
import { useState } from 'react';
import { useReport } from '../governance/useReport';
import './chat.css';

interface ReportButtonProps {
  /** 신고 대상 식별자(메시지/스레드 식별자). */
  targetId?: string;
}

export default function ReportButton({ targetId }: ReportButtonProps) {
  const { busy, report } = useReport();
  const [toast, setToast] = useState<string | null>(null);

  const handleReport = () => {
    if (!targetId) {
      setToast('신고할 대상을 찾지 못했습니다.');
      window.setTimeout(() => setToast(null), 2400);
      return;
    }
    report({ targetType: 'message', targetId, reason: '기타' })
      .then(() => {
        setToast('신고가 접수되어 즉시 가려집니다(블라인드). 이의 신청 가능.');
      })
      .catch((e: unknown) => {
        setToast(
          e instanceof Error ? e.message : '신고 접수에 실패했습니다.',
        );
      })
      .finally(() => {
        window.setTimeout(() => setToast(null), 2800);
      });
  };

  return (
    <div className="chat-report">
      <button
        type="button"
        className="chat-report__btn"
        onClick={handleReport}
        disabled={busy}
        aria-label="신고"
      >
        🚩 신고
      </button>
      {toast && (
        <p className="chat-report__toast" role="status">
          {toast}
        </p>
      )}
    </div>
  );
}
