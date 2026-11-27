#!/usr/bin/env node
// 362 N13 — 상품 피드 생성기(개발 도구, 수동 실행). 공식 API 만, 크롤링 0(불변식 ①).
//   대상 = 노출 타입 × 노출 요구사항(FOOD·HEALTH 품목 제외, D-3/C5), 검색어 = engine buildSearchKeyword(단일 규칙).
//   네트워크 transport 는 아직 없다(N15 — 키 발급·약관 확인은 Kenny). 지금 실행하면 대상 조합 수만 출력하고 파일을 쓰지 않는다.
//   키 값·수수료·판매량·평점은 어떤 출력에도 없다.
//   사용: node scripts/dev/gen-product-feed.mjs [--seed-dir DIR] [--feed-dir DIR] [--as-of YYYY-MM-DD]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FEED_ROW_CAP, createShopApi, normalizeItem, providerCreds, titleBanned } from '../lib/shop-api.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FEED_EXCLUDED_CATEGORIES = Object.freeze(new Set(['FOOD', 'HEALTH']));
const PROVIDER_FILE = Object.freeze({ COUPANG: 'coupang.json', ALIEXPRESS: 'aliexpress.json' });
const H = 3_600_000;

/** ms → 'YYYY-MM-DDTHH:MM:SS+09:00' (실행 TZ 무관). */
export function seoulIsoOf(ms) {
  const d = new Date(ms + 9 * H);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+09:00`;
}

/** 피드 파일(키 순서 고정). 행이 없으면 generatedAt null — 로더 규칙과 같다. */
export function buildFeedFile({ provider, api, terms, generatedAt, rows }) {
  return {
    v: 1,
    provider,
    source: 'OFFICIAL_API',
    api: { method: api?.method ?? null, sort: api?.sort ?? null },
    terms: { checkedAt: terms?.checkedAt ?? null, displayFields: [...(terms?.displayFields ?? [])] },
    generatedAt: rows.length > 0 ? generatedAt : null,
    rows,
  };
}

/**
 * 대상 조합(노출 타입 × 노출 요구사항, FOOD·HEALTH 제외). exposableOnly=false 면 노출 판정 없이 전 조합(조합 수 보고용).
 * @returns {{animalTypeId:string, supplyItemId:string, keyword:string}[]}
 */
export function collectTargets(seed, engine, asOf, { exposableOnly = true } = {}) {
  const cat = engine.createCatalog(seed);
  const out = [];
  for (const at of seed.animalTypes ?? []) {
    if (exposableOnly && !engine.isAnimalTypeExposable(cat, at.id, asOf)) continue;
    for (const r of engine.listResolvedRequirements(cat, at.id)) {
      if (FEED_EXCLUDED_CATEGORIES.has(r.item?.category)) continue;
      if (exposableOnly && !engine.isRequirementExposable(cat, r, asOf)) continue;
      const keyword = engine.buildSearchKeyword(at, r);
      if (typeof keyword !== 'string' || keyword.trim() === '') continue;
      out.push({ animalTypeId: at.id, supplyItemId: r.supplyItemId, keyword });
    }
  }
  return out;
}

/**
 * 공급자별 피드 생성(transport 주입). rules[provider] = { linkRe, imageHosts } — 실행 시 server/dist engine 의
 *   FEED_LINK_RE·FEED_IMAGE_HOSTS 를 넘긴다(단일 소스). 키가 없으면 그 공급자는 건너뛰고 오류에 키 이름만 남긴다.
 * @returns {Promise<{ files: object[], log: string[], errors: string[] }>}
 */
export async function generateFeeds({ targets, env, transport, providers = ['COUPANG', 'ALIEXPRESS'], nowMs, banned, existingTerms, rules = {} }) {
  const files = [];
  const log = [];
  const errors = [];
  for (const provider of providers) {
    const terms = existingTerms?.[provider];
    if (!terms?.checkedAt) {
      errors.push(`${provider}: terms.checkedAt 없음(약관 확인 전) — 건너뜀`);
      continue;
    }
    const c = providerCreds(provider, env);
    if (!c.ok) {
      errors.push(`${provider}: 키 미설정 ${c.missing.join(', ')} — 건너뜀`);
      continue;
    }
    const api = createShopApi({ provider, creds: c.creds, transport });
    const rows = [];
    let meta = { method: null, sort: null };
    const generatedAt = seoulIsoOf(nowMs);
    for (const t of targets) {
      let res;
      try {
        res = await api.search(t.keyword, FEED_ROW_CAP);
      } catch {
        errors.push(`${provider}: ${t.animalTypeId}/${t.supplyItemId} 호출 실패 — 건너뜀`);
        continue;
      }
      if (meta.method === null) meta = { method: res.method, sort: res.sort };
      let rank = 0;
      let dropped = 0;
      for (const item of res.items) {
        if (rank >= FEED_ROW_CAP) break;
        const n = normalizeItem(provider, item, terms.displayFields, rules[provider] ?? {});
        if (n === null || titleBanned(n.title, banned)) {
          dropped++;
          continue;
        }
        rank++;
        rows.push({ animalTypeId: t.animalTypeId, supplyItemId: t.supplyItemId, keyword: t.keyword, rank, title: n.title, url: n.url, imageUrl: n.imageUrl, price: n.price, fetchedAt: generatedAt });
      }
      log.push(`${provider}: ${t.animalTypeId}/${t.supplyItemId} 행 ${rank} · 제외 ${dropped}`);
    }
    files.push(buildFeedFile({ provider, api: meta, terms, generatedAt, rows }));
  }
  return { files, log, errors };
}

export function parseArgs(argv) {
  const a = { seedDir: join(ROOT, 'server', 'seed'), feedDir: join(ROOT, 'server', 'product-feed'), asOf: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === '--seed-dir') (a.seedDir = resolve(v)), i++;
    else if (argv[i] === '--feed-dir') (a.feedDir = resolve(v)), i++;
    else if (argv[i] === '--as-of') (a.asOf = v), i++;
  }
  return a;
}

export async function main(argv = process.argv.slice(2), io = { stdout: (l) => process.stdout.write(`${l}\n`), stderr: (l) => process.stderr.write(`${l}\n`) }) {
  const args = parseArgs(argv);
  const engineJs = join(ROOT, 'server', 'dist', 'engine', 'index.js');
  const readJs = join(ROOT, 'server', 'dist', 'seed', 'read.js');
  if (!existsSync(engineJs) || !existsSync(readJs)) {
    io.stderr('gen-product-feed: server/dist 없음 — npm run build -w server 먼저');
    return 2;
  }
  const engine = await import(pathToFileURL(engineJs).href);
  const { readSeedDir } = await import(pathToFileURL(readJs).href);
  const seed = readSeedDir(args.seedDir);
  const asOf = args.asOf ?? seoulIsoOf(Date.now()).slice(0, 10);
  const all = collectTargets(seed, engine, asOf, { exposableOnly: false });
  const targets = collectTargets(seed, engine, asOf);
  const types = new Set(all.map((t) => t.animalTypeId)).size;
  io.stdout(`gen-product-feed: 전 조합 ${all.length}(타입 ${types} × 비 FOOD·HEALTH 품목) · 노출 조합 ${targets.length} (기준일 ${asOf})`);
  for (const p of Object.keys(PROVIDER_FILE)) {
    const terms = JSON.parse(readFileSync(join(args.feedDir, PROVIDER_FILE[p]), 'utf8')).terms;
    io.stdout(`gen-product-feed: ${p} 약관 확인 ${terms?.checkedAt ?? '없음'}`);
  }
  io.stdout('gen-product-feed: 실호출 transport 미구현(N15, Kenny 승인 후) — 파일 쓰기 0');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
