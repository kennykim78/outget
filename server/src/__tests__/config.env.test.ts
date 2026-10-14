// SEC-3 L-5·L-6·M-2: 공용 실행 환경 판정(server/src/config/env.ts).
//   isProdLike: development·test 외 모든 NODE_ENV(미설정·staging·오타 포함)를 production 으로 본다(fail-closed).
//   parseTrustProxy: 정수 홉 수만(기본 0), true·음수·소수·문자 → throw.
//   assertJwtSecrets: production-like 에서 JWT 시크릿 32자 미만 → throw.
import { describe, expect, it } from 'vitest';
import { assertJwtSecrets, isProdLike, JWT_SECRET_MIN, parseTrustProxy } from '../config/env.js';

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
