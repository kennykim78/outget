// 소스·스키마·패키지·시드 규칙(R3 계획 §5 C1~C7). compliance-scan.mjs 가 add(finding) 로 수집.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, extname, join } from 'node:path';
import { CODE_EXT, TEXT_EXT, isDir, lexJs, relPosix, stripBom, stripSlashComments, walk } from './files.mjs';
import { PRODUCT_IMAGE_ASSET_RE, REVIEWER_IMAGE_RE } from './asset-patterns.mjs';
import { lintText } from './normalize.mjs';
import { tags } from './html.mjs';
import {
  PHOTO_LICENSES,
  PHOTO_USABLE_STATUSES,
  PRODUCT_IMAGE_LICENSES,
  SEED_FILES,
  ccBySaPlacementOk,
  ccLicenseOfUrl,
  dayNumber,
  isPhotoUsableRow,
  photoSourceUrlAllowed,
} from './seed-exposure.mjs';

// e2e: R6 — 데모 E2E 하네스도 스캔(@playwright/test 외 금지 라이브러리·외부 fetch·시크릿 등은 그대로 적용).
export const SCAN_DIRS = ['client/src', 'client/build', 'server/src', 'server/prisma', 'server/seed', 'scripts', 'e2e']; // client/build: vite 플러그인 소스(R7 성능 P1, perf-sec L1)

// 스캐너 자신(규칙 패턴을 담고 있음) — 코드 규칙(C1-FETCH/SDK, C2, C5)만 면제, C1-LIB·C7 은 적용.
export const SELF_FILES = new Set([
  'scripts/compliance-scan.mjs',
  'scripts/lib/normalize.mjs',
  'scripts/lib/files.mjs',
  'scripts/lib/seed-exposure.mjs',
  'scripts/lib/html.mjs',
  'scripts/lib/rules-source.mjs',
  'scripts/lib/rules-output.mjs',
  'scripts/lib/asset-patterns.mjs',
]);

// 지도 SDK (파일, 호스트) 예외 — 이 파일들에서만 지도 호스트 리터럴 허용.
//   R5 C1-SDK 분리(오케스트레이터 결정):
//   SDK 호스트(oapi./openapi./*.map.naver.com·pstatic.net) → client/src/map/** · server/src/middleware/spa.ts(CSP) · 그 테스트만.
//   웹 딥링크 호스트(하위 도메인 없는 map.naver.com — 길찾기·검색 링크) → server/src/engine/links.ts · 그 테스트만
//   (클라는 @ws/engine 헬퍼를 import — 클라 코드에 호스트 리터럴 0).
const SDK_ALLOWED = (rel) =>
  rel.startsWith('client/src/map/') || rel === 'server/src/middleware/spa.ts' || rel === 'server/src/__tests__/spa.prerender.test.ts';
const WEB_MAP_ALLOWED = (rel) => rel === 'server/src/engine/links.ts' || rel === 'server/src/__tests__/engine.links.test.ts';
const MAP_HOST_RE = /(?:[a-z0-9*-]+\.)*(?:map\.naver\.com|pstatic\.net)\b/gi;
/** 매치가 하위 도메인 없는 웹 호스트 map.naver.com 인가 — 앞 글자가 호스트 문자면(위장 'xmap.naver.com' 등) SDK 쪽으로(fail-closed). */
const isBareWebMapHost = (line, m) => m[0].toLowerCase() === 'map.naver.com' && !/[a-z0-9*.-]/i.test(line.charAt(m.index - 1));
const SHOP_API_RE = /openapi\.naver\.com/i;
// 쇼핑 오픈API 호스트 예외(2026-10-27): DEV_SEARCH_CHECK_FILE 에서만, 그 줄의 모든 출현이 정확히 'https://openapi.naver.com/'(소문자,
//   하위/위장 도메인·포트·userinfo·http 불가). 그 밖의 파일은 전면 금지 유지.
const SHOP_API_ANY_RE = /[a-z0-9.@:/-]*openapi\.naver\.com[^\s'"`]?/gi;
function shopApiLineAllowed(rel, line) {
  if (rel !== DEV_SEARCH_CHECK_FILE) return false;
  const ms = line.match(SHOP_API_ANY_RE) ?? [];
  return ms.length > 0 && ms.every((m) => m === 'https://openapi.naver.com/');
}

const BANNED_LIBS = ['puppeteer', 'puppeteer-core', 'playwright', 'playwright-core', 'cheerio', 'crawlee', 'node-cron', 'undici', 'axios', 'got'];
const BANNED_SCOPES = ['@playwright/', '@crawlee/', '@puppeteer/'];
const isBannedLib = (name) => BANNED_LIBS.includes(name) || BANNED_SCOPES.some((s) => name.startsWith(s)) || BANNED_LIBS.some((b) => name.startsWith(`${b}/`));
// R6 오케스트레이터 결정(레인 E 데모 E2E): 불변식 1 규칙은 유지하되 좁은 예외 하나 —
//   '@playwright/test'(정확 일치) 는 루트 package.json devDependencies 와, import 는 e2e/** · 루트 playwright.config.ts 에서만.
//   client/src·server/src·scripts·dependencies 등 그 밖은 FAIL. playwright·playwright-core·puppeteer 등 다른 패키지는 예외 없음.
const E2E_LIB = '@playwright/test';
const E2E_IMPORT_OK = (rel) => rel === 'playwright.config.ts' || rel.startsWith('e2e/');
const isBannedImport = (name, rel) => isBannedLib(name) && !(name === E2E_LIB && E2E_IMPORT_OK(rel));
const isBannedDep = (name, sec, rel) => isBannedLib(name) && !(name === E2E_LIB && sec === 'devDependencies' && rel === 'package.json');

const NET_CALL_RE = /\b(?:fetch|axios(?:\.\w+)?|got(?:\.\w+)?|request|undici\.\w+|https?\.(?:get|request)|sendBeacon)\s*\(|\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\s*\(|\.open\s*\(/;
const ABS_URL_RE = /\b((?:https?|wss?):\/\/([^\s/'"`?#:]+))/gi;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;
// C1-FETCH 외부 호스트 허용목록(R6 B4 — Kenny 결정: 메일 공급자 Resend). 호스트 → 허용 파일(정확 경로).
//   https 만, 호스트 정확 일치(대소문자 구분 — 대문자 표기·하위/상위 도메인은 불허, fail-closed), 포트·userinfo 붙으면 불허.
//   그 파일 밖에서 같은 호스트로 호출하거나, 그 파일에서 다른 외부 호스트로 호출하면 여전히 FAIL. 상품·외부 사이트 본문·이미지 수집과 무관(불변식 1).
//   2026-10-27(Kenny: 검색 키워드 실효성 검증 = 네이버 검색 API + 쿠팡 파트너스 API): 개발 전용 도구 한 파일만(CI·빌드·서버 비포함).
//   결과는 _workspace 에 상품명·카테고리만(가격·판매처·이미지·링크 저장 0) — 상품 수집이 아니라 공식 API 로 검색어 품질만 본다.
export const DEV_SEARCH_CHECK_FILE = 'scripts/dev/check-search-keywords.mjs';
const FETCH_HOST_ALLOW = Object.freeze({
  'api.resend.com': Object.freeze(['server/src/save/mail.ts']),
  'openapi.naver.com': Object.freeze([DEV_SEARCH_CHECK_FILE]),
  'api-gateway.coupang.com': Object.freeze([DEV_SEARCH_CHECK_FILE]),
});
/** ABS_URL_RE 매치 m(문자열 txt 안)이 허용목록 호출인가. */
function fetchHostAllowed(rel, txt, m) {
  const files = Object.prototype.hasOwnProperty.call(FETCH_HOST_ALLOW, m[2]) ? FETCH_HOST_ALLOW[m[2]] : null;
  if (!files || !files.includes(rel)) return false;
  if (!m[1].startsWith('https://')) return false;
  const next = txt.charAt(m.index + m[0].length);
  return next === '' || next === '/' || next === '?' || next === '#' || /[\s'"`]/.test(next);
}

const TRADE_ROUTE_RE = /\/(adopt|adoption|applications?|match(?:es|ing)?|payments?|escrow|settle|refunds?|payouts?|checkout|orders?|cart|listings?)\b/i;
const TRADE_PARTS = new Set(['escrow', 'escrows', 'payout', 'payouts', 'settlement', 'settlements', 'refund', 'refunds', 'checkout']);
const TRADE_KO = /정산|분양|입양신청/;
const TRADE_MODELS = /^(Adoption|Application|Match|Payment|Escrow|Settlement|Refund|Payout|Order|Cart|Listing)$|^(Adoption|Payment|Escrow|Settlement|Refund|Payout)[A-Z]\w*$/;
const PRICE_FIELD = /price|merchant|affiliate|platformprice|ourprice/i;

const CONTENT_MODELS = 'animalType|taxon|taxonLegalRevision|careProfile|supplyItem|supplyRequirement|compatibilityRule|setupBundle|setupBundleItem|curatedProduct|vetClinic|testimonial';
const CONTENT_QUERY_RE = new RegExp(`\\.\\s*(?:${CONTENT_MODELS})\\s*\\.\\s*(?:find\\w*|count|aggregate|groupBy)\\s*\\(`);
const EXPOSURE_IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*)['"][^'"]*engine(?:\/(?:index|exposure))?(?:\.[jt]s)?['"]/;

const COORD_RE = /\b(?:lat|lng|latitude|longitude|coords|coordinates)\b/;
const GEO_ACT_RE = /\b(?:INSERT|save|create|createMany|upsert)\b|\b(?:localStorage|sessionStorage|indexedDB)\b|\.setItem\s*\(|\bfetch\s*\(|\baxios\b|\bsendBeacon\b|\.emit\s*\(|\bXMLHttpRequest\b|\.post\s*\(|\bWebSocket\b/;
const GEO_PROXIMITY = 6;
const GEO_KEY = /^(lat|lng|lon|long|latitude|longitude|coords|coordinates)$/i;
const GEO_FIELD = /^(lat|lng|lon|latitude|longitude|coords|coordinates)$|(?:Lat|Lng|Latitude|Longitude)$/;

// ── B3-4(R5): 클라 위치·저장·쿠키·인라인 실행, 서버 쿠키 발급 ─────────────
// C5-GEO 위치 API — client/src 전체(테스트 포함·지도 폴더 예외 없음, D14). 주석은 제외, 문자열은 포함('geolocation' 키 접근 우회 차단).
const GEOLOC_RE = /\bgeolocation\b|\b(?:getCurrentPosition|watchPosition)\b/;
// C9-STORAGE — 웹 저장소는 client/src/lib/storage.ts 한 곳(C-R5-1 금지 키·ws. 접두사 강제 지점). 테스트는 jsdom 저장소를 직접
//   비우고 저장 형식을 되읽어 계약을 단언해야 하므로 예외(실행 코드 아님).
const STORAGE_RE = /\b(?:localStorage|sessionStorage)\b/;
const STORAGE_ALLOWED = (rel) => rel === 'client/src/lib/storage.ts';
// C9-STORAGE 쿠키 — client/src 전체(테스트 포함) document.cookie·cookieStore 0. 세션은 서버 HttpOnly 쿠키만(D2).
const CLIENT_COOKIE_RE = /\bdocument\s*(?:\.\s*cookie\b|\[\s*['"`]cookie['"`]\s*\])|\bcookieStore\b/;
// C8-SRC-SAFE — 소스의 인라인 실행: 문자열 속 javascript:/vbscript: URL·on*= 핸들러 마크업, setAttribute('on…'), el.onx = '문자열',
//   JSX 핸들러에 문자열 값(onClick="…"). 테스트는 적대 입력을 일부러 넣으므로 예외.
const JS_URL_RE = /\b(?:javascript|vbscript)\s*:/i;
const INLINE_HANDLER_MARKUP_RE = /<[a-z][^>]*\son[a-z]+\s*=/i;
const SET_ON_ATTR_RE = /\bsetAttribute(?:NS)?\s*\(\s*(?:[^,]+,\s*)?['"`]on[a-z]+['"`]/i;
const ON_PROP_STRING_RE =
  /\.\s*on(?:click|dblclick|load|error|abort|mouse\w+|key\w+|focus\w*|blur|change|input|submit|reset|pointer\w+|touch\w+|message|toggle|animation\w+|transition\w+|scroll|wheel|drag\w*|drop|copy|paste|cut|contextmenu|beforeunload|unload|resize|hashchange|popstate|select|invalid)\s*=\s*['"`]/i;
const JSX_ON_STRING_RE = /\son[A-Z][A-Za-z]*\s*=\s*['"]/;
// C9-COOKIE — 서버 쿠키 발급(Set-Cookie·res.cookie·clearCookie)과 쿠키 속성 직렬화(HttpOnly·Max-Age=·SameSite=)는 허용 파일만.
//   발급: save/magic.routes.ts(ws_sid, 사용자 저장 세션) · auth/auth.routes.ts(ws_op_rt, 운영자 refresh — D3).
//   직렬화: save/cookie.ts(ws_sid 단일 정의) · auth/auth.routes.ts(ws_op_rt 정의가 라우트 파일 안에 있음).
const COOKIE_EMIT_RE = /set-cookie|\.\s*(?:cookie|clearCookie)\s*\(/i;
const COOKIE_SER_RE = /\bHttpOnly\b|\bMax-Age\s*=|\bSameSite\s*=/i;
const COOKIE_EMIT_ALLOWED = new Set(['server/src/save/magic.routes.ts', 'server/src/auth/auth.routes.ts']);
const COOKIE_SER_ALLOWED = new Set(['server/src/save/cookie.ts', 'server/src/auth/auth.routes.ts']);
// C9-COOKIE 플래그(QA-M D3, 심층 방어): 허용 직렬화 파일의 쿠키 템플릿(Max-Age= 가 있는 줄)마다 HttpOnly · SameSite=Lax|Strict ·
//   Secure(무조건 '; Secure' 또는 운영 조건부 `${secure ? '; Secure' : ''}` — 현재 구조) 필수, SameSite=None 금지.
//   발급 줄(Set-Cookie)에 secure 인자로 리터럴 false 를 넘기는 것도 금지(조건부 Secure 무력화).
const COOKIE_TEMPLATE_RE = /\bMax-Age\s*=/i;
const COOKIE_HTTPONLY_RE = /;\s*HttpOnly\b/;
const COOKIE_SAMESITE_RE = /;\s*SameSite=(?:Lax|Strict)\b/;
const COOKIE_SECURE_RE = /;\s*Secure\b/;
const COOKIE_SECURE_COND_RE = /\?\s*['"`];\s*Secure['"`]\s*:\s*['"`]{2}/;
// CSP(QA-M D3, D21): spa.ts 의 기본 정책 SPA_CSP(와 그것이 펼치는 상수)에 네이버·pstatic 호스트 0, 지도 호스트 리터럴은 VET_CSP 정의 안에만,
//   VET_CSP 사용은 /vet·/vet/ 분기 줄에서만(전 경로 적용 금지).
const SPA_FILE = 'server/src/middleware/spa.ts';
const CSP_EXT_HOST_RE = /naver|pstatic/i;

const SECRET_RES = [
  /X-Naver-Client-(Id|Secret)\s*['"]?\s*[:=]\s*['"][^'"]+['"]/i,
  /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9]{16,}/i,
  /JWT[_A-Z]*SECRET\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/,
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  // security 139 MED-1 — 배포 실값 형태.
  //   env·셸·compose 줄의 따옴표 없는(또는 있는) 값: 줄 시작 KEY=값(선택 export·YAML 목록 '- '). 이름에 SECRET·TOKEN·PASSWORD·PASSWD·
  //   API_KEY·PRIVATE_KEY·_HASH 가 있고(이름이 그 낱말로 시작해도 — PASSWORD=·TOKEN=·SECRET_KEY_BASE=, QA148 LOW-1) 값이 16자 이상 리터럴.
  //   값은 변수·치환 $·자리 <>·{} 로 시작하지 않아야 하고, 중간의 $ 는 값의 일부로 본다(무작위 비밀번호). __SET_ME__ 는 10자라 걸리지 않는다.
  //   YAML 맵(KEY: 값)·Dockerfile ENV/ARG 형태는 아래 NONCODE_SECRET_RES(코드 파일의 객체 리터럴 KEY: process.env.X 오탐 방지).
  /^\s*(?:-\s+)?(?:export\s+)?(?=[A-Z])[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|_HASH)[A-Z0-9_]*\s*=\s*['"]?(?![$<{])[^\s'"<>{}()]{16,}/,
  // GitHub 토큰(classic ghp_ · OAuth gho_ · 사용자-서버 ghu_ · 서버-서버 ghs_ · 갱신 ghr_ · fine-grained github_pat_).
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9]{22,}_[A-Za-z0-9]{40,}\b/,
  // Resend API 키(re_<8>_<24> 형태, 대문자·숫자를 섞음 — 스네이크 식별자 re_foo_bar 와 구분).
  /\bre_(?=[A-Za-z0-9_]*[0-9])(?=[A-Za-z0-9_]*[A-Z])[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}\b/,
];
// 코드가 아닌 파일(deploy/·워크플로·env·yml·셸·Caddyfile·Dockerfile)에만: bcrypt 해시(basic_auth WS_BASIC_HASH 등).
//   코드에는 의도한 더미 해시가 있다(server/src/auth/user.repo.ts DUMMY_PASSWORD_HASH — 타이밍 균등화, 원문 폐기).
const SECRET_NAME = String.raw`(?=[A-Z])[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|_HASH)[A-Z0-9_]*`;
const SECRET_VALUE = String.raw`['"]?(?![$<{])[^\s'"<>{}()#]{16,}`;
const NONCODE_SECRET_RES = [
  /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/,
  // YAML 맵(compose environment: 아래 KEY: 값, 따옴표 있든 없든) — QA148 LOW-1.
  new RegExp(String.raw`^\s*(?:-\s+)?${SECRET_NAME}\s*:\s+${SECRET_VALUE}`),
  // Dockerfile ENV KEY=값 · ENV KEY 값 · ARG KEY=값 — QA148 LOW-1.
  new RegExp(String.raw`^\s*(?:ENV|ARG)\s+${SECRET_NAME}(?:\s*=\s*|\s+)${SECRET_VALUE}`),
];
// 배포 실값 파일 이름(MED-1): deploy/ 아래 *.env(server.env·caddy.env 등)는 서버에만 — 작업 트리에 있으면(추적 여부 무관) FAIL.
//   *.env.example 은 예시(값 0 은 deploy-config.test.mjs). 저장소 어디서든 git 이 추적하는 *.env 도 FAIL(checkTrackedEnv).
const DEPLOY_REAL_ENV_RE = /^deploy\/(?:.*\/)?[^/]+\.env$/;
//   server.env · prod.env.local 은 잡고, config.env.test.ts · x.env.json 같은 코드·데이터 파일은 잡지 않는다.
const TRACKED_ENV_RE = /^[^.][^/]*\.env(?:\.(?!(?:[cm]?[jt]sx?|json|ya?ml|md|txt|example)$)[A-Za-z0-9_-]+)?$/;

const isTestFile = (rel) => /(^|\/)__tests__\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.startsWith('client/src/test/');

function lines(s) {
  return s.split('\n');
}

// ── 코드 파일 ───────────────────────────────────────────────
function scanCode(rel, text, ctx) {
  const { add, bw } = ctx;
  const self = SELF_FILES.has(rel);
  const { code, bare, strings } = lexJs(text);
  const codeL = lines(code);
  const bareL = lines(bare);

  // C1-LIB — import/require
  codeL.forEach((l, i) => {
    const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(l)) !== null) {
      if (isBannedImport(m[1], rel)) add('C1-LIB', 'FAIL', rel, i + 1, `수집·크롤·스케줄 라이브러리 import: ${m[1]}`);
    }
  });

  if (!self) {
    // C1-FETCH — 같은 줄 네트워크 호출 + 비로컬 절대 URL
    const stringsByLine = new Map();
    for (const s of strings) {
      if (!stringsByLine.has(s.line)) stringsByLine.set(s.line, []);
      stringsByLine.get(s.line).push(s.text);
    }
    const externalIn = (txt) => {
      const out = [];
      ABS_URL_RE.lastIndex = 0;
      let m;
      while ((m = ABS_URL_RE.exec(txt)) !== null) {
        if (LOCAL_HOST.test(m[2])) continue;
        if (fetchHostAllowed(rel, txt, m)) continue;
        out.push(m[1]);
      }
      return out;
    };
    const urlConsts = new Map();
    codeL.forEach((l, i) => {
      const m = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*[`'"]((?:https?|wss?):\/\/[^`'"]*)/.exec(l);
      if (m && externalIn(m[2]).length > 0) urlConsts.set(m[1], i + 1);
    });
    codeL.forEach((l, i) => {
      if (!NET_CALL_RE.test(l)) return;
      const ext = (stringsByLine.get(i + 1) ?? []).flatMap(externalIn);
      if (ext.length > 0) add('C1-FETCH', 'FAIL', rel, i + 1, `외부 절대 URL 네트워크 호출: ${ext[0]}`);
      for (const [name] of urlConsts) {
        const re = new RegExp(`(?:\\b(?:fetch|axios(?:\\.\\w+)?|got(?:\\.\\w+)?|request|sendBeacon|undici\\.\\w+|https?\\.(?:get|request))|\\bnew\\s+(?:XMLHttpRequest|WebSocket|EventSource)|\\.open)\\s*\\([^)]*\\b${name.replace(/\$/g, '\\$')}\\b`);
        if (re.test(l)) add('C1-FETCH', 'FAIL', rel, i + 1, `외부 URL 상수 ${name} 로 네트워크 호출`);
      }
    });

    // C1-SDK
    codeL.forEach((l, i) => {
      if (SHOP_API_RE.test(l) && !shopApiLineAllowed(rel, l)) add('C1-SDK', 'FAIL', rel, i + 1, '쇼핑 오픈API 호스트 전면 금지');
      MAP_HOST_RE.lastIndex = 0;
      let mm;
      let sdk = false;
      let web = false;
      while ((mm = MAP_HOST_RE.exec(l)) !== null) {
        if (isBareWebMapHost(l, mm)) web = true;
        else sdk = true;
      }
      if (sdk && !SDK_ALLOWED(rel)) add('C1-SDK', 'FAIL', rel, i + 1, '지도 SDK 호스트는 client/src/map/**·server/src/middleware/spa.ts(+테스트) 만');
      if (web && !WEB_MAP_ALLOWED(rel)) add('C1-SDK', 'FAIL', rel, i + 1, '지도 웹 딥링크 호스트 map.naver.com 은 server/src/engine/links.ts(+테스트) 만 — 클라는 @ws/engine 헬퍼');
    });

    // C2-TRADE — 라우트 문자열
    for (const s of strings) {
      if (s.text.startsWith('/') && TRADE_ROUTE_RE.test(s.text)) add('C2-TRADE', 'FAIL', rel, s.line, `거래·분양 라우트: ${s.text}`);
    }
    // C2-TRADE — 식별자
    bareL.forEach((l, i) => {
      const re = /[A-Za-z_$][\w$]*/g;
      let m;
      while ((m = re.exec(l)) !== null) {
        const tok = m[0];
        const low = tok.toLowerCase();
        const parts = tok.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_$]+/).map((p) => p.toLowerCase());
        if (parts.some((p) => TRADE_PARTS.has(p)) || low.includes('merchantid') || low.includes('paymentkey')) {
          add('C2-TRADE', 'FAIL', rel, i + 1, `거래·자금 식별자: ${tok}`);
        }
      }
      const ko = /(?:\b(?:const|let|var|function|class|type|interface)\s+|\.)([\w$가-힣]*(?:정산|분양|입양신청)[\w$가-힣]*)|([\w$가-힣]*(?:정산|분양|입양신청)[\w$가-힣]*)\s*(?=[=(])/g;
      while ((m = ko.exec(l)) !== null) {
        const tok = m[1] ?? m[2];
        if (tok && TRADE_KO.test(tok)) add('C2-TRADE', 'FAIL', rel, i + 1, `거래·분양 식별자: ${tok}`);
      }
    });

    // C5-GEO — 좌표 토큰 ±6줄에 전송·영속
    const seen = new Set();
    bareL.forEach((l, i) => {
      if (!COORD_RE.test(l)) return;
      const lo = Math.max(0, i - GEO_PROXIMITY);
      const hi = Math.min(codeL.length - 1, i + GEO_PROXIMITY);
      for (let k = lo; k <= hi; k++) {
        if (GEO_ACT_RE.test(codeL[k])) {
          if (!seen.has(i)) add('C5-GEO', 'FAIL', rel, i + 1, `좌표가 ${k + 1}행의 전송·영속과 근접`);
          seen.add(i);
          break;
        }
      }
    });
  }

  // C3-QUERY — 콘텐츠 모델 조회는 노출 모듈 import 필수(server/src 비테스트·비seed)
  if (rel.startsWith('server/src/') && !isTestFile(rel) && !rel.startsWith('server/src/seed/')) {
    const hasImport = EXPOSURE_IMPORT_RE.test(code);
    codeL.forEach((l, i) => {
      if (CONTENT_QUERY_RE.test(l) && !hasImport) add('C3-QUERY', 'FAIL', rel, i + 1, '콘텐츠 모델 조회에 engine/(index|exposure) import 없음');
    });
  }

  // C4-CODE — 코드 문자열·JSX 텍스트 금지어(R4 FAIL, R3 D10 전환)
  if ((rel.startsWith('client/src/') || rel.startsWith('server/src/')) && !isTestFile(rel) && rel !== 'server/src/seed/lint.ts') {
    const report = (txt, line) => {
      for (const h of lintText(txt, bw)) {
        if (h.rule === 'L02') continue;
        add('C4-CODE', 'FAIL', rel, line, `코드 리터럴 금지어 "${h.term}"${h.rule === 'L06' ? '(공백 제거 후)' : ''}`);
      }
    };
    for (const s of strings) report(s.text, s.line);
    if (/\.[jt]sx$/.test(rel)) {
      bareL.forEach((l, i) => {
        for (const seg of l.split(/[<>{}]/)) if (/[가-힣]/.test(seg)) report(seg, i + 1);
      });
    }
  }

  if (!self) scanClientServerSafety(rel, codeL, strings, add);
}

// B3-4 — 클라 위치·저장·쿠키·인라인 실행(client/src), 서버 쿠키 발급(server/src 비테스트). scanCode 끝에서 호출.
function scanClientServerSafety(rel, codeL, strings, add) {
  const test = isTestFile(rel);
  if (rel.startsWith('client/src/')) {
    codeL.forEach((l, i) => {
      if (GEOLOC_RE.test(l)) add('C5-GEO', 'FAIL', rel, i + 1, '위치 API(navigator.geolocation 등) 금지 — 지역은 URL 텍스트만(D14, 불변식 ⑧)');
      if (!test && !STORAGE_ALLOWED(rel) && STORAGE_RE.test(l)) add('C9-STORAGE', 'FAIL', rel, i + 1, 'localStorage·sessionStorage 는 client/src/lib/storage.ts 만');
      if (CLIENT_COOKIE_RE.test(l)) add('C9-STORAGE', 'FAIL', rel, i + 1, 'document.cookie·cookieStore 금지 — 세션은 서버 HttpOnly 쿠키만');
    });
    if (!test) {
      for (const s of strings) {
        if (JS_URL_RE.test(s.text)) add('C8-SRC-SAFE', 'FAIL', rel, s.line, 'javascript:/vbscript: URL 문자열');
        if (INLINE_HANDLER_MARKUP_RE.test(s.text)) add('C8-SRC-SAFE', 'FAIL', rel, s.line, '문자열 마크업에 on*= 인라인 핸들러');
      }
      codeL.forEach((l, i) => {
        if (SET_ON_ATTR_RE.test(l) || ON_PROP_STRING_RE.test(l)) add('C8-SRC-SAFE', 'FAIL', rel, i + 1, 'on* 핸들러를 문자열로 설정');
      });
      if (/\.[jt]sx$/.test(rel)) {
        codeL.forEach((l, i) => {
          if (JSX_ON_STRING_RE.test(l)) add('C8-SRC-SAFE', 'FAIL', rel, i + 1, 'JSX on* 핸들러에 문자열 값');
        });
      }
    }
  }
  if (rel.startsWith('server/src/') && !test) {
    codeL.forEach((l, i) => {
      if (COOKIE_EMIT_RE.test(l) && !COOKIE_EMIT_ALLOWED.has(rel)) {
        add('C9-COOKIE', 'FAIL', rel, i + 1, 'Set-Cookie 발급은 save/magic.routes.ts(ws_sid)·auth/auth.routes.ts(ws_op_rt) 만');
      }
    });
    for (const s of strings) {
      if (COOKIE_SER_RE.test(s.text) && !COOKIE_SER_ALLOWED.has(rel)) {
        add('C9-COOKIE', 'FAIL', rel, s.line, '쿠키 속성 직렬화(HttpOnly·Max-Age·SameSite)는 save/cookie.ts·auth/auth.routes.ts 만');
      }
    }
    if (COOKIE_SER_ALLOWED.has(rel)) checkCookieFlags(rel, codeL, add);
    if (COOKIE_EMIT_ALLOWED.has(rel)) {
      codeL.forEach((l, i) => {
        if (/set-cookie/i.test(l) && /\bfalse\b/.test(l)) add('C9-COOKIE', 'FAIL', rel, i + 1, 'Set-Cookie 발급에 secure=false 리터럴 — 운영 Secure 조건 무력화');
      });
    }
    if (rel === SPA_FILE) checkSpaCsp(rel, codeL, add);
  }
}

/** C9-COOKIE 플래그 — 허용 직렬화 파일의 쿠키 템플릿 줄마다 HttpOnly·SameSite(Lax|Strict)·Secure(무조건 또는 조건부). */
function checkCookieFlags(rel, codeL, add) {
  let templates = 0;
  codeL.forEach((l, i) => {
    if (!COOKIE_TEMPLATE_RE.test(l)) return;
    templates++;
    const miss = [];
    if (!COOKIE_HTTPONLY_RE.test(l)) miss.push('HttpOnly');
    if (!COOKIE_SAMESITE_RE.test(l)) miss.push('SameSite=Lax|Strict');
    if (!COOKIE_SECURE_RE.test(l) && !COOKIE_SECURE_COND_RE.test(l)) miss.push('Secure(무조건 또는 운영 조건부)');
    if (/SameSite\s*=\s*None/i.test(l)) miss.push('SameSite=None 금지');
    if (miss.length) add('C9-COOKIE', 'FAIL', rel, i + 1, `쿠키 템플릿 플래그 누락·위반: ${miss.join(', ')}`);
  });
  if (templates === 0) add('C9-COOKIE', 'FAIL', rel, null, '쿠키 템플릿(Max-Age=)을 찾지 못함 — 플래그 검사 불가(fail-closed)');
}

/** `const NAME = [ … ]` 또는 `export const NAME = [ … ].join(…)` 블록의 줄 범위(코드 기준, 0-based) — 없으면 null. */
function constBlock(codeL, name) {
  const start = codeL.findIndex((l) => new RegExp(`^\\s*(?:export\\s+)?const\\s+${name}\\b`).test(l));
  if (start < 0) return null;
  let depth = 0;
  for (let k = start; k < codeL.length; k++) {
    for (const ch of codeL[k]) {
      if (ch === '[' || ch === '(' || ch === '{') depth++;
      else if (ch === ']' || ch === ')' || ch === '}') depth--;
    }
    if (depth <= 0 && /[;\]]\s*(?:\.join\([^)]*\))?\s*;?\s*$/.test(codeL[k])) return [start, k];
  }
  return [start, codeL.length - 1];
}

/** CSP — 기본 정책 SPA_CSP(+ 펼친 상수)에 지도 호스트 0, 지도 호스트 리터럴은 VET_CSP 정의 안에만, VET_CSP 는 /vet 분기에서만. */
function checkSpaCsp(rel, codeL, add) {
  const spa = constBlock(codeL, 'SPA_CSP');
  if (!spa) {
    add('C1-SDK', 'FAIL', rel, null, 'SPA_CSP 상수를 찾지 못함 — 기본 CSP 검사 불가(fail-closed)');
    return;
  }
  const blocks = [spa];
  const spaText = codeL.slice(spa[0], spa[1] + 1).join('\n');
  for (const m of spaText.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) {
    const b = constBlock(codeL, m[1]);
    if (b) blocks.push(b);
  }
  for (const [a, b] of blocks) {
    for (let k = a; k <= b; k++) {
      if (CSP_EXT_HOST_RE.test(codeL[k])) add('C1-SDK', 'FAIL', rel, k + 1, '기본 CSP(SPA_CSP)에 네이버·pstatic 호스트 — 지도 호스트는 VET_CSP(/vet)만(D21)');
    }
  }
  const vet = constBlock(codeL, 'VET_CSP');
  codeL.forEach((l, k) => {
    const inVet = vet && k >= vet[0] && k <= vet[1];
    if (!inVet && CSP_EXT_HOST_RE.test(l) && !blocks.some(([a, b]) => k >= a && k <= b)) {
      add('C1-SDK', 'FAIL', rel, k + 1, '지도 호스트 리터럴은 VET_CSP 정의 안에만(D21)');
    }
    if (!inVet && /\bVET_CSP\b/.test(l) && !(/['"`]\/vet['"`]/.test(l) && /['"`]\/vet\/['"`]/.test(l) && /\bSPA_CSP\b/.test(l))) {
      add('C1-SDK', 'FAIL', rel, k + 1, 'VET_CSP 는 /vet·/vet/ 분기(… ? VET_CSP : SPA_CSP)에서만 — 전 경로 적용 금지(D21)');
    }
  });
}

/** client/index.html(소스 템플릿) — on*= 속성·javascript: 값 0(C8-SRC-SAFE). */
function scanSourceHtml(rel, text, add) {
  for (const t of tags(text)) {
    for (const [k, v] of Object.entries(t.attrs)) {
      if (/^on/i.test(k)) add('C8-SRC-SAFE', 'FAIL', rel, null, `<${t.name} ${k}=> 인라인 핸들러`);
      if (typeof v === 'string' && /(?:javascript|vbscript):/i.test(v.replace(/[\u0000-\u0020]/g, ''))) add('C8-SRC-SAFE', 'FAIL', rel, null, `<${t.name} ${k}> javascript: 값`);
    }
  }
}

// ── prisma 스키마 ───────────────────────────────────────────
function scanPrisma(rel, text, ctx) {
  const { add } = ctx;
  const L = lines(stripSlashComments(text));
  let model = null;
  L.forEach((l, i) => {
    const m = /^\s*model\s+(\w+)\s*\{/.exec(l);
    if (m) {
      model = m[1];
      if (TRADE_MODELS.test(model)) add('C2-TRADE', 'FAIL', rel, i + 1, `거래·분양·결제 모델: ${model}`);
      return;
    }
    if (/^\s*(enum|type|view)\s+\w+\s*\{/.test(l)) {
      model = null;
      return;
    }
    if (/^\s*\}/.test(l)) {
      model = null;
      return;
    }
    if (!model) return;
    const f = /^\s*([A-Za-z_]\w*)\s+\S/.exec(l);
    if (!f) return;
    if (PRICE_FIELD.test(f[1])) add('C2-PRICE', 'FAIL', rel, i + 1, `가격·가맹 컬럼: ${model}.${f[1]}`);
    if (GEO_FIELD.test(f[1]) && model !== 'VetClinic') add('C5-GEO', 'FAIL', rel, i + 1, `좌표 컬럼은 VetClinic 만: ${model}.${f[1]}`);
  });
}

// ── package.json ×3 ─────────────────────────────────────────
function scanPackage(rel, text, ctx) {
  let pkg;
  try {
    pkg = JSON.parse(stripBom(text));
  } catch {
    ctx.add('C1-LIB', 'FAIL', rel, null, 'package.json 파싱 실패(검사 불가)');
    return;
  }
  for (const sec of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies']) {
    const deps = pkg?.[sec];
    if (!deps || typeof deps !== 'object') continue;
    for (const name of Array.isArray(deps) ? deps : Object.keys(deps)) {
      if (isBannedDep(name, sec, rel)) ctx.add('C1-LIB', 'FAIL', rel, null, `${sec} 에 금지 라이브러리: ${name}`);
      if (name === 'jsdom' && sec !== 'devDependencies') ctx.add('C1-LIB', 'FAIL', rel, null, `jsdom 은 devDependencies 만(현재 ${sec})`);
    }
  }
}

// ── 시드 ────────────────────────────────────────────────────
const SEED_TEXT_SKIP = new Set(['id', 'url', 'sourceUrl', 'licenseUrl', 'verifiedBy', 'slug', 'accessedAt']);

function walkJson(v, path, visit) {
  if (Array.isArray(v)) v.forEach((x, i) => walkJson(x, `${path}[${i}]`, visit));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      visit({ kind: 'key', key: k, value: x, path: path ? `${path}.${k}` : k });
      walkJson(x, path ? `${path}.${k}` : k, visit);
    }
  } else if (typeof v === 'string') visit({ kind: 'string', value: v, path });
}

const lastKey = (path) => {
  const m = /(?:^|\.)([^.[\]]+)(?:\[\d+\])*$/.exec(path);
  return m ? m[1] : '';
};

/**
 * R6 B1(SEC-4 L-4): C4-STEM 을 FAIL 로 올리는 시드 행 — 노출 후보(승격된) 상태.
 *   reviewStatus=VERIFIED(reviewerType 무관 — AI_DRAFT 위장도 포함) · vet verification.status=VERIFIED ·
 *   후기 status=APPROVED. 그 외(DRAFT·SLOT·IN_REVIEW 등)는 WARN 유지(운영자 검토 대상).
 */
function stemFailRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  if (row.reviewStatus === 'VERIFIED') return true;
  if (row.verification && typeof row.verification === 'object' && row.verification.status === 'VERIFIED') return true;
  return row.status === 'APPROVED';
}

function scanSeedFile(rel, text, ctx) {
  const { add, bw } = ctx;
  const file = basename(rel);
  let rows;
  try {
    rows = JSON.parse(stripBom(text));
  } catch (e) {
    add('C0-SEED', 'FAIL', rel, null, `시드 JSON 파싱 실패: ${e.message}`);
    return;
  }
  if (!Array.isArray(rows)) {
    add('C0-SEED', 'FAIL', rel, null, '시드 최상위가 배열이 아니다');
    return;
  }
  rows.forEach((row, ri) => {
    const where = `${file}#${row && typeof row.id === 'string' ? row.id : `[${ri}]`}`;
    walkJson(row, '', (n) => {
      if (n.kind === 'key') {
        if (GEO_KEY.test(n.key) && file !== SEED_FILES.vetClinics) add('C5-GEO', 'FAIL', rel, null, `${where} ${n.path}: 좌표 키는 vet-clinics.json 만`);
        if ((n.key === 'imageAsset' || n.key === 'reviewerImage') && n.value !== null && n.value !== undefined) {
          const re = n.key === 'imageAsset' ? PRODUCT_IMAGE_ASSET_RE : REVIEWER_IMAGE_RE;
          const ok = typeof n.value === 'string' && re.test(n.value);
          if (!ok) add('C1-SEEDURL', 'FAIL', rel, null, `${where} ${n.path}: /assets/(products|reviewers)/<kebab>.(webp|avif|jpg|jpeg|png) 운영자 자산만 (${String(n.value)})`);
        }
        return;
      }
      const key = lastKey(n.path);
      // C1-SEEDURL — http(s) 는 source[].url·sourceUrl 만 + photos.licenseUrl(creativecommons.org 증서 허용목록만, S1 M-3)
      const ccLicense = file === SEED_FILES.photos && n.path === 'licenseUrl' && ccLicenseOfUrl(n.value) !== null;
      if (/(?:https?|wss?|ftp):\/\//i.test(n.value) && !/(^|\.)source\[\d+\]\.url$/.test(n.path) && key !== 'sourceUrl' && !ccLicense) {
        add('C1-SEEDURL', 'FAIL', rel, null, `${where} ${n.path}: 외부 URL 은 source[].url·sourceUrl 에만(사진 licenseUrl 은 CC 증서만)`);
      }
      // C4-BANNED — 제외: id/url/sourceUrl/source.title/verifiedBy/slug, photos.query·scene
      if (SEED_TEXT_SKIP.has(key)) return;
      if (/(^|\.)source\[\d+\]\.title$/.test(n.path)) return;
      if (file === SEED_FILES.photos && (key === 'query' || key === 'scene')) return;
      for (const h of lintText(n.value, bw)) {
        if (h.rule === 'L01') add('C4-BANNED', 'FAIL', rel, null, `${where} ${n.path}: 금지어 "${h.term}"`);
        else if (h.rule === 'L06') add('C4-BANNED', 'WARN', rel, null, `${where} ${n.path}: 공백 제거 후 2자 금지어 "${h.term}"`);
        else add('C4-STEM', stemFailRow(row) ? 'FAIL' : 'WARN', rel, null, `${where} ${n.path}: 금지어 어간 "${h.term}"`);
      }
    });

    // C6-IMG
    if (!row || typeof row !== 'object') return;
    // L3(R5 B3-2): SLOT 이 아닌 사진은 isPhotoUsableRow(engine isPhotoUsable 패리티)와 같은 엄격도 — READY 상태만,
    //   https + 점 있는 호스트, 출처별 호스트 허용목록·userinfo 거부(M-1), 달력상 downloadedAt, CC BY-SA 원본·카드 슬롯(L8).
    if (file === SEED_FILES.photos && row.status !== 'SLOT') {
      const miss = [];
      if (!PHOTO_USABLE_STATUSES.has(row.status)) miss.push(`status(${row.status})`);
      if (!PHOTO_LICENSES.has(row.license)) miss.push(`license(${row.license})`);
      if (typeof row.source !== 'string' || row.source.trim() === '') miss.push('source');
      if (typeof row.sourceUrl !== 'string' || !photoSourceUrlAllowed(row.source, row.sourceUrl)) miss.push('sourceUrl(https·출처별 호스트 허용목록·userinfo 금지)');
      if (dayNumber(row.downloadedAt) === null) miss.push('downloadedAt');
      if (row.license !== 'CC0' && (typeof row.author !== 'string' || row.author.trim() === '')) miss.push('author');
      if ((row.license === 'CC_BY' || row.license === 'CC_BY_SA') && ccLicenseOfUrl(row.licenseUrl) !== row.license) miss.push('licenseUrl(CC 증서)');
      if (!ccBySaPlacementOk(row)) miss.push('CC_BY_SA 배치(원본 그대로·카드 슬롯만 — 히어로·합성 금지)');
      if (!miss.length && !isPhotoUsableRow(row)) miss.push('사용 가능 판정 불일치');
      if (miss.length) add('C6-IMG', 'FAIL', rel, null, `${where}: 사용권 기록 누락·위반 ${miss.join(', ')}`);
    }
    if (file === SEED_FILES.curatedProducts && row.imageAsset !== null && row.imageAsset !== undefined && row.imageAsset !== '') {
      if (!PRODUCT_IMAGE_LICENSES.has(row.imageLicense)) add('C6-IMG', 'FAIL', rel, null, `${where}: imageAsset 있는데 imageLicense=${row.imageLicense}`);
    }
    if (file === SEED_FILES.testimonials && row.reviewerImage !== null && row.reviewerImage !== undefined && row.reviewerImage !== '') {
      if (row.reviewerImageConsent !== true) add('C6-IMG', 'FAIL', rel, null, `${where}: reviewerImage 동의 없음`);
    }
  });
}

// ── C3-GUARDTEST ────────────────────────────────────────────
function checkGuardTests(root, add) {
  const files = walk(join(root, 'server', 'src')).filter((f) => isTestFile(relPosix(root, f)) && CODE_EXT.has(extname(f)));
  const texts = files.map((f) => readFileSync(f, 'utf8'));
  const need = [
    ['V01 ∧ AI_DRAFT', (t) => /\bV01\b/.test(t) && /AI_DRAFT/.test(t)],
    ['isVerified ∧ AI_DRAFT', (t) => /\bisVerified\b/.test(t) && /AI_DRAFT/.test(t)],
    ['isTestimonialExposable', (t) => /\bisTestimonialExposable\b/.test(t)],
  ];
  for (const [name, pred] of need) {
    if (!texts.some(pred)) add('C3-GUARDTEST', 'FAIL', 'server/src/__tests__', null, `가드 테스트 없음: ${name}`);
  }
}

// ── C7 git 추적 .env ────────────────────────────────────────
function checkTrackedEnv(root, add, notes) {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0) {
    notes.push('C7 git ls-files: NOT RUN (git 저장소 아님)');
    return;
  }
  const ls = spawnSync('git', ['-C', root, 'ls-files', '-z', '--', '.'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (ls.status !== 0) {
    notes.push('C7 git ls-files: NOT RUN (git 오류)');
    return;
  }
  for (const f of ls.stdout.split('\0').filter(Boolean)) {
    const b = f.split('/').pop();
    if (b.endsWith('.example')) continue;
    // .env · .env.local · server.env · caddy.env · prod.env.local 등(MED-1: 예전엔 점으로 시작하는 .env* 만 봤다).
    if (/^\.env(\..*)?$/.test(b) || TRACKED_ENV_RE.test(b)) add('C7-SECRET', 'FAIL', f, null, 'git 추적 중인 .env 파일');
  }
}

/** 소스 규칙 전체. @returns {{ files: number }} */
export function scanSources(root, ctx, notes) {
  const { add } = ctx;
  const files = [];
  for (const d of SCAN_DIRS) {
    const abs = join(root, ...d.split('/'));
    if (isDir(abs)) walk(abs, files);
  }
  // 루트 수준 텍스트 파일(시크릿) + package.json ×3 + 워크플로
  const extra = [];
  try {
    for (const ent of readdirSync(root, { withFileTypes: true })) {
      if (ent.isFile() && (TEXT_EXT.has(extname(ent.name)) || /^Dockerfile/.test(ent.name))) extra.push(join(root, ent.name));
    }
  } catch {
    /* 루트 없음은 상위에서 처리 */
  }
  walk(join(root, '.github', 'workflows'), extra);
  // 배포 구성(deploy/ — compose·Caddyfile·*.sh): 시크릿 패턴(C7)만 해당. 예시(*.example)는 아래에서 건너뛴다(값 0 은 deploy-config.test.mjs).
  walk(join(root, 'deploy'), extra);
  for (const p of ['client/package.json', 'server/package.json', 'client/index.html', 'client/vite.config.ts']) {
    const abs = join(root, ...p.split('/'));
    if (existsSync(abs)) extra.push(abs);
  }

  let count = 0;
  for (const abs of [...files, ...extra]) {
    const rel = relPosix(root, abs);
    const ext = extname(abs);
    if (abs.endsWith('.example')) continue;
    if (DEPLOY_REAL_ENV_RE.test(rel)) add('C7-SECRET', 'FAIL', rel, null, '배포 실값 env 파일이 작업 트리에 있다 — 서버(/opt/withsmall)에만 둔다(저장소에는 *.example 만)');
    if (ext && !TEXT_EXT.has(ext) && !/^Dockerfile/.test(basename(abs)) && !(rel.startsWith('deploy/') && ext === '.sh')) continue;
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    count++;
    // C7-SECRET — 원문 줄(주석 속 키도 유출)
    lines(text).forEach((l, i) => {
      for (const re of SECRET_RES) if (re.test(l)) add('C7-SECRET', 'FAIL', rel, i + 1, `하드코딩 시크릿 패턴 ${re.source.slice(0, 24)}…`);
      if (!CODE_EXT.has(ext)) for (const re of NONCODE_SECRET_RES) if (re.test(l)) add('C7-SECRET', 'FAIL', rel, i + 1, `하드코딩 시크릿 패턴 ${re.source.slice(0, 24)}…`);
    });
    if (['package.json', 'client/package.json', 'server/package.json'].includes(rel)) {
      scanPackage(rel, text, ctx);
    }
    if (rel === 'client/index.html') scanSourceHtml(rel, text, add);
    if (CODE_EXT.has(ext)) scanCode(rel, text, ctx);
    else if (ext === '.prisma' && rel.startsWith('server/prisma/')) scanPrisma(rel, text, ctx);
    else if (ext === '.json' && rel.startsWith('server/seed/') && !rel.slice('server/seed/'.length).includes('/')) scanSeedFile(rel, text, ctx);
  }
  checkGuardTests(root, add);
  checkTrackedEnv(root, add, notes);
  return { files: count };
}
