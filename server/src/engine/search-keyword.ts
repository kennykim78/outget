// buildSearchKeyword — 검색 딥링크용 키워드(PRD US-012). 순수 함수.
//   override(SupplyRequirement.searchKeyword, A-5) 가 비어 있지 않으면 `{animal}` → displayName 치환.
//   아니면 [displayName, item.name] + 핵심 조건 ≤2개(권장 → 최소 순, 키당 1개):
//     number gte/eq → `${value}${unit}`(라벨 끝 괄호의 단위), number lte 생략,
//     enum eq / 단일 값 in → optionLabels[value](없으면 생략), boolean eq true → 괄호 뺀 라벨, eq false·not_in 생략.
import { splitLabel } from './rules.js';
import type { AnimalTypeRec, ResolvedRequirement, SpecField, SpecRule } from './types.js';

const MAX_CONDITIONS = 2;

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

function conditionToken(field: SpecField | undefined, rule: SpecRule): string | null {
  if (!field) return null;
  const { op, value } = rule;
  if (field.type === 'number') {
    if ((op === 'gte' || op === 'eq') && typeof value === 'number' && Number.isFinite(value)) {
      return `${value}${splitLabel(field.label).unit}`;
    }
    return null;
  }
  if (field.type === 'enum') {
    let v: unknown = null;
    if (op === 'eq') v = value;
    else if (op === 'in' && Array.isArray(value) && value.length === 1) v = value[0];
    if (typeof v !== 'string') return null;
    const label = field.optionLabels?.[v];
    return label && label.trim() ? label.trim() : null;
  }
  if (op === 'eq' && value === true) return splitLabel(field.label).base.trim() || null;
  return null;
}

export function buildSearchKeyword(animalType: Pick<AnimalTypeRec, 'displayName'>, r: ResolvedRequirement): string {
  const name = animalType.displayName;
  if (typeof r.searchKeyword === 'string' && r.searchKeyword.trim() !== '') {
    return collapse(r.searchKeyword.split('{animal}').join(name));
  }
  const tokens = [name, r.item.name];
  const usedKeys = new Set<string>();
  const rules = [...(r.recommendedSpec?.rules ?? []), ...(r.minSpec?.rules ?? [])];
  for (const rule of rules) {
    if (usedKeys.size >= MAX_CONDITIONS) break;
    if (usedKeys.has(rule.key)) continue;
    const field = r.item.specSchema.fields.find((f) => f.key === rule.key);
    const token = conditionToken(field, rule);
    if (token) {
      tokens.push(token);
      usedKeys.add(rule.key);
    }
  }
  return collapse(tokens.join(' '));
}
