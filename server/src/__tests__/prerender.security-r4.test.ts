// S-R4 early audit(_workspace/25a_security_r4_early.md) L-A·L-B·L-F 회귀 — BE1.
//   L-A 기준일 = 오늘(Asia/Seoul) · L-B 운영 빌드는 --now ≠ 오늘 거부(--allow-past-now 예외) · L-F 마스코트 정제·운영 필수.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPrerenderCli, seoulToday, type PrerenderIo } from '../prerender/cli.js';
import { loadMascots, sanitizeMascotSvg } from '../prerender/mascot.js';
import { SEED_DIR } from './fixtures/prerender-seed.js';

const ROOT = join(SEED_DIR, '..', '..');
const TEMPLATE = readFileSync(join(ROOT, 'client', 'index.html'), 'utf8');
const MASCOT_DIR = join(ROOT, 'docs', 'design', 'mascots');
const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), `ws-sec-${p}-`));
  temps.push(d);
  return d;
};
const outDir = (): string => {
  const d = tmp('dist');
  writeFileSync(join(d, 'index.html'), TEMPLATE);
  return d;
};

async function run(argv: string[], env: Record<string, string>, opts: { today?: string; mascotDir?: string } = {}) {
  const err: string[] = [];
  const io: PrerenderIo = {
    stdout: () => undefined,
    stderr: (l) => err.push(l),
    env,
    today: () => opts.today ?? '2026-10-01',
    mascotDir: opts.mascotDir ?? MASCOT_DIR,
  };
  return { code: await runPrerenderCli(['--out', outDir(), '--public-dir', tmp('pub'), ...argv], io), err };
}

describe('L-A seoulToday — Asia/Seoul 날짜(러너 시간대 무관)', () => {
  it('UTC 15:00 경계에서 날짜가 바뀐다(KST = UTC+9)', () => {
    expect(seoulToday(new Date('2026-10-01T14:59:59Z'))).toBe('2026-10-01');
    expect(seoulToday(new Date('2026-10-01T15:00:00Z'))).toBe('2026-10-02');
    expect(seoulToday(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
    expect(seoulToday(new Date('2028-02-28T15:30:00Z'))).toBe('2028-02-29');
  });
  it('scripts/lib/dates.mjs seoulToday 와 같은 값', async () => {
    const mjs = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'dates.mjs')).href)) as { seoulToday: (d?: Date) => string };
    for (const iso of ['2026-10-01T14:59:59Z', '2026-10-01T15:00:00Z', '2027-03-29T23:59:59Z', '2026-01-01T00:00:00Z']) {
      expect(mjs.seoulToday(new Date(iso)), iso).toBe(seoulToday(new Date(iso)));
    }
  });
});

// R6 N-2: 운영 프리렌더는 SITE_ORIGIN(https, 비 loopback) 필수 — 운영 경로 테스트는 유효 오리진을 함께 준다.
const PROD = { NODE_ENV: 'production', SITE_ORIGIN: 'https://staging.example' };

describe('L-B 운영 빌드의 --now', () => {
  it('production + --now ≠ 오늘(서울) → exit 2', async () => {
    const r = await run(['--now', '2026-09-30'], PROD);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toMatch(/--allow-past-now/);
    expect((await run(['--now', '2026-10-02'], PROD)).code).toBe(2); // 미래도 거부
  });
  it('production + --now = 오늘 → 통과, --now 없음 → 통과', async () => {
    expect((await run(['--now', '2026-10-01'], PROD)).code).toBe(0);
    expect((await run([], PROD)).code).toBe(0);
  });
  it('production + --allow-past-now → 과거 --now 허용(테스트·재현)', async () => {
    expect((await run(['--now', '2026-09-30', '--allow-past-now'], PROD)).code).toBe(0);
  });
  it('비운영(NODE_ENV 없음·development)은 과거 --now 허용', async () => {
    expect((await run(['--now', '2026-09-30'], {})).code).toBe(0);
    expect((await run(['--now', '2026-09-30'], { NODE_ENV: 'development' })).code).toBe(0);
  });
});

describe('L-F 마스코트', () => {
  it('운영: 원본 디렉터리 없음·svg 0개 → exit 2, 비운영은 빈 맵으로 통과', async () => {
    const missing = join(tmp('m'), 'nope');
    expect((await run([], PROD, { mascotDir: missing })).code).toBe(2);
    expect((await run([], PROD, { mascotDir: tmp('empty') })).code).toBe(2);
    expect((await run([], {}, { mascotDir: missing })).code).toBe(0);
    expect(() => loadMascots(missing, { required: true })).toThrow(/원본 디렉터리 없음/);
    expect(loadMascots(missing).size).toBe(0);
  });
  it('운영: 정제 실패 svg 가 있으면 exit 2', async () => {
    const d = tmp('bad');
    writeFileSync(join(d, 'x.svg'), '<svg viewBox="0 0 9 9"><script>1</script></svg>');
    expect((await run([], PROD, { mascotDir: d })).code).toBe(2);
  });
  it('본문의 <! · <? 는 무엇이든 throw', () => {
    for (const body of ['<!x>', '<!DOCTYPE x>', '<!---->', '<![CDATA[x]]>', '<?pi x?>', '<?xml version="1.0"?>']) {
      expect(() => sanitizeMascotSvg(`<svg viewBox="0 0 9 9">${body}<circle r="1"/></svg>`, 't'), body).toThrow();
    }
  });
  it('속성 값은 단순 값 또는 정확히 url(#id) 만', () => {
    expect(sanitizeMascotSvg('<svg viewBox="0 0 9 9"><circle r="1" fill="url(#g1)"/></svg>', 't')).toContain('fill="url(#g1)"');
    for (const v of ['url(foo.svg)', 'url(foo.svg#a)', 'url(#a) x', 'url( #a)', 'url(#)', 'url(#1a)', 'rgb(1,2,3)', 'url(https:x)']) {
      expect(() => sanitizeMascotSvg(`<svg viewBox="0 0 9 9"><circle r="1" fill="${v}"/></svg>`, 't'), v).toThrow();
    }
  });
  it('실제 디자인 마스코트 8개는 모두 정제 통과(required)', () => {
    expect(loadMascots(MASCOT_DIR, { required: true }).size).toBeGreaterThanOrEqual(8);
  });
});
