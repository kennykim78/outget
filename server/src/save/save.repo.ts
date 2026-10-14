// 저장(C-R5-2) 저장소 포트 + 인메모리 구현. Prisma 구현은 save.prisma.repo.ts.
//   시각은 모두 ISO 문자열(toISOString) — 사전순 비교 = 시간순.
//   원문 토큰·세션 id 는 이 계층에 들어오지 않는다(호출부가 sha256 hex 로만 넘긴다).

export interface MagicTokenRow {
  tokenHash: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface MagicTokenRepository {
  insert(row: MagicTokenRow): Promise<void>;
  /** 미사용 ∧ now < expiresAt 이면 원자적으로 consumedAt=now 기록 후 email, 아니면 null(1회용). */
  consume(tokenHash: string, nowIso: string): Promise<string | null>;
  /** R6 C2: expiresAt ≤ cutoffIso 인 행(소비 여부 무관) 삭제, 삭제 수. 만료 행은 consume 이 어차피 null 이라 판정 불변. */
  deleteExpired(cutoffIso: string): Promise<number>;
}

export interface SessionRow {
  sidHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface SessionRepository {
  insert(row: SessionRow): Promise<void>;
  /** 미폐기 ∧ now < expiresAt 인 세션의 userId, 아니면 null. */
  findActiveUserId(sidHash: string, nowIso: string): Promise<string | null>;
  revoke(sidHash: string, nowIso: string): Promise<void>;
  /**
   * R6 C2 사용자별 세션 상한: userId 의 활성 세션(미폐기 ∧ now < expiresAt) 중 keepSidHash 를 빼고
   *   createdAt 최신순(동시각은 sidHash 사전순)으로 max-1 개만 남기고 나머지를 폐기(revokedAt=now). 폐기 수.
   *   keepSidHash(방금 발급한 세션)는 절대 폐기하지 않는다.
   */
  enforceCap(userId: string, keepSidHash: string, max: number, nowIso: string): Promise<number>;
  /** R6 C2: expiresAt ≤ cutoffIso 이거나 revokedAt ≤ cutoffIso 인 행 삭제, 삭제 수. 비활성 행만 지우므로 판정 불변. */
  deleteInactive(cutoffIso: string): Promise<number>;
}

export interface SaveSnapshotRow {
  userId: string;
  v: number;
  payload: string;
  updatedAt: string;
}

/** 조건부 쓰기 결과. ok=false = 기준 시각이 지금 행과 다름(다른 기기가 먼저 씀) — current = 지금 행(없으면 null). */
export type SavePutResult = { ok: true } | { ok: false; current: SaveSnapshotRow | null };

export interface SaveSnapshotRepository {
  get(userId: string): Promise<SaveSnapshotRow | null>;
  /** 무조건 덮어쓰기(테스트·운영 도구용). 라우트 PUT 은 putIfMatch 만 쓴다(H1 낙관적 동시성). */
  put(row: SaveSnapshotRow): Promise<void>;
  /**
   * 낙관적 동시성(H1): 지금 행의 updatedAt 이 baseUpdatedAt 과 같을 때만 쓴다(행 없음 = null 과 같음).
   *   비교·쓰기는 원자적(동시 요청 둘 중 하나만 ok). row.updatedAt 은 base 보다 커야 한다(호출부 책임).
   */
  putIfMatch(row: SaveSnapshotRow, baseUpdatedAt: string | null): Promise<SavePutResult>;
}

export class InMemoryMagicTokenRepository implements MagicTokenRepository {
  private readonly rows = new Map<string, MagicTokenRow>();

  async insert(row: MagicTokenRow): Promise<void> {
    this.rows.set(row.tokenHash, { ...row });
  }

  async consume(tokenHash: string, nowIso: string): Promise<string | null> {
    const r = this.rows.get(tokenHash);
    if (!r || r.consumedAt !== null || !(nowIso < r.expiresAt)) return null;
    r.consumedAt = nowIso;
    return r.email;
  }

  async deleteExpired(cutoffIso: string): Promise<number> {
    let n = 0;
    for (const [k, r] of this.rows) {
      if (r.expiresAt <= cutoffIso) {
        this.rows.delete(k);
        n++;
      }
    }
    return n;
  }

  /** 테스트 관찰용. */
  size(): number {
    return this.rows.size;
  }

  dump(): MagicTokenRow[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}

/** 세션 상한 순서(InMemory·Prisma 동일): createdAt 내림차순, 같으면 sidHash 오름차순. */
export function newestFirst(a: Pick<SessionRow, 'createdAt' | 'sidHash'>, b: Pick<SessionRow, 'createdAt' | 'sidHash'>): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.sidHash < b.sidHash ? -1 : a.sidHash > b.sidHash ? 1 : 0;
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly rows = new Map<string, SessionRow>();

  async insert(row: SessionRow): Promise<void> {
    this.rows.set(row.sidHash, { ...row });
  }

  async findActiveUserId(sidHash: string, nowIso: string): Promise<string | null> {
    const r = this.rows.get(sidHash);
    if (!r || r.revokedAt !== null || !(nowIso < r.expiresAt)) return null;
    return r.userId;
  }

  async revoke(sidHash: string, nowIso: string): Promise<void> {
    const r = this.rows.get(sidHash);
    if (r && r.revokedAt === null) r.revokedAt = nowIso;
  }

  async enforceCap(userId: string, keepSidHash: string, max: number, nowIso: string): Promise<number> {
    const others = [...this.rows.values()]
      .filter((r) => r.userId === userId && r.sidHash !== keepSidHash && r.revokedAt === null && nowIso < r.expiresAt)
      .sort(newestFirst);
    const victims = others.slice(Math.max(0, max - 1));
    for (const r of victims) r.revokedAt = nowIso;
    return victims.length;
  }

  async deleteInactive(cutoffIso: string): Promise<number> {
    let n = 0;
    for (const [k, r] of this.rows) {
      if (r.expiresAt <= cutoffIso || (r.revokedAt !== null && r.revokedAt <= cutoffIso)) {
        this.rows.delete(k);
        n++;
      }
    }
    return n;
  }

  dump(): SessionRow[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}

export class InMemorySaveSnapshotRepository implements SaveSnapshotRepository {
  private readonly rows = new Map<string, SaveSnapshotRow>();

  async get(userId: string): Promise<SaveSnapshotRow | null> {
    const r = this.rows.get(userId);
    return r ? { ...r } : null;
  }

  async put(row: SaveSnapshotRow): Promise<void> {
    this.rows.set(row.userId, { ...row });
  }

  async putIfMatch(row: SaveSnapshotRow, baseUpdatedAt: string | null): Promise<SavePutResult> {
    // 동기 구간(await 없음) — 비교와 쓰기 사이에 다른 요청이 끼지 않는다.
    const cur = this.rows.get(row.userId);
    if ((cur?.updatedAt ?? null) !== baseUpdatedAt) return { ok: false, current: cur ? { ...cur } : null };
    this.rows.set(row.userId, { ...row });
    return { ok: true };
  }
}
