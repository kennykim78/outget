// 서명 매니페스트 규칙 G01~G07(보안 79 H-1, Kenny 2026-10-25 'H-1 라벨', 불변식 7). G07(QA 82 D2) = signedBy AI 핸들 금지.
//   "VERIFIED 행 집합 = 서명 집합"을 기계로 검증한다. 매니페스트 = server/seed/review-signatures.json
//   (배열, 항목 { file, id, basis, signedBy, signedAt, factHash }). factHash 는 그 행의 사실 필드 해시 —
//   서명 뒤 사실이 바뀌면 G05 로 실패해 재서명을 요구한다.
//   해시 알고리즘은 scripts/lib/review-signature.mjs 와 같다(패리티 테스트 seed.signatures.test.ts).
//   순수 모듈(fs·시계 없음 — node:crypto 해시만).
import { createHash } from 'node:crypto';
import def from './fact-fields.json' with { type: 'json' };
import { isAiHandle } from './ai-handle.js';
import { asRec, CONTENT_KEYS, has, isIsoDate, isNonEmptyStr, SEED_FILES, type Rec, type SeedKey } from './common.js';
import type { Ctx } from './context.js';

export const SIGNATURE_FILE = 'review-signatures.json';

/** 검수 방식(시드 공통 필드 reviewBasis). VERIFIED 행만 값, 그 밖은 null. */
export const REVIEW_BASES = ['ROW_CHECKED', 'AI_RESEARCH_BULK'] as const;
export type ReviewBasis = (typeof REVIEW_BASES)[number];
export const isReviewBasis = (v: unknown): v is ReviewBasis => typeof v === 'string' && (REVIEW_BASES as readonly string[]).includes(v);

/** seed-equivalence 사실 필드(단일 출처 fact-fields.json). */
export const FACT_FIELDS: readonly string[] = Object.freeze([...def.factFields]);
export const SIGNATURE_STRIP_KEYS: readonly string[] = Object.freeze([...def.signatureStripKeys]);
/** 서명 해시 대상 = 사실 필드 ∪ 서명 확장 필드(대상·범위·출처). */
export const SIGNATURE_FIELDS: readonly string[] = Object.freeze([...new Set([...def.factFields, ...def.signatureExtraFields])]);

export const FACT_HASH_RE = /^[0-9a-f]{64}$/;

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Rec;
    const keys = Object.keys(o).filter((k) => !SIGNATURE_STRIP_KEYS.includes(k) && o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function signedPick(row: Rec): Rec {
  const o: Rec = {};
  for (const k of SIGNATURE_FIELDS) if (has(row, k)) o[k] = row[k];
  return o;
}

/** 행 사실 해시 = sha256(canonicalJson({ file, id, fields })) 16진 64자. file = 시드 파일명(예 supply-items.json). */
export function factHash(file: string, row: Rec): string {
  return createHash('sha256').update(canonicalJson({ file, id: row.id, fields: signedPick(row) }), 'utf8').digest('hex');
}

/** 매니페스트 입력 — CLI 는 항상 넘긴다(파일 없음 = missing). 생략은 메모리 단위 테스트 전용(G 규칙 건너뜀). */
export type SignatureInput = { missing: true } | { missing: false; data: unknown };

export interface SignatureEntry {
  file: string;
  id: string;
  basis: ReviewBasis;
  signedBy: string;
  signedAt: string;
  factHash: string;
}

const ENTRY_KEYS = ['file', 'id', 'basis', 'signedBy', 'signedAt', 'factHash'] as const;
const FILE_TO_KEY = new Map<string, SeedKey>(CONTENT_KEYS.map((k) => [SEED_FILES[k], k]));

/** 발췌 비교용 정규화(K1 하위 결정 2026-11-15): NFKC(전각 마침표 U+FF0E → ASCII 마침표) 뒤 공백·마침표(ASCII 마침표·U+3002) 제거. */
const excerptNorm = (s: string): string => s.normalize('NFKC').replace(/[\s.\u3002]+/gu, '');

/**
 * whyShort 가 같은 행(객체) why 또는 notNowReason 의 부분 문자열(공백·마침표 정규화 후)인가 = 원문 발췌.
 *   발췌는 원문의 검수 근거를 상속, 재서술은 사람이 행별로 확인(ROW_CHECKED)해야 한다(K1, 불변식 7 사실 창작 금지).
 *   whyShort 키가 없거나 문자열이 아니면 판정 대상 아님(false = 추가 요구 없음; 타입은 S03·R03).
 *   override 는 같은 override 객체의 why·notNowReason 만 본다(기본 행 원문은 보지 않음 — fail-closed).
 */
export function whyShortIsRephrased(o: Rec): boolean {
  if (!has(o, 'whyShort') || typeof o.whyShort !== 'string') return false;
  const short = excerptNorm(o.whyShort);
  return ![o.why, o.notNowReason].some((t) => typeof t === 'string' && excerptNorm(t).includes(short));
}

/** 행 수준 basis 정책의 사유(V10 메시지용). 정책 없음 = null. */
export function requiredBasisReason(key: SeedKey, r: Rec): string | null {
  if (key === 'curatedProducts') return '상품';
  // 저렴 대체 팁: 위험 태그가 있거나 규격 예시가 있는 행은 행별 확인만(REFERENCE 노출은 검수와 무관하지만, VERIFIED 로 올릴 때의 규칙).
  if (key === 'budgetTips' && ((Array.isArray(r.hazards) && r.hazards.length > 0) || asRec(r.specExample) !== null)) return '위험 태그·규격 예시가 있는 팁 행';
  const nonEmptyRules = (rs: unknown): boolean => {
    const rules = asRec(rs)?.rules;
    return Array.isArray(rules) && rules.length > 0;
  };
  if (key === 'supplyRequirements') {
    if (nonEmptyRules(r.minSpec)) return '최소 규격 행';
    if (whyShortIsRephrased(r)) return '원문 발췌가 아닌 whyShort 행';
  }
  if (key === 'animalTypes') {
    const reqs = asRec(asRec(r.careOverrides)?.requirements);
    if (reqs) {
      const os = Object.values(reqs).map(asRec).filter((o): o is Rec => o !== null);
      if (os.some((o) => nonEmptyRules(o.minSpec))) return '최소 규격 행';
      if (os.some(whyShortIsRephrased)) return '원문 발췌가 아닌 whyShort 행';
    }
  }
  return null;
}

/**
 * 행 수준 basis 정책(V10, 서명 매니페스트 없이도 항상): 사람이 행별로 연 출처만 근거가 되는 행은 ROW_CHECKED 만.
 *   상품(제조사 규격 — 확인표 B) · 최소 규격 규칙이 있는 요구사항(확인표 A) · 최소 규격 override 가 있는 AnimalType
 *   · whyShort 가 같은 행 why·notNowReason 의 발췌가 아닌 요구사항·override(K1 하위 결정 2026-11-15).
 *   반환 null = 정책 없음(AI_RESEARCH_BULK 허용).
 */
export function requiredBasis(key: SeedKey, r: Rec): ReviewBasis | null {
  return requiredBasisReason(key, r) === null ? null : 'ROW_CHECKED';
}

function parseEntries(ctx: Ctx, data: unknown): SignatureEntry[] {
  const { out } = ctx;
  if (!Array.isArray(data)) {
    out.error('G01', null, null, SIGNATURE_FILE, '서명 매니페스트 최상위가 JSON 배열이 아니다');
    return [];
  }
  const entries: SignatureEntry[] = [];
  const seen = new Set<string>();
  data.forEach((x, i) => {
    const e = asRec(x);
    const at = `${SIGNATURE_FILE}[${i}]`;
    if (!e) return out.error('G01', null, null, at, '항목은 객체');
    const bad: string[] = [];
    for (const k of Object.keys(e)) if (!(ENTRY_KEYS as readonly string[]).includes(k)) bad.push(`알 수 없는 키 ${k}`);
    if (typeof e.file !== 'string' || !FILE_TO_KEY.has(e.file)) bad.push(`file 은 콘텐츠 시드 파일명(${[...FILE_TO_KEY.keys()].join('/')})`);
    if (!isNonEmptyStr(e.id)) bad.push('id 가 비었다');
    if (!isReviewBasis(e.basis)) bad.push(`basis 는 ${REVIEW_BASES.join('/')}`);
    if (!isNonEmptyStr(e.signedBy)) bad.push('signedBy 가 비었다');
    // G07(QA 82 D2) — 서명자는 사람만. 형식 오류와 별개로 보고(항목은 계속 검사).
    else if (isAiHandle(e.signedBy)) out.error('G07', null, null, `${at}.signedBy`, `signedBy=${JSON.stringify(e.signedBy)} 는 AI/봇 핸들 — 서명은 사람만(불변식 7)`);
    if (!isIsoDate(e.signedAt)) bad.push('signedAt 은 YYYY-MM-DD');
    else if (e.signedAt > ctx.now) bad.push(`signedAt 미래 날짜 ${e.signedAt} (기준 ${ctx.now})`);
    if (typeof e.factHash !== 'string' || !FACT_HASH_RE.test(e.factHash)) bad.push('factHash 는 16진 64자(sha256)');
    if (bad.length > 0) return out.error('G01', null, null, at, bad.join('; '));
    const k = `${String(e.file)}#${String(e.id)}`;
    if (seen.has(k)) return out.error('G01', null, null, at, `중복 항목 ${k}`);
    seen.add(k);
    entries.push(e as unknown as SignatureEntry);
  });
  return entries;
}

/** G01~G06. input 생략 = 건너뜀(메모리 테스트). CLI(validate·load·prerender)는 항상 넘긴다. */
export function checkSignatures(ctx: Ctx, input: SignatureInput | undefined): void {
  if (input === undefined) return;
  const { out } = ctx;
  if (input.missing) {
    out.error('G01', null, null, SIGNATURE_FILE, `서명 매니페스트 ${SIGNATURE_FILE} 없음(빈 배열 [] 이라도 있어야 한다)`);
    return;
  }
  const entries = parseEntries(ctx, input.data);
  const byKey = new Map(entries.map((e) => [`${e.file}#${e.id}`, e]));

  // G03 고아 — 항목마다 대응 행이 있고 VERIFIED 여야 한다.
  for (const e of entries) {
    const key = FILE_TO_KEY.get(e.file) as SeedKey;
    const row = ctx.byId[key].get(e.id);
    if (!row) out.error('G03', key, e.id, SIGNATURE_FILE, '서명 항목에 대응하는 행이 없다(고아)');
    else if (row.reviewStatus !== 'VERIFIED') out.error('G03', key, e.id, SIGNATURE_FILE, `서명 항목의 행이 VERIFIED 가 아니다(${String(row.reviewStatus)}) — 고아`);
  }

  for (const key of CONTENT_KEYS) {
    const file = SEED_FILES[key];
    for (const { rec, id } of ctx.rows[key]) {
      const e = byKey.get(`${file}#${id}`);
      const specSigned = key === 'curatedProducts' && (rec.specVerifiedBy != null || rec.specVerifiedAt != null);
      if (rec.reviewStatus !== 'VERIFIED') {
        if (specSigned) out.error('G06', key, id, 'specVerifiedBy', '규격 확인(specVerifiedBy/At)은 서명된 VERIFIED 상품만 — 서명 항목 없음');
        continue;
      }
      // G02 — VERIFIED 는 서명 항목 필수.
      if (!e) {
        out.error('G02', key, id, 'reviewStatus', `VERIFIED 인데 ${SIGNATURE_FILE} 에 서명 항목이 없다`);
        continue;
      }
      // G04 — 표기 일치.
      if (e.basis !== rec.reviewBasis) out.error('G04', key, id, 'reviewBasis', `행 ${String(rec.reviewBasis)} ≠ 서명 basis ${e.basis}`);
      if (e.signedBy !== rec.verifiedBy) out.error('G04', key, id, 'verifiedBy', `행 ${String(rec.verifiedBy)} ≠ 서명 signedBy ${e.signedBy}`);
      if (e.signedAt !== rec.verifiedAt) out.error('G04', key, id, 'verifiedAt', `행 ${String(rec.verifiedAt)} ≠ 서명 signedAt ${e.signedAt}`);
      // G05 — 사실 해시.
      const h = factHash(file, rec);
      if (h !== e.factHash) out.error('G05', key, id, SIGNATURE_FILE, `사실 필드 해시 불일치(서명 뒤 사실이 바뀜 — 재서명 필요): 행 ${h.slice(0, 12)}… ≠ 서명 ${e.factHash.slice(0, 12)}…`);
      // G06 — 상품 규격 확인 = 같은 서명(ROW_CHECKED).
      if (specSigned) {
        if (e.basis !== 'ROW_CHECKED') out.error('G06', key, id, 'specVerifiedBy', `규격 확인은 ROW_CHECKED 서명만 (현재 ${e.basis})`);
        if (rec.specVerifiedBy !== e.signedBy) out.error('G06', key, id, 'specVerifiedBy', `행 ${String(rec.specVerifiedBy)} ≠ 서명 signedBy ${e.signedBy}`);
        if (rec.specVerifiedAt !== e.signedAt) out.error('G06', key, id, 'specVerifiedAt', `행 ${String(rec.specVerifiedAt)} ≠ 서명 signedAt ${e.signedAt}`);
      }
    }
  }
}
