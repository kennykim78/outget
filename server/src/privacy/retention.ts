// 보존 기간 정리 작업(P5, Kenny K-1). 기간은 privacy/policy.ts 단일 출처.
//   computeCutoffs(now) — 순수(시계 주입). runRetention — 저장소 포트에 위임 + 끝에 VACUUM.
//   대상: 미사용 User(마지막 활동 = max(User.lastSeenAt, SaveSnapshot.updatedAt, User.createdAt), USER 역할만 — 운영자 계정 제외)
//         QA95 D-1: Session.createdAt 은 근거로 쓰지 않는다(세션은 만료 즉시 정리되므로 근거가 사라져 '마지막으로 쓴 날부터 365일'보다
//         일찍 지워졌다). lastSeenAt 은 verify·GET/PUT /api/save 때 서울 날짜가 바뀌었을 때만 갱신(touchLastSeen, 하루 1회 쓰기).
//         · 만료 매직 토큰 · 비활성 세션 · EventLog · ReactionSignal · 묘비 · 백업 파일(나이만, P6 sh 와 같은 env).
//   순서: 미사용 User 판정을 먼저(삭제 대상 계정의 세션·스냅샷을 함께 지운 뒤 나머지 정리), VACUUM 은 맨 끝(삭제 페이지 잔존 제거, R1).
//   기동 1회 + 24h unref 타이머(startRetentionSchedule, index.ts). 실패는 로그만, 다음 주기에 재시도.
//   로그: '[privacy] retention …' 건수만(식별자 0), 사용자 삭제는 eraseAccount 의 'channel=RETENTION' 한 줄씩.
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { seoulToday } from '../prerender/cli.js';
import { daysBefore } from '../reaction/anon-key.js';
import { eraseAccount, stdoutLog, type ErasureStore, type PrivacyLog } from './erase.js';
import {
  BACKUP_DIR_ENV,
  BACKUP_MAX_AGE_ENV,
  BACKUP_RETENTION_DAYS,
  DAY_MS,
  DEFAULT_BACKUP_DIR,
  EVENT_LOG_RETENTION_DAYS,
  MAGIC_TOKEN_RETENTION_MS,
  REACTION_RETENTION_DAYS,
  RETENTION_INTERVAL_MS,
  SESSION_RETENTION_MS,
  UNUSED_USER_RETENTION_DAYS,
} from './policy.js';

/** 서울 날짜 YYYY-MM-DD 의 00:00(KST, UTC+9 고정·서머타임 없음) ISO. */
export function seoulDayStartIso(date: string): string {
  return new Date(`${date}T00:00:00+09:00`).toISOString();
}

export interface RetentionCutoffs {
  /** EventLog.receivedDate < eventDate 삭제(오늘 포함 90개 서울 날짜 보존). */
  eventDate: string;
  /** ReactionSignal.createdAt < reactionIso 삭제(오늘 포함 400개 서울 날짜 = anon-key 창과 같은 범위). */
  reactionIso: string;
  /** MagicLinkToken.expiresAt ≤ magicTokenIso 삭제. */
  magicTokenIso: string;
  /** Session expiresAt ≤ 또는 revokedAt ≤ sessionIso 삭제. */
  sessionIso: string;
  /** 마지막 활동 < unusedUserIso 인 USER 삭제(channel=RETENTION). */
  unusedUserIso: string;
  /** 묘비(DB·파일) retainUntil < tombstoneIso(= now) 삭제(101 MED-2 — erasedAt 아님, 재적용 연장 반영). */
  tombstoneIso: string;
  /** 백업 파일 mtime < backupBeforeMs 삭제. */
  backupBeforeMs: number;
}

/** 순수: now → 각 대상 기준 시각. */
export function computeCutoffs(now: Date, backupMaxAgeDays: number = BACKUP_RETENTION_DAYS): RetentionCutoffs {
  const t = now.getTime();
  const today = seoulToday(now);
  return {
    eventDate: daysBefore(today, EVENT_LOG_RETENTION_DAYS - 1),
    reactionIso: seoulDayStartIso(daysBefore(today, REACTION_RETENTION_DAYS - 1)),
    magicTokenIso: new Date(t - MAGIC_TOKEN_RETENTION_MS).toISOString(),
    sessionIso: new Date(t - SESSION_RETENTION_MS).toISOString(),
    unusedUserIso: new Date(t - UNUSED_USER_RETENTION_DAYS * DAY_MS).toISOString(),
    tombstoneIso: now.toISOString(),
    backupBeforeMs: t - backupMaxAgeDays * DAY_MS,
  };
}

export interface UserActivity {
  id: string;
  role: string;
  /** ISO, 미상 ''. */
  createdAt: string;
  lastSnapshotAt: string | null;
  /** User.lastSeenAt(QA95 D-1). null = 갱신 전 행. */
  lastSeenAt: string | null;
}

/** 순수: 마지막 활동 = max(lastSeenAt, 스냅샷 updatedAt, createdAt)(ISO 사전순 = 시간순). Session 은 보지 않는다. */
export function lastActivityIso(u: UserActivity): string {
  return [u.createdAt, u.lastSnapshotAt ?? '', u.lastSeenAt ?? ''].reduce((a, b) => (b > a ? b : a), '');
}

/** 순수: 자동 파기 대상 = USER 역할 ∧ 마지막 활동 < cutoff. OPERATOR 등은 절대 제외. */
export function pickUnusedUsers(users: readonly UserActivity[], cutoffIso: string): string[] {
  return users.filter((u) => u.role === 'USER' && lastActivityIso(u) < cutoffIso).map((u) => u.id);
}

export interface RetentionStore {
  listUserActivity(): Promise<UserActivity[]>;
  deleteExpiredMagicTokens(cutoffIso: string): Promise<number>;
  deleteInactiveSessions(cutoffIso: string): Promise<number>;
  deleteEventsBefore(date: string): Promise<number>;
  deleteReactionsBefore(cutoffIso: string): Promise<number>;
  /** 삭제 페이지를 파일에서 제거. SQLite 만 의미 있음(구현 참고). */
  vacuum(): Promise<void>;
}

export interface BackupConfig {
  dir: string;
  maxAgeDays: number;
}

/**
 * env → 백업 정리 설정. WS_BACKUP_MAX_AGE_DAYS 는 1 이상 BACKUP_RETENTION_DAYS(7) 이하 정수(scripts/prune-backups.sh 와 같은 규칙),
 *   아니면 throw(기동 실패). 상한(101 MED-1): 묘비 보존(retainUntil = 삭제·재적용 + 7일)보다 오래 남는 백업은 복원 시 지운 계정을
 *   되살린다 — /privacy·L8 의 '백업 7일' 표기와도 어긋난다. 늘리려면 policy.ts 를 바꾸고 처리방침을 다시 고지한다.
 */
export function resolveBackupConfig(env: NodeJS.ProcessEnv): BackupConfig {
  const rawDir = env[BACKUP_DIR_ENV];
  const dir = typeof rawDir === 'string' && rawDir.trim() !== '' ? rawDir : DEFAULT_BACKUP_DIR;
  const rawAge = env[BACKUP_MAX_AGE_ENV];
  if (rawAge === undefined || rawAge === '') return { dir, maxAgeDays: BACKUP_RETENTION_DAYS };
  if (!/^[0-9]+$/.test(rawAge) || Number(rawAge) < 1) {
    throw new Error(`${BACKUP_MAX_AGE_ENV} 는 1 이상의 정수여야 한다(0·음수·비숫자 거부)`);
  }
  if (Number(rawAge) > BACKUP_RETENTION_DAYS) {
    throw new Error(`${BACKUP_MAX_AGE_ENV} 는 ${BACKUP_RETENTION_DAYS} 이하여야 한다(묘비·처리방침 보존 기간 초과 거부)`);
  }
  return { dir, maxAgeDays: Number(rawAge) };
}

const BACKUP_FILE = /^prod-.*\.db$/;

/**
 * 백업 나이 정리(런타임, P6 sh 의 ① 나이 상한과 같은 대상): dir 의 prod-*.db 중 mtime < beforeMs 를 짝 파일(-journal·-wal)과 함께 삭제.
 *   개수 상한(WS_BACKUP_KEEP)은 기동 시 sh 몫 — 여기서는 나이만. 디렉터리 없으면 0.
 */
export async function pruneBackupsByAge(dir: string, beforeMs: number): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ENOENT') return 0;
    throw err;
  }
  let n = 0;
  for (const name of names) {
    if (!BACKUP_FILE.test(name)) continue;
    const file = join(dir, name);
    const st = await stat(file);
    if (!st.isFile() || !(st.mtimeMs < beforeMs)) continue;
    for (const f of [file, `${file}-journal`, `${file}-wal`]) await rm(f, { force: true });
    n++;
  }
  return n;
}

export interface RetentionReport {
  users: number;
  magicTokens: number;
  sessions: number;
  events: number;
  reactions: number;
  tombstones: number;
  backups: number;
  vacuumed: boolean;
}

export interface RetentionDeps {
  store: RetentionStore;
  erasure: ErasureStore;
  backup: BackupConfig;
  log?: PrivacyLog;
  /** 테스트 주입(기본 pruneBackupsByAge). */
  pruneBackups?: (dir: string, beforeMs: number) => Promise<number>;
}

export function retentionLogLine(r: RetentionReport): string {
  return (
    `[privacy] retention users=${r.users} magicTokens=${r.magicTokens} sessions=${r.sessions} events=${r.events}` +
    ` reactions=${r.reactions} tombstones=${r.tombstones} backups=${r.backups} vacuum=${r.vacuumed ? 'yes' : 'no'}`
  );
}

export async function runRetention(deps: RetentionDeps, now: Date): Promise<RetentionReport> {
  const log = deps.log ?? stdoutLog;
  const c = computeCutoffs(now, deps.backup.maxAgeDays);
  const { store, erasure } = deps;

  let users = 0;
  for (const userId of pickUnusedUsers(await store.listUserActivity(), c.unusedUserIso)) {
    users += (await eraseAccount(erasure, { userId }, 'RETENTION', now, log)).users;
  }
  const report: RetentionReport = {
    users,
    magicTokens: await store.deleteExpiredMagicTokens(c.magicTokenIso),
    sessions: await store.deleteInactiveSessions(c.sessionIso),
    events: await store.deleteEventsBefore(c.eventDate),
    reactions: await store.deleteReactionsBefore(c.reactionIso),
    tombstones: await erasure.pruneTombstones(c.tombstoneIso),
    backups: await (deps.pruneBackups ?? pruneBackupsByAge)(deps.backup.dir, c.backupBeforeMs),
    vacuumed: false,
  };
  await store.vacuum();
  report.vacuumed = true;
  log(retentionLogLine(report));
  return report;
}

export interface RetentionSchedule {
  /** 기동 시 첫 실행(실패해도 reject 하지 않는다). */
  first: Promise<void>;
  stop(): void;
}

/** 기동 1회 + intervalMs 마다(unref — 종료를 막지 않는다). 겹치는 실행은 건너뛴다. 실패는 오류 이름·코드만 로그. */
export function startRetentionSchedule(
  run: () => Promise<unknown>,
  opts: { intervalMs?: number; log?: PrivacyLog } = {},
): RetentionSchedule {
  const log = opts.log ?? stdoutLog;
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (err) {
      const e = err as { name?: unknown; code?: unknown };
      log(`[privacy] retention failed (${String(e.name ?? 'Error')}${e.code !== undefined ? ` ${String(e.code)}` : ''})`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs ?? RETENTION_INTERVAL_MS);
  timer.unref();
  return { first: tick(), stop: () => clearInterval(timer) };
}
