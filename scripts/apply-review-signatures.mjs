#!/usr/bin/env node
// 확인표 결과 → 시드 검수 표기 + 서명 매니페스트(보안 79 H-1, Kenny 2026-10-25 'H-1 라벨').
//
//   node scripts/apply-review-signatures.mjs --packet <packet.json> --result <result.json>
//        [--seed <dir>] [--draft <dir>|--no-draft] [--stage review|final] [--now YYYY-MM-DD] [--dry-run]
//
// 패킷(scripts/review-packets/*.json): 확인표 항목 → 시드 행 대응.
//   rowChecked[] = { file, id, items[] } — items 가 전부 ☑ 이면 ROW_CHECKED 서명(확인표 A·B).
//   bulk = { item: "C", rows[]: { file, id } } — 결과의 bulkSignedAt 이 있으면 AI_RESEARCH_BULK 서명(확인표 C).
// 결과(확인표를 옮긴 JSON, 형식 withsmall.review-check-result/v1):
//   { format, packet, signedBy, checkedAt: "YYYY-MM-DD"|null, checked: ["A1", "cp-dw-001", ...], bulkSignedAt: "YYYY-MM-DD"|null, notes?: {항목: 메모} }
//   checked 가 비어 있지 않으면 checkedAt 필수. notes 는 기록용(시드에 쓰지 않는다).
//
// 동작(패킷 대상 행만, 사실 필드 0 변경 — 실행 전후 factHash 를 모든 행에서 대조해 다르면 쓰지 않고 실패):
//   서명됨 + --stage final(기본): VERIFIED · reviewerType=패킷 reviewerType · verifiedBy=signedBy · verifiedAt=날짜 · reviewBasis=basis
//                                  상품은 specVerifiedBy/At 동일, status = meetsMinSpec true 면 ACTIVE 아니면 REVIEW. 매니페스트 항목 생성.
//   서명됨 + --stage review:      NEEDS_REVIEW · reviewerType=패킷 reviewerType · verifiedBy/At·reviewBasis null — CI seed-review-diff
//                                  R1·R2(DRAFT/AI_DRAFT → VERIFIED 직행 금지)를 위해 먼저 이 상태를 기본 브랜치에 넣고 final 을 다음 PR 로.
//   미서명:                         DRAFT · AI_DRAFT · verifiedBy/At null · reviewBasis null(상품 specVerifiedBy/At null · status REVIEW).
//   모든 콘텐츠 행: reviewBasis 키가 없으면 null 로 추가(verifiedAt 바로 뒤).
//   매니페스트: 패킷 밖 기존 항목은 유지, 패킷 행 항목은 이번 결과로 교체. (file, id) 순 정렬.
// 쓰기: server/seed 와 seed-draft 사본에 같은 변환(JSON 2칸 들여쓰기, 끝 개행 없음 — 기존 형식). 네트워크 0, 의존성 0.
// exit 0 성공 · 1 입력/대상 오류 · 2 인수 오류.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { factHash, SIGNATURE_FILE } from './lib/review-signature.mjs';
import { isAiHandle } from './lib/ai-handle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RESULT_FORMAT = 'withsmall.review-check-result/v1';

/** 부록 B 공통 필드를 갖는 콘텐츠 시드 파일(server/src/seed/common.ts CONTENT_KEYS 와 같은 집합). */
export const CONTENT_FILES = Object.freeze([
  'animal-types.json',
  'taxa.json',
  'care-profiles.json',
  'supply-items.json',
  'supply-requirements.json',
  'compatibility-rules.json',
  'setup-bundles.json',
  'curated-products.json',
]);
const PRODUCTS = 'curated-products.json';
/** 이 스크립트가 바꿀 수 있는 키(그 밖은 바이트 그대로 — 자기 검사). */
export const MANAGED_KEYS = Object.freeze(['reviewStatus', 'reviewerType', 'verifiedBy', 'verifiedAt', 'reviewBasis', 'specVerifiedBy', 'specVerifiedAt', 'status']);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const REVIEWER_TYPES_OK = ['OPERATOR', 'EXPERIENCED_KEEPER', 'VET_PUBLISHED_SOURCE', 'OFFICIAL_SOURCE', 'VET'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIso = (v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const clone = (v) => JSON.parse(JSON.stringify(v));

export class InputError extends Error {}

/** 패킷 형식 검사 → 항목 집합. */
export function checkPacket(packet) {
  const errs = [];
  if (!isObj(packet) || packet.v !== 1) errs.push('packet.v 는 1');
  if (typeof packet?.packet !== 'string' || packet.packet === '') errs.push('packet.packet 이름 필요');
  if (!REVIEWER_TYPES_OK.includes(packet?.reviewerType)) errs.push(`packet.reviewerType 은 ${REVIEWER_TYPES_OK.join('/')} (AI_DRAFT 불가)`);
  const rows = new Set();
  const items = new Set();
  const addRow = (r, where) => {
    if (!isObj(r) || !CONTENT_FILES.includes(r.file) || typeof r.id !== 'string' || r.id === '') return errs.push(`${where}: { file(콘텐츠 시드), id } 필요`);
    const k = `${r.file}#${r.id}`;
    if (rows.has(k)) errs.push(`${where}: 대상 행 중복 ${k}`);
    rows.add(k);
  };
  if (!Array.isArray(packet?.rowChecked)) errs.push('packet.rowChecked 배열 필요');
  else packet.rowChecked.forEach((r, i) => {
    addRow(r, `rowChecked[${i}]`);
    if (!Array.isArray(r?.items) || r.items.length === 0 || !r.items.every((x) => typeof x === 'string' && x !== '')) errs.push(`rowChecked[${i}].items 는 비어 있지 않은 문자열 배열`);
    else for (const x of r.items) items.add(x);
  });
  if (!isObj(packet?.bulk) || typeof packet.bulk.item !== 'string' || !Array.isArray(packet.bulk.rows)) errs.push('packet.bulk = { item, rows[] } 필요');
  else {
    if (items.has(packet.bulk.item)) errs.push(`bulk.item ${packet.bulk.item} 가 rowChecked 항목과 겹친다`);
    packet.bulk.rows.forEach((r, i) => addRow(r, `bulk.rows[${i}]`));
  }
  if (errs.length) throw new InputError(`패킷 오류: ${errs.join('; ')}`);
  return items;
}

/** 결과 형식 검사(확인표 → JSON). */
export function checkResult(result, packet, items, now) {
  const errs = [];
  if (!isObj(result)) throw new InputError('결과는 JSON 객체');
  const allowed = ['format', 'packet', 'signedBy', 'checkedAt', 'checked', 'bulkSignedAt', 'notes'];
  for (const k of Object.keys(result)) if (!allowed.includes(k)) errs.push(`알 수 없는 키 ${k}`);
  if (result.format !== RESULT_FORMAT) errs.push(`format 은 ${RESULT_FORMAT}`);
  if (result.packet !== packet.packet) errs.push(`packet 은 ${packet.packet}`);
  if (typeof result.signedBy !== 'string' || result.signedBy.trim() === '') errs.push('signedBy 필요');
  else if (isAiHandle(result.signedBy)) errs.push(`signedBy 에 AI 핸들 금지: ${result.signedBy}`);
  if (!Array.isArray(result.checked)) errs.push('checked 는 배열');
  else {
    const seen = new Set();
    for (const x of result.checked) {
      if (!items.has(x)) errs.push(`checked 의 알 수 없는 항목 ${JSON.stringify(x)}`);
      if (seen.has(x)) errs.push(`checked 중복 ${x}`);
      seen.add(x);
    }
    if (result.checked.length > 0 && !isIso(result.checkedAt)) errs.push('checked 가 있으면 checkedAt(YYYY-MM-DD) 필수');
  }
  if (result.checkedAt !== null && result.checkedAt !== undefined && !isIso(result.checkedAt)) errs.push('checkedAt 은 YYYY-MM-DD 또는 null');
  if (result.bulkSignedAt !== null && !isIso(result.bulkSignedAt)) errs.push('bulkSignedAt 은 YYYY-MM-DD 또는 null');
  for (const k of ['checkedAt', 'bulkSignedAt']) if (isIso(result[k]) && result[k] > now) errs.push(`${k} 미래 날짜 ${result[k]} (기준 ${now})`);
  if (result.notes !== undefined && (!isObj(result.notes) || !Object.values(result.notes).every((v) => typeof v === 'string'))) errs.push('notes 는 { 항목: 문자열 }');
  if (errs.length) throw new InputError(`결과 오류: ${errs.join('; ')}`);
}

/** reviewBasis 키를 verifiedAt 바로 뒤에 넣은 새 객체(키 순서 보존). */
function withBasisKey(row) {
  if (Object.prototype.hasOwnProperty.call(row, 'reviewBasis')) return row;
  const out = {};
  let placed = false;
  for (const [k, v] of Object.entries(row)) {
    out[k] = v;
    if (k === 'verifiedAt') {
      out.reviewBasis = null;
      placed = true;
    }
  }
  if (!placed) out.reviewBasis = null;
  return out;
}

/**
 * 순수 변환. files = { 'animal-types.json': rows[], ... }(콘텐츠 파일 전부), manifest = 기존 항목 배열.
 * 반환 { files, manifest, summary }. 입력은 바꾸지 않는다.
 */
export function applySignatures(files, manifest, packet, result, { stage = 'final', now }) {
  if (!['final', 'review'].includes(stage)) throw new InputError(`--stage 는 final|review: ${stage}`);
  if (!isIso(now)) throw new InputError(`now 는 YYYY-MM-DD: ${now}`);
  const items = checkPacket(packet);
  checkResult(result, packet, items, now);
  if (!Array.isArray(manifest)) throw new InputError(`${SIGNATURE_FILE} 은 배열`);
  const checked = new Set(result.checked);

  const out = {};
  for (const f of CONTENT_FILES) {
    if (!Array.isArray(files[f])) throw new InputError(`${f} 없음 또는 배열 아님`);
    out[f] = files[f].map((r) => withBasisKey(clone(r)));
  }
  const find = (file, id) => {
    const row = out[file].find((r) => r.id === id);
    if (!row) throw new InputError(`대상 행 없음: ${file}#${id}`);
    return row;
  };

  /** 대상 행 → { basis, date } | null. */
  const plan = [];
  for (const r of packet.rowChecked) {
    const ok = r.items.every((x) => checked.has(x));
    plan.push({ file: r.file, id: r.id, sig: ok ? { basis: 'ROW_CHECKED', date: result.checkedAt } : null });
  }
  for (const r of packet.bulk.rows) {
    plan.push({ file: r.file, id: r.id, sig: result.bulkSignedAt ? { basis: 'AI_RESEARCH_BULK', date: result.bulkSignedAt } : null });
  }

  const planned = new Set(plan.map((p) => `${p.file}#${p.id}`));
  const entries = manifest.filter((e) => !planned.has(`${e?.file}#${e?.id}`)).map(clone);
  const summary = { stage, rowChecked: 0, bulk: 0, needsReview: 0, unsigned: 0, targets: plan.length };

  for (const { file, id, sig } of plan) {
    const row = find(file, id);
    const product = file === PRODUCTS;
    if (sig && stage === 'final') {
      Object.assign(row, { reviewStatus: 'VERIFIED', reviewerType: packet.reviewerType, verifiedBy: result.signedBy, verifiedAt: sig.date, reviewBasis: sig.basis });
      if (product) Object.assign(row, { specVerifiedBy: result.signedBy, specVerifiedAt: sig.date, status: row.meetsMinSpec === true ? 'ACTIVE' : 'REVIEW' });
      entries.push({ file, id, basis: sig.basis, signedBy: result.signedBy, signedAt: sig.date, factHash: factHash(file, row) });
      summary[sig.basis === 'ROW_CHECKED' ? 'rowChecked' : 'bulk']++;
    } else if (sig) {
      Object.assign(row, { reviewStatus: 'NEEDS_REVIEW', reviewerType: packet.reviewerType, verifiedBy: null, verifiedAt: null, reviewBasis: null });
      if (product) Object.assign(row, { specVerifiedBy: null, specVerifiedAt: null, status: row.status === 'SLOT' ? 'SLOT' : 'REVIEW' });
      summary.needsReview++;
    } else {
      Object.assign(row, { reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, reviewBasis: null });
      if (product) Object.assign(row, { specVerifiedBy: null, specVerifiedAt: null, status: row.status === 'SLOT' ? 'SLOT' : 'REVIEW' });
      summary.unsigned++;
    }
  }
  entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 자기 검사: 관리 키 밖은 그대로, 모든 행의 factHash 불변(사실 0 변경).
  for (const f of CONTENT_FILES) {
    files[f].forEach((before, i) => {
      const after = out[f][i];
      if (before.id !== after.id) throw new Error(`자기 검사 실패: ${f}[${i}] id 변경`);
      for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (MANAGED_KEYS.includes(k)) continue;
        if (!isDeepStrictEqual(before[k], after[k])) throw new Error(`자기 검사 실패: ${f}#${before.id}.${k} 변경`);
      }
      if (factHash(f, before) !== factHash(f, after)) throw new Error(`자기 검사 실패: ${f}#${before.id} factHash 변경`);
    });
  }
  return { files: out, manifest: entries, summary };
}

// ── CLI ─────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { packet: null, result: null, seed: join(ROOT, 'server/seed'), draft: join(ROOT, 'docs/planning-artifacts/seed-draft'), stage: 'final', now: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new InputError(`${k} 값이 없다`);
      return v;
    };
    if (k === '--packet') a.packet = resolve(val());
    else if (k === '--result') a.result = resolve(val());
    else if (k === '--seed') a.seed = resolve(val());
    else if (k === '--draft') a.draft = resolve(val());
    else if (k === '--no-draft') a.draft = null;
    else if (k === '--stage') a.stage = val();
    else if (k === '--now') a.now = val();
    else if (k === '--dry-run') a.dryRun = true;
    else throw new InputError(`알 수 없는 인자: ${k}`);
  }
  if (!a.packet || !a.result) throw new InputError('--packet 과 --result 필요');
  return a;
}

function localToday() {
  // Asia/Seoul 날짜(CI·seed:validate 기준과 같음).
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const readJson = (p) => {
  const t = readFileSync(p, 'utf8');
  return JSON.parse(t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);
};

function applyDir(dir, packet, result, opts) {
  const files = {};
  for (const f of CONTENT_FILES) files[f] = readJson(join(dir, f));
  const sigPath = join(dir, SIGNATURE_FILE);
  const manifest = existsSync(sigPath) ? readJson(sigPath) : [];
  return applySignatures(files, manifest, packet, result, opts);
}

function writeDir(dir, res) {
  for (const [f, rows] of Object.entries(res.files)) writeFileSync(join(dir, f), JSON.stringify(rows, null, 2));
  writeFileSync(join(dir, SIGNATURE_FILE), JSON.stringify(res.manifest, null, 2));
}

export function main(argv, io = { out: (l) => console.log(l), err: (l) => console.error(l) }) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.err(`apply-review-signatures: ${e.message}`);
    io.err('usage: node scripts/apply-review-signatures.mjs --packet <p> --result <r> [--seed <dir>] [--draft <dir>|--no-draft] [--stage review|final] [--now YYYY-MM-DD] [--dry-run]');
    return 2;
  }
  try {
    const packet = readJson(args.packet);
    const result = readJson(args.result);
    const opts = { stage: args.stage, now: args.now ?? localToday() };
    const dirs = [args.seed, ...(args.draft ? [args.draft] : [])];
    const results = dirs.map((d) => [d, applyDir(d, packet, result, opts)]);
    if (results.length === 2 && !isDeepStrictEqual(results[0][1], results[1][1])) {
      throw new InputError('정본과 사본의 변환 결과가 다르다 — seed-draft 사본을 정본과 맞춘 뒤 다시 실행');
    }
    if (!args.dryRun) for (const [d, r] of results) writeDir(d, r);
    const s = results[0][1].summary;
    io.out(`apply-review-signatures: ${args.dryRun ? 'dry-run ' : ''}stage ${s.stage} · 대상 ${s.targets} · ROW_CHECKED ${s.rowChecked} · AI_RESEARCH_BULK ${s.bulk} · NEEDS_REVIEW ${s.needsReview} · 미서명(DRAFT) ${s.unsigned} · 매니페스트 ${results[0][1].manifest.length}항목 · 쓴 곳 ${args.dryRun ? '없음' : dirs.join(', ')}`);
    return 0;
  } catch (e) {
    io.err(`apply-review-signatures: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
