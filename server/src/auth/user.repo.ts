// Epic 1 stub — 영속성(Postgres)은 후속 에픽. UserRepository 포트 뒤로 교체.
// 불변식 ⑤: 위경도(lat/lng/coords) 컬럼 절대 없음 — 위치는 후속 에픽에서 동/지역 단위 텍스트만.
import bcrypt from 'bcryptjs';
import type { Role } from './roles.js';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
}

export interface UserRepository {
  create(email: string, passwordHash: string, role: Role): Promise<User>;
  findByEmail(email: string): Promise<User | undefined>;
  findById(id: string): Promise<User | undefined>;
}

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export class InMemoryUserRepository implements UserRepository {
  private readonly byEmail = new Map<string, User>();
  private readonly byId = new Map<string, User>();
  private seq = 0;

  async create(email: string, passwordHash: string, role: Role): Promise<User> {
    const id = String(++this.seq);
    const user: User = { id, email, passwordHash, role };
    this.byEmail.set(email, user);
    this.byId.set(id, user);
    return user;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return this.byEmail.get(email);
  }

  async findById(id: string): Promise<User | undefined> {
    return this.byId.get(id);
  }
}
