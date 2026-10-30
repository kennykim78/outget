// 호환 규칙 품질 경고(작업 192 — QA184 LOW-1 · 보안189 INFO-2). 게이트가 아니라 시드 작성 단계의 정리 신호(WARN).
//   R07c 보유품 의존성 탐침: 식이 보유품 쪽 키를 참조하는데, 보유품 값을 specSchema 범위 표본으로 바꿔 평가해도 결과가 한 번도
//        바뀌지 않으면 WARN(표본 값에서 결과 변화가 없음, 보유품 값과 무관할 수 있음 — 엔진 보유품 근거 단계를 통과해 근거가 약한 OK 가 될 수 있다).
//   R07d `||` 사용: 평가기가 엄격 3값이라 `true || b.x` 같은 식은 보유품을 쓰지 않아도 근거 있음으로 셀 수 있다 → WARN.
//   판정·평가는 engine/ 만 쓴다(parseExpr·evalExpr·sanitizeSpecValues·minSpecBaseline·resolveRequirement, 불변식 6). 엔진 판정은 바꾸지 않는다.
import {
  createCatalog,
  evalExpr,
  exprRefs,
  minSpecBaseline,
  parseExpr,
  resolveRequirement,
  sanitizeSpecValues,
  type EngineCatalog,
  type ExprNode,
  type RuleSet,
  type SpecField,
  type SpecSchema,
  type SpecValue,
  type SpecValues,
} from '../engine/index.js';
import { asRec, asSeedBundle, isNonEmptyStr, type RawSeed } from './common.js';
import type { Ctx } from './context.js';

/** 표본 조합 상한 — 넘으면 한 키씩만 바꾸는 표본으로 줄인다(결정적). */
const MAX_COMBOS = 64;

function hasOr(n: ExprNode): boolean {
  switch (n.t) {
    case 'bin':
      return n.op === '||' || hasOr(n.l) || hasOr(n.r);
    case 'neg':
    case 'not':
      return hasOr(n.arg);
    case 'in':
      return hasOr(n.l) || hasOr(n.list);
    case 'list':
      return n.items.some(hasOr);
    case 'cond':
      return hasOr(n.test) || hasOr(n.then) || hasOr(n.else);
    default:
      return false;
  }
}

/** R07d — 호환 규칙 expr 에 `||` 가 있으면 WARN. 파서만 쓴다(문법 오류는 checkExprs R07 이 보고). */
export function checkCompatOr(ctx: Ctx): void {
  for (const { rec, id } of ctx.rows.compatibilityRules) {
    if (!Array.isArray(rec.rules)) continue;
    rec.rules.forEach((x, i) => {
      const r = asRec(x);
      if (!r || !isNonEmptyStr(r.expr)) return;
      let node: ExprNode;
      try {
        node = parseExpr(r.expr);
      } catch {
        return;
      }
      if (hasOr(node)) {
        ctx.out.warn('R07d', 'compatibilityRules', id, `rules[${i}].expr`, '`||` 사용 — 보유품 근거 판정이 보수적이지 않을 수 있음(규칙을 나눠 쓰기 권장)');
      }
    });
  }
}

/** 식 안의 숫자 리터럴(엔진 파서 AST 에서 읽음). */
function numLiterals(n: ExprNode, out: number[] = []): number[] {
  switch (n.t) {
    case 'num':
      out.push(n.v);
      break;
    case 'bin':
      numLiterals(n.l, out);
      numLiterals(n.r, out);
      break;
    case 'neg':
    case 'not':
      numLiterals(n.arg, out);
      break;
    case 'in':
      numLiterals(n.l, out);
      numLiterals(n.list, out);
      break;
    case 'list':
      n.items.forEach((x) => numLiterals(x, out));
      break;
    case 'cond':
      numLiterals(n.test, out);
      numLiterals(n.then, out);
      numLiterals(n.else, out);
      break;
    default:
      break;
  }
  return out;
}

const ARITH = new Set(['+', '-', '*', '/']);

/** 상수끼리의 산술 결과(키 참조 없는 이항 산술 부분식, 중첩 포함). 계산은 엔진 evalExpr 로 한다(평가기 복제 금지). */
function constArith(n: ExprNode, out: number[] = []): number[] {
  switch (n.t) {
    case 'bin': {
      const refs = exprRefs(n);
      if (ARITH.has(n.op) && refs.a.length === 0 && refs.b.length === 0) {
        // 키 참조가 없는 상수 부분식(중첩 포함) 전체 접기 — 접은 노드는 자식으로 내려가지 않는다(중간 결과가 표본에 섞이지 않게)
        const v = evalExpr(n, { a: {}, b: {} });
        if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
        break;
      }
      constArith(n.l, out);
      constArith(n.r, out);
      break;
    }
    case 'neg':
    case 'not':
      constArith(n.arg, out);
      break;
    case 'in':
      constArith(n.l, out);
      constArith(n.list, out);
      break;
    case 'list':
      n.items.forEach((x) => constArith(x, out));
      break;
    case 'cond':
      constArith(n.test, out);
      constArith(n.then, out);
      constArith(n.else, out);
      break;
    default:
      break;
  }
  return out;
}

/** 식의 리터럴 값: 숫자 리터럴 + 상수끼리의 산술 결과. */
/** (테스트용 export) */
export function literalValues(n: ExprNode): number[] {
  return [...new Set([...numLiterals(n), ...constArith(n)])];
}

/** 필드 하나의 표본값: 숫자 = 최소·1/4·중간·3/4·최대 + 식 리터럴과 ±1(범위 안만), enum = 모든 선택지, boolean = 둘 다. */
function fieldSamples(f: SpecField, lits: number[] = []): SpecValue[] {
  if (f.type === 'number') {
    const { min, max } = f;
    const vals = [min, min + (max - min) / 4, (min + max) / 2, min + ((max - min) * 3) / 4, max];
    for (const l of lits) for (const d of [-1, 0, 1]) if (l + d >= min && l + d <= max) vals.push(l + d);
    const sorted = [...new Set(lits)].sort((x, y) => x - y); // 인접 리터럴 값 사이 중간값(범위 안만)
    for (let k = 0; k + 1 < sorted.length; k++) {
      const m = (sorted[k] + sorted[k + 1]) / 2;
      if (m >= min && m <= max) vals.push(m);
    }
    return [...new Set(vals)].sort((x, y) => x - y);
  }
  if (f.type === 'enum') return [...f.options];
  return [true, false];
}

function midValue(f: SpecField): SpecValue {
  const s = fieldSamples(f); // 리터럴 없는 기본 표본의 중간
  return s[Math.floor((s.length - 1) / 2)];
}

/** 키별 표본의 조합. 상한을 넘으면 기준점(전부 중간·전부 최소·전부 최대) 각각에 한 키씩 표본 전부. */
/** (테스트용 export) */
export function combos(fields: SpecField[], lits: number[] = []): Record<string, SpecValue>[] {
  if (fields.length === 0) return [{}];
  const sets = fields.map((f) => ({ key: f.key, vals: fieldSamples(f, lits) }));
  const total = sets.reduce((n, s) => n * s.vals.length, 1);
  if (total <= MAX_COMBOS) {
    let out: Record<string, SpecValue>[] = [{}];
    for (const { key, vals } of sets) out = out.flatMap((o) => vals.map((v) => ({ ...o, [key]: v })));
    return out;
  }
  const bases = [
    Object.fromEntries(fields.map((f) => [f.key, midValue(f)])),
    Object.fromEntries(sets.map((s) => [s.key, s.vals[0]])),
    Object.fromEntries(sets.map((s) => [s.key, s.vals[s.vals.length - 1]])),
  ];
  const out = bases.flatMap((base) => sets.flatMap(({ key, vals }) => vals.map((v) => ({ ...base, [key]: v }))));
  // 혼합 모서리: 키별로 식 리터럴 값 하나씩 고른 조합(상한 MAX_COMBOS)
  const litSetsFor = (enumAll: boolean) =>
    fields.map((f) => {
      if (f.type === 'enum' && enumAll) return { key: f.key, vals: [...f.options] as SpecValue[] };
      if (f.type !== 'number') return { key: f.key, vals: [midValue(f)] };
      const inRange = [...new Set(lits)].filter((l) => l >= f.min && l <= f.max).sort((x, y) => x - y);
      return { key: f.key, vals: inRange.length > 0 ? inRange : [midValue(f)] };
    });
  // enum 은 전 선택지를 표본으로 — 조합 수가 상한을 넘으면 기존(중간값 고정) 방식으로 폴백
  let litSets = litSetsFor(true);
  if (litSets.reduce((n, x) => n * x.vals.length, 1) > MAX_COMBOS) litSets = litSetsFor(false);
  let mixed: Record<string, SpecValue>[] = [{}];
  for (const { key, vals } of litSets) {
    mixed = mixed.flatMap((o) => vals.map((v) => ({ ...o, [key]: v }))).slice(0, MAX_COMBOS);
  }
  return [...out, ...mixed];
}

const fieldsOf = (schema: SpecSchema, keys: string[]): SpecField[] =>
  keys.map((k) => schema.fields.find((f) => f.key === k)).filter((f): f is SpecField => f !== undefined);

/** 용품 쪽 입력 표본: 요구사항 minSpec 기준값(엔진 minSpecBaseline, 빠진 키는 스키마 중간값) + 범위 표본 조합. */
function inputVariants(
  cat: EngineCatalog,
  careProfileId: string | null | undefined,
  itemId: string,
  fields: SpecField[],
  lits: number[] = [],
): SpecValues[] {
  const minSpecs: RuleSet[] = [];
  const profiles = isNonEmptyStr(careProfileId)
    ? [careProfileId]
    : [...cat.requirementsByProfile.keys()].filter((p) => cat.requirementsByProfile.get(p)?.has(itemId));
  for (const p of profiles) {
    const base = cat.requirementsByProfile.get(p)?.get(itemId);
    if (base) minSpecs.push(base.minSpec);
    for (const at of cat.animalTypes.values()) {
      if (at.careProfileId !== p) continue;
      const r = resolveRequirement(cat, at.id, itemId);
      if (r) minSpecs.push(r.minSpec);
    }
  }
  const mid = Object.fromEntries(fields.map((f) => [f.key, midValue(f)]));
  const baselines = minSpecs.map((m) => ({ ...mid, ...(minSpecBaseline({ minSpec: m }) as Record<string, SpecValue>) }));
  return [...(baselines.length > 0 ? baselines : [mid]), ...combos(fields, lits)];
}

const resultKey = (v: ReturnType<typeof evalExpr>): string => JSON.stringify(v);

/**
 * R07c — 보유품 의존성 탐침. 엔진은 양방향(A-10: a 를 보유하고 b 를 판정하거나 그 반대)이므로 방향마다 본다.
 *   보유품 쪽 참조 키가 없는 방향은 건너뛴다(단측 규칙은 R07b 몫). 모든 용품 쪽 입력 표본에서 보유품 표본을 바꿔도 결과가
 *   한 가지뿐이면 WARN. 구조·참조 오류가 없을 때만 호출된다(checkRuleScoped 와 같은 게이트).
 */
export function checkCompatOwnedProbe(ctx: Ctx, raw: RawSeed): void {
  const cat = createCatalog(asSeedBundle(raw));
  for (const rule of cat.compatibilityRules) {
    const schemas = {
      a: cat.supplyItems.get(rule.a)?.specSchema ?? { fields: [] },
      b: cat.supplyItems.get(rule.b)?.specSchema ?? { fields: [] },
    };
    (Array.isArray(rule.rules) ? rule.rules : []).forEach((entry, i) => {
      let node: ExprNode;
      try {
        node = parseExpr(entry.expr);
      } catch {
        return;
      }
      const refs = exprRefs(node);
      const lits = literalValues(node);
      for (const ownedSide of ['b', 'a'] as const) {
        const inputSide = ownedSide === 'a' ? 'b' : 'a';
        const ownedFields = fieldsOf(schemas[ownedSide], refs[ownedSide]);
        if (ownedFields.length === 0) continue;
        const inputItem = rule[inputSide];
        const inputs = inputVariants(cat, rule.careProfileId, inputItem, fieldsOf(schemas[inputSide], refs[inputSide]), lits);
        const owneds = combos(ownedFields, lits);
        const dependsOnOwned = inputs.some((inRaw) => {
          const inSan = sanitizeSpecValues(schemas[inputSide], inRaw);
          const seen = new Set<string>();
          for (const ownRaw of owneds) {
            const ownSan = sanitizeSpecValues(schemas[ownedSide], ownRaw);
            const env = inputSide === 'a' ? { a: inSan, b: ownSan } : { a: ownSan, b: inSan };
            seen.add(resultKey(evalExpr(node, env)));
            if (seen.size > 1) return true;
          }
          return false;
        });
        if (!dependsOnOwned) {
          ctx.out.warn(
            'R07c',
            'compatibilityRules',
            rule.id,
            `rules[${i}].expr`,
            `표본 값에서 결과 변화가 없음(보유품 값과 무관할 수 있음) — 보유품 ${ownedSide}(${String(rule[ownedSide])}) 의 ${ownedFields.map((f) => f.key).join('·')} 를 범위 안 표본으로 바꿔도 결과가 같다(근거 없는 OK 가 될 수 있음)`,
          );
        }
      }
    });
  }
}
