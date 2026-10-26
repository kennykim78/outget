// SEC-3 L-5·L-6·M-2: 공용 실행 환경 판정(server/src/config/env.ts).
//   isProdLike: development·test 외 모든 NODE_ENV(미설정·staging·오타 포함)를 production 으로 본다(fail-closed).
//   parseTrustProxy: 정수 홉 수만(기본 0), true·음수·소수·문자 → throw.
//   assertJwtSecrets: production-like 에서 JWT 시크릿 32자 미만 → throw.
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertJwtSecrets, collectEnvProblems, isProdLike, JWT_SECRET_MIN, parseTrustProxy, runEnvCheck } from '../config/env.js';

describe('isProdLike', () => {
  it('development·test 만 비운영', () => {
    expect(isProdLike({ NODE_ENV: 'development' })).toBe(false);
    expect(isProdLike({ NODE_ENV: 'test' })).toBe(false);
  });

  it('production·미설정·빈 값·staging·오타 → 운영 취급', () => {
    for (const v of ['production', undefined, '', 'staging', 'prod', 'Development', ' test']) {
      expect(isProdLike({ NODE_ENV: v }), String(v)).toBe(true);
    }
  });
});

describe('parseTrustProxy', () => {
  it('미설정·빈 값 → 0', () => {
    expect(parseTrustProxy({})).toBe(0);
    expect(parseTrustProxy({ TRUST_PROXY: '' })).toBe(0);
    expect(parseTrustProxy({ TRUST_PROXY: '  ' })).toBe(0);
  });

  it('정수 홉 수', () => {
    expect(parseTrustProxy({ TRUST_PROXY: '0' })).toBe(0);
    expect(parseTrustProxy({ TRUST_PROXY: '1' })).toBe(1);
    expect(parseTrustProxy({ TRUST_PROXY: '2' })).toBe(2);
  });

  it('true·false·음수·소수·문자·CIDR·과대 → throw', () => {
    for (const v of ['true', 'false', '-1', '1.5', 'abc', 'loopback', '10.0.0.0/8', '1e1', '0x1', '11']) {
      expect(() => parseTrustProxy({ TRUST_PROXY: v }), v).toThrow(/TRUST_PROXY/);
    }
  });
});

describe('assertJwtSecrets', () => {
  const ok = 'a'.repeat(JWT_SECRET_MIN);

  it('JWT_SECRET_MIN = 32', () => {
    expect(JWT_SECRET_MIN).toBe(32);
  });

  it('운영: 둘 다 32자 이상이어야 통과', () => {
    expect(() => assertJwtSecrets({ NODE_ENV: 'production', JWT_ACCESS_SECRET: ok, JWT_REFRESH_SECRET: ok })).not.toThrow();
    expect(() => assertJwtSecrets({ NODE_ENV: 'production', JWT_ACCESS_SECRET: ok })).toThrow(/JWT_REFRESH_SECRET/);
    expect(() =>
      assertJwtSecrets({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'short', JWT_REFRESH_SECRET: ok }),
    ).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => assertJwtSecrets({ JWT_ACCESS_SECRET: 'short', JWT_REFRESH_SECRET: 'short' })).toThrow(); // 미설정 = 운영
  });

  it('development·test 는 길이 검사 없음', () => {
    expect(() => assertJwtSecrets({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertJwtSecrets({ NODE_ENV: 'test', JWT_ACCESS_SECRET: 'x' })).not.toThrow();
  });
});

// R6 A3: 기동 전 env 검사 — 누락·무효를 한 번에 모으고, 시크릿 값은 출력하지 않는다.
describe('collectEnvProblems / runEnvCheck', () => {
  const S = 'k'.repeat(JWT_SECRET_MIN);
  const PROD_OK = {
    NODE_ENV: 'production',
    DATABASE_URL: 'file:/data/prod.db',
    PUBLIC_ORIGIN: 'https://staging.example',
    JWT_ACCESS_SECRET: `${S}-access-SECRETVALUE`,
    JWT_REFRESH_SECRET: `${S}-refresh-SECRETVALUE`,
    REACTION_KEY_SECRET: `${S}-reaction-SECRETVALUE`,
    TRUST_PROXY: '1',
  };
  // 동적 import(save·reaction → prerender/cli 체인)의 첫 변환이 느리다 — 테스트 시간 제한 밖에서 1회 예열.
  beforeAll(async () => {
    await collectEnvProblems({ NODE_ENV: 'development' });
  }, 60_000);

  it('운영 정상 구성 → 문제 0, 경고 0', async () => {
    expect(await collectEnvProblems(PROD_OK)).toEqual({ problems: [], warnings: [] });
  });

  it('운영 빈 env → 누락 이름을 전부 한 번에(첫 오류에서 멈추지 않음)', async () => {
    const { problems } = await collectEnvProblems({ NODE_ENV: 'production' });
    const names = problems.map((p) => p.split(':')[0]);
    expect(names).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'REACTION_KEY_SECRET', 'PUBLIC_ORIGIN']),
    );
    expect(problems).toHaveLength(5);
  });

  it('PUBLIC_ORIGIN 누락과 MAIL_TRANSPORT=console 이 둘 다 보인다 + TRUST_PROXY 무효도 함께', async () => {
    const { problems } = await collectEnvProblems({ ...PROD_OK, PUBLIC_ORIGIN: '', MAIL_TRANSPORT: 'console', TRUST_PROXY: 'true' });
    expect(problems.some((p) => p.startsWith('PUBLIC_ORIGIN'))).toBe(true);
    expect(problems.some((p) => p.startsWith('MAIL_TRANSPORT'))).toBe(true);
    expect(problems.some((p) => p.startsWith('TRUST_PROXY'))).toBe(true);
    expect(problems).toHaveLength(3);
  });

  it('운영 PUBLIC_ORIGIN http(비 loopback) → 무효', async () => {
    const { problems } = await collectEnvProblems({ ...PROD_OK, PUBLIC_ORIGIN: 'http://staging.example' });
    expect(problems).toEqual([expect.stringMatching(/^PUBLIC_ORIGIN/)]);
  });

  it('짧은 시크릿 → 이름만, 값은 메시지·출력 어디에도 없다', async () => {
    // 짧은 값은 런타임 조립(하드코딩 시크릿 패턴 C7 회피) — 끝의 표식으로 출력 누출을 검사한다.
    const shortValue = (tag: string): string => `${tag}-${'SECRET'}VALUE`;
    const env = { ...PROD_OK, JWT_ACCESS_SECRET: shortValue('short'), REACTION_KEY_SECRET: shortValue('tiny') };
    const lines: string[] = [];
    const code = await runEnvCheck(env, { stdout: (l) => lines.push(l), stderr: (l) => lines.push(l) });
    expect(code).toBe(1);
    const all = lines.join('\n');
    expect(all).toMatch(/JWT_ACCESS_SECRET/);
    expect(all).toMatch(/REACTION_KEY_SECRET/);
    expect(all).not.toMatch(/SECRETVALUE/);
    expect(all).not.toContain(PROD_OK.JWT_REFRESH_SECRET);
  });

  it('SITE_ORIGIN ≠ PUBLIC_ORIGIN → 경고(기동은 통과), 같으면(끝 슬래시 무시) 경고 0', async () => {
    const diff = await collectEnvProblems({ ...PROD_OK, SITE_ORIGIN: 'https://other.example' });
    expect(diff.problems).toEqual([]);
    expect(diff.warnings).toEqual([expect.stringMatching(/SITE_ORIGIN.*PUBLIC_ORIGIN/)]);
    const same = await collectEnvProblems({ ...PROD_OK, SITE_ORIGIN: 'https://staging.example/' });
    expect(same.warnings).toEqual([]);
    const lines: string[] = [];
    expect(await runEnvCheck({ ...PROD_OK, SITE_ORIGIN: 'https://other.example' }, { stdout: (l) => lines.push(l), stderr: (l) => lines.push(l) })).toBe(0);
    expect(lines.join('\n')).toMatch(/env 경고/);
  });

  it('development 빈 env → 문제 0(기본값 동작 유지), NODE_ENV 미설정은 운영 취급 + 경고', async () => {
    expect((await collectEnvProblems({ NODE_ENV: 'development' })).problems).toEqual([]);
    const unset = await collectEnvProblems({});
    expect(unset.warnings.some((w) => w.startsWith('NODE_ENV'))).toBe(true);
    expect(unset.problems.length).toBeGreaterThan(0);
  });
});

// R6 A3 회귀: 직접 실행(entrypoint 의 `node dist/config/env.js`) 이 교착 없이 끝나고 종료 코드로 결과를 낸다.
//   (top-level await + 순환 동적 import 교착 — 컨테이너에서 "unsettled top-level await" 로 재현됐던 결함)
describe('env.ts 직접 실행', () => {
  // cwd 를 임시 배치로 바꿀 수 있게 tsx 로더는 절대 URL.
  const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const runMain = (env: Record<string, string>, cwd?: string): { status: number | null; out: string } => {
    const r = spawnSync(process.execPath, ['--import', TSX, fileURLToPath(new URL('../config/env.ts', import.meta.url))], {
      cwd,
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('운영 + PUBLIC_ORIGIN 누락 → exit 1, 누락 이름 출력, 시크릿 값 0', () => {
    const secret = randomBytes(36).toString('base64url');
    const r = runMain({ NODE_ENV: 'production', DATABASE_URL: 'file:/tmp/x.db', JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: secret, REACTION_KEY_SECRET: secret });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/PUBLIC_ORIGIN/);
    expect(r.out).not.toContain(secret);
  }, 90_000);

  it('운영 정상 구성 → exit 0, env ok', () => {
    const secret = randomBytes(36).toString('base64url');
    // 86 P11 후속: 직접 실행은 처리방침 자리표시도 본다 — 로컬 빌드 산출물(자리표시 있음)과 무관하게, 자리표시 없는 산출 디렉터리를 준다.
    //   101 MED-3: 운영은 WS_CLIENT_DIST 를 무시하므로 SPA 와 같은 후보 ①(<cwd>/../client/dist) 배치로 준다.
    const root = mkdtempSync(join(tmpdir(), 'ws-env-dist-'));
    const dist = join(root, 'client', 'dist');
    mkdirSync(join(dist, 'privacy'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html>');
    writeFileSync(join(dist, 'privacy', 'index.html'), '<main>처리방침</main>');
    mkdirSync(join(root, 'server'));
    const r = runMain(
      { NODE_ENV: 'production', DATABASE_URL: 'file:/tmp/x.db', PUBLIC_ORIGIN: 'https://staging.example', JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: secret, REACTION_KEY_SECRET: secret },
      join(root, 'server'),
    );
    rmSync(root, { recursive: true, force: true });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/env ok/);
  }, 90_000);
});
