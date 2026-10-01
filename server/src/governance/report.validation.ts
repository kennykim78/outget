// Epic 7 신고(Report) 입력 검증.
// 불변식 ⑤: 좌표성 키(BANNED_COORD_KEYS)는 입력으로 절대 허용하지 않는다 — 위치 토큰 0.
// 불변식 ②: 금액·결제성 키는 신고 입력에 허용하지 않는다(거버넌스 메타데이터일 뿐).
// 외부 fetch 0: 검증은 형식만(외부 호출 없음).
import type { ReportInput, ReportTargetType } from './report.types.js';

export interface ReportValidationOk {
  ok: true;
  value: ReportInput;
}
export interface ValidationErr {
  ok: false;
  error: string;
}

const TARGET_TYPES: readonly ReportTargetType[] = ['message', 'profile'];

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

export const REPORT_FIELD_MAX = {
  targetId: 200,
  reason: 1000,
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

function isTargetType(v: unknown): v is ReportTargetType {
  return typeof v === 'string' && (TARGET_TYPES as readonly string[]).includes(v);
}

// 신고 입력 검증. 성공 시 정규화된 value 반환.
export function validateReportInput(
  input: unknown,
): ReportValidationOk | ValidationErr {
  if (typeof input !== 'object' || input === null) {
    return err('요청 본문이 올바르지 않습니다.');
  }
  const raw = input as Record<string, unknown>;

  // 좌표성 키 거부(불변식 ⑤).
  for (const key of BANNED_COORD_KEYS) {
    if (key in raw) {
      return err('좌표 필드는 허용되지 않습니다. 신고는 위경도를 받지 않습니다.');
    }
  }

  if (!isTargetType(raw.targetType)) {
    return err('targetType 은 message/profile 중 하나여야 합니다.');
  }
  if (!nonEmptyText(raw.targetId)) {
    return err('targetId 는 비어있지 않은 텍스트여야 합니다.');
  }
  if (!nonEmptyText(raw.reason)) {
    return err('reason(신고 사유)은 비어있지 않은 텍스트여야 합니다.');
  }
  if (tooLong(raw.targetId, REPORT_FIELD_MAX.targetId)) {
    return err(`targetId 는 ${REPORT_FIELD_MAX.targetId}자를 넘을 수 없습니다.`);
  }
  if (tooLong(raw.reason, REPORT_FIELD_MAX.reason)) {
    return err(`reason 은 ${REPORT_FIELD_MAX.reason}자를 넘을 수 없습니다.`);
  }

  return {
    ok: true,
    value: {
      targetType: raw.targetType,
      targetId: raw.targetId.trim(),
      reason: raw.reason.trim(),
    },
  };
}
