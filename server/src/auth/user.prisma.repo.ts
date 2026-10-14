// User 영속 리포지토리(Prisma). InMemoryUserRepository 와 동일 시그니처·행위.
//   id 는 앱이 prefix 문자열로 부여(스키마 @default 미사용).
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Role } from './roles.js';
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
    const row = await this.prisma.user.upsert({
      where: { email },
      update: {},
      create: { id: `usr-${randomUUID()}`, email, passwordHash: null, role: 'USER', createdAt: new Date().toISOString() },
    });
    return { id: row.id, email: row.email, passwordHash: row.passwordHash, role: row.role as Role };
  }

  async findById(id: string): Promise<User | undefined> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    if (!row) return undefined;
    return { id: row.id, email: row.email, passwordHash: row.passwordHash, role: row.role as Role };
  }
}
