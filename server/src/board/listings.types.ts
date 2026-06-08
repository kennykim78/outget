// Epic 2 계약 원본 — client/src/board/board.types.ts 가 이 형태를 미러한다.
// 읽기 전용 보드(대행자/역경매요청/할인소식)의 응답 shape.
//
// 좌표(lat/lng) 주의: 이 값은 **매장/지역 앵커 좌표**(여주/김포 등)일 뿐
// 사용자 실시간 위치가 아니다. 서버는 사용자 위경도를 저장·추적·전송하지 않는다.
// 거리 계산은 클라이언트에서만 수행한다(불변식 ⑤).

// 대행자 광고(개인 비사업자 / 전문 사업자). reputation 은 무금전 평판 점수.
export interface AgentProfile {
  id: string;
  status: '개인' | '전문';
  bizName?: string; // 전문 대행자 상호(개인은 미입력).
  bizNo?: string; // 전문 대행자 사업자번호.
  contact?: string; // 공개 연락 채널.
  activeRegion: string; // 활동 지역(동/지역 단위 텍스트).
  scheduleText: string; // 출동 일정(자유 텍스트).
  reputation: number;
  lat: number;
  lng: number;
}

// 구매자 역경매 요청. status 는 거래 상태머신의 라벨(대기/채택/매칭/진행/종료 등).
export interface RequestItem {
  id: string;
  item: string;
  options?: string;
  hopePrice: number;
  deadline: string; // ISO 날짜 문자열.
  region: string; // 동/지역 단위 텍스트.
  status: string;
}

// 할인소식(UGC, 미검증). 정가(listPrice) 미입력 시 서버가 unverifiedBase=true 스탬프.
export interface DiscountPost {
  id: string;
  storeBrand: string;
  discountRate?: number; // 할인율(%) — opt.
  discountPrice?: number; // 할인가 — opt.
  listPrice?: number; // 정가 — opt. 미입력 시 unverifiedBase 강제.
  unverifiedBase: boolean; // 서버 스탬프: 기준가(정가) 미확인 플래그.
  source: string; // 출처(작성자 입력 텍스트).
  photo?: string; // 사진 URL/식별자(자사 저장, 외부 수집 아님).
  createdAt: string; // ISO 시각.
  lat: number;
  lng: number;
}
