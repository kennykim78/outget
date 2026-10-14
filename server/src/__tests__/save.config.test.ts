// B1-2 저장 설정(D19, K2·K7): production 은 fail-closed — PUBLIC_ORIGIN 미설정·console 메일 → 기동 throw,
//   메일 공급자 미설정 → transport null(요청 503). 공급자 구현은 Kenny 결정 전까지 없음(알 수 없는 값 → throw).
import { describe, expect, it } from 'vitest';
import { resolveSaveConfig, DEV_PUBLIC_ORIGIN } from '../save/config.js';
import { ConsoleMailTransport, maskEmail } from '../save/mail.js';

describe('resolveSaveConfig', () => {
  it('development: PUBLIC_ORIGIN 기본 http://localhost:5173, console 메일, Secure 쿠키 아님', () => {
    const c = resolveSaveConfig({ NODE_ENV: 'development' });
    expect(DEV_PUBLIC_ORIGIN).toBe('http://localhost:5173');
    expect(c.publicOrigin).toBe(DEV_PUBLIC_ORIGIN);
    expect(c.transport).toBeInstanceOf(ConsoleMailTransport);
    expect(c.secureCookie).toBe(false);
  });

  it('test env 도 console 기본', () => {
    expect(resolveSaveConfig({ NODE_ENV: 'test' }).transport).toBeInstanceOf(ConsoleMailTransport);
  });

  it('L-6: NODE_ENV 미설정·staging 은 운영 취급 — PUBLIC_ORIGIN 없으면 throw, 있으면 메일 null·Secure', () => {
    for (const NODE_ENV of [undefined, 'staging']) {
      expect(() => resolveSaveConfig({ NODE_ENV })).toThrow(/PUBLIC_ORIGIN/);
      const c = resolveSaveConfig({ NODE_ENV, PUBLIC_ORIGIN: 'https://withsmall.kr' });
      expect(c.transport).toBeNull();
      expect(c.secureCookie).toBe(true);
      expect(() => resolveSaveConfig({ NODE_ENV, PUBLIC_ORIGIN: 'https://withsmall.kr', MAIL_TRANSPORT: 'console' })).toThrow(/console/);
    }
  });

  it('production + PUBLIC_ORIGIN 미설정 → throw(Host 헤더 폴백 금지)', () => {
    expect(() => resolveSaveConfig({ NODE_ENV: 'production' })).toThrow(/PUBLIC_ORIGIN/);
  });

  it('production + MAIL_TRANSPORT 미설정 → transport null(503 경로), Secure 쿠키', () => {
    const c = resolveSaveConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://withsmall.kr' });
    expect(c.transport).toBeNull();
    expect(c.secureCookie).toBe(true);
    expect(c.publicOrigin).toBe('https://withsmall.kr');
  });

  it('production + MAIL_TRANSPORT=console → throw', () => {
    expect(() =>
      resolveSaveConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://withsmall.kr', MAIL_TRANSPORT: 'console' }),
    ).toThrow(/console/);
  });

  it('알 수 없는 MAIL_TRANSPORT → throw(console·resend 만)', () => {
    expect(() => resolveSaveConfig({ NODE_ENV: 'development', MAIL_TRANSPORT: 'smtp' })).toThrow(/MAIL_TRANSPORT/);
  });

  it('PUBLIC_ORIGIN 은 순수 오리진만(경로·자격증명 거부), 끝 슬래시 1개는 허용', () => {
    const dev = { NODE_ENV: 'development' };
    expect(resolveSaveConfig({ ...dev, PUBLIC_ORIGIN: 'http://localhost:3001/' }).publicOrigin).toBe('http://localhost:3001');
    expect(() => resolveSaveConfig({ ...dev, PUBLIC_ORIGIN: 'https://a.example/x' })).toThrow(/PUBLIC_ORIGIN/);
    expect(() => resolveSaveConfig({ ...dev, PUBLIC_ORIGIN: 'https://u:p@a.example' })).toThrow(/PUBLIC_ORIGIN/);
    expect(() => resolveSaveConfig({ ...dev, PUBLIC_ORIGIN: 'javascript:alert(1)' })).toThrow(/PUBLIC_ORIGIN/);
  });

  it('production PUBLIC_ORIGIN 은 https(루프백만 http 예외)', () => {
    expect(() => resolveSaveConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://withsmall.kr' })).toThrow(/https/);
    expect(resolveSaveConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://localhost:3001' }).publicOrigin).toBe(
      'http://localhost:3001',
    );
  });
});

describe('ConsoleMailTransport', () => {
  it('development·test 외(production·미설정·staging)에서 생성 불가', () => {
    for (const NODE_ENV of ['production', undefined, 'staging']) {
      expect(() => new ConsoleMailTransport({ env: { NODE_ENV } }), String(NODE_ENV)).toThrow();
    }
    expect(() => new ConsoleMailTransport({ env: { NODE_ENV: 'test' }, log: () => undefined })).not.toThrow();
  });

  it('로그에 이메일 원문이 없다(마스킹)', async () => {
    const lines: string[] = [];
    const t = new ConsoleMailTransport({ env: { NODE_ENV: 'development' }, log: (s) => lines.push(s) });
    await t.send({ to: 'kenny.kim@example.com', subject: 's', text: 'http://localhost:5173/save#t=abc' });
    const out = lines.join('\n');
    expect(out).not.toContain('kenny.kim@example.com');
    expect(out).not.toContain('kenny.kim');
    expect(out).toContain(maskEmail('kenny.kim@example.com'));
    expect(out).toContain('/save#t=abc'); // dev 는 링크를 콘솔에서 연다
  });

  it('maskEmail: 첫 글자·도메인 첫 글자·TLD 만', () => {
    expect(maskEmail('kenny@example.com')).toBe('k***@e***.com');
    expect(maskEmail('a@b.co.kr')).toBe('a***@b***.kr');
  });
});
