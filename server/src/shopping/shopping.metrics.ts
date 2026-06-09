// 네이버쇼핑 외부 호출 메트릭 — 인메모리 카운터(영속 0, 외부 호출 0).
//
// 목적(silent degradation 가시화): naver.shopping.adapter 가 모든 실패를 graceful 폴백(null/[])으로
//   삼키므로 운영 중 네이버 429/쿼터/키오류/타임아웃이 보이지 않는다. 이 카운터가 그 실패를
//   집계해 운영자 전용 읽기 엔드포인트로 노출한다(GET /api/shopping/metrics).
//
// 보안(★): 카운터는 **숫자뿐**이다. clientId/clientSecret/응답본문/검색어/URL/키를 절대 담지 않는다.
//   불변식 ①: 외부 본문/시크릿 영속·노출 0. 메트릭은 무차원 카운트만.
// 프로세스 수명 한정(재시작 시 리셋). 멀티프로세스 합산 미지원(MVP — 단일 인스턴스).

export interface ShoppingMetrics {
  searchCalls: number; // search() 진입 횟수.
  searchFails: number; // search() 가 외부 실패로 빈배열 폴백한 횟수.
  confirmCalls: number; // confirm() 진입 횟수.
  confirmNullMatch: number; // confirm() 에서 productId 미매칭으로 null 폴백한 횟수.
  externalFails: number; // fetchItems 외부 실패(non-200·네트워크·타임아웃·파싱) 총횟수.
  cacheHits: number; // 단기 캐시 적중(외부 호출 0)으로 처리된 횟수.
}

export type ShoppingMetricKey = keyof ShoppingMetrics;

const counters: ShoppingMetrics = {
  searchCalls: 0,
  searchFails: 0,
  confirmCalls: 0,
  confirmNullMatch: 0,
  externalFails: 0,
  cacheHits: 0,
};

// 카운터 1 증가. 키는 ShoppingMetrics 의 필드명으로 컴파일타임 제한(임의 문자열 불가).
export function increment(key: ShoppingMetricKey): void {
  counters[key] += 1;
}

// 현재 스냅샷(읽기). 호출자가 변형하지 못하도록 얕은 복사본을 반환한다.
export function snapshot(): ShoppingMetrics {
  return { ...counters };
}

// 테스트 전용 리셋 — 모든 카운터를 0 으로.
export function reset(): void {
  counters.searchCalls = 0;
  counters.searchFails = 0;
  counters.confirmCalls = 0;
  counters.confirmNullMatch = 0;
  counters.externalFails = 0;
  counters.cacheHits = 0;
}
