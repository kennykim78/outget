// 메시지 입력(S5 하단) — 본문 텍스트만. 결제·금액 입력란 0(②).
// 길이상한 2000(서버 미러). 전송 후 입력 비움.
import { useState } from 'react';
import { MESSAGE_MAX_LENGTH } from './useMessages';
import './chat.css';

interface MessageComposerProps {
  /** 전송 핸들러(useMessages.send). 본문 텍스트만 전달한다. */
  onSend: (body: string) => Promise<void>;
  disabled?: boolean;
}

export default function MessageComposer({ onSend, disabled }: MessageComposerProps) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const canSend = body.trim().length > 0 && !sending && !disabled;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(body);
      setBody('');
    } catch {
      // 에러 표시는 상위(useMessages.error)에서. 입력은 보존.
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSend();
      }}
    >
      {/* 본문 텍스트 입력만 — 결제·금액 입력란 없음(②). */}
      <textarea
        className="chat-composer__input"
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MESSAGE_MAX_LENGTH))}
        maxLength={MESSAGE_MAX_LENGTH}
        rows={1}
        placeholder="메시지 입력"
        aria-label="메시지 입력"
        disabled={disabled || sending}
      />
      <button
        type="submit"
        className="agent-form__btn agent-form__btn--primary chat-composer__send"
        disabled={!canSend}
      >
        {sending ? '전송 중…' : '전송'}
      </button>
    </form>
  );
}
