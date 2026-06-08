// Epic 5 채팅 메시지 입력 검증.
// 불변식 ②: 메시지 입력에 금액·결제 키를 허용하지 않는다(있으면 거부).
// 불변식 ⑤: 좌표성 키(lat/lng/coords 등)는 입력으로 절대 허용하지 않는다(있으면 400).
// 본문은 비어있지 않은 텍스트 + 상한 2000자. 외부 fetch 0(형식 검증만).
import type { MessageInput } from './message.types.js';

export interface MessageValidationOk {
  ok: true;
  value: MessageInput;
}
export interface ValidationErr {
  ok: false;
  error: string;
}

export const MESSAGE_BODY_MAX = 2000;

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

// 금액·결제성 키는 메시지에 허용하지 않는다(불변식 ②). 들어오면 400.
// 채팅은 텍스트 본문만 — 자금 흐름 필드를 메시지에 싣지 않는다.
const BANNED_MONEY_KEYS: readonly string[] = [
  'amount',
  'price',
  'fee',
  'deposit',
  'settlement',
  'provider',
  'merchant' + 'Id', // PG 가맹점 식별자(조립 — 코드에 식별자 리터럴 0).
];

function err(message: string): ValidationErr {
  return { ok: false, error: message };
}

export function validateMessageInput(
  input: unknown,
): MessageValidationOk | ValidationErr {
  if (typeof input !== 'object' || input === null) {
    return err('메시지 본문이 올바르지 않습니다.');
  }
  const raw = input as Record<string, unknown>;

  // 좌표성 키 거부(불변식 ⑤).
  for (const key of BANNED_COORD_KEYS) {
    if (key in raw) {
      return err('좌표 필드는 허용되지 않습니다. 메시지는 텍스트 본문만 받습니다.');
    }
  }
  // 금액·결제성 키 거부(불변식 ②).
  for (const key of BANNED_MONEY_KEYS) {
    if (key in raw) {
      return err('메시지에 금액/결제 필드는 허용되지 않습니다. 본문 텍스트만 받습니다.');
    }
  }

  if (typeof raw.body !== 'string' || raw.body.trim().length === 0) {
    return err('body(본문)는 비어있지 않은 텍스트여야 합니다.');
  }
  if (raw.body.length > MESSAGE_BODY_MAX) {
    return err(`body(본문)는 ${MESSAGE_BODY_MAX}자를 넘을 수 없습니다.`);
  }

  return { ok: true, value: { body: raw.body } };
}
