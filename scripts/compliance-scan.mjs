#!/usr/bin/env node
// Outget 컴플라이언스 / 시크릿 정적 스캐너.
// 의존성 0 — node 빌트인(node:fs / node:path)만 사용.
// 규칙은 .claude/skills/knockedu-qa/SKILL.md 의 5 불변식과 1:1 일치한다.
//
// 사용법:
//   node scripts/compliance-scan.mjs            # 사람용 출력, 위반 시 exit 1
//   node scripts/compliance-scan.mjs --json     # 기계용 JSON, 위반 시 exit 1
//
// 깨끗한 트리 → exit 0. 위반 1건 이상 → exit 1 + "파일:라인:규칙" 출력.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');

// 스캔 대상 트리.
const SCAN_DIRS = ['client/src', 'server/src', 'scripts'];

// 디렉터리 제외(이름 일치).
const EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  'dev-dist',
  '.git',
]);

// 파일 제외: *.example, 자기 자신, 비텍스트 확장자.
const SELF = resolve(__filename);
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.yml', '.yaml', '.md', '.css', '.html',
]);

function isExcludedFile(absPath) {
  if (absPath === SELF) return true;
  if (absPath.endsWith('.example')) return true;
  // .env.example 류(placeholder)는 시크릿 규칙에서 제외 — 위 .example 검사로 포괄.
  const ext = extname(absPath);
  if (ext && !TEXT_EXT.has(ext)) return true;
  return false;
}

// ── 화이트리스트(매칭 제외 토큰) — 네이버 지도/쇼핑 공식 API 도메인 ───────────
// 면제는 "줄 단위 언급"이 아니라 (a) 매칭된 그 외부 URL 토큰 자체가 화이트 도메인,
// 또는 (b) 명시적 SDK 로드 패턴(script.src / 스크립트 주입 / 지도 SDK URL) 일 때만.
// (MED 수정) 무관한 주석에 네이버 도메인이 섞여도 같은 줄의 다른 위반은 잡힌다.
const R1_WHITELIST = [
  /openapi\.naver\.com/i,        // 네이버쇼핑 API (정가 조회, 약관 내)
  /oapi\.map\.naver\.com/i,      // 네이버 지도 SDK
  /[a-z0-9.-]*\.map\.naver\.com/i, // *.map.naver.com 지도 SDK
  /naveropenapi/i,               // 네이버 지도/오픈API SDK 식별자
];

// SDK 로드(스크립트 주입) 패턴 — 본문수집이 아니라 지도 SDK 로드.
const R1_SDK_LOAD = /(script\.src\s*=|createElement\(\s*['"]script['"]\)|<script\b)/i;

// 주어진 "외부 URL 토큰"(R1_FETCH_EXTERNAL 등이 잡은 URL 문자열)이 화이트 도메인인가.
function isWhitelistedUrl(urlToken) {
  return R1_WHITELIST.some((re) => re.test(urlToken));
}

// 한 줄에 등장하는 모든 절대 http(s) URL 리터럴을 추출.
const URL_LITERAL = /[`'"](https?:\/\/[^`'"\s]+)[`'"]/gi;
function extractUrls(line) {
  const out = [];
  let m;
  URL_LITERAL.lastIndex = 0;
  while ((m = URL_LITERAL.exec(line)) !== null) out.push(m[1]);
  return out;
}

// ── 규칙 정의 ────────────────────────────────────────────────────────────────
// 각 규칙: { id, test(line, ctx) -> boolean }.
// 라인 단위 평가(시크릿 PRIVATE KEY 헤더도 한 줄에 등장).

// R1 무크롤링: 스크래핑/헤드리스/크롤 키워드, 또는 외부 도메인 대상 fetch.
const R1_KEYWORDS = /puppeteer|playwright|cheerio|headless|\.scrape|crawl/i;
// 외부 도메인(브랜드·아울렛·SNS·쇼핑몰·커뮤니티) 대상 cron/scheduled fetch 휴리스틱:
// cron/schedule/setInterval 문맥에서 외부 http(s) fetch 를 거는 패턴.
const R1_CRON = /(cron|schedule|setInterval|node-cron)/i;
const R1_FETCH_EXTERNAL = /(fetch|axios|got|request)\s*\(\s*[`'"]https?:\/\//i;

// (HIGH 수정) on-demand 외부 본문 fetch.
// 네트워크 호출(fetch/axios/got/request)이 절대 http(s) URL 을 향하면 R1 위반으로 본다.
// 면제: 그 URL 이 네이버 화이트 도메인이거나, localhost/127.0.0.1(자사 dev) 일 때.
// (상대경로 /api·자사 도메인은 애초에 절대 http(s) URL 이 아니므로 자동 면제.)
const R1_NET_CALL = /\b(fetch|axios|got|request)\b/i;
const R1_SELFHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i;

// R2 자금 미보유.
const R2_KEYWORDS = /escrow|payout|정산|예치|환불|refund/i;
// 서버측 플랫폼 PG 가맹점: merchantId 와 charge|capture 동반(같은 줄).
const R2_MERCHANT = /merchantId/i;
const R2_PG_VERB = /\b(charge|capture)\b/i;
// 서버측 balance 보유: balance 를 보유/적립/증감하는 패턴.
const R2_BALANCE = /\b(balance)\b\s*[:=+\-]|(?:platform|user|wallet)\s*\.?\s*balance/i;

// R3 위치 비실시간: 사용자 위경도 서버 저장/전송 패턴.
// 위경도 토큰 + (서버 영속/전송 동사) 동반(같은 줄). 클라 메모리 일시 사용은 허용.
const R3_COORD = /\b(lat|lng|latitude|longitude|coords)\b/i;
// 서버 저장 동사 — 영어 키워드만(한국어 주석 "컬럼/저장" 오탐 방지).
const R3_PERSIST = /\b(INSERT|save|create|column|schema)\b/i;
// 서버 전송 패턴 — POST .*/api (spec), 그리고 fetch/axios 로 /api 또는 coords 를
// 실어 보내는 호출(1.4 위경도 미전송 가드: fetch('/api/...', {lat,lng}) 도 포착).
const R3_API_POST = /POST\s+[^\n]*\/api/i;
const R3_SEND = /(?:fetch|axios)\s*\([^\n]*(?:\/api|coords)/i;

// (HIGH 수정) 위경도 멀티패턴 네트워크 전송.
// 휴리스틱: 좌표 토큰(R3_COORD)이 네트워크 전송 호출과 같은 함수블록/근접 N줄에 공존.
// 전송 호출: fetch/axios/sendBeacon/.emit/XMLHttpRequest/.post(/got/request.
// 단, 전송 호출은 "실제 코드 라인"에서만 인정(주석에 적힌 fetch/axios 는 무시).
// → useDefaultRegion.ts(getCurrentPosition→로컬 setState, 전송 없음)는 통과한다.
const R3_NET_SEND =
  /(\bfetch\s*\(|\baxios\b|\bsendBeacon\b|\.emit\s*\(|\bXMLHttpRequest\b|\.post\s*\(|\bgot\b|\brequest\s*\()/i;
const R3_PROXIMITY = 6; // 좌표↔전송 호출 근접 허용 줄 수.

// 줄에서 라인주석(//...)·블록주석 토막을 제거해 "실제 코드"만 남긴다.
// (정밀 파서는 아니지만 주석 속 fetch/axios 오탐 차단엔 충분.)
function stripComments(line) {
  let s = line.replace(/\/\*.*?\*\//g, ' '); // 한 줄 내 블록주석.
  const idx = s.indexOf('//');
  if (idx !== -1) s = s.slice(0, idx);
  return s;
}

// R4 링크 보증.
const R4_KEYWORDS = /verifyLink|linkSafety|validateExternalUrl|isSafeLink/i;
// 보증 + 링크 검증기(같은 줄에 "보증" 과 "링크").
const R4_KO = /(?=.*보증)(?=.*링크)/;

// R5 가격주장: 플랫폼 산정 단정 가격 변수.
const R5_KEYWORDS = /\b(platformPrice|ourPrice|officialPrice)\b/;

// ── 시크릿 규칙 ──────────────────────────────────────────────────────────────
// 네이버 클라이언트 헤더 리터럴(값 포함). 헤더 키 명만으로는 약하므로 값 동반 패턴.
const SEC_NAVER = /X-Naver-Client-(Id|Secret)\s*['"]?\s*[:=]\s*['"][^'"]+['"]/i;
// 하드코딩 api key.
const SEC_APIKEY = /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9]{16,}/i;
// 하드코딩 JWT 시크릿(JWT_*_SECRET = "리터럴 16+").
const SEC_JWT = /JWT[_A-Z]*SECRET\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/;
// PEM private key 헤더.
const SEC_PEM = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/;

// 라인 단위(line-local) 규칙. R3 멀티라인/근접 규칙은 checkFile 에서 별도 처리.
function checkLine(line) {
  const hits = [];
  // R4/R5는 변수·함수명 매칭이라 deny-list 주석(예: "// platformPrice 금지")이 false-positive.
  // R3처럼 주석을 제거한 실제 코드에만 적용한다. (R1/R2/시크릿은 raw line 유지 — 주석 속 키/예시도 잡아야 하므로.)
  const code = stripComments(line);

  // ── R1 무크롤링 ─────────────────────────────────────────────
  // (1) 스크래핑 키워드: 줄에 화이트 도메인이 "언급"만 돼도 면제하지 않는다(MED 수정).
  //     스크래핑 라이브러리 키워드 자체가 위반.
  if (R1_KEYWORDS.test(line)) hits.push('R1-무크롤링');

  // (2) 외부 절대 http(s) URL 을 향한 네트워크 호출(HIGH 수정 — on-demand 본문수집).
  //     줄에서 절대 URL 리터럴을 추출 → 화이트(네이버)/자사(localhost) 가 아닌
  //     외부 URL 이 하나라도 있고, 같은 줄에 네트워크 호출 토큰이 있으면 위반.
  //     SDK 로드(script.src=) 라인은 면제(지도 SDK 주입).
  else if (R1_NET_CALL.test(line) && !R1_SDK_LOAD.test(line)) {
    const externalUrls = extractUrls(line).filter(
      (u) => !isWhitelistedUrl(u) && !R1_SELFHOST.test(u),
    );
    if (externalUrls.length > 0) hits.push('R1-무크롤링');
  }
  // (3) cron/scheduled fetch (기존 휴리스틱 유지 — 외부 URL 추출에 안 걸리는 변형 보강용).
  if (
    !hits.includes('R1-무크롤링') &&
    R1_CRON.test(line) &&
    R1_FETCH_EXTERNAL.test(line) &&
    extractUrls(line).some((u) => !isWhitelistedUrl(u) && !R1_SELFHOST.test(u))
  ) {
    hits.push('R1-무크롤링');
  }

  // R2
  if (R2_KEYWORDS.test(line)) hits.push('R2-자금미보유');
  else if (R2_MERCHANT.test(line) && R2_PG_VERB.test(line)) hits.push('R2-자금미보유');
  else if (R2_BALANCE.test(line)) hits.push('R2-자금미보유');

  // R3 (라인 단위 — 같은 줄 영속/전송)
  if (R3_COORD.test(line)) {
    if (R3_PERSIST.test(line) || R3_API_POST.test(line) || R3_SEND.test(line)) {
      hits.push('R3-위치저장');
    }
  }

  // R4 (주석 제거 코드에만)
  if (R4_KEYWORDS.test(code) || R4_KO.test(code)) hits.push('R4-링크보증');

  // R5 (주석 제거 코드에만)
  if (R5_KEYWORDS.test(code)) hits.push('R5-가격주장');

  // 시크릿
  if (SEC_NAVER.test(line)) hits.push('SECRET-naver');
  if (SEC_APIKEY.test(line)) hits.push('SECRET-apikey');
  if (SEC_JWT.test(line)) hits.push('SECRET-jwt');
  if (SEC_PEM.test(line)) hits.push('SECRET-pem');

  return hits;
}

// 파일 단위 규칙 — R3 멀티라인/근접 위경도 전송.
// 좌표 토큰이 있는 줄을 기준으로, 근접 N줄(주석 제거 후 실제 코드) 안에
// 네트워크 전송 호출이 있으면 R3 위반으로 본다.
// 클라 로컬 사용(getCurrentPosition→setState, 전송 호출 없음)은 통과한다.
function checkFileR3(lines) {
  const hits = []; // { line: <coord 토큰 줄(1-based)> }
  const code = lines.map(stripComments); // 주석 제거된 실제 코드 라인.

  for (let i = 0; i < lines.length; i++) {
    // 좌표 토큰 자체도 주석이 아닌 실제 코드에서 나와야 한다.
    if (!R3_COORD.test(code[i])) continue;
    // 이미 라인 단위(R3_SEND/API_POST/PERSIST)로 잡힌 경우는 checkLine 이 처리하므로
    // 여기서는 "근접 전송"만 본다(중복 보고는 main 에서 dedupe).
    const lo = Math.max(0, i - R3_PROXIMITY);
    const hi = Math.min(lines.length - 1, i + R3_PROXIMITY);
    let found = false;
    for (let j = lo; j <= hi && !found; j++) {
      if (R3_NET_SEND.test(code[j])) found = true;
    }
    if (found) hits.push(i + 1);
  }
  return hits;
}

// ── 파일 수집 ────────────────────────────────────────────────────────────────
function walk(dirAbs, out) {
  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return; // 디렉터리 없음 — 조용히 통과(예: scripts 가 비어있는 경우).
  }
  for (const ent of entries) {
    const abs = join(dirAbs, ent.name);
    if (ent.isDirectory()) {
      if (EXCLUDE_DIRS.has(ent.name)) continue;
      walk(abs, out);
    } else if (ent.isFile()) {
      if (isExcludedFile(abs)) continue;
      out.push(abs);
    }
  }
}

function collectFiles() {
  const files = [];
  for (const d of SCAN_DIRS) {
    const abs = resolve(ROOT, d);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(abs, files);
  }
  return files;
}

// ── 실행 ─────────────────────────────────────────────────────────────────────
function main() {
  const asJson = process.argv.includes('--json');
  const files = collectFiles();
  const violations = [];

  for (const abs of files) {
    let content;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const rel = relative(ROOT, abs).split(sep).join('/');
    const lines = content.split(/\r?\n/);
    // 같은 (line, rule) 중복 보고 방지(라인 규칙 ↔ 파일 규칙 겹침).
    const seen = new Set();
    const add = (line, rule) => {
      const key = `${line}:${rule}`;
      if (seen.has(key)) return;
      seen.add(key);
      violations.push({ file: rel, line, rule });
    };

    for (let i = 0; i < lines.length; i++) {
      for (const rule of checkLine(lines[i])) add(i + 1, rule);
    }
    // R3 멀티라인/근접 위경도 전송(파일 단위).
    for (const line of checkFileR3(lines)) add(line, 'R3-위치저장');
  }

  if (asJson) {
    process.stdout.write(
      JSON.stringify({ ok: violations.length === 0, violations }, null, 2) + '\n',
    );
  } else if (violations.length === 0) {
    process.stdout.write(
      `compliance-scan: OK — ${files.length}개 파일, 위반 0건.\n`,
    );
  } else {
    process.stdout.write(
      `compliance-scan: FAIL — ${violations.length}건 위반 발견:\n`,
    );
    for (const v of violations) {
      process.stdout.write(`  ${v.file}:${v.line}:${v.rule}\n`);
    }
  }

  process.exit(violations.length === 0 ? 0 : 1);
}

main();
