#!/usr/bin/env node
// WithSmall 컴플라이언스 / 시크릿 / 노출 정적 스캐너 — R3 계획 §5(C1-FETCH ~ C8-OUT-SAFE), D8·D9·D10.
// 의존성 0(node 빌트인만), Node 20 호환.
//
// 사용법:
//   node scripts/compliance-scan.mjs                     # 사람용 출력
//   node scripts/compliance-scan.mjs --json              # 기계용 JSON 한 줄
//   node scripts/compliance-scan.mjs --root <dir>        # 다른 트리(테스트 픽스처)
//   node scripts/compliance-scan.mjs --prerender <dir>   # 산출물 디렉터리(기본 <root>/client/dist)
//   node scripts/compliance-scan.mjs --require-output    # manifest 없으면 FAIL("NOT RUN")
//   node scripts/compliance-scan.mjs --now YYYY-MM-DD    # 노출 기준일(M-1 검수 나이, 기본 오늘 Asia/Seoul). 프리렌더 --now 와 맞춘다
//
// exit: 0 = FAIL 0건(WARN 은 무관) · 1 = FAIL ≥1 · 2 = 설정 오류(인수, 금지어 단일 소스 없음·형식 오류)
//
// 규칙: C1-FETCH C1-LIB C1-SDK C1-SEEDURL · C2-TRADE C2-PRICE · C3-QUERY C3-GUARDTEST C3-OUT-ID C3-OUT-ROUTE C3-OUT-SRC C3-OUT-TAXON C3-OUT-DRAFTSRC C3-OUT-REVIEWMETA C3-TAXON ·
//       C4-BANNED C4-CODE(R4 FAIL) C4-STEM(R6: 산출물·VERIFIED/APPROVED 시드 FAIL, DRAFT 시드 WARN) · C5-GEO(+R5 위치 API 0) · C6-IMG C6-IMG-AI-PRODUCT(354 상품 칸 생성 이미지 금지) · C7-SECRET · C8-OUT-SAFE C8-SRC-SAFE ·
//       C9-STORAGE(웹 저장소 lib/storage.ts 만·document.cookie 0) C9-COOKIE(서버 쿠키 발급 2파일) ·
//       C9-PRIVACY(/privacy 존재·모든 라우트 링크·기간 숫자 = server/src/privacy/policy.ts FAIL, {{KENNY: 자리표시 WARN — 차단은 운영 기동 검사; 294 manifest.privacyPage:false 면 /privacy·링크·자리표시 0·비공개를 FAIL 로) · C0-SEED C0-OUTPUT ·
//       C9-TIPS(301 — /tips 고지 원문·외부 a rel ugc·검수 라벨 0·팁 id 는 노출 타입 /tips 에만; C1-SEEDURL 은 budget-tips references[i].url 글 페이지만 예외, REFERENCE 행 어간 FAIL) ·
//       C9-GENERAL(390 — 고정 6종 ∧ 시드+asOf 독립 노출 판정 ∧ 타입·프로필·노출 요구사항·용품 중 GI 행 있음이면 고지 1회, GI 없는 노출 6종·그 밖 타입은 0; 6종 노출 판정 불가는 FAIL; C3-OUT-REVIEWMETA 는 데이터 산출물 AI_DRAFT 0·카탈로그 GENERAL_INFO 행 generalInfo:true 표기) ·
//       C6-IMG-SPECIES(359 — 라우트 HTML·ws-data 사진 id 가 그 라우트 종·프로필·품목 범위와 자리 안, 장면 행은 장면 허용 종만, 사용 불가 id 0; 소스 짝 C6-IMG-SPECIES-SRC: client/src·server/src/prerender 비테스트 [cm]?[jt]sx? 문자열에 고정 사진 id 0, client/src 는 /assets/(photos|items)/ 리터럴·장면 표·사진 선택 식별자도 0 — 363) ·
//       C10-AFF-IMPORT C10-AFF-RUNTIME(WARN) C10-AFF-HOST C10-AFF-REDIRECT C10-AFF-FIELD C10-AFF-OUT(258 단계 7 — 검색 딥링크 제휴 격리, scripts/lib/rules-affiliate.mjs)
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDir } from './lib/files.mjs';
import { seoulToday } from './lib/dates.mjs';
import { ConfigError, loadBannedWords } from './lib/normalize.mjs';
import { redactMessage, safePath, scanSources } from './lib/rules-source.mjs';
import { scanOutputs, scanSeedExposure } from './lib/rules-output.mjs';
import { scanAffiliateOutputs, scanAffiliateSources } from './lib/rules-affiliate.mjs';
import { computeExposure, dayNumber, readSeed, seedDigest } from './lib/seed-exposure.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BANNED_WORDS_PATH = 'server/src/seed/banned-words.json';

function parseArgs(argv) {
  const o = { root: REPO_ROOT, json: false, prerender: null, requireOutput: false, now: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new ConfigError(`${a} 에 값이 필요하다`);
      return v;
    };
    if (a === '--json') o.json = true;
    else if (a === '--require-output') o.requireOutput = true;
    else if (a === '--root') o.root = resolve(val());
    else if (a === '--prerender') o.prerender = val();
    else if (a === '--now') {
      o.now = val();
      if (dayNumber(o.now) === null) throw new ConfigError('--now 는 YYYY-MM-DD 형식이어야 한다(입력값 생략)');
    }
    else throw new ConfigError(`알 수 없는 인수(${i + 1}번째, 입력값 생략)`); // 239(Codex night-qa4 #1): 인수 오류는 종류·위치만
  }
  if (o.now === null) o.now = seoulToday(); // L-A: 오늘(Asia/Seoul) — CI·프리렌더와 같은 기준
  o.prerender = o.prerender === null ? join(o.root, 'client', 'dist') : isAbsolute(o.prerender) ? o.prerender : resolve(o.prerender);
  return o;
}

function main() {
  let opts;
  let bw;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (!isDir(opts.root)) throw new ConfigError('--root 디렉터리 없음(경로 생략)');
    bw = loadBannedWords(join(opts.root, ...BANNED_WORDS_PATH.split('/')));
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    process.stderr.write(`compliance-scan: CONFIG ERROR — ${redactMessage(e.message)}\n`);
    process.exit(2);
  }

  const findings = [];
  const seenKey = new Set();
  const add = (rule, severity, file, line, message) => {
    const k = `${rule}|${severity}|${file}|${line}|${message}`;
    if (seenKey.has(k)) return;
    seenKey.add(k);
    findings.push({ rule, severity, file, line: line ?? null, message });
  };
  const notes = [];

  const { files } = scanSources(opts.root, { add, bw }, notes);
  scanAffiliateSources(opts.root, add, bw); // 260: C10-AFF-IMPORT·RUNTIME·HOST·REDIRECT·FIELD(258 단계 7)

  const seedDir = join(opts.root, 'server', 'seed');
  const { seed } = readSeed(seedDir);
  const ex = computeExposure(seed, opts.now);
  const digest = existsSync(seedDir) ? seedDigest(seedDir) : null;
  scanSeedExposure({ ex, add });
  const outputs = scanOutputs({ root: opts.root, dist: opts.prerender, ex, digest, bw, add, requireOutput: opts.requireOutput, seed });
  if (outputs === 'RUN') scanAffiliateOutputs({ root: opts.root, dist: opts.prerender, add }); // 260: C10-AFF-OUT
  if (outputs === 'NOT RUN') notes.push('산출물 규칙(C3-OUT-*, C4 산출물, C6 산출물, C8, C9-PRIVACY): NOT RUN — prerender-manifest.json 없음');

  const order = { FAIL: 0, WARN: 1 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  const fail = findings.filter((f) => f.severity === 'FAIL').length;
  const warn = findings.length - fail;
  const exposed = Object.fromEntries(Object.entries(ex.ids).map(([k, s]) => [k, s.size]));

  // 230(Codex night-qa3 C7-1) 심층 방어: 규칙 메시지는 값 없이 만들지만, 메시지 자체가 C7 규칙에 걸리면 출력 직전에 고정 문구로 가린다(사람용·JSON 공통).
  // 239(Codex night-qa4 #2): file 도 경로 마디별 safeLabel — 출력용 사본만(위 정렬·중복 제거는 원래 경로).
  const shown = findings.map((f) => ({ ...f, file: safePath(f.file), message: redactMessage(f.message) }));
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ ok: fail === 0, fail, warn, files, outputs, seedDigest: digest, asOf: opts.now, exposed, notes, findings: shown })}\n`);
  } else {
    const head = fail === 0 ? 'OK' : 'FAIL';
    process.stdout.write(`compliance-scan: ${head} — ${fail} FAIL, ${warn} WARN (files ${files}, outputs ${outputs}, asOf ${opts.now})\n`);
    for (const f of shown) process.stdout.write(`  ${f.severity} ${f.rule} ${f.file}${f.line ? `:${f.line}` : ''} ${f.message}\n`);
    for (const n of notes) process.stdout.write(`  note: ${n}\n`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main();
