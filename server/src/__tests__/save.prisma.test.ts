// B1-2 Prisma 저장소(실제 SQLite) — prisma/migrations/*.sql 을 임시 DB 에 적용해 r5_save 마이그레이션까지 검증한다.
//   1회용 소비·15분 경계·세션 만료/폐기·스냅샷 upsert, DB 행에 원문 토큰·세션 id 0, User passwordHash null 허용.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { sqliteDatasourceUrl } from '../db/sqlite-url.js';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaUserRepository } from '../auth/user.prisma.repo.js';
import { randomOpaque, sha256Hex } from '../save/crypto.js';
import {
  PrismaMagicTokenRepository,
  PrismaSaveSnapshotRepository,
  PrismaSessionRepository,
} from '../save/save.prisma.repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '..', '..', 'prisma', 'migrations');

let dir: string;
let prisma: PrismaClient;

function statements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ws-save-prisma-'));
  const url = `file:${join(dir, 'test.db').replace(/\\/g, '/')}`;
  prisma = new PrismaClient({ datasourceUrl: sqliteDatasourceUrl(url) });
  const names = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  expect(names.some((n) => n.endsWith('_r5_save'))).toBe(true);
  for (const n of names) {
    for (const s of statements(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8'))) {
      await prisma.$executeRawUnsafe(s);
    }
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.parse('2026-10-03T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('Prisma 저장소(r5_save)', () => {
  it('User.upsertByEmail: passwordHash null·USER, 기존 사용자 불변', async () => {
    const users = new PrismaUserRepository(prisma);
    const u = await users.upsertByEmail('kenny@example.com');
    expect(u).toMatchObject({ email: 'kenny@example.com', role: 'USER', passwordHash: null });
    await users.create('op@example.com', 'h', 'OPERATOR');
    expect(await users.upsertByEmail('op@example.com')).toMatchObject({ role: 'OPERATOR', passwordHash: 'h' });
    expect((await users.upsertByEmail('kenny@example.com')).id).toBe(u.id);
  });

  it('MagicLinkToken: 1회용·15분 경계, 행에 원문 토큰 0', async () => {
    const repo = new PrismaMagicTokenRepository(prisma);
    const token = randomOpaque();
    const h = sha256Hex(token);
    await repo.insert({ tokenHash: h, email: 'a@b.co', createdAt: iso(T0), expiresAt: iso(T0 + 15 * 60_000), consumedAt: null });
    expect(await repo.consume(h, iso(T0 + 15 * 60_000))).toBeNull(); // 15:00 = 만료
    expect(await repo.consume(h, iso(T0 + 15 * 60_000 - 1000))).toBe('a@b.co'); // 14:59
    expect(await repo.consume(h, iso(T0 + 1000))).toBeNull(); // 재사용
    const rows = await prisma.magicLinkToken.findMany();
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('MagicLinkToken: 동시 소비는 정확히 1건만 성공', async () => {
    const repo = new PrismaMagicTokenRepository(prisma);
    const h = sha256Hex(randomOpaque());
    await repo.insert({ tokenHash: h, email: 'c@d.co', createdAt: iso(T0), expiresAt: iso(T0 + 15 * 60_000), consumedAt: null });
    const results = await Promise.all([1, 2, 3, 4].map(() => repo.consume(h, iso(T0 + 1000))));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('Session: 활성·만료·폐기, 행에 원문 sid 0', async () => {
    const users = new PrismaUserRepository(prisma);
    const u = await users.upsertByEmail('s@example.com');
    const repo = new PrismaSessionRepository(prisma);
    const sid = randomOpaque();
    const h = sha256Hex(sid);
    await repo.insert({ sidHash: h, userId: u.id, createdAt: iso(T0), expiresAt: iso(T0 + 1000), revokedAt: null });
    expect(await repo.findActiveUserId(h, iso(T0))).toBe(u.id);
    expect(await repo.findActiveUserId(h, iso(T0 + 1000))).toBeNull();
    await repo.revoke(h, iso(T0));
    expect(await repo.findActiveUserId(h, iso(T0 + 1))).toBeNull();
    expect(JSON.stringify(await prisma.session.findMany())).not.toContain(sid);
  });

  it('SaveSnapshot: upsert 덮어쓰기, 사용자 삭제 시 함께 삭제(Cascade)', async () => {
    const users = new PrismaUserRepository(prisma);
    const u = await users.upsertByEmail('snap@example.com');
    const repo = new PrismaSaveSnapshotRepository(prisma);
    expect(await repo.get(u.id)).toBeNull();
    await repo.put({ userId: u.id, v: 1, payload: '{"v":1}', updatedAt: iso(T0) });
    await repo.put({ userId: u.id, v: 1, payload: '{"v":1,"x":2}', updatedAt: iso(T0 + 1) });
    expect(await repo.get(u.id)).toEqual({ userId: u.id, v: 1, payload: '{"v":1,"x":2}', updatedAt: iso(T0 + 1) });
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys=ON');
    await prisma.user.delete({ where: { id: u.id } });
    expect(await repo.get(u.id)).toBeNull();
  });

  it('SaveSnapshot putIfMatch(H1): 행 없음=null 기준만 생성, 기준 일치만 갱신, 불일치 → 지금 행, 동시 둘 중 하나만', async () => {
    const users = new PrismaUserRepository(prisma);
    const u = await users.upsertByEmail('cas@example.com');
    const repo = new PrismaSaveSnapshotRepository(prisma);
    const row = (p: string, t: number) => ({ userId: u.id, v: 1, payload: p, updatedAt: iso(t) });
    // 행 없음인데 기준 시각을 주면 경합(삭제된 행) → current null
    expect(await repo.putIfMatch(row('{"v":1,"a":0}', T0), iso(T0 - 1))).toEqual({ ok: false, current: null });
    expect(await repo.putIfMatch(row('{"v":1,"a":1}', T0), null)).toEqual({ ok: true });
    // 이미 있는데 null 기준(두 번째 기기의 첫 PUT) → 경합 + 지금 행
    expect(await repo.putIfMatch(row('{"v":1,"a":2}', T0 + 1), null)).toEqual({ ok: false, current: row('{"v":1,"a":1}', T0) });
    // 옛 기준 → 경합, 바른 기준 → 갱신
    expect((await repo.putIfMatch(row('{"v":1,"a":3}', T0 + 2), iso(T0 - 5))).ok).toBe(false);
    expect(await repo.putIfMatch(row('{"v":1,"a":4}', T0 + 3), iso(T0))).toEqual({ ok: true });
    expect(await repo.get(u.id)).toEqual(row('{"v":1,"a":4}', T0 + 3));
    // 같은 기준으로 동시 두 요청 → 정확히 하나만
    const rs = await Promise.all([repo.putIfMatch(row('{"v":1,"a":5}', T0 + 4), iso(T0 + 3)), repo.putIfMatch(row('{"v":1,"a":6}', T0 + 5), iso(T0 + 3))]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe('R6 C2 Prisma 정리·상한(InMemory 와 동일 행위)', () => {
  it('MagicLinkToken.deleteExpired: expiresAt ≤ cutoff 만 삭제(경계 포함, 소비 여부 무관)', async () => {
    const repo = new PrismaMagicTokenRepository(prisma);
    await prisma.magicLinkToken.deleteMany();
    const row = (h: string, exp: number, consumed: number | null = null) => ({
      tokenHash: sha256Hex(h),
      email: `${h}@x.co`,
      createdAt: iso(T0 - 60_000),
      expiresAt: iso(exp),
      consumedAt: consumed === null ? null : iso(consumed),
    });
    await repo.insert(row('old', T0 - 1));
    await repo.insert(row('edge', T0));
    await repo.insert(row('live', T0 + 1));
    await repo.insert(row('used', T0 + 60_000, T0 - 10));
    expect(await repo.deleteExpired(iso(T0))).toBe(2);
    expect((await prisma.magicLinkToken.findMany()).map((r) => r.email).sort()).toEqual(['live@x.co', 'used@x.co']);
  });

  it('Session.enforceCap: keep 제외 최신 max-1 개만 남기고 폐기, 다른 사용자·비활성 무관', async () => {
    const users = new PrismaUserRepository(prisma);
    const u = await users.upsertByEmail('cap@example.com');
    const o = await users.upsertByEmail('cap-other@example.com');
    const repo = new PrismaSessionRepository(prisma);
    const far = iso(T0 + 3600_000);
    const ins = (sid: string, userId: string, created: number, revoked: string | null = null, exp = far) =>
      repo.insert({ sidHash: sha256Hex(sid), userId, createdAt: iso(created), expiresAt: exp, revokedAt: revoked });
    for (let i = 0; i < 5; i++) await ins(`c${i}`, u.id, T0 - (10 - i) * 1000); // c4 가 최신
    await ins('dead', u.id, T0 - 99_000, iso(T0 - 5));
    await ins('expd', u.id, T0 - 99_000, null, iso(T0));
    await ins('oth', o.id, T0 - 99_000);
    await ins('keep', u.id, T0 - 99_999); // keep 은 createdAt 이 가장 오래돼도 폐기 안 됨
    expect(await repo.enforceCap(u.id, sha256Hex('keep'), 3, iso(T0))).toBe(3);
    const active = async (sid: string) => (await repo.findActiveUserId(sha256Hex(sid), iso(T0))) !== null;
    expect(await active('keep')).toBe(true);
    expect(await active('c4')).toBe(true);
    expect(await active('c3')).toBe(true);
    for (const s of ['c0', 'c1', 'c2']) expect(await active(s)).toBe(false);
    expect(await active('oth')).toBe(true);
    // 폐기된 행의 revokedAt 은 덮어쓰지 않는다(이미 폐기된 dead 는 원래 값 유지)
    const dead = await prisma.session.findUnique({ where: { sidHash: sha256Hex('dead') } });
    expect(dead?.revokedAt).toBe(iso(T0 - 5));
    // 상한 이하 → 0
    expect(await repo.enforceCap(u.id, sha256Hex('keep'), 3, iso(T0))).toBe(0);
  });

  it('Session.enforceCap: 같은 createdAt 은 sidHash 사전순 앞쪽을 남긴다(InMemory 와 같은 순서)', async () => {
    const users = new PrismaUserRepository(prisma);
    const u = await users.upsertByEmail('tie@example.com');
    const repo = new PrismaSessionRepository(prisma);
    const names = ['t1', 't2', 't3'];
    for (const n of names) await repo.insert({ sidHash: sha256Hex(n), userId: u.id, createdAt: iso(T0), expiresAt: iso(T0 + 3600_000), revokedAt: null });
    await repo.insert({ sidHash: sha256Hex('tk'), userId: u.id, createdAt: iso(T0), expiresAt: iso(T0 + 3600_000), revokedAt: null });
    expect(await repo.enforceCap(u.id, sha256Hex('tk'), 2, iso(T0))).toBe(2);
    const survivor = names.map((n) => sha256Hex(n)).sort()[0];
    const rows = await prisma.session.findMany({ where: { userId: u.id, revokedAt: null } });
    expect(rows.map((r) => r.sidHash).sort()).toEqual([survivor, sha256Hex('tk')].sort());
  });

  it('Session.deleteInactive: 만료(≤cutoff)·폐기(≤cutoff) 행만 삭제', async () => {
    const users = new PrismaUserRepository(prisma);
    const u = await users.upsertByEmail('gc@example.com');
    const repo = new PrismaSessionRepository(prisma);
    await prisma.session.deleteMany();
    const ins = (sid: string, exp: number, revoked: number | null) =>
      repo.insert({ sidHash: sha256Hex(sid), userId: u.id, createdAt: iso(T0 - 9000), expiresAt: iso(exp), revokedAt: revoked === null ? null : iso(revoked) });
    await ins('exp', T0, null);
    await ins('rev', T0 + 3600_000, T0);
    await ins('revLater', T0 + 3600_000, T0 + 1);
    await ins('live', T0 + 1, null);
    expect(await repo.deleteInactive(iso(T0))).toBe(2);
    expect((await prisma.session.findMany()).map((r) => r.sidHash).sort()).toEqual([sha256Hex('live'), sha256Hex('revLater')].sort());
  });
});
