#!/usr/bin/env node
// 빌드 산출 형태 가드 (성능 레인 2). 사용: node scripts/check-perf-shape.mjs [distDir=client/dist]
// 모든 프리렌더 *.html head 형태 + index-*.css / ws-fonts-*.css 의 @font-face 분배를 검사한다. 의존성 0.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX_FONT_FACES = 2;
const WS_FONT_FACES = 92;

function walkHtml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'assets') continue;
      walkHtml(p, out);
    } else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

const count = (s, re) => (s.match(re) || []).length;

export function checkPerfShape(distArg = 'client/dist') {
  const dist = resolve(distArg);
  const errs = [];
  const assets = join(dist, 'assets');
  if (!existsSync(assets)) return [`${dist}: assets/ 없음`];
  const files = readdirSync(assets);
  const indexCss = files.filter((f) => /^index-.*\.css$/.test(f));
  const wsCss = files.filter((f) => /^ws-fonts-.*\.css$/.test(f));
  if (indexCss.length !== 1) errs.push(`assets/index-*.css ${indexCss.length}개 (기대 1)`);
  if (wsCss.length !== 1) errs.push(`assets/ws-fonts-*.css ${wsCss.length}개 (기대 1)`);
  // 그 외 .css(lazy 청크 CSS)는 프리렌더 HTML 이 링크하지 않아 JS 꺼짐 화면이 스타일을 잃는다
  for (const f of files.filter((f) => f.endsWith('.css') && !indexCss.includes(f) && !wsCss.includes(f))) {
    errs.push(`assets/${f}: index-*.css·ws-fonts-*.css 외 CSS (lazy 청크 CSS 는 프리렌더 화면에서 누락)`);
  }

  for (const f of indexCss) {
    const css = readFileSync(join(assets, f), 'utf8');
    const n = count(css, /@font-face/g);
    if (n !== INDEX_FONT_FACES) errs.push(`${f}: @font-face ${n}개 (기대 ${INDEX_FONT_FACES})`);
  }
  for (const f of wsCss) {
    const css = readFileSync(join(assets, f), 'utf8');
    const n = count(css, /@font-face/g);
    if (n !== WS_FONT_FACES) errs.push(`${f}: @font-face ${n}개 (기대 ${WS_FONT_FACES})`);
    for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/g)) {
      const u = m[2].trim();
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u)) {
        errs.push(`${f}: 외부/비로컬 url ${u}`);
        continue;
      }
      const clean = u.split(/[?#]/)[0];
      const target = resolve(clean.startsWith('/') ? join(dist, clean) : join(assets, clean));
      if (!target.startsWith(dist + sep) || !existsSync(target)) errs.push(`${f}: url 대상 없음 ${u}`);
    }
  }

  const htmls = walkHtml(dist);
  if (htmls.length === 0) errs.push('프리렌더된 *.html 없음');
  for (const file of htmls) {
    const rel = file.slice(dist.length + 1).split(sep).join('/');
    const src = readFileSync(file, 'utf8');
    const hm = src.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    if (!hm) {
      errs.push(`${rel}: <head> 없음`);
      continue;
    }
    const head = hm[1];
    const chk = (label, got, want) => {
      if (got !== want) errs.push(`${rel}: ${label} ${got}개 (기대 ${want})`);
    };
    chk('<script type="module"', count(head, /<script[^>]*\stype=["']module["']/gi), 0);
    chk('rel="modulepreload"', count(head, /rel=["']modulepreload["']/gi), 0);
    chk(
      '<script defer src="/assets/ws-boot-*.js">',
      count(head, /<script(?=[^>]*\sdefer)(?=[^>]*\ssrc=["']\/assets\/ws-boot-[^"']+\.js["'])[^>]*>/gi),
      1,
    );
    chk(
      '<noscript> ws-fonts-*.css link',
      count(
        head,
        /<noscript>\s*<link[^>]*rel=["']stylesheet["'][^>]*href=["']\/assets\/ws-fonts-[^"']+\.css["'][^>]*>\s*<\/noscript>/gi,
      ),
      1,
    );
    chk('Pretendard subset.90 preload', count(head, /<link[^>]*rel=["']preload["'][^>]*subset\.90-[^"']*\.woff2/gi), 1);
    chk('Pretendard subset.91 preload', count(head, /<link[^>]*rel=["']preload["'][^>]*subset\.91-[^"']*\.woff2/gi), 1);
    chk('preload 전체', count(head, /<link[^>]*rel=["']preload["']/gi), 2);
    // noscript 밖에서 ws-fonts css 를 직접 로드하면 렌더 차단
    const outside = head.replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');
    if (/ws-fonts-[^"']*\.css/.test(outside)) errs.push(`${rel}: noscript 밖에서 ws-fonts css 참조`);
    for (const m of head.matchAll(/<(?:script|link)[^>]*(?:src|href)=["'](?:https?:)?\/\/[^"']+/gi)) {
      if (/rel=["'](?:canonical|alternate)["']/i.test(m[0])) continue;
      errs.push(`${rel}: 외부 출처 참조 ${m[0].slice(0, 80)}`);
    }
  }
  return errs;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const dir = process.argv[2] || 'client/dist';
  const errs = checkPerfShape(dir);
  if (errs.length) {
    console.error(`check-perf-shape: 위반 ${errs.length}건`);
    for (const e of errs) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`check-perf-shape: OK (${dir})`);
}
