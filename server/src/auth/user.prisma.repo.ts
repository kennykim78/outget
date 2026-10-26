// User 영속 리포지토리(Prisma). InMemoryUserRepository 와 동일 시그니처·행위.
//   id 는 앱이 prefix 문자열로 부여(스키마 @default 미사용).
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Role } from './roles.js';
import { needsLastSeenTouch, seoulDayStartIsoAt } from '../privacy/last-seen.js';
import type { User, UserRepository } from './user.repo.js';

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(email: string, passwordHash: string | null, role: Role): Promise<User> {
    const row = await this.prisma.user.create({
      data: { id: `usr-${randomUUID()}`, email, passwordHash, role },
    });
    return { id: row.id, email: row.email, passwordHash: row.passwordHash, role: row.role as Role };
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    if (!row) return undefined;
    return { id: row.id, email: row.email, passwordHash: row.passwordHash, role: row.role as Role };
  }

  async upsertByEmail(email: string): Promise<User> {
    // update: {} — 기존 사용자의 역할·비밀번호는 건드리지 않는다.
    //   같은 새 이메일의 동시 verify 두 개가 둘 다 create 로 가면 하나는 P2002(unique) — 그때는 먼저 만든 행을 읽는다(500 방지).
    let row;
    try {
      row = await this.prisma.user.upsert({
        where: { email },
        update: {},
        create: { id: `usr-${randomUUID()}`, email, passwordHash: null, role: 'USER', createdAt: new Date().toISOString() },
      });
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code !== 'P2002') throw err;
      row = await this.prisma.user.findUniqueOrThrow({ where: { email } });
    }
    return { id: row.id, email: row.email, passwordHash: row.passwordHash, role: row.role as Role };
  }

  /**
   * QA95 D-1: 읽기 1번으로 대부분 끝낸다(같은 서울 날짜 재방문 = 쓰기 0). 필요할 때만 조건부 updateMany —
   *   동시 요청 둘이 같이 읽어도 조건(null ∨ 오늘 00:00 이전) 때문에 실제 갱신은 하나. 사용자 없음(삭제 경합)은 0건 = false.
   */
  async touchLastSeen(userId: string, now: Date): Promise<boolean> {
    const row = await this.prisma.user.findUnique({ where: { id: userId }, select: { lastSeenAt: true } });
    if (!row || !needsLastSeenTouch(row.lastSeenAt, now)) return false;
    const dayStart = seoulDayStartIsoAt(now);
    const r = await this.prisma.user.updateMany({
      where: { id: userId, OR: [{ lastSeenAt: null }, { lastSeenAt: '' }, { lastSeenAt: { lt: dayStart } }] },
      data: { lastSeenAt: dayStart }, // 101 L-3: 날짜 단위(서울 00:00) — 접속 시각은 남기지 않는다
    });
    return r.count > 0;
  }

  async findById(id: string): Promise<User | undefined> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    if (!row) return undefined;
    return { id: row.id, email: row.email, passwordHash: row.passwordHash, role: row.role as Role };
  }
}
