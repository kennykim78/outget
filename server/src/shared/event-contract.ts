// 이벤트 계약(PRD US-018, R4 계약 C-3) — 단일 소스. 서버 POST /api/events 와 클라이언트(@ws/events)가 같은 파일을 쓴다.
//   순수 모듈: import 0, Node·DOM 전역 0(engine.purity 테스트가 shared/ 도 검사).
//   불변식 ⑤⑧ — 좌표·이메일·전화·IP·UA 는 봉투에도 props 에도 들어갈 수 없다(허용목록 + 패턴 거부).
//   enum 값은 engine/domain.ts 와 같은 리터럴(형제 import 규칙 때문에 복제, events.test 가 동기 단언).

export const EVENT_NAMES = [
  'species_selected',
  'unknown_species_clicked',
  'setup_started',
  'item_checked',
  'item_unchecked',
  'setup_100_reached',
  'bundle_viewed',
  'spec_checker_used',
  'compatibility_checked',
  'external_product_clicked',
  'vet_clicked',
  'reaction_helpful',
  'reaction_recheck',
  // R5 C-R5-7(D18): US-025 이메일 저장 4종 + US-022 상품 상세·♥ 2종.
  'save_prompt_view',
  'save_email_submit',
  'save_link_confirm',
  'save_merge',
  'product_viewed',
  'reaction_like',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const MAX_BATCH = 20;
export const MAX_PROPS_BYTES = 1024;
export const MAX_BODY_BYTES = 16 * 1024;
export const QUERY_MAX_LEN = 20;

/** 어떤 이벤트의 props 허용목록에도 들어갈 수 없는 키(대소문자 무시). */
export const FORBIDDEN_PROP_KEYS = [
  'lat',
  'lng',
  'latitude',
  'longitude',
  'coords',
  'coordinates',
  'location',
  'email',
  'phone',
  'tel',
  'address',
  'ip',
  'ua',
  'userAgent',
  'name',
  'nickname',
] as const;

export type PropSpec =
  | { readonly kind: 'slug' }
  | { readonly kind: 'token' }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'int'; readonly min: number; readonly max: number }
  | { readonly kind: 'bool' }
  | { readonly kind: 'query' };

const SLUG: PropSpec = { kind: 'slug' };
const BOOL: PropSpec = { kind: 'bool' };
const QUERY: PropSpec = { kind: 'query' };
const en = (...values: string[]): PropSpec => ({ kind: 'enum', values });

// engine/domain.ts 동기 리터럴.
const GROUPS = en('SMALL_MAMMAL', 'PARROT');
const PRIORITY = en('REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'NOT_NOW');
const READY_SOURCE = en('OWNED', 'PURCHASED', 'UNKNOWN');
const TIER = en('BUDGET', 'BALANCED', 'USED_MIX');
const VERDICT = en('OK', 'BELOW_RECOMMENDED', 'BELOW_MIN', 'CHECK', 'NONE');
const REACTION_TARGET = en('SUPPLY_ITEM', 'GUIDE', 'BUNDLE', 'PRODUCT');

const ITEM_TOGGLE = {
  animalTypeId: SLUG,
  supplyItemId: SLUG,
  priority: PRIORITY,
  readySource: READY_SOURCE,
} as const;
const REACTION = { targetType: REACTION_TARGET, targetId: SLUG } as const;

/** 이벤트별 props 허용목록(PRD 원문 키). 나열된 키는 모두 필수, 그 외 키는 거부. */
export const EVENT_PROP_SPECS: Readonly<Record<EventName, Readonly<Record<string, PropSpec>>>> = {
  species_selected: { animalTypeId: SLUG, group: GROUPS, via: en('picker', 'alias', 'url') },
  unknown_species_clicked: { query: QUERY },
  setup_started: { animalTypeId: SLUG, firstTime: BOOL, ownedCount: { kind: 'int', min: 0, max: 200 } },
  item_checked: ITEM_TOGGLE,
  item_unchecked: ITEM_TOGGLE,
  setup_100_reached: { animalTypeId: SLUG, elapsedSec: { kind: 'int', min: 0, max: 315_360_000 } },
  bundle_viewed: { animalTypeId: SLUG, tier: TIER },
  spec_checker_used: { animalTypeId: SLUG, supplyItemId: SLUG, verdict: VERDICT },
  compatibility_checked: { animalTypeId: SLUG, ruleId: SLUG, verdict: VERDICT },
  external_product_clicked: { animalTypeId: SLUG, supplyItemId: SLUG, merchant: { kind: 'token' } },
  vet_clicked: { clinicId: SLUG, action: en('call', 'route', 'detail') },
  reaction_helpful: REACTION,
  reaction_recheck: REACTION,
  // 진입점(스펙33 §5.9): 홈 B 저장 배너 · L2 꼬리 · /save 딥링크. 이메일·토큰은 어떤 저장 이벤트에도 싣지 않는다(⑧).
  save_prompt_view: { entry: en('home_band', 'l2_footer', 'deeplink') },
  save_email_submit: {},
  save_link_confirm: {},
  save_merge: { winner: en('local', 'server', 'mixed', 'none') },
  product_viewed: { productId: SLUG, supplyItemId: SLUG },
  reaction_like: { productId: SLUG },
};

export type PropValue = string | number | boolean;

export interface TrackEvent {
  name: EventName;
  /** 클라이언트 시각 epoch ms(정수). */
  ts: number;
  animalTypeId?: string;
  props: Record<string, PropValue>;
  /** 랜덤 UUID(localStorage 회전). 개인 식별 목적 없음. */
  sessionKey: string;
}

export type EventError =
  | 'not_object'
  | 'unknown_field'
  | 'unknown_name'
  | 'bad_ts'
  | 'bad_session_key'
  | 'bad_animal_type'
  | 'animal_type_mismatch'
  | 'bad_props'
  | 'props_too_large'
  | 'unknown_prop'
  | 'missing_prop'
  | 'bad_prop_value'
  | 'pii_pattern';

export type BatchError = EventError | 'bad_batch' | 'batch_empty' | 'batch_too_large';

export type EventResult = { ok: true; event: TrackEvent } | { ok: false; error: EventError };
export type BatchResult =
  | { ok: true; events: TrackEvent[] }
  | { ok: false; error: BatchError; index?: number };

const ENVELOPE_KEYS = ['name', 'ts', 'animalTypeId', 'props', 'sessionKey'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{1,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+/;
const PHONE_RE = /(?:\d[\s.-]?){9,}/;
// 2020-01-01 ~ 2100-01-01 (epoch ms)
const TS_MIN = 1_577_836_800_000;
const TS_MAX = 4_102_444_800_000;

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function isEventName(x: unknown): x is EventName {
  return typeof x === 'string' && (EVENT_NAMES as readonly string[]).includes(x);
}

/** UTF-8 바이트 길이(TextEncoder 비의존). 짝 없는 서로게이트는 3바이트(U+FFFD)로 센다. */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

/** "잘 모르겠어요" 입력 정제: [가-힣a-zA-Z ]만, 연속 공백 1개, 앞뒤 공백 제거, 20자. */
export function sanitizeQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[^가-힣a-zA-Z ]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, QUERY_MAX_LEN)
    .trim();
}

function checkValue(spec: PropSpec, v: unknown): boolean {
  switch (spec.kind) {
    case 'slug':
      return typeof v === 'string' && SLUG_RE.test(v);
    case 'token':
      return typeof v === 'string' && TOKEN_RE.test(v);
    case 'enum':
      return typeof v === 'string' && spec.values.includes(v);
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) && v >= spec.min && v <= spec.max;
    case 'bool':
      return typeof v === 'boolean';
    case 'query':
      return typeof v === 'string' && v.length > 0 && v === sanitizeQuery(v);
  }
}

function looksLikePii(v: string): boolean {
  return EMAIL_RE.test(v) || PHONE_RE.test(v);
}

/** 이벤트 1건 검증. 통과 시 허용 필드만 새 객체로 복사해 돌려준다. */
export function validateEvent(x: unknown): EventResult {
  if (!isPlainObject(x)) return { ok: false, error: 'not_object' };
  for (const k of Object.keys(x)) if (!ENVELOPE_KEYS.includes(k)) return { ok: false, error: 'unknown_field' };

  const { name, ts, sessionKey, props } = x;
  if (!isEventName(name)) return { ok: false, error: 'unknown_name' };
  if (typeof ts !== 'number' || !Number.isInteger(ts) || ts < TS_MIN || ts > TS_MAX) {
    return { ok: false, error: 'bad_ts' };
  }
  if (typeof sessionKey !== 'string' || !UUID_RE.test(sessionKey)) return { ok: false, error: 'bad_session_key' };

  let animalTypeId: string | undefined;
  if (has(x, 'animalTypeId') && x.animalTypeId !== undefined) {
    if (typeof x.animalTypeId !== 'string' || !SLUG_RE.test(x.animalTypeId)) {
      return { ok: false, error: 'bad_animal_type' };
    }
    animalTypeId = x.animalTypeId;
  }

  if (!isPlainObject(props)) return { ok: false, error: 'bad_props' };
  let encoded: string;
  try {
    encoded = JSON.stringify(props);
  } catch {
    return { ok: false, error: 'bad_props' };
  }
  if (utf8ByteLength(encoded) > MAX_PROPS_BYTES) return { ok: false, error: 'props_too_large' };

  const specs = EVENT_PROP_SPECS[name];
  for (const k of Object.keys(props)) if (!has(specs, k)) return { ok: false, error: 'unknown_prop' };
  const out: Record<string, PropValue> = {};
  for (const k of Object.keys(specs)) {
    if (!has(props, k) || props[k] === undefined) return { ok: false, error: 'missing_prop' };
    const v = props[k];
    if (typeof v === 'string' && looksLikePii(v)) return { ok: false, error: 'pii_pattern' };
    if (!checkValue(specs[k], v)) return { ok: false, error: 'bad_prop_value' };
    out[k] = v as PropValue;
  }

  const propAnimal = typeof out.animalTypeId === 'string' ? out.animalTypeId : undefined;
  if (animalTypeId !== undefined && propAnimal !== undefined && animalTypeId !== propAnimal) {
    return { ok: false, error: 'animal_type_mismatch' };
  }
  const event: TrackEvent = { name, ts, props: out, sessionKey };
  const resolvedAnimal = animalTypeId ?? propAnimal;
  if (resolvedAnimal !== undefined) event.animalTypeId = resolvedAnimal;
  return { ok: true, event };
}

/** 배치 {events: [...]} 검증 — 1~MAX_BATCH건, 하나라도 무효면 전체 거부(index 동반). */
export function validateBatch(x: unknown): BatchResult {
  if (!isPlainObject(x) || Object.keys(x).length !== 1 || !Array.isArray(x.events)) {
    return { ok: false, error: 'bad_batch' };
  }
  const list: unknown[] = x.events;
  if (list.length === 0) return { ok: false, error: 'batch_empty' };
  if (list.length > MAX_BATCH) return { ok: false, error: 'batch_too_large' };
  const events: TrackEvent[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = validateEvent(list[i]);
    if (!r.ok) return { ok: false, error: r.error, index: i };
    events.push(r.event);
  }
  return { ok: true, events };
}
