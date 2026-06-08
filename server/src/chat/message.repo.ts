// Epic 5 채팅 메시지 리포지토리 — notification.repo.ts 포트 패턴 복제.
// 인메모리 보관: 프로세스 재시작 시 소실된다. 영속성(Postgres)은 후속 에픽.
//   MessageRepository 포트 뒤로 교체한다.
//
// 불변식 ②: 메시지에 금액·결제·자금 흐름 필드를 두지 않는다(텍스트 본문만).
// 증거 보존: **삭제 메서드를 제공하지 않는다** — 신고/분쟁 동선의 증빙을 보전한다.
// senderId 는 라우터가 JWT sub 로 강제하므로 여기서는 그대로 저장한다.
import type { StoredMessage } from './message.types.js';

export interface MessageRepository {
  // 메시지 추가. senderId 는 호출부(라우터)가 서버 강제한 값.
  append(threadId: string, senderId: string, body: string): Promise<StoredMessage>;
  // 스레드의 모든 메시지(작성 순). 당사자 인가는 라우터 책임.
  listByThread(threadId: string): Promise<StoredMessage[]>;
}

export class InMemoryMessageRepository implements MessageRepository {
  private readonly items: StoredMessage[] = [];
  private seq = 0;

  async append(
    threadId: string,
    senderId: string,
    body: string,
  ): Promise<StoredMessage> {
    const msg: StoredMessage = {
      id: `msg-${++this.seq}`,
      threadId,
      senderId,
      body,
      createdAt: new Date().toISOString(),
    };
    this.items.push(msg);
    return msg;
  }

  async listByThread(threadId: string): Promise<StoredMessage[]> {
    return this.items.filter((m) => m.threadId === threadId);
  }
}
