// Epic 6 할인소식(UGC) 입력 검증.
// 불변식 ⑤: 좌표성 키(BANNED_COORD_KEYS)는 입력으로 절대 허용하지 않는다 — 위치 토큰 0.
// 불변식 ①(무크롤링/핫링크 차단): photo 가 외부 절대 http(s) URL 이면 거부한다.
//   외부 이미지를 자동 참조(핫링크)하면 사실상 외부 본문/자산 수집이 된다 — 자사 저장 식별자만.
// 불변식 ④: unverifiedBase 는 검증이 아니라 리포지토리가 서버 강제한다(클라가 보내지 못한다).
//   platformPrice/ourPrice 류 단정가 변수는 일절 다루지 않는다(R5).
// 외부 fetch 0: 검증은 형식만(외부 호출 없음).
import type { DiscountInput } from './listings.types.js';

export interface DiscountValidationOk {
  ok: true;
  value: DiscountInput;
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

// LOW-c: 입력 길이 상한(자원 남용·UI 깨짐 방지). 초과 시 400.
export const DISCOUNT_FIELD_MAX = {
  storeBrand: 200,
  source: 500,
  photo: 500,
  referenceQuery: 200,
  referenceProductId: 100,
} as const;

// 불변식 ④: 참고가 가격/출처/시각은 **서버 권위 스탬프** — 클라가 주입하면 거부(400).
//   클라가 보낼 수 있는 신규 입력은 referenceQuery(검색어) + referenceProductId(선택 상품) 둘뿐.
//   가격은 base/lowest 전부 금지(두 가격 모두 서버 confirm 으로만 확정).
const BANNED_REFERENCE_KEYS: readonly string[] = [
  'referenceBasePrice',
  'referenceLowestPrice',
  'referenceSource',
  'referenceFetchedAt',
];

function err(message: string): ValidationErr {
  return { ok: false, error: message };
}

function nonEmptyText(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function tooLong(v: unknown, max: number): boolean {
  return typeof v === 'string' && v.length > max;
}

// 외부 절대 http(s) URL 여부 — 핫링크 차단(불변식 ①). 자사 상대경로/식별자는 통과.
function isExternalUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

// 숫자 옵셔널 필드 — 존재하면 유한 숫자여야 한다(NaN/문자 거부).
function badOptionalNumber(v: unknown): boolean {
  if (v === undefined) return false;
  return typeof v !== 'number' || !Number.isFinite(v);
}

// 할인소식 입력 검증. 성공 시 정규화된 value 반환.
export function validateDiscountInput(
  input: unknown,
): DiscountValidationOk | ValidationErr {
  if (typeof input !== 'object' || input === null) {
    return err('요청 본문이 올바르지 않습니다.');
  }
  const raw = input as Record<string, unknown>;

  // 좌표성 키 거부(불변식 ⑤). 위치는 좌표가 아니라 매장 브랜드 텍스트로만 표현된다.
  for (const key of BANNED_COORD_KEYS) {
    if (key in raw) {
      return err('좌표 필드는 허용되지 않습니다. 할인소식은 위경도를 받지 않습니다.');
    }
  }

  // 참고가 서버 권위 키 거부(불변식 ④). 클라는 referenceQuery+referenceProductId 만 보낼 수 있다.
  for (const key of BANNED_REFERENCE_KEYS) {
    if (key in raw) {
      return err(
        '참고가(가격/출처/조회시각)는 서버가 결정합니다. referenceQuery(검색어)와 referenceProductId(선택 상품)만 보낼 수 있습니다.',
      );
    }
  }

  // 필수 텍스트: storeBrand·source.
  if (!nonEmptyText(raw.storeBrand)) {
    return err('storeBrand(매장/브랜드)는 비어있지 않은 텍스트여야 합니다.');
  }
  if (!nonEmptyText(raw.source)) {
    return err('source(출처)는 비어있지 않은 텍스트여야 합니다.');
  }

  // 숫자 옵셔널: discountRate·discountPrice·listPrice.
  if (badOptionalNumber(raw.discountRate)) {
    return err('discountRate(할인율)는 숫자여야 합니다.');
  }
  if (badOptionalNumber(raw.discountPrice)) {
    return err('discountPrice(할인가)는 숫자여야 합니다.');
  }
  if (badOptionalNumber(raw.listPrice)) {
    return err('listPrice(정가)는 숫자여야 합니다.');
  }

  // 길이 상한.
  if (tooLong(raw.storeBrand, DISCOUNT_FIELD_MAX.storeBrand)) {
    return err(`storeBrand 는 ${DISCOUNT_FIELD_MAX.storeBrand}자를 넘을 수 없습니다.`);
  }
  if (tooLong(raw.source, DISCOUNT_FIELD_MAX.source)) {
    return err(`source 는 ${DISCOUNT_FIELD_MAX.source}자를 넘을 수 없습니다.`);
  }

  // photo(선택): 외부 절대 URL 거부(핫링크 차단·불변식 ①). MVP 는 미수신 권장.
  if (raw.photo !== undefined) {
    if (typeof raw.photo !== 'string') {
      return err('photo 는 텍스트(자사 저장 식별자)여야 합니다.');
    }
    if (tooLong(raw.photo, DISCOUNT_FIELD_MAX.photo)) {
      return err(`photo 는 ${DISCOUNT_FIELD_MAX.photo}자를 넘을 수 없습니다.`);
    }
    if (isExternalUrl(raw.photo)) {
      return err('외부 절대 URL 사진은 허용되지 않습니다(핫링크 차단). 자사 저장 식별자만 받습니다.');
    }
  }

  // referenceQuery(선택): 네이버쇼핑 검색어. 텍스트 + 길이상한만(외부 fetch 0 — 조회는 라우터/어댑터).
  if (raw.referenceQuery !== undefined) {
    if (typeof raw.referenceQuery !== 'string') {
      return err('referenceQuery(검색어)는 텍스트여야 합니다.');
    }
    if (tooLong(raw.referenceQuery, DISCOUNT_FIELD_MAX.referenceQuery)) {
      return err(`referenceQuery 는 ${DISCOUNT_FIELD_MAX.referenceQuery}자를 넘을 수 없습니다.`);
    }
  }

  // referenceProductId(선택): 사용자가 고른 상품의 불투명 식별자. 텍스트 + 길이상한만.
  //   서버가 referenceQuery 와 함께 confirm 재조회로 가격을 확정한다(가격은 클라가 못 보냄).
  if (raw.referenceProductId !== undefined) {
    if (typeof raw.referenceProductId !== 'string') {
      return err('referenceProductId(선택 상품)는 텍스트여야 합니다.');
    }
    if (tooLong(raw.referenceProductId, DISCOUNT_FIELD_MAX.referenceProductId)) {
      return err(
        `referenceProductId 는 ${DISCOUNT_FIELD_MAX.referenceProductId}자를 넘을 수 없습니다.`,
      );
    }
  }

  const value: DiscountInput = {
    storeBrand: raw.storeBrand.trim(),
    source: raw.source.trim(),
  };
  if (typeof raw.discountRate === 'number') value.discountRate = raw.discountRate;
  if (typeof raw.discountPrice === 'number') value.discountPrice = raw.discountPrice;
  if (typeof raw.listPrice === 'number') value.listPrice = raw.listPrice;
  if (nonEmptyText(raw.photo)) value.photo = (raw.photo as string).trim();
  if (nonEmptyText(raw.referenceQuery)) {
    value.referenceQuery = (raw.referenceQuery as string).trim();
  }
  if (nonEmptyText(raw.referenceProductId)) {
    value.referenceProductId = (raw.referenceProductId as string).trim();
  }

  return { ok: true, value };
}
