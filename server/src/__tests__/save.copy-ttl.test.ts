// 287 S2 T2 — L8 문구 속 「N분」은 실제 링크 유효 시간(MAGIC_TTL_MS)과 같아야 한다.
//   TTL 을 바꾸고 문구를 그대로 두면(또는 반대) 빨강.
import { describe, expect, it } from 'vitest';
import { COPY } from '../prerender/copy.js';
import { MAGIC_TTL_MS, magicMailText } from '../save/magic.routes.js';
import { lintText } from '../seed/lint.js';

function strings(v: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof v === 'string') out.push([path, v]);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, `${path}.${k}`, out);
  return out;
}

describe('287 S2 T2 — COPY.save 「N분」 = MAGIC_TTL_MS / 60000', () => {
  const minutes = MAGIC_TTL_MS / 60000;
  const all = strings(COPY.save, 'save', []);

  it('TTL 은 정수 분', () => {
    expect(Number.isInteger(minutes)).toBe(true);
  });

  it('save 묶음의 모든 「N분」이 TTL 과 일치(최소 linkNote·sentBody·expiredBody 3곳)', () => {
    const hits: Array<[string, number]> = [];
    for (const [path, s] of all) {
      for (const m of s.matchAll(/(\d+)\s*분/g)) hits.push([path, Number(m[1])]);
    }
    for (const [path, n] of hits) expect(n, path).toBe(minutes);
    const paths = new Set(hits.map(([p]) => p));
    for (const p of ['save.linkNote', 'save.sentBody', 'save.expiredBody']) expect(paths.has(p), p).toBe(true);
  });

  it('메일 본문의 「N분」 = TTL, 금지어 0, 「아무 일도」 과약속 0', () => {
    const text = magicMailText('https://example.test/save#t=x');
    const ns = [...text.matchAll(/(\d+)\s*분/g)].map((m) => Number(m[1]));
    expect(ns.length).toBeGreaterThan(0);
    for (const n of ns) expect(n).toBe(minutes);
    expect(lintText(text)).toEqual([]);
    expect(text).not.toContain('아무 일');
    expect(text).toContain('링크를 누르지 않으면 연결되지 않아요.');
  });

  it('sentBody 는 실제 연결 버튼 문구(connectCta)를 글자 그대로 담는다', () => {
    expect(COPY.save.sentBody).toContain(`「${COPY.save.connectCta}」`);
  });
});
