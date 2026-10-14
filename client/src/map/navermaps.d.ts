// 네이버 지도 JS v3 최소 타입 선언.
// @types/navermaps npm 패키지를 설치하지 않기 위한 로컬 앰비언트 선언(필요 표면만).
// SDK는 CDN 스크립트로 동적 주입되며 전역 `window.naver.maps` 로 노출된다.

export {};

declare global {
  namespace naver.maps {
    class LatLng {
      constructor(lat: number, lng: number);
      lat(): number;
      lng(): number;
    }

    interface MapOptions {
      center: LatLng;
      zoom?: number;
      minZoom?: number;
      maxZoom?: number;
      [key: string]: unknown;
    }

    class Map {
      constructor(element: string | HTMLElement, options: MapOptions);
      setCenter(center: LatLng): void;
      setZoom(zoom: number): void;
      getZoom(): number;
      getBounds(): LatLngBounds;
      panTo(center: LatLng): void;
      fitBounds(bounds: LatLngBounds): void;
      destroy(): void;
    }

    // 마커 — 핀/클러스터 렌더에 사용. 필요 표면만 선언.
    interface MarkerOptions {
      position: LatLng;
      map?: Map;
      title?: string;
      icon?: string | { content: string; [key: string]: unknown };
      zIndex?: number;
      [key: string]: unknown;
    }

    class Marker {
      constructor(options: MarkerOptions);
      setMap(map: Map | null): void;
      getPosition(): LatLng;
      setPosition(position: LatLng): void;
    }

    // 지도 가시 영역(클러스터 컬링 등에 사용).
    class LatLngBounds {
      constructor(sw: LatLng, ne: LatLng);
      extend(latlng: LatLng): LatLngBounds;
      hasLatLng(latlng: LatLng): boolean;
      getMin(): LatLng;
      getMax(): LatLng;
    }

    // 이벤트 구독/해제 — 마커 클릭 등. 반환 핸들로 removeListener.
    type EventListener = unknown;
    namespace Event {
      function addListener(
        target: unknown,
        eventName: string,
        listener: (...args: unknown[]) => void,
      ): EventListener;
      function removeListener(listener: EventListener): void;
    }
  }

  interface Window {
    naver?: {
      maps?: typeof naver.maps;
    };
  }
}
