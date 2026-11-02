// P2·P4·P5·P7 Prisma(실제 SQLite, prisma/migrations/*.sql 적용): 삭제 트랜잭션·묘비 재적용·정리 작업·VACUUM·CLI 출력.
//   마이그레이션 증명: 새 마이그레이션은 ErasureTombstone 테이블 1개만 만든다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { sqliteDatasourceUrl } from '../db/sqlite-url.js';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../save/crypto.js';
import { PrismaErasureStore } from '../privacy/erase.prisma.js';
import { eraseAccount, tombstoneKey, ZERO_COUNTS as ZERO } from '../privacy/erase.js';
import { PrismaRetentionStore } from '../privacy/retention.prisma.js';
import { computeCutoffs, runRetention } from '../privacy/retention.js';
import { runEraseCli } from '../privacy/cli-erase.js';
import { daysBefore } from '../reaction/anon-key.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '..', '..', 'prisma', 'migrations');

function statements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

// 테스트마다 새 SQLite 파일 + 전체 마이그레이션 — 전체 스위트 병렬 부하에서 5s 기본값을 넘을 수 있다.
vi.setConfig({ testTimeout: 30_000 });

const open: { dir: string; prisma: PrismaClient }[] = [];

async function freshDb(): Promise<PrismaClient> {
  const dir = mkdtempSync(join(tmpdir(), 'ws-privacy-'));
  const prisma = new PrismaClient({ datasourceUrl: sqliteDatasourceUrl(`file:${join(dir, 'test.db').replace(/\\/g, '/')}`) });
  open.push({ dir, prisma });
  const names = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const n of names) {
    for (const s of statements(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8'))) await prisma.$executeRawUnsafe(s);
  }
  return prisma;
}

afterEach(async () => {
  for (const { dir, prisma } of open.splice(0)) {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

const NOW = new Date('2026-10-25T03:00:00.000Z'); // 서울 2026-10-25 12:00
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

async function seedUser(prisma: PrismaClient, email: string, createdAt = iso(NOW.getTime() - 10 * DAY)) {
  const id = `usr-${sha256Hex(email).slice(0, 8)}`;
  await prisma.user.create({ data: { id, email, role: 'USER', createdAt } });
  await prisma.session.create({ data: { sidHash: sha256Hex(`s1${email}`), userId: id, createdAt, expiresAt: iso(NOW.getTime() + DAY) } });
  await prisma.session.create({ data: { sidHash: sha256Hex(`s2${email}`), userId: id, createdAt, expiresAt: iso(NOW.getTime() + DAY) } });
  await prisma.saveSnapshot.create({ data: { userId: id, v: 1, payload: '{}', updatedAt: createdAt } });
  await prisma.magicLinkToken.create({
    data: { tokenHash: sha256Hex(`t1${email}`), email, createdAt, expiresAt: iso(NOW.getTime() + 60_000), consumedAt: null },
  });
  await prisma.magicLinkToken.create({
    data: { tokenHash: sha256Hex(`t2${email}`), email, createdAt, expiresAt: iso(NOW.getTime() - 60_000), consumedAt: createdAt },
  });
  await prisma.badge.create({ data: { userId: id, type: 'first', grantedAt: createdAt } });
  await prisma.notification.create({ data: { id: `n-${id}`, userId: id, type: 't', refId: 'r', message: 'm', createdAt } });
  await prisma.refreshToken.create({ data: { jti: `j-${id}`, sub: id, expiresAt: new Date(NOW.getTime() + DAY) } });
  return id;
}

async function rowsFor(prisma: PrismaClient, email: string, id: string) {
  return {
    tokens: await prisma.magicLinkToken.count({ where: { email } }),
    users: await prisma.user.count({ where: { id } }),
    sessions: await prisma.session.count({ where: { userId: id } }),
    snapshots: await prisma.saveSnapshot.count({ where: { userId: id } }),
    badges: await prisma.badge.count({ where: { userId: id } }),
    notifications: await prisma.notification.count({ where: { userId: id } }),
    refresh: await prisma.refreshToken.count({ where: { sub: id } }),
  };
}

describe('마이그레이션', () => {
  it('privacy_tombstone 마이그레이션 = CREATE TABLE "ErasureTombstone" 1개뿐', () => {
    const dir = readdirSync(MIGRATIONS).find((n) => n.endsWith('_privacy_tombstone'));
    expect(dir).toBeDefined();
    const sql = statements(readFileSync(join(MIGRATIONS, dir!, 'migration.sql'), 'utf8'));
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/^CREATE TABLE "ErasureTombstone" \(\s*"emailSha256" TEXT NOT NULL PRIMARY KEY,\s*"erasedAt" TEXT NOT NULL\s*\)$/);
  });

  it('101 MED-2 tombstone_retain_until: ErasureTombstone 재정의(컬럼 retainUntil 1개 추가)뿐 · 기존 행은 erasedAt+7일로 채움', async () => {
    const dir = readdirSync(MIGRATIONS).find((n) => n.endsWith('_tombstone_retain_until'));
    expect(dir).toBeDefined();
    const sql = statements(readFileSync(join(MIGRATIONS, dir!, 'migration.sql'), 'utf8'));
    // 다른 테이블은 건드리지 않는다
    for (const st of sql) {
      if (st.startsWith('PRAGMA')) continue;
      expect(st).toMatch(/"(new_)?ErasureTombstone"/);
    }
    const create = sql.find((st) => st.startsWith('CREATE TABLE'));
    expect(create).toMatch(/"emailSha256" TEXT NOT NULL PRIMARY KEY,\s*"erasedAt" TEXT NOT NULL,\s*"retainUntil" TEXT NOT NULL\s*\)$/);

    // 실제 적용: 이 마이그레이션 직전 상태에 옛 행 → 적용 후 retainUntil = erasedAt + 7일(정규 ISO)
    const tdir = mkdtempSync(join(tmpdir(), 'ws-privacy-'));
    const prisma = new PrismaClient({ datasourceUrl: sqliteDatasourceUrl(`file:${join(tdir, 'test.db').replace(/\\/g, '/')}`) });
    open.push({ dir: tdir, prisma });
    const names = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    for (const n of names.slice(0, names.indexOf(dir!))) {
      for (const st of statements(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8'))) await prisma.$executeRawUnsafe(st);
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "ErasureTombstone" ("emailSha256","erasedAt") VALUES ('${'a'.repeat(64)}','2026-10-25T03:00:00.000Z')`);
    await prisma.$executeRawUnsafe(`INSERT INTO "ErasureTombstone" ("emailSha256","erasedAt") VALUES ('${'b'.repeat(64)}','2026-12-28T23:59:59.999Z')`);
    for (const st of sql) await prisma.$executeRawUnsafe(st);
    expect(await prisma.erasureTombstone.findMany({ orderBy: { emailSha256: 'asc' } })).toEqual([
      { emailSha256: 'a'.repeat(64), erasedAt: '2026-10-25T03:00:00.000Z', retainUntil: '2026-11-01T03:00:00.000Z' },
      { emailSha256: 'b'.repeat(64), erasedAt: '2026-12-28T23:59:59.999Z', retainUntil: '2027-01-04T23:59:59.999Z' },
    ]);
  });
});

describe('PrismaErasureStore (P2)', () => {
  it('eraseByEmail: 토큰 전부 → User·세션·스냅샷 → Badge·Notification·RefreshToken 0, 묘비 1, 다른 사용자 불변', async () => {
    const prisma = await freshDb();
    const id = await seedUser(prisma, 'a@example.com');
    const otherId = await seedUser(prisma, 'b@example.com');
    const store = new PrismaErasureStore(prisma);
    const counts = await store.eraseByEmail('a@example.com', NOW.toISOString());
    expect(counts).toEqual({ magicTokens: 2, users: 1, sessions: 2, snapshots: 1, badges: 1, notifications: 1, refreshTokens: 1 });
    expect(await rowsFor(prisma, 'a@example.com', id)).toEqual({
      tokens: 0, users: 0, sessions: 0, snapshots: 0, badges: 0, notifications: 0, refresh: 0,
    });
    expect(await rowsFor(prisma, 'b@example.com', otherId)).toEqual({
      tokens: 2, users: 1, sessions: 2, snapshots: 1, badges: 1, notifications: 1, refresh: 1,
    });
    expect(await prisma.erasureTombstone.findMany()).toEqual([
      { emailSha256: tombstoneKey('a@example.com'), erasedAt: NOW.toISOString(), retainUntil: iso(NOW.getTime() + 7 * DAY) },
    ]);
  });

  it('eraseUser(userId) 동일 · 없는 userId 는 0건·묘비 없음 · 사용자 없는 이메일도 토큰 정리 + 묘비', async () => {
    const prisma = await freshDb();
    const id = await seedUser(prisma, 'a@example.com');
    const store = new PrismaErasureStore(prisma);
    expect((await store.eraseUser('usr-none', NOW.toISOString())).users).toBe(0);
    expect(await prisma.erasureTombstone.count()).toBe(0);
    expect((await store.eraseUser(id, NOW.toISOString())).users).toBe(1);
    await prisma.magicLinkToken.create({
      data: { tokenHash: 'h'.repeat(64), email: 'ghost@example.com', createdAt: iso(NOW.getTime()), expiresAt: iso(NOW.getTime() + 1), consumedAt: null },
    });
    const c = await store.eraseByEmail('ghost@example.com', NOW.toISOString());
    expect(c).toMatchObject({ magicTokens: 1, users: 0 });
    expect(await prisma.erasureTombstone.count()).toBe(2);
  });

  it('트랜잭션: 중간 실패면 전부 롤백(토큰도 남는다)', async () => {
    const prisma = await freshDb();
    const id = await seedUser(prisma, 'a@example.com');
    const store = new PrismaErasureStore(prisma);
    const spy = vi.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
      (prisma.$transaction as unknown as (f: (tx: unknown) => Promise<unknown>) => Promise<unknown>).call(prisma, async (tx: unknown) => {
        await fn(tx);
        throw new Error('boom');
      })) as never);
    await expect(store.eraseByEmail('a@example.com', NOW.toISOString())).rejects.toThrow('boom');
    spy.mockRestore();
    expect(await rowsFor(prisma, 'a@example.com', id)).toMatchObject({ tokens: 2, users: 1, sessions: 2, snapshots: 1 });
    expect(await prisma.erasureTombstone.count()).toBe(0);
  });
});

describe('묘비 재적용 (P4)', () => {
  it('묘비 이전에 만들어진 일치 User 만 다시 지운다 — 삭제 뒤 새로 연결한 계정·다른 사용자는 유지, erasedAt 불변 · 실제 삭제한 묘비만 연장', async () => {
    const prisma = await freshDb();
    const store = new PrismaErasureStore(prisma);
    const erasedAt = iso(NOW.getTime() - 2 * DAY);
    const retainUntil = iso(NOW.getTime() + 5 * DAY);
    await prisma.erasureTombstone.create({ data: { emailSha256: tombstoneKey('restored@example.com'), erasedAt, retainUntil } });
    await prisma.erasureTombstone.create({ data: { emailSha256: tombstoneKey('relinked@example.com'), erasedAt, retainUntil } });
    await prisma.erasureTombstone.create({ data: { emailSha256: tombstoneKey('legacy@example.com'), erasedAt, retainUntil } });
    const restored = await seedUser(prisma, 'restored@example.com', iso(NOW.getTime() - 30 * DAY)); // 백업에서 되살아남
    const relinked = await seedUser(prisma, 'relinked@example.com', iso(NOW.getTime() - 1 * DAY)); // 삭제 후 새 연결
    const legacy = await seedUser(prisma, 'legacy@example.com', ''); // createdAt 미상(R5 이전)
    const other = await seedUser(prisma, 'other@example.com', iso(NOW.getTime() - 30 * DAY));
    expect(await store.reapplyTombstones([], { now: NOW })).toBe(2);
    expect(await rowsFor(prisma, 'restored@example.com', restored)).toMatchObject({ users: 0, tokens: 0, sessions: 0, snapshots: 0 });
    expect(await rowsFor(prisma, 'legacy@example.com', legacy)).toMatchObject({ users: 0 });
    expect(await rowsFor(prisma, 'relinked@example.com', relinked)).toMatchObject({ users: 1, sessions: 2 });
    expect(await rowsFor(prisma, 'other@example.com', other)).toMatchObject({ users: 1 });
    expect((await prisma.erasureTombstone.findMany()).map((t) => t.erasedAt)).toEqual([erasedAt, erasedAt, erasedAt]);
    // 101 MED-2: 실제 삭제(restored·legacy)만 max(retainUntil, now+7일), relinked(삭제 0)는 그대로
    const ru = Object.fromEntries((await prisma.erasureTombstone.findMany()).map((t) => [t.emailSha256, t.retainUntil]));
    expect(ru[tombstoneKey('restored@example.com')]).toBe(iso(NOW.getTime() + 7 * DAY));
    expect(ru[tombstoneKey('legacy@example.com')]).toBe(iso(NOW.getTime() + 7 * DAY));
    expect(ru[tombstoneKey('relinked@example.com')]).toBe(retainUntil);
    expect(await store.reapplyTombstones([], { now: NOW })).toBe(0); // 멱등
  });

  it('묘비 없음 → 0, 사용자 조회도 안 함', async () => {
    const prisma = await freshDb();
    const spy = vi.spyOn(prisma.user, 'findMany');
    expect(await new PrismaErasureStore(prisma).reapplyTombstones()).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('PrismaRetentionStore + runRetention (P5)', () => {
  it('경계 ±1일: EventLog 90일·Reaction 400일·묘비 7일·미사용 User 365일, VACUUM 마지막 1회', async () => {
    const prisma = await freshDb();
    const c = computeCutoffs(NOW);
    // EventLog: 기준일(포함 보존) / 하루 전(삭제)
    const ev = (id: string, receivedDate: string) =>
      prisma.eventLog.create({ data: { id, name: 'x', ts: NOW.toISOString(), props: '{}', sessionKey: 'k', receivedDate } });
    await ev('keep', c.eventDate);
    await ev('drop', daysBefore(c.eventDate, 1));
    expect(c.eventDate).toBe('2026-07-28'); // 2026-10-25 포함 90일
    // Reaction: 창 첫날 서울 00:00(보존) / 1ms 전(삭제)
    const rx = (id: string, createdAt: string) =>
      prisma.reactionSignal.create({ data: { id, targetType: 'PRODUCT', targetId: 't', kind: 'LIKE', anonKey: id, createdAt } });
    await rx('rkeep', c.reactionIso);
    await rx('rdrop', iso(Date.parse(c.reactionIso) - 1));
    // 묘비: 기준은 retainUntil < now(101 MED-2)
    await prisma.erasureTombstone.create({ data: { emailSha256: 'a'.repeat(64), erasedAt: iso(NOW.getTime() - 6 * DAY), retainUntil: iso(NOW.getTime() + DAY) } });
    await prisma.erasureTombstone.create({ data: { emailSha256: 'b'.repeat(64), erasedAt: iso(NOW.getTime() - 8 * DAY), retainUntil: iso(NOW.getTime() - DAY) } });
    // 미사용 User: 364일 전 활동(유지) / 366일 전(삭제) / OPERATOR 366일 전(유지)
    await seedUser(prisma, 'active@example.com', iso(NOW.getTime() - 364 * DAY));
    const staleId = await seedUser(prisma, 'stale@example.com', iso(NOW.getTime() - 366 * DAY));
    await prisma.user.create({ data: { id: 'usr-op', email: 'op@example.com', role: 'OPERATOR', passwordHash: 'h', createdAt: iso(NOW.getTime() - 999 * DAY) } });

    const raw = vi.spyOn(prisma, '$executeRawUnsafe');
    const lines: string[] = [];
    const prune = vi.fn(async () => 0);
    const report = await runRetention(
      { store: new PrismaRetentionStore(prisma), erasure: new PrismaErasureStore(prisma), backup: { dir: '/nope', maxAgeDays: 7 }, log: (l) => lines.push(l), pruneBackups: prune },
      NOW,
    );
    expect(report).toMatchObject({ users: 1, events: 1, reactions: 1, tombstones: 1, vacuumed: true });
    expect(raw.mock.calls.map((a) => a[0])).toEqual(['VACUUM']);
    expect(prune).toHaveBeenCalledWith('/nope', NOW.getTime() - 7 * DAY);
    expect((await prisma.eventLog.findMany()).map((r) => r.id)).toEqual(['keep']);
    expect((await prisma.reactionSignal.findMany()).map((r) => r.id)).toEqual(['rkeep']);
    expect((await prisma.erasureTombstone.findMany()).map((r) => r.emailSha256)).toEqual(['a'.repeat(64), tombstoneKey('stale@example.com')]);
    expect(await prisma.user.count({ where: { id: staleId } })).toBe(0);
    expect((await prisma.user.findMany({ orderBy: { email: 'asc' } })).map((u) => u.email)).toEqual(['active@example.com', 'op@example.com']);
    expect(lines[0]).toBe('[privacy] erase channel=RETENTION');
    expect(lines.at(-1)).toMatch(/^\[privacy\] retention users=1 magicTokens=\d+ sessions=\d+ events=1 reactions=1 vetReports=0 tombstones=1 backups=0 vacuum=yes$/);
    expect(lines.join('\n')).not.toContain('@');
  });

  it('264 병원 제보 180일: REPORTED·BLINDED 179·180일(=기준, 유지)·181일(삭제) · VERIFIED·시드 행은 나이와 무관하게 유지(QA LOW-1)', async () => {
    const prisma = await freshDb();
    const c = computeCutoffs(NOW);
    expect(c.vetReportIso).toBe(iso(NOW.getTime() - 180 * DAY));
    const vet = (id: string, createdAt: string, status = 'REPORTED', source = 'USER_REPORT') =>
      prisma.vetClinic.create({ data: { id, name: id, region: '', address: '서울 마포구 1', phone: '02-123-4567', treats: '[]', source, status, createdAt } });
    await vet('d179', iso(NOW.getTime() - 179 * DAY));
    await vet('d180', iso(NOW.getTime() - 180 * DAY)); // = 기준 → 유지(< 만 삭제)
    await vet('d180p1ms', iso(NOW.getTime() - 180 * DAY - 1)); // 1ms 넘김 → 삭제
    await vet('d181', iso(NOW.getTime() - 181 * DAY));
    await vet('verified-old', iso(NOW.getTime() - 999 * DAY), 'VERIFIED');
    await vet('blinded-old', iso(NOW.getTime() - 999 * DAY), 'BLINDED'); // 가린 제보 → 삭제(목록에 없는 제보)
    await vet('b179', iso(NOW.getTime() - 179 * DAY), 'BLINDED');
    await vet('b181', iso(NOW.getTime() - 181 * DAY), 'BLINDED');
    await vet('seed-reported', '', 'REPORTED', 'SEED'); // 시드 행: createdAt '' — 시드가 관리
    await vet('seed-blinded', '', 'BLINDED', 'SEED');
    await vet('rejected181', iso(NOW.getTime() - 181 * DAY), 'REJECTED'); // security ②b: 모르는 상태값도 180일을 넘기지 않는다
    await vet('rejected179', iso(NOW.getTime() - 179 * DAY), 'REJECTED');
    const store = new PrismaRetentionStore(prisma);
    expect(await store.deleteReportedVetsBefore(c.vetReportIso)).toBe(5);
    expect((await prisma.vetClinic.findMany({ orderBy: { id: 'asc' } })).map((r) => r.id)).toEqual(
      ['b179', 'd179', 'd180', 'rejected179', 'seed-blinded', 'seed-reported', 'verified-old'],
    );
    // runRetention 경로로도(건수 로그) — 하루 뒤 d180 이 181일째가 되어 지워진다.
    const lines: string[] = [];
    const r = await runRetention(
      { store, erasure: new PrismaErasureStore(prisma), backup: { dir: '/nope', maxAgeDays: 7 }, log: (l) => lines.push(l), pruneBackups: async () => 0 },
      new Date(NOW.getTime() + DAY),
    );
    expect(r.vetReports).toBe(1);
    expect((await prisma.vetClinic.findMany({ orderBy: { id: 'asc' } })).map((x) => x.id)).toEqual(['b179', 'd179', 'rejected179', 'seed-blinded', 'seed-reported', 'verified-old']);
    expect(lines.at(-1)).toContain(' vetReports=1 ');
  });

  it('264 마이그레이션: 기존 USER_REPORT 행은 마이그레이션 시각으로 채워져 첫 정리에서 바로 지워지지 않는다, 시드 행은 빈 값', async () => {
    const sql = readFileSync(join(MIGRATIONS, '20261102000000_vet_report_created_at', 'migration.sql'), 'utf8');
    expect(statements(sql)).toEqual([
      `ALTER TABLE "VetClinic" ADD COLUMN "createdAt" TEXT NOT NULL DEFAULT ''`,
      `UPDATE "VetClinic" SET "createdAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE "source" = 'USER_REPORT'`,
      `CREATE INDEX "EventLog_receivedDate_idx" ON "EventLog"("receivedDate")`,
    ]);
    // 실제 적용: 이전 마이그레이션까지 → 옛 행 2개 → 264 마이그레이션.
    const dir = mkdtempSync(join(tmpdir(), 'ws-privacy-'));
    const prisma = new PrismaClient({ datasourceUrl: sqliteDatasourceUrl(`file:${join(dir, 'test.db').replace(/\\/g, '/')}`) });
    open.push({ dir, prisma });
    const names = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    for (const n of names.filter((x) => x < '20261102000000')) {
      for (const s of statements(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8'))) await prisma.$executeRawUnsafe(s);
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "VetClinic" ("id","name","region","address","phone","source","status") VALUES ('old-report','a','','b','02-123-4567','USER_REPORT','REPORTED'),('old-seed','c','r','d','02-123-4567','SEED','VERIFIED')`);
    const before = Date.now();
    for (const s of statements(sql)) await prisma.$executeRawUnsafe(s);
    const rows = await prisma.$queryRawUnsafe<{ id: string; createdAt: string }[]>(`SELECT "id","createdAt" FROM "VetClinic" ORDER BY "id"`);
    expect(rows.find((x) => x.id === 'old-seed')?.createdAt).toBe('');
    const at = rows.find((x) => x.id === 'old-report')?.createdAt ?? '';
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(at)).toBeGreaterThanOrEqual(before - 1000);
    expect(await new PrismaRetentionStore(prisma).deleteReportedVetsBefore(computeCutoffs(new Date()).vetReportIso)).toBe(0);
  });

  it('listUserActivity: lastSeenAt·스냅샷 updatedAt(세션 createdAt 은 근거 아님 — QA95 D-1)', async () => {
    const prisma = await freshDb();
    const id = await seedUser(prisma, 'a@example.com', iso(NOW.getTime() - 400 * DAY));
    await prisma.session.create({ data: { sidHash: 'z'.repeat(64), userId: id, createdAt: iso(NOW.getTime() - 3 * DAY), expiresAt: iso(NOW.getTime() + DAY) } });
    await prisma.saveSnapshot.update({ where: { userId: id }, data: { updatedAt: iso(NOW.getTime() - 5 * DAY) } });
    await prisma.user.update({ where: { id }, data: { lastSeenAt: iso(NOW.getTime() - 2 * DAY) } });
    const [u] = await new PrismaRetentionStore(prisma).listUserActivity();
    expect(u).toEqual({
      id, role: 'USER', createdAt: iso(NOW.getTime() - 400 * DAY), lastSnapshotAt: iso(NOW.getTime() - 5 * DAY), lastSeenAt: iso(NOW.getTime() - 2 * DAY),
    });
  });

  it("provider 'postgresql' 은 VACUUM 을 보내지 않는다", async () => {
    const prisma = await freshDb();
    const raw = vi.spyOn(prisma, '$executeRawUnsafe');
    await new PrismaRetentionStore(prisma, 'postgresql').vacuum();
    expect(raw).not.toHaveBeenCalled();
  });
});

// 153: 이메일은 표준 입력 한 줄(readInput) — 명령줄 인수는 전부 거부(sudo·journald·history 에 남지 않게).
describe('cli-erase (P7)', () => {
  it('표준 입력: 건수만 출력 + channel=OPERATOR, 이메일 출력 0, 정규화(대문자·공백)', async () => {
    const prisma = await freshDb();
    const id = await seedUser(prisma, 'a@example.com');
    const out: string[] = [];
    const err: string[] = [];
    const code = await runEraseCli([], {
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      readInput: async () => '  A@Example.COM \n',
      store: async () => new PrismaErasureStore(prisma),
    });
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out).toEqual([
      '[privacy] erase channel=OPERATOR',
      'privacy:erase — magicTokens 2, users 1, sessions 2, snapshots 1, badges 1, notifications 1, refreshTokens 1',
    ]);
    expect(out.join('\n')).not.toMatch(/@|example/i);
    expect(await rowsFor(prisma, 'a@example.com', id)).toMatchObject({ users: 0, tokens: 0 });
  });

  it('101 L-5: 삭제 커밋 뒤 실제 VACUUM 1회(트랜잭션 밖) — 파일 페이지에 이메일 원문 0 · VACUUM 실패면 종료 1(삭제는 유지)', async () => {
    const prisma = await freshDb();
    await seedUser(prisma, 'a@example.com');
    const raw = vi.spyOn(prisma, '$executeRawUnsafe');
    const io = { stdout: () => {}, stderr: () => {}, now: () => NOW, readInput: async () => 'a@example.com\n', store: async () => new PrismaErasureStore(prisma) };
    expect(await runEraseCli([], io)).toBe(0);
    expect(raw.mock.calls.map((a) => a[0])).toEqual(['VACUUM']);
    const dbFile = join(open.at(-1)!.dir, 'test.db');
    expect(readFileSync(dbFile).includes(Buffer.from('a@example.com'))).toBe(false);

    // VACUUM 실패: 삭제는 이미 커밋 — 종료 1 + 이름만 출력(값 0)
    await seedUser(prisma, 'b@example.com');
    raw.mockRejectedValueOnce(Object.assign(new Error('disk b@example.com'), { name: 'SqliteError' }));
    const err: string[] = [];
    const code = await runEraseCli([], { ...io, readInput: async () => 'b@example.com', stderr: (l: string) => err.push(l) });
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/삭제는 완료, VACUUM 실패\(SqliteError\)/);
    expect(err.join('\n')).not.toContain('@');
    expect(await prisma.user.count({ where: { email: 'b@example.com' } })).toBe(0);
    // compact 없는 저장소(인메모리 등)는 그냥 0
    const noCompact = { ...new PrismaErasureStore(prisma), eraseByEmail: async () => ({ ...ZERO }), eraseUser: async () => ({ ...ZERO }) } as never;
    expect(await runEraseCli([], { ...io, readInput: async () => 'c@example.com', store: async () => noCompact })).toBe(0);
  });

  // 159 LOW-3: 예약 도메인(example.org)만. 값의 어느 조각(로컬부·도메인)도 출력에 나오면 안 된다.
  const LEAK = /leak|example\.org|not-an-email/i;

  it('명령줄 인수는 무엇이든 거부 → 2, 표준 입력 읽지 않음, 저장소 연결 안 함, 값 출력 0', async () => {
    for (const argv of [['--email', 'leak1@example.org'], ['--email=leak1@example.org'], ['--help'], ['--other']]) {
      const out: string[] = [];
      const err: string[] = [];
      const store = vi.fn();
      const readInput = vi.fn(async () => 'leak2@example.org\n');
      const code = await runEraseCli(argv, { stdout: (l) => out.push(l), stderr: (l) => err.push(l), now: () => NOW, readInput, store });
      expect(code, argv.join(' ')).toBe(2);
      expect(readInput).not.toHaveBeenCalled();
      expect(store).not.toHaveBeenCalled();
      expect(out).toEqual([]);
      expect(err.join('\n')).not.toMatch(LEAK);
      expect(err.join('\n')).toContain('usage: privacy:erase (인수 없음 — 이메일은 표준 입력 한 줄)');
    }
    // --email 류는 '명령줄로 받지 않는다' 안내
    const err: string[] = [];
    await runEraseCli(['--email=leak1@example.org'], { stdout: () => {}, stderr: (l) => err.push(l), now: () => NOW, readInput: vi.fn(), store: vi.fn() });
    expect(err.join('\n')).toMatch(/이메일은 명령줄로 받지 않는다.*표준 입력/);
  });

  it('입력 오류(빈 입력·공백만·여러 줄·형식·읽기 실패) → 2, 저장소 연결 안 함, 값 출력 0', async () => {
    for (const input of ['', '   \n\n', 'leak1@example.org\nleak2@example.org\n', 'not-an-email', null]) {
      const out: string[] = [];
      const err: string[] = [];
      const store = vi.fn();
      const readInput = vi.fn(async () => input);
      const code = await runEraseCli([], { stdout: (l) => out.push(l), stderr: (l) => err.push(l), now: () => NOW, readInput, store });
      expect(code, JSON.stringify(input)).toBe(2);
      expect(readInput).toHaveBeenCalledTimes(1);
      expect(store).not.toHaveBeenCalled();
      expect(out).toEqual([]);
      expect(`${out.join('\n')}\n${err.join('\n')}`).not.toMatch(LEAK);
    }
  });

  it('159: 여러 줄(TTY 확인 불일치 포함) → 2, 안내 문구는 "여러 줄이거나 확인 입력이 다르다"', async () => {
    const err: string[] = [];
    const store = vi.fn();
    const code = await runEraseCli([], { stdout: () => {}, stderr: (l) => err.push(l), now: () => NOW, readInput: async () => 'leak1@example.org\nleak2@example.org', store });
    expect(code).toBe(2);
    expect(store).not.toHaveBeenCalled();
    expect(err[0]).toBe('privacy:erase: 한 번에 한 계정 — 입력이 여러 줄이거나 확인 입력이 다르다(값은 출력하지 않음)');
    expect(err.join('\n')).not.toMatch(LEAK);
  });

  it('eraseAccount 로그 줄은 채널만', async () => {
    const prisma = await freshDb();
    await seedUser(prisma, 'a@example.com');
    const lines: string[] = [];
    await eraseAccount(new PrismaErasureStore(prisma), { email: 'a@example.com' }, 'OPERATOR', NOW, (l) => lines.push(l));
    expect(lines).toEqual(['[privacy] erase channel=OPERATOR']);
  });
});
