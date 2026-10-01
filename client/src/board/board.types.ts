// 지도 핀 공통 타입 — 병원 지도(§7.1 재사용)에서 클러스터링·거리 계산에 쓴다.
// 불변식 ⑧: lat/lng 는 지도 렌더·클라 거리계산 전용. 네트워크 전송·저장 금지.

/** 지도 핀 좌표를 가진 항목. */
export interface GeoPin {
  id: string;
  lat: number;
  lng: number;
}
