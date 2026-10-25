// 서명 매니페스트 사실 해시(보안 79 H-1, Kenny 2026-10-25 'H-1 라벨').
//   server/src/seed/signatures.ts 의 factHash 와 같은 알고리즘의 독립 구현 — 패리티 테스트
//   (server/src/__tests__/seed.signatures.test.ts)가 실시드 전 행에서 두 구현의 해시가 같음을 고정한다.
//   필드 목록 단일 출처: server/src/seed/fact-fields.json (seed-equivalence 의 '사실 필드' + 서명 확장 필드).
//   의존성 0, 네트워크 0.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEF = JSON.parse(readFileSync(join(ROOT, 'server', 'src', 'seed', 'fact-fields.json'), 'utf8'));

/** seed-equivalence 가 비교하는 사실 필드(PRD 부록 B 기준). */
export const FACT_FIELDS = Object.freeze([...DEF.factFields]);
/** 서명 해시에 더 넣는 필드(대상·범위·출처 — 바뀌면 서명한 내용이 바뀐다). */
export const SIGNATURE_EXTRA_FIELDS = Object.freeze([...DEF.signatureExtraFields]);
/** 해시 전에 재귀적으로 지우는 표시 전용 키(optionLabels 등 — 사실 아님). */
export const SIGNATURE_STRIP_KEYS = Object.freeze([...DEF.signatureStripKeys]);
export const SIGNATURE_FIELDS = Object.freeze([...new Set([...FACT_FIELDS, ...SIGNATURE_EXTRA_FIELDS])]);

export const REVIEW_BASES = Object.freeze(['ROW_CHECKED', 'AI_RESEARCH_BULK']);
export const SIGNATURE_FILE = 'review-signatures.json';
export const FACT_HASH_RE = /^[0-9a-f]{64}$/;

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** 키 정렬·표시 키 제거한 정규 JSON. */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => !SIGNATURE_STRIP_KEYS.includes(k) && v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** 서명 대상 필드만 고른 객체(행에 있는 키만). */
export function signedPick(row) {
  const o = {};
  for (const k of SIGNATURE_FIELDS) if (hasOwn(row, k)) o[k] = row[k];
  return o;
}

/** 행 사실 해시 = sha256(canonicalJson({ file, id, fields })) 16진 64자. */
export function factHash(file, row) {
  const payload = canonicalJson({ file, id: row.id, fields: signedPick(row) });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
