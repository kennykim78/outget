// 지도 마커 레이어. 주어진 map 인스턴스에 핀/클러스터 마커를 부착/정리한다.
// - 외부 라이브러리 0(naver.maps SDK + 자체 cluster.ts 만 사용).
// - 좌표는 props 로 받은 클라 메모리 데이터 — 네트워크 전송 없음(R3).
// - 마커 클릭 시 onSelect(클러스터 노드)로 상위에 알린다(바텀시트 오픈).
import { useEffect, useRef } from 'react';
import type { GeoPin } from './board.types';
import { clusterPins, type ClusterNode } from './cluster';

interface MapMarkersProps<T extends GeoPin> {
  map: naver.maps.Map | null;
  pins: readonly T[];
  /** 클러스터/단일 핀 클릭 콜백. */
  onSelect: (node: ClusterNode<T>) => void;
}

export default function MapMarkers<T extends GeoPin>({
  map,
  pins,
  onSelect,
}: MapMarkersProps<T>) {
  const markersRef = useRef<naver.maps.Marker[]>([]);
  const listenersRef = useRef<naver.maps.EventListener[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const sdk = window.naver?.maps;
    if (!map || !sdk) return;

    // 기존 마커/리스너 정리.
    const clearAll = () => {
      for (const l of listenersRef.current) sdk.Event.removeListener(l);
      for (const m of markersRef.current) m.setMap(null);
      listenersRef.current = [];
      markersRef.current = [];
    };
    clearAll();

    const zoom = map.getZoom();
    const nodes = clusterPins(pins, zoom);

    for (const node of nodes) {
      const isCluster = node.count > 1;
      const marker = new sdk.Marker({
        position: new sdk.LatLng(node.lat, node.lng),
        map,
        // 클러스터/단일 핀 구분(텍스트 라벨 병행 — 색 단독 의존 금지).
        icon: {
          content: isCluster
            ? `<div class="pin pin--cluster" aria-label="${node.count}개 묶음">${node.count}</div>`
            : `<div class="pin pin--single" aria-label="핀">•</div>`,
        },
      });
      const listener = sdk.Event.addListener(marker, 'click', () => {
        onSelectRef.current(node);
      });
      markersRef.current.push(marker);
      listenersRef.current.push(listener);
    }

    return clearAll;
  }, [map, pins]);

  return null;
}
