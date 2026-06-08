// 지도 셸(S1 기반). 모바일 뷰포트 전체 높이 지도 컨테이너.
// 로더(useNaverMapLoader) + 폴백 중심(useDefaultRegion)을 결합한다.
// 키가 없거나 로드 실패해도 앱이 죽지 않고 안내 메시지를 보여준다.
import { useEffect, useRef } from 'react';
import { useNaverMapLoader } from './useNaverMapLoader';
import {
  DEFAULT_MAP_ZOOM,
  useDefaultRegion,
} from './useDefaultRegion';
import './NaverMapShell.css';

export default function NaverMapShell() {
  const status = useNaverMapLoader();
  const region = useDefaultRegion();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<naver.maps.Map | null>(null);

  // 지도 인스턴스 생성/정리.
  useEffect(() => {
    if (status !== 'ready') return;
    const container = containerRef.current;
    const sdk = window.naver?.maps;
    if (!container || !sdk) return;

    const center = new sdk.LatLng(region.center.lat, region.center.lng);

    if (!mapRef.current) {
      mapRef.current = new sdk.Map(container, {
        center,
        zoom: DEFAULT_MAP_ZOOM,
      });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
    // 좌표 갱신은 아래 별도 effect 에서 처리(인스턴스 재생성 방지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // 현위치 도착 등으로 중심이 갱신되면 기존 인스턴스 center 만 옮긴다.
  useEffect(() => {
    const sdk = window.naver?.maps;
    if (status !== 'ready' || !mapRef.current || !sdk) return;
    mapRef.current.setCenter(
      new sdk.LatLng(region.center.lat, region.center.lng),
    );
  }, [status, region.center.lat, region.center.lng]);

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-canvas" aria-label="지도" />

      {status === 'loading' && (
        <div className="map-overlay" role="status" aria-live="polite">
          <div className="map-spinner" aria-hidden="true" />
          <p>지도를 불러오는 중…</p>
        </div>
      )}

      {status === 'no-key' && (
        <div className="map-overlay map-overlay--notice" role="status">
          <p className="map-notice-title">지도 키가 설정되지 않았습니다</p>
          <p className="map-notice-body">
            VITE_NAVER_MAP_CLIENT_ID 환경변수를 설정하면 지도가 표시됩니다.
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="map-overlay map-overlay--notice" role="alert">
          <p className="map-notice-title">지도를 불러오지 못했습니다</p>
          <p className="map-notice-body">
            네트워크 또는 지도 키 설정을 확인한 뒤 다시 시도해 주세요.
          </p>
        </div>
      )}
    </div>
  );
}
