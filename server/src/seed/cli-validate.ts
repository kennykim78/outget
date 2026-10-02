// npm run seed:validate — 시드 디렉터리 검증 CLI(CI 게이트).
//   사용: tsx src/seed/cli-validate.ts [--dir <path>] [--now YYYY-MM-DD] [--strict]
//   exit 0 = errors 0. 출력: `ERROR|WARN [rule] file#id path: message` + 요약 1줄.
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seoulToday } from '../prerender/cli.js';
import { formatIssue, isIsoDate } from './common.js';
import { readSeedDirRaw } from './read.js';
import { validateSeed } from './validate.js';

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** 오늘 날짜 YYYY-MM-DD(--now 기본값). */
  today: () => string;
}

export const DEFAULT_SEED_DIR = fileURLToPath(new URL('../../seed', import.meta.url));

const USAGE = 'usage: seed:validate [--dir <path>] [--now YYYY-MM-DD] [--strict]';

interface Args {
  dir: string;
  now: string | null;
  strict: boolean;
}

function parseArgs(argv: readonly string[]): Args | string {
  const args: Args = { dir: DEFAULT_SEED_DIR, now: null, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const eq = raw.indexOf('=');
    const flag = raw.startsWith('--') && eq > 0 ? raw.slice(0, eq) : raw;
    const inline = raw.startsWith('--') && eq > 0 ? raw.slice(eq + 1) : null;
    const value = (): string | null => inline ?? (i + 1 < argv.length ? argv[++i] : null);
    switch (flag) {
      case '--strict':
        args.strict = true;
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

export async function runValidateCli(argv: readonly string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === 'string') {
    io.stderr(`seed:validate: ${args}`);
    io.stderr(USAGE);
    return 2;
  }
  const now = args.now ?? io.today();
  const { raw, issues: readIssues } = readSeedDirRaw(args.dir);
  const res = validateSeed(raw, { now, strict: args.strict });
  const errors = [...readIssues, ...res.errors];
  const warnings = res.warnings;

  io.stdout(`seed:validate — dir ${args.dir} · now ${now}${args.strict ? ' · strict' : ''}`);
  for (const i of errors) io.stdout(formatIssue(i));
  for (const i of warnings) io.stdout(formatIssue(i));
  const s = res.summary;
  io.stdout(
    `seed:validate — errors ${errors.length}, warnings ${warnings.length}, exposable: types ${s.types}, requirements ${s.requirements}, products ${s.products}, testimonials ${s.testimonials}, vets ${s.vets}`,
  );
  return errors.length === 0 ? 0 : 1;
}

/** 직접 실행될 때만(테스트 import 시 실행 안 됨). */
function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const norm = (u: string): string => (process.platform === 'win32' ? u.toLowerCase() : u);
  return norm(pathToFileURL(resolve(entry)).href) === norm(import.meta.url);
}

if (isMain()) {
  process.exitCode = await runValidateCli(process.argv.slice(2), {
    stdout: (l) => process.stdout.write(`${l}\n`),
    stderr: (l) => process.stderr.write(`${l}\n`),
    today: () => seoulToday(),
  });
}
