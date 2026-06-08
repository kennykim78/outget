// 메시지 목록 렌더(S5 본문) — XSS 방어: React 텍스트 보간만 사용한다.
// dangerouslySetInnerHTML 은 절대 쓰지 않는다(사용자 본문은 텍스트 노드로만 출력).
// 자/타 메시지 구분은 myUserId 와 senderId 비교 — 색 단독 의존 금지(정렬+라벨 병행).
import type { StoredMessage } from './chat.types';
import './chat.css';

interface MessageListProps {
  messages: StoredMessage[];
  /** 내 식별자(있으면 정렬·라벨로 자/타 구분). 없으면 모두 상대 정렬. */
  myUserId?: string;
}

// 시각 표시(로컬 HH:MM) — 본문이 아니라 메타데이터.
function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageList({ messages, myUserId }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="chat-msgs chat-msgs--empty">
        <p className="chat-msgs__empty">
          아직 메시지가 없어요. 첫 메시지를 보내 매칭을 시작하세요.
        </p>
      </div>
    );
  }

  return (
    <ol className="chat-msgs" aria-label="대화 내용">
      {messages.map((m) => {
        const mine = myUserId !== undefined && m.senderId === myUserId;
        return (
          <li
            key={m.id}
            className={
              'chat-msg' + (mine ? ' chat-msg--mine' : ' chat-msg--theirs')
            }
          >
            <span className="chat-msg__who">{mine ? '나' : '상대'}</span>
            {/* 본문은 텍스트 노드로만 출력(React 보간 = XSS 방어). */}
            <span className="chat-msg__body">{m.body}</span>
            <time className="chat-msg__time" dateTime={m.createdAt}>
              {timeLabel(m.createdAt)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
