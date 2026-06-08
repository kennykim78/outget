// Epic 8 계약 원본 — client/src/agent/agent.types.ts(badges) 가 type 문자열을 미러한다.
// 무금전 신뢰 신호. 바운티 제출·기여로 부여되는 라벨일 뿐 금전·잔액이 아니다(불변식 ②).
//
// Badge { userId; type; grantedAt } — userId 는 수상자(JWT sub). 응답에는 type 만 노출한다.
//   type 예: '확인러'(현장 확인 기여). grantedAt 은 ISO 문자열.
// 멱등: 같은 (userId, type) 은 한 번만 보유한다(중복 부여 무시).
export interface Badge {
  userId: string; // 수상자(JWT sub). 응답에는 절대 노출하지 않는다.
  type: string; // 뱃지 종류(예: '확인러').
  grantedAt: string; // ISO 발급 시각.
}
