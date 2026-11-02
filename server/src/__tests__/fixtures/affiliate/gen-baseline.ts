// 273 — 제휴 꺼짐 기준선 독립 재생성(QA 262 gen.mts 방식을 정식 스크립트로). 시험이 자기 코드로 기준선을 만드는 것(자기 증명)을 피하려고,
//   지정한 git 리비전의 코드 트리를 내보내(git archive — worktree·checkout·stash 없음) 그 코드의 buildSite 로 해시를 만든다.
//   --overlay 로 작업 트리의 파일·디렉터리를 내보낸 트리 위에 덮는다(예: 264 처리방침 변경만 반영한 "제휴 이전 코드 + 264" 기준선).
//   작업 트리 시드 변경(커밋 전 server/seed 수정)은 --overlay server/seed 를 줘야 기준선에 들어간다(안 주면 --rev 시점 시드로 만든다).
//
//   사용(저장소 루트에서):
//     npx tsx server/src/__tests__/fixtures/affiliate/gen-baseline.ts --rev <rev> [--overlay <저장소 상대 경로>]... [--wire 2|1] [--write] [--note <사유>] [--against <기준선 파일>]
//   --against: 비교·쓰기 대상 기준선 파일(기본은 아래 wire 별 파일).
//   기본은 비교만(기준선 파일과 다른 파일 목록 출력, 쓰기 0). --write 일 때만 기준선 파일을 다시 쓴다(차이 목록은 그때도 출력).
//   --wire 2 → off-baseline.sha256.json(파일 전체 sha256, T-③b) · --wire 1 → off-baseline-v1.sha256.json(wsDataWire:1 ws-data JSON sha256).
//   대상 빌드는 baseline.ts BASELINE_CASES 와 같은 3개(real·promotedTwo·dwarfPreview) — 이름·asOf 를 여기서도 같게 쓴다(시험이 이름 일치를 본다).
//   네트워크 0. 임시 트리는 node_modules/.cache/ws-aff-baseline/ 아래(의존성 해석용, gitignore) — 끝나면 지운다.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '..', '..', '..', '..', '..');
export const BASELINE_V2_FILE = join(here, 'off-baseline.sha256.json');
export const BASELINE_V1_FILE = join(here, 'off-baseline-v1.sha256.json');
/** 내보내는 경로(prerender-seed 픽스처가 scripts/ 의 서명 스크립트·검수 패킷을 읽는다). */
const EXPORT_PATHS = ['server', 'scripts', 'client/index.html'];
const WS_RE = /<script id="ws-data" type="application\/json">([\s\S]*?)<\/script>/;

export interface BaselineFile {
  head: string;
  note: string;
  templateSha256: string;
  cases: Record<string, Record<string, string>>;
}

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** 두 기준선 cases 의 차이(추가·삭제·변경) — "case\tfile\t종류" 줄. */
export function diffBaselines(prev: Record<string, Record<string, string>>, next: Record<string, Record<string, string>>): string[] {
  const out: string[] = [];
  for (const c of [...new Set([...Object.keys(prev), ...Object.keys(next)])].sort()) {
    const a = prev[c] ?? {};
    const b = next[c] ?? {};
    for (const f of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!(f in a)) out.push(`${c}\t${f}\t추가`);
      else if (!(f in b)) out.push(`${c}\t${f}\t삭제`);
      else if (a[f] !== b[f]) out.push(`${c}\t${f}\t변경`);
    }
  }
  return out;
}

function git(args: string[], input?: Buffer): Buffer {
  const r = spawnSync('git', args, { cwd: REPO, input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 실패: ${r.stderr.toString()}`);
  return r.stdout;
}

interface Args {
  rev: string;
  overlays: string[];
  wire: 1 | 2;
  write: boolean;
  note: string | null;
  against: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { rev: '', overlays: [], wire: 2, write: false, note: null, against: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--write') a.write = true;
    else if (k === '--rev') a.rev = argv[++i] ?? '';
    else if (k === '--overlay') a.overlays.push(argv[++i] ?? '');
    else if (k === '--note') a.note = argv[++i] ?? '';
    else if (k === '--against') a.against = resolve(argv[++i] ?? '');
    else if (k === '--wire') {
      const w = argv[++i];
      if (w !== '1' && w !== '2') throw new Error('--wire 는 1 또는 2');
      a.wire = w === '1' ? 1 : 2;
    } else throw new Error(`알 수 없는 인자: ${k}`);
  }
  if (a.rev === '') throw new Error('--rev <git 리비전> 이 필요하다');
  for (const o of a.overlays) {
    if (o === '' || o.startsWith('/') || o.includes('..') || !existsSync(join(REPO, o))) throw new Error(`--overlay 는 저장소 안 상대 경로(있는 것): ${o}`);
  }
  return a;
}

type SiteMod = typeof import('../../../prerender/site.js');
type SeedMod = typeof import('../prerender-seed.js');

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const short = git(['rev-parse', '--short', args.rev]).toString().trim();
  const tmpRoot = join(REPO, 'node_modules', '.cache', 'ws-aff-baseline');
  const dir = join(tmpRoot, `${short}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    const tar = git(['-c', 'core.autocrlf=false', 'archive', '--format=tar', short, ...EXPORT_PATHS]); // 저장소 원문 그대로(CRLF 변환 0)
    const x = spawnSync('tar', ['-x', '-f', '-'], { cwd: dir, input: tar, maxBuffer: 1 << 30 }); // cwd — Windows 경로를 tar 인자로 넘기지 않는다
    if (x.status !== 0) throw new Error(`tar 실패: ${x.stderr.toString()}`);
    for (const o of args.overlays) {
      const src = join(REPO, o);
      cpSync(src, join(dir, o), { recursive: statSync(src).isDirectory(), force: true });
    }
    const site = (await import(pathToFileURL(join(dir, 'server', 'src', 'prerender', 'site.ts')).href)) as SiteMod;
    const fx = (await import(pathToFileURL(join(dir, 'server', 'src', '__tests__', 'fixtures', 'prerender-seed.ts')).href)) as SeedMod;
    const template = readFileSync(join(dir, 'client', 'index.html'), 'utf8');
    // baseline.ts BASELINE_CASES 와 같은 이름·asOf(REAL_AS_OF 2026-11-02).
    const cases: Array<[string, () => ReturnType<SeedMod['realSeed']>, string]> = [
      ['real', fx.realSeed, '2026-11-02'],
      ['promotedTwo', () => fx.promotedTwo(), fx.FIXTURE_AS_OF],
      ['dwarfPreview', fx.dwarfPreview, fx.DWARF_PREVIEW_AS_OF],
    ];
    const next: Record<string, Record<string, string>> = {};
    for (const [name, seed, asOf] of cases) {
      const b = site.buildSite(seed(), {
        template,
        origin: 'http://localhost:3001',
        seedDigest: 'a'.repeat(64),
        indexable: true,
        asOf,
        ...(args.wire === 1 ? { wsDataWire: 1 as const } : {}),
      });
      const keys = [...b.files.keys()].sort();
      next[name] =
        args.wire === 2
          ? Object.fromEntries(keys.map((k) => [k, sha256(b.files.get(k) as string)]))
          : Object.fromEntries(
              keys.filter((k) => k.endsWith('.html')).map((k) => [k, sha256(WS_RE.exec(b.files.get(k) as string)?.[1] ?? '')]),
            );
    }
    const file = args.against ?? (args.wire === 2 ? BASELINE_V2_FILE : BASELINE_V1_FILE);
    const prev = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as BaselineFile) : null;
    const diff = prev ? diffBaselines(prev.cases, next) : Object.keys(next).map((c) => `${c}\t*\t새 파일`);
    const total = Object.values(next).reduce((n, c) => n + Object.keys(c).length, 0);
    console.log(`gen-baseline: rev ${short}${args.overlays.length ? ` + overlay ${args.overlays.join(',')}` : ''} · wire ${args.wire} · 파일 ${total}개 · 기준선과 차이 ${diff.length}개`);
    for (const d of diff) console.log(`DIFF\t${d}`);
    if (!args.write) return diff.length === 0 ? 0 : 1;
    const head = args.overlays.length ? `${short}+overlay` : short;
    const out: BaselineFile = {
      head,
      note:
        args.note ??
        `${args.wire === 2 ? '꺼짐 빌드 파일 sha256' : 'wsDataWire:1 ws-data JSON sha256'} — gen-baseline --rev ${short}${args.overlays.map((o) => ` --overlay ${o}`).join('')}`,
      templateSha256: sha256(template),
      cases: next,
    };
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`gen-baseline: 썼다 ${file} (head ${head})`);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`gen-baseline: ${(e as Error).message}`);
      process.exit(2);
    },
  );
}
