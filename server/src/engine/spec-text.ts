// 규격 문장(C-R5-8, D17) — 프리렌더·클라이언트 공용 단일 소스. 순수 함수(시드 specSchema 라벨 + 규칙 값만).
//   enum 값은 optionLabel() 단일 헬퍼로만 표시(스펙22 §4-3) — 라벨 없는 값은 원시 코드로 내보내지 않는다.
//   R4까지 prerender/pages/common.ts 에 있던 ruleText·specLine 을 그대로 옮겼다(산출물 바이트 동일).
import { optionLabel, splitLabel } from './rules.js';
import type { RuleCond, RuleSet, SpecField, SpecRule, SpecSchema, SpecValue } from './types.js';

/** 규격 문장 고정 어휘(UI 카피 아님 — 문장 조립 조각). prerender COPY.spec 과 동일해야 한다(테스트로 잠금). */
export const SPEC_WORDS = Object.freeze({ gte: '이상', lte: '이하', notIn: '제외', none: '없음', when: '일 때' });

/** 칩 숫자 연결자("60×40cm 이상"). "↑" 표기는 쓰지 않는다(스펙33 §0). */
const CHIP_JOIN = '×';
const CHIP_MAX_VALUES = 3;

function fieldOf(schema: SpecSchema, key: string): SpecField | undefined {
  return Array.isArray(schema?.fields) ? schema.fields.find((f) => f.key === key) : undefined;
}

/** 값 표시. enum 라벨이 없으면 null(호출부가 행·항목을 생략). */
function valueLabel(f: SpecField | undefined, v: SpecValue): string | null {
  if (f?.type === 'number' && typeof v === 'number') return `${v}${splitLabel(f.label).unit}`;
  if (f?.type === 'enum') return optionLabel(f, v);
  if (typeof v === 'boolean') return v ? '' : SPEC_WORDS.none;
  if (typeof v === 'string' && f === undefined) return null; // 스키마 밖 키의 문자열 값 = 원시 코드일 수 있음
  return String(v);
}

function condText(schema: SpecSchema, c: RuleCond): string | null {
  const f = fieldOf(schema, c.key);
  const name = f ? splitLabel(f.label).base : c.key;
  const raw = Array.isArray(c.value) ? c.value : [c.value];
  const vals = raw.map((v) => valueLabel(f, v));
  if (vals.some((v) => v === null)) return null;
  const vs = vals as string[];
  switch (c.op) {
    case 'gte':
      return `${name} ${vs[0]} ${SPEC_WORDS.gte}`;
    case 'lte':
      return `${name} ${vs[0]} ${SPEC_WORDS.lte}`;
    case 'eq':
      if (typeof raw[0] === 'boolean') return raw[0] ? name : `${name} ${SPEC_WORDS.none}`;
      return `${name} ${vs[0]}`;
    case 'in':
      return `${name} ${vs.join(' · ')}`;
    case 'not_in':
      return `${name} ${vs.join(' · ')} ${SPEC_WORDS.notIn}`;
    default:
      return name;
  }
}

/**
 * 규칙 → "바닥 가로 60cm 이상"(조건부면 "형태 철장일 때 — …").
 *   라벨 없는 enum 값이 규칙·when 어디에든 있으면 null — L4 조건 행을 숨긴다(스펙22 §4-3).
 */
export function ruleText(schema: SpecSchema, r: SpecRule): string | null {
  const main = condText(schema, r);
  if (main === null) return null;
  const whens = Array.isArray(r.when) ? r.when.map((c) => condText(schema, c)) : [];
  if (whens.some((w) => w === null)) return null;
  const when = whens.join(' · ');
  return when ? `${when}${SPEC_WORDS.when} — ${main}` : main;
}

/** 상품 규격 한 줄: "지름 30cm · 바닥면 통면 · 설치 스탠드". 라벨 없는 enum 필드·값 없는 필드는 생략. */
export function specLine(schema: SpecSchema, values: Readonly<Record<string, SpecValue | undefined>>): string {
  const parts: string[] = [];
  for (const f of Array.isArray(schema?.fields) ? schema.fields : []) {
    const v = values[f.key];
    if (v === undefined) continue;
    if (f.type === 'boolean') {
      if (v === true) parts.push(splitLabel(f.label).base);
      continue;
    }
    const shown = valueLabel(f, v);
    if (shown === null) continue;
    parts.push(`${splitLabel(f.label).base} ${shown}`);
  }
  return parts.join(' · ');
}

/** 최소 규격 숫자 한 덩이(홈 B 「{용품} 규격 확인」 큰 숫자 · 칩 요약 공용). values·keys 는 스키마 필드 순서. */
export interface MinSpecFigure {
  values: number[];
  keys: string[];
  /** 공통 단위(스키마 라벨 괄호 — 없으면 ''). */
  unit: string;
  /** 값이 하나면 그 필드 이름(라벨 앞부분), 여럿이면 null. */
  base: string | null;
}

/**
 * 최소 규격 숫자 선택(스펙33 §0 G-1 — chipSpecText 와 같은 규칙): minSpec 중 when 없는 숫자 gte 규칙(스키마 number 필드 + 유한 숫자 값)만,
 *   스키마 필드 순서. 모두 같은 단위면 최대 3값, 단위가 섞이면 첫 규칙 하나, 해당 규칙이 없으면 null. 값은 규칙 값 그대로(계산 없음).
 */
export function minSpecFigure(schema: SpecSchema, minSpec: RuleSet | null | undefined): MinSpecFigure | null {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const rules = Array.isArray(minSpec?.rules) ? minSpec.rules : [];
  const picked: Array<{ key: string; value: number; unit: string; base: string }> = [];
  for (const f of fields) {
    if (f.type !== 'number') continue;
    const r = rules.find(
      (x) =>
        x &&
        x.key === f.key &&
        x.op === 'gte' &&
        typeof x.value === 'number' &&
        Number.isFinite(x.value) &&
        !(Array.isArray(x.when) && x.when.length > 0),
    );
    if (r) picked.push({ key: f.key, value: r.value as number, unit: splitLabel(f.label).unit, base: splitLabel(f.label).base });
  }
  if (picked.length === 0) return null;
  const sameUnit = picked.every((p) => p.unit === picked[0].unit);
  const shown = sameUnit ? picked.slice(0, CHIP_MAX_VALUES) : picked.slice(0, 1);
  return { values: shown.map((p) => p.value), keys: shown.map((p) => p.key), unit: picked[0].unit, base: shown.length === 1 ? shown[0].base : null };
}

/** 숫자 연결 표기("100×50×50") — minSpecFigure.values 를 칩과 같은 연결자로. */
export function figureValueText(f: Pick<MinSpecFigure, 'values'>): string {
  return f.values.map((v) => String(v)).join(CHIP_JOIN);
}

/**
 * 칩·체크리스트 행 규격 요약(스펙33 §0 G-1): "지름 28cm 이상", "높이 50cm 이상", "60×40cm 이상".
 *   선택 규칙은 minSpecFigure(when 없는 숫자 gte, 스키마 순서, 같은 단위 최대 3값 / 섞이면 첫 값). 해당 규칙이 없으면 null.
 *   값이 1개이고 필드 이름(라벨 앞부분 base)이 있으면 앞에 붙인다(356f S1 — 「권장 50」이 무엇의 숫자인지 읽히게). 2~3값은 숫자만.
 */
export function chipSpecText(schema: SpecSchema, minSpec: RuleSet | null | undefined): string | null {
  const f = minSpecFigure(schema, minSpec);
  if (!f) return null;
  const num = `${figureValueText(f)}${f.unit} ${SPEC_WORDS.gte}`;
  const base = f.base?.trim() ?? '';
  return base !== '' ? `${base} ${num}` : num;
}

// 이유 한 줄(286 U6 · D9 ①): 시드 원문(why·notNowReason)의 첫 문장을 기계적으로 자른다 — 요약·창작 없음(불변식 ⑦).
//   체크리스트 행(client)·홈 B 카드(client + 프리렌더)가 같은 함수를 쓴다(프리렌더 ↔ 하이드레이션 문구 일치).
//   문장 끝 = 마침표·물음표·느낌표 뒤 공백 또는 끝("2.5배" 같은 소수점은 자르지 않는다). 문장 끝이 없으면 원문 전체.
//   화면 한 줄 넘침은 CSS 말줄임이 맡는다(글자 수로 자르지 않는다).
const SENTENCE_END = /[.?!](?=\s|$)/;

export function firstSentence(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  if (t === '') return null;
  const m = SENTENCE_END.exec(t);
  return m ? t.slice(0, m.index + 1) : t;
}

/**
 * 이유 한 줄 단일 소스(D9 ②): 운영자가 쓴 whyShort(SupplyRequirement 소유, resolveRequirement 결과) 가 있으면 그것,
 *   없으면(키 부재·null·공백) firstSentence(why) 폴백. NOT_NOW 행의 notNowReason 우선은 호출자가 그대로 둔다.
 *   표시 전용 — 노출·순서·규격 판정에는 쓰지 않는다(불변식 ③).
 */
export function reasonLine(r: { why: string | null | undefined; whyShort?: string | null }): string | null {
  const s = typeof r.whyShort === 'string' ? r.whyShort.trim() : '';
  return s !== '' ? s : firstSentence(r.why);
}
