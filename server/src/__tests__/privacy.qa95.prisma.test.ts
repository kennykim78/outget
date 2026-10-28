// QA95 D-1·D-2·D-3 실제 SQLite(prisma/migrations/*.sql 적용):
//   마이그레이션 = User.lastSeenAt 컬럼 1개 추가뿐 · touchLastSeen 하루 1회 쓰기 · QA95 재현(400일 전 가입·저장,
//   100일 전 새 기기 재연결·PUT 없음, 세션 10일 전 만료 → 정리 작업 이틀 연속에도 User 유지) · 정확히 365일 경계 ·
//   DELETE 뒤 실제 VACUUM(응답 뒤) · verify∥삭제 FK 경합 → 401(500 0).
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { makePrismaRepos, type Repos } from '../db/repos.js';
import { sqliteDatasourceUrl } from '../db/sqlite-url.js';
import { PrismaUserRepository } from '../auth/user.prisma.repo.js';
import type { UserRepository } from '../auth/user.repo.js';
import { PrismaRetentionStore } from '../privacy/retention.prisma.js';
import { runRetention } from '../privacy/retention.js';
import { UNUSED_USER_RETENTION_DAYS } from '../privacy/policy.js';
import { seoulDayStartIsoAt } from '../privacy/last-seen.js';
import type { MailMessage, MailTransport } from '../save/mail.js';
import { sampleSave } from './fixtures/save-sample.js';

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

vi.setConfig({ testTimeout: 120_000 });

const open: { dir: string; prisma: PrismaClient }[] = [];

async function freshDb(): Promise<PrismaClient> {
  const dir = mkdtempSync(join(tmpdir(), 'ws-qa95-'));
  // 운영(db/prisma.ts)과 같은 URL 보정 — SQLite 연결 1개. 없으면 2 vCPU(CI)에서 삭제 트랜잭션이 만료돼 DELETE 500(db/sqlite-url.ts).
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

class CaptureTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage): Promise<void> {
    this.sent.push(m);
  }
}

const ORIGIN = 'https://withsmall.test';
const EMAIL = 'qa95@example.com';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-25T03:00:00.000Z'); // 서울 2026-10-25 12:00
const iso = (ms: number) => new Date(ms).toISOString();
const quiet = () => {};

async function setup(over: (r: Repos, prisma: PrismaClient) => Partial<Repos> = () => ({})) {
  const prisma = await freshDb();
  const base = makePrismaRepos(prisma);
  const repos: Repos = { ...base, ...over(base, prisma) };
  const mail = new CaptureTransport();
  const clock = { t: NOW };
  const app = createApp(repos, {
    save: { config: { publicOrigin: ORIGIN, transport: mail, secureCookie: false }, now: () => new Date(clock.t) },
    rateLimits: false,
  });
  const reqToken = async (): Promise<string> => {
    await request(app).post('/auth/magic/request').send({ email: EMAIL, entry: 'direct' });
    return /#t=([A-Za-z0-9_-]+)/.exec(mail.sent[mail.sent.length - 1].text)![1];
  };
  const verify = (t: string) => request(app).post('/auth/magic/verify').send({ token: t });
  const cookieOf = (res: request.Response) =>
    ([] as string[]).concat((res.headers['set-cookie'] as unknown as string[]) ?? []).find((x) => x.startsWith('ws_sid='));
  const link = async () => cookieOf(await verify(await reqToken()))!.split(';')[0];
  const put = (c: string, b: string | null) => request(app).put('/api/save').set('Cookie', c).send({ snapshot: sampleSave(), baseUpdatedAt: b });
  const del = (c: string) => request(app).delete('/api/save').set('Cookie', c).send({ confirm: 'ERASE' });
  const retention = (at: number) =>
    runRetention(
      { store: new PrismaRetentionStore(prisma), erasure: base.erasure, backup: { dir: '/nope', maxAgeDays: 7 }, log: quiet, pruneBackups: async () => 0 },
      new Date(at),
    );
  return { prisma, base, app, clock, reqToken, verify, cookieOf, link, put, del, retention };
}

describe('D-1 마이그레이션', () => {
  it('user_last_seen 마이그레이션 = ALTER TABLE "User" ADD COLUMN "lastSeenAt" TEXT 1개뿐(기존 마이그레이션 불변)', () => {
    const dirs = readdirSync(MIGRATIONS).filter((n) => n.endsWith('_user_last_seen'));
    expect(dirs).toHaveLength(1);
    const sql = statements(readFileSync(join(MIGRATIONS, dirs[0], 'migration.sql'), 'utf8'));
    expect(sql).toEqual(['ALTER TABLE "User" ADD COLUMN "lastSeenAt" TEXT']);
    // 배포 순서: privacy_tombstone 뒤, 101 MED-2 tombstone_retain_until 앞.
    const all = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const at = all.indexOf(dirs[0]);
    expect(all[at - 1]).toMatch(/_privacy_tombstone$/);
    expect(all[at + 1]).toMatch(/_tombstone_retain_until$/);
  });

  it('옛 행(lastSeenAt 없음)은 null', async () => {
    const prisma = await freshDb();
    await prisma.user.create({ data: { id: 'u1', email: 'a@x.co', createdAt: iso(NOW) } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } })).lastSeenAt).toBeNull();
  });
});

describe('D-1 PrismaUserRepository.touchLastSeen — 하루 1회 쓰기', () => {
  it('null → 기록 · 같은 서울 날짜 → 쓰기 0(값 불변·false) · 서울 자정 넘김 → 1회 · 없는 사용자 false', async () => {
    const prisma = await freshDb();
    const users = new PrismaUserRepository(prisma);
    await prisma.user.create({ data: { id: 'u1', email: 'a@x.co', createdAt: iso(NOW - 10 * DAY) } });
    const seen = async () => (await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } })).lastSeenAt;
    expect(await users.touchLastSeen('u1', new Date(NOW))).toBe(true);
    const day = '2026-10-24T15:00:00.000Z'; // 101 L-3: 서울 10-25 00:00 — 날짜만 저장(접속 시각 12:00 은 남기지 않음)
    expect(await seen()).toBe(day);
    expect(await users.touchLastSeen('u1', new Date(NOW + 3 * 60 * 60 * 1000))).toBe(false);
    expect(await seen()).toBe(day); // 같은 날 = 쓰기 0
    const midnight = Date.parse('2026-10-25T15:00:00.000Z'); // 서울 10-26 00:00
    expect(await users.touchLastSeen('u1', new Date(midnight - 1))).toBe(false);
    expect(await seen()).toBe(day);
    expect(await users.touchLastSeen('u1', new Date(midnight))).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } })).lastSeenAt).toBe(iso(midnight));
    expect(await users.touchLastSeen('ghost', new Date(NOW))).toBe(false);
  });

  it('동시 touch 두 개(같은 날 첫 방문) → 실제 갱신 1건', async () => {
    const prisma = await freshDb();
    const users = new PrismaUserRepository(prisma);
    await prisma.user.create({ data: { id: 'u1', email: 'a@x.co', createdAt: iso(NOW - 10 * DAY), lastSeenAt: iso(NOW - 2 * DAY) } });
    const r = await Promise.all([users.touchLastSeen('u1', new Date(NOW)), users.touchLastSeen('u1', new Date(NOW + 1))]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });
});

describe('D-1 QA95 재현 — 마지막 사용(새 기기 재연결) 기준 365일', () => {
  /** 400일 전 가입·저장 → 100일 전 새 기기 재연결(verify 만, PUT 없음) → 그 세션 90일 뒤 = 10일 전 만료. */
  async function scenario() {
    const s = await setup();
    s.clock.t = NOW - 400 * DAY;
    const a = await s.link();
    expect((await s.put(a, null)).status).toBe(200);
    // PrismaUserRepository.upsertByEmail 의 createdAt 은 벽시계 — 시나리오 시각으로 맞춘다.
    await s.prisma.user.updateMany({ data: { createdAt: iso(NOW - 400 * DAY) } });
    s.clock.t = NOW - 100 * DAY;
    await s.link(); // 새 기기, PUT 없음
    const u = await s.prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, include: { saveSnapshot: true, sessions: true } });
    expect(u.lastSeenAt).toBe(seoulDayStartIsoAt(new Date(NOW - 100 * DAY))); // 101 L-3: 날짜 단위
    expect(u.saveSnapshot!.updatedAt).toBe(iso(NOW - 400 * DAY));
    expect(u.sessions.map((x) => x.expiresAt).sort().at(-1)).toBe(iso(NOW - 10 * DAY));
    return s;
  }

  it('정리 작업을 오늘·내일 이틀 연속 실행해도 User·스냅샷 유지(세션은 정리됨)', async () => {
    const s = await scenario();
    const r1 = await s.retention(NOW);
    expect(r1.users).toBe(0);
    expect(await s.prisma.session.count()).toBe(0); // 만료 세션은 정리 — 활동 근거가 아니다
    const r2 = await s.retention(NOW + DAY);
    expect(r2.users).toBe(0);
    expect(await s.prisma.user.count({ where: { email: EMAIL } })).toBe(1);
    expect(await s.prisma.saveSnapshot.count()).toBe(1);
  });

  it('정확히 365일(마지막 사용 날짜 00:00 + 365일) = 유지, +1ms = 삭제', async () => {
    const s = await scenario();
    // 101 L-3: 근거 = 마지막 사용 서울 날짜 00:00. 실제 사용 시각과의 차이는 하루 미만(앞당길 뿐) — 저장값이 '그날 첫 사용 시각'이던
    //   이전 규칙과 같은 오차 한계(last-seen.ts 주석). 여기 사용 시각은 서울 12:00 이라 경계가 12시간 앞선다.
    const lastSeen = Date.parse(seoulDayStartIsoAt(new Date(NOW - 100 * DAY)));
    expect(NOW - 100 * DAY - lastSeen).toBe(12 * 60 * 60 * 1000);
    expect(UNUSED_USER_RETENTION_DAYS).toBe(365);
    expect((await s.retention(lastSeen + 365 * DAY)).users).toBe(0);
    expect(await s.prisma.user.count()).toBe(1);
    expect((await s.retention(lastSeen + 365 * DAY + 1)).users).toBe(1);
    expect(await s.prisma.user.count()).toBe(0);
    expect(await s.prisma.saveSnapshot.count()).toBe(0);
  });

  it('GET 만 하는 사용자(하루 1회 갱신)도 유지', async () => {
    const s = await setup();
    s.clock.t = NOW - 400 * DAY;
    const a = await s.link();
    await s.prisma.user.updateMany({ data: { createdAt: iso(NOW - 400 * DAY) } });
    s.clock.t = NOW - 320 * DAY; // 세션(90일, -310 만료) 안
    expect((await request(s.app).get('/api/save').set('Cookie', a)).status).toBe(200);
    // 세션은 이미 만료 — 이 사용자의 마지막 사용은 320일 전 GET
    expect((await s.retention(NOW)).users).toBe(0);
    expect((await s.prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).lastSeenAt).toBe(seoulDayStartIsoAt(new Date(NOW - 320 * DAY)));
  });
});

describe('D-2 DELETE /api/save → 응답 뒤 실제 VACUUM', () => {
  it('204 finish 다음에 VACUUM 1회(합치기는 privacy.last-seen.test 스케줄러)', async () => {
    const s = await setup();
    const events: string[] = [];
    const raw = vi.spyOn(s.prisma, '$executeRawUnsafe').mockImplementation(async (q: string) => {
      events.push(`raw:${q}`);
      return 0;
    });
    const server = createServer((req, res) => {
      res.on('finish', () => events.push(`finish:${req.method}:${res.statusCode}`));
      s.app(req, res);
    });
    const c = await s.link();
    events.length = 0;
    expect((await request(server).delete('/api/save').set('Cookie', c).send({ confirm: 'ERASE' })).status).toBe(204);
    await vi.waitFor(() => expect(events).toContain('raw:VACUUM'));
    expect(events).toEqual(['finish:DELETE:204', 'raw:VACUUM']);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(await s.prisma.user.count()).toBe(0);
    // 대조군: VACUUM 을 막으면 삭제 페이지에 이메일 원문이 남는다(다음 테스트가 실제로 무엇을 지우는지 증명).
    expect(readFileSync(join(open.at(-1)!.dir, 'test.db')).includes(Buffer.from(EMAIL))).toBe(true);
  });

  it('실제 VACUUM 실행(모의 없음): 삭제 뒤 파일 페이지에서 이메일 원문 0', async () => {
    const s = await setup();
    const c = await s.link();
    expect((await s.put(c, null)).status).toBe(200);
    const vac = vi.spyOn(s.prisma, '$executeRawUnsafe');
    expect((await s.del(c)).status).toBe(204);
    await vi.waitFor(() => expect(vac).toHaveBeenCalledWith('VACUUM'));
    await vi.waitFor(() => expect(vac.mock.results[0]?.type).toBe('return'));
    await vac.mock.results[0].value; // VACUUM 완료 대기(reject 면 여기서 실패)
    const file = open.at(-1)!.dir;
    const bytes = readFileSync(join(file, 'test.db'));
    expect(bytes.includes(Buffer.from(EMAIL))).toBe(false);
  });
});

describe('D-3 verify ∥ 삭제 경합 (실제 SQLite FK)', () => {
  it('결정적: upsert 직후 같은 이메일 삭제 → 세션 insert P2003 → 401 invalid_token, 쿠키 0, 고아 0', async () => {
    let erase: (() => Promise<unknown>) | null = null;
    const s = await setup((b) => {
      const inner = b.user;
      const user: UserRepository = {
        create: (...a) => inner.create(...a),
        findByEmail: (...a) => inner.findByEmail(...a),
        findById: (...a) => inner.findById(...a),
        touchLastSeen: (...a) => inner.touchLastSeen(...a),
        upsertByEmail: async (e) => {
          const u = await inner.upsertByEmail(e);
          if (erase) await erase();
          return u;
        },
      };
      return { user };
    });
    const token = await s.reqToken();
    erase = () => s.base.erasure.eraseByEmail(EMAIL, iso(NOW));
    const r = await s.verify(token);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'invalid_token' });
    expect(s.cookieOf(r)).toBeUndefined();
    expect(await s.prisma.user.count()).toBe(0);
    expect(await s.prisma.session.count()).toBe(0);
  });

  it('동시: 삭제 ∥ verify(삭제 전 발급) ∥ 다른 기기 PUT — 10회(QA95_RACE_N), 500 0 · 고아 0', async () => {
    const tally: Record<string, number> = {};
    const n = Number(process.env.QA95_RACE_N ?? 10);
    for (let i = 0; i < n; i++) {
      const s = await setup();
      s.clock.t = Date.now();
      const a = await s.link();
      const b = await s.link();
      const p0 = await s.put(b, null);
      const pre = await s.reqToken();
      const [d, v, p] = await Promise.all([s.del(a), s.verify(pre), s.put(b, p0.body.updatedAt)]);
      const key = `del=${d.status} verify=${v.status} put=${p.status}`;
      tally[key] = (tally[key] ?? 0) + 1;
      expect(d.status).toBe(204);
      expect([200, 401]).toContain(v.status);
      expect([200, 401, 409]).toContain(p.status);
      if (v.status === 401) expect(v.body).toEqual({ error: 'invalid_token' });
      const ids = (await s.prisma.user.findMany()).map((u) => u.id);
      expect(await s.prisma.session.count({ where: { userId: { notIn: ids } } })).toBe(0);
      expect(await s.prisma.saveSnapshot.count()).toBe(0);
    }
    console.log('[qa95-race] tally', JSON.stringify(tally));
    expect(Object.keys(tally).some((k) => k.includes('=500'))).toBe(false);
  });
});
