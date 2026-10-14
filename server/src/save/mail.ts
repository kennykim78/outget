// 메일 발송 포트(계약 C-R5-2, D19). 발송만 — 수신·추적·결제 없음(불변식 ④).
//   운영 공급자 = Resend HTTP API(Kenny 결정 K2/Q3①). 가입·발신 도메인 SPF/DKIM 은 Kenny 가 한다(코드는 키만 읽는다).
//   ConsoleMailTransport 는 development·test 전용: 그 밖의 NODE_ENV(미설정 포함)에서 생성 자체가 throw,
//   로그의 이메일은 마스킹.
//   ResendMailTransport: 신규 의존성 0 — 전역 fetch 로 POST https://api.resend.com/emails 1회.
//     API 키는 로그·예외 메시지·inspect 어디에도 나오지 않는다(# private). 이메일은 마스킹 로그만.
//     비2xx·네트워크 오류·타임아웃 → throw → 라우트의 기존 503 SAVE_UNAVAILABLE 경로.
import { isProdLike } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

/** k***@e***.com — 첫 글자·도메인 첫 글자·마지막 라벨만 남긴다. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot >= 0 ? domain.slice(dot) : '';
  return `${local[0]}***@${domain[0] ?? ''}***${tld}`;
}

export interface ConsoleMailOptions {
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
}

export class ConsoleMailTransport implements MailTransport {
  private readonly log: (line: string) => void;

  constructor(opts: ConsoleMailOptions = {}) {
    const env = opts.env ?? process.env;
    if (isProdLike(env)) {
      throw new Error('ConsoleMailTransport: development·test 에서만 쓸 수 있어요(D19, SEC-3 L-6)');
    }
    // eslint-disable-next-line no-console
    this.log = opts.log ?? ((line) => console.info(line));
  }

  async send(message: MailMessage): Promise<void> {
    // dev 는 링크를 콘솔에서 연다(본문 그대로). 수신 주소는 마스킹.
    this.log(`[mail:console] to=${maskEmail(message.to)} subject=${message.subject}\n${message.text}`);
  }
}

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
export const RESEND_TIMEOUT_MS = 10_000;

/** 전역 fetch 의 최소 부분집합 — 테스트가 가짜를 주입한다. */
export type FetchLike = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; body?: { cancel(): Promise<void> } | null }>;

export interface ResendMailOptions {
  apiKey: string;
  /** 'WithSmall <noreply@도메인>' 또는 주소만. 도메인은 Resend 에서 SPF/DKIM 검증된 것(Kenny). */
  from: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export class ResendMailTransport implements MailTransport {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #log: (line: string) => void;

  constructor(opts: ResendMailOptions) {
    if (opts.apiKey.trim() === '' || /\s/.test(opts.apiKey)) throw new Error('ResendMailTransport: RESEND_API_KEY 형식 오류');
    if (opts.from.trim() === '' || /[\r\n]/.test(opts.from)) throw new Error('ResendMailTransport: MAIL_FROM 형식 오류');
    this.#apiKey = opts.apiKey;
    this.#from = opts.from;
    this.#fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.#timeoutMs = opts.timeoutMs ?? RESEND_TIMEOUT_MS;
    // eslint-disable-next-line no-console
    this.#log = opts.log ?? ((line) => console.warn(line));
  }

  async send(message: MailMessage): Promise<void> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.#timeoutMs);
    const masked = maskEmail(message.to);
    let status: number;
    try {
      const res = await this.#fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.#from, to: [message.to], subject: message.subject, text: message.text }),
        signal: ctrl.signal,
      });
      status = res.status;
      // 응답 본문은 읽지 않는다(수신 주소가 되울려 올 수 있음) — 연결만 놓아 준다.
      await res.body?.cancel().catch(() => undefined);
      if (!res.ok) {
        this.#log(`[mail:resend] fail to=${masked} status=${status}`);
        throw new Error(`ResendMailTransport: HTTP ${status}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('ResendMailTransport: HTTP')) throw err;
      const reason = ctrl.signal.aborted ? 'timeout' : 'network';
      this.#log(`[mail:resend] fail to=${masked} reason=${reason}`);
      // 원인 객체는 붙이지 않는다(요청 init·헤더가 딸려 올 여지 차단).
      throw new Error(`ResendMailTransport: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
