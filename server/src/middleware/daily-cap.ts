// 일일 전역 저장 상한(264, security 257 3c MED·3d) — IP 리미터와 별개로 "하루에 저장하는 행 수" 전체에 상한을 둔다.
//   다중 IP 로 리미터를 피해도 디스크(1 OCPU·SQLite·/data 한 볼륨)가 차지 않게. 넘친 요청은 응답 형태를 바꾸지 않고 조용히 버린다
//   (이벤트 204·제보 202 그대로 — 클라이언트 흐름이 깨지지 않는다).
//   세는 방식: 메모리 카운터 + 서울 날짜 경계. 날짜가 바뀔 때(기동 직후 첫 요청 포함) 저장소에서 그날 행 수를 한 번 센다
//   → 매 요청 COUNT 쿼리 없음, 재기동해도 그날 이미 저장한 수에서 이어 센다. 단일 프로세스(단일 컨테이너) 전제.
import { createHmac, randomBytes } from 'node:crypto';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 서울 날짜 YYYY-MM-DD(UTC+9 고정, 서머타임 없음 — analytics seoulDate·prerender seoulToday 와 같은 규칙). */
export function seoulDay(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 날짜(YYYY-MM-DD, 서울) → 그날 이미 저장된 행 수. 기동 뒤·날짜가 바뀔 때 한 번만 부른다. */
export type DailyCountRestore = (date: string) => Promise<number>;

export interface DailyCapTake {
  /** 저장해도 되는 개수(0..n). */
  allowed: number;
  /** release 에 넘길 날짜. */
  date: string;
}

/** 상한을 그날 처음 쳤을 때 1회 부르는 알림(날짜·상한 숫자만 — 식별자 0, security 264 ④a). */
export type DailyCapHitLog = (date: string, limit: number) => void;

/** 기본 알림 줄: `[cap] <이름> daily cap reached date=YYYY-MM-DD limit=N`(stdout → journald 7일). */
export function capHitLogger(
  name: string,
  // eslint-disable-next-line no-console
  out: (line: string) => void = (l) => console.log(l),
): DailyCapHitLog {
  return (date, limit) => out(`[cap] ${name} daily cap reached date=${date} limit=${limit}`);
}

export class DailyCap {
  private date = '';
  private used = 0;
  private hitDate = '';
  private loading: { date: string; p: Promise<void> } | null = null;

  constructor(
    readonly limit: number,
    private readonly restore?: DailyCountRestore,
    private readonly dayOf: (now: Date) => string = seoulDay,
    private readonly onFirstHit?: DailyCapHitLog,
  ) {
    if (!Number.isInteger(limit) || limit < 0) throw new Error(`DailyCap: limit=${limit} 는 0 이상 정수여야 한다`);
  }

  /** n 개를 저장하려 할 때 허용 개수만큼 미리 잡는다(동시 요청에도 상한을 넘지 않게 await 없이 증가). 복원 실패는 throw(호출자 500). */
  async take(n: number, now: Date): Promise<DailyCapTake> {
    const d = this.dayOf(now);
    if (d !== this.date) await this.roll(d);
    if (d !== this.date) return { allowed: 0, date: d }; // 복원 중 날짜가 또 바뀐 경우(드묾) — 버린다
    const allowed = Math.max(0, Math.min(n, this.limit - this.used));
    this.used += allowed;
    if (allowed < n && this.hitDate !== d) {
      this.hitDate = d;
      this.onFirstHit?.(d, this.limit);
    }
    return { allowed, date: d };
  }

  /** 저장 실패 시 잡았던 개수를 돌려준다(같은 날짜일 때만). */
  release(t: DailyCapTake): void {
    if (t.date === this.date) this.used = Math.max(0, this.used - t.allowed);
  }

  /** 시험·관찰용: 지금 날짜와 센 수. */
  snapshot(): { date: string; used: number } {
    return { date: this.date, used: this.used };
  }

  private roll(d: string): Promise<void> {
    if (this.loading?.date === d) return this.loading.p;
    const slot: { date: string; p: Promise<void> } = { date: d, p: Promise.resolve() };
    this.loading = slot;
    slot.p = (async () => {
      try {
        const c = this.restore ? await this.restore(d) : 0;
        if (this.loading !== slot) return; // 그새 다른 날짜로 넘어감
        this.date = d;
        this.used = Math.max(0, Math.trunc(c));
      } finally {
        if (this.loading === slot) this.loading = null;
      }
    })();
    return slot.p;
  }
}

/** 익명 이벤트(EventLog) 하루 저장 행 상한 env. */
export const EVENT_DAILY_CAP_ENV = 'WS_EVENT_DAILY_CAP';
/**
 * 기본 10,000행/일(264 근거): EventLog 한 행 ≈ 250B(id·이름·시각·props 허용목록 JSON 수십 B·sessionKey·날짜 + 인덱스 2개),
 *   props 최대(1KB)로 잡아도 ≈ 1.4KB. 90일 보존 → 평균 ≈ 225MB, 최악 ≈ 1.3GB.
 *   DB 와 같은 /data 에 VACUUM 임시 사본(1배) + 기동 백업 5개(WS_BACKUP_KEEP)가 붙으므로 최악 ≈ 7배 ≈ 9GB — 기본 부트 볼륨(≈ 47GB)에서 여유.
 *   Phase 0 정상 사용(하루 방문 수백 × 방문당 이벤트 수십)은 이 안에 든다. 넘치면 그날 남은 이벤트만 버린다(통계 일부 손실, 기능 영향 0).
 */
export const DEFAULT_EVENT_DAILY_CAP = 10_000;

/** 병원 제보(VetClinic USER_REPORT) 하루 저장 상한 env. */
export const VET_REPORT_DAILY_CAP_ENV = 'WS_VET_REPORT_DAILY_CAP';
/**
 * 기본 100건/일: 정상 제보는 Phase 0 에 하루 몇 건. 운영자가 전화로 확인하는 대기열이 다중 IP 스팸에 묻히지 않게(행 ≈ 0.5KB라 디스크는 문제 아님).
 *   180일 보존 × 100 = 최대 18,000행 ≈ 9MB.
 */
export const DEFAULT_VET_REPORT_DAILY_CAP = 100;

/** env 값 → 상한. 비우면 기본값, 0 이상 정수만(0 = 그 저장을 끈다). 아니면 throw(기동 실패 — WS_BACKUP_KEEP 와 같은 엄격함). */
export function resolveDailyCap(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const t = raw.trim();
  if (!/^[0-9]+$/.test(t) || !Number.isSafeInteger(Number(t))) throw new Error(`${name} 는 0 이상의 정수여야 한다(비숫자·음수·소수 거부)`);
  return Number(t);
}

/** 병원 제보 IP별 하루 한도 env(security 264 ④b). */
export const VET_REPORT_PER_IP_DAILY_ENV = 'WS_VET_REPORT_PER_IP_DAILY';
/** 기본 10건/일/IP — 정상 제보자는 하루 몇 건. 한 곳이 전역 100건을 혼자 다 쓰지 못하게(IP 5/시간 리미터만으로는 하루 120건). */
export const DEFAULT_VET_REPORT_PER_IP_DAILY = 10;
/** 하루 표에 담는 키 최대 수(메모리 상한). 넘치면 새 키는 IP 한도 없이 전역 상한에만 맡긴다. */
export const PER_KEY_MAX_KEYS = 50_000;

/**
 * 키(IP)별 하루 한도 — 프로세스 메모리 전용(security 264 ④b, 불변식 ⑧·처리방침 "IP 저장하지 않아요").
 *   원문 IP 는 표에 넣지 않는다: 그날의 무작위 키로 만든 HMAC 앞부분만 키로 쓰고, 서울 날짜가 바뀌면 표와 무작위 키를 함께 버린다.
 *   DB·파일·로그에 쓰는 경로 없음. 재기동하면 비워진다(전역 상한은 DB 에서 복원되므로 상한 자체는 유지).
 */
export class PerKeyDailyLimit {
  private date = '';
  private salt = randomBytes(32);
  private readonly counts = new Map<string, number>();

  constructor(
    readonly limit: number,
    private readonly maxKeys: number = PER_KEY_MAX_KEYS,
    private readonly dayOf: (now: Date) => string = seoulDay,
  ) {
    if (!Number.isInteger(limit) || limit < 0) throw new Error(`PerKeyDailyLimit: limit=${limit} 는 0 이상 정수여야 한다`);
  }

  /** 이 키로 하나 더 받아도 되면 true(세고), 한도면 false(세지 않음). */
  hit(rawKey: string, now: Date): boolean {
    const d = this.dayOf(now);
    if (d !== this.date) {
      this.date = d;
      this.counts.clear();
      this.salt = randomBytes(32);
    }
    const k = createHmac('sha256', this.salt).update(rawKey).digest('base64url').slice(0, 22);
    const c = this.counts.get(k) ?? 0;
    if (c >= this.limit) return false;
    if (c === 0 && this.counts.size >= this.maxKeys) return true;
    this.counts.set(k, c + 1);
    return true;
  }

  /** 시험·관찰용: 날짜와 키 수, 키 목록(원문 IP 가 없음을 확인하는 용도). */
  snapshot(): { date: string; keys: string[] } {
    return { date: this.date, keys: [...this.counts.keys()] };
  }
}
