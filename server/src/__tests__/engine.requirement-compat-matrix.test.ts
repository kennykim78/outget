// requirementCompat 전후 비교 오라클 (작업 176 = 155 계획 6절 1단계).
//   LEGACY_*: ③(권장 하한값 반영) 이전 spec-check.ts 의 minSpecBaseline + evaluateCompat('SKIP') 동작을 이 파일 안에 사본으로 고정.
//             엔진이 바뀌어도 이 사본은 바꾸지 않는다(공개 함수 resolveRequirement·evalExpr·parseExpr·sanitizeSpecValues·worstVerdict 만 사용).
//   격자: 프로필이 있는 모든 AnimalType × 그 동물의 요구사항 × 케이지 컨텍스트 → 현재 엔진 requirementCompat vs 레거시.
//   단언: 서로 다른 셀 집합 === EXPECTED_DIFF (정렬 비교).
//
//   안내(다음 단계 backend): requirementBaseline 도입으로 저빌 wheel 이 바뀌면 EXPECTED_DIFF 에 아래 형식의 셀 키를 채운다.
//     'gerbil-mongolian|wheel|h20' ... (키 = `<animalTypeId>|<supplyItemId>|<ctx>`, ctx = none | empty | h<높이>)
//     저빌 wheel 계획상 변화: 높이 미입력·케이지 없음은 NONE 유지, h<50 NONE→CHECK, h>=50 NONE→OK.
//     그 외 셀이 달라지면 이 테스트가 fail 한다 — 의도한 변경일 때만 목록에 추가.
import { describe, expect, it } from 'vitest';
import { ExprSyntaxError, createCatalog, evalExpr, parseExpr, requirementCompat, resolveRequirement, sanitizeSpecValues, worstVerdict } from '../engine/index.js';
import type { EngineCatalog, ResolvedRequirement, SpecCheckResult, SpecValues, UserContext } from '../engine/index.js';
import { realSeed } from './fixtures/prerender-seed.js';

/**
 * 작업 178(155 안 A, Kenny 확정): 저빌 wheel × 케이지 높이 셀만 바뀐다 — 최소 규격에 지름이 없어 권장 30cm 를 가상 입력으로 채움.
 *   h<50 NONE→CHECK, 50≤h≤100 NONE→OK. none·empty·h200(cage specSchema heightCm max 100 초과 → 미입력과 같음)은 NONE 유지.
 */
const GERBIL_WHEEL_CHECK = [20, 30, 40, 41, 42, 44, 45, 49];
const GERBIL_WHEEL_OK = [50, 51, 52, 54, 55, 60, 80];
const EXPECTED_DIFF: string[] = [...GERBIL_WHEEL_CHECK, ...GERBIL_WHEEL_OK].map((h) => `gerbil-mongolian|wheel|h${h}`);

type Compat = SpecCheckResult['compat'];

// ---- 레거시 오라클 (③ 전 spec-check.ts:133-158 + evaluateCompat SKIP 경로 사본) ----
function legacyBaseline(r: Pick<ResolvedRequirement, 'minSpec'>): SpecValues {
  const out: Record<string, number | boolean | string> = {};
  for (const rule of Array.isArray(r.minSpec?.rules) ? r.minSpec.rules : []) {
    if (!rule || (Array.isArray(rule.when) && rule.when.length > 0) || Array.isArray(rule.value)) continue;
    if (rule.op === 'gte' && typeof rule.value === 'number' && Number.isFinite(rule.value)) {
      const prev = out[rule.key];
      out[rule.key] = typeof prev === 'number' ? Math.max(prev, rule.value) : rule.value;
    } else if (rule.op === 'eq' && !(rule.key in out)) {
      out[rule.key] = rule.value;
    }
  }
  return out;
}

function ownedOf(ctx: UserContext | undefined, id: string): SpecValues | undefined {
  const items = ctx?.ownedItems;
  if (!items || typeof items !== 'object' || !Object.prototype.hasOwnProperty.call(items, id)) return undefined;
  const v = items[id];
  return v !== null && typeof v === 'object' ? v : undefined;
}

function legacyRequirementCompat(cat: EngineCatalog, animalTypeId: string, itemId: string, ctx?: UserContext): Compat {
  const r = resolveRequirement(cat, animalTypeId, itemId);
  if (!r) throw new Error(`no requirement ${animalTypeId} × ${itemId}`);
  const input = legacyBaseline(r);
  const reasons: Compat['reasons'] = [];
  const checkedRuleIds: string[] = [];
  if (!ctx) return { verdict: 'NONE', reasons, checkedRuleIds };
  for (const rule of cat.compatibilityRules) {
    if (rule.careProfileId && rule.careProfileId !== r.careProfileId) continue;
    let aRaw: SpecValues | undefined;
    let bRaw: SpecValues | undefined;
    if (rule.a === itemId && rule.b !== itemId && ownedOf(ctx, rule.b)) {
      aRaw = input;
      bRaw = ownedOf(ctx, rule.b);
    } else if (rule.b === itemId && rule.a !== itemId && ownedOf(ctx, rule.a)) {
      aRaw = ownedOf(ctx, rule.a);
      bRaw = input;
    } else continue;
    const env = {
      a: sanitizeSpecValues(cat.supplyItems.get(rule.a)?.specSchema ?? { fields: [] }, aRaw ?? {}),
      b: sanitizeSpecValues(cat.supplyItems.get(rule.b)?.specSchema ?? { fields: [] }, bRaw ?? {}),
    };
    let decided = 0;
    const ruleReasons: Compat['reasons'] = [];
    (Array.isArray(rule.rules) ? rule.rules : []).forEach((entry, i) => {
      let result: ReturnType<typeof evalExpr>;
      try {
        result = evalExpr(parseExpr(entry.expr), env);
      } catch (e) {
        // 원본 엔진과 같이 구문 오류만 UNKNOWN, 나머지 예외는 다시 던진다(작업 178).
        if (!(e instanceof ExprSyntaxError)) throw e;
        result = 'UNKNOWN';
      }
      if (result === 'UNKNOWN') return; // SKIP
      decided++;
      if (result === true) return;
      const verdict = result === false && entry.onFail === 'BELOW_MIN' ? 'BELOW_MIN' : 'CHECK';
      ruleReasons.push({ stage: 'COMPAT', kind: 'RULE', verdict, ruleId: `${rule.id}#${i}`, message: entry.message });
    });
    if (decided === 0) continue;
    checkedRuleIds.push(rule.id);
    reasons.push(...ruleReasons);
  }
  if (checkedRuleIds.length === 0) return { verdict: 'NONE', reasons, checkedRuleIds };
  return { verdict: worstVerdict(reasons.map((x) => x.verdict)) as Compat['verdict'], reasons, checkedRuleIds };
}

// ---- 격자 ----
const seed = realSeed();
const cat = createCatalog(seed);
const HEIGHTS = [20, 30, 40, 41, 42, 44, 45, 49, 50, 51, 52, 54, 55, 60, 80, 200];

// 케이지 치수 키: 호환 규칙에서 b(=cage) 쪽이 실제로 참조하는 키만 높이 값으로 채운다(현재 시드: heightCm 하나).
const CAGE_KEYS = [
  ...new Set(
    seed.compatibilityRules
      .filter((cr) => cr.b === 'cage')
      .flatMap((cr) => cr.rules.flatMap((e) => [...(e.expr.match(/\bb\.([A-Za-z0-9_]+)/g) ?? [])].map((m) => m.slice(2)))),
  ),
].sort();
const cageSchemaKeys = new Set((seed.supplyItems.find((s) => s.id === 'cage')?.specSchema.fields ?? []).map((f) => f.key));

const contexts: Array<{ tag: string; ctx: UserContext | undefined }> = [
  { tag: 'none', ctx: undefined },
  { tag: 'empty', ctx: { ownedItems: { cage: {} } } },
  ...HEIGHTS.map((h) => ({
    tag: `h${h}`,
    ctx: { ownedItems: { cage: Object.fromEntries(CAGE_KEYS.map((k) => [k, h])) } } as UserContext,
  })),
];

const animals = seed.animalTypes.filter((a) => a.careProfileId !== null).map((a) => a.id);
const cells: Array<{ key: string; animal: string; item: string; ctx: UserContext | undefined }> = [];
for (const animal of animals) {
  const reqs = seed.supplyRequirements.filter((r) => r.careProfileId === seed.animalTypes.find((a) => a.id === animal)?.careProfileId);
  for (const req of [...new Set(reqs.map((r) => r.supplyItemId))].sort()) {
    for (const c of contexts) cells.push({ key: `${animal}|${req}|${c.tag}`, animal, item: req, ctx: c.ctx });
  }
}

const same = (x: Compat, y: Compat) => JSON.stringify(x) === JSON.stringify(y);

describe('requirementCompat 격자 — 현재 엔진 vs 레거시 오라클', () => {
  it('격자 전제: 케이지 치수 키는 호환 규칙이 참조하는 키이며 cage specSchema 에 존재', () => {
    expect(CAGE_KEYS).toEqual(['heightCm']);
    for (const k of CAGE_KEYS) expect(cageSchemaKeys.has(k)).toBe(true);
    expect(animals.length).toBeGreaterThanOrEqual(4);
    expect(cells.length).toBeGreaterThan(0);
  });

  it('다른 셀 집합 === EXPECTED_DIFF', () => {
    const diff = cells
      .filter((c) => !same(requirementCompat(cat, c.animal, c.item, c.ctx), legacyRequirementCompat(cat, c.animal, c.item, c.ctx)))
      .map((c) => c.key)
      .sort();
    expect(diff).toEqual([...EXPECTED_DIFF].sort());
  });

  it('바뀐 셀의 새 값: 레거시 NONE → h<50 CHECK(BELOW_MIN 아님)·h≥50 OK, 둘 다 usedRecommended', () => {
    const ctxH = (h: number) => contexts.find((c) => c.tag === `h${h}`)!.ctx;
    for (const h of [...GERBIL_WHEEL_CHECK, ...GERBIL_WHEEL_OK]) {
      expect([h, legacyRequirementCompat(cat, 'gerbil-mongolian', 'wheel', ctxH(h)).verdict]).toEqual([h, 'NONE']);
      const now = requirementCompat(cat, 'gerbil-mongolian', 'wheel', ctxH(h));
      expect([h, now.verdict, now.usedRecommended]).toEqual([h, h < 50 ? 'CHECK' : 'OK', true]);
    }
  });

  it('오라클 점검: 규칙이 실제로 판정되는 셀이 존재(격자가 빈 NONE 만이 아님)', () => {
    const verdicts = new Set(cells.map((c) => legacyRequirementCompat(cat, c.animal, c.item, c.ctx).verdict));
    expect(verdicts.has('CHECK')).toBe(true);
    expect(verdicts.has('OK')).toBe(true);
  });
});
