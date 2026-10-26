// 삭제 묘비 파일(be-tomb, 2026-10-25 오케스트레이터 결정 'be-privacy(87) 수용' 후속).
//   문제: 전체 백업 복원(prod.db 를 /data/backup/prod-*.db 로 덮어씀)이면 ErasureTombstone 테이블도 복원 전 상태라
//         지운 계정이 되살아난다. 그래서 묘비를 DB 와 함께 "백업 폴더 밖" 파일에도 남긴다(기본 /data/erasures.jsonl).
//   형식: 한 줄 = {"emailSha256":<hex64>,"erasedAt":<ISO 24자>,"retainUntil":<ISO 24자>} — 이메일 원문·userId 0.
//         retainUntil 없는 옛 줄은 erasedAt + 7일로 읽는다(하위 호환, 101 MED-2). 같은 키 여러 줄은 합집합(가장 늦은 값).
//   연장: 재적용으로 실제 User 를 지우면 retainUntil = max(retainUntil, now+7일) 줄을 삭제 전에 append(덮어쓰기 없음).
//   쓰기: 삭제 전에 append(O_APPEND 단일 write + fsync, 0600). 직전 줄이 잘려 있으면 줄바꿈을 먼저 넣어 새 줄을 지킨다.
//         정리(retainUntil < now 인 줄 제거)는 임시 파일 + fsync + rename 으로 전체 재작성(원자적). 프로세스 안 쓰기는 직렬화.
//   읽기: 손상 줄은 건너뛰고 오류 이름·개수만 로그(내용 0) — 나머지 파일 묘비와 DB 묘비는 그대로 적용, 기동 계속.
//         파일 자체를 못 읽으면(ENOENT 제외: EACCES·EISDIR 등) throw — 기동 실패(fail-closed, 이후 삭제 기록도 실패할 상태).
//   순서: 파일 기록 → DB 트랜잭션. 파일 기록 실패면 DB 삭제도 하지 않고 throw(요청 500, 재시도 가능).
//         반대로 DB 가 실패하면 파일 묘비만 남는다 — 다음 기동 재적용이 그 사용자를 지운다(본인이 요청한 삭제라 허용).
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  plusRetention,
  retainUntilOf,
  stdoutLog,
  tombstoneKey,
  type EraseCounts,
  type EraseOptions,
  type ErasureStore,
  type PrivacyLog,
  type ReapplyOptions,
  type TombstoneRow,
} from './erase.js';
import { DEFAULT_ERASURE_FILE, ERASURE_FILE_ENV } from './policy.js';

const HEX64 = /^[0-9a-f]{64}$/;
/** Date#toISOString 정규형만 — createdAt 과 사전순 비교하므로 형식이 다르면 비교가 틀어진다. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

function samePathKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/** a 가 b 와 같거나 b 아래인가(둘 다 절대 경로). */
export function isSameOrInside(a: string, b: string): boolean {
  const rel = relative(samePathKey(b), samePathKey(a));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * 101 L-6: 심볼릭 링크·정션을 푼 실제 경로. 끝부분이 아직 없으면(파일 미생성 등) 존재하는 가장 가까운 조상까지 realpath 후
 *   남은 이름을 붙인다. ENOENT·ENOTDIR 외 오류(EACCES 등)는 throw — 판정할 수 없으면 기동 실패(fail-closed).
 */
export function realpathLoose(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync.native(abs);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
    const parent = dirname(abs);
    if (parent === abs) return abs; // 루트
    return join(realpathLoose(parent), basename(abs));
  }
}

/** DATABASE_URL 'file:<절대 경로>' → 경로. 상대 경로(prisma 스키마 기준)·다른 provider 는 null(검사 생략). */
function sqliteFileOf(url: string | undefined): string | null {
  if (typeof url !== 'string' || !url.startsWith('file:')) return null;
  const p = url.slice('file:'.length).split('?')[0];
  return isAbsolute(p) ? resolve(p) : null;
}

/**
 * env → 묘비 파일 절대 경로. 기동 검사(throw = 기동 실패):
 *   ① 백업 폴더(WS_BACKUP_DIR)와 같거나 그 아래면 거부 — 백업과 함께 복원·정리되면 이 파일의 의미가 없다.
 *   ② 백업 폴더가 이 파일 경로 아래(파일 경로를 디렉터리처럼 지정)여도 거부.
 *   ③ DATABASE_URL 의 SQLite 파일과 같으면 거부.
 *   101 L-6: 비교는 문자열 경로와 realpathLoose(링크를 푼 실제 경로) 둘 다 — 링크로 우회한 겹침도 거부. 반환값은 문자열 경로(resolve).
 */
export function resolveErasureFile(env: NodeJS.ProcessEnv, backupDir: string): string {
  const raw = env[ERASURE_FILE_ENV];
  const file = resolve(typeof raw === 'string' && raw.trim() !== '' ? raw : DEFAULT_ERASURE_FILE);
  const dir = resolve(backupDir);
  const realFile = realpathLoose(file);
  const realDir = realpathLoose(dir);
  const overlaps = (a: string, b: string): boolean => isSameOrInside(a, b) || isSameOrInside(b, a);
  if (overlaps(file, dir) || overlaps(realFile, realDir)) {
    throw new Error(`${ERASURE_FILE_ENV} 는 백업 폴더(WS_BACKUP_DIR) 밖이어야 한다(백업 복원 시 함께 되돌아가면 안 됨)`);
  }
  const db = sqliteFileOf(env.DATABASE_URL);
  if (db !== null && (samePathKey(db) === samePathKey(file) || samePathKey(realpathLoose(db)) === samePathKey(realFile))) {
    throw new Error(`${ERASURE_FILE_ENV} 는 DATABASE_URL 의 DB 파일과 달라야 한다`);
  }
  return file;
}

export interface ParsedTombstones {
  /** retainUntil 은 항상 채운다(옛 줄 = erasedAt + 7일). */
  rows: Required<TombstoneRow>[];
  /** 손상 줄의 오류 이름(줄마다 1개, 내용 0). */
  bad: string[];
}

/** 순수: 파일 본문 → 유효 묘비 + 손상 줄 오류 이름. 빈 줄은 무시(손상 아님). */
export function parseTombstoneLines(text: string): ParsedTombstones {
  const rows: Required<TombstoneRow>[] = [];
  const bad: string[] = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s === '') continue;
    let v: unknown;
    try {
      v = JSON.parse(s);
    } catch (e) {
      bad.push((e as Error).name || 'Error');
      continue;
    }
    const o = v as { emailSha256?: unknown; erasedAt?: unknown; retainUntil?: unknown } | null;
    if (
      o === null ||
      typeof o !== 'object' ||
      typeof o.emailSha256 !== 'string' ||
      !HEX64.test(o.emailSha256) ||
      typeof o.erasedAt !== 'string' ||
      !ISO.test(o.erasedAt) ||
      Number.isNaN(Date.parse(o.erasedAt)) ||
      (o.retainUntil !== undefined && (typeof o.retainUntil !== 'string' || !ISO.test(o.retainUntil) || Number.isNaN(Date.parse(o.retainUntil))))
    ) {
      bad.push('InvalidTombstone');
      continue;
    }
    rows.push({ emailSha256: o.emailSha256, erasedAt: o.erasedAt, retainUntil: retainUntilOf({ erasedAt: o.erasedAt, retainUntil: o.retainUntil }) });
  }
  return { rows, bad };
}

/** 손상 줄 로그 한 줄: 개수 + 서로 다른 오류 이름만. */
export function badLinesLogLine(bad: readonly string[]): string {
  return `[privacy] erasure file skipped lines=${bad.length} (${[...new Set(bad)].sort().join(',')})`;
}

function lineOf(row: TombstoneRow): string {
  // 키 순서 고정 — 필드는 세 개뿐(이메일 원문 없음).
  return `${JSON.stringify({ emailSha256: row.emailSha256, erasedAt: row.erasedAt, retainUntil: retainUntilOf(row) })}\n`;
}

function isEnoent(err: unknown): boolean {
  return (err as { code?: unknown }).code === 'ENOENT';
}

/** 디렉터리 fsync(rename 내구성). Windows 등 지원 안 하면 무시. */
async function syncDir(dir: string): Promise<void> {
  try {
    const fh = await open(dir, 'r');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    /* 플랫폼 미지원 — 무시 */
  }
}

export class TombstoneFile {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly path: string,
    private readonly log: PrivacyLog = stdoutLog,
  ) {}

  /** 프로세스 안 직렬화(append·재작성이 섞이지 않게). 실패해도 다음 작업은 진행. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** 본문 읽기. 없으면 ''. 그 밖의 읽기 실패는 throw. */
  private async readText(): Promise<string> {
    try {
      return await readFile(this.path, 'utf8');
    } catch (err) {
      if (isEnoent(err)) return '';
      throw err;
    }
  }

  /** 유효 묘비 전부. 손상 줄은 건너뛰고 오류 이름만 로그. */
  async readAll(): Promise<Required<TombstoneRow>[]> {
    return this.serial(async () => {
      const { rows, bad } = parseTombstoneLines(await this.readText());
      if (bad.length > 0) this.log(badLinesLogLine(bad));
      return rows;
    });
  }

  /** 한 줄 append(O_APPEND 단일 write + fsync, 0600). 직전 줄이 줄바꿈 없이 끝났으면(잘린 쓰기) 줄바꿈부터. */
  async append(row: TombstoneRow): Promise<void> {
    if (!HEX64.test(row.emailSha256) || !ISO.test(row.erasedAt) || (row.retainUntil !== undefined && !ISO.test(row.retainUntil))) {
      throw new TypeError('invalid tombstone row');
    }
    return this.serial(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: DIR_MODE });
      const fh = await open(this.path, 'a+', FILE_MODE);
      try {
        const { size } = await fh.stat();
        let prefix = '';
        if (size > 0) {
          const last = Buffer.alloc(1);
          await fh.read(last, 0, 1, size - 1);
          if (last[0] !== 0x0a) prefix = '\n';
        }
        await fh.write(prefix + lineOf(row));
        await fh.sync();
      } finally {
        await fh.close();
      }
      await chmod(this.path, FILE_MODE); // 기존 파일 권한이 넓었어도 0600 으로.
    });
  }

  /**
   * retainUntil < cutoffIso(= 정리 시각) 줄 제거(손상 줄도 함께 버림 — 읽을 수 없는 줄은 보존 가치가 없다). 제거한 유효 줄 수.
   *   옛 형식 줄은 남길 때 retainUntil 을 채운 새 형식으로 다시 쓴다.
   *   바뀐 것이 없으면 재작성하지 않는다. 재작성 = 임시 파일(0600) + fsync + rename(원자적).
   */
  async prune(cutoffIso: string): Promise<number> {
    return this.serial(async () => {
      const text = await this.readText();
      if (text === '') return 0;
      const { rows, bad } = parseTombstoneLines(text);
      const keep = rows.filter((r) => r.retainUntil >= cutoffIso);
      const removed = rows.length - keep.length;
      if (removed === 0 && bad.length === 0) return 0;
      const tmp = `${this.path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
      try {
        const fh = await open(tmp, 'wx', FILE_MODE);
        try {
          await fh.write(keep.map(lineOf).join(''));
          await fh.sync();
        } finally {
          await fh.close();
        }
        await chmod(tmp, FILE_MODE);
        await rename(tmp, this.path);
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
      await syncDir(dirname(this.path));
      return removed;
    });
  }
}

/**
 * ErasureStore 장식자: 묘비를 파일에도 남기고(삭제 전), 재적용은 DB 묘비 ∪ 파일 묘비, 정리는 둘 다.
 *   findEmail — eraseUser(userId) 경로에서 파일 키를 만들 이메일 조회(없으면 null → 파일 기록 없음, inner 도 0건).
 */
export class FileBackedErasureStore implements ErasureStore {
  constructor(
    private readonly inner: ErasureStore,
    private readonly file: TombstoneFile,
    private readonly findEmail: (userId: string) => Promise<string | null>,
  ) {}

  async eraseByEmail(email: string, nowIso: string, opts: EraseOptions = {}): Promise<EraseCounts> {
    if (opts.tombstone !== false) await this.file.append({ emailSha256: tombstoneKey(email), erasedAt: nowIso, retainUntil: plusRetention(nowIso) });
    return this.inner.eraseByEmail(email, nowIso, opts);
  }

  async eraseUser(userId: string, nowIso: string, opts: EraseOptions = {}): Promise<EraseCounts> {
    if (opts.tombstone !== false) {
      const email = await this.findEmail(userId);
      if (email !== null) await this.file.append({ emailSha256: tombstoneKey(email), erasedAt: nowIso, retainUntil: plusRetention(nowIso) });
    }
    return this.inner.eraseUser(userId, nowIso, opts);
  }

  /** 101 MED-2: 실제 재삭제 직전 연장 줄(retainUntil = max(기존, now+7일))을 파일에 먼저 append — DB 는 inner 가 같은 트랜잭션에서. */
  async reapplyTombstones(extra: readonly TombstoneRow[] = [], opts: ReapplyOptions = {}): Promise<number> {
    return this.inner.reapplyTombstones([...(await this.file.readAll()), ...extra], {
      ...opts,
      beforeErase: async (row) => {
        await this.file.append(row);
        if (opts.beforeErase) await opts.beforeErase(row);
      },
    });
  }

  /** QA95 D-2: 안쪽 저장소에 위임(없으면 no-op). */
  async compact(): Promise<void> {
    await this.inner.compact?.();
  }

  /** DB 묘비 삭제 수 + 파일 묘비 줄 삭제 수(retainUntil < cutoffIso). */
  async pruneTombstones(cutoffIso: string): Promise<number> {
    const db = await this.inner.pruneTombstones(cutoffIso);
    return db + (await this.file.prune(cutoffIso));
  }
}

/** 조립 도우미(index.ts·cli-erase.ts 공용). */
export function withTombstoneFile(
  inner: ErasureStore,
  path: string,
  findEmail: (userId: string) => Promise<string | null>,
  log: PrivacyLog = stdoutLog,
): FileBackedErasureStore {
  return new FileBackedErasureStore(inner, new TombstoneFile(path, log), findEmail);
}
