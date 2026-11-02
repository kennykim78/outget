// npm run seed — 시드 적재 CLI(A-14).
//   사용: tsx --env-file-if-exists=.env src/seed/cli-load.ts [--dir <path>] [--now YYYY-MM-DD] [--no-prune]
//   순서: 읽기 → validateSeed(오류 있으면 exit 1, 쓰기 0건 — DB 연결도 하지 않는다) → planSeedWrites
//   (meetsMinSpec 은 engine.checkProfileMinSpec 재계산) → 단일 트랜잭션 적용 → 행 수 + sha256 digest 출력.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { checkProfileMinSpec, createCatalog } from '../engine/index.js';
import type { SpecValues } from '../engine/index.js';
import { seoulToday } from '../config/dates.js';
import { asSeedBundle, formatIssue, isIsoDate } from './common.js';
import { DEFAULT_SEED_DIR } from './cli-validate.js';
import { applyWrites, readback } from './load.js';
import { planSeedWrites } from './plan.js';
import { readSeedDirRaw } from './read.js';
import { validateSeed } from './validate.js';

export interface LoadCliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** 오늘 날짜 YYYY-MM-DD(--now 기본값, 검증용). */
  today: () => string;
  /** 검증 통과 후에만 호출된다. 호출자가 연결 종료를 책임진다. */
  prisma: () => Promise<PrismaClient>;
}

const USAGE = 'usage: seed [--dir <path>] [--now YYYY-MM-DD] [--no-prune]';

interface Args {
  dir: string;
  now: string | null;
  prune: boolean;
}

function parseArgs(argv: readonly string[]): Args | string {
  const args: Args = { dir: DEFAULT_SEED_DIR, now: null, prune: true };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const eq = raw.indexOf('=');
    const flag = raw.startsWith('--') && eq > 0 ? raw.slice(0, eq) : raw;
    const inline = raw.startsWith('--') && eq > 0 ? raw.slice(eq + 1) : null;
    const value = (): string | null => inline ?? (i + 1 < argv.length ? argv[++i] : null);
    switch (flag) {
      case '--no-prune':
        args.prune = false;
        break;
      case '--dir': {
        const v = value();
        if (!v) return '--dir 값이 없다';
        args.dir = resolve(v);
        break;
      }
      case '--now': {
        const v = value();
        if (!isIsoDate(v)) return `--now 는 YYYY-MM-DD: ${String(v)}`;
        args.now = v;
        break;
      }
      default:
        return `알 수 없는 인자: ${raw}`;
    }
  }
  return args;
}

export async function runLoadCli(argv: readonly string[], io: LoadCliIo): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === 'string') {
    io.stderr(`seed: ${args}`);
    io.stderr(USAGE);
    return 2;
  }
  const now = args.now ?? io.today();
  const { raw, issues: readIssues, signatures } = readSeedDirRaw(args.dir);
  const res = validateSeed(raw, { now, strict: false, signatures });
  const errors = [...readIssues, ...res.errors];
  if (errors.length > 0) {
    for (const i of errors) io.stderr(formatIssue(i));
    io.stderr(`seed: 검증 오류 ${errors.length}건 — 적재하지 않음(쓰기 0건)`);
    return 1;
  }

  const bundle = asSeedBundle(raw);
  const cat = createCatalog(bundle);
  const ops = planSeedWrites(
    bundle,
    (cp, item, values) => checkProfileMinSpec(cat, cp, item, values as SpecValues).meets,
    { prune: args.prune },
  );

  const prisma = await io.prisma();
  const applied = await applyWrites(prisma, ops);
  const { counts, digest } = await readback(prisma);

  io.stdout(
    `seed — dir ${args.dir} · ops ${ops.length} · deleted ${applied.deleted}, upserted ${applied.upserted}, inserted ${applied.inserted}${args.prune ? '' : ' · no-prune'}`,
  );
  io.stdout(`seed — counts ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  io.stdout(`seed — digest sha256:${digest}`);
  if (res.warnings.length > 0) io.stdout(`seed — 검증 경고 ${res.warnings.length}건(seed:validate 로 확인)`);
  return 0;
}

/** 직접 실행될 때만(테스트 import 시 실행 안 됨). */
function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const norm = (u: string): string => (process.platform === 'win32' ? u.toLowerCase() : u);
  return norm(pathToFileURL(resolve(entry)).href) === norm(import.meta.url);
}

if (isMain()) {
  let client: PrismaClient | null = null;
  try {
    process.exitCode = await runLoadCli(process.argv.slice(2), {
      stdout: (l) => process.stdout.write(`${l}\n`),
      stderr: (l) => process.stderr.write(`${l}\n`),
      today: () => seoulToday(),
      prisma: async () => {
        const { PrismaClient: Ctor } = await import('@prisma/client');
        client = new Ctor();
        return client;
      },
    });
  } catch (e) {
    process.stderr.write(`seed: 적재 실패(트랜잭션 롤백) — ${(e as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    if (client) await (client as PrismaClient).$disconnect();
  }
}
