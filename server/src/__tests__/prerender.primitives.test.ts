// R3 F1 — 프리렌더 기본 부품(순수 문자열). 엔진·시드 비의존.
import { describe, expect, it } from 'vitest';
import { escapeAttr, escapeHtml, jsonForScript } from '../prerender/html.js';
import { BODY_MARKER, HEAD_MARKER, injectTemplate } from '../prerender/template.js';
import { buildSitemap } from '../prerender/sitemap.js';
import { buildRobots } from '../prerender/robots.js';
import { COPY, allCopyStrings, formatCopy } from '../prerender/copy.js';
import { lintText } from '../seed/lint.js';

// 위반 문자열은 런타임 조립(compliance-scan 이 테스트 소스를 걸러내지 않음).
const SCRIPT_CLOSE = '<' + '/script>';
const XSS = `${SCRIPT_CLOSE}<img onerror>`;

describe('html.escapeHtml / escapeAttr', () => {
  it('"</script><img onerror>" 를 이스케이프해 태그가 남지 않는다', () => {
    const out = escapeHtml(XSS);
    expect(out).toBe('&lt;/script&gt;&lt;img onerror&gt;');
    expect(out).not.toMatch(/[<>]/);
  });

  it('& " \' 를 엔티티로 바꾸고 & 는 한 번만(이중 이스케이프 없음)', () => {
    expect(escapeHtml(`a & b "c" 'd'`)).toBe('a &amp; b &quot;c&quot; &#39;d&#39;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('escapeAttr 은 따옴표·꺾쇠·백틱·& 를 막아 속성 탈출이 불가하다', () => {
    const out = escapeAttr(`" onmouseover=alert(1) x="${XSS}\``);
    expect(out).not.toMatch(/["'<>`]/);
    expect(out).toContain('&quot;');
    expect(out).toContain('&#96;');
  });

  it('한글·숫자는 그대로 둔다', () => {
    expect(escapeHtml('골든햄스터 60×40cm')).toBe('골든햄스터 60×40cm');
  });
});

describe('html.jsonForScript', () => {
  it('문자열 안의 </script> 가 원문으로 남지 않는다(`</` 0)', () => {
    const out = jsonForScript({ a: XSS, b: ['<!--', '-->', '&amp;'] });
    expect(out.includes('</')).toBe(false);
    expect(out).not.toMatch(/[<>&]/);
    expect(out).toContain('\\u003c/script\\u003e');
  });

  it('U+2028/U+2029 를 \\u 이스케이프한다', () => {
    const out = jsonForScript({ s: 'a\u2028b\u2029c' });
    expect(out).not.toMatch(/[\u2028\u2029]/);
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
  });

  it('JSON.parse 로 원래 값이 복원된다(왕복)', () => {
    const v = { a: XSS, n: 1.5, k: '골든햄스터', z: null, arr: [true, 'x\u2028y'] };
    expect(JSON.parse(jsonForScript(v))).toEqual(v);
  });

  it('직렬화 불가 값(undefined·함수)은 throw', () => {
    expect(() => jsonForScript(undefined)).toThrow();
    expect(() => jsonForScript(() => 1)).toThrow();
  });
});

describe('template.injectTemplate', () => {
  const TPL = [
    '<!doctype html><html><head><meta charset="UTF-8" />',
    `    ${HEAD_MARKER}<title>WithSmall</title>`,
    '</head><body>',
    `    <div id="root">${BODY_MARKER}</div>`,
    '    <script type="module" src="/src/main.tsx"></script>',
    '</body></html>',
  ].join('\n');

  it('마커 두 개를 head/body 로 바꾸고 마커는 남지 않는다', () => {
    const out = injectTemplate(TPL, { head: '<title>골든햄스터</title>', body: '<main>본문</main>' });
    expect(out).toContain('<title>골든햄스터</title>');
    expect(out).toContain('<div id="root"><main>본문</main></div>');
    expect(out).not.toContain(HEAD_MARKER);
    expect(out).not.toContain(BODY_MARKER);
  });

  it('주입 head 에 title 이 있으면 dev 대체 title 은 제거된다(title 1개)', () => {
    const out = injectTemplate(TPL, { head: '<title>A</title>', body: '' });
    expect(out.match(/<title>/g)).toHaveLength(1);
  });

  it('주입 head 에 title 이 없으면 dev 대체 title 을 남긴다', () => {
    const out = injectTemplate(TPL, { head: '<meta name="robots" content="noindex">', body: '' });
    expect(out).toContain('<title>WithSmall</title>');
  });

  it('root 속성과 root 뒤 스크립트를 넣는다', () => {
    const out = injectTemplate(TPL, {
      head: '',
      body: '<p>x</p>',
      rootAttrs: { 'data-ws-prerendered': '1' },
      afterRoot: '<script id="ws-data" type="application/json">{}</script>',
    });
    expect(out).toContain(
      '<div id="root" data-ws-prerendered="1"><p>x</p></div><script id="ws-data" type="application/json">{}</script>',
    );
  });

  it('$& · $\' 같은 치환 패턴이 해석되지 않는다', () => {
    const out = injectTemplate(TPL, { head: '<title>$&</title>', body: "$' $` $$" });
    expect(out).toContain('<title>$&</title>');
    expect(out).toContain("<div id=\"root\">$' $` $$</div>");
  });

  it('주입 내용에 마커 문자열이 있어도 원래 위치만 바뀐다', () => {
    const out = injectTemplate(TPL, { head: `<title>${BODY_MARKER}</title>`, body: 'B' });
    expect(out).toContain(`<title>${BODY_MARKER}</title>`);
    expect(out).toContain('<div id="root">B</div>');
  });

  it('마커가 없으면 throw', () => {
    expect(() => injectTemplate(TPL.replace(HEAD_MARKER, ''), { head: '', body: '' })).toThrow(/ws:head/);
    expect(() => injectTemplate(TPL.replace(BODY_MARKER, ''), { head: '', body: '' })).toThrow(/ws:body/);
  });

  it('마커가 두 번 이상이면 throw', () => {
    expect(() => injectTemplate(TPL + HEAD_MARKER, { head: '', body: '' })).toThrow(/ws:head/);
    expect(() => injectTemplate(TPL + BODY_MARKER, { head: '', body: '' })).toThrow(/ws:body/);
  });

  it('body 마커가 <div id="root"> 바로 안이 아니면 throw', () => {
    const bad = TPL.replace(`<div id="root">${BODY_MARKER}</div>`, `<div id="app">${BODY_MARKER}</div>`);
    expect(() => injectTemplate(bad, { head: '', body: '' })).toThrow(/root/);
  });

  it('rootAttrs 이름이 잘못되거나 id 를 덮으려 하면 throw, 값은 이스케이프', () => {
    expect(() => injectTemplate(TPL, { head: '', body: '', rootAttrs: { 'on"x': '1' } })).toThrow();
    expect(() => injectTemplate(TPL, { head: '', body: '', rootAttrs: { id: 'x' } })).toThrow();
    const out = injectTemplate(TPL, { head: '', body: '', rootAttrs: { 'data-x': '"><b>' } });
    expect(out).toContain('data-x="&quot;&gt;&lt;b&gt;"');
  });
});

describe('robots', () => {
  it('기본(옵션 없음) = Disallow: / 이고 Sitemap 줄 없음', () => {
    const r = buildRobots();
    expect(r).toBe('User-agent: *\nDisallow: /\n');
    expect(r).not.toMatch(/Allow: \/\n|Sitemap/);
  });

  it('indexable=true 가 아니면(문자열 "1" 포함) Disallow', () => {
    expect(buildRobots({ indexable: false, origin: 'https://withsmall.kr' })).toBe('User-agent: *\nDisallow: /\n');
    expect(buildRobots({ indexable: '1' as unknown as boolean, origin: 'https://withsmall.kr' })).toContain('Disallow: /');
  });

  it('indexable=true 일 때만 Allow + Sitemap 줄', () => {
    expect(buildRobots({ indexable: true, origin: 'https://withsmall.kr/' })).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://withsmall.kr/sitemap.xml\n',
    );
  });

  it('indexable=true 인데 origin 이 없거나 잘못되면 throw', () => {
    expect(() => buildRobots({ indexable: true })).toThrow();
    expect(() => buildRobots({ indexable: true, origin: 'javascript:alert(1)' })).toThrow();
    expect(() => buildRobots({ indexable: true, origin: 'https://a.kr/x' })).toThrow();
  });
});

describe('sitemap', () => {
  const ORIGIN = 'http://localhost:3001';

  it('결정론: 입력 순서가 달라도 같은 출력, 빌드 시각 미기록', () => {
    const a = buildSitemap(ORIGIN, [
      { path: '/hamster/golden', lastmod: '2026-09-30' },
      { path: '/' },
    ]);
    const b = buildSitemap(ORIGIN, [
      { path: '/' },
      { path: '/hamster/golden', lastmod: '2026-09-30' },
    ]);
    expect(a).toBe(b);
    // 날짜는 입력 lastmod 뿐(빌드 시각·T 시각 없음).
    expect(a.match(/\d{4}-\d{2}-\d{2}/g)).toEqual(['2026-09-30']);
    expect(a).not.toMatch(/T\d{2}:\d{2}/);
  });

  it('loc = origin + path, lastmod 는 입력값 그대로, 없으면 생략', () => {
    const x = buildSitemap(ORIGIN + '/', [{ path: '/' }, { path: '/hamster/golden', lastmod: '2026-09-30' }]);
    expect(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(x).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(x).toContain('<url><loc>http://localhost:3001/</loc></url>');
    expect(x).toContain('<url><loc>http://localhost:3001/hamster/golden</loc><lastmod>2026-09-30</lastmod></url>');
    expect(x.indexOf('/hamster/golden')).toBeGreaterThan(x.indexOf('3001/<'));
  });

  it('한글 경로는 percent-encode', () => {
    const x = buildSitemap(ORIGIN, [{ path: '/vet/서울-마포구' }]);
    expect(x).toContain(`<loc>${ORIGIN}/vet/${encodeURIComponent('서울-마포구')}</loc>`);
  });

  it('빈 목록도 유효한 urlset', () => {
    expect(buildSitemap(ORIGIN, [])).toContain('<urlset');
  });

  it('잘못된 입력은 throw: 중복 path, 상대 path, %·?·#·공백, 잘못된 lastmod, 잘못된 origin', () => {
    expect(() => buildSitemap(ORIGIN, [{ path: '/' }, { path: '/' }])).toThrow();
    expect(() => buildSitemap(ORIGIN, [{ path: 'hamster' }])).toThrow();
    expect(() => buildSitemap(ORIGIN, [{ path: '/a%20b' }])).toThrow();
    expect(() => buildSitemap(ORIGIN, [{ path: '/a?b' }])).toThrow();
    expect(() => buildSitemap(ORIGIN, [{ path: '/a#b' }])).toThrow();
    expect(() => buildSitemap(ORIGIN, [{ path: '/a b' }])).toThrow();
    expect(() => buildSitemap(ORIGIN, [{ path: '//evil.example' }])).toThrow();
    expect(() => buildSitemap(ORIGIN, [{ path: '/', lastmod: '2026-9-1' }])).toThrow();
    expect(() => buildSitemap(ORIGIN, [{ path: '/', lastmod: '2026-02-30' }])).toThrow();
    expect(() => buildSitemap('ftp://x', [{ path: '/' }])).toThrow();
  });
});

describe('copy', () => {
  const strings = allCopyStrings();

  it('문구가 충분히 수집된다(섹션 제목 포함)', () => {
    expect(strings.length).toBeGreaterThan(40);
    for (const t of ['지금 필요한 것', '처음 준비한다면', '기준에 맞는 준비물', '우리 동네 병원']) {
      expect(strings).toContain(t);
    }
    expect(COPY.homeB.nowBeforeSetup).toBe('필수 준비를 먼저 확인해요');
    expect(COPY.vet.emptyAll).toBe('전화로 확인한 병원을 준비하고 있어요');
  });

  it('copy.ts 전 문자열 lintText → [] (금지어 L01·어간 L02 0)', () => {
    const bad = strings.map((s) => ({ s, hits: lintText(s) })).filter((x) => x.hits.length > 0);
    expect(bad).toEqual([]);
  });

  it('디자인 브리프 금지 표현·의료 단정 0', () => {
    const extra =
      /판매(?!처)|거래|세트|추천 상품|괜찮아요|안전해요|로그인하면 더|지금 가입|만 사용자|전문가|진단|치료|완치|무해|문제없|걱정 없|보장/;
    expect(strings.filter((s) => extra.test(s))).toEqual([]);
  });

  it('문장형 문구는 "~요" 존댓말로 끝난다(마침표·물음표 앞)', () => {
    const sentences = allCopyStrings({ sentencesOnly: true });
    expect(sentences.length).toBeGreaterThan(10);
    expect(sentences.filter((s) => !/요[.?]?$/.test(s))).toEqual([]);
  });

  it('COPY 는 동결되어 런타임 변경 불가', () => {
    expect(Object.isFrozen(COPY)).toBe(true);
    expect(Object.isFrozen(COPY.homeB)).toBe(true);
  });

  it('formatCopy 는 {animal} 만 채우고 미지 토큰은 throw', () => {
    expect(formatCopy(COPY.homeB.saveTitle, { animal: '골든햄스터' })).toBe('골든햄스터 준비, 이어서 할까요?');
    expect(() => formatCopy('{x}', { animal: 'a' })).toThrow();
    expect(() => formatCopy(COPY.homeB.saveTitle, {})).toThrow();
  });
});
