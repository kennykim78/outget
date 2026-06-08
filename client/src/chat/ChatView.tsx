// 매칭 채팅 화면(S5) 조립.
//   상단: IntermediaryNotice(재사용) 상시 + 신고 버튼 상시
//   본문: MessageList + MessageComposer (폴링 ~4s, 자사 /api 만)
//   하단: PaymentChoice(직접/안전결제) + SafePaymentGuidance(안전결제 안내)
// 불변식: 자사 상대경로만(외부 절대 URL 0). 메시지 본문 텍스트만(결제 입력 0).
//   XSS=React 보간. IntermediaryNotice 상시(③). 결제 자금 코드 0(②). 링크 보증 UI 0(R4).
import { useMessages } from './useMessages';
import { useDealMethod } from './useDealMethod';
import MessageList from './MessageList';
import MessageComposer from './MessageComposer';
import PaymentChoice from './PaymentChoice';
import SafePaymentGuidance from './SafePaymentGuidance';
import ReportButton from './ReportButton';
import IntermediaryNotice from '../board/cards/IntermediaryNotice';
import './chat.css';

interface ChatViewProps {
  /** 매칭 식별자(POST /api/matches 응답 id). 라우팅 키. */
  matchId: string;
  /** 채팅 스레드 식별자(응답 chatThreadId). 신고 대상 식별 등. */
  chatThreadId?: string;
  /** 내 식별자(자/타 메시지 구분용, 선택). */
  myUserId?: string;
  /** 보드로 돌아가기. */
  onBack: () => void;
}

export default function ChatView({
  matchId,
  chatThreadId,
  myUserId,
  onBack,
}: ChatViewProps) {
  const messages = useMessages(matchId);
  const deal = useDealMethod(matchId);

  return (
    <div className="chat-view">
      <header className="chat-view__head">
        <button
          type="button"
          className="chat-view__back"
          onClick={onBack}
          aria-label="뒤로"
        >
          ←
        </button>
        <span className="chat-view__title">대행 ⟷ 나</span>
        {/* 신고 버튼 상시(거버넌스, Epic7 연결 예정). */}
        <ReportButton targetId={chatThreadId ?? matchId} />
      </header>

      {/* ③ 통신판매중개 고지 상시. */}
      <IntermediaryNotice />

      <div className="chat-view__body">
        {messages.status === 'loading' && (
          <p className="chat-view__status" role="status">불러오는 중…</p>
        )}
        {messages.status === 'error' && (
          <div className="chat-view__status" role="alert">
            <p>{messages.error ?? '메시지를 불러오지 못했습니다.'}</p>
            <button type="button" onClick={messages.reload}>다시 시도</button>
          </div>
        )}
        {messages.status === 'ready' && (
          <MessageList messages={messages.data} myUserId={myUserId} />
        )}
      </div>

      <MessageComposer
        onSend={messages.send}
        disabled={messages.status === 'error'}
      />
      {messages.error && messages.status === 'ready' && (
        <p className="chat-view__send-error" role="alert">
          {messages.error}
        </p>
      )}

      <div className="chat-view__deal">
        <PaymentChoice
          selected={deal.selected}
          busy={deal.busy}
          onChoose={(m) => void deal.choose(m)}
        />
        {/* 안전결제 선택 시 안내 텍스트(링크 보증 UI 없음). */}
        <SafePaymentGuidance guidance={deal.guidance} />
        {deal.error && (
          <p className="chat-view__send-error" role="alert">
            {deal.error}
          </p>
        )}
      </div>
    </div>
  );
}
