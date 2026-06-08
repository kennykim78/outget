// Epic9 클라 공동대행 슬롯 계약 — 서버 groupslot.types/validation 미러(병렬).
// 서버 트랙이 권위 소스이며 여기는 미러. shape 변경 시 양쪽 동기.
//
// 불변식 메모:
//  - ⑤/R3: region 은 "동/지역 텍스트"만(좌표 아님). DTO 에 위경도 필드 없음.
//  - ②/R2: 금액·대금·정산·결제 필드 없음. capacity/joinedCount 는 자리 수일 뿐.
//  - 개설·참여는 공동대행 경고 모달 동의 후에만 실행(I2/I3).

/** 공동대행 슬롯 상태(미러). 서버 권위 — 표시용. */
export type GroupSlotStatus = '모집' | '마감';

/** 공동대행 슬롯(S8). 금액 필드 없음(②). region 은 텍스트(⑤). */
export interface GroupSlot {
  id: string;
  /** 출동/일정 텍스트(예: "토 여주 출동"). */
  scheduleText: string;
  /** 활동지역(동/지역 텍스트만 — 좌표 아님). */
  region: string;
  /** 모집 정원(자리 수). 금액 아님. */
  capacity: number;
  /** 현재 참여 수. */
  joinedCount: number;
  status: GroupSlotStatus;
}

/**
 * 슬롯 개설 입력(GroupSlotInput) — 일정·지역·정원뿐.
 * 금액·결제·좌표 필드 없음(②/⑤).
 */
export interface GroupSlotInput {
  /** 출동/일정 텍스트(필수). */
  scheduleText: string;
  /** 활동지역(동/지역 텍스트만). */
  region: string;
  /** 모집 정원(자리 수, 1 이상). */
  capacity: number;
}
