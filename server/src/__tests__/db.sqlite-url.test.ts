// SQLite 연결 1개(db/sqlite-url.ts) — CI(ubuntu 2 vCPU) QA95 D-3 DELETE 500 회귀.
//   원인: Prisma SQLite 잠금 대기(busy_timeout 5초)가 엔진 작업 스레드를 막아, 쓰기 잠금을 쥔 대화형 트랜잭션이 다음 문장을
//   못 돌리고 만료(P2028)·대기 쓰기 P1008. 실제 SQLite 회귀 테스트는 작업 스레드 수(CPU 수)보다 많은 동시 쓰기를 걸어
//   코어 수와 무관하게 재현 조건을 만든다(보정 없는 URL 이면 5초 뒤 실패, 보정 URL 이면 즉시 통과).
import { availableParallelism, tmpdir } from 'node:os';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SQLITE_CONNECTION_LIMIT, sqliteDatasourceUrl } from '../db/sqlite-url.js';

describe('sqliteDatasourceUrl(순수)', () => {
  it('file: URL 에 connection_limit=1 추가(쿼리 있으면 &)', () => {
    expect(SQLITE_CONNECTION_LIMIT).toBe(1);
    expect(sqliteDatasourceUrl('file:/data/prod.db')).toBe('file:/data/prod.db?connection_limit=1');
    expect(sqliteDatasourceUrl('file:./dev.db?socket_timeout=10')).toBe('file:./dev.db?socket_timeout=10&connection_limit=1');
  });
  it('운영자가 명시한 connection_limit 은 유지, file: 이 아니거나 없으면 그대로', () => {
    expect(sqliteDatasourceUrl('file:/data/prod.db?connection_limit=3')).toBe('file:/data/prod.db?connection_limit=3');
    expect(sqliteDatasourceUrl('file:/x.db?a=1&connection_limit=2')).toBe('file:/x.db?a=1&connection_limit=2');
    expect(sqliteDatasourceUrl('postgresql://u@h/db')).toBe('postgresql://u@h/db');
    expect(sqliteDatasourceUrl(undefined)).toBeUndefined();
    expect(sqliteDatasourceUrl('')).toBe('');
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '..', '..', 'prisma', 'migrations');
const dirs: string[] = [];
const clients: PrismaClient[] = [];
afterAll(async () => {
  for (const c of clients) await c.$disconnect();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function freshDb(): Promise<PrismaClient> {
  const dir = mkdtempSync(join(tmpdir(), 'ws-sqlite-url-'));
  dirs.push(dir);
  const prisma = new PrismaClient({ datasourceUrl: sqliteDatasourceUrl(`file:${join(dir, 'test.db').replace(/\\/g, '/')}`) });
  clients.push(prisma);
  const names = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const n of names) {
    const sql = readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    for (const s of sql.split(';').map((x) => x.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(s);
  }
  return prisma;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('실제 SQLite: 쓰기 잠금 쥔 대화형 트랜잭션 ∥ 작업 스레드보다 많은 자동 커밋 쓰기', () => {
  it('트랜잭션·쓰기 모두 성공(P1008·P2028 0), 5초 대기 없음', async () => {
    const prisma = await freshDb();
    const n = availableParallelism() * 2 + 2;
    const t0 = Date.now();
    const tx = prisma.$transaction(async (t) => {
      await t.user.create({ data: { id: 'tx-0', email: 'tx-0@example.com', createdAt: 'x' } }); // 쓰기 잠금
      await sleep(150); // 그 사이 n 개 쓰기가 잠금 대기에 들어간다
      for (let i = 1; i <= 3; i++) await t.user.create({ data: { id: `tx-${i}`, email: `tx-${i}@example.com`, createdAt: 'x' } });
      return 'ok';
    });
    await sleep(30);
    const writes = Array.from({ length: n }, (_, i) =>
      prisma.user.create({ data: { id: `w-${i}`, email: `w-${i}@example.com`, createdAt: 'x' } }).then(() => 'ok'),
    );
    const settled = await Promise.allSettled([tx, ...writes]);
    const failed = settled.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as { code?: unknown })?.code ?? r.reason)] : []));
    expect(failed).toEqual([]);
    expect(await prisma.user.count()).toBe(n + 4);
    expect(Date.now() - t0).toBeLessThan(4_000); // busy_timeout(5초) 만료 경로를 타지 않았다
  }, 60_000);
});
