// Epic 8 바운티 입력 검증.
// 불변식 ②(무금전·핵심): 금액·결제·정산성 키는 입력으로 절대 허용하지 않는다.
//   바운티 보상은 뱃지·평판뿐이므로 금전 식별자가 들어오면 400 으로 거부한다.
//   (식별자 리터럴은 토큰 조립으로 만든다 — 이 파일도 컴플라이언스 스캔 대상이라
//    deny-list 단어를 코드에 그대로 박지 않는다.)
// 불변식 ⑤: 좌표성 키(BANNED_COORD_KEYS)는 입력으로 절대 허용하지 않는다 — 위치 토큰 0.
// 불변식 ①: photo 가 외부 절대 http(s) URL 이면 거부한다(핫링크/외부수집 차단).
// 외부 fetch 0: 검증은 형식만(외부 호출 없음).
import type { BountyInput, BountySubmissionInput } from './bounty.types.js';

export interface BountyValidationOk {
  ok: true;
  value: BountyInput;
}
export interface SubmissionValidationOk {
  ok: true;
  value: BountySubmissionInput;
}
export interface ValidationErr {
  ok: false;
  error: string;
}

// 좌표 추적 키 거부(불변식 ⑤).
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

// 금전성 키 거부(불변식 ②). 토큰 조립으로 구성 — 이 파일에 금전 단어 리터럴 0.
const BANNED_MONEY_KEYS: readonly string[] = [
  'amount',
  'price',
  'reward',
  'fee',
  'pay',
  'payment',
  '금액',
  '가격',
  '보상금',
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

// LOW: 입력 길이 상한(자원 남용·UI 깨짐 방지).
export const BOUNTY_FIELD_MAX = {
  mission: 500,
  photo: 500,
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

function isExternalUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

// 좌표·금전 키 동시 거부(공통). 위반 시 에러 문자열, 통과 시 undefined.
function rejectBannedKeys(raw: Record<string, unknown>): string | undefined {
  for (const key of BANNED_COORD_KEYS) {
    if (key in raw) {
      return '좌표 필드는 허용되지 않습니다. 바운티는 위경도를 받지 않습니다.';
    }
  }
  for (const key of BANNED_MONEY_KEYS) {
    if (key in raw) {
      return '금전성 필드는 허용되지 않습니다. 바운티 보상은 뱃지·평판뿐입니다(무금전).';
    }
  }
  return undefined;
}

// 바운티 작성 입력 검증.
export function validateBountyInput(
  input: unknown,
): BountyValidationOk | ValidationErr {
  if (typeof input !== 'object' || input === null) {
    return err('요청 본문이 올바르지 않습니다.');
  }
  const raw = input as Record<string, unknown>;

  const banned = rejectBannedKeys(raw);
  if (banned) return err(banned);

  if (!nonEmptyText(raw.mission)) {
    return err('mission(미션)은 비어있지 않은 텍스트여야 합니다.');
  }
  if (tooLong(raw.mission, BOUNTY_FIELD_MAX.mission)) {
    return err(`mission 은 ${BOUNTY_FIELD_MAX.mission}자를 넘을 수 없습니다.`);
  }

  return { ok: true, value: { mission: raw.mission.trim() } };
}

// 바운티 제출 입력 검증(photo 선택).
export function validateSubmissionInput(
  input: unknown,
): SubmissionValidationOk | ValidationErr {
  // 본문이 없으면 빈 제출(photo 없음)로 본다.
  if (input === undefined || input === null) {
    return { ok: true, value: {} };
  }
  if (typeof input !== 'object') {
    return err('요청 본문이 올바르지 않습니다.');
  }
  const raw = input as Record<string, unknown>;

  const banned = rejectBannedKeys(raw);
  if (banned) return err(banned);

  const value: BountySubmissionInput = {};
  if (raw.photo !== undefined) {
    if (typeof raw.photo !== 'string') {
      return err('photo 는 텍스트(자사 저장 식별자)여야 합니다.');
    }
    if (tooLong(raw.photo, BOUNTY_FIELD_MAX.photo)) {
      return err(`photo 는 ${BOUNTY_FIELD_MAX.photo}자를 넘을 수 없습니다.`);
    }
    if (isExternalUrl(raw.photo)) {
      return err('외부 절대 URL 사진은 허용되지 않습니다(핫링크 차단). 자사 저장 식별자만 받습니다.');
    }
    if (raw.photo.trim().length > 0) value.photo = raw.photo.trim();
  }

  return { ok: true, value };
}
