// P1 기간 상수(Kenny K-1) · P5 순수 cutoff·대상 선택·스케줄·백업 나이 정리 · anon-key 창 검사.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as policy from '../privacy/policy.js';
import { MAGIC_TOKEN_RETENTION_MS, SESSION_RETENTION_MS } from '../save/session.js';
import { assertReactionRetentionWithinWindow, daysBefore, REACTION_KEY_WINDOW_DAYS } from '../reaction/anon-key.js';
import {
  computeCutoffs,
  lastActivityIso,
  pickUnusedUsers,
  pruneBackupsByAge,
  resolveBackupConfig,
  runRetention,
  seoulDayStartIso,
  startRetentionSchedule,
  type RetentionStore,
  type UserActivity,
} from '../privacy/retention.js';
import { ZERO_COUNTS, tombstoneVictims, tombstoneKey, type ErasureStore } from '../privacy/erase.js';

const DAY = 24 * 60 * 60 * 1000;

describe('P1 policy.ts — K-1 값', () => {
  it('기간 상수', () => {
    expect(policy.UNUSED_USER_RETENTION_DAYS).toBe(365);
    expect(policy.EVENT_LOG_RETENTION_DAYS).toBe(90);
    expect(policy.REACTION_RETENTION_DAYS).toBe(400);
    expect(policy.BACKUP_RETENTION_DAYS).toBe(7);
    expect(policy.TOMBSTONE_RETENTION_DAYS).toBe(7);
    expect(policy.TOMBSTONE_RETENTION_DAYS).toBe(policy.BACKUP_RETENTION_DAYS);
    expect(policy.RETENTION_INTERVAL_MS).toBe(DAY);
    expect(policy.BACKUP_MAX_AGE_ENV).toBe('WS_BACKUP_MAX_AGE_DAYS');
  });

  it('session.ts 의 토큰·세션 보존 상수는 policy.ts 와 같은 값(재노출)', () => {
    expect(MAGIC_TOKEN_RETENTION_MS).toBe(policy.MAGIC_TOKEN_RETENTION_MS);
    expect(SESSION_RETENTION_MS).toBe(policy.SESSION_RETENTION_MS);
  });

  it('반응 보존 ≤ anon-key 창 — 초과·0·비정수면 throw', () => {
    expect(policy.REACTION_RETENTION_DAYS).toBeLessThanOrEqual(REACTION_KEY_WINDOW_DAYS);
    expect(() => assertReactionRetentionWithinWindow()).not.toThrow();
    expect(() => assertReactionRetentionWithinWindow(400, 400)).not.toThrow();
    expect(() => assertReactionRetentionWithinWindow(401, 400)).toThrow(/REACTION_RETENTION_DAYS/);
    expect(() => assertReactionRetentionWithinWindow(0, 400)).toThrow();
    expect(() => assertReactionRetentionWithinWindow(1.5, 400)).toThrow();
  });
});

describe('P5 computeCutoffs (가짜 시계)', () => {
  const NOW = new Date('2026-10-25T03:00:00.000Z'); // 서울 10-25 12:00
  const c = computeCutoffs(NOW);

  it('EventLog: 오늘 포함 90개 서울 날짜', () => {
    expect(c.eventDate).toBe(daysBefore('2026-10-25', 89));
    // 서울 자정 직전·직후로 시계를 옮기면 기준일도 하루 움직인다
    expect(computeCutoffs(new Date('2026-10-25T14:59:59.999Z')).eventDate).toBe(c.eventDate);
    expect(computeCutoffs(new Date('2026-10-25T15:00:00.000Z')).eventDate).toBe(daysBefore(c.eventDate, -1));
  });

  it('Reaction: 창 첫날(오늘−399) 서울 00:00 — anon-key window 와 같은 범위', () => {
    expect(c.reactionIso).toBe(seoulDayStartIso(daysBefore('2026-10-25', REACTION_KEY_WINDOW_DAYS - 1)));
    expect(seoulDayStartIso('2026-10-25')).toBe('2026-10-24T15:00:00.000Z');
  });

  it('시각 기준: 미사용 365일 · 묘비 retainUntil < now(101 MED-2) · 백업 7일(env) · 토큰·세션 0', () => {
    expect(c.unusedUserIso).toBe(new Date(NOW.getTime() - 365 * DAY).toISOString());
    expect(c.tombstoneIso).toBe(NOW.toISOString());
    expect(c.backupBeforeMs).toBe(NOW.getTime() - 7 * DAY);
    expect(computeCutoffs(NOW, 3).backupBeforeMs).toBe(NOW.getTime() - 3 * DAY);
    expect(c.magicTokenIso).toBe(NOW.toISOString());
    expect(c.sessionIso).toBe(NOW.toISOString());
  });
});

describe('P5 미사용 User 선택', () => {
  const cutoff = '2025-10-25T03:00:00.000Z';
  const u = (p: Partial<UserActivity>): UserActivity => ({ id: 'u', role: 'USER', createdAt: '', lastSnapshotAt: null, lastSeenAt: null, ...p });

  it('마지막 활동 = 셋 중 최대', () => {
    expect(lastActivityIso(u({ createdAt: '2020-01-01T00:00:00.000Z', lastSnapshotAt: '2025-01-01T00:00:00.000Z', lastSeenAt: '2024-01-01T00:00:00.000Z' }))).toBe('2025-01-01T00:00:00.000Z');
    expect(lastActivityIso(u({ createdAt: '2020-01-01T00:00:00.000Z', lastSnapshotAt: '2024-01-01T00:00:00.000Z', lastSeenAt: '2025-06-01T00:00:00.000Z' }))).toBe('2025-06-01T00:00:00.000Z');
    expect(lastActivityIso(u({}))).toBe('');
  });

  it('±1일 경계, OPERATOR 제외, 근거 하나만 최근이어도 유지', () => {
    const day = (n: number) => new Date(Date.parse(cutoff) + n * DAY).toISOString();
    const users = [
      u({ id: 'old', createdAt: day(-1) }),
      u({ id: 'edge', createdAt: cutoff }), // = cutoff → 유지(< 만 삭제)
      u({ id: 'new', createdAt: day(1) }),
      u({ id: 'snap', createdAt: day(-100), lastSnapshotAt: day(1) }),
      u({ id: 'seen', createdAt: day(-100), lastSeenAt: day(1) }),
      u({ id: 'seenEdge', createdAt: day(-100), lastSeenAt: cutoff }), // = cutoff(정확히 365일) → 유지
      u({ id: 'seenOld', createdAt: day(-100), lastSeenAt: new Date(Date.parse(cutoff) - 1).toISOString() }), // 1ms 넘김 → 삭제
      u({ id: 'op', role: 'OPERATOR', createdAt: day(-999) }),
      u({ id: 'legacy', createdAt: '' }),
    ];
    expect(pickUnusedUsers(users, cutoff)).toEqual(['old', 'seenOld', 'legacy']);
  });
});

describe('P4 tombstoneVictims (순수)', () => {
  it('키 일치 ∧ createdAt < erasedAt', () => {
    const t = [{ emailSha256: tombstoneKey('a@x.co'), erasedAt: '2026-10-20T00:00:00.000Z' }];
    const users = [
      { id: '1', email: 'a@x.co', createdAt: '2026-10-19T23:59:59.999Z' },
      { id: '2', email: 'a@x.co', createdAt: '2026-10-20T00:00:00.000Z' },
      { id: '3', email: 'b@x.co', createdAt: '' },
    ];
    expect(tombstoneVictims(users, t).map((u) => u.id)).toEqual(['1']);
  });
});

describe('P5 runRetention (가짜 저장소) — 호출 순서·VACUUM 마지막', () => {
  it('미사용 User 판정 → 토큰 → 세션 → 이벤트 → 반응 → 묘비 → 백업 → VACUUM', async () => {
    const calls: string[] = [];
    const store: RetentionStore = {
      listUserActivity: async () => {
        calls.push('users');
        return [{ id: 'gone', role: 'USER', createdAt: '2000-01-01T00:00:00.000Z', lastSnapshotAt: null, lastSeenAt: null }];
      },
      deleteExpiredMagicTokens: async () => (calls.push('tokens'), 0),
      deleteInactiveSessions: async () => (calls.push('sessions'), 0),
      deleteEventsBefore: async () => (calls.push('events'), 0),
      deleteReactionsBefore: async () => (calls.push('reactions'), 0),
      vacuum: async () => void calls.push('vacuum'),
    };
    const erasure: ErasureStore = {
      eraseByEmail: async () => ({ ...ZERO_COUNTS }),
      eraseUser: async (id) => (calls.push(`erase:${id}`), { ...ZERO_COUNTS, users: 1 }),
      reapplyTombstones: async () => 0,
      pruneTombstones: async () => (calls.push('tombstones'), 0),
    };
    const lines: string[] = [];
    const r = await runRetention(
      { store, erasure, backup: { dir: 'x', maxAgeDays: 7 }, log: (l) => lines.push(l), pruneBackups: async () => (calls.push('backups'), 2) },
      new Date('2026-10-25T03:00:00.000Z'),
    );
    expect(calls).toEqual(['users', 'erase:gone', 'tokens', 'sessions', 'events', 'reactions', 'tombstones', 'backups', 'vacuum']);
    expect(r).toMatchObject({ users: 1, backups: 2, vacuumed: true });
    expect(lines).toEqual([
      '[privacy] erase channel=RETENTION',
      '[privacy] retention users=1 magicTokens=0 sessions=0 events=0 reactions=0 tombstones=0 backups=2 vacuum=yes',
    ]);
  });
});

describe('P5 startRetentionSchedule', () => {
  afterEach(() => vi.useRealTimers());

  it('기동 1회 + 24h 마다, 실패는 이름만 로그하고 계속, stop 후 멈춤', async () => {
    vi.useFakeTimers();
    let n = 0;
    const lines: string[] = [];
    const s = startRetentionSchedule(
      async () => {
        n++;
        if (n === 2) throw Object.assign(new Error('secret a@b.co'), { code: 'P1' });
      },
      { log: (l) => lines.push(l) },
    );
    await s.first;
    expect(n).toBe(1);
    await vi.advanceTimersByTimeAsync(DAY - 1);
    expect(n).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(n).toBe(2);
    expect(lines).toEqual(['[privacy] retention failed (Error P1)']);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(n).toBe(3);
    s.stop();
    await vi.advanceTimersByTimeAsync(3 * DAY);
    expect(n).toBe(3);
  });
});

describe('P5 백업 나이 정리', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('resolveBackupConfig: 기본 /data/backup·7, 1 이상 정수만', () => {
    expect(resolveBackupConfig({})).toEqual({ dir: '/data/backup', maxAgeDays: 7 });
    expect(resolveBackupConfig({ WS_BACKUP_DIR: '/b', WS_BACKUP_MAX_AGE_DAYS: '3' })).toEqual({ dir: '/b', maxAgeDays: 3 });
    for (const bad of ['0', '-1', 'x', '1.5', ' 7']) {
      expect(() => resolveBackupConfig({ WS_BACKUP_MAX_AGE_DAYS: bad })).toThrow(/WS_BACKUP_MAX_AGE_DAYS/);
    }
  });

  it('101 MED-1: WS_BACKUP_MAX_AGE_DAYS > BACKUP_RETENTION_DAYS(7) 는 기동 거부(7 은 허용)', () => {
    expect(resolveBackupConfig({ WS_BACKUP_MAX_AGE_DAYS: String(policy.BACKUP_RETENTION_DAYS) }).maxAgeDays).toBe(7);
    for (const over of ['8', '30', '365']) {
      expect(() => resolveBackupConfig({ WS_BACKUP_MAX_AGE_DAYS: over })).toThrow(/7 이하/);
    }
  });

  it('prod-*.db 중 기준보다 오래된 것만 짝 파일과 함께 삭제, 다른 파일·없는 디렉터리 무해', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ws-backup-'));
    const now = Date.parse('2026-10-25T00:00:00.000Z');
    const mk = (name: string, ageDays: number) => {
      const f = join(dir, name);
      writeFileSync(f, 'x');
      const t = new Date(now - ageDays * DAY) ;
      utimesSync(f, t, t);
    };
    mk('prod-old.db', 8);
    mk('prod-old.db-journal', 8);
    mk('prod-old.db-wal', 8);
    mk('prod-edge.db', 6.99);
    mk('prod-new.db', 1);
    mk('other.db', 30);
    const n = await pruneBackupsByAge(dir, now - 7 * DAY);
    expect(n).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(['other.db', 'prod-edge.db', 'prod-new.db']);
    expect(await pruneBackupsByAge(join(dir, 'missing'), now)).toBe(0);
  });
});
