// Epic 3 계약 원본 — client/src/agent/agent.types.ts 가 이 형태를 미러한다.
// 대행자 프로필 쓰기(작성/수정) + 매칭 진입에서 다루는 저장/입력 shape.
//
// status: '개인'(비사업자) / '전문'(사업자). 전문은 상호·사업자번호·연락처 필수.
//   불변식 ③: 전문 대행자 의뢰자정보(상호/사업자번호/연락처) 보유.
// reputation: 무금전 평판 점수(바운티·뱃지 누계). 결제·잔액 아님(불변식 ②).
//
// 좌표(lat/lng) 주의: 이 값은 **매장/지역 앵커 좌표**(선택 입력)일 뿐
//   사용자 실시간 위치가 아니다. 서버는 사용자 위경도를 저장·추적·전송하지 않는다.
//   활동지역·출동일정은 동/지역 단위 텍스트만 받는다(불변식 ⑤).

export interface StoredAgentProfile {
  id: string;
  ownerUserId: string; // 소유자(JWT sub). 응답에는 절대 노출하지 않는다.
  status: '개인' | '전문';
  bizName?: string; // 전문 상호(개인은 미보유).
  bizNo?: string; // 전문 사업자번호(개인은 미보유).
  contact?: string; // 전문 공개 연락 채널(개인은 미보유).
  bizDocRef?: string; // 증빙 참조 placeholder. 외부 진위 API 호출 0(Epic 3 밖).
  activeRegion: string; // 활동 지역(동/지역 단위 텍스트).
  scheduleText: string; // 출동 일정(자유 텍스트).
  reputation: number; // 무금전 평판 점수.
  lat?: number; // 매장 앵커(선택) — 사용자 위치 추적 아님.
  lng?: number; // 매장 앵커(선택) — 사용자 위치 추적 아님.
}

// 작성/수정 입력 — ownerUserId/id 는 서버가 부여(클라가 보내지 않는다).
export type AgentProfileInput = Omit<StoredAgentProfile, 'id' | 'ownerUserId'>;
