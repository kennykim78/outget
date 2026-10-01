// resolveRequirement — 최종 요구사항 계산의 유일한 지점(불변식 6, PRD US-005).
//   순서 고정: SupplyItem 기본 → SupplyRequirement(CareProfile) → AnimalType.careOverrides. 뒤가 앞을 덮는다.
//   스칼라는 교체(명시적 null 포함), minSpec/recommendedSpec 규칙은 (key, op) 같으면 교체·아니면 뒤에 추가(A-11).
//   override 는 기존 요구사항만 수정한다(항목 추가 불가).
import { ORDER_HINTS, PRIORITIES } from './domain.js';
import type {
  AnimalTypeRec,
  ContentMeta,
  EngineCatalog,
  RequirementOverride,
  ResolvedRequirement,
  RuleCond,
  RuleSet,
  SpecRule,
  SupplyRequirementRec,
} from './types.js';

const SCALAR_KEYS = ['priority', 'orderHint', 'notNowReason', 'why', 'caution', 'avoid', 'searchKeyword'] as const;
const RULE_KEYS = ['minSpec', 'recommendedSpec'] as const;

const hasOwn = (o: unknown, k: string): boolean =>
  o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

function cloneCond(c: RuleCond): RuleCond {
  return { key: c.key, op: c.op, value: Array.isArray(c.value) ? [...c.value] : c.value };
}

function cloneRule(r: SpecRule): SpecRule {
  const out: SpecRule = { ...cloneCond(r), reason: r.reason };
  if (r.when !== undefined) out.when = Array.isArray(r.when) ? r.when.map(cloneCond) : r.when;
  return out;
}

function cloneRuleSet(s: RuleSet | undefined): RuleSet {
  return { rules: s && Array.isArray(s.rules) ? s.rules.map(cloneRule) : [] };
}

function mergeRuleSet(base: RuleSet, over: RuleSet): RuleSet {
  const rules = cloneRuleSet(base).rules;
  for (const r of cloneRuleSet(over).rules) {
    const i = rules.findIndex((x) => x.key === r.key && x.op === r.op);
    if (i >= 0) rules[i] = r;
    else rules.push(r);
  }
  return { rules };
}

function meta(m: ContentMeta): ContentMeta {
  return {
    reviewStatus: m.reviewStatus,
    reviewerType: m.reviewerType,
    verifiedBy: m.verifiedBy,
    verifiedAt: m.verifiedAt,
    contentKind: m.contentKind,
    source: Array.isArray(m.source) ? m.source.map((s) => ({ ...s })) : [],
  };
}

function overrideFor(at: AnimalTypeRec, supplyItemId: string): RequirementOverride | undefined {
  const co = at.careOverrides;
  if (!hasOwn(co, 'requirements')) return undefined;
  const reqs = co.requirements;
  if (!hasOwn(reqs, supplyItemId)) return undefined;
  const o = (reqs as Record<string, RequirementOverride>)[supplyItemId];
  return o !== null && typeof o === 'object' ? o : undefined;
}

/** AnimalType × SupplyItem 의 최종 요구사항. 프로필·항목·기본 요구사항이 없으면 null. */
export function resolveRequirement(
  cat: EngineCatalog,
  animalTypeId: string,
  supplyItemId: string,
): ResolvedRequirement | null {
  const at = cat.animalTypes.get(animalTypeId);
  if (!at || !at.careProfileId) return null;
  const profile = cat.careProfiles.get(at.careProfileId);
  const item = cat.supplyItems.get(supplyItemId);
  const base: SupplyRequirementRec | undefined = cat.requirementsByProfile.get(at.careProfileId)?.get(supplyItemId);
  if (!profile || !item || !base) return null;

  const ov = overrideFor(at, supplyItemId);
  const provenance: ResolvedRequirement['provenance'] = {};
  const scalars = {} as Pick<ResolvedRequirement, (typeof SCALAR_KEYS)[number]>;
  for (const k of SCALAR_KEYS) {
    if (ov && hasOwn(ov, k) && ov[k] !== undefined) {
      (scalars as Record<string, unknown>)[k] = ov[k];
      provenance[k] = 'OVERRIDE';
    } else {
      (scalars as Record<string, unknown>)[k] = base[k];
      provenance[k] = 'REQUIREMENT';
    }
  }
  const ruleSets = {} as Pick<ResolvedRequirement, (typeof RULE_KEYS)[number]>;
  for (const k of RULE_KEYS) {
    const o = ov && hasOwn(ov, k) ? ov[k] : undefined;
    if (o !== undefined) {
      ruleSets[k] = mergeRuleSet(base[k], o);
      provenance[k] = 'OVERRIDE';
    } else {
      ruleSets[k] = cloneRuleSet(base[k]);
      provenance[k] = 'REQUIREMENT';
    }
  }

  return {
    animalTypeId: at.id,
    careProfileId: profile.id,
    supplyItemId: item.id,
    item: {
      id: item.id,
      name: item.name,
      category: item.category,
      glyph: item.glyph,
      description: item.description,
      lifecycle: item.lifecycle,
      specSchema: item.specSchema,
      compatibleAlternativeIds: [...(item.compatibleAlternativeIds ?? [])],
      replaceCycleDays: item.replaceCycleDays ?? null,
      inspectCycleDays: item.inspectCycleDays ?? null,
    },
    ...scalars,
    ...ruleSets,
    contentKind: base.contentKind,
    review: {
      requirement: meta(base),
      item: meta(item),
      careProfile: meta(profile),
      animalType: meta(at),
    },
    provenance,
  };
}

function rank(list: readonly string[], v: string): number {
  const i = list.indexOf(v);
  return i < 0 ? list.length : i;
}

/** AnimalType 의 전체 요구사항. 정렬: orderHint → priority → 시드 순서(모두 override 반영 후 값). */
export function listResolvedRequirements(cat: EngineCatalog, animalTypeId: string): ResolvedRequirement[] {
  const at = cat.animalTypes.get(animalTypeId);
  if (!at || !at.careProfileId) return [];
  const reqs = cat.requirementsByProfile.get(at.careProfileId);
  if (!reqs) return [];
  const rows: Array<{ r: ResolvedRequirement; order: number }> = [];
  for (const [itemId, base] of reqs) {
    const r = resolveRequirement(cat, animalTypeId, itemId);
    if (r) rows.push({ r, order: cat.requirementOrder.get(base.id) ?? Number.MAX_SAFE_INTEGER });
  }
  rows.sort(
    (x, y) =>
      rank(ORDER_HINTS, x.r.orderHint) - rank(ORDER_HINTS, y.r.orderHint) ||
      rank(PRIORITIES, x.r.priority) - rank(PRIORITIES, y.r.priority) ||
      x.order - y.order,
  );
  return rows.map((x) => x.r);
}
