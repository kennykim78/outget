// Epic 2 클라 보드 계약 타입 — 서버 listings.types.ts 와 동일 shape 미러.
// 서버 트랙이 권위 소스이며 여기는 미러(병렬 진행). shape 변경 시 양쪽 동기.
//
// 불변식 메모:
//  - DiscountPost 는 미검증 UGC 제보다. listPrice(정가)가 없으면 unverifiedBase=true 로
//    `[기준가 미확인·사용자 제보가]` 라벨이 강제된다(R5/④).
//  - 플랫폼이 산정한 단정가(예: 플랫폼가/우리가/공식가) 류 변수는 금지(R5).
//  - lat/lng 는 지도 렌더·클라 거리계산 전용. 네트워크 전송 금지(R3/⑤).

/** 레이어 토글 종류: 대행자 / 구매자 요청 / 할인소식. */
export type LayerKind = 'agents' | 'requests' | 'discounts';

/** 대행자 지위 — 개인 / 전문(사업자). */
export type AgentStatus = '개인' | '전문';

/** 대행자 프로필(S3). 전문이면 상호/사업자번호 표시. */
export interface AgentProfile {
  id: string;
  status: AgentStatus;
  /** 전문(사업자)일 때 상호. */
  bizName?: string;
  /** 전문(사업자)일 때 사업자번호. */
  bizNo?: string;
  /** 연락/채팅 진입 식별(표시·라우팅용, 실시간 위치 아님). */
  contact?: string;
  activeRegion: string;
  scheduleText: string;
  reputation: number;
  /**
   * 평판 뱃지 목록(예: '확인러'). 무금전 신뢰 시그널(Epic8/9).
   * 서버 권위 — 표시 전용. 금액 의미 없음(②).
   */
  badges?: string[];
  lat: number;
  lng: number;
}

/** 역경매 구매자 요청(S4). 언제까지/무엇/얼마(대행료 포함). */
export interface RequestItem {
  id: string;
  item: string;
  options?: string;
  /** 희망가(대행료 포함). 표시 전용 — 플랫폼 산정가가 아님. */
  hopePrice: number;
  deadline: string;
  region: string;
  status: string;
  /**
   * 대행자 제시 확인가(있을 때만, Epic4). agentId·verifiedAt 동반(대행자 책임).
   * 플랫폼 단정가가 아니다(R5 — platform/our/official 류 변수 금지).
   */
  verifiedPrice?: {
    price: number;
    agentId: string;
    verifiedAt: string;
    note?: string;
  };
}

/** 할인소식 UGC 제보(S6 표시). 미검증·기준가 미확인 강제. */
export interface DiscountPost {
  id: string;
  storeBrand: string;
  /** 할인율(%) — Optional. */
  discountRate?: number;
  /** 할인가 — Optional. 사용자 제보가이며 플랫폼 단정가 아님. */
  discountPrice?: number;
  /** 정가(listPrice) — Optional. 사용자가 폼에 입력한 UGC 정가다(네이버쇼핑 참고가와 별개). */
  listPrice?: number;
  /** 정가 미확인 여부. true면 `[기준가 미확인·사용자 제보가]` 라벨 강제. */
  unverifiedBase: boolean;
  // ── 네이버쇼핑 참고가 6필드 — 서버 listings.types.ts 미러(권위는 서버) ──
  //  - 외부 출처(네이버쇼핑) 참고가. 플랫폼이 매긴 단정가 아님(④/R5).
  //  - all-or-nothing 판정 기준은 referenceBasePrice 존재(있으면 6필드 함께 존재).
  //  - 전부 서버가 조회(confirm 재조회) 후 스탬프한다 — 클라가 절대 주입하지 않는다.
  //    클라가 보내는 입력은 DiscountInput.referenceQuery + referenceProductId 둘뿐.
  //  - listPrice(사용자 UGC 정가)와 별개 — 섞지 않는다. "정가" 표현 금지.
  /** 대표가(원) — 사용자가 검색결과에서 고른 상품의 최저가. 서버 스탬프. */
  referenceBasePrice?: number;
  /** 온라인 최저가(원) — 같은 검색결과 내 잡템 제외 최저가. 서버 스탬프. */
  referenceLowestPrice?: number;
  /** 선택 상품 식별자(불투명) — 외부 본문 아님. 서버 스탬프. */
  referenceProductId?: string;
  /** 참고가 출처 — 고정값 '네이버쇼핑'. 서버 스탬프. */
  referenceSource?: string;
  /** 참고가 조회에 사용한 검색어(사용자 입력). 서버 스탬프(에코). */
  referenceQuery?: string;
  /** 참고가 조회 시각(ISO). 서버 스탬프. */
  referenceFetchedAt?: string;
  /** 출처 표기(미검증 제보). */
  source: string;
  /** 직접 촬영분만 안내 — 표시 전용 URL(외부 본문 수집 아님). */
  photo?: string;
  createdAt: string;
  /**
   * 좌표 — 옵셔널(시드만 보유). 사용자 등록분은 좌표 없이 리스트로 표시(요청 레이어 선례).
   * 지도 렌더·클라 거리계산 전용 — 네트워크 전송 금지(R3/⑤).
   */
  lat?: number;
  lng?: number;
}

/** 레이어별 데이터 union. */
export type LayerItem = AgentProfile | RequestItem | DiscountPost;

/** 지도 핀 좌표를 가진 항목(agents/discounts). requests 는 좌표가 없을 수 있어 별도 취급. */
export interface GeoPin {
  id: string;
  lat: number;
  lng: number;
}
