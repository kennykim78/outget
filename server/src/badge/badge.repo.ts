// Epic 8 뱃지 리포지토리 — agent.repo.ts 포트 패턴 복제.
// 인메모리 보관: 프로세스 재시작 시 소실된다. 영속성(Postgres)은 후속 에픽.
//   BadgeRepository 포트 뒤로 교체한다.
//
// 불변식 ②(자금 미보유): 뱃지는 무금전 신뢰 신호다 — 금액·잔액·정산 필드 0.
//   grant 는 어떤 금전 값도 다루지 않는다(라벨 부여만).
// 멱등: 같은 (userId, type) 은 한 번만 보유한다 — 재호출해도 중복 부여되지 않는다.
import type { Badge } from './badge.types.js';

export interface BadgeRepository {
  // (userId, type) 멱등 부여. 이미 보유하면 기존 레코드를 반환(중복 생성 없음).
  grant(userId: string, type: string): Promise<Badge>;
  // 수상자의 뱃지 type 목록(노출용). 없으면 빈 배열.
  listByUser(userId: string): Promise<string[]>;
}

export class InMemoryBadgeRepository implements BadgeRepository {
  // key: `${userId}::${type}` → Badge. 자연키로 멱등 보장.
  private readonly byKey = new Map<string, Badge>();

  private keyOf(userId: string, type: string): string {
    return `${userId}::${type}`;
  }

  async grant(userId: string, type: string): Promise<Badge> {
    const key = this.keyOf(userId, type);
    const existing = this.byKey.get(key);
    if (existing) return existing; // 멱등: 중복 부여 무시.
    const badge: Badge = { userId, type, grantedAt: new Date().toISOString() };
    this.byKey.set(key, badge);
    return badge;
  }

  async listByUser(userId: string): Promise<string[]> {
    const out: string[] = [];
    for (const b of this.byKey.values()) {
      if (b.userId === userId) out.push(b.type);
    }
    return out;
  }
}
