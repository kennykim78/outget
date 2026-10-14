// 저장(매직링크) 실행 설정 — 기동 시 1회 해석, fail-closed(D19, K2·K7).
//   PUBLIC_ORIGIN: 메일 링크의 오리진. 요청 Host 헤더로 만들지 않는다(호스트 헤더 주입으로 링크 탈취 방지).
//   '운영' = isProdLike(NODE_ENV 가 development·test 가 아니면 전부 — 미설정 포함, SEC-3 L-6).
//     dev 기본 = http://localhost:5173(Vite dev 서버 — /save 는 클라이언트 라우트, /auth·/api 는 프록시).
//     production 미설정 → throw(잘못된 링크를 보내느니 기동 실패). production 은 https(루프백만 http 예외).
//   MAIL_TRANSPORT: 미설정 → dev/test 는 console, production 은 null(요청 503 SAVE_UNAVAILABLE).
//     'console' + production → throw.
//     'resend'(Kenny 결정 K2/Q3①) → RESEND_API_KEY·MAIL_FROM 필수, 누락이면 throw(기동 실패 목록 — env.ts collectEnvProblems).
//       오류 메시지엔 변수 이름만, 값은 절대 넣지 않는다. 그 밖의 값 → throw.
import { isProdLike } from '../config/env.js';
import { ConsoleMailTransport, ResendMailTransport, type MailTransport } from './mail.js';

export const DEV_PUBLIC_ORIGIN = 'http://localhost:5173';

export interface SaveConfig {
  publicOrigin: string;
  /** null = 메일 공급자 없음 → POST /auth/magic/request 503. */
  transport: MailTransport | null;
  /** ws_sid 쿠키 Secure 플래그(production). */
  secureCookie: boolean;
}

type Env = Record<string, string | undefined>;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseOrigin(raw: string, production: boolean): string {
  const value = raw.trim().replace(/\/$/, '');
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error('PUBLIC_ORIGIN: URL 형식이 아니에요');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('PUBLIC_ORIGIN: http(s) 만 허용');
  if (u.origin !== value) throw new Error('PUBLIC_ORIGIN: 경로·자격증명 없는 오리진만 허용');
  if (production && u.protocol !== 'https:' && !LOOPBACK.has(u.hostname)) {
    throw new Error('PUBLIC_ORIGIN: production 은 https 오리진이어야 해요');
  }
  return value;
}

// 'WithSmall <noreply@withsmall.kr>' 또는 'noreply@withsmall.kr'. 개행·꺾쇠 중첩 거부.
const MAIL_FROM_RE = /^(?:[^<>\r\n@]+ )?<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$|^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

function resendFromEnv(env: Env): ResendMailTransport {
  const apiKey = env.RESEND_API_KEY?.trim() ?? '';
  const from = env.MAIL_FROM?.trim() ?? '';
  const missing = [apiKey === '' ? 'RESEND_API_KEY' : null, from === '' ? 'MAIL_FROM' : null].filter(Boolean);
  if (missing.length > 0) throw new Error(`MAIL_TRANSPORT=resend: ${missing.join('·')} 누락 — 필수`);
  if (/\s/.test(apiKey)) throw new Error('RESEND_API_KEY: 공백 포함 — 형식 오류');
  if (!MAIL_FROM_RE.test(from)) throw new Error("MAIL_FROM: 'WithSmall <noreply@도메인>' 또는 주소 형식이어야 해요");
  return new ResendMailTransport({ apiKey, from });
}

export function resolveSaveConfig(env: Env = process.env): SaveConfig {
  const production = isProdLike(env);

  const rawOrigin = env.PUBLIC_ORIGIN?.trim();
  let publicOrigin: string;
  if (rawOrigin) publicOrigin = parseOrigin(rawOrigin, production);
  else if (production) throw new Error('PUBLIC_ORIGIN: production 에서 필수(메일 링크 오리진)');
  else publicOrigin = DEV_PUBLIC_ORIGIN;

  const kind = env.MAIL_TRANSPORT?.trim() ?? '';
  let transport: MailTransport | null;
  if (kind === '') transport = production ? null : new ConsoleMailTransport({ env });
  else if (kind === 'console') {
    if (production) throw new Error('MAIL_TRANSPORT=console 은 production 에서 금지(D19)');
    transport = new ConsoleMailTransport({ env });
  } else if (kind === 'resend') {
    transport = resendFromEnv(env);
  } else {
    throw new Error(`MAIL_TRANSPORT: 지원하지 않는 값(console·resend 만) — 값은 출력하지 않음(SEC-6 L-1)`);
  }

  return { publicOrigin, transport, secureCookie: production };
}
