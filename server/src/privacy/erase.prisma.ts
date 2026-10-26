// 개인정보 삭제 Prisma 구현(P2·P4) — InMemoryErasureStore 와 같은 행위. 한 번의 삭제 = 대화형 트랜잭션 1개.
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  extendedRetainUntil,
  mergeTombstones,
  plusRetention,
  tombstoneKey,
  tombstoneVictims,
  ZERO_COUNTS,
  type EraseCounts,
  type EraseOptions,
  type ErasureStore,
  type ReapplyOptions,
  type TombstoneRow,
} from './erase.js';

type Tx = Prisma.TransactionClient;

/** 순서: 토큰(이메일) → 세션·스냅샷 → User → Badge·Notification·RefreshToken(userId) → 묘비. */
async function eraseInTx(tx: Tx, email: string, nowIso: string, opts: EraseOptions): Promise<EraseCounts> {
  const counts: EraseCounts = { ...ZERO_COUNTS };
  counts.magicTokens = (await tx.magicLinkToken.deleteMany({ where: { email } })).count;
  const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    const userId = user.id;
    // Session·SaveSnapshot 은 onDelete: Cascade 지만 건수 보고·foreign_keys 설정 무관하게 명시 삭제한다.
    counts.sessions = (await tx.session.deleteMany({ where: { userId } })).count;
    counts.snapshots = (await tx.saveSnapshot.deleteMany({ where: { userId } })).count;
    counts.users = (await tx.user.deleteMany({ where: { id: userId } })).count;
    counts.badges = (await tx.badge.deleteMany({ where: { userId } })).count;
    counts.notifications = (await tx.notification.deleteMany({ where: { userId } })).count;
    counts.refreshTokens = (await tx.refreshToken.deleteMany({ where: { sub: userId } })).count;
  }
  if (opts.tombstone !== false) {
    // retainUntil = max(기존, now+7일) — 시계가 뒤로 가도 이미 약속한 기한을 줄이지 않는다.
    const retainUntil = plusRetention(nowIso);
    await upsertTombstone(tx, { emailSha256: tombstoneKey(email), erasedAt: nowIso, retainUntil }, { replaceErasedAt: true });
  }
  return counts;
}

/**
 * 묘비 쓰기: 없으면 생성, 있으면 retainUntil = max(기존, 새 값).
 *   replaceErasedAt — 새 삭제(erase)는 erasedAt 을 지금으로, 재적용은 max(기존, 묘비) 유지(원래 삭제 시각 기준 판정을 넓히지 않음).
 */
async function upsertTombstone(tx: Tx, row: Required<TombstoneRow>, o: { replaceErasedAt: boolean }): Promise<void> {
  const prev = await tx.erasureTombstone.findUnique({ where: { emailSha256: row.emailSha256 } });
  if (!prev) {
    await tx.erasureTombstone.create({ data: row });
    return;
  }
  const erasedAt = o.replaceErasedAt || row.erasedAt > prev.erasedAt ? row.erasedAt : prev.erasedAt;
  const retainUntil = row.retainUntil > prev.retainUntil ? row.retainUntil : prev.retainUntil;
  await tx.erasureTombstone.update({ where: { emailSha256: row.emailSha256 }, data: { erasedAt, retainUntil } });
}

export class PrismaErasureStore implements ErasureStore {
  /** provider 기본 'sqlite'(schema.prisma datasource). M2 Postgres 전환 시 'postgresql'(compact = no-op). */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: 'sqlite' | 'postgresql' = 'sqlite',
  ) {}

  /** QA95 D-2: SQLite 만 VACUUM(retention.prisma.ts vacuum 과 같은 문장). Postgres 는 autovacuum 몫. */
  async compact(): Promise<void> {
    if (this.provider === 'sqlite') await this.prisma.$executeRawUnsafe('VACUUM');
  }

  async eraseByEmail(email: string, nowIso: string, opts: EraseOptions = {}): Promise<EraseCounts> {
    return this.prisma.$transaction((tx) => eraseInTx(tx, email, nowIso, opts));
  }

  async eraseUser(userId: string, nowIso: string, opts: EraseOptions = {}): Promise<EraseCounts> {
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!u) return { ...ZERO_COUNTS };
      return eraseInTx(tx, u.email, nowIso, opts);
    });
  }

  /**
   * DB 묘비 ∪ extra(파일 묘비). 백업 복원으로 DB 묘비가 사라져도 extra 만으로 재적용된다.
   *   101 MED-2: 실제로 User 를 지우면 같은 트랜잭션에서 묘비를 retainUntil = max(retainUntil, now+7일) 로 기록(없으면 생성).
   *   erasedAt 은 원래 삭제 시각 유지 — 그 뒤 같은 이메일로 새로 만든 계정은 계속 지우지 않는다.
   */
  async reapplyTombstones(extra: readonly TombstoneRow[] = [], opts: ReapplyOptions = {}): Promise<number> {
    const tombstones = mergeTombstones(await this.prisma.erasureTombstone.findMany(), extra);
    if (tombstones.length === 0) return 0;
    const now = opts.now ?? new Date();
    const byKey = new Map(tombstones.map((t) => [t.emailSha256, t]));
    const users = await this.prisma.user.findMany({ select: { id: true, email: true, createdAt: true } });
    let n = 0;
    for (const v of tombstoneVictims(users, tombstones)) {
      const t = byKey.get(tombstoneKey(v.email));
      if (!t) continue; // tombstoneVictims 가 고른 대상이라 도달 불가.
      const row = { ...t, retainUntil: extendedRetainUntil(t, now) };
      if (opts.beforeErase) await opts.beforeErase(row);
      const c = await this.prisma.$transaction(async (tx) => {
        const counts = await eraseInTx(tx, v.email, '', { tombstone: false });
        if (counts.users > 0) await upsertTombstone(tx, row, { replaceErasedAt: false });
        return counts;
      });
      n += c.users;
    }
    return n;
  }

  /** retainUntil < cutoffIso(= 정리 시각) 묘비 삭제. */
  async pruneTombstones(cutoffIso: string): Promise<number> {
    return (await this.prisma.erasureTombstone.deleteMany({ where: { retainUntil: { lt: cutoffIso } } })).count;
  }
}
