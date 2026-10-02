// 구조 규칙 S01~S09 — 파일·id·enum/타입·부록 B·specSchema·규칙 세트·날짜·금지 키(상품·후기는 허용목록)·미지 키.
import {
  ANIMAL_GROUPS,
  ANIMAL_TYPE_STATUSES,
  BUNDLE_TIERS,
  CONTENT_KINDS,
  IMAGE_LICENSES,
  LIFECYCLES,
  LINKED_ACTIONS,
  ORDER_HINTS,
  PRIORITIES,
  PRODUCT_STATUSES,
  REVIEWER_TYPES,
  REVIEW_STATUSES,
  SITUATIONS,
  SPEC_OPS,
  SUPPLY_CATEGORIES,
  TESTIMONIAL_STATUSES,
  VET_STATUSES,
} from '../engine/domain.js';
import {
  asRec,
  CONTENT_KEYS,
  has,
  ID_RE,
  isFiniteNum,
  isHttpUrl,
  isIsoDate,
  isNonEmptyStr,
  isSlotRow,
  SEED_FILES,
  SEED_KEYS,
  type Rec,
  type SeedKey,
} from './common.js';
import type { Ctx } from './context.js';

// ── 필드 타입 표(S03 타입 + S09 알려진 키의 단일 출처) ─────────
// 'string' | 'string|null' | 'boolean' | 'boolean|null' | 'number|null' | 'array' | 'object' | 'any', 끝 '?' = 생략 가능.
type FieldSpec = string;

export const META_FIELDS: Record<string, FieldSpec> = {
  reviewStatus: 'any',
  reviewerType: 'any',
  verifiedBy: 'any',
  verifiedAt: 'any',
  contentKind: 'any',
  source: 'any',
};

const FIELDS: Record<SeedKey, Record<string, FieldSpec>> = {
  animalTypes: {
    id: 'string', group: 'string', displayName: 'string', status: 'string', aliases: 'array',
    taxonId: 'string|null', careProfileId: 'string|null', careOverrides: 'object',
    mascot: 'string|null?', oneLiner: 'string|null?', slug: 'string|null?', seoTitle: 'string|null?', seoDescription: 'string|null?',
  },
  taxa: { id: 'string', scientificName: 'string', koreanName: 'string', legal: 'object', revisionOf: 'string|null' },
  careProfiles: { id: 'string', name: 'string', taxonIds: 'array', facts: 'object', careNotes: 'array' },
  supplyItems: {
    id: 'string', name: 'string', category: 'string', glyph: 'string', lifecycle: 'string', specSchema: 'object',
    compatibleAlternativeIds: 'array', description: 'string', replaceCycleDays: 'number|null?', inspectCycleDays: 'number|null?',
  },
  supplyRequirements: {
    id: 'string', careProfileId: 'string', supplyItemId: 'string', priority: 'string', orderHint: 'string',
    why: 'string', caution: 'string|null', avoid: 'string|null', minSpec: 'object', recommendedSpec: 'object',
    notNowReason: 'string|null', searchKeyword: 'string|null',
  },
  compatibilityRules: { id: 'string', a: 'string', b: 'string', careProfileId: 'string|null?', rules: 'array' },
  setupBundles: {
    id: 'string', careProfileId: 'string', tier: 'string', name: 'string', glyph: 'string', purpose: 'string',
    itemIds: 'array', estimatedRangeText: 'string|null', note: 'string|null',
  },
  curatedProducts: {
    id: 'string', supplyItemId: 'string', careProfileIds: 'array', title: 'string', imageAsset: 'string|null',
    specValues: 'object', targetSpecLabel: 'string|null?', meetsMinSpec: 'boolean|null', specVerifiedBy: 'string|null',
    specVerifiedAt: 'string|null', status: 'string', imageLicense: 'string', curationReasons: 'array?', note: 'string|null?',
  },
  testimonials: {
    id: 'string', quote: 'string', animalTypeId: 'string', situation: 'string', linkedAction: 'string',
    verifiedUsage: 'boolean', source: 'string', consentAt: 'string|null', status: 'string',
    reviewerImage: 'string|null', reviewerImageConsent: 'boolean',
  },
  vetClinics: {
    id: 'string', name: 'string', region: 'string', treats: 'array', night: 'boolean|null', emergency: 'boolean|null',
    phone: 'string', address: 'string', lat: 'number|null', lng: 'number|null', verification: 'object',
  },
  photos: {
    id: 'string', scene: 'string', slot: 'string', query: 'string', source: 'string|null', license: 'string|null',
    author: 'string|null', sourceUrl: 'string|null', downloadedAt: 'string|null', modified: 'boolean', status: 'string',
  },
};

const VERIFICATION_FIELDS: Record<string, FieldSpec> = {
  status: 'string', method: 'string', verifiedAt: 'string|null', note: 'string|null',
};

export const PHOTO_SOURCES = ['WIKIMEDIA', 'UNSPLASH', 'PEXELS', 'PIXABAY', 'OWN', 'SELLER', 'AFFILIATE'] as const;
export const PHOTO_LICENSES = ['CC0', 'CC_BY', 'CC_BY_SA', 'SITE_LICENSE', 'PERMISSION'] as const;

const SLOT = 'SLOT';
const ENUMS: Record<SeedKey, Record<string, readonly string[]>> = {
  animalTypes: { group: ANIMAL_GROUPS, status: ANIMAL_TYPE_STATUSES },
  taxa: {},
  careProfiles: {},
  supplyItems: { category: SUPPLY_CATEGORIES, lifecycle: LIFECYCLES },
  supplyRequirements: { priority: PRIORITIES, orderHint: ORDER_HINTS },
  compatibilityRules: {},
  setupBundles: { tier: BUNDLE_TIERS },
  curatedProducts: { status: [...PRODUCT_STATUSES, SLOT], imageLicense: IMAGE_LICENSES },
  testimonials: { status: [...TESTIMONIAL_STATUSES, SLOT], situation: SITUATIONS, linkedAction: LINKED_ACTIONS },
  vetClinics: {},
  photos: { source: PHOTO_SOURCES, license: PHOTO_LICENSES },
};
const META_ENUMS: Record<string, readonly string[]> = {
  reviewStatus: REVIEW_STATUSES,
  reviewerType: REVIEWER_TYPES,
  contentKind: CONTENT_KINDS,
};

function typeOk(v: unknown, spec: FieldSpec): boolean {
  const base = spec.replace(/\?$/, '');
  if (base === 'any') return true;
  return base.split('|').some((t) => {
    switch (t) {
      case 'null': return v === null;
      case 'string': return typeof v === 'string';
      case 'boolean': return typeof v === 'boolean';
      case 'number': return isFiniteNum(v);
      case 'array': return Array.isArray(v);
      case 'object': return asRec(v) !== null;
      default: return false;
    }
  });
}

function checkFields(ctx: Ctx, key: SeedKey, id: string, r: Rec, table: Record<string, FieldSpec>, prefix: string): void {
  for (const [f, spec] of Object.entries(table)) {
    if (!has(r, f)) {
      if (!spec.endsWith('?')) ctx.out.error('S03', key, id, prefix + f, `필수 필드 누락 (${spec})`);
      continue;
    }
    if (!typeOk(r[f], spec)) ctx.out.error('S03', key, id, prefix + f, `타입 오류: ${spec.replace(/\?$/, '')} 이어야 한다`);
  }
}

// ── S08 금지 키 ──────────────────────────────────────────────
const SUPPLY_ITEM_FORBIDDEN = ['priority', 'minSpec', 'recommendedSpec', 'notNowReason', 'orderHint', 'searchKeyword'];

/**
 * S08 허용목록(L2, D14) — 상품·후기는 스키마 키 밖이면 모두 ERROR(link/href/seller/price/rating 등 거래·평점 키 차단, 불변식 3·4·7).
 * SLOT 행 포함. 상품은 부록 B 공통 필드 포함.
 */
export const S08_ALLOWED_KEYS: Readonly<Partial<Record<SeedKey, ReadonlySet<string>>>> = {
  curatedProducts: new Set([...Object.keys(FIELDS.curatedProducts), ...Object.keys(META_FIELDS)]),
  testimonials: new Set(Object.keys(FIELDS.testimonials)),
};

function forbiddenKeys(key: SeedKey, r: Rec): string[] {
  const keys = Object.keys(r);
  if (key === 'supplyItems') return keys.filter((k) => SUPPLY_ITEM_FORBIDDEN.includes(k));
  const allowed = S08_ALLOWED_KEYS[key];
  if (allowed) return keys.filter((k) => !allowed.has(k));
  return [];
}

// ── 규격 조건(S06) ───────────────────────────────────────────
/** 조건 1개를 용품 스키마에 대조. 문제 있으면 메시지, 없으면 null. */
export function condProblem(schema: Map<string, Rec> | undefined, c: Rec): string | null {
  if (!isNonEmptyStr(c.key)) return 'key 가 비었다';
  if (!(SPEC_OPS as readonly string[]).includes(c.op as string)) return `op "${String(c.op)}" 는 ${SPEC_OPS.join('/')} 중 하나`;
  if (!schema) return null; // 용품 자체가 없으면 R06/R03 이 보고.
  const field = schema.get(c.key);
  if (!field) return `key "${c.key}" 가 용품 specSchema 에 없다`;
  const op = c.op as string;
  const v = c.value;
  const list = op === 'in' || op === 'not_in';
  if (list && (!Array.isArray(v) || v.length === 0)) return `${op} 값은 비어 있지 않은 배열`;
  if (!list && Array.isArray(v)) return `${op} 값은 배열이 아니다`;
  const values: unknown[] = list ? (v as unknown[]) : [v];
  if (list && new Set(values.map((x) => JSON.stringify(x))).size !== values.length) return `${op} 값 중복`;
  switch (field.type) {
    case 'number':
      if (!values.every(isFiniteNum)) return `number 필드 "${c.key}" 에 숫자가 아닌 값 ${JSON.stringify(v)}`;
      return null;
    case 'boolean':
      if (op !== 'eq') return `boolean 필드 "${c.key}" 는 eq 만`;
      if (typeof v !== 'boolean') return `boolean 필드 "${c.key}" 에 ${JSON.stringify(v)}`;
      return null;
    case 'enum': {
      if (op === 'gte' || op === 'lte') return `enum 필드 "${c.key}" 에 ${op} 불가`;
      const options = field.options as string[];
      const bad = values.filter((x) => typeof x !== 'string' || !options.includes(x));
      if (bad.length > 0) return `enum 필드 "${c.key}" options 밖 값 ${JSON.stringify(bad)}`;
      return null;
    }
    default:
      return null;
  }
}

/** 규칙 세트(minSpec/recommendedSpec/override) 검사 → S06. */
export function checkRuleSet(ctx: Ctx, key: SeedKey, id: string, path: string, rs: unknown, itemId: unknown): void {
  const schema = isNonEmptyStr(itemId) ? ctx.schemas.get(itemId) : undefined;
  const rules = asRec(rs)?.rules;
  if (!Array.isArray(rules)) {
    ctx.out.error('S06', key, id, path, '{ rules: [] } 형태여야 한다');
    return;
  }
  rules.forEach((x, i) => {
    const p = `${path}.rules[${i}]`;
    const r = asRec(x);
    if (!r) {
      ctx.out.error('S06', key, id, p, '규칙은 객체');
      return;
    }
    const prob = condProblem(schema, r);
    if (prob) ctx.out.error('S06', key, id, p, prob);
    if (!isNonEmptyStr(r.reason)) ctx.out.error('S06', key, id, `${p}.reason`, 'reason 이 비었다');
    if (has(r, 'when')) {
      if (!Array.isArray(r.when)) {
        ctx.out.error('S06', key, id, `${p}.when`, 'when 은 조건 배열');
      } else {
        r.when.forEach((w, j) => {
          const wr = asRec(w);
          const wp = wr ? condProblem(schema, wr) : '조건은 객체';
          if (wp) ctx.out.error('S06', key, id, `${p}.when[${j}]`, wp);
        });
      }
    }
    for (const k of Object.keys(r)) {
      if (!['key', 'op', 'value', 'reason', 'when'].includes(k)) ctx.out.warn('S09', key, id, `${p}.${k}`, '알 수 없는 키');
    }
  });
}

// ── S05 specSchema ───────────────────────────────────────────
function checkSpecSchema(ctx: Ctx, id: string, r: Rec): void {
  const fields = asRec(r.specSchema)?.fields;
  const map = new Map<string, Rec>();
  ctx.schemas.set(id, map);
  if (!Array.isArray(fields)) {
    ctx.out.error('S05', 'supplyItems', id, 'specSchema', '{ fields: [] } 형태여야 한다');
    return;
  }
  fields.forEach((x, i) => {
    const p = `specSchema.fields[${i}]`;
    const f = asRec(x);
    const err = (m: string): void => ctx.out.error('S05', 'supplyItems', id, p, m);
    if (!f) return err('필드는 객체');
    if (!isNonEmptyStr(f.key) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(f.key)) return err(`key "${String(f.key)}" 는 식별자여야 한다`);
    if (map.has(f.key)) return err(`key "${f.key}" 중복`);
    if (!isNonEmptyStr(f.label)) return err('label 이 비었다');
    if (has(f, 'optional') && typeof f.optional !== 'boolean') return err('optional 은 boolean');
    if (f.type === 'number') {
      if (!isFiniteNum(f.min) || !isFiniteNum(f.max)) return err('number 필드는 min/max 숫자 필요');
      if (!(f.min < f.max)) return err(`min(${f.min}) < max(${f.max}) 이어야 한다`);
    } else if (f.type === 'enum') {
      const o = f.options;
      if (!Array.isArray(o) || o.length === 0 || !o.every(isNonEmptyStr)) return err('enum options 는 비어 있지 않은 문자열 배열');
      if (new Set(o).size !== o.length) return err('enum options 중복');
      if (has(f, 'optionLabels')) {
        const ol = asRec(f.optionLabels);
        if (!ol || Object.entries(ol).some(([k, v]) => !o.includes(k) || !isNonEmptyStr(v))) {
          return err('optionLabels 는 options 키 → 비어 있지 않은 문자열');
        }
      }
    } else if (f.type !== 'boolean') {
      return err(`type "${String(f.type)}" 는 number/boolean/enum 중 하나`);
    }
    map.set(f.key, f);
  });
}

// ── S04 부록 B ───────────────────────────────────────────────
function checkMeta(ctx: Ctx, key: SeedKey, id: string, r: Rec): void {
  for (const f of ['reviewStatus', 'reviewerType', 'verifiedBy', 'verifiedAt', 'contentKind', 'source']) {
    if (!has(r, f)) ctx.out.error('S04', key, id, f, '부록 B 공통 필드 누락');
  }
  for (const [f, vals] of Object.entries(META_ENUMS)) {
    if (has(r, f) && !vals.includes(r[f] as string)) ctx.out.error('S03', key, id, f, `"${String(r[f])}" 는 ${vals.join('/')} 중 하나`);
  }
  if (has(r, 'verifiedBy') && r.verifiedBy !== null && typeof r.verifiedBy !== 'string') ctx.out.error('S04', key, id, 'verifiedBy', 'string|null');
  if (has(r, 'verifiedAt') && r.verifiedAt !== null && typeof r.verifiedAt !== 'string') ctx.out.error('S04', key, id, 'verifiedAt', 'string|null');
  if (!has(r, 'source')) return;
  if (!Array.isArray(r.source)) {
    ctx.out.error('S04', key, id, 'source', 'source 는 {url,title,accessedAt} 배열');
    return;
  }
  r.source.forEach((s, i) => {
    const p = `source[${i}]`;
    const sr = asRec(s);
    if (!sr) return ctx.out.error('S04', key, id, p, '출처는 객체');
    if (!isHttpUrl(sr.url)) ctx.out.error('S04', key, id, `${p}.url`, `http(s) URL 이어야 한다: ${String(sr.url)}`);
    if (!isNonEmptyStr(sr.title)) ctx.out.error('S04', key, id, `${p}.title`, 'title 이 비었다');
    if (!isIsoDate(sr.accessedAt)) ctx.out.error('S04', key, id, `${p}.accessedAt`, 'YYYY-MM-DD');
    for (const k of Object.keys(sr)) if (!['url', 'title', 'accessedAt'].includes(k)) ctx.out.warn('S09', key, id, `${p}.${k}`, '알 수 없는 키');
  });
}

// ── S07 날짜 ─────────────────────────────────────────────────
function dateFields(key: SeedKey, r: Rec): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  if (CONTENT_KEYS.includes(key)) {
    out.push(['verifiedAt', r.verifiedAt]);
    if (Array.isArray(r.source)) r.source.forEach((s, i) => out.push([`source[${i}].accessedAt`, asRec(s)?.accessedAt]));
  }
  if (key === 'curatedProducts') out.push(['specVerifiedAt', r.specVerifiedAt]);
  if (key === 'testimonials') out.push(['consentAt', r.consentAt]);
  if (key === 'vetClinics') out.push(['verification.verifiedAt', asRec(r.verification)?.verifiedAt]);
  if (key === 'photos') out.push(['downloadedAt', r.downloadedAt]);
  return out;
}

function checkDates(ctx: Ctx, key: SeedKey, id: string, r: Rec): void {
  for (const [p, v] of dateFields(key, r)) {
    if (v === null || v === undefined) continue;
    if (!isIsoDate(v)) {
      if (!p.startsWith('source[')) ctx.out.error('S07', key, id, p, `날짜는 YYYY-MM-DD: ${JSON.stringify(v)}`);
      continue;
    }
    if (v > ctx.now) ctx.out.error('S07', key, id, p, `미래 날짜 ${v} (기준 ${ctx.now})`);
  }
}

// ── 진입점 ───────────────────────────────────────────────────
export function checkStructure(ctx: Ctx): void {
  // S01
  for (const key of SEED_KEYS) {
    if (!ctx.present[key]) ctx.out.error('S01', key, null, '', `${SEED_FILES[key]} 없음 또는 JSON 배열 아님`);
  }

  // S05 먼저(스키마 맵을 S06·R09 가 쓴다).
  for (const { rec, id } of ctx.rows.supplyItems) checkSpecSchema(ctx, id, rec);

  for (const key of SEED_KEYS) {
    const seen = new Set<string>();
    for (const { rec, id, index } of ctx.rows[key]) {
      // S02
      if (!isNonEmptyStr(rec.id) || !ID_RE.test(rec.id)) {
        ctx.out.error('S02', key, id, 'id', `id 는 kebab-case: ${JSON.stringify(rec.id)} (행 ${index})`);
      } else if (seen.has(rec.id)) {
        ctx.out.error('S02', key, id, 'id', `id 중복 (행 ${index})`);
      }
      if (isNonEmptyStr(rec.id)) seen.add(rec.id);

      const slot = isSlotRow(key, rec);

      // S03 타입·enum
      checkFields(ctx, key, id, rec, FIELDS[key], '');
      for (const [f, vals] of Object.entries(ENUMS[key])) {
        const v = rec[f];
        if (v === null && FIELDS[key][f]?.includes('null')) continue;
        if (has(rec, f) && !vals.includes(v as string)) ctx.out.error('S03', key, id, f, `"${String(v)}" 는 ${vals.join('/')} 중 하나`);
      }
      for (const [f, v] of Object.entries(rec)) {
        if (v === SLOT && !(f === 'status' && ['curatedProducts', 'testimonials', 'photos'].includes(key))) {
          ctx.out.error('S03', key, id, f, 'SLOT 은 상품·후기·병원·사진의 상태 필드에만');
        }
      }
      if (key === 'vetClinics') {
        const v = asRec(rec.verification);
        if (v) {
          checkFields(ctx, key, id, v, VERIFICATION_FIELDS, 'verification.');
          if (![...VET_STATUSES, SLOT].includes(v.status as string)) {
            ctx.out.error('S03', key, id, 'verification.status', `"${String(v.status)}" 는 ${[...VET_STATUSES, SLOT].join('/')} 중 하나`);
          }
          if (!slot) {
            for (const k of Object.keys(v)) if (!has(VERIFICATION_FIELDS, k)) ctx.out.warn('S09', key, id, `verification.${k}`, '알 수 없는 키');
          }
        }
      }

      // S04
      if (CONTENT_KEYS.includes(key)) checkMeta(ctx, key, id, rec);

      // S06
      if (key === 'supplyRequirements') {
        checkRuleSet(ctx, key, id, 'minSpec', rec.minSpec, rec.supplyItemId);
        checkRuleSet(ctx, key, id, 'recommendedSpec', rec.recommendedSpec, rec.supplyItemId);
      }

      // S07
      checkDates(ctx, key, id, rec);

      // S08
      const forbidden = forbiddenKeys(key, rec);
      for (const k of forbidden) {
        const why = S08_ALLOWED_KEYS[key] ? '허용목록 밖 키(불변식 3·4·7 — 링크·판매처·가격·평점 등은 스키마에 없다)' : '금지 키(불변식 3·4·6 — 소유 모델이 다르거나 Phase 0 범위 밖)';
        ctx.out.error('S08', key, id, k, why);
      }
      if (key === 'curatedProducts' && Array.isArray(rec.curationReasons) && rec.curationReasons.length > 0) {
        ctx.out.error('S08', key, id, 'curationReasons', '상품별 자유 문구 금지(PRD US-022) — 비워 둔다');
      }

      // S09
      if (!slot) {
        const known = CONTENT_KEYS.includes(key) ? { ...FIELDS[key], ...META_FIELDS } : FIELDS[key];
        for (const k of Object.keys(rec)) {
          if (!has(known, k) && !forbidden.includes(k)) ctx.out.warn('S09', key, id, k, '알 수 없는 키');
        }
      }
    }
  }
}
