// Epic 9 계약 원본 — client/src/groupslot/types.ts 가 이 형태를 미러한다.
// 공동대행 슬롯: 대행자가 일정·지역·정원을 열고 구매자가 참여한다.
//   **금액·결제 필드 0**(불변식 ②) — 정산·예치·수수료는 서버가 다루지 않는다.
//
// 불변식 ⑤: scheduleText·region 은 동/지역 단위 텍스트만(좌표 0).

export type GroupSlotStatus = '모집' | '마감';

export interface GroupSlot {
  id: string;
  agentId: string; // 개설 대행자(JWT sub).
  scheduleText: string; // 출동 일정(자유 텍스트).
  region: string; // 활동 지역(동/지역 단위 텍스트).
  capacity: number; // 정원(양수).
  joinedCount: number; // 현재 참여 인원.
  status: GroupSlotStatus;
}

// 개설 입력 — agentId/id/joinedCount/status 는 서버가 부여.
export interface GroupSlotInput {
  scheduleText: string;
  region: string;
  capacity: number;
}
