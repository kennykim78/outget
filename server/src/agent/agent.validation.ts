// 대행자 프로필 입력 검증 + 지위(status)↔역할(role) 일치 강제.
// 불변식 ③: 전문이면 상호·사업자번호·연락처 필수(의뢰자정보).
//   사업자번호는 **형식만** 검증(/^\d{3}-\d{2}-\d{5}$/). 외부 진위 API 호출 0.
// 불변식 ⑤: activeRegion·scheduleText 는 비어있지 않은 텍스트만.
//   좌표 입력란은 폼에 없으며, 서버는 사용자 위경도를 추적하지 않는다.
import type { Role } from '../auth/roles.js';
import type { AgentProfileInput, StoredAgentProfile } from './agent.types.js';

export interface ValidationOk {
  ok: true;
  value: AgentProfileInput;
}
export interface ValidationErr {
  ok: false;
  error: string;
}
export type ValidationResult = ValidationOk | ValidationErr;

const BIZ_NO = /^\d{3}-\d{2}-\d{5}$/;

function err(message: string): ValidationErr {
  return { ok: false, error: message };
}

function nonEmptyText(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

// role(개인대행자/전문대행자) → 기대 status.
function statusForRole(role: Role): '개인' | '전문' | undefined {
  if (role === '개인대행자') return '개인';
  if (role === '전문대행자') return '전문';
  return undefined;
}

// 입력 검증. 성공 시 정규화된 value(개인은 biz 필드 제거)를 돌려준다.
export function validateAgentInput(input: unknown, role: Role): ValidationResult {
  if (typeof input !== 'object' || input === null) {
    return err('요청 본문이 올바르지 않습니다.');
  }
  const raw = input as Record<string, unknown>;

  const expected = statusForRole(role);
  if (expected === undefined) {
    return err('대행자 역할(개인대행자/전문대행자)만 프로필을 작성할 수 있습니다.');
  }

  const status = raw.status;
  if (status !== '개인' && status !== '전문') {
    return err("status 는 '개인' 또는 '전문' 이어야 합니다.");
  }
  if (status !== expected) {
    return err(`역할(${role})과 지위(${status})가 일치하지 않습니다.`);
  }

  if (!nonEmptyText(raw.activeRegion)) {
    return err('activeRegion(활동 지역)은 비어있지 않은 텍스트여야 합니다.');
  }
  if (!nonEmptyText(raw.scheduleText)) {
    return err('scheduleText(출동 일정)은 비어있지 않은 텍스트여야 합니다.');
  }

  // 매장 앵커 좌표(선택). 들어오면 숫자 검증만, 없으면 그대로 생략(사용자 추적 아님).
  const anchorLat = raw.lat;
  const anchorLng = raw.lng;
  if (anchorLat !== undefined && typeof anchorLat !== 'number') {
    return err('lat 은 숫자(매장 앵커)이거나 생략해야 합니다.');
  }
  if (anchorLng !== undefined && typeof anchorLng !== 'number') {
    return err('lng 은 숫자(매장 앵커)이거나 생략해야 합니다.');
  }

  const base: AgentProfileInput = {
    status,
    activeRegion: raw.activeRegion.trim(),
    scheduleText: raw.scheduleText.trim(),
    // reputation 은 클라가 정하지 못한다(평판 위조 방지). 항상 0 으로 초기화.
    reputation: 0,
  };
  if (typeof anchorLat === 'number') base.lat = anchorLat;
  if (typeof anchorLng === 'number') base.lng = anchorLng;

  if (status === '개인') {
    // 개인은 biz 필드를 무시/제거한다(저장하지 않음).
    return { ok: true, value: base };
  }

  // 전문: 상호·사업자번호·연락처 필수.
  if (!nonEmptyText(raw.bizName)) {
    return err('전문 대행자는 bizName(상호)이 필수입니다.');
  }
  if (!nonEmptyText(raw.bizNo)) {
    return err('전문 대행자는 bizNo(사업자번호)가 필수입니다.');
  }
  if (!BIZ_NO.test(raw.bizNo.trim())) {
    return err('bizNo(사업자번호) 형식이 올바르지 않습니다. (예: 123-45-67890)');
  }
  if (!nonEmptyText(raw.contact)) {
    return err('전문 대행자는 contact(연락처)가 필수입니다.');
  }

  const pro: AgentProfileInput = {
    ...base,
    bizName: raw.bizName.trim(),
    bizNo: raw.bizNo.trim(),
    contact: raw.contact.trim(),
  };
  // 증빙 참조 placeholder(선택, 텍스트). 외부 호출 없음.
  if (nonEmptyText(raw.bizDocRef)) pro.bizDocRef = raw.bizDocRef.trim();

  return { ok: true, value: pro };
}

// 저장 객체에서 응답용으로 ownerUserId 를 제거(노출 금지).
export function toPublicProfile(
  p: StoredAgentProfile,
): Omit<StoredAgentProfile, 'ownerUserId'> {
  const { ownerUserId: _omit, ...pub } = p;
  void _omit;
  return pub;
}
