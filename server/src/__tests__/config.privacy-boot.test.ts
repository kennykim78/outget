// 계획 86 P11 후속(오케스트레이터 2026-10-25): 운영 기동 검사 — 프리렌더 /privacy/index.html 에 {{KENNY: 자리표시가 있으면 기동 거부,
//   WS_ALLOW_PRIVACY_PLACEHOLDER=1 일 때만 경고로 기동. 빌드(compliance C9)는 WARN 만(scripts/__tests__/compliance-scan.test.mjs).
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import express from 'express';
import request from 'supertest';
import {
  ALLOW_PRIVACY_PLACEHOLDER_ENV,
  bootClientDist,
  INDEXABLE_ENV,
  publicIndexing,
  clientDistCandidates,
  collectEnvProblems,
  JWT_SECRET_MIN,
  privacyPlaceholderCheck,
  resolveClientDist,
  runEnvCheck,
} from '../config/env.js';
import { mountSpa } from '../middleware/spa.js';

const PH = (k: string): string => ['{{KEN', 'NY:', k, '}}'].join('');
const made: string[] = [];
function distWith(html: string | null): string {
  const d = mkdtempSync(join(tmpdir(), 'ws-privacy-boot-'));
  made.push(d);
  if (html !== null) {
    mkdirSync(join(d, 'privacy'));
    writeFileSync(join(d, 'privacy', 'index.html'), html);
  }
  return d;
}
/** 운영 자식 프로세스용 배치: <root>/server(cwd) + <root>/client/dist/{index.html, privacy/index.html} — WS_CLIENT_DIST 없이 후보 ① 로 찾힌다. */
function layoutWith(html: string): { cwd: string; dist: string } {
  const root = mkdtempSync(join(tmpdir(), 'ws-privacy-layout-'));
  made.push(root);
  const dist = join(root, 'client', 'dist');
  mkdirSync(join(dist, 'privacy'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(dist, 'privacy', 'index.html'), html);
  mkdirSync(join(root, 'server'));
  return { cwd: join(root, 'server'), dist };
}
// cwd 를 임시 폴더로 바꾸므로 tsx 로더는 절대 URL 로 지정한다.
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const PROD = { NODE_ENV: 'production' };
const WITH_PH = `<main><p>성명: ${PH('officerName')}</p><p>메일: ${PH('officerEmail')}</p><p>${PH('officerName')}</p></main>`;

describe('privacyPlaceholderCheck', () => {
  it('운영 + 자리표시 → problem(기동 거부), 키 목록(중복 제거) 포함', () => {
    const r = privacyPlaceholderCheck(PROD, distWith(WITH_PH));
    expect(r.warnings).toEqual([]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/운영 기동 거부/);
    expect(r.problems[0]).toContain('(officerName, officerEmail)');
    expect(r.problems[0]).toContain(ALLOW_PRIVACY_PLACEHOLDER_ENV);
  });

  it(`${ALLOW_PRIVACY_PLACEHOLDER_ENV}=1 → 경고로 강등(기동 허용), 그 밖의 값(0·true·빈 값)은 허용 아님`, () => {
    const d = distWith(WITH_PH);
    const ok = privacyPlaceholderCheck({ ...PROD, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1' }, d);
    expect(ok.problems).toEqual([]);
    expect(ok.warnings).toHaveLength(1);
    expect(ok.warnings[0]).toMatch(/공개 운영 금지/);
    expect(ok.warnings[0]).toContain('officerName, officerEmail');
    for (const v of ['0', 'true', 'yes', '']) {
      expect(privacyPlaceholderCheck({ ...PROD, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: v }, d).problems, v).toHaveLength(1);
    }
  });

  it('139 MED-2: 공개 전환(WS_INDEXABLE=1) 이면 허용 변수를 무시하고 기동 거부 — 1 이 아닌 값은 공개 전환 아님', () => {
    const d = distWith(WITH_PH);
    for (const v of ['1', ' 1 ']) {
      const r = privacyPlaceholderCheck({ ...PROD, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1', [INDEXABLE_ENV]: v }, d);
      expect(r.warnings, v).toEqual([]);
      expect(r.problems, v).toHaveLength(1);
      expect(r.problems[0]).toMatch(/운영 기동 거부/);
      expect(r.problems[0]).toContain(`${INDEXABLE_ENV}=1`);
      expect(r.problems[0]).toContain('139 MED-2');
      expect(r.problems[0]).toContain('officerName, officerEmail');
    }
    // 허용 변수 없이 WS_INDEXABLE=1 → 역시 거부
    expect(privacyPlaceholderCheck({ ...PROD, [INDEXABLE_ENV]: '1' }, d).problems).toHaveLength(1);
    // WS_INDEXABLE 이 '1' 이 아니면(0·true·빈 값) 기존대로 경고 강등
    for (const v of ['0', 'true', '']) {
      const r = privacyPlaceholderCheck({ ...PROD, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1', [INDEXABLE_ENV]: v }, d);
      expect(r.problems, v).toEqual([]);
      expect(r.warnings, v).toHaveLength(1);
    }
    // 자리표시가 없으면 공개 전환이어도 통과
    expect(privacyPlaceholderCheck({ ...PROD, [INDEXABLE_ENV]: '1' }, distWith('<main>ok</main>'))).toEqual({ problems: [], warnings: [] });
    // 비운영은 검사 안 함(공개 전환이어도)
    expect(privacyPlaceholderCheck({ NODE_ENV: 'test', [INDEXABLE_ENV]: '1' }, d)).toEqual({ problems: [], warnings: [] });
  });

  it('139 MED-2: 빌드 산출 prerender-manifest.json indexable:true 도 공개 전환 — env 없이 허용 변수 무시', () => {
    const man = (d: string, body: string): string => {
      writeFileSync(join(d, 'prerender-manifest.json'), body);
      return d;
    };
    const pubDist = man(distWith(WITH_PH), JSON.stringify({ v: 1, indexable: true, routes: [] }));
    const r = privacyPlaceholderCheck({ ...PROD, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1' }, pubDist);
    expect(r.warnings).toEqual([]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('prerender-manifest indexable:true');
    expect(publicIndexing({}, pubDist)).toBe('prerender-manifest indexable:true');
    // env 가 우선 근거
    expect(publicIndexing({ [INDEXABLE_ENV]: '1' }, pubDist)).toBe(`${INDEXABLE_ENV}=1`);
    // indexable:false·"true"(문자열)·손상·없음 → 근거 아님 → 허용 변수로 경고 강등
    for (const body of [JSON.stringify({ v: 1, indexable: false }), JSON.stringify({ indexable: 'true' }), '{not json', 'null']) {
      const d = man(distWith(WITH_PH), body);
      expect(publicIndexing({}, d), body).toBeNull();
      const ok = privacyPlaceholderCheck({ ...PROD, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1' }, d);
      expect(ok.problems, body).toEqual([]);
      expect(ok.warnings, body).toHaveLength(1);
    }
    expect(publicIndexing({}, distWith(WITH_PH))).toBeNull();
  });

  it('자리표시 없음 → 통과(problems·warnings 0)', () => {
    expect(privacyPlaceholderCheck(PROD, distWith('<main><p>성명: 홍길동</p></main>'))).toEqual({ problems: [], warnings: [] });
  });

  it('비운영(development·test)은 검사 안 함, 운영 취급 NODE_ENV(미설정·staging)는 검사', () => {
    const d = distWith(WITH_PH);
    for (const v of ['development', 'test']) expect(privacyPlaceholderCheck({ NODE_ENV: v }, d)).toEqual({ problems: [], warnings: [] });
    for (const v of [undefined, 'staging']) expect(privacyPlaceholderCheck({ NODE_ENV: v }, d).problems, String(v)).toHaveLength(1);
  });

  it('101 MED-3: 운영에서 페이지 파일 없음 → problem(기동 거부), 허용 변수로도 강등 안 됨 · 비운영은 검사 안 함', () => {
    const d = distWith(null);
    const r = privacyPlaceholderCheck(PROD, d);
    expect(r.warnings).toEqual([]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/처리방침 페이지 없음.*운영 기동 거부/);
    expect(privacyPlaceholderCheck({ ...PROD, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1' }, d).problems).toHaveLength(1);
    expect(privacyPlaceholderCheck({ NODE_ENV: 'test' }, d)).toEqual({ problems: [], warnings: [] });
  });

  it('101 L-1: 키 모양 무관 — 밑줄·하이픈·한글 키, 닫히지 않은 표식도 거부(키 목록은 보조, 못 읽으면 ?)', () => {
    for (const [html, shown] of [
      [`<p>${PH('officer_name')}</p>`, 'officer_name'],
      [`<p>${PH('officer-email')}</p>`, 'officer-email'],
      [`<p>${PH('책임자')}</p>`, '책임자'],
      [`<p>${PH('a b')}</p>`, '?'], // 공백 키 — 정규식으로는 못 읽어도 표식만으로 거부
      ['<p>{{KENNY:officerName</p>', '?'], // 닫는 괄호 없음
    ] as const) {
      const r = privacyPlaceholderCheck(PROD, distWith(html));
      expect(r.problems, html).toHaveLength(1);
      expect(r.problems[0], html).toContain(`(${shown})`);
    }
    // 표식이 아닌 비슷한 글자는 통과
    expect(privacyPlaceholderCheck(PROD, distWith('<p>{{KENNY}} {KENNY:x}</p>')).problems).toEqual([]);
  });

  it('101 MED-3 resolveClientDist: WS_CLIENT_DIST 는 비운영에서만, 운영은 후보 중 index.html 있는 첫 곳(없으면 설치 위치 기준)', () => {
    expect(resolveClientDist({ NODE_ENV: 'test', WS_CLIENT_DIST: '/x/dist' })).toBe(resolve('/x/dist'));
    expect(resolveClientDist({ NODE_ENV: 'development', WS_CLIENT_DIST: ' /x/dist ' })).toBe(resolve('/x/dist'));
    const base = { here: resolve('/app/server/dist/config'), cwd: resolve('/app/server') };
    const none = { ...base, exists: () => false };
    for (const env of [{ NODE_ENV: 'production', WS_CLIENT_DIST: '/x/dist' }, { WS_CLIENT_DIST: '/x/dist' }, { NODE_ENV: 'staging', WS_CLIENT_DIST: '/x/dist' }]) {
      expect(resolveClientDist(env, none), JSON.stringify(env)).toBe(resolve('/app/client/dist'));
    }
    expect(clientDistCandidates(base)).toEqual([resolve('/app/client/dist'), resolve('/app/client/dist'), resolve('/app/server/client/dist'), resolve('/app/server/client/dist')]);
    // 후보 순서: 첫 index.html
    const loc = { here: resolve('/r/server/src/config'), cwd: resolve('/w/srv') };
    const has = (want: string) => ({ ...loc, exists: (p: string) => p === join(want, 'index.html') });
    expect(resolveClientDist(PROD, has(resolve('/w/client/dist')))).toBe(resolve('/w/client/dist'));
    expect(resolveClientDist(PROD, has(resolve('/r/client/dist')))).toBe(resolve('/r/client/dist'));
    expect(resolveClientDist(PROD, has(resolve('/w/srv/client/dist')))).toBe(resolve('/w/srv/client/dist'));
    expect(resolveClientDist(PROD, { ...loc, exists: () => false })).toBe(resolve('/r/client/dist'));
    // 호환 별칭
    expect(bootClientDist({ NODE_ENV: 'test', WS_CLIENT_DIST: '/x/dist' })).toBe(resolve('/x/dist'));
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    expect(clientDistCandidates()[1]).toBe(join(repo, 'client', 'dist'));
  });

  it('101 MED-3 일원화: mountSpa 기본 경로 = resolveClientDist(같은 env 로 같은 디렉터리를 서빙) · spa.ts 에 자체 해석기 없음', async () => {
    const d = distWith('<main>privacy-page</main>');
    writeFileSync(join(d, 'index.html'), '<!doctype html><title>t</title><main>spa-shell-marker</main>');
    writeFileSync(join(d, 'marker-101.txt'), 'served-from-resolved-dist');
    const prev = process.env.WS_CLIENT_DIST;
    process.env.WS_CLIENT_DIST = d; // vitest = NODE_ENV test → 존중
    try {
      expect(resolveClientDist(process.env)).toBe(resolve(d));
      const app = express();
      mountSpa(app);
      const res = await request(app).get('/marker-101.txt');
      expect(res.status).toBe(200);
      expect(res.text).toBe('served-from-resolved-dist');
    } finally {
      if (prev === undefined) delete process.env.WS_CLIENT_DIST;
      else process.env.WS_CLIENT_DIST = prev;
    }
    const src = readFileSync(fileURLToPath(new URL('../middleware/spa.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/function resolveClientDist/);
    expect(src).toMatch(/import \{ resolveClientDist \} from '\.\.\/config\/env\.js'/);
  });
});

describe('collectEnvProblems / runEnvCheck 연동', () => {
  const S = 'k'.repeat(JWT_SECRET_MIN);
  const PROD_OK = {
    NODE_ENV: 'production',
    DATABASE_URL: 'file:/data/prod.db',
    PUBLIC_ORIGIN: 'https://staging.example',
    JWT_ACCESS_SECRET: `${S}-a`,
    JWT_REFRESH_SECRET: `${S}-r`,
    REACTION_KEY_SECRET: `${S}-x`,
  };

  it('101 MED-3: 운영에서 WS_CLIENT_DIST 가 있으면 무시 경고', async () => {
    expect((await collectEnvProblems({ ...PROD_OK, WS_CLIENT_DIST: '/x' })).warnings.some((w) => w.startsWith('WS_CLIENT_DIST: 운영에서는 무시'))).toBe(true);
    expect((await collectEnvProblems({ ...PROD_OK, NODE_ENV: 'test', WS_CLIENT_DIST: '/x' })).warnings.some((w) => w.startsWith('WS_CLIENT_DIST'))).toBe(false);
  }, 60_000);

  it('clientDist 생략 → 자리표시 검사 안 함(기존 호출 동작 유지), 주면 problem', async () => {
    const d = distWith(WITH_PH);
    expect((await collectEnvProblems(PROD_OK)).problems).toEqual([]);
    expect((await collectEnvProblems(PROD_OK, { clientDist: d })).problems.some((p) => p.startsWith('privacy:'))).toBe(true);
  }, 60_000);

  it('runEnvCheck: 자리표시 → exit 1 + 키 목록, 허용 변수 → exit 0 + 경고, 자리표시 없음 → exit 0', async () => {
    const lines: string[] = [];
    const io = { stdout: (l: string) => lines.push(l), stderr: (l: string) => lines.push(l) };
    expect(await runEnvCheck(PROD_OK, io, { clientDist: distWith(WITH_PH) })).toBe(1);
    expect(lines.join('\n')).toMatch(/officerName, officerEmail/);
    lines.length = 0;
    expect(await runEnvCheck({ ...PROD_OK, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1' }, io, { clientDist: distWith(WITH_PH) })).toBe(0);
    expect(lines.join('\n')).toMatch(/env 경고: WS_ALLOW_PRIVACY_PLACEHOLDER=1/);
    lines.length = 0;
    expect(await runEnvCheck(PROD_OK, io, { clientDist: distWith('<main>ok</main>') })).toBe(0);
    expect(lines.join('\n')).toMatch(/env ok/);
  }, 60_000);
});

// index.ts 기동 경로(node dist/index.js·start:prod 직접 실행) — 같은 검사를 DB·묘비 단계보다 앞에서 수행.
describe('index.ts 기동 — 처리방침 자리표시', () => {
  const secret = randomBytes(36).toString('base64url');
  const dbDir = mkdtempSync(join(tmpdir(), 'ws-privacy-idx-'));
  made.push(dbDir);
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: `file:${join(dbDir, 'x.db').replace(/\\/g, '/')}`,
    PUBLIC_ORIGIN: 'https://staging.example',
    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    REACTION_KEY_SECRET: secret,
    WS_ERASURE_FILE: join(dbDir, 'erasures.jsonl'),
    PORT: '0',
  };
  const runIndex = (env: Record<string, string>, cwd: string): { status: number | null; out: string } => {
    const r = spawnSync(process.execPath, ['--import', TSX, fileURLToPath(new URL('../index.ts', import.meta.url))], {
      cwd,
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
      encoding: 'utf8',
      timeout: 25_000,
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('자리표시 → exit 1(기동 거부, 묘비 재적용 로그 없음), 허용 변수 → 경고 후 검사 통과', () => {
    const { cwd } = layoutWith(WITH_PH);
    // 운영: WS_CLIENT_DIST(자리표시 없는 폴더)는 무시되고 SPA 와 같은 경로(cwd/../client/dist)를 검사한다(101 MED-3)
    const clean = distWith('<main>ok</main>');
    writeFileSync(join(clean, 'index.html'), '<!doctype html>');
    const no = runIndex({ ...base, WS_CLIENT_DIST: clean }, cwd);
    expect(no.status, no.out).toBe(1);
    expect(no.out).toMatch(/기동 거부/);
    expect(no.out).toContain('officerName, officerEmail');
    expect(no.out).not.toContain('[privacy] tombstone');
    expect(no.out).not.toContain(secret);
    const yes = runIndex({ ...base, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1' }, cwd);
    expect(yes.out).toMatch(/공개 운영 금지/);
    expect(yes.out).not.toMatch(/기동 거부/);
  }, 120_000);
});

// docker-entrypoint 0단계와 같은 직접 실행(node dist/config/env.js) — 종료 코드로 기동 거부·허용.
describe('env.ts 직접 실행 — 처리방침 자리표시', () => {
  const secret = randomBytes(36).toString('base64url');
  const base = { NODE_ENV: 'production', DATABASE_URL: 'file:/tmp/x.db', PUBLIC_ORIGIN: 'https://staging.example', JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: secret, REACTION_KEY_SECRET: secret };
  const runMain = (env: Record<string, string>, cwd: string): { status: number | null; out: string } => {
    const r = spawnSync(process.execPath, ['--import', TSX, fileURLToPath(new URL('../config/env.ts', import.meta.url))], {
      cwd,
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('자리표시 → exit 1(키 목록), 허용 변수 → exit 0(경고), 시크릿 값 출력 0', () => {
    const { cwd } = layoutWith(WITH_PH);
    const no = runMain(base, cwd);
    expect(no.status, no.out).toBe(1);
    expect(no.out).toMatch(/운영 기동 거부/);
    expect(no.out).toContain('officerName, officerEmail');
    expect(no.out).not.toContain(secret);
    const yes = runMain({ ...base, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1' }, cwd);
    expect(yes.status, yes.out).toBe(0);
    expect(yes.out).toMatch(/공개 운영 금지/);
    expect(yes.out).toMatch(/env ok/);
  }, 120_000);

  it('139 MED-2: 허용 변수 + WS_INDEXABLE=1 → exit 1(공개 전환 상태에서는 자리표시 기동 불가)', () => {
    const { cwd } = layoutWith(WITH_PH);
    const r = runMain({ ...base, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1', [INDEXABLE_ENV]: '1' }, cwd);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/운영 기동 거부/);
    expect(r.out).toContain('139 MED-2');
    expect(r.out).not.toContain(secret);
  }, 120_000);

  it('101 MED-3: 운영에서 처리방침 페이지가 없으면 exit 1(허용 변수로도 통과 안 함)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-privacy-nopage-'));
    made.push(root);
    mkdirSync(join(root, 'client', 'dist'), { recursive: true });
    writeFileSync(join(root, 'client', 'dist', 'index.html'), '<!doctype html>');
    mkdirSync(join(root, 'server'));
    const r = runMain({ ...base, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1' }, join(root, 'server'));
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/처리방침 페이지 없음/);
  }, 120_000);
});
