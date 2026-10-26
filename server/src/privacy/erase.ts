// 개인정보 삭제 핵심(P2·P4). 저장소 포트 + 인메모리 구현 + 채널 로그. Prisma 구현은 erase.prisma.ts.
//   한 번의 삭제 = 같은 트랜잭션에서
//     ① 그 이메일의 MagicLinkToken 전부(소비·만료 무관 — 삭제 전 발급된 링크로 되살아나지 않게)
//     ② User 삭제(Session·SaveSnapshot 은 Cascade, Prisma 구현은 명시 삭제도 함께)
//     ③ userId 기준 Badge·Notification·RefreshToken(sub)
//     ④ ErasureTombstone{sha256(정규화 이메일), erasedAt, retainUntil = max(기존, erasedAt+7일)} 기록(백업 복원 재적용용)
//   묘비 재적용(reapplyTombstones)이 실제로 User 를 지우면 그 묘비의 retainUntil 을 max(retainUntil, now+7일)로 연장한다(101 MED-2):
//     복원 직후 엔트리포인트가 재적용 전에 만든 새 백업(그 User 포함, mtime=now)이 최대 7일 남으므로 묘비도 그만큼 더 남아야 한다.
//   정리는 retainUntil < now 기준(erasedAt 아님). retainUntil 이 없는 옛 행·줄은 erasedAt+7일로 본다(하위 호환).
//   로그는 stdout 한 줄 '[privacy] erase channel=SELF|OPERATOR|RETENTION' — 이메일·userId·해시·건수 0(식별자 0).
import { sha256Hex } from '../save/crypto.js';
import type { InMemoryMagicTokenRepository, InMemorySaveSnapshotRepository, InMemorySessionRepository } from '../save/save.repo.js';
import type { InMemoryUserRepository } from '../auth/user.repo.js';
import type { InMemoryRefreshTokenStore } from '../auth/refresh.store.js';
import type { InMemoryNotificationRepository } from '../notification/notification.repo.js';
import { DAY_MS, TOMBSTONE_RETENTION_DAYS } from './policy.js';

export const ERASE_CHANNELS = ['SELF', 'OPERATOR', 'RETENTION'] as const;
export type EraseChannel = (typeof ERASE_CHANNELS)[number];

export interface EraseCounts {
  magicTokens: number;
  users: number;
  sessions: number;
  snapshots: number;
  badges: number;
  notifications: number;
  refreshTokens: number;
}

export const ZERO_COUNTS: EraseCounts = Object.freeze({
  magicTokens: 0,
  users: 0,
  sessions: 0,
  snapshots: 0,
  badges: 0,
  notifications: 0,
  refreshTokens: 0,
});

export interface EraseOptions {
  /** 묘비 기록 여부(기본 true). 묘비 재적용 경로만 false. */
  tombstone?: boolean;
}

export interface TombstoneRow {
  emailSha256: string;
  erasedAt: string;
  /** ISO. 이 시각 전에는 정리하지 않는다. 없으면(옛 행·줄) erasedAt + TOMBSTONE_RETENTION_DAYS. */
  retainUntil?: string;
}

/** ISO + TOMBSTONE_RETENTION_DAYS. 해석 불가 값이면 원문(호출부는 검증된 ISO 를 넘긴다). */
export function plusRetention(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t + TOMBSTONE_RETENTION_DAYS * DAY_MS).toISOString();
}

/** 순수: 묘비 보존 기한(retainUntil 없으면 erasedAt + 7일). */
export function retainUntilOf(row: Pick<TombstoneRow, 'erasedAt' | 'retainUntil'>): string {
  return typeof row.retainUntil === 'string' && row.retainUntil !== '' ? row.retainUntil : plusRetention(row.erasedAt);
}

const maxIso = (a: string, b: string): string => (b > a ? b : a);

/** 순수: 재적용으로 실제 삭제가 일어났을 때의 새 기한 = max(기존 기한, now + 7일). */
export function extendedRetainUntil(row: Pick<TombstoneRow, 'erasedAt' | 'retainUntil'>, now: Date): string {
  return maxIso(retainUntilOf(row), plusRetention(now.toISOString()));
}

export interface ReapplyOptions {
  /** 기준 시각(기본 new Date()) — 연장 기한 now + 7일. */
  now?: Date;
  /**
   * 재삭제 직전(대상 User 가 있을 때만) 연장된 묘비 행 — 파일 장식자가 연장 줄을 먼저 남긴다(삭제 전 기록, erase 와 같은 순서).
   *   여기서 throw 하면 그 사용자 삭제도 하지 않고 reapply 가 throw(기동 실패, fail-closed).
   */
  beforeErase?: (row: Required<TombstoneRow>) => Promise<void>;
}

export interface ErasureStore {
  /** 정규화 이메일 기준 전체 삭제(한 트랜잭션). 사용자 없어도 토큰·묘비는 처리한다. */
  eraseByEmail(email: string, nowIso: string, opts?: EraseOptions): Promise<EraseCounts>;
  /** userId → 이메일 조회 후 eraseByEmail. 사용자가 없으면 ZERO_COUNTS(묘비 없음). */
  eraseUser(userId: string, nowIso: string, opts?: EraseOptions): Promise<EraseCounts>;
  /**
   * 묘비와 일치하고 묘비 시각 이전에 생성된 User 를 다시 지운다. 지운 사용자 수.
   *   extra = 저장소 밖 묘비(백업 폴더 밖 파일, tombstone-file.ts) — 저장소 묘비와 합집합(mergeTombstones)으로 적용.
   *   실제로 지운 사용자의 묘비는 retainUntil = max(retainUntil, now+7일) 로 저장소에 기록(없으면 생성 — 복원으로 사라진 DB 묘비 복구).
   */
  reapplyTombstones(extra?: readonly TombstoneRow[], opts?: ReapplyOptions): Promise<number>;
  /** retainUntil < cutoffIso 묘비 삭제(cutoffIso = 정리 시각 now). 삭제 수. */
  pruneTombstones(cutoffIso: string): Promise<number>;
  /**
   * QA95 D-2: 삭제 페이지를 파일에서 제거(SQLite VACUUM). 트랜잭션 밖에서만 부른다.
   *   없거나 no-op = 의미 없는 저장소(인메모리·Postgres). DELETE /api/save 응답 뒤 compact.ts 스케줄러가 부른다.
   */
  compact?(): Promise<void>;
}

/** 묘비 키 = sha256(정규화 이메일) hex. 호출부는 이미 정규화한 이메일을 넘긴다. */
export function tombstoneKey(normalizedEmail: string): string {
  return sha256Hex(normalizedEmail);
}

/**
 * 순수: 묘비 합집합. 같은 키는 더 늦은 erasedAt 하나로 — createdAt < erasedAt 규칙에서
 *   늦은 시각이 이른 시각의 대상을 모두 포함하므로 "어느 묘비든 해당하면 삭제"와 같다. retainUntil 도 가장 늦은 값.
 */
export function mergeTombstones(...sets: ReadonlyArray<readonly TombstoneRow[]>): Required<TombstoneRow>[] {
  const at = new Map<string, { erasedAt: string; retainUntil: string }>();
  for (const set of sets) {
    for (const t of set) {
      const prev = at.get(t.emailSha256);
      const retainUntil = retainUntilOf(t);
      if (prev === undefined) at.set(t.emailSha256, { erasedAt: t.erasedAt, retainUntil });
      else at.set(t.emailSha256, { erasedAt: maxIso(prev.erasedAt, t.erasedAt), retainUntil: maxIso(prev.retainUntil, retainUntil) });
    }
  }
  return [...at].map(([emailSha256, v]) => ({ emailSha256, ...v }));
}

export interface TombstoneCandidate {
  id: string;
  email: string;
  /** ISO, 미상(R5 이전 행)은 '' — 사전순 최소라 묘비보다 이전으로 본다. */
  createdAt: string;
}

/**
 * 순수: 재삭제 대상 = 묘비 키 일치 ∧ createdAt < 묘비 erasedAt.
 *   삭제 뒤 같은 이메일로 다시 연결해 새로 만든 계정(createdAt ≥ erasedAt)은 지우지 않는다.
 */
export function tombstoneVictims(users: readonly TombstoneCandidate[], tombstones: readonly TombstoneRow[]): TombstoneCandidate[] {
  const at = new Map(tombstones.map((t) => [t.emailSha256, t.erasedAt]));
  return users.filter((u) => {
    const erasedAt = at.get(tombstoneKey(u.email));
    return erasedAt !== undefined && u.createdAt < erasedAt;
  });
}

/** 채널 로그(식별자 0). 테스트는 log 를 주입해 관찰한다. */
export type PrivacyLog = (line: string) => void;
// eslint-disable-next-line no-console
export const stdoutLog: PrivacyLog = (line) => console.log(line);

export function eraseLogLine(channel: EraseChannel): string {
  return `[privacy] erase channel=${channel}`;
}

export type EraseTarget = { userId: string } | { email: string };

/** 삭제 진입점(라우트·CLI·정리 작업 공용). 로그 한 줄 후 건수 반환. */
export async function eraseAccount(
  store: ErasureStore,
  target: EraseTarget,
  channel: EraseChannel,
  now: Date,
  log: PrivacyLog = stdoutLog,
): Promise<EraseCounts> {
  const nowIso = now.toISOString();
  const counts = 'userId' in target ? await store.eraseUser(target.userId, nowIso) : await store.eraseByEmail(target.email, nowIso);
  log(eraseLogLine(channel));
  return counts;
}

export interface InMemoryErasureDeps {
  user: InMemoryUserRepository;
  magicToken: InMemoryMagicTokenRepository;
  session: InMemorySessionRepository;
  saveSnapshot: InMemorySaveSnapshotRepository;
  notification: InMemoryNotificationRepository;
  refreshStore: InMemoryRefreshTokenStore;
}

/**
 * 인메모리 구현(테스트 기본 + dev 폴백). 삭제는 await 없는 동기 구간 하나 = 원자적.
 *   Badge 는 인메모리 Repos 에 없다(R5 D4 제거) — 0. 재기동하면 전부 소실되므로 묘비 재적용 대상도 없다(0).
 */
export class InMemoryErasureStore implements ErasureStore {
  private readonly tombstones = new Map<string, { erasedAt: string; retainUntil: string }>();

  constructor(private readonly d: InMemoryErasureDeps) {}

  private eraseSync(email: string, nowIso: string, opts: EraseOptions): EraseCounts {
    const magicTokens = this.d.magicToken.removeByEmailSync(email);
    const user = this.d.user.removeByEmailSync(email);
    const counts: EraseCounts = { ...ZERO_COUNTS, magicTokens };
    if (user) {
      counts.users = 1;
      counts.sessions = this.d.session.removeByUserIdSync(user.id);
      counts.snapshots = this.d.saveSnapshot.removeSync(user.id);
      counts.notifications = this.d.notification.removeByUserSync(user.id);
      counts.refreshTokens = this.d.refreshStore.removeAllForSubSync(user.id);
    }
    if (opts.tombstone !== false) {
      const key = tombstoneKey(email);
      const prev = this.tombstones.get(key);
      const retainUntil = plusRetention(nowIso);
      this.tombstones.set(key, { erasedAt: nowIso, retainUntil: prev ? maxIso(prev.retainUntil, retainUntil) : retainUntil });
    }
    return counts;
  }

  async eraseByEmail(email: string, nowIso: string, opts: EraseOptions = {}): Promise<EraseCounts> {
    return this.eraseSync(email, nowIso, opts);
  }

  async eraseUser(userId: string, nowIso: string, opts: EraseOptions = {}): Promise<EraseCounts> {
    const u = await this.d.user.findById(userId);
    if (!u) return { ...ZERO_COUNTS };
    return this.eraseSync(u.email, nowIso, opts);
  }

  // 인메모리는 재기동하면 전부 소실 — 복원될 백업이 없으므로 extra 도 적용 대상 없음(0).
  async reapplyTombstones(): Promise<number> {
    return 0;
  }

  async pruneTombstones(cutoffIso: string): Promise<number> {
    let n = 0;
    for (const [k, t] of this.tombstones) {
      if (t.retainUntil < cutoffIso) {
        this.tombstones.delete(k);
        n++;
      }
    }
    return n;
  }

  /** 테스트 관찰용. */
  dumpTombstones(): Required<TombstoneRow>[] {
    return [...this.tombstones].map(([emailSha256, t]) => ({ emailSha256, ...t }));
  }
}
