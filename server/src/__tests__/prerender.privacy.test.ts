// 계획 86 P8 — /privacy 프리렌더(라우트·푸터·본문 데이터). 기간 숫자 단일 출처(privacy/policy.ts)·금지어 0·자리표시 목록·법정 항목 대응.
//   compliance 산출물 대조(C9-PRIVACY)는 scripts/__tests__/compliance-scan.test.mjs.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as policy from '../privacy/policy.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { COPY } from '../prerender/copy.js';
import {
  DERIVED,
  KENNY_PLACEHOLDERS,
  POLICY_PERIODS,
  PRIVACY_POLICY,
  assertInternalHref,
  fillTokens,
  linkMailto,
  privacyStrings,
  tokensOf,
} from '../prerender/privacy-content.js';
import { lintText } from '../seed/lint.js';
import { FIXTURE_AS_OF, promoted, realSeed } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..');
const TEMPLATE = readFileSync(join(ROOT, 'client', 'index.html'), 'utf8');
const ORIGIN = 'http://localhost:3001';
const DIGEST = 'a'.repeat(64);

const build = (production?: boolean, seed = realSeed()): SiteBuild =>
  buildSite(seed, { template: TEMPLATE, origin: ORIGIN, seedDigest: DIGEST, asOf: FIXTURE_AS_OF, production });
const pageOf = (b: SiteBuild, p: string): string => {
  const html = b.pages.find((x) => x.route.path === p)?.html;
  if (typeof html !== 'string') throw new Error(`${p} 없음`);
  return html;
};
/** 대략의 가시 텍스트(태그 제거 + 엔티티 일부 복원). */
const textOf = (html: string): string =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

describe('/privacy 라우트·푸터(P8)', () => {
  const b = build();

  it('라우트: kind PRIVACY · indexable · sitemap 포함 · noindex 없음 · canonical /privacy', () => {
    const r = b.routes.find((x) => x.path === '/privacy');
    expect(r).toMatchObject({ kind: 'PRIVACY', indexable: true, file: 'privacy/index.html', canonicalPath: '/privacy', layer: null });
    expect(b.files.get('sitemap.xml')).toContain(`<loc>${ORIGIN}/privacy</loc>`);
    expect(b.manifest.routes).toContainEqual({ path: '/privacy', file: 'privacy/index.html', kind: 'PRIVACY', indexable: true });
    const html = pageOf(b, '/privacy');
    expect(html).not.toContain('name="robots"');
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/privacy">`);
    expect(html).toContain('data-ws-route="PRIVACY"');
    expect(html).toContain(`<h1>${COPY.privacy.title}</h1>`);
  });

  it('승격 시드(타입 노출)에서도 /privacy 는 항상 1개', () => {
    const p = build(false, promoted());
    expect(p.routes.filter((r) => r.kind === 'PRIVACY').map((r) => r.path)).toEqual(['/privacy']);
  });

  it('모든 페이지(404 포함) 푸터에 <a href="/privacy">개인정보 처리방침</a>', () => {
    for (const p of b.pages) expect(p.html, p.route.path).toContain(`<a href="/privacy">${COPY.footer.privacy}</a>`);
  });

  it('manifest.mode: 기본 development, production:true 면 production', () => {
    expect(b.manifest.mode).toBe('development');
    expect(build(true).manifest.mode).toBe('production');
    expect(JSON.parse(build(true).files.get('prerender-manifest.json') as string).mode).toBe('production');
  });

  it('ws-data: route.kind PRIVACY, layer null, data 는 types 만', () => {
    const page = b.pages.find((x) => x.route.path === '/privacy');
    expect(page?.data.route).toEqual({ kind: 'PRIVACY', path: '/privacy' });
    expect(page?.data.layer).toBeNull();
    expect(page?.data.data.requirements).toEqual([]);
  });
});

describe('/privacy 본문(P8·P10)', () => {
  const html = pageOf(build(), '/privacy');

  it('기간 숫자 = privacy/policy.ts(span[data-ws-policy]) — *_RETENTION_DAYS export 전부', () => {
    const exported = Object.entries(policy).filter(([k, v]) => k.endsWith('_RETENTION_DAYS') && typeof v === 'number');
    expect(exported.length).toBeGreaterThanOrEqual(5);
    for (const [k, v] of exported) {
      expect(POLICY_PERIODS, k).toHaveProperty(k, v);
      expect(html, k).toContain(`<span data-ws-policy="${k}">${v}</span>`);
    }
    // 페이지의 모든 span 이 POLICY_PERIODS 값과 같다.
    for (const m of html.matchAll(/<span data-ws-policy="([A-Z0-9_]+)">([^<]*)<\/span>/g)) {
      expect(String(POLICY_PERIODS[m[1] as keyof typeof POLICY_PERIODS]), m[1]).toBe(m[2]);
    }
  });

  it('파생 숫자: 세션 90일 · 연결 링크 15분 · 정리 24시간 · 변경 고지 7일(K-4)', () => {
    expect(DERIVED).toEqual({ SESSION_DAYS: 90, MAGIC_LINK_MINUTES: 15, CLEANUP_INTERVAL_HOURS: 24, CHANGE_NOTICE_DAYS: 7 });
    expect(textOf(html)).toContain('90일 뒤 만료돼요');
    expect(textOf(html)).toContain('15분 뒤 만료되고');
    expect(textOf(html)).toContain('시행 7일 전에');
  });

  it('토큰 원문이 산출물에 남지 않는다({policy:·{const:)', () => {
    expect(html).not.toMatch(/\{policy:|\{const:/);
  });

  it('자리표시: 본문 {{KENNY:키}} 는 KENNY_PLACEHOLDERS 안에서만, 목록 키는 전부 본문에 쓰인다', () => {
    const used = new Set(privacyStrings().flatMap((s) => tokensOf(s).kenny));
    expect([...used].sort()).toEqual([...KENNY_PLACEHOLDERS].sort());
    for (const k of KENNY_PLACEHOLDERS) expect(html, k).toContain(`{{KENNY:${k}}}`);
    expect(() => fillTokens('{{KENNY:unknownKey}}')).toThrow(/알 수 없는 자리표시/);
    expect(() => fillTokens('{policy:NOPE_DAYS}')).toThrow(/policy\.ts 에 없는/);
    expect(() => fillTokens('{const:NOPE}')).toThrow(/알 수 없는 상수/);
  });

  it('금지어·어간 0(데이터 문자열 + 렌더된 가시 텍스트 + 태그 경계 결합)', () => {
    for (const s of privacyStrings()) expect(lintText(s), s).toEqual([]);
    for (const s of Object.values(COPY.privacy)) expect(lintText(s), s).toEqual([]);
    const main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? '';
    expect(lintText(textOf(main))).toEqual([]);
    expect(lintText(textOf(main).replace(/\s+/g, ''))).toEqual([]);
    // 표현 바꿈(계획 86 R2): '안전성 확보 조치' → '개인정보 보호 조치', '회원' 0.
    expect(textOf(main)).toContain('개인정보 보호 조치');
    expect(textOf(main)).not.toMatch(/회원|가입/);
  });

  it('보호 조치: 운영자 접속 기록 1년 별도 보관 문장(MED-3) + 웹 접속 기록 미보관·서버 오류 기록 문구 유지', () => {
    const text = textOf(/<main[\s\S]*<\/main>/.exec(html)?.[0] ?? '');
    expect(text).toContain(
      '서버에 들어온 운영자의 접속 기록(접속 시각, 접속한 곳의 IP 주소, 한 작업)은 1년 동안 따로 보관하고 점검해요. 이 기록에는 이용자의 이메일 주소를 남기지 않아요.',
    );
    expect(text).toContain('접속한 IP 주소가 담긴 웹 접속 기록은 남기지 않아요.');
    expect(text).toContain('일이 지나면 자동으로 지워요.');
  });

  it('보유 기간 표: 운영자 접속 기록 1년 행(security 150 MED-B) — 다른 행과 같은 2칸, 웹 접속 기록·서버 오류 기록 행 유지', () => {
    const sec = PRIVACY_POLICY.sections.find((s) => s.id === 'retention');
    const tb = sec?.blocks.find((b) => 'table' in b);
    if (!tb || !('table' in tb)) throw new Error('보유 기간 표 없음');
    const row = tb.table.rows.find((r) => r[0] === '운영자 접속 기록');
    expect(row).toEqual(['운영자 접속 기록', '서버에 들어온 운영자의 기록이에요. 1년 동안 보관하고, 1년이 지나면 자동으로 지워요.']);
    for (const r of tb.table.rows) expect(r).toHaveLength(2);
    expect(tb.table.rows.map((r) => r[0])).toEqual(expect.arrayContaining(['웹 접속 기록', '서버 오류 기록']));
    const html2 = /<section[^>]*id="privacy-retention"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(textOf(html2)).toContain('운영자 접속 기록');
    expect(textOf(html2)).toContain('1년 동안 보관하고, 1년이 지나면 자동으로 지워요.');
  });

  it('해요체: 문단(p)·intro 는 "요." 또는 "요" 로 끝난다(라벨형 문단 서버 위치는 예외)', () => {
    const paras = [...PRIVACY_POLICY.intro, ...PRIVACY_POLICY.sections.flatMap((s) => s.blocks.flatMap((b) => ('p' in b ? [b.p] : [])))];
    for (const p of paras) {
      if (p.startsWith('서버 위치:')) continue;
      for (const sentence of p.split(/(?<=\.)\s+/)) expect(sentence, p).toMatch(/요[.)]?$/);
    }
  });

  it('법정 기재 항목 대응(법 제30조①1~7호 + 시행령 제31조①1~4호 + 제31조의2④ + 제30조②) 전부, 섹션 id 고유', () => {
    const legal = PRIVACY_POLICY.sections.map((s) => s.legal).join(' | ');
    for (const ref of [
      '법 제30조제1항제1호',
      '법 제30조제1항제2호',
      '법 제30조제1항제3호 ',
      '법 제30조제1항제3호의2',
      '법 제30조제1항제3호의3',
      '법 제30조제1항제4호 ',
      '법 제30조제1항제4호의2',
      '법 제30조제1항제5호',
      '법 제30조제1항제6호',
      '법 제30조제1항제7호',
      '시행령 제31조제1항제1호',
      '시행령 제31조제1항제2호',
      '시행령 제31조제1항제3호',
      '시행령 제31조제1항제4호',
      '법 제31조의2제4항',
      '법 제30조제2항',
    ]) {
      expect(`${legal} `, ref).toContain(ref);
    }
    const ids = PRIVACY_POLICY.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(html, id).toContain(`id="privacy-${id}"`);
  });

  it('해당 없음: 제3자 제공·민감정보·가명정보·국외 직접 수집·국내대리인', () => {
    const na = PRIVACY_POLICY.sections.filter((s) => s.notApplicable).map((s) => s.id);
    expect(na.sort()).toEqual(['domestic-agent', 'overseas-collection', 'pseudonym', 'sensitive', 'third-party']);
  });

  it('K-3 국외 이전(미국·Resend)·K-4 만 14세 미만 안내·버전/시행일/이전 버전', () => {
    const t = textOf(html);
    expect(t).toContain('이전하는 국가: 미국');
    expect(t).toContain('Resend, Inc.');
    expect(t).toContain('만 14세 미만');
    expect(html).toContain(`data-ws-privacy-version="${PRIVACY_POLICY.version}"`);
    expect(t).toContain(`${COPY.privacy.effectiveDate} {{KENNY:effectiveDate}}`);
    expect(PRIVACY_POLICY.previousVersions).toEqual([]);
    expect(t).toContain(COPY.privacy.previousNone);
  });

  it('96 S2: 받는 항목 표는 2열(구분·항목), 받는 때는 항목 셀 둘째 줄 span.ws-t-meta.ws-privacy-meta(문구 이동만)', () => {
    const items = PRIVACY_POLICY.sections.find((s) => s.id === 'items');
    const tb = items?.blocks.find((b) => 'table' in b);
    if (!tb || !('table' in tb)) throw new Error('items 표 없음');
    expect(tb.table.head).toEqual(['구분', '항목']);
    expect(tb.table.rows).toHaveLength(8);
    for (const r of tb.table.rows) {
      expect(r).toHaveLength(2);
      const c = r[1];
      if (typeof c === 'string') throw new Error(`${String(r[0])}: 받는 때 없음`);
      expect(c.meta).toMatch(/^받는 때: \S/);
    }
    const sec = /<section[^>]*id="privacy-items"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    const table = /<table class="ws-privacy-table">[\s\S]*?<\/table>/.exec(sec)?.[0] ?? '';
    expect(table.match(/<th scope="col">/g)).toHaveLength(2);
    expect(table).not.toContain('<th scope="col">받는 때</th>');
    expect(table.match(/<td>[^<]*<span class="ws-t-meta ws-privacy-meta">받는 때: [^<]+<\/span><\/td>/g)).toHaveLength(8);
    expect(table).toContain('<td>이메일 주소, 저장한 준비 내용(고른 친구, 케이지 크기, 준비 체크 상태)<span class="ws-t-meta ws-privacy-meta">받는 때: 이메일 저장을 요청하고 연결 링크를 열 때</span></td>');
  });

  it('96 S3: 표 가로 스크롤 래퍼 없음(table 이 섹션 직속)', () => {
    expect(html).not.toContain('ws-privacy-table-wrap');
    expect(html.match(/<table class="ws-privacy-table">/g)?.length).toBe(3);
  });

  it('96 N2: 권리 절 지우기 문장 끝 /save 텍스트 링크, officerEmail 은 자리표시 유지', () => {
    const sec = /<section[^>]*id="privacy-rights"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(sec).toContain('이메일 저장 화면에서 지우기를 고르면 이메일 주소와 저장한 준비 내용을 바로 지워요. <a href="/save">이메일 저장 화면 열기</a></p>');
    expect(sec).toContain('{{KENNY:officerEmail}}');
    expect(html).not.toContain('href="mailto:');
  });

  it('96 N2: 링크는 내부 경로만(assertInternalHref), 메일 주소 글자는 mailto 로(K-2 준비, 태그 안은 그대로)', () => {
    expect(assertInternalHref('/save')).toBe('/save');
    for (const bad of ['//evil.example', 'https://x.example', '/\\x', 'save', 'javascript:alert(1)', '/a"b']) expect(() => assertInternalHref(bad), bad).toThrow(/내부 경로/);
    expect(linkMailto('메일({{KENNY:officerEmail}})로')).toBe('메일({{KENNY:officerEmail}})로');
    expect(linkMailto('메일: privacy@withsmall.kr 로')).toBe('메일: <a href="mailto:privacy@withsmall.kr">privacy@withsmall.kr</a> 로');
    expect(linkMailto('<span data-x="a@b.kr">a@b.kr</span>')).toBe('<span data-x="a@b.kr"><a href="mailto:a@b.kr">a@b.kr</a></span>');
  });

  it('외부 링크·이미지·스크립트 추가 0(처리방침 본문은 텍스트만)', () => {
    const main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? '';
    expect(main).not.toMatch(/<(img|script|iframe)\b/);
    expect(main).not.toMatch(/href="https?:/);
  });
});
