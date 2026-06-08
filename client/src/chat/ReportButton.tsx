// 신고 버튼(거버넌스) — 상시 노출. 동작은 토스트 스텁이며 Epic7 에서 블라인드
// 플로우(S9)에 연결 예정. 여기서는 어떤 외부 호출도 하지 않는다(①).
import { useState } from 'react';
import './chat.css';

interface ReportButtonProps {
  /** 신고 대상 식별자(스레드/메시지 등). Epic7 연결 시 사용. */
  targetId?: string;
}

export default function ReportButton({ targetId }: ReportButtonProps) {
  const [toast, setToast] = useState<string | null>(null);

  const handleReport = () => {
    // Epic7 연결 전까지 스텁 — 외부 호출 없음. targetId 는 추후 사용.
    void targetId;
    setToast('신고가 접수되었습니다. (검토·블라인드 연결 예정)');
    window.setTimeout(() => setToast(null), 2400);
  };

  return (
    <div className="chat-report">
      <button
        type="button"
        className="chat-report__btn"
        onClick={handleReport}
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
