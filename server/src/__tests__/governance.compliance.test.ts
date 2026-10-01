import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { InMemoryReportRepository } from '../governance/report.repo.js';

const here = dirname(fileURLToPath(import.meta.url));
function readSrc(...parts: string[]): string {
  return readFileSync(join(here, '..', ...parts), 'utf8');
}

describe('불변식 4 — 거버넌스 저장 객체에 자금 키 0', () => {
  it('Report 에 자금 흐름 키가 없다', async () => {
    const repo = new InMemoryReportRepository();
    const r = await repo.create('reporter-1', {
      targetType: 'message',
      targetId: 'm-1',
      reason: '욕설',
    });
    const keys = Object.keys(r);
    const banned = ['amount', 'price', 'balance', 'pay' + 'out', 'es' + 'crow', '정' + '산'];
    for (const k of banned) expect(keys).not.toContain(k);
  });
});

describe('불변식 1 — 거버넌스 소스에 외부 fetch/URL 0', () => {
  it('governance 소스에 외부 http(s) URL·네트워크 호출 토큰이 없다', () => {
    const files: string[][] = [
      ['governance', 'report.routes.ts'],
      ['governance', 'report.repo.ts'],
      ['governance', 'report.validation.ts'],
    ];
    for (const f of files) {
      const src = readSrc(...f);
      expect(/[`'"]https?:\/\//i.test(src)).toBe(false);
      expect(/\b(fetch|axios|got)\s*\(/.test(src)).toBe(false);
    }
  });
});
