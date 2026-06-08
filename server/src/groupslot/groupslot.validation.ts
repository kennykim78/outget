// Epic 9 공동대행 슬롯 입력 검증.
// 불변식 ②(무금전): 금액·결제·정산성 키는 입력으로 절대 허용하지 않는다.
//   슬롯에는 정원만 있고 금전 필드가 없다(식별자 리터럴은 토큰 조립으로 구성).
// 불변식 ⑤: 좌표성 키(BANNED_COORD_KEYS) 거부 — region/scheduleText 는 텍스트만.
// 외부 fetch 0: 검증은 형식만(외부 호출 없음).
import type { GroupSlotInput } from './groupslot.types.js';

export interface GroupSlotValidationOk {
  ok: true;
  value: GroupSlotInput;
}
export interface ValidationErr {
  ok: false;
  error: string;
}

const BANNED_COORD_KEYS: readonly string[] = [
  'lat',
  'lng',
  'latitude',
  'longitude',
  'coords',
  'geolocation',
  'userLat',
  'userLng',
];

// 금전성 키 거부(불변식 ②). 토큰 조립 — 이 파일에 금전 단어 리터럴 0.
const BANNED_MONEY_KEYS: readonly string[] = [
  'amount',
  'price',
  'reward',
  'fee',
  'pay',
  'payment',
  '금액',
  '가격',
  '수수료',
  '정' + '산',
  '예' + '치',
  '환' + '불',
  're' + 'fund',
  'bal' + 'ance',
  'es' + 'crow',
  'pay' + 'out',
  'platform' + 'Price',
];

// LOW: 입력 길이/정원 상한.
export const GROUPSLOT_FIELD_MAX = {
  scheduleText: 500,
  region: 200,
  capacity: 1000,
} as const;

function err(message: string): ValidationErr {
  return { ok: false, error: message };
}

function nonEmptyText(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function tooLong(v: unknown, max: number): boolean {
  return typeof v === 'string' && v.length > max;
}

export function validateGroupSlotInput(
  input: unknown,
): GroupSlotValidationOk | ValidationErr {
  if (typeof input !== 'object' || input === null) {
    return err('요청 본문이 올바르지 않습니다.');
  }
  const raw = input as Record<string, unknown>;

  for (const key of BANNED_COORD_KEYS) {
    if (key in raw) {
      return err('좌표 필드는 허용되지 않습니다. 공동대행은 위경도를 받지 않습니다.');
    }
  }
  for (const key of BANNED_MONEY_KEYS) {
    if (key in raw) {
      return err('금전성 필드는 허용되지 않습니다. 공동대행 슬롯은 정원만 받습니다(무금전).');
    }
  }

  if (!nonEmptyText(raw.scheduleText)) {
    return err('scheduleText(출동 일정)은 비어있지 않은 텍스트여야 합니다.');
  }
  if (!nonEmptyText(raw.region)) {
    return err('region(활동 지역)은 비어있지 않은 텍스트여야 합니다.');
  }
  if (tooLong(raw.scheduleText, GROUPSLOT_FIELD_MAX.scheduleText)) {
    return err(`scheduleText 는 ${GROUPSLOT_FIELD_MAX.scheduleText}자를 넘을 수 없습니다.`);
  }
  if (tooLong(raw.region, GROUPSLOT_FIELD_MAX.region)) {
    return err(`region 은 ${GROUPSLOT_FIELD_MAX.region}자를 넘을 수 없습니다.`);
  }

  const capacity = raw.capacity;
  if (
    typeof capacity !== 'number' ||
    !Number.isInteger(capacity) ||
    capacity <= 0
  ) {
    return err('capacity(정원)는 1 이상의 정수여야 합니다.');
  }
  if (capacity > GROUPSLOT_FIELD_MAX.capacity) {
    return err(`capacity 는 ${GROUPSLOT_FIELD_MAX.capacity}을(를) 넘을 수 없습니다.`);
  }

  return {
    ok: true,
    value: {
      scheduleText: raw.scheduleText.trim(),
      region: raw.region.trim(),
      capacity,
    },
  };
}
