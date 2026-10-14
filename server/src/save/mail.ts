// 메일 발송 포트(계약 C-R5-2, D19). 발송만 — 수신·추적·결제 없음(불변식 ④).
//   운영 공급자 구현은 Kenny 결정(K2: 공급자·발신 도메인 SPF/DKIM) 전까지 없다. 공급자 가입 금지.
//   ConsoleMailTransport 는 development·test 전용: 그 밖의 NODE_ENV(미설정 포함)에서 생성 자체가 throw,
//   로그의 이메일은 마스킹.
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
