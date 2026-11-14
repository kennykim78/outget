// C10-AFF-* — 검색 딥링크 제휴 계층(258 단계 7) 규칙. compliance-scan.mjs 가 add(finding) 로 수집.
//   의존성: node 빌트인 + C10-AFF-IMPORT 구문 분석에만 루트 devDependency `typescript`(274 — 정규식 import 추출의 삼항·보간 오인을 구문 단위로).
//   typescript 를 적재하지 못하면 감시 대상이 있는 트리에서 C10-AFF-IMPORT FAIL(fail-closed). 그 밖 규칙(HOST·REDIRECT·FIELD·OUT)은 빌트인만.
//   불변식 ①(크롤링·외부 수집 0 — 링크 코드는 운영자 수동 맵만) · ③(제휴는 노출·순서·추천 자격에 영향 0 — import 격리, 버튼 동등)
//   · ④(자금 미보유 — 수수료 데이터가 들어올 자리 0, 서버 리다이렉트 0).
//
//   C10-AFF-IMPORT   노출·순서 결정 엔진 파일의 import 전이 폐포(구문 트리 기준)가 제휴 모듈(providers·search-links·prerender/affiliate·
//                    server/affiliate/*)에 닿으면 FAIL. 엔진 배럴(@ws/engine)은 심볼 단위 — 가져온 이름을 재수출·별칭·지역 상수 대입을 따라
//                    원본 모듈·심볼까지 추적하고, 원본이 제휴 모듈의 값이면 FAIL, 아니면 원본 파일부터 폐포를 이어 간다.
//                    해석 불가(파일 아닌 상대 경로·모르는 별칭·#·~ 지정자·비리터럴 동적 import·require 별칭·import.meta.glob)·구문 오류·
//                    분석 예외는 fail-closed FAIL. client/tsconfig.json paths·vite alias 에 ALIASES 표 밖 별칭이 있어도 FAIL.
//   C10-AFF-RUNTIME  서버 런타임(server/src/index.ts)·메일(server/src/save/**) 폐포가 맵 로더·맵 파일에 닿으면 WARN(게이트는 빌드 타임만).
//   C10-AFF-HOST     제휴 호스트(link.coupang · coupa.ng)는 허용 파일만. 엔티티·JS 이스케이프(\x·\u·\u{}·8진)·퍼센트·전각 점을 풀고,
//                    코드는 인접 문자열 리터럴의 + 결합과 상수만 보간한 템플릿을 접어서 본다.
//   C10-AFF-REDIRECT 서버·클라 라우트 문자열에 /go·/out·/aff*·/r·/redirect·/click 마디 0, redirect·Location 은 허용 파일 + 내부 경로만.
//                    정적 계산 멤버(s['redirect'])·이스케이프 헤더 이름을 풀고, 헤더 이름이 식이면 판정 불가 FAIL.
//   C10-AFF-FIELD    시드·Prisma·코드 식별자에 수수료류(commission·rebate·kickback)·affiliate*·subId 0, 맵 파일은 로더(prerender/affiliate.ts)와
//                    같은 거부(키 집합·날짜 달력·코드 중복·원문 중복 키).
//   C10-AFF-OUT      산출물: 쿠팡 a 형태(검색 결과 페이지 또는 link.coupang.com/a/<code>), 제휴 a 마다 rel∋sponsored·고지 A(같은 .ws-search,
//                    앞, describedby)·고지 B(같은 L4/L7 aside 직속, 검색 블록 앞)·원문 바이트 일치·숨김 0(인라인·조상·일반 CSS 선택자)·
//                    상인 버튼과 속성·자식 구조 동등(href·rel 의 sponsored·describedby 만 다름), 개발 빌드 제휴 0, ws-data v3 aff 형식,
//                    카탈로그·sitemap 등 제휴 0. 전체 HTML 검사는 부모별 색인으로 선형.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, posix } from 'node:path';
import { CODE_EXT, isDir, lexJs, lineIndex, relPosix, stripBom, walk } from './files.mjs';
import { decodeEntities, maskNonMarkup, parseAttrs, scripts } from './html.mjs';
import { isTestFile, jsonErrorWhere, safeLabel } from './rules-source.mjs';

const L = safeLabel;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// ── 경로 상수(한 곳) — 259(제휴 모듈 신설) 완료 후 실제 경로와 맞는지 확인할 목록 ─────────────
export const AFF_PATHS = Object.freeze({
  /** 공급자 레지스트리(링크 호스트 리터럴 유일 허용 소스) */
  providers: 'server/src/engine/providers.ts',
  /** buildSearchLinks */
  searchLinks: 'server/src/engine/search-links.ts',
  /** 맵 로더·게이트(빌드 타임) */
  prerenderAffiliate: 'server/src/prerender/affiliate.ts',
  /** 커밋되는 운영자 맵 디렉터리(server/affiliate/<provider 소문자>.json) */
  mapDir: 'server/affiliate',
  /** 엔진 존재 표지 — 이 파일이 있을 때만 엔진 감시 루트 누락을 FAIL 로 본다(픽스처 트리 구분) */
  engineAnchor: 'server/src/engine/index.ts',
  /** 클라 존재 표지 */
  clientAnchor: 'client/src/main.tsx',
  /** 서버 런타임 진입점 */
  serverEntry: 'server/src/index.ts',
  /** 메일·저장 모듈 디렉터리 */
  saveDir: 'server/src/save',
});
/** 엔진 노출·순서·판정 결정 파일(258 단계 7) — 폐포가 제휴 모듈에 닿으면 FAIL. */
export const ENGINE_DECISION_ROOTS = Object.freeze(
  ['exposure', 'spec-check', 'resolve', 'rules', 'expr', 'catalog', 'domain', 'search-keyword'].map((n) => `server/src/engine/${n}.ts`),
);
/** 클라 순서·노출 모듈(258 단계 7). */
export const CLIENT_ORDER_ROOTS = Object.freeze(['client/src/checklist/derive.ts', 'client/src/checklist/setupStore.ts', 'client/src/home/HomeB.tsx', 'client/src/reaction/reactionStore.ts']);
/** 클라 순서 모듈이 닿으면 안 되는 컴포넌트·헬퍼(상인 링크 렌더·제휴 허용 필터·고지 — 265 신규 searchLinks.ts·AffNote.tsx 포함, QA D5). */
export const CLIENT_LINK_COMPONENTS = Object.freeze([
  'client/src/supply/SearchBlock.tsx',
  'client/src/speccheck/SpecSearch.tsx',
  'client/src/supply/searchLinks.ts',
  'client/src/supply/AffNote.tsx',
]);
/**
 * 배럴 @ws/engine(engine/index.ts)에서 감시 루트(엔진 결정 파일·클라 순서 모듈)가 가져오면 안 되는 심볼 — 259 실제 export(값).
 *   `*`(네임스페이스·export *·동적 import)도 금지. 실행 시 providers.ts·search-links.ts 의 값 export 를 읽어 합친다(새 export 자동 포함).
 *   이름이 달라도(재수출 별칭·지역 상수 대입·재수출 사슬) 원본 추적으로 같은 판정(274 — Codex MED·QA D3).
 *   타입 이름(SearchLink·SearchProvider·SearchLinkKind·AffiliateCodes·Provider*)은 런타임 결합이 없어 허용.
 */
export const BARREL_FORBIDDEN_SYMBOLS = Object.freeze([
  'buildSearchLinks', 'hasAffiliateLink',
  'PROVIDERS', 'SEARCH_PROVIDER_ORDER', 'COUPANG_AFFILIATE_PREFIX', 'COUPANG_AFFILIATE_CODE_RE', 'isAffiliateCode', 'affiliateHref', 'affiliateCodeFromHref',
]);
/** 제휴 모듈(폐포가 닿으면 안 되는 대상). mapDir 아래 파일 전체 포함. */
const AFF_TARGETS = Object.freeze([AFF_PATHS.providers, AFF_PATHS.searchLinks, AFF_PATHS.prerenderAffiliate]);
// 경로 비교는 대소문자 무시 — 대소문자 무시 파일 시스템(Windows·macOS)에서 './Providers.js' 가 같은 파일로 해석되는 우회를 막는다.
const lc = (x) => x.toLowerCase();
const inPaths = (list, rel) => list.some((x) => lc(x) === lc(rel));
const isAffTarget = (rel) => inPaths(AFF_TARGETS, rel);
const isMapPath = (rel) => lc(rel) === lc(AFF_PATHS.mapDir) || lc(rel).startsWith(`${lc(AFF_PATHS.mapDir)}/`);
const isAffOrMap = (rel) => isAffTarget(rel) || isMapPath(rel);
// 별칭 — client/tsconfig.json paths · client/vite.config.ts resolve.alias 와 같은 표(바뀌면 여기도 — 시험이 자동 대조, 표 밖 별칭은 FAIL).
export const ALIASES = Object.freeze({
  '@ws/engine': 'server/src/engine/index.ts',
  '@ws/copy': 'server/src/prerender/copy.ts',
  '@ws/events': 'server/src/shared/event-contract.ts',
  '@ws/forbidden-keys': 'server/src/shared/forbidden-keys.ts',
  '@ws/save-validate': 'server/src/shared/save-validate.ts',
});
const BARREL = '@ws/engine';
const BARREL_REL = ALIASES[BARREL];
const SELF = 'scripts/lib/rules-affiliate.mjs';

// ── 쿠팡 형태(258 §0 — codeRe 는 K8 미확정, 잠정) ───────────────────────────
export const AFF_CODE_RE = /^[A-Za-z0-9]{4,16}$/;
const AFF_PREFIX = 'https://link.coupang.com/a/';
const AFF_HREF_RE = /^https:\/\/link\.coupang\.com\/a\/([A-Za-z0-9]{4,16})$/;
const COUPANG_SEARCH_BASE = 'https://www.coupang.com/np/search?q=';
const COUPANG_SEARCH_RE = /^https:\/\/www\.coupang\.com\/np\/search\?q=[^&#\s]*$/;
/** 쿠팡 파트너스 권장 고지 원문(111 §0 — 한 글자도 바꾸지 않는다). 프리렌더 COPY.affiliate.coupang 과 바이트 일치해야 한다. */
export const COUPANG_DISCLOSURE = '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
/** 제휴 링크를 정적 HTML 에 둘 수 있는 레이어(111 §② — L5 정적은 링크 0). */
const AFF_LAYERS = new Set(['L4', 'L7']);
const MAP_TOP_KEYS = ['v', 'provider', 'subId', 'source', 'generatedAt', 'entries'];
const MAP_ENTRY_KEYS = ['keyword', 'landingUrl', 'code'];
const MAP_SOURCES = new Set(['MANUAL']); // --api 모드는 K4·K5 뒤
const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ── 문자열 값 해석(표현 우회 — 227 체크리스트 + 274 Codex MED) ─────────────────────
const JS_ESC = /\\(?:x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|([0-3][0-7]{0,2}|[4-7][0-7]?)|(\r\n|[\s\S]))/g;
const SIMPLE_ESC = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '\n': '', '\r\n': '', '\r': '', ' ': '', ' ': '' };
/** JS 문자열·템플릿 이스케이프 해석(\xHH · \uHHHH · \u{H…} · 8진 · 단순 이스케이프 · 줄 이음). 한 번 훑기. */
export function decodeJsEscapes(s) {
  return String(s).replace(JS_ESC, (m, x, ub, u, oct, ch) => {
    const cp = x ? parseInt(x, 16) : ub ? parseInt(ub, 16) : u ? parseInt(u, 16) : oct !== undefined ? parseInt(oct, 8) : null;
    if (cp !== null) {
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    }
    return Object.hasOwn(SIMPLE_ESC, ch) ? SIMPLE_ESC[ch] : ch;
  });
}
/** %XX 를 바이트 문자로(중첩 %25 는 세 번까지). ASCII 호스트 검사용 — UTF-8 복원은 하지 않는다. */
function percentDecode(s) {
  let cur = s;
  for (let k = 0; k < 3 && cur.includes('%'); k++) {
    const next = cur.replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    if (next === cur) break;
    cur = next;
  }
  return cur;
}
//   NFKC(전각 ．→ .) · 제로폭 제거 · 엔티티 · JS 이스케이프 · 퍼센트 · 남은 점 표기([.] (.) &period;) → '.' · 소문자.
const INVISIBLE = /[­​-‏⁠﻿]/g;
const DOT_FORMS = /\\u\{0*2e\}|\\u002e|\\x2e|\\\.|%(?:25)*2e|&#0*46;?|&#x0*2e;?|&period;|\[\.\]|\(\.\)/gi;
export function normalizeHostText(s) {
  const pre = String(s).normalize('NFKC').replace(INVISIBLE, '');
  const decoded = percentDecode(decodeJsEscapes(decodeEntities(pre.replace(DOT_FORMS, '.'))));
  return decoded.normalize('NFKC').replace(INVISIBLE, '').replace(DOT_FORMS, '.').toLowerCase();
}
const AFF_HOST_NEEDLES = ['link.coupang', 'coupa.ng'];
/** 정규화 텍스트에서 제휴 호스트 출현 수(겹침 없이). */
function affHostCount(norm) {
  let n = 0;
  for (const needle of AFF_HOST_NEEDLES) {
    for (let at = norm.indexOf(needle); at >= 0; at = norm.indexOf(needle, at + needle.length)) n++;
  }
  return n;
}
/** HOST 리터럴 허용: 레지스트리 · 테스트(픽스처 포함) · 맵 JSON · 스캐너 자신. */
const HOST_ALLOWED = (rel) => rel === AFF_PATHS.providers || isTestFile(rel) || (isMapPath(rel) && rel.endsWith('.json')) || rel === SELF;

// ── 코드 문자열 접기(lexJs strings 기준 — 상수만) ─────────────────────────────
const DYN = '\u0000'; // 접을 수 없는 보간 자리(이 자리를 건너 호스트가 이어지지 않게)
/** `${ … }` 안이 문자열 리터럴의 + 결합(괄호·공백 허용)이면 그 값, 아니면 null. */
function constConcat(expr) {
  let rest = expr.trim();
  let out = '';
  for (let guard = 0; guard < 64; guard++) {
    rest = rest.replace(/^[\s(]+/, '');
    const m = /^(['"])((?:\\[\s\S]|(?!\1)[^\\\n])*)\1/.exec(rest);
    if (!m) return null;
    out += decodeJsEscapes(m[2]);
    rest = rest.slice(m[0].length).replace(/^[\s)]+/, '');
    if (rest === '') return out;
    if (rest[0] !== '+') return null;
    rest = rest.slice(1);
  }
  return null;
}
/** 템플릿 원문 → 값(상수 보간은 접고, 그 밖 보간은 DYN). 한 번 훑기. */
function foldTemplate(raw) {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const at = raw.indexOf('${', i);
    if (at < 0) {
      out += decodeJsEscapes(raw.slice(i));
      break;
    }
    // 이스케이프된 \${ 는 보간 아님
    let bs = 0;
    for (let k = at - 1; k >= i && raw[k] === '\\'; k--) bs++;
    if (bs % 2 === 1) {
      out += decodeJsEscapes(raw.slice(i, at + 2));
      i = at + 2;
      continue;
    }
    out += decodeJsEscapes(raw.slice(i, at));
    let depth = 1;
    let k = at + 2;
    let q = null;
    for (; k < raw.length && depth > 0; k++) {
      const c = raw[k];
      if (q) {
        if (c === '\\') k++;
        else if (c === q) q = null;
      } else if (c === "'" || c === '"') q = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    const inner = raw.slice(at + 2, k - 1);
    const v = depth === 0 ? constConcat(inner) : null;
    out += v === null ? DYN : v;
    i = k;
  }
  return out;
}
/** lexJs 문자열 토큰의 값(이스케이프 해석, 템플릿 상수 보간 접기). */
const cookedValue = (s) => (s.quote === '`' ? foldTemplate(s.text) : decodeJsEscapes(s.text));
/**
 * 인접 리터럴 사슬: strings[i] 와 strings[i+1] 사이(bare — 주석은 공백)가 `+`(괄호·공백) 하나뿐이면 이어진다.
 * @returns {{ first: number, last: number, value: string }[]} 최대 사슬(길이 1 포함), 문자열 순서대로. 선형.
 */
function stringChains(strings, bare) {
  const out = [];
  for (let i = 0; i < strings.length; ) {
    let last = i;
    let value = cookedValue(strings[i]);
    while (last + 1 < strings.length) {
      const a = strings[last].end;
      const b = strings[last + 1].start;
      if (b - a > 64 || !/^[\s()]*\+[\s()]*$/.test(bare.slice(a, b))) break;
      last++;
      value += cookedValue(strings[last]);
    }
    out.push({ first: i, last, value });
    i = last + 1;
  }
  return out;
}

// ── 라우트·리다이렉트 ─────────────────────────────────────────
const REDIRECT_SEGMENTS = /^(?:go|out|outlink|aff|affiliate|affiliates|r|redirect|redir|click|jump|link-out)$/i;
// 리다이렉트 응답(외부 URL 이 아닌 내부 경로 정규화만) 허용 파일 — 그 파일에서도 외부 리터럴은 FAIL.
export const REDIRECT_ALLOWED = Object.freeze(['server/src/middleware/spa.ts']);
const REDIRECT_METHODS = new Set(['redirect', 'location']);
const HEADER_METHODS = new Set(['setheader', 'setheaders', 'set', 'header', 'append', 'writehead']);
/** 헤더 이름이 식이면 대상 판정 불가 — FAIL(Map.set·FormData.append 와 겹치는 set·append 는 location 표지만 본다). */
const STRICT_HEADER = new Set(['setheader', 'setheaders', 'header', 'writehead']);
const DOT_METHOD_RE = /\.\s*(redirect|location|setHeaders?|set|header|append|writeHead)(?![\w$])/gi;
const isExternalUrl = (u) => /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//') || u.startsWith('\\') || u.startsWith('/\\');

// ── 수수료류 이름 ─────────────────────────────────────────────
const FEE_PARTS = new Set(['commission', 'commissions', 'rebate', 'rebates', 'kickback', 'kickbacks']);
/** 이름 마디(camel·snake·kebab)에 수수료류가 있는가. */
function feeName(name) {
  const parts = String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_$.-]+/).map((p) => p.toLowerCase());
  return parts.some((p) => FEE_PARTS.has(p)) || /commission|kickback/i.test(name);
}
/** 시드·Prisma 금지 키: 수수료류 · affiliate* · subId(sub_id). */
const SEED_AFF_KEY = (k) => feeName(k) || /affiliate/i.test(k) || /(?:^|[_-])sub[_-]?id$|^subId$/i.test(k) || /수수료/.test(k);

// ── TypeScript 구문 분석기(C10-AFF-IMPORT) ────────────────────────────
let TS_MOD; // undefined = 아직, null = 적재 실패
function loadTs() {
  if (TS_MOD === undefined) {
    try {
      TS_MOD = createRequire(import.meta.url)('typescript');
    } catch {
      TS_MOD = null;
    }
  }
  return TS_MOD;
}
const KIND_BY_EXT = { '.ts': 'TS', '.mts': 'TS', '.cts': 'TS', '.tsx': 'TSX', '.js': 'JS', '.mjs': 'JS', '.cjs': 'JS', '.jsx': 'JSX' };

/**
 * 모듈 구문 분석 — 간선·export 표·지역 바인딩·구문 오류. 구문 트리 순회는 명시 스택(깊은 중첩에서도 재귀 0).
 *   edges:  { spec: string|null, line, names: string[], specs: {name, type}[] } — spec=null 은 해석 불가(비리터럴 동적 import·require 별칭·glob)
 *   named:  export 이름 → { re: spec, name, type } | { local, type }
 *   stars:  export * from 의 지정자
 *   locals: 지역 이름 → { imp: spec, name, type } | { decl: true, deps: Set<string>, type }
 *   errors: { line, msg }[] — 구문 오류(있으면 감시 대상에서 FAIL)
 * typescript 가 없으면 throw.
 */
export function parseModuleText(text, rel = 'x.ts') {
  const T = loadTs();
  if (!T) throw new Error('typescript 적재 실패');
  const SK = T.SyntaxKind;
  const kind = T.ScriptKind[KIND_BY_EXT[extname(rel).toLowerCase()] ?? 'TS'];
  const sf = T.createSourceFile(rel, text, T.ScriptTarget.Latest, true, kind);
  const diags = sf.parseDiagnostics;
  if (!Array.isArray(diags)) throw new Error('typescript parseDiagnostics 없음(판 차이)');
  const lineAt = (pos) => sf.getLineAndCharacterOfPosition(Math.max(0, Math.min(pos, text.length))).line + 1;
  const errors = diags.map((d) => ({ line: lineAt(d.start ?? 0), msg: T.flattenDiagnosticMessageText(d.messageText, ' ') }));
  const lit = (n) => (n && (n.kind === SK.StringLiteral || n.kind === SK.NoSubstitutionTemplateLiteral) ? n.text : null);
  const edges = [];
  const push = (node, spec, specs) => edges.push({ pos: node.pos, spec, line: lineAt(node.getStart(sf)), names: specs.map((s) => s.name), specs });
  const importSpecs = (clause) => {
    if (!clause) return [];
    const ty = !!clause.isTypeOnly;
    const out = [];
    if (clause.name) out.push({ name: 'default', type: ty });
    const nb = clause.namedBindings;
    if (nb) {
      if (nb.kind === SK.NamespaceImport) out.push({ name: '*', type: ty });
      else for (const e of nb.elements) out.push({ name: (e.propertyName ?? e.name).text, type: ty || !!e.isTypeOnly });
    }
    return out;
  };
  const exportSpecs = (node) => {
    const ty = !!node.isTypeOnly;
    const c = node.exportClause;
    if (!c || c.kind === SK.NamespaceExport) return [{ name: '*', type: ty }];
    return c.elements.map((e) => ({ name: (e.propertyName ?? e.name).text, type: ty || !!e.isTypeOnly }));
  };
  // require·createRequire 가 호출 자리가 아닌 곳(별칭·전달)에 나오면 해석 불가로 본다 — 이름 자리(속성·메서드 이름·선언)는 제외.
  const nameSlot = (node) => {
    const p = node.parent;
    if (!p) return false;
    switch (p.kind) {
      case SK.PropertyAccessExpression:
        return p.name === node;
      case SK.MethodDeclaration:
      case SK.MethodSignature:
      case SK.PropertyAssignment:
      case SK.PropertyDeclaration:
      case SK.PropertySignature:
      case SK.GetAccessor:
      case SK.SetAccessor:
      case SK.FunctionDeclaration:
      case SK.Parameter:
      case SK.JsxAttribute:
      case SK.LabeledStatement:
        return p.name === node || p.label === node;
      case SK.BindingElement:
        return p.propertyName === node;
      case SK.QualifiedName:
        return p.right === node;
      default:
        return false;
    }
  };
  const stack = [sf];
  while (stack.length) {
    const node = stack.pop();
    switch (node.kind) {
      case SK.ImportDeclaration:
        push(node, lit(node.moduleSpecifier), importSpecs(node.importClause));
        break;
      case SK.ExportDeclaration:
        if (node.moduleSpecifier) push(node, lit(node.moduleSpecifier), exportSpecs(node));
        break;
      case SK.ImportEqualsDeclaration:
        if (node.moduleReference.kind === SK.ExternalModuleReference) push(node, lit(node.moduleReference.expression), [{ name: '*', type: !!node.isTypeOnly }]);
        break;
      case SK.CallExpression: {
        const ex = node.expression;
        const isImport = ex.kind === SK.ImportKeyword;
        const isRequire = ex.kind === SK.Identifier && ex.text === 'require';
        // module.require · module['require'](상수 문자열 계산 멤버 — 276 Codex 재검증 MED 1)
        const onModule = (ex.kind === SK.PropertyAccessExpression || ex.kind === SK.ElementAccessExpression) && ex.expression.kind === SK.Identifier && ex.expression.text === 'module';
        const isModuleRequire = onModule && (ex.kind === SK.PropertyAccessExpression ? ex.name.text === 'require' : lit(ex.argumentExpression) === 'require');
        if (isImport || isRequire || isModuleRequire) push(node, node.arguments.length > 0 ? lit(node.arguments[0]) : null, [{ name: '*', type: false }]);
        break;
      }
      case SK.ImportType: {
        const a = node.argument;
        push(node, a && a.kind === SK.LiteralType ? lit(a.literal) : null, [{ name: '*', type: true }]);
        break;
      }
      case SK.MetaProperty: {
        const p = node.parent;
        if (node.keywordToken === SK.ImportKeyword && p && p.kind === SK.PropertyAccessExpression && /^glob/i.test(p.name.text)) push(node, null, [{ name: '*', type: false }]);
        break;
      }
      case SK.Identifier: {
        const p = node.parent;
        const callee = p && p.kind === SK.CallExpression && p.expression === node;
        if (node.text === 'createRequire') push(node, null, [{ name: '*', type: false }]);
        else if (node.text === 'require' && !callee && !nameSlot(node)) push(node, null, [{ name: '*', type: false }]);
        else if (node.text === 'require' && p && p.kind === SK.PropertyAccessExpression && p.name === node && p.expression.kind === SK.Identifier && p.expression.text === 'module') {
          const g = p.parent;
          if (!(g && g.kind === SK.CallExpression && g.expression === p)) push(node, null, [{ name: '*', type: false }]); // module.require 참조 전달
        }
        break;
      }
      default:
        break;
    }
    T.forEachChild(node, (c) => {
      stack.push(c);
    });
  }
  edges.sort((a, b) => a.pos - b.pos);
  // export 표·지역 바인딩(최상위 문장만)
  const named = new Map();
  const stars = [];
  const locals = new Map();
  const idsIn = (root) => {
    const s = new Set();
    const st = [root];
    while (st.length) {
      const x = st.pop();
      if (x.kind === SK.Identifier) s.add(x.text);
      T.forEachChild(x, (c) => {
        st.push(c);
      });
    }
    return s;
  };
  const mods = (n) => (T.canHaveModifiers?.(n) ? (T.getModifiers(n) ?? []) : (n.modifiers ?? []));
  const hasMod = (n, k) => mods(n).some((m) => m.kind === k);
  for (const st of sf.statements) {
    const exp = hasMod(st, SK.ExportKeyword);
    const dflt = hasMod(st, SK.DefaultKeyword);
    switch (st.kind) {
      case SK.ImportDeclaration: {
        const spec = lit(st.moduleSpecifier);
        const c = st.importClause;
        if (!c) break;
        const ty = !!c.isTypeOnly;
        if (c.name) locals.set(c.name.text, { imp: spec, name: 'default', type: ty });
        const nb = c.namedBindings;
        if (nb && nb.kind === SK.NamespaceImport) locals.set(nb.name.text, { imp: spec, name: '*', type: ty });
        else if (nb) for (const e of nb.elements) locals.set(e.name.text, { imp: spec, name: (e.propertyName ?? e.name).text, type: ty || !!e.isTypeOnly });
        break;
      }
      case SK.ImportEqualsDeclaration: {
        const nm = st.name.text;
        if (st.moduleReference.kind === SK.ExternalModuleReference) locals.set(nm, { imp: lit(st.moduleReference.expression), name: '*', type: !!st.isTypeOnly });
        else locals.set(nm, { decl: true, deps: idsIn(st.moduleReference), type: !!st.isTypeOnly });
        if (exp) named.set(nm, { local: nm, type: !!st.isTypeOnly });
        break;
      }
      case SK.VariableStatement:
        for (const d of st.declarationList.declarations) {
          const deps = d.initializer ? idsIn(d.initializer) : new Set();
          for (const nm of idsIn(d.name)) {
            locals.set(nm, { decl: true, deps, type: false });
            if (exp) named.set(nm, { local: nm, type: false });
          }
        }
        break;
      case SK.FunctionDeclaration:
      case SK.ClassDeclaration:
      case SK.EnumDeclaration:
      case SK.ModuleDeclaration: {
        if (st.kind === SK.ModuleDeclaration && st.name.kind !== SK.Identifier) break; // declare module 'x'
        const nm = st.name ? st.name.text : '#default';
        locals.set(nm, { decl: true, deps: idsIn(st), type: false });
        if (exp) named.set(dflt ? 'default' : nm, { local: nm, type: false });
        break;
      }
      case SK.InterfaceDeclaration:
      case SK.TypeAliasDeclaration: {
        const nm = st.name.text;
        locals.set(nm, { decl: true, deps: idsIn(st), type: true });
        if (exp) named.set(dflt ? 'default' : nm, { local: nm, type: true });
        break;
      }
      case SK.ExportDeclaration: {
        const ty = !!st.isTypeOnly;
        const c = st.exportClause;
        if (st.moduleSpecifier) {
          const spec = lit(st.moduleSpecifier);
          if (!c) stars.push(spec);
          else if (c.kind === SK.NamespaceExport) named.set(c.name.text, { re: spec, name: '*', type: ty });
          else for (const e of c.elements) named.set(e.name.text, { re: spec, name: (e.propertyName ?? e.name).text, type: ty || !!e.isTypeOnly });
        } else if (c && c.kind === SK.NamedExports) {
          for (const e of c.elements) named.set(e.name.text, { local: (e.propertyName ?? e.name).text, type: ty || !!e.isTypeOnly });
        }
        break;
      }
      case SK.ExportAssignment:
        locals.set('#default', { decl: true, deps: idsIn(st.expression), type: false });
        named.set(st.isExportEquals ? '=' : 'default', { local: '#default', type: false });
        break;
      default:
        break;
    }
  }
  for (const e of edges) delete e.pos;
  return { edges, named, stars, locals, errors };
}
/** 소스 텍스트의 import 간선(구문 트리 기준 — 주석·문자열 속 import 무시, 삼항·템플릿 보간 안의 import() 포함). */
export function importEdges(text, rel = 'x.ts') {
  return parseModuleText(text, rel).edges;
}

// ── import 해석 ─────────────────────────────────────────────
const RESOLVE_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const JS_TO_TS = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };

function isFileAt(abs) {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

/** 트리에 선언된 별칭 중 ALIASES 표 밖 것(정확 키·접두) — 해석 불가로 본다(QA D6 fail-closed). */
const matchesAlias = (spec, keys) => keys.some((k) => (k.endsWith('/*') ? spec.startsWith(k.slice(0, -1)) : spec === k || spec.startsWith(`${k}/`)));

/**
 * 지정자 → { kind:'file', rel } | { kind:'external' } | { kind:'unresolved' }.
 *   상대(./ ../)·별칭(ALIASES)만 해석. 그 밖 @ws/·#(패키지 imports)·~·절대 경로·트리의 표 밖 별칭은 unresolved(fail-closed), 패키지는 external.
 *   질의(?raw 등)는 떼고 본다.
 */
function resolveSpec(root, fromRel, spec, unknownAliases = []) {
  const s = spec.replace(/[?#].*$/, '') || spec;
  let base;
  if (s.startsWith('./') || s.startsWith('../') || s === '.' || s === '..') base = posix.normalize(posix.join(posix.dirname(fromRel), s));
  else if (Object.hasOwn(ALIASES, s)) base = ALIASES[s];
  else if (s.startsWith('@ws/') || s.startsWith('/') || s.startsWith('\\') || spec.startsWith('#') || s.startsWith('~') || matchesAlias(s, unknownAliases)) return { kind: 'unresolved' };
  else return { kind: 'external' };
  if (base.startsWith('../') || base === '..') return { kind: 'unresolved' }; // 트리 밖
  const abs = (r) => join(root, ...r.split('/'));
  const cands = [base];
  const ext = posix.extname(base);
  if (Object.hasOwn(JS_TO_TS, ext)) for (const e of JS_TO_TS[ext]) cands.push(base.slice(0, -ext.length) + e);
  for (const e of RESOLVE_EXT) cands.push(base + e);
  for (const e of RESOLVE_EXT) cands.push(`${base}/index${e}`);
  for (const c of cands) if (isFileAt(abs(c))) return { kind: 'file', rel: c };
  // 존재하지 않는 제휴 모듈·맵을 가리키는 것도 대상 경로로 판정(259 전에도 금지 의도가 드러나게).
  for (const c of cands) if (isAffOrMap(c)) return { kind: 'file', rel: c, missing: true };
  return { kind: 'unresolved' };
}

const EMPTY_MOD = Object.freeze({ edges: [], named: new Map(), stars: [], locals: new Map(), errors: [] });
/** 파일별 모듈 분석 캐시(한 실행 안에서 같은 파일을 여러 폐포가 공유 — 전체 비용 선형). 읽기·분석 실패는 errors 로. */
function moduleCache(root) {
  const cache = new Map();
  return (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    let mod = EMPTY_MOD;
    if (CODE_EXT.has(extname(rel).toLowerCase())) {
      try {
        const text = stripBom(readFileSync(join(root, ...rel.split('/')), 'utf8'));
        mod = parseModuleText(text, rel);
      } catch (err) {
        mod = { ...EMPTY_MOD, errors: [{ line: null, msg: `읽기·구문 분석 실패(${String(err && err.message).slice(0, 80)})` }] };
      }
    }
    cache.set(rel, mod);
    return mod;
  };
}

/**
 * 배럴 심볼 → 원본 { rel, name, type } 목록(재수출 별칭·export *·지역 import 재수출·지역 상수 대입을 따라감).
 *   원본이 제휴 모듈이면 그 자리에서 멈춘다. 해석 불가 지정자를 지나면 unresolved=true.
 */
function originResolver(root, modOf, unknownAliases) {
  const memo = new Map();
  const res = (from, spec) => (spec === null ? { kind: 'unresolved' } : resolveSpec(root, from, spec, unknownAliases));
  const asType = (r, ty) => (ty ? { ...r, origins: r.origins.map((o) => ({ ...o, type: true })) } : r);
  const affTypeOnly = (rel, name) => {
    const mod = modOf(rel);
    const b = mod.named.get(name);
    if (!b) return false;
    if (b.type) return true;
    return 'local' in b ? mod.locals.get(b.local)?.type === true : false;
  };
  const affExports = (rel, name) => {
    if (!isFileAt(join(root, ...rel.split('/')))) return true; // 없는 제휴 모듈 — 내보낸다고 본다(fail-closed)
    const mod = modOf(rel);
    return mod.named.has(name) || mod.stars.length > 0;
  };
  function exportOrigins(rel, name, seen) {
    const key = `${lc(rel)}#${name}`;
    if (memo.has(key)) return memo.get(key);
    if (seen.has(key)) return { origins: [], unresolved: false };
    seen.add(key);
    let out;
    if (isAffOrMap(rel)) out = { origins: [{ rel, name, type: name !== '*' && affTypeOnly(rel, name) }], unresolved: false };
    else if (name === '*') out = { origins: [{ rel, name: '*', type: false }], unresolved: false };
    else {
      const mod = modOf(rel);
      const acc = { origins: [], unresolved: false };
      const merge = (r) => {
        acc.unresolved ||= r.unresolved;
        acc.origins.push(...r.origins);
      };
      const b = mod.named.get(name);
      if (b && 're' in b) {
        const r = res(rel, b.re);
        if (r.kind === 'file') merge(asType(exportOrigins(r.rel, b.name, seen), b.type));
        else if (r.kind === 'unresolved') acc.unresolved = true;
      } else if (b) merge(asType(localOrigins(rel, mod, b.local, seen, new Set()), b.type));
      else if (name !== 'default') {
        for (const s of mod.stars) {
          const r = res(rel, s);
          if (r.kind === 'unresolved') acc.unresolved = true;
          if (r.kind !== 'file') continue;
          if (isAffOrMap(r.rel) && !affExports(r.rel, name)) continue;
          merge(exportOrigins(r.rel, name, seen));
        }
      }
      out = acc;
    }
    memo.set(key, out);
    return out;
  }
  function localOrigins(rel, mod, local, seen, seenLocal) {
    if (seenLocal.has(local)) return { origins: [], unresolved: false };
    seenLocal.add(local);
    const l = mod.locals.get(local);
    if (!l) return { origins: [{ rel, name: local, type: false }], unresolved: false };
    if ('imp' in l) {
      const r = res(rel, l.imp);
      if (r.kind === 'file') return asType(exportOrigins(r.rel, l.name, seen), l.type);
      return { origins: [], unresolved: r.kind === 'unresolved' };
    }
    const acc = { origins: [{ rel, name: local, type: l.type }], unresolved: false };
    for (const d of l.deps) {
      if (d === local || !mod.locals.has(d)) continue;
      const r = asType(localOrigins(rel, mod, d, seen, seenLocal), l.type);
      acc.unresolved ||= r.unresolved;
      acc.origins.push(...r.origins);
    }
    return acc;
  }
  return (rel, name) => exportOrigins(rel, name, new Set());
}

/**
 * BFS 폐포. visitEdge(from, edge, res, parent, at, follow) 가 true 를 돌려주면 그 간선은 따라가지 않는다(배럴 심볼 검사·대상 도달 보고).
 *   follow(rel, via) 로 다른 파일을 폐포에 넣을 수 있다(배럴 심볼의 원본 파일). 간선 목록은 파일당 한 번(캐시), 각 파일 한 번 방문.
 */
function closure(rootRel, modOf, root, unknownAliases, visitEdge, visitFile = () => {}) {
  const parent = new Map([[rootRel, null]]);
  const hop = new Map(); // rel → 루트 파일에서 이 경로로 들어간 import 줄(보고 위치)
  const queue = [rootRel];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const mod = modOf(cur);
    visitFile(cur, mod);
    for (const e of mod.edges) {
      const res = e.spec === null ? { kind: 'unresolved' } : resolveSpec(root, cur, e.spec, unknownAliases);
      const at = cur === rootRel ? e.line : hop.get(cur);
      const follow = (rel, via) => {
        if (parent.has(rel)) return;
        if (via !== undefined && !parent.has(via)) parent.set(via, cur);
        parent.set(rel, via ?? cur);
        hop.set(rel, at);
        queue.push(rel);
      };
      if (visitEdge(cur, e, res, parent, at, follow)) continue;
      if (res.kind !== 'file' || parent.has(res.rel)) continue;
      parent.set(res.rel, cur);
      hop.set(res.rel, at);
      if (!res.missing) queue.push(res.rel);
    }
  }
}
const short = (rel) => rel.replace(/^(?:server|client)\/src\//, '');
/** 루트 → … → from → target 경로 문자열(경로 마디는 safeLabel). 보고 위치는 루트 파일의 첫 import 줄(at), 실제 간선은 메시지에 file:line. */
function chain(parent, from, target) {
  const path = [target];
  const seen = new Set();
  for (let c = from; c !== null && c !== undefined && !seen.has(c); c = parent.get(c)) {
    seen.add(c);
    path.push(c);
  }
  return path.reverse().map((p) => L(short(p))).join(' → ');
}
const unresolvedMsg = (r, e) => `${L(short(r))} 폐포의 import 해석 불가(${e.spec === null ? '비리터럴 동적 import·require 별칭·glob' : L(e.spec)}) — 정적 상대 경로·알려진 별칭으로(fail-closed)`;

// ── 별칭 설정 대조(QA D6) — 트리의 tsconfig paths·vite alias 가 ALIASES 표와 같아야 한다 ─────────
const ALIAS_TSCONFIGS = ['tsconfig.base.json', 'tsconfig.json', 'client/tsconfig.json', 'server/tsconfig.json'];
const ALIAS_VITE = ['client/vite.config.ts', 'client/vite.config.mts', 'client/vite.config.js', 'client/vitest.config.ts'];
/** JSONC(주석·마지막 쉼표) → JSON 텍스트(문자열 안은 그대로). */
function stripJsonc(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let k = i + 1;
      while (k < src.length && src[k] !== '"') k += src[k] === '\\' ? 2 : 1;
      out += src.slice(i, k + 1);
      i = k;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      out += src.slice(i, e < 0 ? src.length : e + 2).replace(/[^\n]/g, ' ');
      i = e < 0 ? src.length : e + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
/**
 * 트리의 별칭 선언 — { file, line, key, target(트리 상대 posix)|null, problem|null }[].
 *   tsconfig compilerOptions.paths(baseUrl 기준), vite resolve.alias 객체의 `'키': fromHere('경로')` 항목만 해석하고 그 밖 형식은 problem.
 */
export function readAliasConfig(root) {
  const out = [];
  for (const f of ALIAS_TSCONFIGS) {
    const abs = join(root, ...f.split('/'));
    if (!isFileAt(abs)) continue;
    const raw = stripBom(readFileSync(abs, 'utf8'));
    let doc;
    try {
      doc = JSON.parse(stripJsonc(raw));
    } catch {
      out.push({ file: f, line: null, key: null, target: null, problem: 'tsconfig 파싱 실패 — 별칭 대조 불가' });
      continue;
    }
    const co = isObj(doc) && isObj(doc.compilerOptions) ? doc.compilerOptions : {};
    if (co.paths === undefined) continue;
    const dir = posix.dirname(f);
    const baseDir = posix.normalize(posix.join(dir, typeof co.baseUrl === 'string' ? co.baseUrl : '.'));
    const lineOf = lineIndex(raw);
    for (const [key, v] of Object.entries(isObj(co.paths) ? co.paths : {})) {
      const line = lineOf(Math.max(0, raw.indexOf(JSON.stringify(key))));
      if (!Array.isArray(v) || v.length !== 1 || typeof v[0] !== 'string') out.push({ file: f, line, key, target: null, problem: '대상이 정확히 1개가 아니다' });
      else out.push({ file: f, line, key, target: posix.normalize(posix.join(baseDir, v[0])), problem: null });
    }
  }
  for (const f of ALIAS_VITE) {
    const abs = join(root, ...f.split('/'));
    if (!isFileAt(abs)) continue;
    const raw = stripBom(readFileSync(abs, 'utf8'));
    const { code, bare } = lexJs(raw);
    const lineOf = lineIndex(raw);
    const re = /(?<![\w$])alias\s*:/g;
    let m;
    while ((m = re.exec(bare)) !== null) {
      let k = m.index + m[0].length;
      while (k < bare.length && /\s/.test(bare[k])) k++;
      if (bare[k] !== '{') {
        out.push({ file: f, line: lineOf(m.index), key: null, target: null, problem: 'alias 가 객체 리터럴이 아니다(배열·변수 — 대조 불가)' });
        continue;
      }
      let depth = 0;
      let j = k;
      for (; j < bare.length; j++) {
        if (bare[j] === '{' || bare[j] === '(' || bare[j] === '[') depth++;
        else if ((bare[j] === '}' || bare[j] === ')' || bare[j] === ']') && --depth === 0) break;
      }
      // 깊이 1 쉼표로 항목 분리
      let start = k + 1;
      let d = 0;
      for (let p = k + 1; p <= j; p++) {
        const c = bare[p];
        if (c === '{' || c === '(' || c === '[') d++;
        else if (c === '}' || c === ')' || c === ']') d--;
        if ((c === ',' && d === 0) || p === j) {
          const item = code.slice(start, p).trim();
          start = p + 1;
          if (item === '') continue;
          const em = /^(['"]?)([^'":\s]+)\1\s*:\s*fromHere\(\s*(['"])([^'"]+)\3\s*\)$/.exec(item);
          if (!em) out.push({ file: f, line: lineOf(start - item.length - 1), key: null, target: null, problem: `해석할 수 없는 alias 항목(${L(item.slice(0, 40))})` });
          else out.push({ file: f, line: lineOf(code.indexOf(item, k)), key: em[2], target: posix.normalize(posix.join(posix.dirname(f), em[4])), problem: null });
        }
      }
      re.lastIndex = j;
    }
  }
  return out;
}
/** 별칭 대조 — 표 밖 키·대상 불일치·해석 불가 형식은 FAIL. 표 밖 키 목록을 돌려준다(해석 단계에서 unresolved). */
function checkAliasConfig(root, add) {
  const unknown = [];
  for (const a of readAliasConfig(root)) {
    if (a.problem) {
      add('C10-AFF-IMPORT', 'FAIL', a.file, a.line, `별칭 설정 ${a.problem} — scripts/lib/rules-affiliate.mjs ALIASES 와 대조할 수 없다(fail-closed)`);
      continue;
    }
    if (!Object.hasOwn(ALIASES, a.key)) {
      unknown.push(a.key);
      add('C10-AFF-IMPORT', 'FAIL', a.file, a.line, `ALIASES 표 밖 별칭 ${L(a.key)} — 폐포 해석이 패키지로 오인할 수 있다(QA D6, fail-closed). 표에 넣거나 별칭을 지운다`);
    } else if (lc(ALIASES[a.key]) !== lc(a.target)) {
      add('C10-AFF-IMPORT', 'FAIL', a.file, a.line, `별칭 ${L(a.key)} 대상(${L(a.target)})이 ALIASES 표(${ALIASES[a.key]})와 다르다(fail-closed)`);
    }
  }
  return unknown;
}

function checkImportIsolation(root, add) {
  const exists = (rel) => isFileAt(join(root, ...rel.split('/')));
  const unknownAliases = checkAliasConfig(root, add);
  const engineOn = exists(AFF_PATHS.engineAnchor);
  const clientOn = exists(AFF_PATHS.clientAnchor);
  const runtimeRoots = [];
  if (exists(AFF_PATHS.serverEntry)) runtimeRoots.push(AFF_PATHS.serverEntry);
  for (const f of walk(join(root, ...AFF_PATHS.saveDir.split('/')))) {
    const rel = relPosix(root, f);
    if (CODE_EXT.has(extname(f)) && !isTestFile(rel)) runtimeRoots.push(rel);
  }
  if (!engineOn && !clientOn && runtimeRoots.length === 0) return;
  if (!loadTs()) {
    if (engineOn || clientOn) add('C10-AFF-IMPORT', 'FAIL', engineOn ? AFF_PATHS.engineAnchor : AFF_PATHS.clientAnchor, null, 'import 구문 분석기(typescript) 적재 실패 — npm ci 뒤 실행(fail-closed)');
    else add('C10-AFF-RUNTIME', 'WARN', runtimeRoots[0], null, 'import 구문 분석기(typescript) 적재 실패 — 런타임 폐포 미확인');
    return;
  }
  const modOf = moduleCache(root);
  // 감시 대상(FAIL 규칙)에서 읽은 모듈의 구문 오류·분석 실패는 FAIL(Codex LOW — fail-open 금지). 파일당 한 번.
  const errReported = new Set();
  const strictMod = (rel) => {
    const mod = modOf(rel);
    if (mod.errors.length > 0 && !errReported.has(lc(rel))) {
      errReported.add(lc(rel));
      const e0 = mod.errors[0];
      add('C10-AFF-IMPORT', 'FAIL', rel, e0.line, `감시 대상 소스 구문 오류·분석 실패(${L(String(e0.msg).slice(0, 60))}${mod.errors.length > 1 ? ` 외 ${mod.errors.length - 1}건` : ''}) — import 그래프를 믿을 수 없다(fail-closed)`);
    }
    return mod;
  };
  const origins = originResolver(root, strictMod, unknownAliases);
  // 금지 심볼 = 고정 목록 ∪ providers.ts·search-links.ts 의 값 export(구문 트리 기준).
  const forbidden = new Set(BARREL_FORBIDDEN_SYMBOLS);
  for (const rel of [AFF_PATHS.providers, AFF_PATHS.searchLinks]) {
    if (!exists(rel)) continue;
    const mod = strictMod(rel);
    for (const [name, b] of mod.named) if (!b.type && !('local' in b && mod.locals.get(b.local)?.type)) forbidden.add(name);
  }
  /** 배럴 간선 심볼 검사 — { bad: string[], unresolved, follow: rel[] }. */
  const barrelSymbols = (e) => {
    const out = { bad: [], unresolved: false, follow: [] };
    for (const sp of e.specs) {
      if (sp.name === '*') {
        out.bad.push('*');
        continue;
      }
      if (forbidden.has(sp.name)) {
        out.bad.push(sp.name);
        continue;
      }
      const r = origins(BARREL_REL, sp.name);
      out.unresolved ||= r.unresolved;
      for (const o of r.origins) {
        if (isAffOrMap(o.rel)) {
          if (!o.type) out.bad.push(`${sp.name}(원본 ${short(o.rel)}#${o.name})`);
        } else if (!o.type && !sp.type && lc(o.rel) !== lc(BARREL_REL)) out.follow.push(o.rel);
      }
    }
    return out;
  };
  const guard = (r, fn) => {
    try {
      fn();
    } catch (err) {
      add('C10-AFF-IMPORT', 'FAIL', r, null, `import 그래프 분석 예외(${L(String(err && err.message).slice(0, 60))}) — fail-closed`);
    }
  };
  const strictClosure = (r, label, reachBad, reachMsg) =>
    closure(
      r,
      strictMod,
      root,
      unknownAliases,
      (from, e, res, parent, at, follow) => {
        if (res.kind === 'file' && lc(res.rel) === lc(BARREL_REL)) {
          const s = barrelSymbols(e);
          if (s.bad.length) add('C10-AFF-IMPORT', 'FAIL', r, at, `${label} 폐포(${chain(parent, from, res.rel)})가 엔진 배럴에서 ${s.bad.map(L).join(', ')} import(간선 ${L(short(from))}:${e.line}, 불변식 ③ — 심볼 단위·원본 추적)`);
          if (s.unresolved) add('C10-AFF-IMPORT', 'FAIL', from, e.line, `${L(short(r))} 폐포의 배럴 심볼 원본 해석 불가 — 재수출 사슬에 해석 불가 지정자(fail-closed)`);
          for (const o of s.follow) follow(o, res.rel);
          return true;
        }
        if (res.kind === 'unresolved') {
          add('C10-AFF-IMPORT', 'FAIL', from, e.line, unresolvedMsg(r, e));
          return true;
        }
        if (res.kind === 'file' && reachBad(res.rel)) {
          add('C10-AFF-IMPORT', 'FAIL', r, at, `${reachMsg}: ${chain(parent, from, res.rel)}(간선 ${L(short(from))}:${e.line}, 불변식 ③)`);
          return true;
        }
        return false;
      },
    );
  // 엔진 결정 파일 — 배럴(engine/index.ts)은 심볼 단위(배럴 import 자체는 FAIL 아님 — 금지 심볼·`*`·원본이 제휴 값인 이름만).
  if (engineOn) {
    for (const r of ENGINE_DECISION_ROOTS) {
      if (!exists(r)) {
        add('C10-AFF-IMPORT', 'FAIL', r, null, '감시 대상 엔진 결정 파일이 없다 — scripts/lib/rules-affiliate.mjs ENGINE_DECISION_ROOTS 경로 갱신 필요(fail-closed)');
        continue;
      }
      guard(r, () => strictClosure(r, '노출·순서 결정 파일', isAffOrMap, '노출·순서 결정 파일 폐포가 제휴 모듈에 닿음'));
    }
  }
  // 클라 순서·노출 모듈 — 전이 폐포 + 상인 링크 컴포넌트·제휴 헬퍼 0.
  if (clientOn) {
    for (const r of CLIENT_ORDER_ROOTS) {
      if (!exists(r)) {
        add('C10-AFF-IMPORT', 'FAIL', r, null, '감시 대상 클라 순서·노출 모듈이 없다 — scripts/lib/rules-affiliate.mjs CLIENT_ORDER_ROOTS 경로 갱신 필요(fail-closed)');
        continue;
      }
      guard(r, () => strictClosure(r, '클라 순서·노출 모듈', (rel) => inPaths(CLIENT_LINK_COMPONENTS, rel) || isAffOrMap(rel), '클라 순서·노출 모듈 폐포가 상인 링크·제휴 모듈에 닿음'));
    }
  }
  // 서버 런타임·메일 — 맵 로더·맵 파일 0(게이트는 빌드 타임만). WARN(258 이 정한 FAIL 규칙 아님 — 신호만).
  const reported = new Set();
  for (const r of runtimeRoots) {
    try {
      closure(r, modOf, root, unknownAliases, (from, e, res, parent) => {
        if (res.kind === 'file' && (lc(res.rel) === lc(AFF_PATHS.prerenderAffiliate) || isMapPath(res.rel))) {
          const key = `${from}|${res.rel}`;
          if (!reported.has(key)) {
            reported.add(key);
            add('C10-AFF-RUNTIME', 'WARN', from, e.line, `서버 런타임·메일 폐포가 제휴 맵 로더·맵 파일에 닿음: ${chain(parent, from, res.rel)} — 게이트는 빌드 타임만(258 §0)`);
          }
          return true;
        }
        return false;
      });
    } catch (err) {
      add('C10-AFF-RUNTIME', 'WARN', r, null, `런타임 폐포 분석 예외(${L(String(err && err.message).slice(0, 60))})`);
    }
  }
}

// ── 소스 텍스트 규칙(HOST·REDIRECT·FIELD 코드 식별자) ─────────────────────
const SOURCE_DIRS = ['client/src', 'client/build', 'server/src', 'server/prisma', 'server/seed', 'scripts', 'e2e', AFF_PATHS.mapDir];
const TEXT_LIKE = new Set([...CODE_EXT, '.json', '.html', '.md', '.yml', '.yaml', '.txt', '.css', '.prisma', '.csv', '.tsv', '.env']);

/** strings(start 오름차순)에서 start ≥ pos 인 첫 인덱스 — 이진 탐색. */
function firstStringFrom(strings, pos) {
  let lo = 0;
  let hi = strings.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strings[mid].start < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
const skipWs = (s, k) => {
  while (k < s.length && /\s/.test(s[k])) k++;
  return k;
};
/** bare 에서 open('(') 의 짝 ')' 위치(4000자 상한, 못 찾으면 상한 위치). */
function matchParen(bare, open) {
  let depth = 0;
  const limit = Math.min(bare.length, open + 4000);
  for (let j = open; j < limit; j++) {
    if (bare[j] === '(') depth++;
    else if (bare[j] === ')' && --depth === 0) return j;
  }
  return limit;
}
/** (open, close) 사이 깊이 0 쉼표로 나눈 인수 영역 [a, b) 목록. */
function argRegions(bare, open, close) {
  const out = [];
  let d = 0;
  let a = open + 1;
  for (let p = open + 1; p < close; p++) {
    const c = bare[p];
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === ',' && d === 0) {
      out.push([a, p]);
      a = p + 1;
    }
  }
  if (bare.slice(a, close).trim() !== '') out.push([a, close]);
  return out;
}

/** C10-AFF-REDIRECT 호출 검사(server/src 비테스트) — 점·정적 계산 멤버, 헤더 이름 해석, 대상 불명 fail-closed. */
function checkRedirectCalls(rel, text, lexed, chains, add) {
  const { bare, strings } = lexed;
  const lineOf = lineIndex(text);
  const allowed = REDIRECT_ALLOWED.includes(rel);
  const fail = (at, msg) => add('C10-AFF-REDIRECT', 'FAIL', rel, lineOf(at), msg);
  const chainAt = new Map(); // 첫 문자열 인덱스 → 사슬
  for (const c of chains) chainAt.set(c.first, c);
  const sites = [];
  DOT_METHOD_RE.lastIndex = 0;
  let m;
  while ((m = DOT_METHOD_RE.exec(bare)) !== null) sites.push({ method: m[1].toLowerCase(), at: m.index, after: m.index + m[0].length });
  // 정적 계산 멤버: [ '…' (+ '…')* ] — 값(이스케이프·결합 해석)이 메서드 이름이면 같은 호출로 본다.
  for (const c of chains) {
    const s0 = strings[c.first];
    const s1 = strings[c.last];
    let b = s0.start - 1;
    while (b >= 0 && /[\s(]/.test(bare[b])) b--;
    if (bare[b] !== '[') continue;
    let a = skipWs(bare, s1.end);
    while (bare[a] === ')') a = skipWs(bare, a + 1);
    if (bare[a] !== ']') continue;
    const name = c.value.trim().toLowerCase();
    if (REDIRECT_METHODS.has(name) || HEADER_METHODS.has(name)) sites.push({ method: name, at: b, after: a + 1 });
  }
  for (const site of sites) {
    let k = skipWs(bare, site.after);
    if (bare.startsWith('?.', k)) k = skipWs(bare, k + 2);
    let open = -1;
    if (bare[k] === '(') open = k;
    else {
      const cm = /^\.\s*(?:call|apply|bind)\s*\(/.exec(bare.slice(k, k + 24));
      if (cm) open = k + cm[0].length - 1;
    }
    if (open < 0) {
      // 호출이 아닌 참조(const r = s.redirect · s['redirect'] 전달) — 대상 판정 불가
      if (REDIRECT_METHODS.has(site.method) && !allowed) fail(site.at, `리다이렉트 메서드 참조(.${site.method}) — 호출 대상 판정 불가, ${REDIRECT_ALLOWED.join('·')} 만(fail-closed)`);
      continue;
    }
    const close = matchParen(bare, open);
    const argsBare = bare.slice(open + 1, close);
    const inArgs = [];
    for (let q = firstStringFrom(strings, open + 1); q < strings.length && strings[q].start < close; q++) inArgs.push(q);
    const argChains = [];
    for (const q of inArgs) if (chainAt.has(q)) argChains.push(chainAt.get(q));
    const values = argChains.map((c) => c.value);
    const regions = argRegions(bare, open, close);
    const isConstRegion = ([a, b]) => {
      const seg = bare.slice(a, b);
      if (!/^[\s()+]*(?:(['"`])[^'"`]*\1[\s()+]*)+$/.test(seg)) return false;
      return argChains.every((c) => strings[c.first].start < a || strings[c.first].start >= b || !c.value.includes(DYN));
    };
    const isConstObject = ([a, b]) => {
      const seg = bare.slice(a, b).trim();
      return seg.startsWith('{') && seg.endsWith('}') && !seg.includes('...') && !/[[]/.test(seg.slice(1, -1).replace(/(['"`])\s*\1/g, ''));
    };
    const isRedirect =
      REDIRECT_METHODS.has(site.method) ||
      (HEADER_METHODS.has(site.method) && (values.some((v) => /^\s*location\s*$/i.test(v)) || /(?<![\w$])location(?![\w$])/i.test(argsBare)));
    if (!isRedirect) {
      // 헤더 이름이 식이면(변수·함수 결과) Location 인지 알 수 없다 — fail-closed. set·append 는 Map·FormData 와 겹쳐 제외(알려진 한계).
      if (STRICT_HEADER.has(site.method)) {
        if (site.method === 'writehead') {
          if (regions.slice(1).some((r) => !isConstRegion(r) && !isConstObject(r))) fail(site.at, 'writeHead 헤더 인수가 식 — Location 여부 판정 불가(fail-closed)');
        } else if (site.method === 'setheaders') {
          if (regions.length === 0 || !isConstObject(regions[0])) fail(site.at, 'setHeaders 인수가 상수 객체 리터럴이 아니다 — Location 여부 판정 불가(fail-closed)');
        } else if (regions.length === 0 || !isConstRegion(regions[0])) {
          if (site.method === 'setheader' || regions.length >= 2) fail(site.at, `.${site.method} 헤더 이름이 식 — Location 여부 판정 불가(fail-closed)`);
        }
      }
      continue;
    }
    const ext = values.find((v) => isExternalUrl(v.trim()));
    if (ext !== undefined) fail(site.at, `리다이렉트·Location 에 외부 URL 리터럴(${L(ext.slice(0, 40))}) — 서버 리다이렉트 0`);
    else if (!allowed) {
      // 리터럴 내부 경로 하나(+ 선택 상태 코드)만이면 허용 — 그 밖(변수·식)은 대상 불명 fail-closed.
      const onlyLiteral =
        REDIRECT_METHODS.has(site.method) &&
        /^\s*(?:\d{3}\s*,\s*)?(['"`])\s*\1\s*$/.test(argsBare) &&
        values.length === 1 &&
        values.every((v) => v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') && !v.includes(DYN));
      if (!onlyLiteral) fail(site.at, `리다이렉트·Location 은 ${REDIRECT_ALLOWED.join('·')} 만(그 밖은 리터럴 내부 경로만) — 대상이 식이면 판정 불가(fail-closed)`);
    }
  }
}

// 렉스 결과 공유(lexJs 가 소스 규칙 비용의 대부분 — 같은 파일은 한 번만).
const lexMemo = new Map();
function lexOnce(abs, text) {
  const hit = lexMemo.get(abs);
  if (hit && hit.text === text) return hit.lex;
  const lex = lexJs(text);
  lexMemo.set(abs, { text, lex });
  return lex;
}

function checkSourceText(root, add) {
  const files = [];
  for (const d of SOURCE_DIRS) {
    const abs = join(root, ...d.split('/'));
    if (isDir(abs)) walk(abs, files);
  }
  for (const abs of files) {
    const rel = relPosix(root, abs);
    const ext = extname(abs).toLowerCase();
    if (!TEXT_LIKE.has(ext)) continue;
    let text;
    try {
      text = stripBom(readFileSync(abs, 'utf8'));
    } catch {
      continue;
    }
    const code = CODE_EXT.has(ext);
    const test = isTestFile(rel);
    const lexed = code && !test && rel !== SELF ? lexOnce(abs, text) : null;
    const chains = lexed ? stringChains(lexed.strings, lexed.bare) : [];
    // C10-AFF-HOST — 줄마다(엔티티·JS 이스케이프·퍼센트 해석) + 코드는 상수 결합·상수 보간 템플릿을 접은 값
    if (!HOST_ALLOWED(rel)) {
      const hostMsg = `제휴 호스트(link.coupang·coupa.ng) 리터럴은 ${AFF_PATHS.providers}·테스트·${AFF_PATHS.mapDir}/*.json 만 — 클라·프리렌더는 @ws/engine PROVIDERS 로`;
      const hit = new Set();
      const ls = text.split('\n');
      for (let i = 0; i < ls.length; i++) {
        if (affHostCount(normalizeHostText(ls[i])) > 0) {
          hit.add(i + 1);
          add('C10-AFF-HOST', 'FAIL', rel, i + 1, hostMsg);
        }
      }
      const lexHost = lexed ?? (code ? lexOnce(abs, text) : null);
      if (lexHost) {
        const ch = lexed ? chains : stringChains(lexHost.strings, lexHost.bare);
        for (const c of ch) {
          if (c.first === c.last && lexHost.strings[c.first].quote !== '`') continue; // 단일 '·" 리터럴은 줄 검사가 같은 값을 본다
          const line = lexHost.strings[c.first].line;
          if (!hit.has(line) && affHostCount(normalizeHostText(c.value)) > 0) {
            hit.add(line);
            add('C10-AFF-HOST', 'FAIL', rel, line, `${hostMsg}(문자열 결합·템플릿 보간을 접은 값)`);
          }
        }
      }
    }
    if (!lexed) continue; // 테스트·비코드·스캐너 자신은 REDIRECT·FIELD 코드 규칙 대상 아님
    const { bare, strings } = lexed;
    // C10-AFF-REDIRECT — 라우트 문자열 마디(server/src·client/src 비테스트)
    if (rel.startsWith('server/src/') || rel.startsWith('client/src/')) {
      for (const s of strings) {
        const t = s.quote === '`' ? s.text : decodeJsEscapes(s.text);
        if (!t.startsWith('/') || t.startsWith('//') || t.length > 300 || /\s/.test(t)) continue;
        const segs = t.replace(/[?#].*$/, '').split('/').filter(Boolean);
        const hit = segs.find((g) => REDIRECT_SEGMENTS.test(g.replace(/^:/, '').replace(/\(.*$/, '')));
        if (hit) add('C10-AFF-REDIRECT', 'FAIL', rel, s.line, `리다이렉트·제휴 경유 라우트 마디 /${L(hit)} 금지 — 제휴는 검색 결과 페이지 링크 직접(서버 경유 0)`);
      }
      if (rel.startsWith('server/src/')) checkRedirectCalls(rel, text, lexed, chains, add);
    }
    // C10-AFF-FIELD — 코드 식별자·키 문자열의 수수료류(server/src·client/src·scripts 비테스트)
    if (rel.startsWith('server/src/') || rel.startsWith('client/src/') || rel.startsWith('scripts/')) {
      const bl = bare.split('\n');
      for (let i = 0; i < bl.length; i++) {
        const re = /[A-Za-z_$][\w$]*/g;
        let m;
        while ((m = re.exec(bl[i])) !== null) {
          if (feeName(m[0])) {
            add('C10-AFF-FIELD', 'FAIL', rel, i + 1, `수수료류 식별자 ${L(m[0])} — 수수료 데이터는 시스템에 자리 없음(불변식 ③④)`);
            break;
          }
        }
      }
      // 한글 식별자(선언·멤버·호출·대입 자리만 — JSX 텍스트·문자열의 고지 문구 '수수료'는 대상 아님. C2-TRADE 한글 규칙과 같은 자리 규약)
      const ko = /(?:\b(?:const|let|var|function|class|type|interface|enum)\s+|\.)([\w$가-힣]*수수료[\w$가-힣]*)|([\w$가-힣]*수수료[\w$가-힣]*)\s*(?=[=(:])/g;
      for (let i = 0; i < bl.length; i++) {
        ko.lastIndex = 0;
        const km = ko.exec(bl[i]);
        if (km) add('C10-AFF-FIELD', 'FAIL', rel, i + 1, `수수료류 식별자 ${L(km[1] ?? km[2])}(불변식 ③④)`);
      }
      for (const s of strings) {
        if (/^[A-Za-z_$][\w$-]{0,63}$/.test(s.text) && feeName(s.text)) add('C10-AFF-FIELD', 'FAIL', rel, s.line, `수수료류 키 문자열 ${L(s.text)}(불변식 ③④)`);
      }
    }
  }
}

// ── 시드·Prisma·맵 파일(FIELD) ────────────────────────────────
function walkKeys(v, path, visit) {
  const stack = [[v, path]];
  while (stack.length) {
    const [x, p] = stack.pop();
    if (Array.isArray(x)) x.forEach((y, i) => stack.push([y, `${p}[${i}]`]));
    else if (isObj(x)) {
      for (const k of Object.keys(x)) {
        visit(k, p ? `${p}.${k}` : k);
        stack.push([x[k], p ? `${p}.${k}` : k]);
      }
    }
  }
}

function checkSeedFields(root, add) {
  const dir = join(root, 'server', 'seed');
  for (const abs of walk(dir)) {
    if (!abs.endsWith('.json')) continue;
    const rel = relPosix(root, abs);
    let doc;
    try {
      doc = JSON.parse(stripBom(readFileSync(abs, 'utf8')));
    } catch {
      continue; // 파싱 실패는 C0-SEED 가 FAIL 로 보고
    }
    const seen = new Set();
    walkKeys(doc, '', (k, p) => {
      if (!SEED_AFF_KEY(k) || seen.has(k)) return;
      seen.add(k);
      add('C10-AFF-FIELD', 'FAIL', rel, null, `시드에 제휴·수수료 키 ${L(k)}(${L(p.slice(0, 60))}) — CuratedProduct 제휴 필드 금지(PRD:43, 불변식 ③④)`);
    });
  }
  const prismaDir = join(root, 'server', 'prisma');
  for (const abs of walk(prismaDir)) {
    if (!abs.endsWith('.prisma')) continue;
    const rel = relPosix(root, abs);
    const ls = readFileSync(abs, 'utf8').split('\n');
    let inBlock = false;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i].replace(/\/\/.*$/, '');
      const mb = /^\s*(model|enum|type|view)\s+(\w+)\s*\{/.exec(l);
      if (mb) {
        inBlock = mb[1] === 'model' || mb[1] === 'type' || mb[1] === 'view';
        if (SEED_AFF_KEY(mb[2])) add('C10-AFF-FIELD', 'FAIL', rel, i + 1, `제휴·수수료 ${mb[1]} ${L(mb[2])}(불변식 ③④)`);
        continue;
      }
      if (/^\s*\}/.test(l)) {
        inBlock = false;
        continue;
      }
      if (!inBlock) continue;
      const f = /^\s*([A-Za-z_]\w*)\s+\S/.exec(l);
      if (f && SEED_AFF_KEY(f[1])) add('C10-AFF-FIELD', 'FAIL', rel, i + 1, `제휴·수수료 컬럼 ${L(f[1])}(불변식 ③④)`);
    }
  }
}

/** 맵 키워드 정규화 — engine/search-links.ts buildSearchLinks 와 같은 식(공백 연속 → ' ', trim). */
const normKeyword = (k) => k.replace(/\s+/g, ' ').trim();
export const coupangSearchHref = (keyword) => `${COUPANG_SEARCH_BASE}${encodeURIComponent(normKeyword(keyword))}`;
/** 달력에 있는 YYYY-MM-DD 인가(로더 dayNumber 와 같은 규약 — 시각 붙은 형식·2026-02-30 거부). */
function isCalendarDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}
/** 원문 JSON 의 같은 객체 안 중복 키(JSON.parse 는 마지막 값만 남겨 숨긴다) — 키 이름 목록. 파싱 성공한 텍스트 대상, 한 번 훑기. */
export function jsonDuplicateKeys(raw) {
  const out = [];
  const stack = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') {
      let k = i + 1;
      while (k < raw.length && raw[k] !== '"') k += raw[k] === '\\' ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && top.obj && top.wantKey) {
        let key;
        try {
          key = JSON.parse(raw.slice(i, k + 1));
        } catch {
          key = raw.slice(i + 1, k);
        }
        if (top.keys.has(key)) out.push(key);
        top.keys.add(key);
        top.wantKey = false;
      }
      i = k;
    } else if (c === '{') stack.push({ obj: true, keys: new Set(), wantKey: true });
    else if (c === '[') stack.push({ obj: false });
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') {
      const top = stack[stack.length - 1];
      if (top && top.obj) top.wantKey = true;
    }
  }
  return out;
}
/**
 * 맵 파일 원문 검사 — 문제 목록(빈 배열 = 통과). name = 파일 이름(<provider 소문자>.json).
 *   prerender/affiliate.ts parseAffiliateMapText 가 거부하는 것은 전부 거부한다(짝 시험). 파일 이름·수수료 은닉 등은 스캐너가 더 엄격.
 */
export function mapProblems(raw, name) {
  const bad = [];
  if (raw.charCodeAt(0) === 0xfeff) return ['파일 앞 BOM(U+FEFF) — BOM 없는 UTF-8 로 저장(로더 parseAffiliateMapText 와 같은 거부)'];
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return [`JSON 파싱 실패(${jsonErrorWhere(raw)}) — 검사 불가(fail-closed)`];
  }
  if (!isObj(doc)) return ['최상위가 객체가 아니다'];
  const dups = jsonDuplicateKeys(raw);
  if (dups.length) bad.push(`원문 중복 키 ${[...new Set(dups)].map(L).join(', ')} — JSON.parse 가 앞 값을 숨긴다(로더와 같은 거부)`);
  // 금지 키 — 어디든(JSON.parse 는 "__proto__" 를 자체 키로 만든다)
  walkKeys(doc, '', (k, p) => {
    if (FORBIDDEN_JSON_KEYS.has(k)) bad.push(`금지 키 ${L(k)}(${L(p)})`);
  });
  const own = Object.keys(doc);
  const extra = own.filter((k) => !MAP_TOP_KEYS.includes(k));
  const miss = MAP_TOP_KEYS.filter((k) => !Object.hasOwn(doc, k));
  if (extra.length) bad.push(`최상위 허용 밖 키 ${extra.map(L).join(', ')} — {${MAP_TOP_KEYS.join(',')}} 만(수수료율·가격 자리 0)`);
  if (miss.length) bad.push(`최상위 키 누락 ${miss.join(', ')}`);
  if (doc.v !== 1) bad.push(`v=${L(JSON.stringify(doc.v))} (1 만)`);
  const provider = name.slice(0, -'.json'.length).toUpperCase();
  if (doc.provider !== provider) bad.push(`provider=${L(JSON.stringify(doc.provider))} ≠ 파일 이름(${provider})`);
  if (doc.provider !== 'COUPANG') bad.push('제휴 링크를 지원하는 공급자는 COUPANG 만(레지스트리 affiliate ≠ null)');
  if (typeof doc.subId !== 'string' || !/^[A-Za-z0-9_-]{0,32}$/.test(doc.subId)) bad.push('subId 형식(영숫자·_- 32자 이내 채널 ID) 위반');
  if (!MAP_SOURCES.has(doc.source)) bad.push(`source=${L(JSON.stringify(doc.source))} — MANUAL 만(--api 는 K4·K5 뒤)`);
  if (typeof doc.generatedAt !== 'string' || !isCalendarDate(doc.generatedAt)) bad.push('generatedAt 이 달력에 있는 YYYY-MM-DD 아님(시각·2026-02-30 거부 — 로더와 같은 규약)');
  if (!Array.isArray(doc.entries)) {
    bad.push('entries 배열 아님');
    return bad;
  }
  const kws = new Set();
  const codes = new Set();
  doc.entries.forEach((e, i) => {
    if (!isObj(e)) return bad.push(`entries[${i}] 객체 아님`);
    const ex = Object.keys(e).filter((k) => !MAP_ENTRY_KEYS.includes(k));
    if (ex.length) bad.push(`entries[${i}] 허용 밖 키 ${ex.map(L).join(', ')} — {keyword,landingUrl,code} 만`);
    const mi = MAP_ENTRY_KEYS.filter((k) => !Object.hasOwn(e, k));
    if (mi.length) bad.push(`entries[${i}] 키 누락 ${mi.join(', ')}`);
    if (typeof e.keyword !== 'string' || normKeyword(e.keyword) === '') return bad.push(`entries[${i}] keyword 빈 값·문자열 아님`);
    if (e.keyword !== normKeyword(e.keyword)) bad.push(`entries[${i}] keyword 가 정규화(공백 정리) 형태 아님`);
    if (kws.has(e.keyword)) bad.push(`entries[${i}] keyword 중복`);
    kws.add(e.keyword);
    if (e.landingUrl !== coupangSearchHref(e.keyword)) bad.push(`entries[${i}] landingUrl 이 같은 검색 결과 페이지(buildSearchLinks 쿠팡 SEARCH href)와 다르다`);
    if (typeof e.code !== 'string' || !AFF_CODE_RE.test(e.code)) bad.push(`entries[${i}] code 형식(codeRe ${AFF_CODE_RE.source}, K8 잠정) 위반`);
    else {
      if (codes.has(e.code)) bad.push(`entries[${i}] code 중복(서로 다른 검색어에 같은 코드 — 로더와 같은 거부)`);
      codes.add(e.code);
    }
  });
  return bad;
}

function checkMapFiles(root, add) {
  const dirAbs = join(root, ...AFF_PATHS.mapDir.split('/'));
  if (!isDir(dirAbs)) return; // 없음 = 통과(259 전)
  for (const abs of walk(dirAbs)) {
    const rel = relPosix(root, abs);
    const name = rel.slice(AFF_PATHS.mapDir.length + 1);
    if (name === '.gitkeep' || name === 'README.md') continue;
    const bad = (msg) => add('C10-AFF-FIELD', 'FAIL', rel, null, `제휴 맵 ${msg}`);
    if (name.includes('/') || !/^[a-z]+\.json$/.test(name)) {
      bad('디렉터리에는 <provider 소문자>.json 만(하위 폴더·CSV·기타 파일 금지 — 수수료·가격 자료가 들어올 자리 0)');
      continue;
    }
    // BOM 은 벗기지 않는다 — 로더(parseAffiliateMapText)와 같이 거부(276 Codex 재검증 LOW 7)
    for (const msg of mapProblems(readFileSync(abs, 'utf8'), name)) bad(msg);
  }
}

/** 소스 쪽 C10-AFF 전체. */
export function scanAffiliateSources(root, add) {
  checkImportIsolation(root, add);
  checkSourceText(root, add);
  checkSeedFields(root, add);
  checkMapFiles(root, add);
}

// ── 산출물(C10-AFF-OUT) ───────────────────────────────────────
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
/** 요소 트리(정형 프리렌더 HTML 대상) — { name, attrs, start, openEnd, end, parent }. 닫는 태그 짝 찾기는 이름별 개수로 선형. 부모 인덱스 < 자식 인덱스. */
export function elementTree(html) {
  const masked = maskNonMarkup(html);
  const els = [];
  const stack = [];
  const open = new Map();
  const re = /<(\/?)([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const name = m[2].toLowerCase();
    if (m[1] === '/') {
      if (!(open.get(name) > 0)) continue;
      while (stack.length) {
        const e = els[stack.pop()];
        open.set(e.name, open.get(e.name) - 1);
        e.end = m.index;
        if (e.name === name) break;
      }
      continue;
    }
    const raw = html.slice(m.index + 1 + m[2].length, m.index + m[0].length - 1);
    els.push({ name, attrs: parseAttrs(raw.replace(/\/\s*$/, '')), start: m.index, openEnd: m.index + m[0].length, end: null, parent: stack.length ? stack[stack.length - 1] : -1 });
    if (!VOID.has(name) && !/\/\s*$/.test(raw)) {
      stack.push(els.length - 1);
      open.set(name, (open.get(name) ?? 0) + 1);
    }
  }
  for (const i of stack) els[i].end = html.length;
  for (const e of els) if (e.end === null) e.end = e.openEnd;
  return els;
}
const classesOf = (e) => (e.attrs.class ?? '').split(/\s+/).filter(Boolean);
/**
 * 숨김·축소 선언(인라인 style·CSS 규칙 본문). 274: flex-wrap:nowrap 은 글자 축소가 아니라 white-space·text-wrap 만, font-size·높이는 0 만
 *   (0.75rem 오탐 제거), clip-path·zoom·scale(0)·transparent·text-indent 음수·큰 음수 위치·content-visibility 추가.
 */
const HIDE_STYLE_RE =
  /display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|(?<![\w-])opacity\s*:\s*(?:0+(?:\.0*)?|\.0+)(?![\d.])|white-space\s*:\s*nowrap|text-wrap(?:-mode)?\s*:\s*nowrap|line-clamp|text-overflow|font-size\s*:\s*0(?![.\d])|(?<![\w-])(?:max-)?(?:height|width)\s*:\s*0(?![.\d])|(?<![\w-])clip(?:-path)?\s*:|(?<![\w-])(?:zoom|scale)\s*:\s*0(?![.\d])|scale\(\s*0(?![.\d])|(?<![\w-])color\s*:\s*transparent|text-indent\s*:\s*-|(?<![\w-])(?:left|top|right|bottom|margin-left|margin-top)\s*:\s*-\d{3,}|content-visibility\s*:\s*hidden/i;
function hiddenEl(e) {
  return (
    e.attrs.hidden !== undefined ||
    e.attrs['aria-hidden'] === 'true' ||
    classesOf(e).some((c) => c === 'ws-visually-hidden' || c === 'sr-only' || c === 'visually-hidden') ||
    ['details', 'summary', 'template', 'noscript', 'dialog'].includes(e.name) ||
    HIDE_STYLE_RE.test(e.attrs.style ?? '') ||
    e.attrs.title !== undefined // 툴팁 금지(111 §0)
  );
}
/** 고지 문구 — 자식 태그가 있으면 null(숨긴 자식으로 원문 일치를 꾸미는 우회 차단). */
const noteText = (html, e) => {
  const inner = html.slice(e.openEnd, e.end);
  return inner.includes('<') ? null : decodeEntities(inner);
};
const NOTE_CLASSES = new Set(['ws-t-meta', 'ws-aff-note']);
const noteClassOk = (e) => classesOf(e).includes('ws-aff-note') && classesOf(e).every((c) => NOTE_CLASSES.has(c));

/** href 분류 — 'search' | 'aff' | 'bad' | null(쿠팡 아님). */
function coupangKind(href) {
  const h = href.trim();
  const norm = normalizeHostText(h);
  let host = null;
  try {
    host = new URL(h).hostname.toLowerCase();
  } catch {
    host = null;
  }
  const family = (host !== null && (host === 'coupang.com' || host.endsWith('.coupang.com') || host === 'coupa.ng' || host.endsWith('.coupa.ng'))) || /coupang\.|coupa\.ng/.test(norm);
  if (!family) return null;
  if (COUPANG_SEARCH_RE.test(href)) return 'search';
  if (AFF_HREF_RE.test(href)) return 'aff';
  return 'bad';
}

/** ws-data aff 검사 — 같은 페이지 코드 집합을 돌려준다(없으면 null). */
function checkWsAff(d, rel, line, dev, add) {
  const bad = (w) => add('C10-AFF-OUT', 'FAIL', rel, line, `ws-data ${w}`);
  if (!isObj(d)) return null;
  const reqs = isObj(d.data) && Array.isArray(d.data.requirements) ? d.data.requirements : [];
  const codes = new Set();
  let n = 0;
  reqs.forEach((q, i) => {
    if (!isObj(q) || !Object.hasOwn(q, 'aff')) return;
    n++;
    if (d.v !== 3) return bad(`v=${L(JSON.stringify(d.v))} 인데 requirements[${i}].aff — aff 는 v3 만(aff 0 이면 v2 그대로)`);
    const a = q.aff;
    if (!isObj(a) || Object.keys(a).length !== 1 || !Object.hasOwn(a, 'COUPANG')) return bad(`requirements[${i}].aff 형식 — {COUPANG:code} 만`);
    if (typeof a.COUPANG !== 'string' || !AFF_CODE_RE.test(a.COUPANG)) return bad(`requirements[${i}].aff.COUPANG 이 codeRe 위반`);
    codes.add(a.COUPANG);
  });
  if (d.v === 3 && n === 0) bad('v3 인데 aff 0 — 제휴 없는 페이지는 v2 로(off 바이트 보존)');
  if (dev && (d.v === 3 || n > 0)) bad('개발 빌드(manifest.mode=development)에 제휴 aff(게이트 꺼짐이어야 한다)');
  // 그 밖 위치의 제휴·수수료 키
  walkKeys(d, '', (k, p) => {
    if (/^data\.requirements\[\d+\]\.aff(?:\.COUPANG)?$/.test(p)) return;
    if (k === 'aff' || SEED_AFF_KEY(k)) bad(`허용 밖 제휴·수수료 키 ${L(k)}(${L(p.slice(0, 60))})`);
  });
  return d.v === 3 ? codes : null;
}

/** CSS 선택자 대조용 요소 서술(이름·id·class·속성). */
const descOf = (e) => ({ name: e.name, id: e.attrs.id, classes: classesOf(e), attrs: e.attrs });
/** 버튼 동등에서 제휴 a 와 상인 a 가 달라도 되는 속성(href·rel 의 sponsored·describedby). */
const AFF_DIFF_ATTRS = new Set(['href', 'rel', 'aria-describedby']);
const relTokens = (v) => [...new Set((v ?? '').toLowerCase().split(/\s+/).filter(Boolean))].sort();

/**
 * 전체 HTML 검사. 부모별 자식 목록·가장 가까운 .ws-search·레이어 aside·숨김 상속을 한 번에 색인(선형) — Codex LOW(제곱 비용).
 *   sink(선택) 에 고지 요소 사슬(CSS 숨김 검사)·제휴/상인 a 사슬(CSS 버튼 동등 검사)·인라인 <style> 을 모은다.
 */
export function checkHtmlAff(html, rel, dev, add, sink = null) {
  const fail = (line, msg) => add('C10-AFF-OUT', 'FAIL', rel, line, msg);
  const lineOf = lineIndex(html);
  // ws-data
  let pageCodes = null;
  for (const s of scripts(html)) {
    if (s.attrs.id !== 'ws-data') continue;
    let d;
    try {
      d = JSON.parse(s.body);
    } catch {
      continue; // C8-OUT-SAFE 가 FAIL
    }
    pageCodes = checkWsAff(d, rel, lineOf(s.index), dev, add);
  }
  if (sink) {
    const sre = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
    let sm;
    while ((sm = sre.exec(html)) !== null) sink.styles.push({ rel, css: sm[1], line: lineOf(sm.index) });
  }
  const els = elementTree(html);
  const n = els.length;
  const children = new Map();
  const upSearch = new Int32Array(n).fill(-1);
  const upAside = new Int32Array(n).fill(-1);
  const hiddenUp = new Uint8Array(n);
  const isSearch = (e) => e.name === 'div' && classesOf(e).includes('ws-search');
  const isLayer = (e) => e.name === 'aside' && e.attrs['data-ws-layer'] !== undefined;
  const byId = new Map();
  for (let i = 0; i < n; i++) {
    const e = els[i];
    const p = e.parent;
    if (p >= 0) {
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(i);
      upSearch[i] = isSearch(els[p]) ? p : upSearch[p];
      upAside[i] = isLayer(els[p]) ? p : upAside[p];
    }
    hiddenUp[i] = hiddenEl(e) || (p >= 0 && hiddenUp[p] === 1) ? 1 : 0;
    if (e.attrs.id !== undefined && !byId.has(e.attrs.id)) byId.set(e.attrs.id, i);
  }
  const kids = (i) => children.get(i) ?? [];
  const chainOf = (i) => {
    const out = [];
    for (let p = i; p >= 0; p = els[p].parent) out.push(descOf(els[p]));
    return out;
  };
  // 블록별 상인 a(일반 http·쿠팡 제외)·쿠팡 계열 포함 첫 시작 — a 마다 .ws-search 조상 사슬을 따라 등록(중첩 깊이만큼).
  const blocks = new Map();
  const block = (s) => {
    if (!blocks.has(s)) blocks.set(s, { merch: [], firstLink: Infinity });
    return blocks.get(s);
  };
  const affLinks = [];
  for (let i = 0; i < n; i++) {
    const e = els[i];
    if (e.name !== 'a' || e.attrs.href === undefined) continue;
    const k = coupangKind(e.attrs.href);
    if (k === 'bad') fail(lineOf(e.start), `쿠팡 링크는 검색 결과 페이지(${COUPANG_SEARCH_BASE}…) 또는 ${AFF_PREFIX}<code> 만: ${L(e.attrs.href.slice(0, 60))}`);
    if (k === 'aff') affLinks.push(i);
    const merch = k === null && /^https?:/i.test(e.attrs.href.trim());
    if (!merch && k === null) continue;
    for (let s = upSearch[i]; s >= 0; s = upSearch[s]) {
      const b = block(s);
      if (merch) b.merch.push(i);
      if (e.start < b.firstLink) b.firstLink = e.start;
    }
  }
  // 제휴 호스트 출현 = 유효 제휴 a href 수(그 밖 위치의 출현은 FAIL — 텍스트·속성·스크립트 속 숨은 링크)
  const occurrences = affHostCount(normalizeHostText(decodeEntities(html)));
  if (occurrences > affLinks.length) fail(null, `제휴 호스트가 <a href="${AFF_PREFIX}<code>"> 밖에 ${occurrences - affLinks.length}회`);
  if (dev && (affLinks.length > 0 || occurrences > 0)) fail(null, '개발 빌드(manifest.mode=development)에 제휴 링크(게이트 꺼짐이어야 한다)');

  // 클라이언트 쪽 경유 이동(meta refresh) 0 — 제휴는 검색 결과 페이지 링크 직접
  for (const e of els) if (e.name === 'meta' && (e.attrs['http-equiv'] ?? '').trim().toLowerCase() === 'refresh') fail(lineOf(e.start), '<meta http-equiv="refresh"> 금지(경유 이동 0)');
  /** a 의 자식 구조(태그·속성, 글자 제외) — 버튼 동등 비교. */
  const skeleton = (i) => {
    const out = [];
    const st = [...kids(i)].reverse();
    while (st.length) {
      const x = st.pop();
      out.push(`${els[x].name}${JSON.stringify(Object.entries(els[x].attrs).sort())}`);
      st.push(...[...kids(x)].reverse());
    }
    return out.join('|');
  };
  const usedNotes = new Set();
  const noteCheck = (ni, kind) => {
    const ne = els[ni];
    usedNotes.add(ni);
    if (ne.name !== 'p') fail(lineOf(ne.start), `고지 ${kind} 는 <p>`);
    if (noteText(html, ne) !== COUPANG_DISCLOSURE) fail(lineOf(ne.start), `고지 ${kind} 문구가 쿠팡 권장 원문과 바이트 불일치(자식 태그 0)`);
    if (!noteClassOk(ne)) fail(lineOf(ne.start), `고지 ${kind} class 는 ws-t-meta·ws-aff-note 만(ws-aff-note 필수 — 다른 클래스로 숨김·축소 금지)`);
    if (ne.attrs.style !== undefined) fail(lineOf(ne.start), `고지 ${kind} 에 인라인 style 금지(111 §0 마크업 고정 — 축소·숨김 통로)`);
    if (hiddenUp[ni]) fail(lineOf(ne.start), `고지 ${kind} 가 숨김·접힘·툴팁(자신 또는 조상)`);
    if (sink) {
      const c = chainOf(ni);
      sink.notes.set(JSON.stringify(c), { chain: c, rel, line: lineOf(ne.start) });
    }
  };
  const notesAOf = new Map();
  const notesBOf = new Map();
  for (const i of affLinks) {
    const a = els[i];
    const line = lineOf(a.start);
    const code = AFF_HREF_RE.exec(a.attrs.href)[1];
    if (pageCodes === null) fail(line, '제휴 a 가 있는데 ws-data v3 aff 없음(하이드레이션 뒤 링크 불일치)');
    else if (!pageCodes.has(code)) fail(line, '제휴 a 코드가 ws-data aff 에 없다');
    const rels = relTokens(a.attrs.rel);
    if (!rels.includes('sponsored')) fail(line, '제휴 a 에 rel="sponsored" 없음');
    if (hiddenUp[i]) fail(line, '제휴 a 가 숨김·접힘 요소 안(더보기·툴팁 금지)');
    const search = upSearch[i];
    const aside = upAside[i];
    if (aside < 0 || !AFF_LAYERS.has(els[aside].attrs['data-ws-layer'])) fail(line, `제휴 a 는 레이어 ${[...AFF_LAYERS].join('·')} aside 안에만(홈·카드·/setup·/vet·L2·L3·L5 정적·L8 0)`);
    if (search < 0) {
      fail(line, '제휴 a 가 .ws-search 블록 밖');
      continue;
    }
    // 고지 A — 같은 .ws-search 직속, 이 a 앞, 모든 상인 a 앞, describedby 연결, 원문, 숨김 0
    if (!notesAOf.has(search)) notesAOf.set(search, kids(search).filter((x) => els[x].attrs['data-ws-aff'] === 'note-a'));
    const notesA = notesAOf.get(search);
    const blk = block(search);
    if (notesA.length !== 1) fail(line, `고지 A(data-ws-aff="note-a")가 같은 .ws-search 직속에 정확히 1개여야 한다(현재 ${notesA.length})`);
    else {
      const na = els[notesA[0]];
      if (!usedNotes.has(notesA[0])) {
        noteCheck(notesA[0], 'A');
        if (blk.firstLink < na.start) fail(lineOf(na.start), '고지 A 가 상인 버튼보다 뒤 — 쿠팡 버튼 바로 위(링크 그룹 첫 요소)');
      }
      const desc = (a.attrs['aria-describedby'] ?? '').split(/\s+/).filter(Boolean);
      if (na.attrs.id === undefined || !desc.includes(na.attrs.id) || byId.get(na.attrs.id) !== notesA[0]) fail(line, '제휴 a 의 aria-describedby 가 같은 블록 고지 A id 를 가리키지 않는다');
    }
    // 버튼 동등(D-37 · 274 Codex MED) — 같은 블록 일반 상인 a 와 href·rel(sponsored)·describedby 밖 속성(class·target·style·data-*…)·자식 구조 동일
    const affSkel = skeleton(i);
    for (const x of blk.merch) {
      const mA = els[x].attrs;
      const keys = new Set([...Object.keys(a.attrs), ...Object.keys(mA)]);
      const diff = [...keys].filter((k) => !AFF_DIFF_ATTRS.has(k) && a.attrs[k] !== mA[k]);
      const relDiff = JSON.stringify(rels.filter((t) => t !== 'sponsored')) !== JSON.stringify(relTokens(mA.rel).filter((t) => t !== 'sponsored'));
      if (diff.length || relDiff || affSkel !== skeleton(x)) {
        fail(line, `제휴 a 가 같은 블록 일반 상인 링크와 다르다(${[...diff, ...(relDiff ? ['rel(sponsored 밖)'] : []), ...(affSkel !== skeleton(x) ? ['자식 구조'] : [])].map(L).join(', ')} — 라벨·크기·스타일 동등, 불변식 ③)`);
        break;
      }
    }
    if (sink && blk.merch.length > 0) {
      const ca = chainOf(i);
      const cm = chainOf(blk.merch[0]);
      sink.pairs.set(JSON.stringify([ca, cm]), { aff: ca[0], merch: cm[0], rel, line });
    }
    // 고지 B — 같은 aside 직속, 검색 블록 앞, 원문, 숨김 0
    if (aside >= 0) {
      if (!notesBOf.has(aside)) notesBOf.set(aside, kids(aside).filter((x) => els[x].attrs['data-ws-aff'] === 'note-b'));
      const notesB = notesBOf.get(aside);
      if (notesB.length !== 1) fail(line, `고지 B(data-ws-aff="note-b")가 같은 레이어 aside 직속에 정확히 1개여야 한다(현재 ${notesB.length})`);
      else {
        const nb = els[notesB[0]];
        if (!usedNotes.has(notesB[0])) noteCheck(notesB[0], 'B');
        if (nb.start > els[search].start) fail(lineOf(nb.start), '고지 B 가 검색 블록 뒤 — 레이어 본문 첫 부분');
      }
    }
  }
  // 고지 F(R4-3, R4 시안 affiliate_candidates) — 제휴 a 가 1개 이상인 문서는 페이지 하단 footer.ws-footer 직속에 정확히 1개, 원문·숨김 0.
  if (affLinks.length > 0) {
    const footers = [];
    for (let i = 0; i < n; i++) if (els[i].name === 'footer' && classesOf(els[i]).includes('ws-footer')) footers.push(i);
    const notesF = footers.flatMap((f) => kids(f).filter((x) => els[x].attrs['data-ws-aff'] === 'note-f'));
    if (footers.length !== 1) fail(null, `제휴 문서의 footer.ws-footer 가 정확히 1개여야 한다(현재 ${footers.length}) — 고지 F 자리`);
    else if (notesF.length !== 1) fail(null, `고지 F(data-ws-aff="note-f")가 footer.ws-footer 직속에 정확히 1개여야 한다(현재 ${notesF.length})`);
    else noteCheck(notesF[0], 'F');
  }
  // 고지·data-ws-aff 가 제휴 링크와 짝이 없으면(off 바이트 보존 위반) FAIL
  for (let i = 0; i < n; i++) {
    const v = els[i].attrs['data-ws-aff'];
    if (v === undefined) continue;
    if (v !== 'note-a' && v !== 'note-b' && v !== 'note-f') fail(lineOf(els[i].start), `data-ws-aff=${L(v)} — note-a·note-b·note-f 만`);
    else if (!usedNotes.has(i)) fail(lineOf(els[i].start), `짝 없는 고지 ${v}(제휴 링크 0 인 블록·레이어에 고지 — 꺼짐은 HEAD 와 바이트 동일)`);
  }
}

// ── CSS 선택자(고지 숨김·버튼 동등) — 경량 대조: 형제 결합자·의사 클래스는 「맞을 수 있음」(fail-closed 쪽 과대 근사) ─────────
const IDENT_RE = /(?:[\w-]|\\[\s\S])+/y;
/** 요소 자신을 꾸미지 않는 의사 요소(글자를 숨기지 못함) — 이 compound 는 고지·버튼에 적용되지 않는다. */
const SKIP_PSEUDO_EL = /^(?:before|after|marker|placeholder|selection|backdrop|file-selector-button|-webkit-.*|-moz-.*|-ms-.*)$/;
const LEGACY_PSEUDO_EL = new Set(['before', 'after', 'first-line', 'first-letter']);
const unesc = (s) =>
  s.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([\s\S])/g, (m, hex, ch) => {
    if (hex === undefined) return ch;
    try {
      return String.fromCodePoint(parseInt(hex, 16));
    } catch {
      return m;
    }
  });
function parseAttrSel(body) {
  const m = /^\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*([iIsS])?)?\s*$/.exec(body);
  if (!m) return null;
  return { name: m[1].toLowerCase(), op: m[2] ?? null, val: m[3] ?? m[4] ?? m[5] ?? '', ci: (m[6] ?? '').toLowerCase() === 'i' };
}
/** 복합 선택자 → { compounds, combs } | null(해석 불가). combs[k] = compounds[k] 앞 결합자(' ' '>' '+' '~'), combs[0]=null. */
export function parseSelector(sel) {
  const out = { compounds: [], combs: [] };
  let cur = null;
  let comb = null;
  const s = sel.trim();
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (cur) comb = comb ?? ' ';
      cur = null;
      i++;
      continue;
    }
    if (c === '>' || c === '+' || c === '~') {
      comb = c;
      cur = null;
      i++;
      continue;
    }
    if (!cur) {
      cur = { tag: null, ids: [], classes: [], attrs: [], skip: false, empty: false, nots: [] };
      out.compounds.push(cur);
      out.combs.push(out.compounds.length === 1 ? null : (comb ?? ' '));
      comb = null;
    }
    const ident = (at) => {
      IDENT_RE.lastIndex = at;
      const m = IDENT_RE.exec(s);
      return m ? m[0] : null;
    };
    if (c === '*') {
      cur.tag = '*';
      i++;
    } else if (c === '#' || c === '.') {
      const v = ident(i + 1);
      if (!v) return null;
      (c === '#' ? cur.ids : cur.classes).push(unesc(v));
      i += 1 + v.length;
    } else if (c === '[') {
      const j = s.indexOf(']', i);
      if (j < 0) return null;
      const a = parseAttrSel(s.slice(i + 1, j));
      if (!a) return null;
      cur.attrs.push(a);
      i = j + 1;
    } else if (c === ':') {
      const dbl = s[i + 1] === ':';
      const v = ident(i + (dbl ? 2 : 1));
      if (!v) return null;
      const name = v.toLowerCase();
      i += (dbl ? 2 : 1) + v.length;
      let arg = null;
      if (s[i] === '(') {
        const open = i;
        let d = 0;
        for (; i < s.length; i++) {
          if (s[i] === '(') d++;
          else if (s[i] === ')' && --d === 0) break;
        }
        arg = s.slice(open + 1, i);
        i++;
      }
      if (dbl || LEGACY_PSEUDO_EL.has(name)) {
        if (SKIP_PSEUDO_EL.test(name)) cur.skip = true;
      } else cur.pseudo = true;
      if (dbl || LEGACY_PSEUDO_EL.has(name)) {
        // 의사 요소 — 위에서 처리
      } else if (name === 'empty') cur.empty = true;
      else if (name === 'not' && arg !== null) {
        // 276: :not(단순 compound 목록)은 평가한다 — 고지를 빼는 규칙(p:not(.ws-aff-note))의 오탐 제거. 결합자가 든 인수 등
        //   평가할 수 없는 인수는 「맞을 수 있음」(알 수 없음) 그대로 — 숨김 선언이 없으면 결과에 영향 없음.
        const parts = splitSelectorList(arg).map(parseSelector);
        if (parts.length > 0 && parts.every((p) => p !== null && p.compounds.length === 1)) cur.nots.push(...parts.map((p) => p.compounds[0]));
      }
    } else {
      const v = ident(i);
      if (!v) return null;
      cur.tag = unesc(v).toLowerCase();
      i += v.length;
    }
  }
  return out.compounds.length ? out : null;
}
function attrMatch(a, d) {
  let v = d.attrs[a.name];
  if (v === undefined) return false;
  if (a.op === null) return true;
  let want = a.val;
  if (a.ci) {
    v = v.toLowerCase();
    want = want.toLowerCase();
  }
  switch (a.op) {
    case '=':
      return v === want;
    case '~=':
      return v.split(/\s+/).includes(want);
    case '|=':
      return v === want || v.startsWith(`${want}-`);
    case '^=':
      return want !== '' && v.startsWith(want);
    case '$=':
      return want !== '' && v.endsWith(want);
    case '*=':
      return want !== '' && v.includes(want);
    default:
      return true;
  }
}
/** compound ↔ 요소 서술. 의사 클래스는 맞을 수 있음으로(:empty 만 — 고지는 글자가 있어 안 맞음). */
function compoundMatch(c, d, textful = true) {
  if (c.skip) return false;
  if (c.empty && textful) return false;
  if (c.tag && c.tag !== '*' && c.tag !== d.name) return false;
  if (c.ids.some((x) => x !== d.id)) return false;
  if (c.classes.some((x) => !d.classes.includes(x))) return false;
  if (!c.attrs.every((a) => attrMatch(a, d))) return false;
  // :not(X) — X 가 확실히 맞으면 제외. X 자체의 의사 클래스·:not 은 「맞을 수 있음」이라 제외하지 않는다(보수적).
  return !(c.nots ?? []).some((n) => !n.skip && !n.pseudo && compoundMatch(n, d, textful));
}
/** 선택자가 사슬[0](조상은 사슬[1..])에 맞을 수 있는가. 형제 결합자는 그 compound 를 건너뛴다(과대 근사). */
function selectorMatches(p, ch) {
  const m = (ci, ei) => ei < ch.length && compoundMatch(p.compounds[ci], ch[ei], ei === 0) && left(ci, ei);
  const left = (ci, ei) => {
    if (ci === 0) return true;
    const comb = p.combs[ci];
    if (comb === '>') return m(ci - 1, ei + 1);
    if (comb === ' ') {
      for (let ej = ei + 1; ej < ch.length; ej++) if (m(ci - 1, ej)) return true;
      return false;
    }
    return left(ci - 1, ei); // + ~ : 형제 정보 없음 — 맞는다고 보고 같은 문맥으로
  };
  return m(p.compounds.length - 1, 0);
}
/** 선택자 목록을 깊이 0 쉼표로 나눈다. */
function splitSelectorList(s) {
  const out = [];
  let d = 0;
  let a = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(' || s[i] === '[') d++;
    else if (s[i] === ')' || s[i] === ']') d--;
    else if (s[i] === ',' && d === 0) {
      out.push(s.slice(a, i));
      a = i + 1;
    }
  }
  out.push(s.slice(a));
  return out.map((x) => x.trim()).filter(Boolean);
}
/**
 * CSS 고지·버튼 검사. ① .ws-aff-note 를 쓰는 규칙의 숨김·축소 선언(260) ② 고지 요소 또는 그 조상에 맞을 수 있는 일반 선택자의
 *   숨김·축소 선언(274 — p{display:none}·.ws-search{…}) ③ 제휴 a 에는 맞고 같은 블록 상인 a 에는 안 맞는 compound(rel·href·describedby 표적
 *   선택자 — 버튼 크기·스타일 차등 통로). 해석 불가 선택자 + 숨김 선언 + 고지 있음 → FAIL(fail-closed).
 */
/**
 * 요소 선택자가 아닌 블록(@keyframes·@-webkit-keyframes 의 from·to·N% / @font-face·@page·@property·@counter-style·@font-feature-values)을
 *   같은 길이 공백으로 지운다(줄 보존). 275 A-1: Vite 가 from 을 0% 로 줄인 번들에서 「해석할 수 없는 선택자(0%)」 오탐.
 */
const NON_ELEMENT_AT = /@(?:-[a-z]+-)?(?:keyframes|font-face|page|property|counter-style|font-feature-values|font-palette-values)\b/gi;
function blankNonElementAtRules(src) {
  let out = src;
  NON_ELEMENT_AT.lastIndex = 0;
  let m;
  while ((m = NON_ELEMENT_AT.exec(out)) !== null) {
    const ob = out.indexOf('{', m.index);
    if (ob < 0) break;
    let d = 0;
    let j = ob;
    for (; j < out.length; j++) {
      if (out[j] === '{') d++;
      else if (out[j] === '}' && --d === 0) break;
    }
    const end = Math.min(out.length, j + 1);
    out = out.slice(0, m.index) + out.slice(m.index, end).replace(/[^\n]/g, ' ') + out.slice(end);
    NON_ELEMENT_AT.lastIndex = end;
  }
  return out;
}
export function checkCssAff(css, rel, baseLine, sink, add) {
  const src = blankNonElementAtRules(css.replace(/\/\*[\s\S]*?\*\//g, (x) => x.replace(/[^\n]/g, ' ')));
  const lineOfCss = lineIndex(src);
  const notes = sink ? [...sink.notes.values()] : [];
  const pairs = sink ? [...sink.pairs.values()] : [];
  const fail = (off, msg) => add('C10-AFF-OUT', 'FAIL', rel, baseLine + lineOfCss(off) - 1, msg);
  let off = 0;
  for (const chunk of src.split('}')) {
    const ob = chunk.lastIndexOf('{');
    if (ob >= 0) {
      let sel = chunk.slice(chunk.lastIndexOf('{', ob - 1) + 1, ob);
      sel = sel.slice(sel.lastIndexOf(';') + 1).trim();
      const body = chunk.slice(ob + 1);
      const at = off + ob;
      if (sel !== '' && !sel.startsWith('@')) {
        const hides = HIDE_STYLE_RE.test(body);
        // .ws-aff-note 를 직접 겨누는 규칙 — :not(…) 안의 언급(고지를 빼는 규칙)은 제외(276 오탐 수정)
        if (sel.replace(/:not\((?:[^()]|\([^()]*\))*\)/gi, '').includes('.ws-aff-note') && hides) fail(at, '.ws-aff-note 에 숨김·축소 선언(display:none·visibility·opacity 0·nowrap·line-clamp·clip 등) 금지');
        else {
          let reported = false;
          for (const one of splitSelectorList(sel)) {
            if (reported) break;
            const p = parseSelector(one);
            if (hides && notes.length > 0) {
              if (p === null) {
                fail(at, `해석할 수 없는 선택자(${L(one.slice(0, 40))})에 숨김·축소 선언 — 고지에 적용되는지 판정 불가(fail-closed)`);
                reported = true;
                continue;
              }
              const hit = notes.find((nt) => nt.chain.some((_, k) => selectorMatches(p, nt.chain.slice(k))));
              if (hit) {
                fail(at, `선택자 ${L(one.slice(0, 40))} 의 숨김·축소 선언이 제휴 고지(또는 조상)에 적용된다(${L(hit.rel)}:${hit.line}) — 111 §0`);
                reported = true;
                continue;
              }
            }
            if (p !== null && pairs.length > 0) {
              const hit = pairs.find((pr) => p.compounds.some((c) => compoundMatch(c, pr.aff, false) !== compoundMatch(c, pr.merch, false)));
              if (hit) {
                fail(at, `선택자 ${L(one.slice(0, 40))} 가 제휴 a 와 같은 블록 상인 a 를 구별한다(${L(hit.rel)}:${hit.line}) — 버튼 동등(D-37, 불변식 ③)`);
                reported = true;
              }
            }
          }
        }
      }
    }
    off += chunk.length + 1;
  }
}

/**
 * 산출물 쪽 C10-AFF-OUT. manifest 없으면 아무것도 하지 않는다(C0-OUTPUT·NOT RUN 은 scanOutputs 가).
 *   mode 누락은 production 취급(rules-output 과 같은 규약). HTML 을 먼저 훑어 고지·버튼 사슬을 모은 뒤 CSS(파일·인라인 <style>)를 본다.
 */
export function scanAffiliateOutputs({ root, dist, add }) {
  const manPath = join(dist, 'prerender-manifest.json');
  if (!existsSync(manPath)) return;
  let m;
  try {
    m = JSON.parse(stripBom(readFileSync(manPath, 'utf8')));
  } catch {
    return; // C3-OUT-ROUTE 가 FAIL
  }
  const dev = isObj(m) && m.mode === 'development';
  const sink = { notes: new Map(), pairs: new Map(), styles: [] };
  const files = walk(dist);
  const cssFiles = [];
  for (const abs of files) {
    const rel = relPosix(root, abs);
    const ext = extname(abs).toLowerCase();
    if (ext === '.html') {
      try {
        checkHtmlAff(readFileSync(abs, 'utf8'), rel, dev, add, sink);
      } catch {
        add('C10-AFF-OUT', 'FAIL', rel, null, 'HTML 제휴 검사 중 예외(비정상 구조 — 원문 확인, fail-closed)');
      }
      continue;
    }
    if (ext === '.css') {
      cssFiles.push([abs, rel]);
      continue;
    }
    // 번들(js·css·map)은 레지스트리 PROVIDERS 접두를 품을 수 있다 — 그 밖 텍스트 산출물(카탈로그·sitemap·robots·manifest 등)은 제휴 0.
    if (!['.json', '.xml', '.txt', '.webmanifest', '.svg'].includes(ext)) continue;
    const text = readFileSync(abs, 'utf8');
    if (affHostCount(normalizeHostText(text)) > 0) {
      const ls = text.split('\n');
      const li = ls.findIndex((l) => affHostCount(normalizeHostText(l)) > 0);
      add('C10-AFF-OUT', 'FAIL', rel, li >= 0 ? li + 1 : null, '비HTML 산출물(카탈로그·sitemap 등)에 제휴 호스트');
    }
    if (ext === '.json') {
      let doc;
      try {
        doc = JSON.parse(stripBom(text));
      } catch {
        continue; // 다른 규칙이 형식 FAIL
      }
      const seen = new Set();
      walkKeys(doc, '', (k, p) => {
        if ((k === 'aff' || SEED_AFF_KEY(k)) && !seen.has(k)) {
          seen.add(k);
          add('C10-AFF-OUT', 'FAIL', rel, null, `비HTML 산출물에 제휴·수수료 키 ${L(k)}(${L(p.slice(0, 60))}) — 카탈로그 aff 0`);
        }
      });
    }
  }
  // CSS — 고지(.ws-aff-note 직접·일반 선택자·조상) 숨김·축소 0, 제휴 a 차등 선택자 0(111 §0 · D-37)
  for (const [abs, rel] of cssFiles) checkCssAff(readFileSync(abs, 'utf8'), rel, 1, sink, add);
  for (const s of sink.styles) checkCssAff(s.css, s.rel, s.line, sink, add);
}
