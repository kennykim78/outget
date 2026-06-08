// Epic 4 역경매 요청 입력 검증 + 확인가 검증.
// 불변식 ⑤: region 은 비어있지 않은 텍스트만. 좌표 입력란은 폼에 없으며,
//   서버는 사용자 위경도를 받지/저장하지 않는다 — 좌표 필드가 오면 거부한다.
// 불변식 ②: hopePrice·확인가 price 는 **표시값**일 뿐(결제 아님). 자금 흐름 필드 0.
// 외부 fetch 0: 검증은 형식만(외부 호출 없음).
import type { RequestInput, VerifiedPrice } from './request.types.js';

export interface RequestValidationOk {
  ok: true;
  value: RequestInput;
}
export interface VerifiedPriceValidationOk {
  ok: true;
  value: Omit<VerifiedPrice, 'agentId' | 'verifiedAt'>;
}
export interface ValidationErr {
  ok: false;
  error: string;
}

// 좌표 추적 키는 입력으로 절대 허용하지 않는다(불변식 ⑤). 들어오면 400.
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

function err(message: string): ValidationErr {
  return { ok: false, error: message };
}

function nonEmptyText(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

// 역경매 요청 입력 검증. 성공 시 정규화된 value 반환.
export function validateRequestInput(
  input: unknown,
): RequestValidationOk | ValidationErr {
  if (typeof input !== 'object' || input === null) {
    return err('요청 본문이 올바르지 않습니다.');
  }
  const raw = input as Record<string, unknown>;

  // 좌표성 키 거부(불변식 ⑤). 위치는 region 텍스트만.
  for (const key of BANNED_COORD_KEYS) {
    if (key in raw) {
      return err('좌표 필드는 허용되지 않습니다. 위치는 region(동/지역 텍스트)만 받습니다.');
    }
  }

  if (!nonEmptyText(raw.item)) {
    return err('item(품목)은 비어있지 않은 텍스트여야 합니다.');
  }
  if (!nonEmptyText(raw.region)) {
    return err('region(동/지역 단위 텍스트)은 비어있지 않은 텍스트여야 합니다.');
  }
  if (!nonEmptyText(raw.deadline)) {
    return err('deadline(마감)은 비어있지 않은 텍스트여야 합니다.');
  }
  // hopePrice 는 표시용 숫자(결제 아님).
  if (typeof raw.hopePrice !== 'number' || Number.isNaN(raw.hopePrice)) {
    return err('hopePrice(희망가)는 숫자여야 합니다.');
  }

  const value: RequestInput = {
    item: raw.item.trim(),
    hopePrice: raw.hopePrice,
    deadline: raw.deadline.trim(),
    region: raw.region.trim(),
  };
  // options 는 선택(비어있지 않은 텍스트일 때만 채운다).
  if (nonEmptyText(raw.options)) value.options = raw.options.trim();

  return { ok: true, value };
}

// 확인가 검증 — price 숫자, note 선택. agentId·verifiedAt 은 라우터가 부여(책임 동반).
export function validateVerifiedPrice(
  input: unknown,
): VerifiedPriceValidationOk | ValidationErr {
  if (typeof input !== 'object' || input === null) {
    return err('요청 본문이 올바르지 않습니다.');
  }
  const raw = input as Record<string, unknown>;

  if (typeof raw.price !== 'number' || Number.isNaN(raw.price)) {
    return err('price(확인가)는 숫자여야 합니다.');
  }

  const value: Omit<VerifiedPrice, 'agentId' | 'verifiedAt'> = { price: raw.price };
  if (nonEmptyText(raw.note)) value.note = raw.note.trim();

  return { ok: true, value };
}
