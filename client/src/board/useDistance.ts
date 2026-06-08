// 현위치 ↔ 핀 거리 계산(Haversine). 클라 전용 — 좌표 네트워크 전송 0.
// 불변식 ⑤/R3:
//   - 중심 좌표는 useDefaultRegion(클라 일회성 geolocation, 전송 없음)에서 받는다.
//   - 핀 좌표는 이미 클라 메모리에 있는 목록 데이터.
//   - 이 모듈은 어떤 fetch/POST/sendBeacon/WebSocket 으로도 좌표를 보내지 않는다.
//   - 권한 거부(=geolocation 폴백) 시에도 폴백 중심 기준 거리를 계산할 수 있으나,
//     "실제 현위치 미확보" 상태는 호출부가 source 로 판단해 null 처리할 수 있다.
import { useCallback } from 'react';
import {
  useDefaultRegion,
  type RegionSource,
} from '../map/useDefaultRegion';

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 두 좌표 간 대원거리(미터). 순수함수. */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 거리(미터)를 사람이 읽는 한국어 라벨로. */
export function formatDistance(meters: number | null): string | null {
  if (meters === null || !Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)}km`;
}

export interface UseDistanceResult {
  /** 핀까지 거리(미터) 계산. 현위치 미확보(권한거부) 시 null. */
  distanceTo: (lat: number, lng: number) => number | null;
  /** 거리 라벨("1.2km" 등). 미확보 시 null. */
  labelTo: (lat: number, lng: number) => string | null;
  /** 중심 좌표 출처('geolocation' | 'fallback'). */
  source: RegionSource;
  resolving: boolean;
}

/**
 * useDefaultRegion 중심을 기준으로 핀까지 거리를 계산하는 훅.
 * 권한 거부(source==='fallback')면 "실제 현위치 거리"가 아니므로 null 을 반환한다
 * (UX-기획: 실시간 GPS 공유 없음 + 권한거부 시 거리 미표시).
 */
export function useDistance(): UseDistanceResult {
  const region = useDefaultRegion();

  const distanceTo = useCallback(
    (lat: number, lng: number): number | null => {
      // 현위치를 실제로 확보하지 못했으면(권한 거부/미지원 폴백) 거리 null.
      if (region.source !== 'geolocation') return null;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return haversineMeters(
        region.center.lat,
        region.center.lng,
        lat,
        lng,
      );
    },
    [region.source, region.center.lat, region.center.lng],
  );

  const labelTo = useCallback(
    (lat: number, lng: number) => formatDistance(distanceTo(lat, lng)),
    [distanceTo],
  );

  return {
    distanceTo,
    labelTo,
    source: region.source,
    resolving: region.resolving,
  };
}
