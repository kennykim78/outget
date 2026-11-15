// D9 ② — 시드 로더 whyShort: map(키 부재 → NULL, 값 → 그대로) + 실제 SQLite(prisma/migrations 전부 적용) 왕복.
//   가짜 whyShort 는 메모리 사본에만(실시드 파일 불변).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProfileMinSpec, createCatalog, type SeedBundle, type SpecValues } from '../engine/index.js';
import { sqliteDatasourceUrl } from '../db/sqlite-url.js';
import { DEFAULT_SEED_DIR } from '../seed/cli-validate.js';
import { applyWrites } from '../seed/load.js';
import { mapSupplyRequirement } from '../seed/map.js';
import { planSeedWrites } from '../seed/plan.js';
import { readSeedDir } from '../seed/read.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '..', '..', 'prisma', 'migrations');
const SHORT = '바닥을 넓게 쓰는 동물이라 넓어야 해요.'; // 테스트 전용 가짜 값

vi.setConfig({ testTimeout: 60_000 });

const dirs: string[] = [];
const clients: PrismaClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) await c.$disconnect();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function statements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function freshDb(): Promise<PrismaClient> {
  const d = mkdtempSync(join(tmpdir(), 'ws-whyshort-'));
  dirs.push(d);
  const c = new PrismaClient({ datasourceUrl: sqliteDatasourceUrl(`file:${join(d, 't.db').replace(/\\/g, '/')}`) });
  clients.push(c);
  const names = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort();
  for (const n of names) for (const s of statements(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8'))) await c.$executeRawUnsafe(s);
  return c;
}

const plan = (b: SeedBundle) => {
  const cat = createCatalog(b);
  return planSeedWrites(b, (cp, item, values) => checkProfileMinSpec(cat, cp, item, values as SpecValues).meets);
};

describe('map — SupplyRequirement.whyShort', () => {
  it('실시드 전 행: 키 부재 → whyShort NULL, 키 있음(2026-11-15 채택 17건 — 14 + hideout + saucer·gerbil-thermo) → 값 그대로', () => {
    const rs = readSeedDir(DEFAULT_SEED_DIR).supplyRequirements;
    for (const r of rs) expect([r.id, mapSupplyRequirement(r).whyShort]).toEqual([r.id, r.whyShort ?? null]);
    expect(rs.filter((r) => r.whyShort !== undefined)).toHaveLength(17);
  });
  it('값이 있으면 그대로', () => {
    const r = readSeedDir(DEFAULT_SEED_DIR).supplyRequirements[0];
    expect(mapSupplyRequirement({ ...r, whyShort: SHORT }).whyShort).toBe(SHORT);
  });
});

describe('SQLite 왕복 — 마이그레이션 20261115000000_requirement_why_short 적용', () => {
  it('whyShort 열(TEXT, nullable)이 있고 시드 적재 후 값 = 실시드 17행 + 주입 1행, NULL 나머지', async () => {
    const db = await freshDb();
    const cols = (await db.$queryRawUnsafe('PRAGMA table_info("SupplyRequirement")')) as Array<{ name: string; type: string; notnull: number | bigint }>;
    const col = cols.find((c) => c.name === 'whyShort');
    expect(col).toBeDefined();
    expect(col!.type).toBe('TEXT');
    expect(Number(col!.notnull)).toBe(0);

    const b = readSeedDir(DEFAULT_SEED_DIR);
    const cage = b.supplyRequirements.find((r) => r.id === 'req-syrian-cage')!;
    expect(cage.whyShort).toBeUndefined();
    cage.whyShort = SHORT;
    await applyWrites(db, plan(b));
    const rows = await db.supplyRequirement.findMany({ select: { id: true, whyShort: true } });
    expect(rows).toHaveLength(b.supplyRequirements.length);
    const expected = b.supplyRequirements.filter((r) => r.whyShort !== undefined).map((r) => ({ id: r.id, whyShort: r.whyShort }));
    expect(expected).toHaveLength(18);
    const byId = (a: { id: string }, z: { id: string }) => a.id.localeCompare(z.id);
    expect(rows.filter((r) => r.whyShort !== null).sort(byId)).toEqual(expected.sort(byId));
  });
});
