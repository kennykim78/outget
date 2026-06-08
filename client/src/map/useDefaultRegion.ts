// 기본 지도 중심좌표 결정 훅.
// 불변식 ⑤(위치 비실시간·서버 미저장):
//   - 사용자의 위경도는 navigator.geolocation 으로 일회성 조회만 한다(실시간 GPS 공유 없음).
//   - 조회된 좌표는 오직 클라이언트 상태/지도 렌더에만 쓰인다.
//   - 어떤 fetch/POST/axios/WebSocket 으로도 좌표를 서버에 전송하거나 저장하지 않는다(R3).
//   - 권한 거부·미지원·실패 시 앵커 동(지역) 기본 중심좌표 상수로 폴백한다.
import { useEffect, useRef, useState } from 'react';

export interface RegionCenter {
  lat: number;
  lng: number;
}

export type RegionSource = 'fallback' | 'geolocation';

export interface DefaultRegion {
  center: RegionCenter;
  source: RegionSource;
  /** 위치 조회가 진행 중인지(폴백을 먼저 보여주고 좌표 도착 시 갱신). */
  resolving: boolean;
}

// 앵커 동(지역) 기본 중심좌표 — placeholder.
// 여주시 중심 부근(여주 종합운동장 인근) 좌표. 앵커 확정 시 수정.
export const DEFAULT_REGION_CENTER: RegionCenter = {
  lat: 37.298,
  lng: 127.637,
};

export const DEFAULT_MAP_ZOOM = 13;

interface UseDefaultRegionOptions {
  /** 현위치 조회 시도 여부. 기본 true. false면 폴백 상수만 사용. */
  tryGeolocation?: boolean;
  timeoutMs?: number;
}

/**
 * 폴백 동 중심을 즉시 반환하고, 가능하면 현위치로 비차단 갱신한다.
 * 좌표는 절대 서버로 전송되지 않는다(클라 상태 전용).
 */
export function useDefaultRegion(
  options: UseDefaultRegionOptions = {},
): DefaultRegion {
  const { tryGeolocation = true, timeoutMs = 8000 } = options;

  const [region, setRegion] = useState<DefaultRegion>({
    center: DEFAULT_REGION_CENTER,
    source: 'fallback',
    resolving: tryGeolocation,
  });
  const settledRef = useRef(false);

  useEffect(() => {
    if (!tryGeolocation) {
      setRegion((r) => ({ ...r, resolving: false }));
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      // 미지원 → 폴백 유지.
      setRegion((r) => ({ ...r, resolving: false }));
      return;
    }

    let cancelled = false;
    settledRef.current = false;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled || settledRef.current) return;
        settledRef.current = true;
        // 좌표는 여기서 로컬 상태로만 보관 — 네트워크 전송 없음.
        setRegion({
          center: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          source: 'geolocation',
          resolving: false,
        });
      },
      () => {
        // 권한 거부/오류 → 폴백 유지.
        if (cancelled || settledRef.current) return;
        settledRef.current = true;
        setRegion((r) => ({ ...r, resolving: false }));
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );

    return () => {
      cancelled = true;
    };
  }, [tryGeolocation, timeoutMs]);

  return region;
}
