// Epic 1 stub — 영속성(Postgres)은 후속 에픽. UserRepository 포트 뒤로 교체.
// 불변식 ⑤: 위경도(lat/lng/coords) 컬럼 절대 없음 — 위치는 후속 에픽에서 동/지역 단위 텍스트만.
import bcrypt from 'bcryptjs';
import type { Role } from './roles.js';

export interface User {
  id: string;
  email: string;
  /** null = 매직링크 사용자(R5 D20). 비밀번호 로그인 불가. */
  passwordHash: string | null;
  role: Role;
}

export interface UserRepository {
  create(email: string, passwordHash: string | null, role: Role): Promise<User>;
  findByEmail(email: string): Promise<User | undefined>;
  findById(id: string): Promise<User | undefined>;
  /** 매직링크 verify(D20): 있으면 그대로(역할·비밀번호 불변), 없으면 USER·passwordHash null 로 생성. */
  upsertByEmail(email: string): Promise<User>;
}

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

// SEC-3 L-4: 계정 없음·비밀번호 없음 경로도 같은 비용의 bcrypt 비교를 한 번 한다(운영자 이메일 타이밍 노출 방지).
//   고정 더미 해시(bcrypt cost 10, 원문은 생성 직후 폐기한 32B 난수) — 비교 결과는 버린다.
export const DUMMY_PASSWORD_HASH = '$2a$10$0DJYKT2fgDw1wIK6boZzY.Uun1Hup4eJjxcoIXFK27Froq3je7AEG';

/** 미스 경로 균등화: 더미 해시와 비교(항상 false 취급). */
export async function burnPasswordCheck(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_PASSWORD_HASH);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (hash === null) return false; // 매직링크 사용자는 비밀번호가 없다
  return bcrypt.compare(plain, hash);
}

export class InMemoryUserRepository implements UserRepository {
  private readonly byEmail = new Map<string, User>();
  private readonly byId = new Map<string, User>();
  private seq = 0;

  async upsertByEmail(email: string): Promise<User> {
    return this.byEmail.get(email) ?? this.create(email, null, 'USER');
  }

  async create(email: string, passwordHash: string | null, role: Role): Promise<User> {
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
