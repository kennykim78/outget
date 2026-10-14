// 네이버 지도 JS v3 SDK 동적 로더 — /vet 페이지(VetPage)에서만 호출된다(스펙33 §6, CSP 는 /vet 경로에만 SDK 호스트).
// 불변식 ①(무크롤링): 이 훅은 네이버 지도 SDK 스크립트만 주입한다 —
//   외부 사이트 본문/이미지를 가져오는 코드는 없다(허용된 지도 도메인 한정).
// 키는 import.meta.env.VITE_NAVER_MAP_CLIENT_ID(env 전용) — 하드코딩 금지.
import { useEffect, useState } from 'react';

export type MapLoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'no-key';

// 네이버 클라우드 플랫폼(NCP) Maps v3 엔드포인트.
// ncpKeyId 쿼리에 발급 키를 붙여 동적 주입한다.
// (NCP 신버전 인증 — 구버전 ncpClientId 는 "인증 실패 200"으로 거부됨.)
const NAVER_MAPS_SRC =
  'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=';

// 중복 주입 방지를 위한 스크립트 식별자.
const SCRIPT_ID = 'naver-maps-sdk';

/** 빌드에 지도 키가 있는가(값은 노출하지 않는다). 없으면 /vet 은 목록 전용 — 지도 DOM·안내 문구 0. */
export function hasMapKey(): boolean {
  const k = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;
  return typeof k === 'string' && k.trim() !== '';
}

function isSdkReady(): boolean {
  return typeof window !== 'undefined' && !!window.naver?.maps;
}

/**
 * 네이버 지도 SDK를 동적으로 로드하고 상태를 반환한다.
 * - 키 미설정 → 'no-key'(스크립트 주입 0, 호출부는 목록 전용 — 안내 문구 없음)
 * - 이미 로드됨 → 'ready' 재사용(중복 주입 안 함)
 */
export function useNaverMapLoader(enabled = true): MapLoadStatus {
  const clientId = enabled && hasMapKey() ? (import.meta.env.VITE_NAVER_MAP_CLIENT_ID as string).trim() : undefined;
  const [status, setStatus] = useState<MapLoadStatus>(() => {
    if (!clientId) return 'no-key';
    if (isSdkReady()) return 'ready';
    return 'idle';
  });

  useEffect(() => {
    // 키 없음 또는 이미 준비됨이면 아무것도 하지 않는다.
    if (!clientId) {
      setStatus('no-key');
      return;
    }
    if (isSdkReady()) {
      setStatus('ready');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    const existing = document.getElementById(SCRIPT_ID) as
      | HTMLScriptElement
      | null;

    const handleReady = () => {
      if (cancelled) return;
      // 스크립트 onload 이후에도 naver.maps 가 준비됐는지 확인.
      setStatus(isSdkReady() ? 'ready' : 'error');
    };
    const handleError = () => {
      if (cancelled) return;
      setStatus('error');
    };

    if (existing) {
      // 다른 마운트가 이미 주입 중 — 같은 스크립트 이벤트를 구독해 재사용.
      if (isSdkReady()) {
        setStatus('ready');
      } else {
        existing.addEventListener('load', handleReady);
        existing.addEventListener('error', handleError);
      }
      return () => {
        cancelled = true;
        existing.removeEventListener('load', handleReady);
        existing.removeEventListener('error', handleError);
      };
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.setAttribute('referrerpolicy', 'origin'); // SEC-3 I-1: 전역 no-referrer 여도 NCP 도메인 인증용 출처만(경로·쿼리 0) 보낸다.
    script.src = NAVER_MAPS_SRC + encodeURIComponent(clientId);
    script.addEventListener('load', handleReady);
    script.addEventListener('error', handleError);
    // SDK 인증 실패(키·도메인 미등록)는 load 뒤 전역 콜백으로 온다 → 목록 전용 폴백.
    (window as unknown as { navermap_authFailure?: () => void }).navermap_authFailure = handleError;
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      script.removeEventListener('load', handleReady);
      script.removeEventListener('error', handleError);
      // 스크립트 자체는 제거하지 않는다(전역 SDK 재사용 — 중복 주입 방지).
    };
  }, [clientId]);

  return status;
}
