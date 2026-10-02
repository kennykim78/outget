// 마스코트 인라인 SVG(스펙22 §2.16 D-2) — 히어로·컨텍스트 헤더만. 원본 docs/design/mascots/*.svg(리포 자산, 외부 수집 아님).
//   순수 정제기: <metadata>(C2PA) 제거 → 요소·속성 허용목록 검사(밖이면 throw — 조용한 통과 없음) → 루트 <svg> 재작성
//   (role·aria-label 제거, aria-hidden·focusable=false). 이름이 옆에 있으므로 장식 취급.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ELEMENTS = new Set(['svg', 'g', 'circle', 'ellipse', 'path', 'rect', 'line', 'polygon', 'polyline']);
const ATTRS = new Set([
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'width', 'height', 'transform',
  'fill', 'fill-opacity', 'fill-rule', 'opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-opacity',
]);
const VIEWBOX_RE = /^[0-9. -]+$/;
/** 속성 값: 괄호 없는 단순 값(색·숫자·경로) 또는 정확히 url(#id)(문서 내부 참조만 — 상대·외부 url(foo.svg) 금지, S-R4 L-F). */
const PLAIN_VALUE_RE = /^[#a-zA-Z0-9 .,%-]*$/;
const LOCAL_URL_RE = /^url\(#[A-Za-z][\w-]*\)$/;
const valueOk = (v: string): boolean => PLAIN_VALUE_RE.test(v) || LOCAL_URL_RE.test(v);
const ASSET_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 원본 SVG 문자열 → 정제된 인라인 SVG. 허용목록 밖 요소·속성·값이 있으면 throw. */
export function sanitizeMascotSvg(raw: string, name: string): string {
  const src = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).replace(/<metadata>[\s\S]*?<\/metadata>/g, '').trim().replace(/^<\?xml[^>]*\?>\s*/, '');
  const root = /^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(src);
  if (!root) throw new Error(`mascot ${name}: <svg> 루트 없음`);
  const viewBox = /\bviewBox="([^"]*)"/.exec(root[1])?.[1];
  if (!viewBox || !VIEWBOX_RE.test(viewBox)) throw new Error(`mascot ${name}: viewBox 없음·형식 오류`);
  const body = root[2];
  // L-F(S-R4): 본문의 모든 선언·주석·CDATA(<!…)와 처리 명령(<?…)·엔티티 금지.
  if (/<[!?]|&/.test(body)) throw new Error(`mascot ${name}: <! · <? · 엔티티 금지`);
  for (const m of body.matchAll(/<\/?\s*([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    const el = m[1];
    if (!ELEMENTS.has(el) || el === 'svg') throw new Error(`mascot ${name}: 허용 밖 요소 <${el}>`);
    const attrs = m[2].replace(/\/\s*$/, '');
    const rest = attrs.replace(/\s([a-zA-Z][\w:-]*)="([^"]*)"/g, (_x, k: string, v: string) => {
      if (!ATTRS.has(k)) throw new Error(`mascot ${name}: 허용 밖 속성 ${k}`);
      if (!valueOk(v)) throw new Error(`mascot ${name}: 허용 밖 값 ${k}="${v}"`);
      return '';
    });
    if (rest.trim() !== '') throw new Error(`mascot ${name}: 해석할 수 없는 속성 "${rest.trim()}"`);
  }
  const stripped = body.replace(/<[^>]+>/g, '').trim();
  if (stripped !== '') throw new Error(`mascot ${name}: 텍스트 노드 금지`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="96" height="96" aria-hidden="true" focusable="false" class="ws-mascot-svg">${body.trim()}</svg>`;
}

/**
 * 디렉터리의 *.svg → 자산 이름(파일명) → 정제 SVG.
 *   required(운영 빌드) 이면 디렉터리 없음·읽기 실패·svg 0개를 throw(S-R4 L-F — 마스코트 없이 조용히 배포 금지).
 *   아니면(개발·테스트) 빈 맵 → 마스코트 없이 렌더.
 */
export function loadMascots(dir: string, opts: { required?: boolean } = {}): Map<string, string> {
  const out = new Map<string, string>();
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.svg'));
  } catch {
    if (opts.required) throw new Error(`mascot: 원본 디렉터리 없음 ${dir} (운영 빌드 필수 — Dockerfile COPY docs/design/mascots)`);
    return out;
  }
  if (opts.required && files.length === 0) throw new Error(`mascot: ${dir} 에 svg 없음 (운영 빌드 필수)`);
  for (const f of files.sort()) {
    const name = f.slice(0, -4);
    if (!ASSET_RE.test(name)) continue;
    out.set(name, sanitizeMascotSvg(readFileSync(join(dir, f), 'utf8'), name));
  }
  return out;
}
