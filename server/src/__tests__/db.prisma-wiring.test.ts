// 프로덕션 싱글턴(db/prisma.ts)이 sqliteDatasourceUrl 보정을 타는지 고정(QA141 m2: prisma.ts 를 원본 URL 로 되돌려도
// 다른 테스트가 모두 통과했다). PrismaClient 를 모의해 생성자 인자만 본다 — DB 연결 0, 결정적.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ctorArgs: unknown[][] = [];
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor(...args: unknown[]) {
      ctorArgs.push(args);
    }
    $disconnect(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

const saved = process.env.DATABASE_URL;
beforeEach(() => {
  ctorArgs.length = 0;
  vi.resetModules();
});
afterEach(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

describe('db/prisma.ts 배선 — SQLite connection_limit=1', () => {
  it('file: DATABASE_URL → datasourceUrl 에 connection_limit=1', async () => {
    process.env.DATABASE_URL = 'file:/data/prod.db';
    await import('../db/prisma.js');
    expect(ctorArgs).toEqual([[{ datasourceUrl: 'file:/data/prod.db?connection_limit=1' }]]);
  });

  it('운영자가 지정한 connection_limit 은 유지', async () => {
    process.env.DATABASE_URL = 'file:/data/prod.db?connection_limit=3';
    await import('../db/prisma.js');
    expect(ctorArgs).toEqual([[{ datasourceUrl: 'file:/data/prod.db?connection_limit=3' }]]);
  });

  it('비-file URL 은 원문 그대로, DATABASE_URL 없으면 기본 생성자(인자 없음)', async () => {
    process.env.DATABASE_URL = 'postgresql://u@h/db';
    await import('../db/prisma.js');
    expect(ctorArgs).toEqual([[{ datasourceUrl: 'postgresql://u@h/db' }]]);
    ctorArgs.length = 0;
    vi.resetModules();
    delete process.env.DATABASE_URL;
    await import('../db/prisma.js');
    expect(ctorArgs).toEqual([[]]);
  });
});
