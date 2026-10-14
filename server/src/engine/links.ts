// 외부 웹 딥링크(불변식 ① — 링크만, 수집·SDK 아님). compliance C1-SDK 가 지도 호스트 문자열을 허용하는 유일한 엔진 파일.
//   사용자 좌표 0: 검색어는 병원명 + 주소(시드 텍스트)뿐, 출발지는 지도 쪽에서 사용자가 정한다(불변식 ⑧).

const NAVER_MAP_SEARCH = 'https://map.naver.com/p/search/';

/** 네이버 지도 웹 검색 URL. query 전체를 한 경로 세그먼트로 인코딩(공백·'/'·'?'·'#' 포함). */
export function naverMapSearchUrl(query: string): string {
  return NAVER_MAP_SEARCH + encodeURIComponent(query);
}
