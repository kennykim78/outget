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
  // 무금전 뱃지 라벨(노출). 보유 뱃지 type 목록 — 금액·잔액 아님(불변식 ②).
  badges?: string[];
  // 매장 앵커(선택). 등록 프로필이 좌표를 안 넣으면 생략 — 사용자 위치 아님.
  lat?: number;
  lng?: number;
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
  // 현장 확인가(선택) — 대행자 책임 동반(agentId·verifiedAt). 플랫폼 단정가 아님.
  verifiedPrice?: {
    price: number;
    agentId: string;
    verifiedAt: string;
    note?: string;
  };
}

// 할인소식(UGC, 미검증). 정가(listPrice) 미입력 시 서버가 unverifiedBase=true 스탬프.
//
// 좌표(lat/lng)는 **옵셔널** — 운영자 시드(매장 앵커)에만 존재하고, 사용자 UGC 등록분은
//   핀 없이 리스트로만 노출한다(요청 레이어 선례). 서버는 사용자 위경도를 받지/저장하지 않는다(불변식 ⑤).
export interface DiscountPost {
  id: string;
  storeBrand: string;
  discountRate?: number; // 할인율(%) — opt.
  discountPrice?: number; // 할인가 — opt.
  listPrice?: number; // 정가(UGC) — opt. 작성자가 입력한 정가. 미입력 시 unverifiedBase 강제.
  unverifiedBase: boolean; // 서버 스탬프: 기준가(정가) 미확인 플래그.
  source: string; // 출처(작성자 입력 텍스트).
  photo?: string; // 사진 식별자(자사 저장, 외부 수집 아님). 외부 절대 URL 거부.
  createdAt: string; // ISO 시각.
  // ── 네이버쇼핑 참고가(외부 출처 스탬프, 불변식 ④) ──────────────────────────
  //   listPrice(UGC 정가)와 **별개 필드군**(출처·책임 귀속이 다름). 절대 섞지 않는다.
  //   여섯 필드는 all-or-nothing(기준: referenceBasePrice): 함께 존재하거나 함께 부재(폴백 시
  //   전부 undefined → 기존 unverifiedBase/기준가 미확인 라벨 유지). 부분 존재 금지.
  //   가격/식별자/출처/시각은 **서버 권위 스탬프** — 클라가 주입하지 못한다(검증 400).
  //   클라가 보내는 신규 입력은 referenceQuery(검색어) + referenceProductId(선택 상품) 둘뿐.
  //   두 가격 모두 외부 출처(네이버쇼핑) — 플랫폼 단정가(R5) 아님. "정가" 변수 0.
  referenceBasePrice?: number; // 대표(기본)가 = 사용자가 선택한 상품의 lprice(외부 출처).
  referenceLowestPrice?: number; // 온라인 최저가 = 잡템필터 후 결과 내 최저 lprice(외부 출처).
  referenceProductId?: string; // 선택 상품의 불투명 식별자(네이버 productId — 본문 아님).
  referenceSource?: string; // 항상 '네이버쇼핑'(외부 출처 라벨).
  referenceQuery?: string; // 사용자가 입력한 검색어.
  referenceFetchedAt?: string; // ISO 조회시각.
  // 매장/지역 앵커(선택) — 운영자 시드만 보유. 사용자 위치 추적 아님.
  lat?: number;
  lng?: number;
}

// UGC 쓰기용 저장 shape — 공개 DiscountPost 에 작성자/상태를 더한다.
//   authorId·status 는 응답에서 제거한다(toPublicDiscount). status 는 거버넌스 상태머신 라벨.
//   '정상' = 노출, '블라인드'/'삭제' = 목록 제외, '이의'/'복구' = 운영자 동선 라벨.
export interface StoredDiscountPost extends DiscountPost {
  authorId: string; // 작성자(JWT sub). 응답에는 절대 노출하지 않는다.
  status: '정상' | '블라인드' | '이의' | '복구' | '삭제';
}

// 작성 입력 — authorId/id/status/unverifiedBase/createdAt/좌표 는 서버가 결정(클라가 보내지 않는다).
//   referenceQuery(검색어) + referenceProductId(선택 상품) 둘만 신규 클라 입력이다.
//   가격 3종(referenceBasePrice/referenceLowestPrice + legacy referencePrice)/출처/시각은
//   서버 권위 스탬프라 입력에 없다(들어오면 검증에서 400 거부 — BANNED_REFERENCE_KEYS).
//   서버가 referenceProductId+referenceQuery 로 confirm 재조회 후 6필드를 스탬프한다.
export interface DiscountInput {
  storeBrand: string;
  discountRate?: number;
  discountPrice?: number;
  listPrice?: number; // UGC 정가(작성자 입력) — 네이버쇼핑 참고가와 별개.
  source: string;
  photo?: string;
  referenceQuery?: string; // 네이버쇼핑 검색어(선택).
  referenceProductId?: string; // 사용자가 고른 상품의 productId(선택). 서버가 confirm 으로 가격 확정.
}
