// SEC-3 I-1: 지도 SDK <script> 는 referrerpolicy="origin" — 전역 Referrer-Policy no-referrer 아래에서도 NCP 도메인 인증이 되게(경로·쿼리 0).
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNaverMapLoader } from './useNaverMapLoader';

afterEach(() => {
  document.getElementById('naver-maps-sdk')?.remove();
  vi.unstubAllEnvs();
});

describe('useNaverMapLoader', () => {
  it('키 있음 → SDK script 1개, referrerPolicy = origin', () => {
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'k');
    renderHook(() => useNaverMapLoader());
    const s = document.getElementById('naver-maps-sdk') as HTMLScriptElement;
    expect(s).not.toBeNull();
    // 속성(attribute)으로 단언 — 브라우저는 IDL referrerPolicy 로 반영한다(jsdom 은 IDL 미구현).
    expect(s.getAttribute('referrerpolicy')).toBe('origin');
  });

  it('키 없음 → script 0', () => {
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', '');
    renderHook(() => useNaverMapLoader());
    expect(document.getElementById('naver-maps-sdk')).toBeNull();
  });
});
