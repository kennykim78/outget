// Epic 4 알림 리포지토리 — 인메모리 레코드. agent.repo.ts 포트 패턴 복제.
// 인메모리 보관: 프로세스 재시작 시 소실된다. 영속성(Postgres)은 후속 에픽.
//
// 불변식 ②: 알림에 결제·자금 흐름 필드를 두지 않는다(채택/확인가/거절 통지일 뿐).
// 외부 fetch 0: 알림은 자사 GET /api/notifications 폴링으로만 노출된다.
import type { StoredNotification } from './notification.types.js';

export interface NotificationRepository {
  append(
    userId: string,
    type: string,
    refId: string,
    message: string,
  ): Promise<StoredNotification>;
  listByUser(userId: string): Promise<StoredNotification[]>;
}

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly items: StoredNotification[] = [];
  private seq = 0;

  async append(
    userId: string,
    type: string,
    refId: string,
    message: string,
  ): Promise<StoredNotification> {
    const note: StoredNotification = {
      id: `n-${++this.seq}`,
      userId,
      type,
      refId,
      message,
      createdAt: new Date().toISOString(),
      read: false,
    };
    this.items.push(note);
    return note;
  }

  async listByUser(userId: string): Promise<StoredNotification[]> {
    return this.items.filter((n) => n.userId === userId);
  }
}
