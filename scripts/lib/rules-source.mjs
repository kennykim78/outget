// 소스·스키마·패키지·시드 규칙(R3 계획 §5 C1~C7). compliance-scan.mjs 가 add(finding) 로 수집.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, extname, join } from 'node:path';
import { CODE_EXT, TEXT_EXT, isDir, lexJs, relPosix, stripBom, stripSlashComments, walk } from './files.mjs';
import { PRODUCT_IMAGE_ASSET_RE, REVIEWER_IMAGE_RE } from './asset-patterns.mjs';
import { lintText } from './normalize.mjs';
import { PRODUCT_IMAGE_LICENSES, PHOTO_LICENSES, SEED_FILES, ccLicenseOfUrl } from './seed-exposure.mjs';

export const SCAN_DIRS = ['client/src', 'server/src', 'server/prisma', 'server/seed', 'scripts'];

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
const SDK_ALLOWED = (rel) => rel.startsWith('client/src/map/') || rel === 'server/src/middleware/spa.ts';
const MAP_HOST_RE = /(?:[a-z0-9*-]+\.)*(?:map\.naver\.com|pstatic\.net)\b/gi;
const SHOP_API_RE = /openapi\.naver\.com/i;

const BANNED_LIBS = ['puppeteer', 'puppeteer-core', 'playwright', 'playwright-core', 'cheerio', 'crawlee', 'node-cron', 'undici', 'axios', 'got'];
const BANNED_SCOPES = ['@playwright/', '@crawlee/', '@puppeteer/'];
const isBannedLib = (name) => BANNED_LIBS.includes(name) || BANNED_SCOPES.some((s) => name.startsWith(s)) || BANNED_LIBS.some((b) => name.startsWith(`${b}/`));

const NET_CALL_RE = /\b(?:fetch|axios(?:\.\w+)?|got(?:\.\w+)?|request|undici\.\w+|https?\.(?:get|request)|sendBeacon)\s*\(|\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\s*\(|\.open\s*\(/;
const ABS_URL_RE = /\b((?:https?|wss?):\/\/([^\s/'"`?#:]+))/gi;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

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

const SECRET_RES = [
  /X-Naver-Client-(Id|Secret)\s*['"]?\s*[:=]\s*['"][^'"]+['"]/i,
  /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9]{16,}/i,
  /JWT[_A-Z]*SECRET\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/,
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
];

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
      if (isBannedLib(m[1])) add('C1-LIB', 'FAIL', rel, i + 1, `수집·크롤·스케줄 라이브러리 import: ${m[1]}`);
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
      while ((m = ABS_URL_RE.exec(txt)) !== null) if (!LOCAL_HOST.test(m[2])) out.push(m[1]);
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
      if (SHOP_API_RE.test(l)) add('C1-SDK', 'FAIL', rel, i + 1, '쇼핑 오픈API 호스트 전면 금지');
      MAP_HOST_RE.lastIndex = 0;
      if (!SDK_ALLOWED(rel) && MAP_HOST_RE.test(l)) add('C1-SDK', 'FAIL', rel, i + 1, '지도 SDK 호스트는 client/src/map/**·server/src/middleware/spa.ts 만');
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
      if (isBannedLib(name)) ctx.add('C1-LIB', 'FAIL', rel, null, `${sec} 에 금지 라이브러리: ${name}`);
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
        else add('C4-STEM', 'WARN', rel, null, `${where} ${n.path}: 금지어 어간 "${h.term}"`);
      }
    });

    // C6-IMG
    if (!row || typeof row !== 'object') return;
    if (file === SEED_FILES.photos && row.status !== 'SLOT') {
      const miss = [];
      if (!PHOTO_LICENSES.has(row.license)) miss.push(`license(${row.license})`);
      if (typeof row.source !== 'string' || row.source.trim() === '') miss.push('source');
      if (typeof row.sourceUrl !== 'string' || !/^https:\/\/[^\s/]+/i.test(row.sourceUrl)) miss.push('https sourceUrl');
      if (typeof row.downloadedAt !== 'string' || row.downloadedAt.trim() === '') miss.push('downloadedAt');
      if (row.license !== 'CC0' && (typeof row.author !== 'string' || row.author.trim() === '')) miss.push('author');
      if ((row.license === 'CC_BY' || row.license === 'CC_BY_SA') && ccLicenseOfUrl(row.licenseUrl) !== row.license) miss.push('licenseUrl(CC 증서)');
      if (miss.length) add('C6-IMG', 'FAIL', rel, null, `${where}: 사용권 기록 누락 ${miss.join(', ')}`);
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
    if (/^\.env(\..*)?$/.test(b) && !b.endsWith('.example')) add('C7-SECRET', 'FAIL', f, null, 'git 추적 중인 .env 파일');
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
  for (const p of ['client/package.json', 'server/package.json']) {
    const abs = join(root, ...p.split('/'));
    if (existsSync(abs)) extra.push(abs);
  }

  let count = 0;
  for (const abs of [...files, ...extra]) {
    const rel = relPosix(root, abs);
    const ext = extname(abs);
    if (abs.endsWith('.example')) continue;
    if (ext && !TEXT_EXT.has(ext) && !/^Dockerfile/.test(basename(abs))) continue;
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
    });
    if (['package.json', 'client/package.json', 'server/package.json'].includes(rel)) {
      scanPackage(rel, text, ctx);
    }
    if (CODE_EXT.has(ext)) scanCode(rel, text, ctx);
    else if (ext === '.prisma' && rel.startsWith('server/prisma/')) scanPrisma(rel, text, ctx);
    else if (ext === '.json' && rel.startsWith('server/seed/') && !rel.slice('server/seed/'.length).includes('/')) scanSeedFile(rel, text, ctx);
  }
  checkGuardTests(root, add);
  checkTrackedEnv(root, add, notes);
  return { files: count };
}
