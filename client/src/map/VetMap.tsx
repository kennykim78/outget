// 병원 지도(스펙33 §4 VetMap · §6) — NaverMapShell 재작성. 네이버 지도 SDK 를 쓰는 유일한 컴포넌트(client/src/map/**).
//   - 상태(status)는 호출부(VetPage)가 useNaverMapLoader 로 넘긴다. 'ready' 가 아니면 빈 블록(aria-hidden, 글자·스피너 0).
//   - 위치 권한·현위치 조회 없음(D14·D52, 불변식 ⑧): 중심 = 병원 좌표 fitBounds, 좌표 있는 병원이 없으면 기본 중심 상수.
//   - 마커 = SDK 기본 마커 + title 병원명(색 지정 0). 마커 → onSelect(id). selectedId 바뀌면 그 병원으로 panTo.
//   - 좌표는 ws-data(병원 주소 좌표)만 — 어디에도 저장·전송하지 않는다.
import { useEffect, useRef } from 'react';
import type { PublicVet } from '@ws/engine';
import { copyAt } from '../ui/copyText';
import type { MapLoadStatus } from './useNaverMapLoader';

/** 좌표 있는 병원이 하나도 없을 때의 기본 중심(서울시청 부근 상수 — 사용자 위치 아님). */
export const DEFAULT_MAP_CENTER = { lat: 37.5665, lng: 126.978 } as const;
export const DEFAULT_MAP_ZOOM = 13;

export interface VetMapProps {
  vets: readonly PublicVet[];
  status: MapLoadStatus;
  selectedId: string | null;
  onSelect(id: string): void;
}

type Located = PublicVet & { lat: number; lng: number };
const located = (v: PublicVet): v is Located =>
  typeof v.lat === 'number' && typeof v.lng === 'number' && Number.isFinite(v.lat) && Number.isFinite(v.lng);

export default function VetMap({ vets, status, selectedId, onSelect }: VetMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<naver.maps.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // 지도 인스턴스: SDK 준비 후 1회.
  useEffect(() => {
    if (status !== 'ready') return;
    const sdk = window.naver?.maps;
    const el = containerRef.current;
    if (!sdk || !el) return;
    const map = new sdk.Map(el, {
      center: new sdk.LatLng(DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng),
      zoom: DEFAULT_MAP_ZOOM,
    });
    mapRef.current = map;
    return () => {
      map.destroy();
      mapRef.current = null;
    };
  }, [status]);

  // 마커·경계: 보이는 병원(필터 결과)이 바뀔 때마다 다시 단다.
  useEffect(() => {
    const sdk = window.naver?.maps;
    const map = mapRef.current;
    if (status !== 'ready' || !sdk || !map) return;
    const pts = vets.filter(located);
    const markers = pts.map((v) => {
      const m = new sdk.Marker({ position: new sdk.LatLng(v.lat, v.lng), map, title: v.name });
      const h = sdk.Event.addListener(m, 'click', () => onSelectRef.current(v.id));
      return { m, h };
    });
    if (pts.length === 1) map.setCenter(new sdk.LatLng(pts[0].lat, pts[0].lng));
    else if (pts.length > 1) {
      const first = new sdk.LatLng(pts[0].lat, pts[0].lng);
      const b = new sdk.LatLngBounds(first, first);
      for (const v of pts.slice(1)) b.extend(new sdk.LatLng(v.lat, v.lng));
      map.fitBounds(b);
    }
    return () => {
      for (const { m, h } of markers) {
        sdk.Event.removeListener(h);
        m.setMap(null);
      }
    };
  }, [status, vets]);

  // 카드 선택 → 그 병원으로 이동(좌표 없는 병원은 이동 없음).
  useEffect(() => {
    const sdk = window.naver?.maps;
    const map = mapRef.current;
    if (status !== 'ready' || !sdk || !map || selectedId === null) return;
    const v = vets.find((x) => x.id === selectedId);
    if (v && located(v)) map.panTo(new sdk.LatLng(v.lat, v.lng));
  }, [status, vets, selectedId]);

  if (status !== 'ready') return <div className="ws-vet-map" data-ws-map-state={status} aria-hidden="true" />;
  return <div ref={containerRef} className="ws-vet-map" data-ws-map-state="ready" role="region" aria-label={copyAt('vet.mapAria') ?? undefined} />;
}
