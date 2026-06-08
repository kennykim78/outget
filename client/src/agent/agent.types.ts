// Epic 3 클라 대행자 프로필 계약 — 서버 agent.types.ts 미러(폼 DTO).
// 서버 트랙이 권위 소스이며 여기는 미러(병렬 진행). shape 변경 시 양쪽 동기.
//
// 불변식 메모:
//  - ⑤/R3: 활동지역·출동일정은 "동/지역 텍스트"만. 위경도(좌표)는 폼 DTO에 없다.
//    StoredAgentProfile.lat/lng 는 매장 앵커(선택)로 서버가 보유할 수 있으나,
//    클라 폼은 좌표를 입력·전송하지 않는다 → 폼 입력 타입에서 좌표 토큰 자체를 제외.
//  - ③: 개인=비사업자, 전문=사업자. 전문이면 상호/사업자번호/연락처(의뢰자정보).
//  - ②: Match 에 금액·대금 필드 0(결제 코드 없음, 플랫폼 자금 미보유).

/** 대행자 지위 — 개인(비사업자) / 전문(사업자). */
export type AgentStatus = '개인' | '전문';

/**
 * 대행자 프로필 폼 입력(AgentProfileInput).
 * 서버 StoredAgentProfile 에서 id·ownerUserId 를 제외한 입력 DTO.
 * 좌표(매장 앵커)는 폼에서 다루지 않으므로 여기에 포함하지 않는다(⑤/R3).
 */
export interface AgentProfileInput {
  status: AgentStatus;
  /** 전문(사업자)일 때 상호. */
  bizName?: string;
  /** 전문(사업자)일 때 사업자번호(형식 XXX-XX-XXXXX). */
  bizNo?: string;
  /** 연락처(전문 의뢰자정보). 표시·라우팅용. */
  contact?: string;
  /** 증빙 식별자 텍스트(파일 업로드 아님 — placeholder 참조값). */
  bizDocRef?: string;
  /** 활동지역(동/지역 텍스트만). */
  activeRegion: string;
  /** 출동일정(텍스트). */
  scheduleText: string;
}

/**
 * 서버가 돌려주는 저장된 프로필(미러).
 * 클라는 프리필 용도로만 읽으며, lat/lng 는 읽지도 전송하지도 않는다(폼에 없음).
 * id·ownerUserId 는 서버 발급. reputation 은 플랫폼 산정 평판.
 */
export interface StoredAgentProfile extends AgentProfileInput {
  id: string;
  reputation: number;
  /**
   * 평판 뱃지 목록(예: '확인러'). 무금전 신뢰 시그널(Epic8/9).
   * 서버 권위 — 표시 전용. 금액 의미 없음(②).
   */
  badges?: string[];
}

/** 매칭 요청 결과(미러) — 채팅 진입 placeholder. 금액·대금 필드 0(②). */
export interface MatchResult {
  id: string;
  agentId: string;
  status: '매칭';
  chatThreadId: string;
}
