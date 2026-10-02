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
// 규칙: C1-FETCH C1-LIB C1-SDK C1-SEEDURL · C2-TRADE C2-PRICE · C3-QUERY C3-GUARDTEST C3-OUT-ID C3-OUT-ROUTE ·
//       C4-BANNED C4-CODE(R4 FAIL) C4-STEM(WARN) · C5-GEO · C6-IMG · C7-SECRET · C8-OUT-SAFE · C0-SEED C0-OUTPUT
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDir } from './lib/files.mjs';
import { seoulToday } from './lib/dates.mjs';
import { ConfigError, loadBannedWords } from './lib/normalize.mjs';
import { scanSources } from './lib/rules-source.mjs';
import { scanOutputs } from './lib/rules-output.mjs';
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
      if (dayNumber(o.now) === null) throw new ConfigError(`--now 는 YYYY-MM-DD: ${o.now}`);
    }
    else throw new ConfigError(`알 수 없는 인수: ${a}`);
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
    if (!isDir(opts.root)) throw new ConfigError(`--root 디렉터리 없음: ${opts.root}`);
    bw = loadBannedWords(join(opts.root, ...BANNED_WORDS_PATH.split('/')));
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    process.stderr.write(`compliance-scan: CONFIG ERROR — ${e.message}\n`);
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

  const seedDir = join(opts.root, 'server', 'seed');
  const { seed } = readSeed(seedDir);
  const ex = computeExposure(seed, opts.now);
  const digest = existsSync(seedDir) ? seedDigest(seedDir) : null;
  const outputs = scanOutputs({ root: opts.root, dist: opts.prerender, ex, digest, bw, add, requireOutput: opts.requireOutput });
  if (outputs === 'NOT RUN') notes.push('산출물 규칙(C3-OUT-*, C4 산출물, C6 산출물, C8): NOT RUN — prerender-manifest.json 없음');

  const order = { FAIL: 0, WARN: 1 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  const fail = findings.filter((f) => f.severity === 'FAIL').length;
  const warn = findings.length - fail;
  const exposed = Object.fromEntries(Object.entries(ex.ids).map(([k, s]) => [k, s.size]));

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ ok: fail === 0, fail, warn, files, outputs, seedDigest: digest, asOf: opts.now, exposed, notes, findings })}\n`);
  } else {
    const head = fail === 0 ? 'OK' : 'FAIL';
    process.stdout.write(`compliance-scan: ${head} — ${fail} FAIL, ${warn} WARN (files ${files}, outputs ${outputs}, asOf ${opts.now})\n`);
    for (const f of findings) process.stdout.write(`  ${f.severity} ${f.rule} ${f.file}${f.line ? `:${f.line}` : ''} ${f.message}\n`);
    for (const n of notes) process.stdout.write(`  note: ${n}\n`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main();
