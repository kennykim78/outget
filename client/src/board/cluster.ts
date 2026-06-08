// 격자(grid) 클러스터링 — 외부 라이브러리 0, 순수함수.
// 화면 줌 레벨에 따라 위경도 격자 셀 크기를 키워 같은 셀의 핀을 하나로 묶는다.
// 좌표는 입력 인자로만 받고 어떤 네트워크 호출도 하지 않는다(R3 무관: 전송 없음).

import type { GeoPin } from './board.types';

/** 클러스터링 결과 노드: 단일 핀이거나(count=1) 묶음(count>1). */
export interface ClusterNode<T extends GeoPin = GeoPin> {
  /** 클러스터 대표 좌표(셀 내부 평균). */
  lat: number;
  lng: number;
  /** 묶인 항목 수. */
  count: number;
  /** 묶인 원본 항목들. */
  items: T[];
  /** 격자 셀 키(디버그/리렌더 키). */
  key: string;
}

// 줌→셀 크기(도, degree) 매핑. 줌이 클수록(확대) 셀을 잘게 → 덜 묶임.
// 네이버 지도 줌 범위 대략 6~21. 경험적 값(런타임 튜닝 여지).
function cellSizeForZoom(zoom: number): number {
  // 줌 21 ≈ 0.0005°(약 50m), 줌 6 ≈ 1.0°. 지수적으로 보간.
  const z = Math.max(6, Math.min(21, zoom));
  // 줌 1 증가마다 셀 절반.
  const base = 4.0; // 줌 6 기준 셀(도).
  return base / Math.pow(2, z - 6);
}

/**
 * 격자 클러스터링. 같은 셀에 떨어진 핀들을 하나의 ClusterNode 로 묶는다.
 * - 순수함수: 입력 배열을 변형하지 않는다.
 * - 외부 의존성 0.
 * - 동일 좌표·동일 줌이면 항상 같은 결과(결정적).
 */
export function clusterPins<T extends GeoPin>(
  pins: readonly T[],
  zoom: number,
): ClusterNode<T>[] {
  const size = cellSizeForZoom(zoom);
  if (!Number.isFinite(size) || size <= 0) {
    // 방어: 비정상 셀 크기면 모든 핀을 개별 노드로.
    return pins.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      count: 1,
      items: [p],
      key: `solo:${p.id}`,
    }));
  }

  const buckets = new Map<string, T[]>();
  for (const p of pins) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const gx = Math.floor(p.lng / size);
    const gy = Math.floor(p.lat / size);
    const key = `${gx}:${gy}`;
    const arr = buckets.get(key);
    if (arr) arr.push(p);
    else buckets.set(key, [p]);
  }

  const nodes: ClusterNode<T>[] = [];
  for (const [key, items] of buckets) {
    let sumLat = 0;
    let sumLng = 0;
    for (const it of items) {
      sumLat += it.lat;
      sumLng += it.lng;
    }
    nodes.push({
      lat: sumLat / items.length,
      lng: sumLng / items.length,
      count: items.length,
      items,
      key,
    });
  }
  return nodes;
}
