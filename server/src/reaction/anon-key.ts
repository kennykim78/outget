// 익명 반응 키(C-R5-3, SEC-3 M-3 재설계). IP·UA 원문은 어디에도 저장하지 않는다(불변식 ⑧).
//   anonKey(day) = HMAC-SHA256(secret, seoulDate + "|" + ipPrefix) hex.
//   - UA 제외: UA 회전으로 같은 사람이 여러 번 세는 것(♥ 임계 10 위조)을 막는다.
//   - ipPrefix: IPv4 /24, IPv6 /64(IPv4-mapped IPv6 는 IPv4 로). 같은 /24 의 여러 사람은 1명으로 묶인다 — 과소 집계 쪽으로
//     안전(♥ 수는 표시 전용, 노출·순서 영향 0). 프리픽스 원문도 저장하지 않는다(HMAC 입력일 뿐).
//   - 날짜 솔트: 저장 키가 날마다 바뀌어 DB 만으로는 날짜 간 연결 불가(시크릿 보유 서버는 재계산 가능 — 서버 전용 방식의 한계).
//   - 중복·취소: 서버가 오늘부터 REACTION_KEY_WINDOW_DAYS 일 전까지의 키를 재계산해(HMAC 400회, 수 ms) 그 안에 같은 대상·종류
//     행이 있으면 POST 는 아무것도 안 하고, DELETE 는 창 안의 모든 키 행을 지운다 — 며칠 뒤 취소도 동작.
//     창보다 오래된 행은 취소·중복 판정 밖 → 보존 기한(K4)을 창 이하로 두고 정리해야 한다(보고).
//   시크릿: REACTION_KEY_SECRET(≥32자, 운영 주입 = Kenny K3). development·test 만 비면 프로세스 랜덤, 그 밖의 NODE_ENV(미설정 포함)는 기동 실패.
import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { isProdLike } from '../config/env.js';
import { seoulToday } from '../prerender/cli.js';

export const MIN_SECRET_LENGTH = 32;
/** 중복·취소 판정 창(일). 오늘 포함. */
export const REACTION_KEY_WINDOW_DAYS = 400;

/** SEC-3 L-6: development·test 외 모든 NODE_ENV(미설정·오타 포함)를 운영으로 본다 — BE1 공용 isProdLike(config/env.ts) 위임. */
export function isProdLikeEnv(nodeEnv: string | undefined): boolean {
  return isProdLike({ NODE_ENV: nodeEnv });
}

function expandIpv6(ip: string): number[] | null {
  let s = ip.split('%')[0].toLowerCase();
  // 끝에 붙은 IPv4(::ffff:1.2.3.4 등) → 16비트 두 조각
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    const o = v4[1].split('.').map(Number);
    if (o.some((x) => x > 255)) return null;
    s = s.slice(0, -v4[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (x: string): number[] => (x === '' ? [] : x.split(':').map((g) => parseInt(g, 16)));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<number>(fill).fill(0), ...tail];
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

/** IP → 집계 프리픽스 문자열. IPv4 /24 "v4:a.b.c", IPv6 /64 "v6:g0:g1:g2:g3", 해석 불가 "unknown". */
export function ipPrefix(ip: string): string {
  const raw = typeof ip === 'string' ? ip.trim() : '';
  const kind = isIP(raw.split('%')[0]);
  if (kind === 4) return `v4:${raw.split('.').slice(0, 3).map(Number).join('.')}`;
  if (kind === 6) {
    const g = expandIpv6(raw);
    if (!g) return 'unknown';
    // IPv4-mapped(::ffff:a.b.c.d) → IPv4 규칙
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return `v4:${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}`;
    }
    return `v6:${g.slice(0, 4).map((x) => x.toString(16)).join(':')}`;
  }
  return 'unknown';
}

export function anonKey(secret: string, seoulDate: string, prefix: string): string {
  return createHmac('sha256', secret).update(`${seoulDate}|${prefix}`, 'utf8').digest('hex');
}

/** 'YYYY-MM-DD' 에서 n 일 전(달력 산술, 시계 무관). */
export function daysBefore(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

export interface AnonKeyerOptions {
  /** 기본 process.env.REACTION_KEY_SECRET. */
  secret?: string;
  /** 기본 process.env.NODE_ENV. */
  nodeEnv?: string;
  /** 기본 () => new Date(). */
  now?: () => Date;
}

export interface AnonKeyer {
  /** 오늘 키(새 행 저장용). */
  today(ip: string): string;
  /** 오늘부터 창 끝까지의 키(오늘이 [0]) — 중복 판정·취소용. */
  window(ip: string): string[];
}

export function resolveReactionSecret(secret: string | undefined, nodeEnv: string | undefined): string {
  const s = typeof secret === 'string' ? secret.trim() : '';
  if (s.length >= MIN_SECRET_LENGTH) return s;
  if (isProdLikeEnv(nodeEnv)) {
    throw new Error(`REACTION_KEY_SECRET 이 없거나 ${MIN_SECRET_LENGTH}자 미만이다 — development·test 외에는 필수(K3)`);
  }
  return randomBytes(32).toString('hex');
}

export function createAnonKeyer(opts: AnonKeyerOptions = {}): AnonKeyer {
  const secret = resolveReactionSecret(
    Object.prototype.hasOwnProperty.call(opts, 'secret') ? opts.secret : process.env.REACTION_KEY_SECRET,
    Object.prototype.hasOwnProperty.call(opts, 'nodeEnv') ? opts.nodeEnv : process.env.NODE_ENV,
  );
  const now = opts.now ?? (() => new Date());
  return {
    today: (ip) => anonKey(secret, seoulToday(now()), ipPrefix(ip)),
    window: (ip) => {
      const today = seoulToday(now());
      const p = ipPrefix(ip);
      return Array.from({ length: REACTION_KEY_WINDOW_DAYS }, (_, i) => anonKey(secret, daysBefore(today, i), p));
    },
  };
}
