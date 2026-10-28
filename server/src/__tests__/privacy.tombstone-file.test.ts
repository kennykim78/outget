// be-tomb: 묘비 파일(백업 폴더 밖) — 전체 백업 복원 후에도 지운 계정이 되살아나지 않게.
//   실제 SQLite 파일(prisma/migrations 적용)로 "묘비 있는 DB → 묘비 없는 옛 DB 파일로 덮어쓰기 → 파일만으로 재적용" 을 재현.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { sqliteDatasourceUrl } from '../db/sqlite-url.js';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../save/crypto.js';
import { PrismaErasureStore } from '../privacy/erase.prisma.js';
import { eraseAccount, mergeTombstones, tombstoneKey, type ErasureStore } from '../privacy/erase.js';
import { PrismaRetentionStore } from '../privacy/retention.prisma.js';
import { computeCutoffs, runRetention } from '../privacy/retention.js';
import { DEFAULT_ERASURE_FILE, TOMBSTONE_RETENTION_DAYS } from '../privacy/policy.js';
import {
  FileBackedErasureStore,
  TombstoneFile,
  badLinesLogLine,
  isSameOrInside,
  parseTombstoneLines,
  realpathLoose,
  resolveErasureFile,
  withTombstoneFile,
} from '../privacy/tombstone-file.js';

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

vi.setConfig({ testTimeout: 30_000 });

const dirs: string[] = [];
const clients: PrismaClient[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ws-tomb-'));
  dirs.push(d);
  return d;
}

function connect(dbFile: string): PrismaClient {
  const c = new PrismaClient({ datasourceUrl: sqliteDatasourceUrl(`file:${dbFile.replace(/\\/g, '/')}`) });
  clients.push(c);
  return c;
}

async function migrate(prisma: PrismaClient): Promise<void> {
  const names = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const n of names) {
    for (const s of statements(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8'))) await prisma.$executeRawUnsafe(s);
  }
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.$disconnect();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const NOW = new Date('2026-10-25T03:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

async function seedUser(prisma: PrismaClient, email: string, createdAt: string): Promise<string> {
  const id = `usr-${sha256Hex(email).slice(0, 8)}`;
  await prisma.user.create({ data: { id, email, role: 'USER', createdAt } });
  await prisma.session.create({ data: { sidHash: sha256Hex(`s${email}`), userId: id, createdAt, expiresAt: iso(NOW.getTime() + DAY) } });
  await prisma.saveSnapshot.create({ data: { userId: id, v: 1, payload: '{}', updatedAt: createdAt } });
  return id;
}

function fileStore(prisma: PrismaClient, path: string, log: (l: string) => void = () => {}): FileBackedErasureStore {
  return withTombstoneFile(
    new PrismaErasureStore(prisma),
    path,
    async (id) => (await prisma.user.findUnique({ where: { id }, select: { email: true } }))?.email ?? null,
    log,
  );
}

describe('백업 복원 시나리오', () => {
  it('묘비 있는 DB → 묘비 없는 옛 백업 DB 로 덮어쓰기 → 파일 묘비만으로 재적용 → User 0 (삭제 후 새 연결 계정은 유지)', async () => {
    const d = tmp();
    const prod = join(d, 'prod.db');
    const backupDir = join(d, 'backup');
    const erasures = resolveErasureFile({ WS_ERASURE_FILE: join(d, 'erasures.jsonl') }, backupDir);

    // 1) 운영 DB: 사용자 2명 → 백업(엔트리포인트의 cp 와 같음)
    let prisma = connect(prod);
    await migrate(prisma);
    const goneId = await seedUser(prisma, 'gone@example.com', iso(NOW.getTime() - 30 * DAY));
    await seedUser(prisma, 'keep@example.com', iso(NOW.getTime() - 30 * DAY));
    await prisma.$disconnect();
    mkdirSync(backupDir);
    const backupFile = join(backupDir, 'prod-20261024T000000Z.db');
    copyFileSync(prod, backupFile);

    // 2) 삭제(SELF) — DB 묘비 + 파일 묘비
    prisma = connect(prod);
    const lines: string[] = [];
    expect((await eraseAccount(fileStore(prisma, erasures), { userId: goneId }, 'SELF', NOW, (l) => lines.push(l))).users).toBe(1);
    expect(await prisma.erasureTombstone.count()).toBe(1);
    expect(await prisma.user.count({ where: { email: 'gone@example.com' } })).toBe(0);
    const text = readFileSync(erasures, 'utf8');
    expect(text).toBe(
      `${JSON.stringify({ emailSha256: tombstoneKey('gone@example.com'), erasedAt: NOW.toISOString(), retainUntil: iso(NOW.getTime() + 7 * DAY) })}\n`,
    );
    expect(text).not.toContain('gone'); // 이메일 원문 0
    expect(text).not.toContain('@');
    if (process.platform !== 'win32') expect(statSync(erasures).mode & 0o777).toBe(0o600);
    await prisma.$disconnect();

    // 3) 전체 백업 복원: prod.db 를 옛 백업으로 덮어씀 → 묘비 테이블도 비어 있고 gone 이 되살아남
    copyFileSync(backupFile, prod);
    prisma = connect(prod);
    // 복원 뒤, 삭제 이후 같은 이메일로 새로 연결한 계정이 있었다면(createdAt ≥ erasedAt) 유지돼야 한다 — 다른 이메일로 확인
    await seedUser(prisma, 'relinked@example.com', iso(NOW.getTime() + DAY));
    expect(await prisma.erasureTombstone.count()).toBe(0);
    expect(await prisma.user.count({ where: { email: 'gone@example.com' } })).toBe(1);

    // DB 묘비만 보는 기존 저장소는 못 지운다(회귀 증명)
    expect(await new PrismaErasureStore(prisma).reapplyTombstones()).toBe(0);
    // 파일 묘비 합집합 재적용
    expect(await fileStore(prisma, erasures).reapplyTombstones()).toBe(1);
    expect(await prisma.user.count({ where: { email: 'gone@example.com' } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: goneId } })).toBe(0);
    expect(await prisma.saveSnapshot.count({ where: { userId: goneId } })).toBe(0);
    expect(await prisma.user.count({ where: { email: 'keep@example.com' } })).toBe(1);
    expect(await prisma.user.count({ where: { email: 'relinked@example.com' } })).toBe(1);
    // 101 MED-2: 실제 재삭제 → 연장 줄 1개 append(erasedAt 원래 값) + 복원으로 사라진 DB 묘비 복구 · 멱등(다시 해도 쓰기 0)
    const after = readFileSync(erasures, 'utf8');
    expect(after.startsWith(text)).toBe(true);
    const ext = parseTombstoneLines(after.slice(text.length));
    expect(ext.rows).toHaveLength(1);
    expect(ext.rows[0].erasedAt).toBe(NOW.toISOString());
    expect(ext.rows[0].retainUntil >= iso(NOW.getTime() + 7 * DAY)).toBe(true);
    expect((await prisma.erasureTombstone.findMany()).map((t) => t.erasedAt)).toEqual([NOW.toISOString()]);
    expect(await fileStore(prisma, erasures).reapplyTombstones()).toBe(0);
    expect(readFileSync(erasures, 'utf8')).toBe(after);
  });

  it('파일 묘비 이후에 만들어진 같은 이메일 계정(createdAt ≥ erasedAt)은 지우지 않는다', async () => {
    const d = tmp();
    const prisma = connect(join(d, 'p.db'));
    await migrate(prisma);
    const path = join(d, 'e.jsonl');
    await new TombstoneFile(path).append({ emailSha256: tombstoneKey('a@example.com'), erasedAt: NOW.toISOString() });
    await seedUser(prisma, 'a@example.com', NOW.toISOString()); // 같은 시각 = 묘비 이후로 본다
    expect(await fileStore(prisma, path).reapplyTombstones()).toBe(0);
    expect(await prisma.user.count()).toBe(1);
  });

  it('파일 기록 실패면 DB 삭제도 하지 않는다(throw, 재시도 가능)', async () => {
    const d = tmp();
    const prisma = connect(join(d, 'p.db'));
    await migrate(prisma);
    await seedUser(prisma, 'a@example.com', iso(NOW.getTime() - DAY));
    // 경로가 디렉터리 → open 실패
    const store = fileStore(prisma, d);
    await expect(store.eraseByEmail('a@example.com', NOW.toISOString())).rejects.toBeTruthy();
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.erasureTombstone.count()).toBe(0);
  });

  it('없는 userId 는 파일에도 기록 안 함 · tombstone:false(재적용 경로)도 기록 안 함', async () => {
    const d = tmp();
    const prisma = connect(join(d, 'p.db'));
    await migrate(prisma);
    const path = join(d, 'e.jsonl');
    const store = fileStore(prisma, path);
    expect((await store.eraseUser('usr-none', NOW.toISOString())).users).toBe(0);
    await store.eraseByEmail('x@example.com', NOW.toISOString(), { tombstone: false });
    expect(() => statSync(path)).toThrow();
  });
});

describe('101 MED-2 복원 연쇄(retainUntil 연장)', () => {
  it('삭제 → 6일 뒤 옛 백업 복원 → 기동(재적용 전 새 백업) → 재적용 연장 → 삭제 7일 뒤에도 묘비 유지 → 그 새 백업 복원해도 재삭제', async () => {
    const d = tmp();
    const prod = join(d, 'prod.db');
    const backupDir = join(d, 'backup');
    const erasures = resolveErasureFile({ WS_ERASURE_FILE: join(d, 'erasures.jsonl') }, backupDir);
    const T0 = NOW.getTime();
    const T1 = T0 + 6 * DAY; // 옛 백업 복원 + 기동
    const T2 = T0 + 7 * DAY + 60 * 60 * 1000; // 원래 묘비 기한(T0+7일) 지난 정리
    const T3 = T0 + 12 * DAY; // 기동 때 만든 새 백업 복원(그 백업은 T1+7일까지 남는다)
    const retention = (prisma: PrismaClient, at: number) =>
      runRetention(
        { store: new PrismaRetentionStore(prisma), erasure: fileStore(prisma, erasures), backup: { dir: backupDir, maxAgeDays: 7 }, log: () => {}, pruneBackups: async () => 0 },
        new Date(at),
      );
    const goneCount = (prisma: PrismaClient) => prisma.user.count({ where: { email: 'gone@example.com' } });

    // 0) 운영 DB + 삭제 전날 백업(그 User 포함)
    let prisma = connect(prod);
    await migrate(prisma);
    const goneId = await seedUser(prisma, 'gone@example.com', iso(T0 - 30 * DAY));
    await seedUser(prisma, 'keep@example.com', iso(T0 - 30 * DAY));
    await prisma.$disconnect();
    mkdirSync(backupDir);
    const oldBackup = join(backupDir, 'prod-20261024T000000Z.db');
    copyFileSync(prod, oldBackup);

    // 1) T0 삭제(SELF): retainUntil = T0+7일(DB·파일)
    prisma = connect(prod);
    expect((await eraseAccount(fileStore(prisma, erasures), { userId: goneId }, 'SELF', new Date(T0), () => {})).users).toBe(1);
    expect((await prisma.erasureTombstone.findMany()).map((t) => t.retainUntil)).toEqual([iso(T0 + 7 * DAY)]);
    await prisma.$disconnect();

    // 2) T1 옛 백업 복원 → 엔트리포인트가 재적용 전에 새 백업(그 User 포함) 생성 → 기동 재적용
    copyFileSync(oldBackup, prod);
    const newBackup = join(backupDir, 'prod-20261031T030000Z.db');
    copyFileSync(prod, newBackup);
    prisma = connect(prod);
    expect(await goneCount(prisma)).toBe(1);
    expect(await fileStore(prisma, erasures).reapplyTombstones([], { now: new Date(T1) })).toBe(1);
    expect(await goneCount(prisma)).toBe(0);
    // 연장: DB(복원으로 사라졌던 묘비 복구)·파일 모두 retainUntil = T1+7일, erasedAt 은 원래 T0
    expect((await prisma.erasureTombstone.findMany()).map((t) => [t.erasedAt, t.retainUntil])).toEqual([[iso(T0), iso(T1 + 7 * DAY)]]);
    expect(
      mergeTombstones(parseTombstoneLines(readFileSync(erasures, 'utf8')).rows).map((t) => [t.erasedAt, t.retainUntil]),
    ).toEqual([[iso(T0), iso(T1 + 7 * DAY)]]);

    // 3) T2(원래 기한 T0+7일 경과) 정리 — 묘비 유지(파일은 옛 줄만 빠지고 연장 줄 남음)
    const r2 = await retention(prisma, T2);
    expect(r2.tombstones).toBe(1); // 파일의 원래 줄 1개만
    expect(await prisma.erasureTombstone.count()).toBe(1);
    expect(parseTombstoneLines(readFileSync(erasures, 'utf8')).rows.map((t) => t.retainUntil)).toEqual([iso(T1 + 7 * DAY)]);
    await prisma.$disconnect();

    // 4) T3 새 백업(T1 에 만든, 그 User 포함) 복원 → 기동 재적용 → 다시 삭제 + 다시 연장
    copyFileSync(newBackup, prod);
    prisma = connect(prod);
    expect(await goneCount(prisma)).toBe(1);
    expect(await prisma.erasureTombstone.count()).toBe(0); // 새 백업은 재적용 전 사본 — DB 묘비 없음
    expect(await fileStore(prisma, erasures).reapplyTombstones([], { now: new Date(T3) })).toBe(1);
    expect(await goneCount(prisma)).toBe(0);
    expect(await prisma.user.count({ where: { email: 'keep@example.com' } })).toBe(1);
    expect((await prisma.erasureTombstone.findMany()).map((t) => t.retainUntil)).toEqual([iso(T3 + 7 * DAY)]);

    // 5) 아무 백업도 그 User 를 갖지 않게 된 뒤(마지막 연장 + 7일 넘어서) 정리되면 묘비도 사라진다
    const r5 = await retention(prisma, T3 + 7 * DAY + 1);
    expect(r5.tombstones).toBe(1 + 2); // DB 1 + 파일 2(T1 연장 줄·T3 연장 줄)
    expect(await prisma.erasureTombstone.count()).toBe(0);
    expect(parseTombstoneLines(readFileSync(erasures, 'utf8')).rows).toEqual([]);
  });
});

describe('7일 경계(정리)', () => {
  it('runRetention: retainUntil = now 보존, 1ms 전 삭제 · 옛 줄(retainUntil 없음)은 erasedAt+7일 — DB·파일 둘 다, 재작성은 원자적', async () => {
    const d = tmp();
    const prisma = connect(join(d, 'p.db'));
    await migrate(prisma);
    const path = join(d, 'e.jsonl');
    const cutoff = computeCutoffs(NOW).tombstoneIso;
    expect(cutoff).toBe(NOW.toISOString()); // 101 MED-2: 기준은 retainUntil < now
    const old7 = iso(NOW.getTime() - TOMBSTONE_RETENTION_DAYS * DAY);
    writeFileSync(
      path,
      [
        JSON.stringify({ emailSha256: 'a'.repeat(64), erasedAt: iso(NOW.getTime() - 20 * DAY), retainUntil: cutoff }), // 연장된 줄 → 보존
        JSON.stringify({ emailSha256: 'b'.repeat(64), erasedAt: old7, retainUntil: iso(Date.parse(cutoff) - 1) }), // 만료
        JSON.stringify({ emailSha256: 'e'.repeat(64), erasedAt: old7 }), // 옛 형식: erasedAt+7일 = now → 보존
        JSON.stringify({ emailSha256: 'f'.repeat(64), erasedAt: iso(Date.parse(old7) - 1) }), // 옛 형식 1ms 전 → 만료
        '',
      ].join('\n'),
    );
    const f = new TombstoneFile(path);
    await prisma.erasureTombstone.create({ data: { emailSha256: 'c'.repeat(64), erasedAt: old7, retainUntil: iso(Date.parse(cutoff) - 1) } });
    await prisma.erasureTombstone.create({ data: { emailSha256: 'g'.repeat(64), erasedAt: iso(NOW.getTime() - 30 * DAY), retainUntil: cutoff } });
    const report = await runRetention(
      {
        store: new PrismaRetentionStore(prisma),
        erasure: fileStore(prisma, path),
        backup: { dir: join(d, 'backup'), maxAgeDays: 7 },
        log: () => {},
      },
      NOW,
    );
    expect(report.tombstones).toBe(3); // DB 1(c) + 파일 2(b·f)
    expect((await prisma.erasureTombstone.findMany()).map((t) => t.emailSha256)).toEqual(['g'.repeat(64)]);
    expect(parseTombstoneLines(readFileSync(path, 'utf8'))).toEqual({
      rows: [
        { emailSha256: 'a'.repeat(64), erasedAt: iso(NOW.getTime() - 20 * DAY), retainUntil: cutoff },
        { emailSha256: 'e'.repeat(64), erasedAt: old7, retainUntil: cutoff }, // 남긴 옛 줄은 새 형식으로 재작성
      ],
      bad: [],
    });
    expect(readFileSync(path, 'utf8')).toContain('"retainUntil"');
    expect(readdirSync(d).filter((n) => n.includes('.tmp-'))).toEqual([]);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    // 바뀐 게 없으면 재작성 안 함
    const before = statSync(path).mtimeMs;
    expect(await f.prune(cutoff)).toBe(0);
    expect(statSync(path).mtimeMs).toBe(before);
  });

  it('파일 없음 → prune 0, readAll []', async () => {
    const f = new TombstoneFile(join(tmp(), 'none.jsonl'));
    expect(await f.prune(NOW.toISOString())).toBe(0);
    expect(await f.readAll()).toEqual([]);
  });
});

describe('손상 줄', () => {
  it('손상 줄은 건너뛰고 오류 이름만 로그(내용 0), 유효 줄 + DB 묘비는 적용, 기동 계속', async () => {
    const d = tmp();
    const prisma = connect(join(d, 'p.db'));
    await migrate(prisma);
    const path = join(d, 'e.jsonl');
    const erasedAt = NOW.toISOString();
    writeFileSync(
      path,
      [
        'garbage-secret-text',
        '{"emailSha256":"' + tombstoneKey('torn@example.com').slice(0, 20), // 잘린 쓰기
        JSON.stringify({ emailSha256: 'NOT-HEX', erasedAt }),
        JSON.stringify({ emailSha256: 'd'.repeat(64), erasedAt: '2026-10-25' }), // 정규 ISO 아님
        'null',
        '',
        JSON.stringify({ emailSha256: tombstoneKey('file@example.com'), erasedAt }),
      ].join('\n'),
    );
    await prisma.erasureTombstone.create({ data: { emailSha256: tombstoneKey('db@example.com'), erasedAt, retainUntil: iso(NOW.getTime() + 7 * DAY) } });
    await seedUser(prisma, 'file@example.com', iso(NOW.getTime() - DAY));
    await seedUser(prisma, 'db@example.com', iso(NOW.getTime() - DAY));
    await seedUser(prisma, 'torn@example.com', iso(NOW.getTime() - DAY));
    const logs: string[] = [];
    expect(await fileStore(prisma, path, (l) => logs.push(l)).reapplyTombstones()).toBe(2);
    expect(await prisma.user.count()).toBe(1); // torn 만 남음(묘비 줄이 손상)
    expect(logs).toEqual(['[privacy] erasure file skipped lines=5 (InvalidTombstone,SyntaxError)']); // 기동 재적용 읽기 1회
    expect(logs.join('\n')).not.toMatch(/garbage|secret|example|NOT-HEX/);
  });

  it('직전 줄이 줄바꿈 없이 잘렸어도 다음 append 는 온전한 새 줄', async () => {
    const path = join(tmp(), 'e.jsonl');
    writeFileSync(path, '{"emailSha256":"abc');
    const row = { emailSha256: 'e'.repeat(64), erasedAt: NOW.toISOString(), retainUntil: iso(NOW.getTime() + 7 * DAY) };
    await new TombstoneFile(path).append(row);
    const parsed = parseTombstoneLines(readFileSync(path, 'utf8'));
    expect(parsed.rows).toEqual([row]);
    expect(parsed.bad).toEqual(['SyntaxError']);
    // 정리 재작성은 손상 줄을 버린다
    expect(await new TombstoneFile(path).prune(iso(0))).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(`${JSON.stringify(row)}\n`);
  });

  it('파일을 읽을 수 없으면(ENOENT 외) throw — 기동 실패', async () => {
    const d = tmp();
    await expect(new TombstoneFile(d).readAll()).rejects.toBeTruthy(); // 디렉터리 = EISDIR
  });

  it('append 는 잘못된 행을 거부(이메일 원문을 키로 넘기는 실수 방지)', async () => {
    const f = new TombstoneFile(join(tmp(), 'e.jsonl'));
    await expect(f.append({ emailSha256: 'a@example.com', erasedAt: NOW.toISOString() })).rejects.toThrow(TypeError);
    await expect(f.append({ emailSha256: 'a'.repeat(64), erasedAt: NOW.toISOString(), retainUntil: '2026-11-01' })).rejects.toThrow(TypeError);
  });

  it('101 MED-2 하위 호환: retainUntil 없는 옛 줄 = erasedAt+7일, 잘못된 retainUntil 은 손상 줄', () => {
    const erasedAt = NOW.toISOString();
    const parsed = parseTombstoneLines(
      [
        JSON.stringify({ emailSha256: 'a'.repeat(64), erasedAt }),
        JSON.stringify({ emailSha256: 'b'.repeat(64), erasedAt, retainUntil: '2026-11-01' }),
        JSON.stringify({ emailSha256: 'c'.repeat(64), erasedAt, retainUntil: 5 }),
        JSON.stringify({ emailSha256: 'd'.repeat(64), erasedAt, retainUntil: iso(NOW.getTime() + 13 * DAY) }),
      ].join('\n'),
    );
    expect(parsed.rows).toEqual([
      { emailSha256: 'a'.repeat(64), erasedAt, retainUntil: iso(NOW.getTime() + 7 * DAY) },
      { emailSha256: 'd'.repeat(64), erasedAt, retainUntil: iso(NOW.getTime() + 13 * DAY) },
    ]);
    expect(parsed.bad).toEqual(['InvalidTombstone', 'InvalidTombstone']);
  });

  it('badLinesLogLine: 개수 + 서로 다른 오류 이름만', () => {
    expect(badLinesLogLine(['SyntaxError', 'SyntaxError', 'InvalidTombstone'])).toBe(
      '[privacy] erasure file skipped lines=3 (InvalidTombstone,SyntaxError)',
    );
  });
});

describe('경로 겹침 거부(기동 검사)', () => {
  const backup = resolve('/data/backup');
  it('기본값 /data/erasures.jsonl 은 기본 백업 폴더 /data/backup 밖 → 통과', () => {
    expect(resolveErasureFile({}, '/data/backup')).toBe(resolve(DEFAULT_ERASURE_FILE));
    expect(resolveErasureFile({ WS_ERASURE_FILE: '  ' }, '/data/backup')).toBe(resolve(DEFAULT_ERASURE_FILE));
    expect(resolveErasureFile({ WS_ERASURE_FILE: '/data/backup-erasures.jsonl' }, '/data/backup')).toBe(resolve('/data/backup-erasures.jsonl'));
  });
  it.each([
    ['백업 폴더 안', '/data/backup/erasures.jsonl', '/data/backup'],
    ['백업 폴더 하위 폴더', '/data/backup/x/e.jsonl', '/data/backup'],
    ['백업 폴더 자체', '/data/backup', '/data/backup'],
    ['끝 슬래시·.. 정규화', '/data/x/../backup/e.jsonl', '/data/backup/'],
    ['백업 폴더가 파일 경로 아래', '/data/e', '/data/e/backup'],
    ['백업 폴더 = /data(상위)', '/data/erasures.jsonl', '/data'],
  ])('%s → throw', (_n, file, dir) => {
    expect(() => resolveErasureFile({ WS_ERASURE_FILE: file }, dir)).toThrow(/WS_ERASURE_FILE/);
  });
  it('DB 파일과 같으면 throw', () => {
    expect(() => resolveErasureFile({ WS_ERASURE_FILE: '/data/prod.db', DATABASE_URL: 'file:/data/prod.db' }, '/data/backup')).toThrow(
      /DATABASE_URL/,
    );
  });
  it.runIf(process.platform === 'win32')('Windows 는 대소문자 무시', () => {
    expect(() => resolveErasureFile({ WS_ERASURE_FILE: 'C:\\DATA\\BACKUP\\e.jsonl' }, 'c:\\data\\backup')).toThrow();
  });
  it('101 L-6: 링크(심볼릭·정션)로 우회한 겹침도 거부 — 파일·중간 폴더가 아직 없어도(부모 realpath)', () => {
    const d = tmp();
    const real = join(d, 'real');
    mkdirSync(join(real, 'backup'), { recursive: true });
    const alias = join(d, 'alias');
    symlinkSync(real, alias, 'junction'); // Windows 는 관리자 권한 없이 되는 정션, POSIX 는 디렉터리 심볼릭 링크
    // 문자열로는 겹치지 않지만 실제 경로는 백업 폴더 안
    expect(() => resolveErasureFile({ WS_ERASURE_FILE: join(real, 'backup', 'erasures.jsonl') }, join(alias, 'backup'))).toThrow(/WS_ERASURE_FILE/);
    expect(() => resolveErasureFile({ WS_ERASURE_FILE: join(alias, 'backup', 'new', 'e.jsonl') }, join(real, 'backup'))).toThrow(/WS_ERASURE_FILE/);
    // 백업 폴더가 아직 없어도(부모까지 realpath)
    expect(() => resolveErasureFile({ WS_ERASURE_FILE: join(real, 'b2', 'e.jsonl') }, join(alias, 'b2'))).toThrow(/WS_ERASURE_FILE/);
    // DB 파일과 링크로 같은 파일
    expect(() =>
      resolveErasureFile({ WS_ERASURE_FILE: join(real, 'prod.db'), DATABASE_URL: `file:${join(alias, 'prod.db').replace(/\\/g, '/')}` }, join(real, 'backup')),
    ).toThrow(/DATABASE_URL/);
    // 링크를 거쳐도 실제로 밖이면 통과(반환값 = 입력 경로 그대로)
    expect(resolveErasureFile({ WS_ERASURE_FILE: join(alias, 'erasures.jsonl') }, join(real, 'backup'))).toBe(resolve(join(alias, 'erasures.jsonl')));
    expect(realpathLoose(join(alias, 'none', 'x.jsonl')).toLowerCase()).toBe(join(realpathSync.native(real), 'none', 'x.jsonl').toLowerCase());
  });

  it('isSameOrInside: 이름이 접두사만 같은 형제는 밖', () => {
    expect(isSameOrInside(resolve('/data/backupX/e'), backup)).toBe(false);
    expect(isSameOrInside(resolve('/data/..backup'), resolve('/data'))).toBe(true);
  });
});

describe('mergeTombstones', () => {
  it('같은 키는 늦은 erasedAt·늦은 retainUntil(없으면 erasedAt+7일), 키 합집합', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    expect(
      mergeTombstones(
        [{ emailSha256: a, erasedAt: '2026-10-01T00:00:00.000Z', retainUntil: '2026-10-20T00:00:00.000Z' }],
        [
          { emailSha256: a, erasedAt: '2026-10-02T00:00:00.000Z' },
          { emailSha256: b, erasedAt: '2026-10-01T00:00:00.000Z' },
        ],
      ),
    ).toEqual([
      { emailSha256: a, erasedAt: '2026-10-02T00:00:00.000Z', retainUntil: '2026-10-20T00:00:00.000Z' },
      { emailSha256: b, erasedAt: '2026-10-01T00:00:00.000Z', retainUntil: '2026-10-08T00:00:00.000Z' },
    ]);
  });

  it('장식자는 파일 묘비를 inner.reapplyTombstones(extra) 로 넘긴다', async () => {
    const path = join(tmp(), 'e.jsonl');
    const row = { emailSha256: 'f'.repeat(64), erasedAt: NOW.toISOString(), retainUntil: iso(NOW.getTime() + 7 * DAY) };
    await new TombstoneFile(path).append(row);
    const seen: unknown[] = [];
    const inner: ErasureStore = {
      eraseByEmail: async () => ({}) as never,
      eraseUser: async () => ({}) as never,
      reapplyTombstones: async (extra) => (seen.push(extra), 0),
      pruneTombstones: async () => 0,
    };
    await new FileBackedErasureStore(inner, new TombstoneFile(path), async () => null).reapplyTombstones();
    expect(seen).toEqual([[row]]);
  });
});
