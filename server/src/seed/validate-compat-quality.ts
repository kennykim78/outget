// 호환 규칙 품질 경고(작업 192 — QA184 LOW-1 · 보안189 INFO-2). 게이트가 아니라 시드 작성 단계의 정리 신호(WARN).
//   R07c 보유품 의존성 탐침: 식이 보유품 쪽 키를 참조하는데, 보유품 값을 specSchema 범위 표본으로 바꿔 평가해도 결과가 한 번도
//        바뀌지 않으면 WARN(표본 값에서 결과 변화가 없음, 보유품 값과 무관할 수 있음 — 엔진 보유품 근거 단계를 통과해 근거가 약한 OK 가 될 수 있다).
//   R07d `||` 사용: 평가기가 엄격 3값이라 `true || b.x` 같은 식은 보유품을 쓰지 않아도 근거 있음으로 셀 수 있다 → WARN.
//   R07e 최소 규격 키·권장 전용 키 혼합 `&&`·`||`(작업 219): requirementCompat 이 CHECK 상한·권장 표식 오류를 낼 수 있다 → WARN.
//   판정·평가는 engine/ 만 쓴다(parseExpr·evalExpr·sanitizeSpecValues·minSpecBaseline·resolveRequirement, 불변식 6). 엔진 판정은 바꾸지 않는다.
import {
  createCatalog,
  evalExpr,
  exprRefs,
  minSpecBaseline,
  parseExpr,
  requirementBaseline,
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

/** 식 안의 문자열 리터럴(enum 선택지와 직접 비교되는 값 후보). */
export function strLiterals(n: ExprNode, out: string[] = []): string[] {
  switch (n.t) {
    case 'str':
      out.push(n.v);
      break;
    case 'bin':
      strLiterals(n.l, out);
      strLiterals(n.r, out);
      break;
    case 'neg':
    case 'not':
      strLiterals(n.arg, out);
      break;
    case 'in':
      strLiterals(n.l, out);
      strLiterals(n.list, out);
      break;
    case 'list':
      n.items.forEach((x) => strLiterals(x, out));
      break;
    case 'cond':
      strLiterals(n.test, out);
      strLiterals(n.then, out);
      strLiterals(n.else, out);
      break;
    default:
      break;
  }
  return out;
}

const CMP = new Set(['==', '!=', '<', '>', '<=', '>=']);

/** 키별로 식에서 직접 비교된 숫자 값(상수 접기 포함, 엔진 evalExpr). 축소 폴백에서 이 값을 우선 보존한다. */
export function directLiterals(n: ExprNode, out: Record<string, number[]> = {}): Record<string, number[]> {
  const constNum = (x: ExprNode): number | undefined => {
    const r = exprRefs(x);
    if (r.a.length > 0 || r.b.length > 0) return undefined;
    const v = evalExpr(x, { a: {}, b: {} });
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const add = (keyed: ExprNode, vals: (number | undefined)[]) => {
    const r = exprRefs(keyed);
    for (const k of [...r.a, ...r.b]) for (const v of vals) if (v !== undefined) (out[k] ??= []).push(v);
  };
  switch (n.t) {
    case 'bin':
      if (CMP.has(n.op)) {
        add(n.l, [constNum(n.r)]);
        add(n.r, [constNum(n.l)]);
      }
      directLiterals(n.l, out);
      directLiterals(n.r, out);
      break;
    case 'neg':
    case 'not':
      directLiterals(n.arg, out);
      break;
    case 'in':
      if (n.list.t === 'list') add(n.l, n.list.items.map(constNum));
      directLiterals(n.l, out);
      directLiterals(n.list, out);
      break;
    case 'list':
      n.items.forEach((x) => directLiterals(x, out));
      break;
    case 'cond':
      directLiterals(n.test, out);
      directLiterals(n.then, out);
      directLiterals(n.else, out);
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
    case 'neg': {
      const refs = exprRefs(n);
      if (refs.a.length === 0 && refs.b.length === 0) {
        // 키 참조 없는 단항 음수(`-(10 - 45)` 등)도 엔진 evalExpr 로 접어 최종값만 표본에(접기 성공 시 재귀 중단)
        const v = evalExpr(n, { a: {}, b: {} });
        if (typeof v === 'number' && Number.isFinite(v)) {
          out.push(v);
          break;
        }
      }
      constArith(n.arg, out);
      break;
    }
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
export function combos(fields: SpecField[], lits: number[] = [], strLits: string[] = [], direct: Record<string, number[]> = {}): Record<string, SpecValue>[] {
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
  const litSetsFor = (enumMode: 'all' | 'lits' | 'mid') =>
    fields.map((f) => {
      if (f.type === 'enum') {
        if (enumMode === 'all') return { key: f.key, vals: [...f.options] as SpecValue[] };
        const hit = enumMode === 'lits' ? f.options.filter((o) => strLits.includes(o)) : [];
        if (hit.length === 0) return { key: f.key, vals: [midValue(f)] };
        // 비교된 선택지 + 비교되지 않은 선택지 하나(`!=`·`not in`·`||` 에서 비교된 값이 식을 고정시키지 않게)
        const rest = f.options.filter((o) => !strLits.includes(o));
        const other = rest.length > 0 ? [rest[Math.floor((rest.length - 1) / 2)]] : [];
        return { key: f.key, vals: [...hit, ...other] as SpecValue[] };
      }
      if (f.type !== 'number') return { key: f.key, vals: [midValue(f)] };
      const inRange = [...new Set(lits)].filter((l) => l >= f.min && l <= f.max).sort((x, y) => x - y);
      return { key: f.key, vals: inRange.length > 0 ? inRange : [midValue(f)] };
    });
  const prod = (xs: { vals: SpecValue[] }[]) => xs.reduce((n, x) => n * x.vals.length, 1);
  // enum 은 전 선택지 → 넘으면 식에서 직접 비교된 선택지만 보존 → 그래도 넘으면 숫자 키 표본을 줄임(가장 긴 목록의 가운데부터 제거) → 최후 중간값 고정
  let litSets = litSetsFor('all');
  if (prod(litSets) > MAX_COMBOS) {
    litSets = litSetsFor('lits');
    const numeric = new Set(fields.filter((f) => f.type === 'number').map((f) => f.key));
    // 직접 비교된 리터럴은 마지막까지 보존 — 먼저 파생 표본(그 키와 직접 비교되지 않은 값)을 가운데부터 버린다
    const isDirect = (key: string, v: SpecValue) => typeof v === 'number' && (direct[key] ?? []).includes(v);
    const dropMiddle = (xs: SpecValue[]) => xs.filter((_, idx) => idx !== Math.floor(xs.length / 2));
    while (prod(litSets) > MAX_COMBOS) {
      const bigs = litSets.filter((x) => numeric.has(x.key) && x.vals.length > 1).sort((x, y) => y.vals.length - x.vals.length);
      const withDerived = bigs.find((x) => x.vals.some((v) => !isDirect(x.key, v)));
      if (withDerived) {
        const idxs = withDerived.vals.map((v, i) => (isDirect(withDerived.key, v) ? -1 : i)).filter((i) => i >= 0);
        const drop = idxs[Math.floor(idxs.length / 2)];
        withDerived.vals = withDerived.vals.filter((_, i) => i !== drop);
        continue;
      }
      const big = bigs.find((x) => x.vals.length > 2);
      if (!big) break;
      big.vals = dropMiddle(big.vals);
    }
    if (prod(litSets) > MAX_COMBOS) litSets = litSetsFor('mid');
  }
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
  strLits: string[] = [],
  direct: Record<string, number[]> = {},
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
  return [...(baselines.length > 0 ? baselines : [mid]), ...combos(fields, lits, strLits, direct)];
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
      const strs = strLiterals(node);
      const direct = directLiterals(node);
      for (const ownedSide of ['b', 'a'] as const) {
        const inputSide = ownedSide === 'a' ? 'b' : 'a';
        const ownedFields = fieldsOf(schemas[ownedSide], refs[ownedSide]);
        if (ownedFields.length === 0) continue;
        const inputItem = rule[inputSide];
        const inputs = inputVariants(cat, rule.careProfileId, inputItem, fieldsOf(schemas[inputSide], refs[inputSide]), lits, strs, direct);
        const owneds = combos(ownedFields, lits, strs, direct);
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

/** 식 안의 모든 `&&`·`||` 노드(삼항·부정·in 안 포함). */
function logicNodes(n: ExprNode, out: Extract<ExprNode, { t: 'bin' }>[] = []): Extract<ExprNode, { t: 'bin' }>[] {
  switch (n.t) {
    case 'bin':
      if (n.op === '&&' || n.op === '||') out.push(n);
      logicNodes(n.l, out);
      logicNodes(n.r, out);
      break;
    case 'neg':
    case 'not':
      logicNodes(n.arg, out);
      break;
    case 'in':
      logicNodes(n.l, out);
      logicNodes(n.list, out);
      break;
    case 'list':
      n.items.forEach((x) => logicNodes(x, out));
      break;
    case 'cond':
      logicNodes(n.test, out);
      logicNodes(n.then, out);
      logicNodes(n.else, out);
      break;
    default:
      break;
  }
  return out;
}

/**
 * R07e — 최소 규격 키·권장 전용 키 혼합 `&&`·`||`(작업 219, 218 계획서 선택지 D). 게이트 아님(WARN), 엔진 판정 불변.
 *   requirementCompat(SKIP 모드)은 ① 최소 기준값(minSpecBaseline)만으로 평가하고 UNKNOWN 일 때만 ② 권장 채움 입력
 *   (requirementBaseline)으로 다시 평가한다. 평가기가 엄격 3값이라 `최소키 비교 && 권장키 비교` 는 최소 쪽이 false 여도 ①에서
 *   UNKNOWN → ②에서 확정 → 실패는 CHECK 상한 + usedRecommended(218 §1.1), `최소키 비교 || 권장키 비교` 는 최소 쪽이 true 여도
 *   OK + usedRecommended(218 §1.2). 대상: 용품 쪽에서 본 `&&`·`||` 의 한 피연산자는 최소 기준 키만, 다른 피연산자는 권장 전용 키
 *   (requirementBaseline.recommendedKeys)를 참조. 키 판별은 엔진 resolveRequirement·minSpecBaseline·requirementBaseline·exprRefs 만
 *   쓴다(평가기 복제 없음, 불변식 6). 방향(A-10)·동물(careOverrides 반영)마다 보고 규칙 항목당 1건으로 합친다.
 *   한계: 용품 쪽 키를 전혀 참조하지 않는 피연산자(보유품 키만)와 권장 키의 혼합은 대상이 아니다(계획서 정의 그대로).
 */
export function checkCompatMinRecMix(ctx: Ctx, raw: RawSeed): void {
  const cat = createCatalog(asSeedBundle(raw));
  for (const rule of cat.compatibilityRules) {
    (Array.isArray(rule.rules) ? rule.rules : []).forEach((entry, i) => {
      let node: ExprNode;
      try {
        node = parseExpr(entry.expr);
      } catch {
        return;
      }
      const logic = logicNodes(node);
      if (logic.length === 0) return;
      const hits = new Set<string>();
      for (const inputSide of ['a', 'b'] as const) {
        const inputItem = rule[inputSide];
        for (const at of cat.animalTypes.values()) {
          if (rule.careProfileId && at.careProfileId !== rule.careProfileId) continue;
          const r = resolveRequirement(cat, at.id, inputItem);
          if (!r) continue;
          const minKeys = new Set(Object.keys(minSpecBaseline(r)));
          const recKeys = new Set(requirementBaseline(r).recommendedKeys);
          if (minKeys.size === 0 || recKeys.size === 0) continue;
          for (const op of logic) {
            const lk = exprRefs(op.l)[inputSide];
            const rk = exprRefs(op.r)[inputSide];
            const minOnly = (ks: string[]) => ks.length > 0 && ks.every((k) => minKeys.has(k));
            const recIn = (ks: string[]) => ks.filter((k) => recKeys.has(k));
            const pairs: [string[], string[]][] = [];
            if (minOnly(lk) && recIn(rk).length > 0) pairs.push([lk, recIn(rk)]);
            if (minOnly(rk) && recIn(lk).length > 0) pairs.push([rk, recIn(lk)]);
            for (const [mk, rk2] of pairs) {
              hits.add(`\`${op.op}\` ${inputSide}(${String(inputItem)}) 최소 ${mk.join('·')} / 권장 ${rk2.join('·')}`);
            }
          }
        }
      }
      if (hits.size === 0) return;
      const hitList = [...hits];
      const hasAnd = hitList.some((h) => h.startsWith('`&&`'));
      const hasOr2 = hitList.some((h) => h.startsWith('`||`'));
      const effects: string[] = [];
      if (hasAnd) {
        effects.push(
          entry.onFail === 'BELOW_MIN'
            ? '최소 기준값만으로 확정되는 BELOW_MIN 이 CHECK 로 낮아지고 권장 채움 표식(usedRecommended)이 붙을 수 있음'
            : '최소 기준값만으로 확정되는 결과에도 권장 채움 표식(usedRecommended)이 붙을 수 있음',
        );
      }
      if (hasOr2) effects.push('최소 쪽이 참일 때도 권장 채움 표식(usedRecommended)이 붙을 수 있음');
      const effect = hasAnd && hasOr2 ? `\`&&\`: ${effects[0]} / \`||\`: ${effects[1]}` : effects.join('');
      ctx.out.warn(
        'R07e',
        'compatibilityRules',
        rule.id,
        `rules[${i}].expr`,
        `최소 규격 키와 권장 전용 키를 \`&&\`·\`||\` 로 섞음(${[...hits].sort().join('; ')}) — 엔진 한계(엄격 3값 평가)로 ${effect}(규칙을 나눠 쓰기 권장)`,
      );
    });
  }
}
