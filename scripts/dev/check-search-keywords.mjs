#!/usr/bin/env node
// 검색 키워드 실효성 검증 — 개발 전용 도구(결정 2026-10-27). CI·빌드·서버·client/dist 에 포함하지 않는다.
//   입력: 시드 → engine(server/dist, scripts/prerender.mjs 와 같은 컴파일 산출물 import 패턴) 의 listResolvedRequirements +
//         buildSearchKeyword 로 펼친 실제 검색어(동물·용품별, DRAFT 포함 — 검증 목적). 키워드 로직 복제 0.
//   공급자: 네이버 검색 API(쇼핑) — 공식 API·약관 내. 쿠팡 파트너스 — 상품 검색 엔드포인트 미확인(TODO, 아래).
//   저장: 상품명·카테고리만 추출하고 응답의 나머지(가격·판매처·이미지·링크·상품 id)는 즉시 버린다. 키 값은 어떤 출력·로그에도 0.
//   불변식 1(크롤링 금지 — 공식 API 만) · 4(자금 0 — 결제 코드 없음). 결과는 _workspace/search-check/<날짜>.{md,json} 에만.
//
//   사용: npm run dev:check-search [-- --limit N] [--delay ms] [--out dir] [--seed-dir dir]
//   env(server/.env): NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET · COUPANG_PARTNERS_ACCESS_KEY / COUPANG_PARTNERS_SECRET_KEY
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seoulToday } from '../lib/dates.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── 공급자 상수 ──────────────────────────────────────────────
// 네이버 검색 API 쇼핑: https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md
//   GET, 헤더 X-Naver-Client-Id / X-Naver-Client-Secret, query·display(≤100)·start·sort=sim. 일 호출 한도 25,000.
export const NAVER_SHOP_ENDPOINT = 'https://openapi.naver.com/v1/search/shop.json';
export const NAVER_DISPLAY = 10;
export const NAVER_DAILY_LIMIT = 25000;
// 쿠팡: HMAC 서명 형식은 공식 문서로 확인(https://developers.coupangcorp.com/hc/ko/articles/360033461914 —
//   Authorization: "CEA algorithm=HmacSHA256, access-key=…, signed-date=yymmddTHHMMSSZ(GMT), signature=hex(HMAC-SHA256(secret, signed-date+method+path+query)))",
//   호스트 api-gateway.coupang.com). 파트너스 "상품 검색" 엔드포인트 경로·파라미터·응답 형태는 파트너스 도움말
//   (https://partners.coupang.com/#help/open-api — 로그인 필요 SPA)에서 확인하지 못했다.
// TODO(Kenny 키 발급 후): 파트너스 로그인 → 도움말 Open API 에서 상품 검색 경로·응답 필드(상품명 필드명)를 확인하고
//   COUPANG_SEARCH_PATH 와 extractCoupangTitles 를 채운다. 확인 전에는 호출하지 않는다(키가 있어도 skipped).
export const COUPANG_HOST = 'https://api-gateway.coupang.com';
export const COUPANG_SEARCH_PATH = null;

export const DEFAULT_DELAY_MS = 300;
export const DEFAULT_LIMIT = 300; // 1회 실행 요청 상한(공급자별) — 일 한도의 소량.
export const VERDICT = Object.freeze({ OK: 'OK', WEAK: '약함', NONE: '무관' });
const OK_RATIO = 0.7;
const WEAK_RATIO = 0.3;
const PET_CATEGORY_MIN = 0.5;
const PET_CATEGORY_RE = /반려동물/;

// ── 검색어 수집(engine 재사용) ─────────────────────────────────
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
const uniq = (xs) => [...new Set(xs.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))];

/** 용품 핵심어: name 전체 + 공백·가운뎃점·괄호로 나눈 조각(2자 이상) + aliases(있으면). */
export function itemTerms(item) {
  const name = String(item?.name ?? '');
  const parts = name.split(/[\s·/()[\],]+/).filter((p) => p.length >= 2);
  const aliases = Array.isArray(item?.aliases) ? item.aliases : [];
  return uniq([name, ...parts, ...aliases]);
}

/** 검색어 조건어: 검색어 토큰 − 동물 이름·별칭 − 용품 핵심어 − 숫자 포함 토큰. 판정 보조 지표(조건어 일치). */
export function keywordTerms(keyword, animalNames, terms) {
  const skip = new Set([...animalNames, ...terms].map(norm));
  return uniq(String(keyword).split(/\s+/).filter((t) => t.length >= 2 && !/\d/.test(t) && !skip.has(norm(t))));
}

/**
 * 시드 묶음 → 검색어 목록(동일 검색어 중복 제거, 사용처 묶음).
 * @param {object} seed SeedBundle
 * @param {{ createCatalog: Function, listResolvedRequirements: Function, buildSearchKeyword: Function }} engine
 */
export function collectKeywords(seed, engine) {
  const cat = engine.createCatalog(seed);
  const items = new Map((seed.supplyItems ?? []).map((i) => [i.id, i]));
  const byKeyword = new Map();
  for (const at of seed.animalTypes ?? []) {
    for (const r of engine.listResolvedRequirements(cat, at.id)) {
      const keyword = engine.buildSearchKeyword(at, r);
      if (!keyword) continue;
      const rawItem = items.get(r.supplyItemId) ?? r.item;
      const terms = itemTerms({ name: r.item.name, aliases: rawItem?.aliases });
      const animalNames = uniq([at.displayName, ...(Array.isArray(at.aliases) ? at.aliases : [])]);
      let row = byKeyword.get(keyword);
      if (!row) {
        row = { keyword, uses: [], itemTerms: [], keywordTerms: [], animalNames: [] };
        byKeyword.set(keyword, row);
      }
      row.uses.push({ animalTypeId: at.id, animal: at.displayName, animalReviewStatus: at.reviewStatus ?? null, supplyItemId: r.supplyItemId, item: r.item.name });
      row.itemTerms = uniq([...row.itemTerms, ...terms]);
      row.animalNames = uniq([...row.animalNames, ...animalNames]);
      row.keywordTerms = uniq([...row.keywordTerms, ...keywordTerms(keyword, animalNames, terms)]);
    }
  }
  return [...byKeyword.values()];
}

// ── 응답 → 상품명·카테고리만 ──────────────────────────────────
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
export function stripTags(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();
}

/** 네이버 쇼핑 응답 → [{ title, categories }] (허용목록 추출 — 그 밖의 필드는 읽지도 복사하지도 않는다). */
export function extractNaverProducts(body) {
  const items = Array.isArray(body?.items) ? body.items : [];
  return items.slice(0, NAVER_DISPLAY).map((it) => ({
    title: stripTags(it?.title),
    categories: [it?.category1, it?.category2, it?.category3, it?.category4].filter((c) => typeof c === 'string' && c !== ''),
  }));
}

// ── 판정 ──────────────────────────────────────────────────────
/**
 * @param {{ itemTerms: string[], keywordTerms?: string[], animalNames?: string[] }} row
 * @param {Array<{ title: string, categories?: string[] }>} products
 */
export function judge(row, products) {
  const total = products.length;
  const has = (title, terms) => terms.some((t) => norm(title).includes(norm(t)));
  const related = products.filter((p) => has(p.title, row.itemTerms)).length;
  const animal = products.filter((p) => has(p.title, row.animalNames ?? [])).length;
  const kt = row.keywordTerms ?? [];
  const conditionHits = kt.length === 0 ? null : products.filter((p) => has(p.title, kt)).length;
  const withCat = products.filter((p) => (p.categories ?? []).length > 0);
  const pet = withCat.filter((p) => p.categories.some((c) => PET_CATEGORY_RE.test(c))).length;
  const ratio = total === 0 ? 0 : related / total;
  let verdict = ratio >= OK_RATIO ? VERDICT.OK : ratio >= WEAK_RATIO ? VERDICT.WEAK : VERDICT.NONE;
  // 반려동물 분류가 절반 미만이면 OK 를 약함으로(이름은 맞지만 다른 동물·생활용품일 수 있음).
  if (verdict === VERDICT.OK && withCat.length > 0 && pet / withCat.length < PET_CATEGORY_MIN) verdict = VERDICT.WEAK;
  return {
    total,
    related,
    ratio: Math.round(ratio * 100) / 100,
    verdict,
    animalMatch: animal,
    conditionMatch: conditionHits,
    petCategory: withCat.length === 0 ? null : pet,
    top3: products.slice(0, 3).map((p) => p.title),
  };
}

// ── 공급자 호출 ────────────────────────────────────────────────
const present = (v) => typeof v === 'string' && v.trim() !== '';
export function naverCreds(env) {
  return present(env.NAVER_SEARCH_CLIENT_ID) && present(env.NAVER_SEARCH_CLIENT_SECRET)
    ? { id: env.NAVER_SEARCH_CLIENT_ID.trim(), secret: env.NAVER_SEARCH_CLIENT_SECRET.trim() }
    : null;
}
export function coupangCreds(env) {
  return present(env.COUPANG_PARTNERS_ACCESS_KEY) && present(env.COUPANG_PARTNERS_SECRET_KEY)
    ? { accessKey: env.COUPANG_PARTNERS_ACCESS_KEY.trim(), secretKey: env.COUPANG_PARTNERS_SECRET_KEY.trim() }
    : null;
}

/** 공급자 오류: 상태 코드만 남긴다(응답 본문·헤더·URL 은 출력하지 않는다). */
class ProviderError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

/** 네이버 1회 검색 → 상품명·카테고리 목록. fetchFn 주입(테스트는 가짜 응답, 실제 네트워크 0). */
export async function naverSearch(keyword, creds, fetchFn) {
  const qs = new URLSearchParams({ query: keyword, display: String(NAVER_DISPLAY), start: '1', sort: 'sim' });
  const res = await fetchFn(`${NAVER_SHOP_ENDPOINT}?${qs}`, {
    method: 'GET',
    headers: { 'X-Naver-Client-Id': creds.id, 'X-Naver-Client-Secret': creds.secret },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new ProviderError(res.status);
  const body = await res.json();
  return extractNaverProducts(body); // body 는 이 함수 밖으로 나가지 않는다.
}

/** 쿠팡 signed-date: GMT yymmdd'T'HHMMSS'Z'(공식 문서 예제와 같은 형식). */
export function coupangSignedDate(at = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(at.getUTCFullYear() % 100)}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}T${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}Z`;
}

/** 쿠팡 Open API Authorization 헤더(공식 문서 형식). message = signedDate + method + path + query('?' 없이). */
export function coupangAuthorization({ method, path, query = '', accessKey, secretKey, signedDate }) {
  const signature = createHmac('sha256', secretKey).update(`${signedDate}${method}${path}${query}`, 'utf8').digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`;
}

// ── 실행 ──────────────────────────────────────────────────────
export const SKIP_NO_KEY = 'skipped(키 없음)';
export const SKIP_COUPANG_TODO = 'skipped(상품 검색 엔드포인트 미확인 — TODO)';

/**
 * @param {{ keywords: ReturnType<typeof collectKeywords>, env: object, fetchFn?: Function, sleep?: Function,
 *           limit?: number, delayMs?: number, log?: (l: string) => void }} o
 */
export async function runCheck({ keywords, env, fetchFn = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), limit = DEFAULT_LIMIT, delayMs = DEFAULT_DELAY_MS, log = () => {} }) {
  const naver = naverCreds(env);
  const coupang = coupangCreds(env);
  const providers = {
    naver: naver ? 'run' : SKIP_NO_KEY,
    coupang: coupang ? SKIP_COUPANG_TODO : SKIP_NO_KEY,
  };
  const rows = keywords.map((k) => ({ ...k, naver: { status: providers.naver === 'run' ? 'pending' : SKIP_NO_KEY }, coupang: { status: providers.coupang } }));
  if (naver) {
    let sent = 0;
    let halted = null;
    for (const row of rows) {
      if (halted) {
        row.naver = { status: `skipped(${halted})` };
        continue;
      }
      if (sent >= Math.min(limit, NAVER_DAILY_LIMIT)) {
        row.naver = { status: 'skipped(실행 한도)' };
        continue;
      }
      if (sent > 0) await sleep(delayMs);
      sent++;
      try {
        const products = await naverSearch(row.keyword, naver, fetchFn);
        row.naver = { status: 'ok', ...judge(row, products) };
      } catch (e) {
        const status = e instanceof ProviderError ? e.message : 'network error';
        row.naver = { status: `error(${status})` };
        if (e instanceof ProviderError && [401, 403, 429].includes(e.status)) halted = `중단 — 앞선 ${status}`;
      }
      log(`naver ${sent}/${rows.length} ${row.naver.status}${row.naver.verdict ? ` ${row.naver.verdict}` : ''}`);
    }
  }
  return { providers, rows };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown({ date, providers, rows }) {
  const out = [];
  out.push(`# 검색 키워드 실효성 검증 — ${date}`, '');
  out.push('개발 전용 도구 결과(scripts/dev/check-search-keywords.mjs). 상품명·카테고리만 — 가격·판매처·이미지·링크 저장 0. 시드·화면 반영 0.', '');
  out.push(`- 네이버 검색 API(쇼핑): ${providers.naver === 'run' ? '실행' : providers.naver}`);
  out.push(`- 쿠팡 파트너스: ${providers.coupang}`);
  out.push(`- 검색어 ${rows.length}개(동일 검색어 중복 제거, DRAFT 포함)`);
  out.push(`- 판정: 상위 ${NAVER_DISPLAY}개 상품명 중 용품 핵심어 포함 비율 ≥ ${OK_RATIO} OK · ≥ ${WEAK_RATIO} 약함 · 미만 무관. 반려동물 분류 < ${PET_CATEGORY_MIN} 이면 OK → 약함.`, '');
  const counts = {};
  for (const r of rows) if (r.naver.verdict) counts[r.naver.verdict] = (counts[r.naver.verdict] ?? 0) + 1;
  if (Object.keys(counts).length > 0) out.push(`네이버 판정 집계: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`, '');
  out.push('| 동물 | 용품 | 검색어 | 네이버 판정 | 관련 | 동물명 | 조건어 | 반려동물 분류 | 상위 3 상품명 | 쿠팡 |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const n = r.naver;
    const animals = uniq(r.uses.map((u) => `${u.animal}${u.animalReviewStatus && u.animalReviewStatus !== 'VERIFIED' ? `(${u.animalReviewStatus})` : ''}`)).join(', ');
    const items = uniq(r.uses.map((u) => u.item)).join(', ');
    const ok = n.status === 'ok';
    out.push(
      `| ${cell(animals)} | ${cell(items)} | ${cell(r.keyword)} | ${cell(ok ? n.verdict : n.status)} | ${ok ? `${n.related}/${n.total}` : ''} | ${ok ? `${n.animalMatch}/${n.total}` : ''} | ${ok && n.conditionMatch !== null ? `${n.conditionMatch}/${n.total}` : ''} | ${ok && n.petCategory !== null ? `${n.petCategory}/${n.total}` : ''} | ${ok ? cell(n.top3.join(' / ')) : ''} | ${cell(r.coupang.status)} |`,
    );
  }
  out.push('');
  return out.join('\n');
}

/** JSON 출력(허용 필드만 다시 골라 쓴다 — 실수로 붙은 필드가 새지 않게). */
export function toJson({ date, providers, rows }) {
  return {
    v: 1,
    date,
    providers,
    rows: rows.map((r) => ({
      keyword: r.keyword,
      uses: r.uses.map((u) => ({ animalTypeId: u.animalTypeId, animal: u.animal, animalReviewStatus: u.animalReviewStatus, supplyItemId: u.supplyItemId, item: u.item })),
      itemTerms: r.itemTerms,
      keywordTerms: r.keywordTerms,
      naver:
        r.naver.status === 'ok'
          ? { status: 'ok', total: r.naver.total, related: r.naver.related, ratio: r.naver.ratio, verdict: r.naver.verdict, animalMatch: r.naver.animalMatch, conditionMatch: r.naver.conditionMatch, petCategory: r.naver.petCategory, top3: r.naver.top3 }
          : { status: r.naver.status },
      coupang: { status: r.coupang.status },
    })),
  };
}

export function parseArgs(argv) {
  const a = { limit: DEFAULT_LIMIT, delayMs: DEFAULT_DELAY_MS, out: join(ROOT, '_workspace', 'search-check'), seedDir: join(ROOT, 'server', 'seed') };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === '--limit') (a.limit = Math.max(0, Number(v) | 0)), i++;
    else if (argv[i] === '--delay') (a.delayMs = Math.max(0, Number(v) | 0)), i++;
    else if (argv[i] === '--out') (a.out = resolve(v)), i++;
    else if (argv[i] === '--seed-dir') (a.seedDir = resolve(v)), i++;
  }
  return a;
}

async function loadEngine() {
  const engineJs = join(ROOT, 'server', 'dist', 'engine', 'index.js');
  const readJs = join(ROOT, 'server', 'dist', 'seed', 'read.js');
  if (!existsSync(engineJs) || !existsSync(readJs)) throw new Error('server/dist 없음 — npm run build -w server 먼저');
  const engine = await import(pathToFileURL(engineJs).href);
  const { readSeedDir } = await import(pathToFileURL(readJs).href);
  return { engine, readSeedDir };
}

export async function main(argv = process.argv.slice(2), env = process.env, io = { stdout: (l) => process.stdout.write(`${l}\n`), stderr: (l) => process.stderr.write(`${l}\n`) }) {
  const args = parseArgs(argv);
  let keywords;
  try {
    const { engine, readSeedDir } = await loadEngine();
    keywords = collectKeywords(readSeedDir(args.seedDir), engine);
  } catch (e) {
    io.stderr(`check-search: ${e.message}`);
    return 2;
  }
  const date = seoulToday();
  const result = await runCheck({ keywords, env, limit: args.limit, delayMs: args.delayMs, log: io.stdout });
  mkdirSync(args.out, { recursive: true });
  const md = join(args.out, `${date}.md`);
  const json = join(args.out, `${date}.json`);
  writeFileSync(md, renderMarkdown({ date, ...result }));
  writeFileSync(json, `${JSON.stringify(toJson({ date, ...result }), null, 2)}\n`);
  io.stdout(`check-search: 검색어 ${keywords.length}개 · naver ${result.providers.naver === 'run' ? '실행' : result.providers.naver} · coupang ${result.providers.coupang}`);
  io.stdout(`check-search: ${md}`);
  io.stdout(`check-search: ${json}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
