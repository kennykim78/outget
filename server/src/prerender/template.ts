// client/dist/index.html 템플릿에 프리렌더 head/body 주입(순수). 계획 §6-2.
//
// 템플릿 계약(client/index.html):
//   <!--ws:head--><title>WithSmall</title>   ← 마커 바로 뒤 title 은 프리렌더 미실행(dev) 대체 제목.
//                                              주입 head 에 <title 이 있으면 함께 제거한다.
//   <div id="root"><!--ws:body--></div>      ← body 마커는 root div 바로 안, 바로 뒤가 </div>.
// 각 마커는 정확히 1회. 아니면 throw(조용히 빈 셸을 내보내지 않는다).
import { escapeAttr } from './html.js';

export const HEAD_MARKER = '<!--ws:head-->';
export const BODY_MARKER = '<!--ws:body-->';

const ROOT_OPEN = '<div id="root">';
const ROOT_CLOSE = '</div>';
const FALLBACK_TITLE_RE = /^\s*<title>[^<]*<\/title>/;
const ATTR_NAME_RE = /^(?:data-[a-z0-9-]+|role|lang|class|aria-[a-z]+)$/;

export interface InjectInput {
  /** `<head>` 에 들어갈 HTML(이미 이스케이프된 조각). */
  head: string;
  /** `<div id="root">` 안에 들어갈 HTML(이미 이스케이프된 조각). */
  body: string;
  /** root div 에 덧붙일 속성(예: data-ws-prerendered="1"). 값은 escapeAttr. */
  rootAttrs?: Readonly<Record<string, string>>;
  /** root div 닫힘 직후에 넣을 HTML(예: ws-data JSON 스크립트). */
  afterRoot?: string;
}

function indexOfOnce(tpl: string, marker: string): number {
  const at = tpl.indexOf(marker);
  if (at < 0) throw new Error(`template: 마커 ${marker} 가 없다`);
  if (tpl.indexOf(marker, at + marker.length) >= 0) throw new Error(`template: 마커 ${marker} 가 두 번 이상 있다`);
  return at;
}

function rootAttrString(attrs: Readonly<Record<string, string>> | undefined): string {
  if (!attrs) return '';
  let out = '';
  for (const name of Object.keys(attrs).sort()) {
    if (!ATTR_NAME_RE.test(name)) throw new Error(`template: 허용되지 않은 root 속성 이름 "${name}"`);
    out += ` ${name}="${escapeAttr(attrs[name])}"`;
  }
  return out;
}

/** 템플릿의 원래 마커 위치만 치환(문자열 slice — `$&` 등 replace 패턴 해석 없음). */
export function injectTemplate(template: string, input: InjectInput): string {
  const headAt = indexOfOnce(template, HEAD_MARKER);
  const bodyAt = indexOfOnce(template, BODY_MARKER);
  if (headAt > bodyAt) throw new Error('template: ws:head 마커가 ws:body 마커보다 뒤에 있다');

  // head: 마커 + (선택) 바로 뒤 대체 title
  let headEnd = headAt + HEAD_MARKER.length;
  const fallback = FALLBACK_TITLE_RE.exec(template.slice(headEnd));
  const keepFallback = fallback !== null && !/<title[\s>]/i.test(input.head);
  if (fallback && !keepFallback) headEnd += fallback[0].length;
  const headOut = keepFallback ? input.head + fallback[0] : input.head;

  // body: 반드시 <div id="root"><!--ws:body--></div>
  const rootAt = bodyAt - ROOT_OPEN.length;
  if (rootAt < 0 || template.slice(rootAt, bodyAt) !== ROOT_OPEN) {
    throw new Error('template: ws:body 마커는 <div id="root"> 바로 안에 있어야 한다');
  }
  const bodyEnd = bodyAt + BODY_MARKER.length;
  if (template.slice(bodyEnd, bodyEnd + ROOT_CLOSE.length) !== ROOT_CLOSE) {
    throw new Error('template: ws:body 마커 바로 뒤가 root 의 </div> 여야 한다');
  }
  const rootOpen = `<div id="root"${rootAttrString(input.rootAttrs)}>`;

  return (
    template.slice(0, headAt) +
    headOut +
    template.slice(headEnd, rootAt) +
    rootOpen +
    input.body +
    ROOT_CLOSE +
    (input.afterRoot ?? '') +
    template.slice(bodyEnd + ROOT_CLOSE.length)
  );
}
