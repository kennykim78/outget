// Epic 1 stub — 영속성(Postgres)은 후속 에픽. UserRepository 포트 뒤로 교체.
// 불변식 ⑤: 위경도(lat/lng/coords) 컬럼 절대 없음 — 위치는 후속 에픽에서 동/지역 단위 텍스트만.
import bcrypt from 'bcryptjs';
import type { Role } from './roles.js';
import { needsLastSeenTouch, seoulDayStartIsoAt } from '../privacy/last-seen.js';

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
  /**
   * QA95 D-1: 마지막 사용 시각 갱신 — 저장값의 서울 날짜가 오늘이 아닐 때(또는 없을 때)만 now 로 1회 쓴다.
   *   쓴 경우 true. 사용자가 없으면(삭제 경합) 아무것도 하지 않고 false — throw 하지 않는다.
   */
  touchLastSeen(userId: string, now: Date): Promise<boolean>;
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
  /** QA95 D-1: userId → lastSeenAt(ISO). Prisma 의 User.lastSeenAt 과 같은 규칙. */
  private readonly lastSeen = new Map<string, string>();
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

  async touchLastSeen(userId: string, now: Date): Promise<boolean> {
    if (!this.byId.has(userId) || !needsLastSeenTouch(this.lastSeen.get(userId), now)) return false;
    this.lastSeen.set(userId, seoulDayStartIsoAt(now)); // 101 L-3: 날짜 단위(Prisma 와 같은 값)
    return true;
  }

  /** 테스트 관찰용. */
  lastSeenAtOf(userId: string): string | null {
    return this.lastSeen.get(userId) ?? null;
  }

  /** P2 삭제(privacy 인메모리 eraser 전용, 동기): 이메일로 1명 제거, 제거된 사용자 또는 undefined. */
  removeByEmailSync(email: string): User | undefined {
    const u = this.byEmail.get(email);
    if (!u) return undefined;
    this.byEmail.delete(email);
    this.byId.delete(u.id);
    this.lastSeen.delete(u.id);
    return u;
  }
}
