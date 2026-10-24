// 산출물 규칙(client/dist) — C3-OUT-ID, C3-OUT-ROUTE, C4-BANNED(산출물), C6-IMG(산출물), C8-OUT-SAFE.
//   노출 판단은 seed-exposure.mjs(원시 시드 독립 재구현, D9)만 쓴다.
//
// prerender-manifest.json 계약(F3 가 쓴다):
//   { v: 1, seedDigest: "<sha256 hex — seed-exposure.mjs seedDigest()>", indexable: boolean(사이트 수준, WS_INDEXABLE),
//     routes: [{ path: "/hamster/golden", file: "hamster/golden/index.html", kind: RouteKind, indexable: boolean,
//                typeId?, family?, itemId?, productId?, region?, layer?: { kind, typeId, itemId?|productId? } }] }
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { lineIndex, relPosix, stripBom, walk } from './files.mjs';
import { scripts, tags, textNodes } from './html.mjs';
import { lintText } from './normalize.mjs';
import { SEED_KEYS } from './seed-exposure.mjs';

const ROUTE_KINDS = new Set(['HOME', 'FAMILY', 'TYPE', 'SETUP', 'SUPPLIES', 'SUPPLY_ITEM', 'SUPPLY_ITEM_TYPE', 'VET', 'VET_REGION', 'CREDITS', 'SAVE', 'PICK', 'NOT_FOUND']);
const TYPE_KINDS = new Set(['TYPE', 'SETUP']);
const WS_DATA_KEYS = { types: 'animalTypes', products: 'curatedProducts', bundles: 'setupBundles', vets: 'vetClinics', testimonials: 'testimonials' };
const JSON_TEXT_SKIP = /^(id|slug|href|url|sourceUrl|path|catalogUrl|imageAsset|reviewerImage|seedDigest|file|item|@context|@type|@id|kind|provider|reviewerType|priority|orderHint|category|tier|verdict|reasonCodes|situation|linkedAction|group|imageLicense)$|Id$|Ids$|At$/;
const TEXT_ATTRS = ['title', 'alt', 'aria-label', 'aria-description', 'placeholder'];
const isExternal = (u) => /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//') || u.startsWith('\\');
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function decodePath(p) {
  let s = String(p);
  try {
    s = decodeURIComponent(s);
  } catch {
    /* 그대로 */
  }
  s = s.normalize('NFC');
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}

function bannedIn(text, rel, line, where, add, bw) {
  for (const h of lintText(text, bw)) {
    if (h.rule === 'L01') add('C4-BANNED', 'FAIL', rel, line, `${where}: 금지어 "${h.term}"`);
    else if (h.rule === 'L06') add('C4-BANNED', 'WARN', rel, line, `${where}: 공백 제거 후 2자 금지어 "${h.term}"`);
    // R6 B1(SEC-4 L-4): 산출물은 사용자에게 보이는 결과물 — 어간도 FAIL.
    else add('C4-STEM', 'FAIL', rel, line, `${where}: 금지어 어간 "${h.term}"`);
  }
}

function jsonStrings(v, key, visit) {
  if (Array.isArray(v)) v.forEach((x) => jsonStrings(x, key, visit));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) jsonStrings(x, k, visit);
  else if (typeof v === 'string') {
    if (JSON_TEXT_SKIP.test(key) || /^(https?:\/\/|\/)/i.test(v)) return;
    visit(v, key);
  }
}

/** ws-data (§6-3 WsPageData) id 검사. */
function checkWsData(d, rel, line, ex, add) {
  const bad = (what) => add('C3-OUT-ID', 'FAIL', rel, line, `ws-data 비노출 ${what}`);
  if (!isObj(d)) return;
  const r = d.route;
  if (isObj(r) && r.typeId !== undefined && !ex.ids.animalTypes.has(r.typeId)) bad(`route.typeId ${r.typeId}`);
  checkLayer(d.layer, ex, (w) => bad(`layer ${w}`));
  const data = d.data;
  if (data === undefined) return;
  if (!isObj(data)) return bad('data 형식');
  for (const [k, arr] of Object.entries(data)) {
    if (!Array.isArray(arr)) {
      bad(`data.${k} 형식`);
      continue;
    }
    if (k === 'requirements') {
      for (const q of arr) {
        if (!isObj(q) || !ex.pairs.has(`${q.animalTypeId}|${q.supplyItemId}`)) bad(`requirement ${q?.animalTypeId}|${q?.supplyItemId}`);
        const item = isObj(q) ? q.item : undefined;
        if (item !== undefined) {
          if (!isObj(item) || !ex.ids.supplyItems.has(item.id)) bad(`requirement.item ${item?.id}`);
          for (const a of Array.isArray(item?.alternativeIds) ? item.alternativeIds : []) if (!ex.ids.supplyItems.has(a)) bad(`alternativeId ${a}`);
        }
      }
      continue;
    }
    const key = WS_DATA_KEYS[k];
    if (!key) {
      bad(`알 수 없는 컬렉션 data.${k}`);
      continue;
    }
    for (const x of arr) if (!isObj(x) || !ex.ids[key].has(x.id)) bad(`${k} ${x?.id}`);
  }
}

function checkLayer(layer, ex, bad) {
  if (layer === null || layer === undefined) return;
  if (!isObj(layer)) return bad('형식');
  if (!ex.ids.animalTypes.has(layer.typeId)) bad(`typeId ${layer.typeId}`);
  if (layer.itemId !== undefined && !ex.pairs.has(`${layer.typeId}|${layer.itemId}`)) bad(`itemId ${layer.itemId}`);
  if (layer.productId !== undefined && !ex.productTypes.has(`${layer.typeId}|${layer.productId}`)) bad(`productId ${layer.productId}`);
}

/** 공개 카탈로그(dist/data/*.json) id 검사. */
function checkCatalog(c, rel, ex, digest, add) {
  if (!isObj(c)) return add('C3-OUT-ID', 'FAIL', rel, null, '카탈로그 형식');
  if (c.seedDigest !== undefined && c.seedDigest !== digest) add('C3-OUT-ROUTE', 'FAIL', rel, null, `카탈로그 seedDigest 불일치 (${c.seedDigest})`);
  for (const [k, arr] of Object.entries(c)) {
    if (!Array.isArray(arr)) continue;
    if (!SEED_KEYS.includes(k)) {
      if (arr.some((x) => isObj(x) && 'id' in x)) add('C3-OUT-ID', 'FAIL', rel, null, `알 수 없는 컬렉션 ${k}`);
      continue;
    }
    for (const x of arr) if (!isObj(x) || !ex.ids[k].has(x.id)) add('C3-OUT-ID', 'FAIL', rel, null, `카탈로그 비노출 ${k}#${x?.id}`);
    // Taxon 참조는 검수 완료 Taxon 만(불변식 7) — 타입은 Taxon 미검수여도 노출(Kenny 2026-10-24 K-4 되돌림).
    const taxonRefs = (x) => (k === 'animalTypes' ? [x.taxonId] : k === 'careProfiles' && Array.isArray(x.taxonIds) ? x.taxonIds : []);
    for (const x of arr) {
      if (!isObj(x)) continue;
      for (const t of taxonRefs(x)) if (t !== null && t !== undefined && !ex.ids.taxa.has(t)) add('C3-OUT-ID', 'FAIL', rel, null, `카탈로그 비노출 Taxon 참조 ${k}#${x.id} → ${t}`);
    }
  }
}

function checkRoutes(m, dist, ex, add) {
  const R = 'prerender-manifest.json';
  if (!Array.isArray(m.routes)) {
    add('C3-OUT-ROUTE', 'FAIL', R, null, 'routes 배열 없음');
    return [];
  }
  for (const r of m.routes) {
    if (!isObj(r) || typeof r.path !== 'string' || typeof r.file !== 'string') {
      add('C3-OUT-ROUTE', 'FAIL', R, null, `route 형식 오류: ${JSON.stringify(r)}`);
      continue;
    }
    const at = `route ${r.path}`;
    if (!ROUTE_KINDS.has(r.kind)) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 알 수 없는 kind ${r.kind}`);
    if (r.file.split(/[\\/]/).includes('..') || /^([a-z]:|\/)/i.test(r.file) || !existsSync(join(dist, r.file))) {
      add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 파일 없음·경로 이탈 ${r.file}`);
    }
    if (TYPE_KINDS.has(r.kind) && r.typeId === undefined) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: ${r.kind} 에 typeId 없음`);
    if (r.typeId !== undefined) {
      const t = ex.types.get(r.typeId);
      if (!t) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 비노출 타입 ${r.typeId}`);
      else if (TYPE_KINDS.has(r.kind) || r.kind === 'SUPPLY_ITEM') {
        const p = decodePath(r.path);
        const base = `/${t.slug}`;
        if (typeof t.slug !== 'string' || (p !== base && !p.startsWith(`${base}/`))) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 타입 slug(${t.slug}) 불일치`);
      }
    }
    if (r.kind === 'FAMILY') {
      const fam = r.family;
      if (typeof fam !== 'string' || ![...ex.types.values()].some((t) => typeof t.slug === 'string' && t.slug.startsWith(`${fam}/`))) {
        add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 노출 타입 없는 family ${fam}`);
      }
    }
    if (r.itemId !== undefined) {
      const ok = r.typeId !== undefined ? ex.pairs.has(`${r.typeId}|${r.itemId}`) : ex.ids.supplyItems.has(r.itemId);
      if (!ok) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 비노출 item ${r.itemId}`);
    }
    if (r.productId !== undefined) {
      const ok = r.typeId !== undefined ? ex.productTypes.has(`${r.typeId}|${r.productId}`) : ex.ids.curatedProducts.has(r.productId);
      if (!ok) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 비노출 product ${r.productId}`);
    }
    if (r.region !== undefined && !ex.vetRegions.has(r.region)) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 노출 병원 없는 지역 ${r.region}`);
    if (r.kind === 'VET_REGION' && r.region === undefined) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: VET_REGION 에 region 없음`);
    // R4 D6: /credits 는 항상 생성(사진 0이면 빈 상태) — 존재 자체는 위반이 아니다. 내용은 아래 C6 가 본다.
    if (r.kind === 'CREDITS' && r.indexable === true) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: /credits 는 noindex 여야 한다`);
    checkLayer(r.layer, ex, (w) => add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: layer ${w}`));
  }
  return m.routes.filter(isObj);
}

/**
 * @returns {'RUN'|'NOT RUN'}
 */
export function scanOutputs({ root, dist, ex, digest, bw, add, requireOutput }) {
  const manPath = join(dist, 'prerender-manifest.json');
  if (!existsSync(manPath)) {
    if (requireOutput) add('C0-OUTPUT', 'FAIL', relPosix(root, manPath), null, 'NOT RUN — prerender-manifest.json 없음(--require-output)');
    return 'NOT RUN';
  }
  let m;
  try {
    m = JSON.parse(stripBom(readFileSync(manPath, 'utf8')));
  } catch (e) {
    add('C3-OUT-ROUTE', 'FAIL', 'prerender-manifest.json', null, `manifest 파싱 실패: ${e.message}`);
    return 'RUN';
  }
  if (!isObj(m) || m.v !== 1) add('C3-OUT-ROUTE', 'FAIL', 'prerender-manifest.json', null, 'manifest v≠1');
  if (m.seedDigest !== digest) add('C3-OUT-ROUTE', 'FAIL', 'prerender-manifest.json', null, `seedDigest 불일치: manifest ${m.seedDigest} ≠ server/seed ${digest}`);
  const routes = checkRoutes(isObj(m) ? m : {}, dist, ex, add);
  const indexablePaths = new Set(routes.filter((r) => r.indexable === true && typeof r.path === 'string').map((r) => decodePath(r.path)));

  // sitemap ⊆ manifest indexable
  const smPath = join(dist, 'sitemap.xml');
  if (existsSync(smPath)) {
    const sm = readFileSync(smPath, 'utf8');
    const re = /<loc>\s*([^<]+?)\s*<\/loc>/g;
    let mm;
    while ((mm = re.exec(sm)) !== null) {
      let p;
      try {
        p = new URL(mm[1].replace(/&amp;/g, '&')).pathname;
      } catch {
        p = mm[1];
      }
      if (!indexablePaths.has(decodePath(p))) add('C3-OUT-ROUTE', 'FAIL', 'sitemap.xml', null, `manifest indexable 밖 URL: ${mm[1]}`);
    }
  }

  // robots: 사이트 비공개면 Disallow: /
  const rbPath = join(dist, 'robots.txt');
  const robots = existsSync(rbPath) ? readFileSync(rbPath, 'utf8') : null;
  if (m.indexable !== true) {
    if (robots === null || !/^\s*Disallow:\s*\/\s*$/im.test(robots)) add('C8-OUT-SAFE', 'FAIL', 'robots.txt', null, 'manifest.indexable≠true 인데 robots 에 "Disallow: /" 없음');
  }

  // credits(C6 산출물)
  const needCredits = ex.ccByPhotos.length > 0;
  if (needCredits && !routes.some((r) => decodePath(r.path) === '/credits' && existsSync(join(dist, r.file)))) {
    add('C6-IMG', 'FAIL', 'prerender-manifest.json', null, `CC BY 계열 사진(${ex.ccByPhotos.join(', ')})이 있는데 /credits 페이지 없음`);
  }

  // C6(S1 M-3): /credits 에 CC BY 사진마다 항목 + 같은 종류의 creativecommons.org 증서 링크.
  const creditsRoute = routes.find((r) => r.kind === 'CREDITS' && typeof r.file === 'string');
  const creditsAbs = creditsRoute ? join(dist, creditsRoute.file) : null;
  if (needCredits && creditsAbs && existsSync(creditsAbs)) {
    const html = readFileSync(creditsAbs, 'utf8');
    const rel = relPosix(root, creditsAbs);
    for (const id of ex.ccByPhotos) {
      const at = html.indexOf(`data-ws-id="photos#${id}"`);
      if (at < 0) {
        add('C6-IMG', 'FAIL', rel, null, `CC BY 사진 ${id} 의 저작자 표시 항목 없음`);
        continue;
      }
      const end = html.indexOf('</li>', at);
      const item = html.slice(at, end < 0 ? undefined : end);
      const url = ex.licenseUrls?.get(id);
      if (typeof url !== 'string' || !item.includes(`href="${url}"`)) add('C6-IMG', 'FAIL', rel, null, `CC BY 사진 ${id} 에 라이선스 증서 링크 없음`);
    }
  }

  // HTML — credits 링크 규칙은 manifest 라우트 파일(404 포함)에만(SPA 셸 shell.html 등 비라우트 HTML 제외)
  const routeFiles = new Set(routes.filter((r) => typeof r.file === 'string').map((r) => resolve(dist, r.file)));
  const all = walk(dist);
  for (const abs of all.filter((f) => f.endsWith('.html'))) {
    const rel = relPosix(root, abs);
    const html = readFileSync(abs, 'utf8');
    const lineOf = lineIndex(html);

    // C8 — script
    const blocks = scripts(html);
    const opens = (html.match(/<script\b/gi) ?? []).length;
    if (opens !== blocks.length) add('C8-OUT-SAFE', 'FAIL', rel, null, '닫히지 않은 <script>');
    for (const s of blocks) {
      const line = lineOf(s.index);
      const type = (s.attrs.type ?? '').trim().toLowerCase();
      if (s.attrs.src !== undefined) {
        const src = s.attrs.src.trim();
        if (!src.startsWith('/') || src.startsWith('//') || src.includes('\\')) add('C8-OUT-SAFE', 'FAIL', rel, line, `외부·비정상 script src: ${src}`);
        if (s.body.trim() !== '') add('C8-OUT-SAFE', 'FAIL', rel, line, 'src 와 인라인 본문 동시');
        continue;
      }
      if (type !== 'application/json' && type !== 'application/ld+json') {
        add('C8-OUT-SAFE', 'FAIL', rel, line, `인라인 스크립트 금지(type=${type || '없음'})`);
        continue;
      }
      if (s.body.includes('</')) add('C8-OUT-SAFE', 'FAIL', rel, line, 'JSON 블록 원문에 "</"');
      let data;
      try {
        data = JSON.parse(s.body);
      } catch {
        add('C8-OUT-SAFE', 'FAIL', rel, line, 'JSON 블록 파싱 실패');
        continue;
      }
      jsonStrings(data, '', (t, k) => bannedIn(t, rel, line, `JSON ${k}`, add, bw));
      if (s.attrs.id === 'ws-data') checkWsData(data, rel, line, ex, add);
    }

    // C8 — 태그, C3 — data-ws-*, C4 — 속성 텍스트
    let hasCreditsLink = false;
    for (const t of tags(html)) {
      const line = lineOf(t.index);
      const a = t.attrs;
      if (['iframe', 'frame', 'frameset', 'object', 'embed'].includes(t.name)) add('C8-OUT-SAFE', 'FAIL', rel, line, `<${t.name}> 금지`);
      // B3-4(SEC L4): 인라인 이벤트 핸들러 속성(on*=)·모든 속성의 javascript:/vbscript: 값 0 — CSP 'unsafe-inline' 없이 동작해야 한다.
      for (const [k, v] of Object.entries(a)) {
        if (/^on/i.test(k)) add('C8-OUT-SAFE', 'FAIL', rel, line, `<${t.name} ${k}=> 인라인 핸들러`);
        else if (typeof v === 'string' && /^(?:javascript|vbscript):/i.test(v.replace(/[\u0000-\u0020]/g, ''))) add('C8-OUT-SAFE', 'FAIL', rel, line, `<${t.name} ${k}> 위험 URL: ${v.slice(0, 40)}`);
      }
      if (t.name === 'link' && a.href !== undefined && isExternal(a.href.trim()) && (a.rel ?? '').toLowerCase().trim() !== 'canonical') {
        add('C8-OUT-SAFE', 'FAIL', rel, line, `외부 <link href>: ${a.href}`);
      }
      if (t.name === 'a' && a.href !== undefined) {
        const href = a.href.trim();
        if (/^\s*(javascript|data|vbscript):/i.test(href)) add('C8-OUT-SAFE', 'FAIL', rel, line, `위험 href: ${href.slice(0, 40)}`);
        else if (isExternal(href) && !/^(mailto|tel):/i.test(href)) {
          const rels = (a.rel ?? '').toLowerCase().split(/\s+/);
          if (!rels.includes('noopener')) add('C8-OUT-SAFE', 'FAIL', rel, line, `외부 <a> rel noopener 없음: ${href}`);
        }
        if (href === '/credits') hasCreditsLink = true;
      }
      if (t.name !== 'script' && t.name !== 'a' && t.name !== 'link') {
        for (const k of ['src', 'srcset', 'poster', 'data']) {
          if (a[k] !== undefined && a[k].split(',').some((u) => isExternal(u.trim().split(/\s+/)[0] ?? ''))) {
            add('C8-OUT-SAFE', 'FAIL', rel, line, `외부 리소스 ${t.name}[${k}]: ${a[k]}`);
          }
        }
      }
      if (t.name === 'form' && a.action !== undefined && isExternal(a.action.trim())) add('C8-OUT-SAFE', 'FAIL', rel, line, `외부 form action: ${a.action}`);
      if (a['data-ws-id'] !== undefined) {
        const [key, id, extra] = a['data-ws-id'].split('#');
        if (extra !== undefined || !SEED_KEYS.includes(key) || !ex.ids[key].has(id)) add('C3-OUT-ID', 'FAIL', rel, line, `비노출 data-ws-id: ${a['data-ws-id']}`);
      }
      if (a['data-ws-type'] !== undefined && !ex.ids.animalTypes.has(a['data-ws-type'])) add('C3-OUT-ROUTE', 'FAIL', rel, line, `비노출 타입 페이지: ${a['data-ws-type']}`);
      for (const k of TEXT_ATTRS) if (a[k] !== undefined) bannedIn(a[k], rel, line, `@${k}`, add, bw);
      if (t.name === 'meta' && a.content !== undefined) bannedIn(a.content, rel, line, '@meta content', add, bw);
    }
    if (needCredits && routeFiles.has(resolve(abs)) && !hasCreditsLink) add('C6-IMG', 'FAIL', rel, null, 'CC BY 계열 사진이 있는데 href="/credits" 링크 없음');

    // C4 — 가시 텍스트 + 태그 경계 걸침
    const nodes = textNodes(html);
    const nodeTerms = new Set();
    for (const n of nodes) {
      bannedIn(n.text, rel, lineOf(n.index), 'text', add, bw);
      for (const h of lintText(n.text, bw)) nodeTerms.add(h.term);
    }
    for (const h of lintText(nodes.map((n) => n.text).join(''), bw)) {
      if (h.rule === 'L01' && !nodeTerms.has(h.term)) add('C4-BANNED', 'FAIL', rel, null, `태그 경계에 걸친 금지어 "${h.term}"`);
    }
  }

  // 공개 카탈로그·기타 JSON(dist/data)
  for (const abs of all.filter((f) => f.endsWith('.json') && relPosix(dist, f).startsWith('data/'))) {
    const rel = relPosix(root, abs);
    let c;
    try {
      c = JSON.parse(stripBom(readFileSync(abs, 'utf8')));
    } catch {
      add('C3-OUT-ID', 'FAIL', rel, null, 'JSON 파싱 실패');
      continue;
    }
    checkCatalog(c, rel, ex, digest, add);
    jsonStrings(c, '', (t, k) => bannedIn(t, rel, null, `JSON ${k}`, add, bw));
  }

  // R6 F2a: 사전 압축본(.br/.gz)은 위 텍스트 스캔 대상이 아니다(확장자 필터) — 대신 같은 이름 원본의 무손실 사본인지만 본다
  //   (해제 = 원본 바이트). 서빙되는 바이트가 스캔한 원본과 다를 수 없게.
  for (const abs of all.filter((f) => f.endsWith('.br') || f.endsWith('.gz'))) {
    const rel = relPosix(root, abs);
    const orig = abs.slice(0, -3);
    if (!existsSync(orig)) {
      add('C8-OUT-SAFE', 'FAIL', rel, null, '원본 없는 압축 사본');
      continue;
    }
    let same = false;
    try {
      const buf = readFileSync(abs);
      same = (abs.endsWith('.br') ? brotliDecompressSync(buf) : gunzipSync(buf)).equals(readFileSync(orig));
    } catch {
      same = false;
    }
    if (!same) add('C8-OUT-SAFE', 'FAIL', rel, null, '압축 사본 ≠ 원본 — node scripts/precompress.mjs 재실행');
  }
  return 'RUN';
}
