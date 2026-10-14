// 매직링크 메일 읽기 — serve.mts 의 전송기가 E2E_MAIL_FILE 에 JSON lines {to, subject, text} 로 쌓는다(실제 메일 발송 0).
import { existsSync, readFileSync } from 'node:fs';
import { expect } from './fixtures';
import { e2eEnv } from './fixtures';

export interface MailLine {
  to: string;
  subject: string;
  text: string;
}

export function readMails(): MailLine[] {
  const file = e2eEnv('E2E_MAIL_FILE');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as MailLine);
}

export const mailsTo = (to: string): MailLine[] => readMails().filter((m) => m.to === to);

/**
 * `to` 로 간 메일이 `before` 통보다 많아질 때까지 기다리고, 마지막 메일의 저장 링크(같은 오리진 /save#t=…)를 돌려준다.
 *   링크가 서버 오리진 밖이면 실패(매직링크는 publicOrigin 만).
 */
export async function waitForSaveLink(to: string, before: number, origin: string): Promise<string> {
  await expect.poll(() => mailsTo(to).length, { message: `${to} 로 새 메일`, timeout: 10_000 }).toBeGreaterThan(before);
  const list = mailsTo(to);
  const m = list[list.length - 1];
  const link = m.text.match(/https?:\/\/\S+/)?.[0];
  expect(link, '메일 본문에 링크').toBeTruthy();
  const u = new URL(link as string);
  expect(u.origin, '매직링크는 서버 오리진').toBe(origin);
  expect(u.pathname).toBe('/save');
  expect(u.hash.startsWith('#t='), '토큰은 해시(#t=)').toBe(true);
  return link as string;
}
