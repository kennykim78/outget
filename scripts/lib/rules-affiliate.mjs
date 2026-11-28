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
import { decodeEntities, dupAttrNames, maskNonMarkup, parseAttrs, scripts } from './html.mjs';
import { lintText } from './normalize.mjs';
import { isTestFile, jsonErrorWhere, safeLabel } from './rules-source.mjs';
import { PHOTO_ASSET_PATH_RE } from './seed-exposure.mjs';

/** 398 C1: 로컬 대체 사진 data-ws-photo 값 모양(시드 사진 id = ph-<kebab>). */
const PHOTO_ID_RE = /^ph-[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
  /** 362 N12: 상품 피드 로더(빌드 타임) — 제휴 모듈과 같은 격리, 런타임 폐포가 닿으면 FAIL */
  productFeedLoader: 'server/src/prerender/product-feed.ts',
  /** 362 N12: 커밋되는 상품 피드 디렉터리(server/product-feed/<provider 소문자>.json, 시드 아님) */
  feedDir: 'server/product-feed',
});
// ── 362 N12: 피드 상수 — 원본은 server/src/engine/providers.ts FEED_LINK_RE·FEED_IMAGE_HOSTS(시험이 원문 대조).
export const FEED_LINK_RES = Object.freeze({
  COUPANG: /^https:\/\/link\.coupang\.com\/a\/[A-Za-z0-9]{4,32}$/,
  ALIEXPRESS: /^https:\/\/s\.click\.aliexpress\.com\/e\/_[A-Za-z0-9_-]{4,64}$/,
});
export const FEED_IMG_HOSTS = Object.freeze({ COUPANG: Object.freeze([]), ALIEXPRESS: Object.freeze(['ae01.alicdn.com']) });
export const FEED_FILES = Object.freeze({ 'coupang.json': 'COUPANG', 'aliexpress.json': 'ALIEXPRESS' });
// 380 S3: 「많이 찾는 상품」을 쓸 수 있는 인기순 확인 sort — 원본 server/src/engine/feed-types.ts FEED_POPULAR_SORTS(시험 대조). 지금 비어 있다.
export const FEED_POPULAR_SORTS = Object.freeze({ COUPANG: Object.freeze([]), ALIEXPRESS: Object.freeze([]) });
const FEED_POPULAR_TITLE = '많이 찾는 상품';
const hasPopularSort = (allow) => Object.values(allow).some((v) => v.length > 0);
// 373 D2: 제목 안 가격·날짜 — 원본 server/src/engine/feed-types.ts FEED_TITLE_PRICE_DATE(source·flags 시험 대조). 산출물에 남으면 FAIL.
export const FEED_TITLE_PRICE_DATE =
  /\p{Sc}|\\\s*\d|\d\s*\\|(?<![a-z])(?:krw|usd|eur|jpy|cny|rmb|gbp)(?![a-z])|(?<![a-z])won\s*\d|\d\s*(?:달러|위안|유로|[円元圆])|\d\s*(?:won|엔|불)(?![a-z가-힣])|\d\s*(?:[십백천만억]\s*)+원|\d[\d,.]*\d\s*원|(?<![\d,.])\d\s*원(?!형|목|통|단|색|터치|피스)|(?<![가-힣])[일이삼사오육칠팔구]?(?:[십백천만억][일이삼사오육칠팔구]?)+\s*원(?!형|목|통|단|색|터치|피스)|\d{4}\s*년|\d{2}\s*년\s*[형식]|\d\s*월|(?<![\d.])(?:\d{4}|\d{2})\s*[-./]\s*(?:0?[1-9]|1[0-2])\s*[-./]\s*(?:0?[1-9]|[12]\d|3[01])(?!\d|\.\d|\s*(?:cm|mm|m|kg|g|인치|in)(?![a-z]))|(?<![\d.,/-])\d{1,2}\s*[./-]\s*\d{1,2}(?![\d.,/-])\s*(?:일\s*)?(?:\(\s*[월화수목금토일](?:요일)?\s*\)\s*)?~?\s*(?:입고|입하|출고|발송|도착|기준|까지|특가|세일|마감|한정|행사|sale)|(?:입고|입하|출고|발송|도착|기준|까지|특가|세일|마감|한정|행사|sale)\s*[:~]?\s*\d{1,2}\s*[./-]\s*\d{1,2}(?![\d.,/-])|(?<!\d)\d{1,2}\s*일\s*(?:\(\s*[월화수목금토일](?:요일)?\s*\)\s*)?(?:입고|입하|출고|발송|도착|기준|까지|특가|세일|마감|한정|행사)|(?<![a-z])(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])\.?\s*\d{1,2}(?!\d)|(?<!\d)\d{1,2}\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])/iu;
const FEED_DI_RE = /\p{Default_Ignorable_Code_Point}/gu;
/** feed-types.ts feedTitleHasPriceOrDate 와 같은 정규화(기본 무시 문자 제거 → NFKC → 다시 제거 → 공백 하나). */
export const feedTitleHasPriceOrDate = (t) =>
  FEED_TITLE_PRICE_DATE.test(String(t).replace(FEED_DI_RE, '').normalize('NFKC').replace(/\p{M}/gu, '').replace(FEED_DI_RE, '').replace(/\s+/g, ' '));
const isFeedPath = (rel) => lc(rel) === lc(AFF_PATHS.feedDir) || lc(rel).startsWith(`${lc(AFF_PATHS.feedDir)}/`);
const isFeedModule = (rel) => lc(rel) === lc(AFF_PATHS.productFeedLoader) || isFeedPath(rel);
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
// 362 N12(353 §4 C10-AFF-IMPORT): 피드 로더·피드 파일도 제휴 모듈 집합.
const isAffOrMap = (rel) => isAffTarget(rel) || isMapPath(rel) || isFeedModule(rel);
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
const HOST_ALLOWED = (rel) => rel === AFF_PATHS.providers || isTestFile(rel) || (isMapPath(rel) && rel.endsWith('.json')) || (isFeedPath(rel) && rel.endsWith('.json')) || rel === SELF;

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
        // 362 N12(353 §4): 피드 로더·피드 파일은 FAIL(런타임이 가격을 읽을 길 차단) — 맵은 종전대로 WARN.
        if (res.kind === 'file' && isFeedModule(res.rel)) {
          const key = `${from}|${res.rel}`;
          if (!reported.has(key)) {
            reported.add(key);
            add('C10-AFF-RUNTIME', 'FAIL', from, e.line, `서버 런타임·메일 폐포가 상품 피드 로더·피드 파일에 닿음: ${chain(parent, from, res.rel)} — 피드는 빌드 타임만(353 §4, 가격 런타임 경로 0)`);
          }
          return true;
        }
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
const SOURCE_DIRS = ['client/src', 'client/build', 'server/src', 'server/prisma', 'server/seed', 'scripts', 'e2e', AFF_PATHS.mapDir, AFF_PATHS.feedDir];
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
      // 362 N12(353 §4 C2-PRICE 확장): 가격류 키는 피드 파일 rows[].price·ws-data data.feed 에만 — 시드 = FAIL.
      if (PRICE_KEYS.has(k) && !seen.has(`price|${k}`)) {
        seen.add(`price|${k}`);
        add('C2-PRICE', 'FAIL', rel, null, `시드에 가격류 키 ${L(k)}(${L(p.slice(0, 60))}) — 가격은 상품 피드 파일에만(353 §4)`);
      }
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

// ── 362 N12: 상품 피드 파일(C11-FEED·C10-AFF-FIELD) — 서버 로더(product-feed.ts)와 같은 형식을 스캐너가 따로 잠근다 ──────
const PRICE_KEYS = new Set(['price', 'amount', 'currency']);
const FEED_TOP_KEYS = ['v', 'provider', 'source', 'api', 'terms', 'generatedAt', 'rows'];
const FEED_ROW_KEYS = ['animalTypeId', 'supplyItemId', 'keyword', 'rank', 'title', 'url', 'imageUrl', 'price', 'fetchedAt'];
const FEED_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const exactKeySet = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
/** https 이미지 URL 의 호스트가 공급자 허용 목록에 정확히 있는가(사용자 정보·포트·IP·대소문자 우회 0). */
export function feedImageOk(provider, url) {
  if (typeof url !== 'string' || !/^https:\/\/[a-z0-9.-]+\/[^\s"'<>\\]*$/.test(url)) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.port === '' && u.username === '' && (FEED_IMG_HOSTS[provider] ?? []).includes(u.hostname);
}

function checkFeedFiles(root, add, bw) {
  const dir = join(root, ...AFF_PATHS.feedDir.split('/'));
  if (!isDir(dir)) return;
  for (const abs of walk(dir)) {
    const rel = relPosix(root, abs);
    const name = rel.slice(AFF_PATHS.feedDir.length + 1);
    const fail = (line, msg) => add('C11-FEED', 'FAIL', rel, line, msg);
    if (!Object.hasOwn(FEED_FILES, name)) {
      fail(null, `피드 디렉터리에는 ${Object.keys(FEED_FILES).join('·')} 만(하위 폴더·다른 파일 0)`);
      continue;
    }
    const provider = FEED_FILES[name];
    let doc;
    try {
      doc = JSON.parse(stripBom(readFileSync(abs, 'utf8')));
    } catch {
      fail(null, `피드 JSON 파싱 실패(${jsonErrorWhere(readFileSync(abs, 'utf8'))})`);
      continue;
    }
    // C10-AFF-FIELD — 피드에도 수수료류·제휴 키 0(353 §4)
    const seen = new Set();
    walkKeys(doc, '', (k, p) => {
      if (FORBIDDEN_JSON_KEYS.has(k)) fail(null, `금지 키 ${L(k)}`);
      if ((feeName(k) || /수수료|affiliate|^sub[_-]?id$/i.test(k)) && !seen.has(k)) {
        seen.add(k);
        add('C10-AFF-FIELD', 'FAIL', rel, null, `피드에 제휴·수수료 키 ${L(k)}(${L(p.slice(0, 60))}) — 수수료 데이터는 시스템에 자리 없음(불변식 ③④)`);
      }
    });
    if (!exactKeySet(doc, FEED_TOP_KEYS)) {
      fail(null, `최상위 키는 ${FEED_TOP_KEYS.join('·')} 만`);
      continue;
    }
    if (doc.v !== 1) fail(null, 'v 는 1');
    if (doc.provider !== provider) fail(null, `provider 가 파일 이름과 다르다(${L(String(doc.provider))} ≠ ${provider})`);
    if (doc.generatedAt !== null && !(typeof doc.generatedAt === 'string' && FEED_INSTANT_RE.test(doc.generatedAt))) fail(null, 'generatedAt 은 null 또는 ISO 시각(초·오프셋)');
    if (!Array.isArray(doc.rows)) {
      fail(null, 'rows 배열 아님');
      continue;
    }
    if (doc.rows.length > 0 && doc.generatedAt === null) fail(null, 'rows 가 있는데 generatedAt null');
    doc.rows.forEach((r, i) => {
      const at = `rows[${i}]`;
      if (!exactKeySet(r, FEED_ROW_KEYS)) return fail(null, `${at} 키는 ${FEED_ROW_KEYS.join('·')} 만`);
      if (typeof r.url !== 'string' || !FEED_LINK_RES[provider].test(r.url)) fail(null, `${at}.url 이 ${provider} 상품 링크 형태가 아니다`);
      if (r.imageUrl !== null && !feedImageOk(provider, r.imageUrl)) fail(null, `${at}.imageUrl 호스트가 FEED_IMAGE_HOSTS.${provider} 밖(핫링크 허용 목록 정확 일치)`);
      if (!(typeof r.fetchedAt === 'string' && FEED_INSTANT_RE.test(r.fetchedAt))) fail(null, `${at}.fetchedAt 은 ISO 시각(초·오프셋)`);
      if (r.price !== null && !(exactKeySet(r.price, ['amount', 'currency']) && r.price.currency === 'KRW' && Number.isInteger(r.price.amount) && r.price.amount > 0)) fail(null, `${at}.price 는 null 또는 {amount 양의 정수, currency KRW}`);
      if (typeof r.title !== 'string') fail(null, `${at}.title 문자열 아님`);
      else if (bw) for (const h of lintText(r.title, bw)) fail(null, `${at}.title 금지어 ${L(h.term)}`);
    });
  }
}

/** 소스 쪽 C10-AFF 전체(+ 362 N12 C11-FEED). bw(금지어 표)는 피드 제목 린트용 — 없으면 제목 린트만 건너뛴다. */
export function scanAffiliateSources(root, add, bw = null) {
  checkImportIsolation(root, add);
  checkSourceText(root, add);
  checkSeedFields(root, add);
  checkMapFiles(root, add);
  checkFeedFiles(root, add, bw);
}

// ── 산출물(C10-AFF-OUT) ───────────────────────────────────────
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// C11 :empty: RAWTEXT / script data / RCDATA에서는 <!-- -->도 텍스트다.
const TEXT_BODY = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext', 'textarea', 'title', 'noscript']);
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
    const rawAttrs = raw.replace(/\/\s*$/, '');
    els.push({ name, attrs: parseAttrs(rawAttrs), dupAttrs: dupAttrNames(rawAttrs), start: m.index, openEnd: m.index + m[0].length, end: null, parent: stack.length ? stack[stack.length - 1] : -1 });
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
// C11만 CSS escape를 복원한다. 문자열 내용은 토큰이 아니므로 그대로 보존한다.
function feedCssUnescape(src) {
  let value = '';
  let invalid = false;
  let quote = '';
  // escape된 구분자가 var() 문법으로 바뀌지 않도록 동일한 6자리 escape로 정규화한다.
  // 정의/참조 양쪽이 같은 표현을 사용하므로 --x\, 같은 이름도 정확히 대조된다.
  const decodedChar = (cp) => {
    const c = String.fromCodePoint(cp);
    return /[\s\\"'()[\]{},;:/]/.test(c) ? `\\${cp.toString(16).padStart(6, '0')}` : c;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      value += c;
      if (c === '\\' && i + 1 < src.length) value += src[++i];
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") { quote = c; value += c; continue; }
    if (c !== '\\') { value += c; continue; }
    const hex = /^[\da-f]{1,6}/i.exec(src.slice(i + 1, i + 7));
    if (hex) {
      const cp = parseInt(hex[0], 16);
      const invalidCodePoint = cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff);
      invalid ||= invalidCodePoint;
      value += invalidCodePoint ? '\ufffd' : decodedChar(cp);
      i += hex[0].length;
      if (/[\t\n\f\r ]/.test(src[i + 1] ?? '')) {
        if (src[i + 1] === '\r' && src[i + 2] === '\n') i++;
        i++;
      }
    } else if (i + 1 === src.length || /[\n\r\f]/.test(src[i + 1])) {
      invalid = true;
    } else {
      const cp = src.codePointAt(++i);
      value += decodedChar(cp);
      if (cp > 0xffff) i++;
    }
  }
  return { value, invalid };
}
// 403: C11 전용 파서. 사용자 속성 이름/참조의 대소문자와 문자열 안의 구분자를 보존한다.
function feedStyleDecls(style) {
  const src = stripCssComments(style);
  const out = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let i = 0; i <= src.length; i++) {
    const c = src[i];
    if (i < src.length) {
      if (c === '\\' && i + 1 < src.length) { i++; continue; }
      if (quote) { if (c === quote || /[\n\r\f]/.test(c)) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    }
    if (i !== src.length && (c !== ';' || depth !== 0)) continue;
    const part = src.slice(start, i);
    let colon = 0;
    for (; colon < part.length; colon++) {
      if (part[colon] === '\\') { colon++; continue; }
      if (part[colon] === ':') break;
    }
    start = i + 1;
    if (colon === part.length) continue;
    const name = feedCssUnescape(part.slice(0, colon));
    const decoded = feedCssUnescape(part.slice(colon + 1).trim());
    // escape된 공백은 정규화된 토큰으로 보존한 뒤 문법상 바깥 공백만 제거한다.
    const prop = name.value.trim();
    out.push([prop.startsWith('--') ? prop : prop.toLowerCase(), decoded.value.replace(/!\s*important\s*$/i, '').trim(), name.invalid || decoded.invalid]);
  }
  return out;
}

// MED 4 방침: 캐스케이드·범위와 fallback 사용 여부를 따지지 않고 모든 정의·대체값을 보수적으로 합친다.
// 후보 곱은 64개, 값 길이는 8192자, 깊이는 128, 한 값의 해석 작업은 8192회로 제한.
// 상한 초과는 관련 숨김 속성에서만 판정 불가 FAIL. 미선언/순환 var 자체는 숨김으로 취급하지 않는다.
function feedVarResolver(cssTexts, sink) {
  const definitions = new Map();
  const invalidDefinitions = new Set();
  const collect = (body) => {
    for (const [prop, value, invalid] of feedStyleDecls(body)) {
      if (!prop.startsWith('--')) continue;
      if (invalid) invalidDefinitions.add(prop);
      if (!definitions.has(prop)) definitions.set(prop, new Set());
      definitions.get(prop).add(value);
    }
  };
  for (const css of cssTexts) {
    const src = blankNonElementAtRules(stripCssComments(css));
    for (const chunk of src.split('}')) {
      const ob = chunk.lastIndexOf('{');
      if (ob >= 0) collect(chunk.slice(ob + 1));
    }
  }
  for (const s of sink?.feedInlineStyles ?? []) collect(s.style);
  // 외부 호출자가 만든 기존 sink 형식도 지원한다.
  const visited = new Set();
  for (const title of sink?.feedTitles?.values() ?? []) {
    for (let e = title.element; e && !visited.has(e); e = e.parent) {
      visited.add(e);
      collect(e.attrs.style ?? '');
    }
  }
  const memo = new Map();
  const results = new Map();
  const unknown = 'var(--unresolved)';
  return (value) => {
    if (results.has(value)) return results.get(value);
    let work = 8192;
    const active = new Set();
    const result = (values = [], limited = false, cyclic = false) => ({ values: new Set(values), limited, cyclic });
    const add = (to, from) => {
      to.limited ||= from.limited;
      to.cyclic ||= from.cyclic;
      for (const v of from.values) {
        if (v.length > 8192 || (!to.values.has(v) && to.values.size >= 64)) { to.limited = true; break; }
        to.values.add(v);
      }
    };
    const variable = (name, depth) => {
      if (invalidDefinitions.has(name)) return result([], true);
      if (active.has(name)) return result([unknown], false, true);
      if (memo.has(name)) return memo.get(name);
      if (depth > 128 || --work < 0) return result([], true);
      active.add(name);
      const out = result();
      for (const v of definitions.get(name) ?? []) {
        add(out, expand(v, depth + 1));
        if (out.limited) break;
      }
      active.delete(name);
      if (out.values.size === 0 && !out.limited) out.values.add(unknown);
      // 순환을 끊은 중간 결과는 다른 시작점에서 재사용하지 않는다.
      if (!out.cyclic && !out.limited) memo.set(name, out);
      return out;
    };
    const expand = (text, depth) => {
      if (depth > 128 || --work < 0 || text.length > 8192) return result([], true);
      let out = result(['']);
      let start = 0;
      let quote = '';
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (quote) { if (text[i] === quote) quote = ''; continue; }
        if (text[i] === '"' || text[i] === "'") { quote = text[i]; continue; }
        if (text.slice(i, i + 4).toLowerCase() !== 'var(' || (i > 0 && /[\w-]/.test(text[i - 1]))) continue;
        let level = 1;
        let comma = -1;
        let end = i + 4;
        let innerQuote = '';
        for (; end < text.length; end++) {
          const c = text[end];
          if (c === '\\') { end++; continue; }
          if (innerQuote) { if (c === innerQuote) innerQuote = ''; continue; }
          if (c === '"' || c === "'") { innerQuote = c; continue; }
          if (c === '(') level++;
          if (c === ')' && --level === 0) break;
          if (c === ',' && level === 1 && comma < 0) comma = end;
        }
        if (end === text.length) break;
        const name = text.slice(i + 4, comma < 0 ? end : comma).trim();
        const choices = result();
        add(choices, variable(name, depth + 1));
        // 정적 검사에서는 선언 후보와 대체값 모두 숨김 가능성에 포함한다.
        if (comma >= 0) {
          choices.values.delete(unknown);
          add(choices, expand(text.slice(comma + 1, end).trim(), depth + 1));
        }
        const next = result([], out.limited || choices.limited, out.cyclic || choices.cyclic);
        for (const prefix of out.values) {
          for (const choice of choices.values) {
            if (--work < 0) { next.limited = true; break; }
            add(next, result([prefix + text.slice(start, i) + choice]));
            if (next.limited) break;
          }
          if (next.limited) break;
        }
        out = next;
        start = end + 1;
        i = end;
        if (out.limited) return out;
      }
      const completed = result([], out.limited, out.cyclic);
      for (const prefix of out.values) add(completed, result([prefix + text.slice(start)]));
      return completed;
    };
    const out = expand(value, 0);
    results.set(value, out);
    return out;
  };
}

const FEED_ZERO_RE = /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?(?:[a-z%]+)?$/i;
const FEED_FONT_SIZE_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:%|px|cm|mm|q|in|pt|pc|r?(?:em|ex|cap|ch|ic|lh)|[sld]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))$/i;
function feedFontTokens(value) {
  const tokens = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let i = 0; i <= value.length; i++) {
    const c = value[i];
    if (i < value.length) {
      if (c === '\\') { i++; continue; }
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '(') depth++;
      if (c === ')') depth = Math.max(0, depth - 1);
    }
    if (i !== value.length && (depth !== 0 || (!/\s/.test(c) && c !== '/'))) continue;
    if (i > start) tokens.push(value.slice(start, i));
    if (c === '/') tokens.push(c);
    start = i + 1;
  }
  return tokens;
}
function feedCalcZero(token) {
  // 일반 함수의 계산은 하지 않는다. 단일 0 리터럴의 calc만 확정할 수 있다.
  const literal = /^calc\(\s*([^()]*)\)$/.exec(token)?.[1].trim();
  return literal !== undefined && FEED_ZERO_RE.test(literal);
}
function feedFontZero(value) {
  // 첫 크기 토큰까지만 본다. 굵기 700과 글꼴 이름 속 숫자는 크기가 아니다.
  // 중첩 함수 안의 공백·슬래시는 크기/줄높이 구분자가 아니다.
  const tokens = feedFontTokens(value);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const zeroNumber = /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?$/i.test(t);
    const length = FEED_FONT_SIZE_RE.test(t);
    // 각도·단위 없는 굵기 함수는 크기가 아니다. 내부 길이·백분율·크기 낱말만 후보로 삼는다.
    const fn = /^[a-z-][\w-]*\(/i.test(t)
      && (t.slice(t.indexOf('(') + 1).match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:[a-z]+|%)?|[a-z-][\w-]*/gi) ?? [])
        .some((part) => FEED_FONT_SIZE_RE.test(part)
          || Object.hasOwn(FONT_KEYWORD_PX, part) || /^(?:smaller|larger|math)$/.test(part));
    const size = length || zeroNumber || fn
      || Object.hasOwn(FONT_KEYWORD_PX, t) || /^(?:smaller|larger|math)$/.test(t);
    if (size) {
      const lineHeight = tokens[i + 2] ?? '';
      return zeroNumber || (length && parseFloat(t) === 0) || (fn && feedCalcZero(t))
        || (tokens[i + 1] === '/' && (FEED_ZERO_RE.test(lineHeight) || feedCalcZero(lineHeight)));
    }
  }
  return false;
}
const FEED_HIDE_PROP_RE = /^(?:display|visibility|opacity|white-space|text-wrap(?:-mode)?|(?:-webkit-)?line-clamp|text-overflow|font(?:-size)?|line-height|(?:max-)?(?:height|width|inline-size|block-size)|clip(?:-path)?|zoom|scale|transform|translate|(?:-webkit-text-fill-)?color|text-indent|left|top|right|bottom|margin-left|margin-top|content-visibility)$/;
/** 400/403: 피드 제목 전용. 고지/버튼의 HIDE_STYLE_RE·styleShrink 판정은 그대로 둔다. */
function hidesFeedTitle(body, resolveValue) {
  // 교체 전 styleDecls 경로도 유지: 불균형 괄호/따옴표가 뒤의 리터럴 숨김 선언을 삼켜도 검출한다.
  // var 의존 판정은 새 경로가 담당한다(정상 line-clamp:var(--lines) 등을 재차 오탐하지 않는다).
  const literalHidden = (prop, value) => {
    if (prop === 'line-clamp' || prop === '-webkit-line-clamp') {
      return !(value === 'none' || (/^\+?\d+$/.test(value) && Number(value) >= 2));
    }
    if (HIDE_STYLE_RE.test(`${prop}:${value}`)) return true;
    if (/^(?:font-size|line-height|opacity|zoom|scale|(?:max-)?(?:width|height|inline-size|block-size))$/.test(prop)
      && FEED_ZERO_RE.test(value)) return true;
    if ((prop === 'color' || prop === '-webkit-text-fill-color')
      && (value === 'transparent' || ALPHA0_RE.test(normColor(value)))) return true;
    return (prop === 'transform' || prop === 'translate')
      && /(?:^|[\s,(])(?:-\d{3,}(?:\.\d+)?(?:px|%|vw|vh)|[+-]?\d{4,}(?:\.\d+)?px)\b/i.test(value);
  };
  const declarations = feedStyleDecls(body);
  const resolvedDeclarations = new Set(declarations.map(([prop, raw]) => JSON.stringify([prop.toLowerCase(), raw.toLowerCase()])));
  if (styleDecls(body).some(([prop, raw]) => {
    if (prop.startsWith('--')) return false;
    const decoded = feedCssUnescape(raw ?? '').value;
    // 새 파서도 읽은 var 선언만 위임한다. 파서가 삼킨 선언은 교체 전 판정을 그대로 보존한다.
    if (/var\(/i.test(decoded) && resolvedDeclarations.has(JSON.stringify([prop, decoded.toLowerCase()]))) return false;
    return literalHidden(prop, raw ?? '');
  })) return true;
  return declarations.some(([prop, raw, invalid]) => {
    if (prop.startsWith('--')) return false;
    const resolved = resolveValue(raw);
    if (invalid || resolved.limited) return FEED_HIDE_PROP_RE.test(prop)
      || FEED_HIDE_PROP_RE.test(prop.replace(/^-(?:webkit|moz|ms|o)-/, ''))
      || HIDE_STYLE_RE.test(`${prop}:${raw}`);
    return [...resolved.values].some((candidate) => {
      const value = candidate.toLowerCase().trim();
      return literalHidden(prop, value) || (prop === 'font' && feedFontZero(value));
    });
  });
}
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
/**
 * 감사 L-3(281): 인라인 style 의 「작은 글자·같은 색·축소」 — HIDE_STYLE_RE(0·숨김) 밖의 축소. 고지 A·B·F 조상 사슬에 적용.
 *   선언 단위(';' → ':')로 쪼개 선형. 해석 못 하는 값(var·calc·escape·알 수 없는 단위)은 fail-closed 로 축소 취급.
 *   글자 크기는 조상 사슬을 따라 누적(em·%·smaller 는 부모 값 기준, 루트 16px) — 10px 미만이면 FAIL(0.6rem = 9.6px 도 미만).
 */
const NOTE_MIN_PX = 10;
const ROOT_PX = 16;
const FONT_KEYWORD_PX = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };
const FONT_SYSTEM = new Set(['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar']);
/** CSS 주석 제거(indexOf 기반 선형 — 닫히지 않은 주석은 끝까지). */
function stripCssComments(s) {
  let out = '';
  let i = 0;
  for (;;) {
    const a = s.indexOf('/*', i);
    if (a < 0) return out + s.slice(i);
    out += `${s.slice(i, a)} `;
    const b = s.indexOf('*/', a + 2);
    if (b < 0) return out;
    i = b + 2;
  }
}
/** 인라인 style → [[prop, value]](소문자·!important 제거). */
function styleDecls(style) {
  const out = [];
  for (const part of stripCssComments(style).split(';')) {
    const c = part.indexOf(':');
    if (c < 0) {
      if (part.trim() !== '') out.push([part.trim().toLowerCase(), null]);
      continue;
    }
    out.push([part.slice(0, c).trim().toLowerCase(), part.slice(c + 1).replace(/!\s*important\s*$/i, '').trim().toLowerCase()]);
  }
  return out;
}
/** 글자 크기 값 → 실효 px(부모 px 기준). 해석 불가면 NaN(fail-closed). */
function fontSizePx(v, parentPx) {
  if (Object.hasOwn(FONT_KEYWORD_PX, v)) return FONT_KEYWORD_PX[v];
  if (v === 'smaller') return parentPx / 1.2;
  if (v === 'larger') return parentPx * 1.2;
  if (v === 'inherit' || v === 'unset' || v === 'revert' || v === 'revert-layer') return parentPx;
  if (v === 'initial') return ROOT_PX;
  const m = /^(\d+(?:\.\d*)?|\.\d+)(px|pt|pc|rem|em|%|in|cm|mm|q)?$/.exec(v);
  if (!m) return NaN; // var()·calc()·clamp()·vw 등 — 판정 불가
  const n = Number(m[1]);
  switch (m[2]) {
    case undefined: return n === 0 ? 0 : NaN;
    case 'px': return n;
    case 'pt': return (n * 4) / 3;
    case 'pc': return n * 16;
    case 'rem': return n * ROOT_PX;
    case 'em': return n * parentPx;
    case '%': return (n / 100) * parentPx;
    case 'in': return n * 96;
    case 'cm': return (n * 96) / 2.54;
    case 'mm': return (n * 96) / 25.4;
    case 'q': return (n * 96) / 101.6;
    default: return NaN;
  }
}
/** font 단축 속성에서 크기 토큰(첫 크기 꼴, '/줄높이' 앞). 없거나 시스템 글꼴이면 NaN. */
function fontShorthandPx(v, parentPx) {
  if (FONT_SYSTEM.has(v) || /var\(|calc\(|env\(|attr\(/.test(v)) return NaN;
  if (v === 'inherit' || v === 'initial' || v === 'unset' || v === 'revert' || v === 'revert-layer') return fontSizePx(v, parentPx);
  // 크기 토큰 = 크기 낱말(xx-small…·smaller·larger) 또는 단위 있는 수(단위 없는 수는 굵기 700 등이라 건너뜀)
  for (const tok of v.split(/\s+/)) {
    const size = tok.split('/')[0];
    if (Object.hasOwn(FONT_KEYWORD_PX, size) || size === 'smaller' || size === 'larger' || /^(?:\d+(?:\.\d*)?|\.\d+)[a-z%]+$/.test(size)) return fontSizePx(size, parentPx);
  }
  return NaN;
}
const ALPHA0_RE = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*[,/]\s*(?:0+(?:\.0*)?|\.0+)%?\s*\)$|^#[0-9a-f]{3}0$|^#[0-9a-f]{6}00$/;
const normColor = (v) => v.replace(/\s+/g, '');
/**
 * 요소 하나의 인라인 style 축소 판정 — { why|null, px }(px = 이 요소의 실효 글자 크기).
 *   why: 사람이 읽는 이유(FAIL 메시지 조각). parentPx 는 부모 실효 px.
 */
export function styleShrink(style, parentPx) {
  let px = parentPx;
  if (style === undefined) return { why: null, px };
  if (style.includes('\\')) return { why: '이스케이프(판정 불가)', px };
  let why = null;
  const note = (w) => {
    if (why === null) why = w;
  };
  let color = null;
  let bg = null;
  let overflowCut = false;
  let boxSize = false;
  for (const [p, v] of styleDecls(style)) {
    if (v === null) {
      note(`선언 ${L(p.slice(0, 30))} 판정 불가`);
      continue;
    }
    if (p === 'font-size' || p === 'font') {
      const n = p === 'font' ? fontShorthandPx(v, px) : fontSizePx(v, px);
      if (Number.isNaN(n)) note(`${p}:${L(v.slice(0, 30))} 판정 불가`);
      else {
        px = n;
        if (n < NOTE_MIN_PX) note(`${p}:${L(v.slice(0, 30))} → ${n.toFixed(1)}px < ${NOTE_MIN_PX}px`);
      }
    } else if (p === 'zoom' || p === 'scale') {
      if (v === 'normal' || v === 'reset' || v === 'none' || v === 'inherit' || v === 'initial' || v === 'unset') continue;
      const nums = v.split(/[\s,]+/).filter(Boolean);
      for (const t of nums) {
        const m = /^(\d+(?:\.\d*)?|\.\d+)(%)?$/.exec(t);
        if (!m) note(`${p}:${L(v.slice(0, 30))} 판정 불가`);
        else if ((m[2] ? Number(m[1]) / 100 : Number(m[1])) < 0.6) note(`${p}:${L(v.slice(0, 30))} 축소`);
      }
    } else if (p === 'transform') {
      if (v === 'none') continue;
      if (/var\(|calc\(|matrix|perspective|env\(|attr\(/.test(v)) note(`transform:${L(v.slice(0, 30))} 판정 불가`);
      // qa MED: 정규식 /scale…\(([^)]*)\)/g 는 닫히지 않은 'scale(' 반복에서 매 위치마다 끝까지 훑어 제곱 — indexOf 로 한 번씩만 전진(선형).
      //   닫는 ')' 가 없으면 그 뒤 어떤 scale( 도 닫히지 않으므로 판정 불가로 한 번 적고 멈춘다(CSS 는 끝에서 자동으로 닫아 적용될 수 있다 → fail-closed).
      for (let at = v.indexOf('scale'); at >= 0; ) {
        let q = at + 5;
        const suf = v.startsWith('3d', q) ? 2 : 'xyz'.includes(v[q] ?? '-') ? 1 : 0;
        q += suf;
        if (v[q] !== '(') {
          at = v.indexOf('scale', at + 1);
          continue;
        }
        const close = v.indexOf(')', q + 1);
        if (close < 0) {
          note(`transform:${L(v.slice(0, 30))} 판정 불가`);
          break;
        }
        const args = v.slice(q + 1, close);
        at = v.indexOf('scale', close + 1);
        for (const t of args.split(/[\s,]+/).filter(Boolean)) {
          const m = /^-?(\d+(?:\.\d*)?|\.\d+)(%)?$/.exec(t);
          if (!m) note(`transform:${L(v.slice(0, 30))} 판정 불가`);
          else if ((m[2] ? Number(m[1]) / 100 : Number(m[1])) < 0.6) note(`transform:${L(v.slice(0, 30))} 축소`);
        }
      }
    } else if (p === 'color') color = v;
    else if (p === 'background-color' || p === 'background') bg = v;
    else if (p === '-webkit-text-fill-color' || p === '-webkit-text-stroke-color' || p === 'mix-blend-mode' || p === 'filter') note(`${p} 판정 불가(글자 색 위장 통로)`);
    else if (/^overflow(?:-[xy]|-inline|-block)?$/.test(p) && /hidden|clip|scroll|auto/.test(v)) overflowCut = true;
    else if (/^(?:max-)?(?:height|width|block-size|inline-size)$/.test(p) || p === 'line-height') boxSize = true;
  }
  if (color !== null) {
    if (ALPHA0_RE.test(normColor(color))) note(`color:${L(color.slice(0, 30))} 투명`);
    else if (bg !== null && (/var\(|calc\(|currentcolor|inherit|unset|revert|initial/.test(color) || /var\(|calc\(|gradient|url\(|currentcolor/.test(bg))) note(`color:${L(color.slice(0, 30))} 와 배경 비교 판정 불가`);
    else if (bg !== null && (normColor(bg) === normColor(color) || bg.split(/\s+/).includes(color))) note(`color 가 배경과 같다(${L(color.slice(0, 30))})`);
  }
  if (overflowCut && boxSize) note('overflow 잘림 + 크기 지정(글자 일부 숨김 통로)');
  return { why, px };
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
 *   sink(선택) 에 고지·피드 제목 사슬(CSS 숨김 검사)·제휴/상인 a 사슬(CSS 버튼 동등 검사)·인라인 <style> 을 모은다.
 */
export function checkHtmlAff(html, rel, dev, add, sink = null) {
  const fail = (line, msg) => add('C10-AFF-OUT', 'FAIL', rel, line, msg);
  const lineOf = lineIndex(html);
  // ws-data
  let pageCodes = null;
  let wsFeed = null; // 362 N12: ws-data data.feed(있으면)
  let wsTypeId = null;
  for (const s of scripts(html)) {
    if (s.attrs.id !== 'ws-data') continue;
    let d;
    try {
      d = JSON.parse(s.body);
    } catch {
      continue; // C8-OUT-SAFE 가 FAIL
    }
    pageCodes = checkWsAff(d, rel, lineOf(s.index), dev, add);
    if (isObj(d) && isObj(d.route) && typeof d.route.typeId === 'string') wsTypeId = d.route.typeId;
    if (isObj(d) && isObj(d.data) && isObj(d.data.feed)) wsFeed = d.data.feed;
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
  // L-3: 인라인 style 축소(작은 글자·같은 색·축소) — 자신 또는 가장 가까운 조상의 이유, 실효 글자 px 누적(부모 인덱스 < 자식이라 한 번에 선형)
  const fontPx = new Float64Array(n);
  const shrinkUp = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const e = els[i];
    const p = e.parent;
    // qa HIGH: 속성 중복 — 파서(마지막 값)와 브라우저(첫 값)가 갈린다(style·class·aria-hidden·hidden·title 등으로 숨김·축소 위장). 정상 산출물엔 0 → fail-closed.
    if (e.dupAttrs.length > 0) fail(lineOf(e.start), `<${e.name}> 속성 중복(${e.dupAttrs.map((k) => L(k.slice(0, 30))).join('·')}) — 브라우저는 첫 값을 쓴다, 숨김·축소 판정 우회 통로라 금지(fail-closed)`);
    if (p >= 0) {
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(i);
      upSearch[i] = isSearch(els[p]) ? p : upSearch[p];
      upAside[i] = isLayer(els[p]) ? p : upAside[p];
    }
    hiddenUp[i] = hiddenEl(e) || (p >= 0 && hiddenUp[p] === 1) ? 1 : 0;
    const sh = styleShrink(e.attrs.style, p >= 0 ? fontPx[p] : ROOT_PX);
    fontPx[i] = sh.px;
    shrinkUp[i] = sh.why !== null ? `<${e.name}> ${sh.why}` : p >= 0 ? shrinkUp[p] : null;
    if (e.attrs.id !== undefined && !byId.has(e.attrs.id)) byId.set(e.attrs.id, i);
  }
  // 362 N12: 피드 컨테이너(section[data-ws-part=feed] · li.ws-feed-card)·가장 가까운 section·li 색인(선형).
  const isFeedBox = (e) => (e.name === 'section' && e.attrs['data-ws-part'] === 'feed') || (e.name === 'li' && classesOf(e).includes('ws-feed-card'));
  const feedUp = new Int32Array(n).fill(-1);
  const upSection = new Int32Array(n).fill(-1);
  const upLi = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const p = els[i].parent;
    if (isFeedBox(els[i])) feedUp[i] = i;
    else if (p >= 0) feedUp[i] = feedUp[p];
    if (p >= 0) {
      upSection[i] = els[p].name === 'section' ? p : upSection[p];
      upLi[i] = els[p].name === 'li' ? p : upLi[p];
    }
  }
  const isAncestor = (anc, i) => {
    for (let p = els[i].parent; p >= 0; p = els[p].parent) if (p === anc) return true;
    return false;
  };
  const kids = (i) => children.get(i) ?? [];
  const chainOf = (i) => {
    const out = [];
    for (let p = i; p >= 0; p = els[p].parent) out.push(descOf(els[p]));
    return out;
  };
  const feedInlineByElement = new Map();
  if (sink) {
    sink.feedTitles ??= new Map();
    // C11 전용 문맥: 부모/직전 요소 형제를 공유한다. 텍스트·주석은 형제가 아니다.
    // C10의 기존 chain과 매처는 그대로 유지한다.
    const nodes = [];
    const lastChild = new Map();
    for (let i = 0; i < n; i++) {
      const e = els[i];
      nodes.push({ ...descOf(e), parent: nodes[e.parent] ?? null,
        previous: lastChild.get(e.parent) ?? null,
        empty: !children.has(i) && (TEXT_BODY.has(e.name)
          ? html.slice(e.openEnd, e.end)
          : html.slice(e.openEnd, e.end).replace(/<!--[\s\S]*?-->/g, '')) === '',
      });
      lastChild.set(e.parent, nodes[i]);
    }
    sink.feedInlineStyles ??= [];
    for (let i = 0; i < n; i++) {
      if (els[i].attrs.style !== undefined) {
        const inline = { style: els[i].attrs.style, element: nodes[i], rel, line: lineOf(els[i].start), structureReported: false };
        sink.feedInlineStyles.push(inline);
        feedInlineByElement.set(els[i], inline);
      }
    }
    for (let i = 0; i < n; i++) {
      if (feedUp[i] < 0 || els[i].name !== 'p' || !classesOf(els[i]).includes('ws-feed-title')) continue;
      const chain = chainOf(i);
      // 같은 조상 사슬이어도 형제 문맥은 다를 수 있어 제목별로 보관한다.
      sink.feedTitles.set(JSON.stringify([rel, i]), { chain, element: nodes[i], rel, line: lineOf(els[i].start) });
    }
  }
  // 블록별 상인 a(일반 http·쿠팡 제외)·쿠팡 계열 포함 첫 시작 — a 마다 .ws-search 조상 사슬을 따라 등록(중첩 깊이만큼).
  const blocks = new Map();
  const block = (s) => {
    if (!blocks.has(s)) blocks.set(s, { merch: [], firstLink: Infinity });
    return blocks.get(s);
  };
  const affLinks = [];
  const feedLinks = []; // 362 N12: 피드 컨테이너 안 쿠팡 상품 링크(FEED_LINK_RES.COUPANG)
  for (let i = 0; i < n; i++) {
    const e = els[i];
    if (e.name !== 'a' || e.attrs.href === undefined) continue;
    if (feedUp[i] >= 0) {
      const href = e.attrs.href;
      if (FEED_LINK_RES.COUPANG.test(href)) feedLinks.push(i);
      else if (/aliexpress/i.test(normalizeHostText(decodeEntities(href)))) fail(lineOf(e.start), '피드 알리 링크 — 알리 고지 문안 Kenny 결정 전(364 §9 K2), 노출 0');
      else fail(lineOf(e.start), `피드 블록 안 링크는 쿠팡 상품 링크(${AFF_PREFIX}<code>) 만: ${L(href.slice(0, 60))}`);
      continue;
    }
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
  // 362 N12: ws-data data.feed.rail[].url 은 같은 href 의 피드 카드 a 가 있을 때만 허용 출현(하이드레이션 데이터 = 마크업).
  const feedHrefs = new Set(feedLinks.map((i) => els[i].attrs.href));
  let wsFeedUrls = 0;
  for (const c of wsFeed && Array.isArray(wsFeed.rail) ? wsFeed.rail : []) {
    if (!isObj(c) || typeof c.url !== 'string') continue;
    if (feedHrefs.has(c.url)) wsFeedUrls++;
    else fail(null, 'ws-data data.feed.rail 카드 url 에 같은 href 의 피드 카드 링크가 없다(하이드레이션 데이터 ≠ 마크업)');
  }
  const allowed = affLinks.length + feedLinks.length + wsFeedUrls;
  const occurrences = affHostCount(normalizeHostText(decodeEntities(html)));
  if (occurrences > allowed) fail(null, `제휴 호스트가 <a href="${AFF_PREFIX}<code>"> 밖에 ${occurrences - allowed}회`);
  if (dev && (affLinks.length > 0 || feedLinks.length > 0 || occurrences > 0)) fail(null, '개발 빌드(manifest.mode=development)에 제휴 링크(게이트 꺼짐이어야 한다)');

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
    if (shrinkUp[ni] !== null) fail(lineOf(ne.start), `고지 ${kind} 조상 인라인 style 축소·위장(${shrinkUp[ni]}) — 작은 글자(${NOTE_MIN_PX}px 미만)·배경과 같은 색·축소 금지`);
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
  function kidsDeep(i) {
    const out = [];
    const st = [...kids(i)];
    while (st.length) {
      const x = st.pop();
      out.push(x);
      st.push(...kids(x));
    }
    return out;
  }
  /**
   * 362 N12 C11-FEED-OUT(353 §4): 피드 컨테이너 안 ○·ws-badge·ws-product 0, 배지는 ws-feed-badge--listed|--check 하나,
   *   가격 줄은 같은 카드에 「M월 D일 확인」 동반·noprice 변형엔 가격 줄 0, 이미지 = img.ws-feed-thumb·no-referrer·FEED_IMAGE_HOSTS 정확 일치,
   *   피드 블록은 운영자 상품(products·li.ws-product) 뒤, 피드 마크업은 변형 파일(index.feed[-noprice].html)에만, ws-data 단계 = 파일 단계.
   */
  function checkFeedOut() {
    const out = (i, msg) => add('C11-FEED-OUT', 'FAIL', rel, i === null ? null : lineOf(els[i].start), msg);
    const variant = /(?:^|\/)index\.feed-noprice\.html$/.test(rel) ? 'noprice' : /(?:^|\/)index\.feed\.html$/.test(rel) ? 'full' : null;
    let boxes = 0;
    const popularOk = hasPopularSort(sink?.popularSorts ?? FEED_POPULAR_SORTS);
    const homeSecOf = (i) => (upSection[i] >= 0 ? els[upSection[i]].attrs['data-ws-section'] : undefined);
    const isLocalFeedPhoto = (i) => {
      const e = els[i];
      const cls = classesOf(e);
      if (!cls.includes('ws-photo') || cls.includes('ws-feed-thumb') || e.attrs.srcset !== undefined) return false;
      if (!PHOTO_ID_RE.test(e.attrs['data-ws-photo'] ?? '') || !PHOTO_ASSET_PATH_RE.test(e.attrs.src ?? '')) return false;
      if (cls.includes('ws-feed-photo')) return true;
      const p = e.parent >= 0 ? els[e.parent] : null;
      return p !== null && p.name === 'span' && classesOf(p).includes('ws-photo-frame') && classesOf(p).includes('ws-feed-photo');
    };
    // 399 B-1: HTML → ws-data data.feed 방향 대조(HTML 에만 넣은 상품은 ws-data 쪽 품목·GENERAL_INFO 체인 판정을 비켜 간다).
    const railItems = new Set(wsFeed && Array.isArray(wsFeed.rail) ? wsFeed.rail.map((c) => (isObj(c) ? c.supplyItemId : undefined)) : []);
    const l4Items = new Set(wsFeed && Array.isArray(wsFeed.items) ? wsFeed.items : []);
    const isFeedSec = (x) => els[x].name === 'section' && els[x].attrs['data-ws-part'] === 'feed';
    const notedSecs = new Set(); // 품목 고지 id 를 가진 피드 블록
    const secItems = new Map(); // 피드 블록 → 고지 id 의 품목
    const FEED_NOTE_ID_RE = /^ws-aff-feed-/;
    for (let i = 0; i < n; i++) {
      const e = els[i];
      const cls = classesOf(e);
      if (e.name === 'li' && cls.includes('ws-feed-row') && !(feedUp[i] >= 0 && isFeedSec(feedUp[i]))) out(i, '피드 행(li.ws-feed-row)은 section[data-ws-part=feed] 안에만');
      if (wsFeed) {
        if (e.name === 'li' && cls.includes('ws-feed-card') && !railItems.has(e.attrs['data-ws-item'])) out(i, `몰 카드 품목 ${L(String(e.attrs['data-ws-item']))} 이 ws-data data.feed.rail 에 없다`);
        if (feedUp[i] >= 0 && isFeedSec(feedUp[i]) && FEED_NOTE_ID_RE.test(e.attrs.id ?? '')) {
          notedSecs.add(feedUp[i]);
          const item = e.attrs.id.replace(FEED_NOTE_ID_RE, '');
          secItems.set(feedUp[i], item);
          if (!l4Items.has(item)) out(i, `피드 블록 품목 ${L(item)} 이 ws-data data.feed.items 에 없다`);
        }
      }
      // 380 S2: 몰 카드는 「몰에 올라온 상품」 레일(data-ws-section=mall)에만, 그 레일은 운영자 확인 레일 뒤·운영자 카드 0.
      if (e.name === 'li' && cls.includes('ws-feed-card') && homeSecOf(i) !== 'mall') out(i, '피드 카드가 「몰에 올라온 상품」 레일 밖(운영자 확인 준비물과 섞지 않는다)');
      if (e.name === 'section' && e.attrs['data-ws-section'] === 'mall') {
        const sib = e.parent >= 0 ? kids(e.parent) : [];
        if (sib.some((x) => els[x].start > e.start && els[x].attrs['data-ws-section'] === 'products')) out(i, '몰 레일이 운영자 확인 상품 레일보다 앞');
      }
      if (cls.includes('ws-product') && homeSecOf(i) === 'mall') out(i, '몰 레일 안 운영자 확인 카드(li.ws-product)');
      // 380 S3: 인기순 확인 sort 가 없으면 피드 블록·몰 레일 제목에 「많이 찾는 상품」 0.
      if (!popularOk && /^h[1-6]$/.test(e.name) && (feedUp[i] >= 0 || homeSecOf(i) === 'mall')
        && decodeEntities(html.slice(e.start, e.end ?? e.start).replace(/<[^>]*>/g, ' ')).includes(FEED_POPULAR_TITLE)) {
        out(i, `인기순 확인 sort 없이 「${FEED_POPULAR_TITLE}」 제목`);
      }
      if (e.name === 'img' && cls.includes('ws-feed-thumb') && feedUp[i] < 0) out(i, '피드 이미지(img.ws-feed-thumb)가 피드 블록 밖');
      if (feedUp[i] < 0) continue;
      if (feedUp[i] === i) {
        boxes++;
        if (/○/.test(decodeEntities(html.slice(e.start, e.end ?? e.start)))) out(i, '피드 블록에 ○ 글리프(운영자 확인 카드 전용)');
        // 373 D2: noprice 변형 피드 블록 본문(태그 뺀 글자)에 가격·날짜 표기 0 — 제목에 섞인 가격이 만료 뒤에도 남는 틈.
        if (variant === 'noprice' && feedTitleHasPriceOrDate(decodeEntities(html.slice(e.start, e.end ?? e.start).replace(/<[^>]*>/g, ' ')))) {
          out(i, 'noprice 변형 피드 블록에 가격·날짜 표기(제목 포함 — FEED_TITLE_PRICE_DATE)');
        }
        const sib = e.parent >= 0 ? kids(e.parent) : [];
        if (e.name === 'section' && sib.some((x) => els[x].start > e.start && els[x].attrs['data-ws-part'] === 'products')) out(i, '피드 블록이 운영자 확인 상품(products)보다 앞');
        if (e.name === 'li' && sib.some((x) => els[x].start > e.start && classesOf(els[x]).includes('ws-product'))) out(i, '피드 카드가 운영자 확인 카드(li.ws-product)보다 앞');
      }
      if (cls.some((c) => c === 'ws-badge' || c.startsWith('ws-badge--') || c === 'ws-product')) out(i, `피드 블록에 운영자 확인 표식 class(${L(cls.join(' '))})`);
      if (e.attrs['data-ws-glyph'] === 'ok') out(i, '피드 블록에 ○ 글리프(data-ws-glyph="ok")');
      if (cls.includes('ws-feed-badge') && cls.filter((c) => c === 'ws-feed-badge--listed' || c === 'ws-feed-badge--check').length !== 1) out(i, '피드 배지는 ws-feed-badge--listed·--check 중 정확히 하나');
      if (e.name === 'img') {
        // 398 C1: 행 imageUrl=null 의 로컬 대체 사진(server feed.ts thumb → common.ts photoTile(…, 'ws-feed-photo')) 은 외부 썸네일 규칙 밖.
        //   모양 고정 — img.ws-photo(ws-feed-thumb 아님)·data-ws-photo id·src = PHOTO_ASSET_PATH_RE(/assets/(photos|items)/<kebab>.webp)·srcset 0,
        //   자리 = 자기 class ws-feed-photo(실사) 또는 부모 span.ws-photo-frame.ws-feed-photo(생성). 사용권·종 범위는 C6-IMG-SPECIES(rules-output)가 같은 파일에서 본다.
        if (isLocalFeedPhoto(i)) continue;
        const li = upLi[i];
        const merchant = li >= 0 ? els[li].attrs['data-ws-merchant'] : undefined;
        if (!cls.includes('ws-feed-thumb')) out(i, '피드 블록 img 는 img.ws-feed-thumb 만(로컬 대체 사진은 img.ws-photo.ws-feed-photo · data-ws-photo · /assets/(photos|items)/ 만)');
        if ((e.attrs.referrerpolicy ?? '').trim().toLowerCase() !== 'no-referrer') out(i, '피드 이미지 referrerpolicy="no-referrer" 아님');
        if (!feedImageOk(merchant, (e.attrs.src ?? '').trim())) out(i, `피드 이미지 호스트가 FEED_IMAGE_HOSTS.${L(String(merchant))} 밖(https 정확 일치)`);
      }
      if (cls.includes('ws-feed-title') && feedTitleHasPriceOrDate(decodeEntities(html.slice(e.start, e.end ?? e.start).replace(/<[^>]*>/g, ' ')))) {
        out(i, '피드 제목에 가격·날짜 표기(373 D2 — 엔진이 버려야 할 행)');
      }
      if (cls.includes('ws-feed-price')) {
        if (variant === 'noprice') out(i, 'noprice 변형에 가격 줄(만료 지난 가격 노출)');
        const li = upLi[i];
        const box = li >= 0 ? els[li] : e;
        if (!/\d{1,2}월 \d{1,2}일 확인/.test(decodeEntities(html.slice(box.start, box.end ?? box.start)))) out(i, '가격 줄에 확인일(「M월 D일 확인」) 동반 없음');
      }
    }
    // 399 R-2: 피드 영역(L4 블록·홈 몰 레일)의 상품 행·링크는 class 와 무관하게 데이터와 대조한다.
    //   영역 안 모든 li = 상품 행, 링크·상품 제목·썸네일은 li 안에만. L4 행(타입·품목·URL·제목)은 scanAffiliateOutputs 가 같은 단계 피드 JSON 과,
    //   몰 카드(품목·URL·제목·LISTED_PASS 판정)는 이 파일의 ws-data data.feed.rail 과 대조한다.
    const isMallSec = (x) => els[x].name === 'section' && els[x].attrs['data-ws-section'] === 'mall';
    const textOf = (x) => decodeEntities(html.slice(els[x].openEnd, els[x].end)).trim();
    const railRows = wsFeed && Array.isArray(wsFeed.rail) ? wsFeed.rail.filter(isObj) : [];
    // 399 R-2c: pages/feed.ts + common.ts(photoTile·glyphSpan·railSection)의 닫힌 문법.
    // 알려진 태그를 찾는 방식이 아니라 모든 자식·속성·텍스트 자리를 소비한다. 새 렌더러 구조는 여기에도 명시해야 한다.
    const node = (name, cls, content = [], attrs = {}, before = '', after = '') => ({ name, attrs: { class: cls, ...attrs }, content, before, after });
    const optional = (schema) => ({ optional: schema });
    const either = (...schemas) => ({ either: schemas });
    const valueMatches = (value, expected) => typeof value === 'string' && (expected instanceof RegExp ? expected.test(value) : value === expected);
    const attrsAllowed = (e, allowed) => {
      // parseAttrs의 일반 객체가 삼키는 __proto__ 등도 원문 속성명으로 검사한다.
      const raw = html.slice(e.start + 1 + e.name.length, e.openEnd - 1);
      const attr = /\s+([^\s=/>"']+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"'=<>`]+))?/gy;
      let end = 0;
      let m;
      while ((m = attr.exec(raw)) !== null) {
        const key = m[1].toLowerCase();
        if (!Object.hasOwn(allowed, key) || !valueMatches(e.attrs[key], allowed[key])) {
          // 실제 구조 검사에서 이 요소의 style 속성을 거부한 경우만 중복 숨김 보고를 생략한다.
          if (key === 'style' && feedInlineByElement.has(e)) feedInlineByElement.get(e).structureReported = true;
          return false;
        }
        end = attr.lastIndex;
      }
      return e.dupAttrs.length === 0 && (VOID.has(e.name) ? /^\s*\/?\s*$/ : /^\s*$/).test(raw.slice(end));
    };
    function matches(i, schema) {
      if (i === undefined) return false;
      if (schema.either) return schema.either.some((s) => matches(i, s));
      const e = els[i];
      if (e.name !== schema.name || !attrsAllowed(e, schema.attrs) || Object.keys(e.attrs).length !== Object.keys(schema.attrs).length
        || !Object.entries(schema.attrs).every(([key, v]) => valueMatches(e.attrs[key], v))) return false;
      // 브라우저가 고쳐 읽는 닫힘 누락·교차 태그도 거부. void 요소는 자식·닫는 태그가 없다.
      if (!VOID.has(e.name) && !new RegExp(`^</${e.name}\\s*>`, 'i').test(html.slice(e.end))) return false;
      if (VOID.has(e.name)) return kids(i).length === 0;
      const childrenHere = kids(i);
      if (!Array.isArray(schema.content)) {
        const raw = html.slice(e.openEnd, e.end);
        return childrenHere.length === 0 && !raw.includes('<') && valueMatches(decodeEntities(raw), schema.content);
      }
      let at = 0;
      for (const part of schema.content) {
        if (part.optionalGroup) {
          if (matches(childrenHere[at], part.optionalGroup[0])) {
            for (const member of part.optionalGroup) if (!matches(childrenHere[at++], member)) return false;
          }
        } else if (part.optional) {
          if (matches(childrenHere[at], part.optional)) at++;
        } else if (part.repeat) {
          const start = at;
          while (matches(childrenHere[at], part.repeat)) at++;
          if (at === start) return false;
        } else if (!matches(childrenHere[at++], part)) return false;
      }
      if (at !== childrenHere.length) return false;
      let pos = e.openEnd;
      for (let k = 0; k < childrenHere.length; k++) {
        const child = els[childrenHere[k]];
        const gap = html.slice(pos, child.start);
        if (gap.includes('<') || (k === 0 && schema.before ? decodeEntities(gap) !== schema.before : gap.trim() !== '')) return false;
        const close = VOID.has(child.name) ? '' : /^<\/[^>]+>/.exec(html.slice(child.end))?.[0];
        if (close === undefined) return false;
        pos = child.end + close.length;
      }
      const tail = html.slice(pos, e.end);
      return !tail.includes('<') && (schema.after ? decodeEntities(tail) === schema.after : tail.trim() === '');
    }
    const localImg = (cls) => node('img', cls, [], { src: PHOTO_ASSET_PATH_RE, alt: '', loading: 'lazy', decoding: 'async', 'data-ws-photo': PHOTO_ID_RE });
    const photo = either(
      node('span', 'ws-photo ws-feed-photo', '', { 'aria-hidden': 'true' }),
      localImg('ws-photo ws-feed-photo'),
      node('span', 'ws-photo-frame ws-feed-photo', [localImg('ws-photo'), node('span', 'ws-photo-notice ws-t-meta', '생성 이미지 · 임시', { 'aria-hidden': 'true' })]),
      node('img', 'ws-feed-thumb', [], { src: /^https:\/\/.+$/, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }),
    );
    const listed = node('span', 'ws-t-label ws-feed-badge ws-feed-badge--listed', '표기 규격 통과');
    const check = node('span', 'ws-t-label ws-feed-badge ws-feed-badge--check', [node('span', 'ws-glyph', '△', { 'data-ws-glyph': 'check', 'aria-hidden': 'true' })], {}, '', '규격 확인 필요');
    const aff = node('span', 'ws-t-label ws-muted ws-feed-aff', '제휴 링크', { 'data-ws-aff': 'card' });
    const titleNode = node('p', 'ws-t-cta ws-feed-title', /^[\s\S]*\S[\s\S]*$/);
    const spec = optional(node('p', 'ws-t-meta ws-feed-spec', /^표기 · .+$/));
    const amount = node('span', 'ws-feed-amount', /^\d[\d,]*원$/);
    const checked = /^(?:[1-9]|1[0-2])월 (?:[1-9]|[12]\d|3[01])일 확인$/;
    const button = (mall, item) => node('a', `ws-btn ws-btn--outline ws-feed-go${mall ? ' ws-feed-go--compact' : ''}`,
      [node('span', 'ws-visually-hidden', ' (새 창)')], {
        href: FEED_LINK_RES.COUPANG, target: '_blank', rel: 'sponsored nofollow noopener noreferrer',
        'aria-describedby': mall ? 'ws-aff-feed-home' : `ws-aff-feed-${item}`, 'data-ws-merchant': 'COUPANG',
      }, '쿠팡에서 보기');
    const l4Body = (item, badge) => node('div', 'ws-feed-body', [titleNode, ...(badge === listed ? [spec] : []), node('p', 'ws-feed-meta', [badge, aff]),
      ...(variant === 'full' ? [optional(node('p', 'ws-t-meta ws-feed-price', [amount, node('span', 'ws-muted', /^ · (?:[1-9]|1[0-2])월 (?:[1-9]|[12]\d|3[01])일 확인 · 몰에서 달라질 수 있어요$/)]))] : []), button(false, item)]);
    const rowSchema = (mall, item) => mall
      ? node('li', 'ws-feed-card', [photo, node('p', 'ws-t-label ws-muted ws-feed-item', /^\S[\s\S]*$/), titleNode, spec, listed,
        ...(variant === 'full' ? [{ optionalGroup: [node('p', 'ws-t-meta ws-feed-price', [amount]), node('p', 'ws-t-meta ws-muted ws-feed-checked', checked)] }] : []), aff, button(true, item)],
      { 'data-ws-item': /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'data-ws-merchant': 'COUPANG' })
      : node('li', 'ws-feed-row', [photo, either(l4Body(item, listed), l4Body(item, check))], { 'data-ws-merchant': 'COUPANG' });
    const note = (id) => node('p', 'ws-t-meta ws-aff-note', COUPANG_DISCLOSURE, { id, 'data-ws-aff': 'note-feed' });
    const surfaceSchema = (mall, item) => mall
      ? node('section', 'ws-rail-section ws-rail-section--product ws-home-sec ws-mall-sec', [
        node('div', 'ws-rail-head', [node('div', 'ws-rail-heading ws-home-sec-head', [
          node('h2', 'ws-t-display ws-home-sec-title', '몰에 올라온 상품', { id: 'ws-sec-mall-title' }),
          ...(variant === 'full' ? [node('p', 'ws-t-body ws-muted ws-home-sec-lead', '몰 가격은 확인한 날 기준이에요. 몰에서 달라질 수 있어요.')] : []), note('ws-aff-feed-home'),
        ]), node('div', 'ws-rail-tools')]),
        node('ul', 'ws-rail ws-products', [{ repeat: rowSchema(true, item) }], { role: 'list', tabindex: '0', 'aria-labelledby': 'ws-sec-mall-title' }),
      ], { 'data-ws-section': 'mall', 'aria-labelledby': 'ws-sec-mall-title' })
      : node('section', 'ws-supply-part ws-feed', [
        node('h3', 'ws-t-label ws-supply-head', popularOk ? /^(?:몰 검색 결과|많이 찾는 상품)$/ : '몰 검색 결과', { id: 'ws-feed-title' }),
        node('p', 'ws-t-meta ws-muted ws-feed-sub', '쇼핑몰 상품명에 적힌 정보로 골랐어요. 실제 규격은 몰에서 확인해요.'), note(`ws-aff-feed-${item}`),
        node('ul', 'ws-feed-rows', [{ repeat: rowSchema(false, item) }], { role: 'list' }),
      ], { 'data-ws-part': 'feed', 'aria-labelledby': 'ws-feed-title' });
    // 블록 밖 조상도 렌더러의 속성만 허용한다. 숨김을 유발하는 style/hidden/inert/aria-hidden 등은 허용표에 없다.
    const ancestorAttrs = {
      html: { lang: 'ko' }, body: {}, div: { id: 'root', 'data-ws-prerendered': '1', 'data-ws-privacy': 'off' },
      main: { id: 'main', class: /^(?:ws-page|ws-page ws-home-b)$/, 'data-ws-route': /^[A-Z_]+$/, 'data-ws-type': /^[a-z0-9-]+$/ },
      aside: { class: 'ws-layer', id: 'ws-layer', 'data-ws-layer': 'L4', role: 'dialog', 'aria-labelledby': 'ws-layer-title', 'data-ws-id': /^supplyRequirements#[a-z0-9-]+$/ },
    };
    const checkedAncestors = new Set();
    for (let i = 0; i < n; i++) if (isFeedSec(i) || isMallSec(i)) {
      if (!matches(i, surfaceSchema(isMallSec(i), secItems.get(i)))) out(i, '피드 영역이 렌더러 허용 구조와 다르다(요소·클래스·속성·텍스트 자리·개수·순서)');
      for (let p = els[i].parent; p >= 0 && !checkedAncestors.has(p); p = els[p].parent) {
        checkedAncestors.add(p);
        const e = els[p];
        if (!Object.hasOwn(ancestorAttrs, e.name) || !attrsAllowed(e, ancestorAttrs[e.name]) || hiddenEl(e)
          || (e.name === 'div' && e.attrs.id !== 'root')) out(p, '피드 영역 조상이 렌더러 허용 밖 요소·속성 또는 숨김 상태');
      }
    }
    for (let i = 0; i < n; i++) {
      let surface = -1;
      let inLi = false;
      for (let x = els[i].parent; x >= 0 && surface < 0; x = els[x].parent) {
        if (isFeedSec(x) || isMallSec(x)) surface = x;
        else if (els[x].name === 'li') inLi = true;
      }
      if (surface < 0) continue;
      if (els[i].name !== 'li') {
        const cls = classesOf(els[i]);
        const product = (els[i].name === 'a' && els[i].attrs.href !== undefined) || cls.includes('ws-feed-title') || cls.includes('ws-feed-thumb');
        if (product && !inLi) out(i, '피드 영역의 링크·상품 제목·썸네일은 상품 행(li) 안에만');
        continue;
      }
      const links = [];
      let title = null;
      let badge = null;
      if (!matches(i, rowSchema(isMallSec(surface), secItems.get(surface)))) out(i, '피드 영역 상품 행이 렌더러 허용 구조와 다르다(제목·배지 각 1개, 허용 속성·텍스트 자리만)');
      for (let j = i + 1; j < n; j++) {
        if (!isAncestor(i, j)) continue;
        if (els[j].name === 'a' && els[j].attrs.href !== undefined) links.push(els[j].attrs.href);
        if (title === null && classesOf(els[j]).includes('ws-feed-title')) title = textOf(j);
        if (matches(j, listed)) badge = 'LISTED_PASS';
        else if (matches(j, check)) badge = 'CHECK_NEEDED';
      }
      if (isMallSec(surface)) {
        const item = els[i].attrs['data-ws-item'];
        const hit = badge === 'LISTED_PASS' && links.length === 1 && railRows.some((c) => c.supplyItemId === item && c.url === links[0] && typeof c.title === 'string' && c.title.trim() === title
          && ['OK', 'BELOW_RECOMMENDED'].includes(c.verdict));
        if (!classesOf(els[i]).includes('ws-feed-card') || !hit) out(i, `몰 레일 카드(${L(String(item))})가 ws-data data.feed.rail 의 품목·URL·제목과 일치하지 않는다(li.ws-feed-card·링크 1개)`);
      } else if (sink && variant !== null) {
        sink.feedRows.push({ rel, line: lineOf(els[i].start), typeId: wsTypeId, supplyItemId: secItems.get(surface) ?? null, stage: variant, links, title, badge });
      }
    }
    if (wsFeed) for (let i = 0; i < n; i++) if (isFeedSec(i) && !notedSecs.has(i)) out(i, '피드 블록 section[data-ws-part=feed] 에 품목 고지 id(ws-aff-feed-{품목}) 없음');
    if (boxes > 0 && variant === null) out(null, '피드 마크업이 기본 파일에 — 변형 파일(index.feed[-noprice].html)에만(피드 꺼짐 바이트 동일)');
    if (variant !== null) {
      if (!wsFeed) out(null, `피드 변형(${variant})인데 ws-data data.feed 없음`);
      else {
        if (wsFeed.stage !== variant) out(null, `피드 변형 파일 단계(${variant}) ≠ ws-data data.feed.stage(${L(String(wsFeed.stage))})`);
        if (variant === 'noprice' && /"(?:price|priceCheckedOn)"/.test(JSON.stringify(wsFeed))) out(null, 'noprice 변형 ws-data data.feed 에 가격 키');
      }
    } else if (wsFeed) out(null, 'ws-data data.feed 가 기본 파일에 — 변형 파일에만');
  }
  // 362 N12(353 §4 C10-AFF-OUT 피드): rel∋sponsored·noopener, target=_blank, 숨김 0, L4 밖 레이어 0,
  //   aria-describedby → 이 a 앞·같은 가장 가까운 section 안의 p[data-ws-aff=note-feed](원문·숨김 0), 같은 li 안 카드 표식(data-ws-aff=card).
  for (const i of feedLinks) {
    const a = els[i];
    const line = lineOf(a.start);
    const rels = relTokens(a.attrs.rel);
    if (!rels.includes('sponsored') || !rels.includes('noopener')) fail(line, '피드 링크 rel 에 sponsored·noopener 가 없다');
    if (a.attrs.target !== '_blank') fail(line, '피드 링크 target="_blank" 아님');
    if (hiddenUp[i]) fail(line, '피드 링크가 숨김·접힘 요소 안');
    if (upAside[i] >= 0 && els[upAside[i]].attrs['data-ws-layer'] !== 'L4') fail(line, '피드 링크는 레이어 L4·페이지 본문 레일에만');
    const sec = upSection[i];
    const ids = (a.attrs['aria-describedby'] ?? '').split(/\s+/).filter(Boolean);
    const ni = ids.map((id) => byId.get(id)).find((x) => x !== undefined && els[x].attrs['data-ws-aff'] === 'note-feed');
    if (ni === undefined || sec < 0 || !isAncestor(sec, ni) || els[ni].start > a.start) fail(line, '피드 링크 aria-describedby 가 같은 section 안·앞의 피드 고지(data-ws-aff="note-feed")를 가리키지 않는다');
    else if (!usedNotes.has(ni)) noteCheck(ni, 'FEED');
    const li = upLi[i];
    const mark = li < 0 ? -1 : kidsDeep(li).find((x) => els[x].attrs['data-ws-aff'] === 'card');
    if (mark === undefined || mark < 0) fail(line, '피드 카드에 제휴 표식(data-ws-aff="card")이 없다');
    else usedNotes.add(mark);
  }
  checkFeedOut();
  /**
   * 감사 M-1(281): 고지 F 위치 — 실제 마크업(server renderFooter · client shell/Footer.tsx):
   *   <div id="root"> 직속 [header, main, (scrim, aside 레이어), footer.ws-footer] — footer 안 [brand, links, note, note-f, p.ws-footer-copy].
   *   ① footer 부모 = body 또는 body 직속 div#root(앱 루트) ② footer 가 레이어 aside 안이 아님 ③ 문서의 모든 <main>·레이어 aside 가 footer 앞에서 닫힘(main 0 이면 FAIL)
   *   ④ p.ws-footer-copy(©)가 footer 직속 정확히 1개·마지막 요소 ⑤ note-f 의 바로 다음 요소 형제 = © (사이에 글자·태그 0 — 공백만).
   */
  const checkFooterF = (fi, nfi) => {
    const f = els[fi];
    const nf = els[nfi];
    const lf = lineOf(f.start);
    const p = f.parent;
    const pe = p >= 0 ? els[p] : null;
    const appRoot = pe !== null && (pe.name === 'body' || (pe.name === 'div' && pe.attrs.id === 'root' && pe.parent >= 0 && els[pe.parent].name === 'body'));
    if (upAside[fi] >= 0 || (pe !== null && pe.name === 'aside')) fail(lf, '고지 F 의 footer.ws-footer 가 레이어 aside 안 — 페이지 하단(body·앱 루트 직속)이어야 한다');
    else if (!appRoot) fail(lf, `고지 F 의 footer.ws-footer 부모가 body·앱 루트(div#root) 가 아니다(현재 ${pe === null ? '없음' : `<${pe.name}>`}) — 페이지 하단 고정`);
    let mains = 0;
    for (let i = 0; i < n; i++) {
      const e = els[i];
      const isMain = e.name === 'main';
      if (isMain) mains++;
      if ((isMain || isLayer(e)) && !(e.end !== null && e.end <= f.start && e.start < f.start)) {
        fail(lineOf(e.start), `고지 F 의 footer.ws-footer 가 <${e.name}${isMain ? '' : ' data-ws-layer'}> 뒤가 아니다 — footer 는 main·레이어 aside 다음(문서 맨 위·본문 안 footer 금지)`);
      }
    }
    if (mains === 0) fail(lf, '고지 F 문서에 <main> 이 없다 — footer 위치 판정 불가(fail-closed)');
    const fk = kids(fi);
    const copies = fk.filter((x) => els[x].name === 'p' && classesOf(els[x]).includes('ws-footer-copy'));
    if (copies.length !== 1) {
      fail(lf, `고지 F 자리: footer.ws-footer 직속 © 요소(p.ws-footer-copy)가 정확히 1개여야 한다(현재 ${copies.length})`);
      return;
    }
    const ci = copies[0];
    if (fk[fk.length - 1] !== ci) fail(lineOf(els[ci].start), '고지 F 자리: © 요소(p.ws-footer-copy)가 footer.ws-footer 의 마지막 요소가 아니다');
    const pos = fk.indexOf(nfi);
    if (fk[pos + 1] !== ci) {
      fail(lineOf(nf.start), `고지 F 가 © 요소(p.ws-footer-copy) 바로 앞 형제가 아니다(${pos > fk.indexOf(ci) ? '© 뒤' : '© 앞 다른 요소 사이'}) — 로고·링크·의료 안내 다음, © 바로 위`);
    } else {
      // 사이: note-f 닫는 태그와 공백만(글자·주석·다른 마크업 0). end = 닫는 태그 시작(elementTree).
      const between = html.slice(nf.end, els[ci].start);
      if (!/^<\/p\s*>\s*$/i.test(between)) fail(lineOf(nf.start), '고지 F 와 © 요소 사이에 글자·마크업이 있다 — 바로 앞 형제(공백만)');
    }
  };
  // 고지 F(R4-3, R4 시안 affiliate_candidates) — 제휴 a 가 1개 이상인 문서는 페이지 하단 footer.ws-footer 직속에 정확히 1개, 원문·숨김 0.
  if (affLinks.length > 0 || feedLinks.length > 0) {
    const footers = [];
    for (let i = 0; i < n; i++) if (els[i].name === 'footer' && classesOf(els[i]).includes('ws-footer')) footers.push(i);
    const notesF = footers.flatMap((f) => kids(f).filter((x) => els[x].attrs['data-ws-aff'] === 'note-f'));
    if (footers.length !== 1) fail(null, `제휴 문서의 footer.ws-footer 가 정확히 1개여야 한다(현재 ${footers.length}) — 고지 F 자리`);
    else if (notesF.length !== 1) fail(null, `고지 F(data-ws-aff="note-f")가 footer.ws-footer 직속에 정확히 1개여야 한다(현재 ${notesF.length})`);
    else {
      noteCheck(notesF[0], 'F');
      checkFooterF(footers[0], notesF[0]);
    }
  }
  // 고지·data-ws-aff 가 제휴 링크와 짝이 없으면(off 바이트 보존 위반) FAIL
  for (let i = 0; i < n; i++) {
    const v = els[i].attrs['data-ws-aff'];
    if (v === undefined) continue;
    if (!['note-a', 'note-b', 'note-f', 'note-feed', 'card'].includes(v)) fail(lineOf(els[i].start), `data-ws-aff=${L(v)} — note-a·note-b·note-f·note-feed·card 만`);
    else if (v === 'card' && feedUp[i] < 0) fail(lineOf(els[i].start), '제휴 표식(data-ws-aff="card")이 피드 카드 밖');
    else if (!usedNotes.has(i)) fail(lineOf(els[i].start), `짝 없는 고지 ${v}(제휴 링크 0 인 블록·레이어에 고지 — 꺼짐은 HEAD 와 바이트 동일)`);
  }
}

// ── CSS 선택자(고지 숨김·버튼 동등) — 경량 대조: 형제 결합자·의사 클래스는 「맞을 수 있음」(fail-closed 쪽 과대 근사) ─────────
const IDENT_RE = /(?:[\w-]|\\[\s\S])+/y;
// C11은 이스케이프 없는 단순 ASCII 식별자만 평가한다. C10의 기존 해석과 분리.
const EXACT_IDENT_RE = /^(?:[a-zA-Z_]|--|-[a-zA-Z_])[\w-]*$/;
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
function parseAttrSel(body, exact = false) {
  if (exact) {
    // 이름/문자열/플래그를 모두 허용 목록으로 제한한다. 그 밖은 미확인.
    const simple = /^\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([\w-]+))\s*([iIsS])?)?\s*$/.exec(body);
    if (!simple || !EXACT_IDENT_RE.test(simple[1])
      || (simple[5] !== undefined && !EXACT_IDENT_RE.test(simple[5]))) return null;
  }
  const m = /^\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*([iIsS])?)?\s*$/.exec(body);
  if (!m) return null;
  return { name: m[1].toLowerCase(), op: m[2] ?? null, val: m[3] ?? m[4] ?? m[5] ?? '', ci: (m[6] ?? '').toLowerCase() === 'i' };
}
/** 복합 선택자 → { compounds, combs } | null(해석 불가). exact는 C11 전용이며 C10 기본 해석은 보존한다.
 * combs[k] = compounds[k] 앞 결합자(' ' '>' '+' '~'), combs[0]=null. */
export function parseSelector(sel, exact = false) {
  const out = { compounds: [], combs: [] };
  let cur = null;
  let comb = null;
  const s = sel.trim();
  // 토큰화 전에 거른다. hex escape 끝의 공백을 결합자로 오해하지 않으며,
  // :not() 안에서도 null → 1(미확인)을 유지한다.
  if (exact && /[^\x09\x0a\x0c\x0d\x20-\x7e]|\\/.test(s)) return null;
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (cur) comb = comb ?? ' ';
      cur = null;
      i++;
      continue;
    }
    if (c === '>' || c === '+' || c === '~') {
      if (exact && (!out.compounds.length || (comb !== null && comb !== ' '))) return null;
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
      return m && (!exact || EXACT_IDENT_RE.test(m[0])) ? m[0] : null;
    };
    if (c === '*') {
      if (exact && (cur.tag !== null || cur.ids.length || cur.classes.length || cur.attrs.length || cur.pseudo)) return null;
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
      const a = parseAttrSel(s.slice(i + 1, j), exact);
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
        if (exact && i === s.length) return null;
        arg = s.slice(open + 1, i);
        i++;
      }
      if (exact && arg !== null && (dbl || LEGACY_PSEUDO_EL.has(name) || name === 'empty')) {
        cur.unknown = true;
        continue;
      }
      if (dbl || LEGACY_PSEUDO_EL.has(name)) {
        if (SKIP_PSEUDO_EL.test(name)) cur.skip = true;
        else if (exact) cur.unknown = true;
      } else cur.pseudo = true;
      if (dbl || LEGACY_PSEUDO_EL.has(name)) {
        // 의사 요소 — 위에서 처리
      } else if (name === 'empty') cur.empty = true;
      else if (name === 'not' && arg !== null) {
        // C10(276)은 단순 compound만 평가한다. C11은 전체 선택자와 미확인 인수를 보관해
        //   실제 요소 관계에서 3값으로 부정한다(미확인을 일치로 뒤집어 숨김을 놓치지 않음).
        const parts = splitSelectorList(arg).map((part) => parseSelector(part, exact));
        if (exact) {
          (cur.notSelectors ??= []).push(...(parts.length ? parts : [null]));
        } else if (parts.length > 0 && parts.every((p) => p !== null && p.compounds.length === 1)) cur.nots.push(...parts.map((p) => p.compounds[0]));
      } else if (exact) cur.unknown = true;
    } else {
      const v = ident(i);
      if (!v) return null;
      if (exact && (cur.tag !== null || cur.ids.length || cur.classes.length || cur.attrs.length || cur.pseudo)) return null;
      cur.tag = unesc(v).toLowerCase();
      i += v.length;
    }
  }
  return out.compounds.length && !(exact && comb !== null) ? out : null;
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
/** C11: 0=불일치, 1=미확인, 2=일치. 부정은 확실한 일치만 제외한다. */
function feedSelectorMatch(p, element) {
  if (p === null) return 1;
  // Case-sensitive / ASCII-insensitive 결과가 갈리면 HTML 속성별 규칙이나
  // quirks mode를 추측하지 않는다. :not()도 2 - 1 = 1로 미확인을 보존한다.
  const fold = (s) => s.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  const compare = (actual, wanted, test = (a, b) => a === b) => {
    if (actual === undefined) return 0;
    if (typeof actual !== 'string' || /[^\x20-\x7e]/.test(actual) || /[^\x20-\x7e]/.test(wanted)) return 1;
    const sensitive = test(actual, wanted);
    const insensitive = test(fold(actual), fold(wanted));
    return sensitive !== insensitive ? 1 : sensitive ? 2 : 0;
  };
  const attribute = (a, e) => {
    if (!Object.hasOwn(e.attrs, a.name)) return 0;
    if (a.op === null) return 2;
    const tests = {
      '=': (v, w) => v === w,
      '~=': (v, w) => w !== '' && v.split(/[\t\n\f\r ]+/).includes(w),
      '|=': (v, w) => v === w || v.startsWith(`${w}-`),
      '^=': (v, w) => w !== '' && v.startsWith(w),
      '$=': (v, w) => w !== '' && v.endsWith(w),
      '*=': (v, w) => w !== '' && v.includes(w),
    };
    return Object.hasOwn(tests, a.op) ? compare(e.attrs[a.name], a.val, tests[a.op]) : 1;
  };
  const compound = (c, e) => {
    if (c.skip || (c.empty && !e.empty)) return 0;
    let result = c.unknown ? 1 : 2;
    if (c.tag && c.tag !== '*') result = Math.min(result, compare(e.name, c.tag));
    for (const id of c.ids) result = Math.min(result, compare(e.id, id));
    for (const cls of c.classes) {
      // HTML class 토큰화는 ASCII 공백만. 일반 \s는 NBSP 등을 잘못 나눈다.
      const tokens = (e.attrs.class ?? '').split(/[\t\n\f\r ]+/).filter(Boolean);
      result = Math.min(result, Math.max(0, ...tokens.map((token) => compare(token, cls))));
    }
    for (const attr of c.attrs) result = Math.min(result, attribute(attr, e));
    for (const not of c.notSelectors ?? []) {
      result = Math.min(result, 2 - feedSelectorMatch(not, e));
    }
    return result;
  };
  const match = (ci, e) => {
    if (!e) return 0;
    const own = compound(p.compounds[ci], e);
    if (own === 0 || ci === 0) return own;
    const comb = p.combs[ci];
    if (comb === '>') return Math.min(own, match(ci - 1, e.parent));
    if (comb === '+') return Math.min(own, match(ci - 1, e.previous));
    const link = comb === '~' ? 'previous' : 'parent';
    let left = 0;
    for (let next = e[link]; next; next = next[link]) {
      left = Math.max(left, match(ci - 1, next));
      if (left === 2) break;
    }
    return Math.min(own, left);
  };
  return match(p.compounds.length - 1, element);
}
function feedTitleMatches(p, title) {
  // 이전 형식의 외부 sink에는 요소 관계가 없다 — 숨김 가능성을 놓치지 않는다.
  if (!title.element) return true;
  for (let e = title.element; e; e = e.parent) if (feedSelectorMatch(p, e) !== 0) return true;
  return false;
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
export function checkCssAff(css, rel, baseLine, sink, add, feedResolve = null) {
  const src = blankNonElementAtRules(css.replace(/\/\*[\s\S]*?\*\//g, (x) => x.replace(/[^\n]/g, ' ')));
  const lineOfCss = lineIndex(src);
  const notes = sink ? [...sink.notes.values()] : [];
  const pairs = sink ? [...sink.pairs.values()] : [];
  const feedTitles = [...(sink?.feedTitles?.values() ?? [])];
  const resolveFeedValue = feedTitles.length > 0
    ? feedResolve ?? feedVarResolver([css, ...(sink?.styles ?? []).map((s) => s.css)], sink) : null;
  const fail = (off, msg) => add('C10-AFF-OUT', 'FAIL', rel, baseLine + lineOfCss(off) - 1, msg);
  const feedFail = (off, msg) => add('C11-FEED-OUT', 'FAIL', rel, baseLine + lineOfCss(off) - 1, msg);
  let off = 0;
  for (const chunk of src.split('}')) {
    const ob = chunk.lastIndexOf('{');
    if (ob >= 0) {
      let sel = chunk.slice(chunk.lastIndexOf('{', ob - 1) + 1, ob);
      sel = sel.slice(sel.lastIndexOf(';') + 1).trim();
      const body = chunk.slice(ob + 1);
      const at = off + ob;
      if (sel !== '' && !sel.startsWith('@')) {
        // 고지/버튼 분기와 독립적으로 검사: 제목에만 허용한 말줄임이 기존 규칙을 완화하지 않는다.
        if (feedTitles.length > 0 && hidesFeedTitle(body, resolveFeedValue)) {
          for (const one of splitSelectorList(sel)) {
            const p = parseSelector(one, true);
            if (p === null) {
              feedFail(at, `해석할 수 없는 선택자(${L(one.slice(0, 40))})에 숨김·축소 선언 — 피드 상품 제목 적용 여부 판정 불가(fail-closed)`);
              break;
            }
            const hit = feedTitles.find((title) => feedTitleMatches(p, title));
            if (hit) {
              feedFail(at, `선택자 ${L(one.slice(0, 40))} 의 숨김·축소 선언이 피드 상품 제목(또는 조상)에 적용된다(${L(hit.rel)}:${hit.line})`);
              break;
            }
          }
        }
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
/** 362 N12: 산출 피드 JSON — 제휴 호스트는 url 키의 쿠팡 상품 링크 값에만, 수수료류 키 0, noprice 는 가격 키 0. */
function checkFeedJsonOut(text, rel, noprice, add, popularSorts = FEED_POPULAR_SORTS, rowKeys = null) {
  const fail = (msg) => add('C11-FEED-OUT', 'FAIL', rel, null, msg);
  let doc;
  try {
    doc = JSON.parse(stripBom(text));
  } catch {
    return fail('피드 JSON 파싱 실패');
  }
  if (isObj(doc) && 'popular' in doc && (doc.popular !== true || !hasPopularSort(popularSorts))) fail('인기순 확인 sort 없이 피드 JSON popular');
  let urls = 0;
  const walkV = (v, k) => {
    if (typeof v === 'string') {
      if (k === 'title' && feedTitleHasPriceOrDate(v)) fail('피드 JSON title 에 가격·날짜 표기(373 D2 — FEED_TITLE_PRICE_DATE)');
      if (k === 'url' && FEED_LINK_RES.COUPANG.test(v)) urls++;
      else if (/aliexpress/i.test(v)) fail('피드 JSON 에 알리 값 — 알리 고지 문안 Kenny 결정 전(K2)');
      return;
    }
    if (Array.isArray(v)) for (const x of v) walkV(x, k);
    else if (isObj(v)) for (const [kk, x] of Object.entries(v)) {
      if (FORBIDDEN_JSON_KEYS.has(kk) || kk === 'aff' || SEED_AFF_KEY(kk)) fail(`피드 JSON 허용 밖 키 ${L(kk)}`);
      if (noprice && PRICE_KEYS.has(kk)) fail(`noprice 피드 JSON 에 가격 키 ${L(kk)}`);
      walkV(x, kk);
    }
  };
  walkV(doc, '');
  if (rowKeys && isObj(doc) && Array.isArray(doc.rows)) {
    for (const row of doc.rows) if (isObj(row)) rowKeys.add(feedRowKey(noprice ? 'noprice' : 'full', doc.typeId, doc.supplyItemId, row.url, row.title, doc.badge));
  }
  const occ = affHostCount(normalizeHostText(text));
  if (occ > urls) fail(`피드 JSON 에 url 키 상품 링크 밖 제휴 호스트 ${occ - urls}회`);
}

const feedRowKey = (stage, typeId, itemId, url, title, badge) => JSON.stringify([stage, typeId, itemId, url, typeof title === 'string' ? title.trim() : title, badge]);

export function scanAffiliateOutputs({ root, dist, add, popularSorts = FEED_POPULAR_SORTS }) {
  const manPath = join(dist, 'prerender-manifest.json');
  if (!existsSync(manPath)) return;
  let m;
  try {
    m = JSON.parse(stripBom(readFileSync(manPath, 'utf8')));
  } catch {
    return; // C3-OUT-ROUTE 가 FAIL
  }
  const dev = isObj(m) && m.mode === 'development';
  const sink = { notes: new Map(), pairs: new Map(), feedTitles: new Map(), styles: [], popularSorts, feedRows: [] };
  const rowKeys = new Set(); // 399 R-2: 피드 JSON 행
  const feedJson = new Set();
  const fmPath = join(dist, 'feed-manifest.json');
  if (existsSync(fmPath)) {
    try {
      const fm = JSON.parse(stripBom(readFileSync(fmPath, 'utf8')));
      for (const s of ['full', 'noprice']) for (const f of Array.isArray(fm?.variants?.[s]) ? fm.variants[s] : []) if (typeof f === 'string') feedJson.add(f);
    } catch {
      add('C11-FEED-OUT', 'FAIL', relPosix(root, fmPath), null, 'feed-manifest.json 파싱 실패');
    }
  }
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
    // 362 N12: feed-manifest 가 나열한 피드 JSON 만 제휴 호스트 허용 — 값이 url 키의 쿠팡 상품 링크와 정확히 같을 때만, noprice 는 가격 키 0.
    const drel = relPosix(dist, abs);
    if (feedJson.has(drel)) {
      checkFeedJsonOut(text, rel, drel.endsWith('.noprice.json'), add, popularSorts, rowKeys);
      continue;
    }
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
  // 399 R-2c: HTML L4 행 → 같은 단계 피드 JSON 행(타입·품목·URL·제목·배지). 데이터에 없는 행은 품목 판정(GENERAL_INFO 등)을 비켜 간다.
  for (const row of sink.feedRows) {
    if (row.links.length !== 1 || !rowKeys.has(feedRowKey(row.stage, row.typeId, row.supplyItemId, row.links[0], row.title, row.badge))) {
      add('C11-FEED-OUT', 'FAIL', row.rel, row.line, `L4 피드 행이 ${row.stage} 피드 JSON(${L(String(row.typeId))}·${L(String(row.supplyItemId))})의 품목·URL·제목·배지와 일치하지 않는다(링크 ${row.links.length}개)`);
    }
  }
  // CSS — 고지(.ws-aff-note 직접·일반 선택자·조상) 숨김·축소 0, 제휴 a 차등 선택자 0(111 §0 · D-37)
  // 403: 사용 파일보다 뒤에 나오는 정의도 보도록 전체 CSS/인라인 선언을 먼저 수집한다.
  const styles = [...cssFiles.map(([abs, rel]) => ({ css: readFileSync(abs, 'utf8'), rel, line: 1 })), ...sink.styles];
  const resolveFeedValue = feedVarResolver(styles.map((s) => s.css), sink);
  for (const s of styles) checkCssAff(s.css, s.rel, s.line, sink, add, resolveFeedValue);
  const titleAncestors = new Set();
  for (const title of sink.feedTitles.values()) {
    for (let e = title.element; e && !titleAncestors.has(e); e = e.parent) titleAncestors.add(e);
  }
  for (const s of sink.feedInlineStyles ?? []) {
    if (!s.structureReported && titleAncestors.has(s.element) && hidesFeedTitle(s.style, resolveFeedValue)) {
      add('C11-FEED-OUT', 'FAIL', s.rel, s.line, '인라인 style 의 숨김·축소 선언이 피드 상품 제목(또는 조상)에 적용된다');
    }
  }
}
