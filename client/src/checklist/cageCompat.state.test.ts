// useCageCompatState — 케이지 있는데 카탈로그 로드 중·실패는 pending(문제 없음 아님), 케이지 없음은 영향 0.
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CageV1 } from '../context/cageStore';

const load = vi.hoisted(() => vi.fn());
vi.mock('../speccheck/engine', () => ({ loadSpecCatalog: load }));

import { COMPAT_RETRY_MS, toDeriveOptions, useCageCompatState } from './cageCompat';

const CAGE: CageV1 = { v: 1, type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: '2026-10-01T00:00:00.000Z' };

describe('useCageCompatState', () => {
  it('케이지 없음 → pending false, 옵션 없음', () => {
    const { result } = renderHook(() => useCageCompatState('t', [], '/c', null));
    expect(result.current).toEqual({ compat: undefined, pending: false });
    expect(toDeriveOptions(result.current)).toBeUndefined();
  });

  it('케이지 있음 + 카탈로그 로드 실패 → 계속 pending(compatPending 옵션)', async () => {
    load.mockRejectedValueOnce(new Error('net'));
    const { result, unmount } = renderHook(() => useCageCompatState('t', [], '/c', CAGE));
    expect(result.current.pending).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.pending).toBe(true);
    expect(toDeriveOptions(result.current)).toEqual({ compatPending: true });
    unmount(); // 예약된 자동 재요청 타이머 정리
  });

  it('로드 실패 → COMPAT_RETRY_MS 뒤 1회 자동 재요청, 성공하면 pending 해제(재실패는 더 부르지 않음)', async () => {
    vi.useFakeTimers();
    try {
      load.mockClear();
      load.mockRejectedValueOnce(new Error('net'));
      load.mockResolvedValueOnce({ engine: { requirementCompat: () => ({ verdict: 'OK' }) } });
      const { result, unmount } = renderHook(() => useCageCompatState('t', [], '/c', CAGE));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COMPAT_RETRY_MS - 1);
      });
      expect(load).toHaveBeenCalledTimes(1);
      expect(result.current.pending).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(load).toHaveBeenCalledTimes(2);
      expect(result.current.pending).toBe(false);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('케이지 있음 + 로드 성공 → pending 해제, compat 맵', async () => {
    load.mockResolvedValueOnce({ engine: { requirementCompat: () => ({ verdict: 'OK' }) } });
    const { result } = renderHook(() => useCageCompatState('t', [], '/c', CAGE));
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.compat).toEqual({});
  });
});
