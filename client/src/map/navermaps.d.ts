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
      destroy(): void;
    }
  }

  interface Window {
    naver?: {
      maps?: typeof naver.maps;
    };
  }
}
