// 인앱 알림 폴링 훅 — 신규 라이브러리 0.
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/notifications`)만 폴링한다. 외부 fetch 0.
//     setInterval 폴링이지만 대상은 자사 /api 뿐(외부 절대 URL 구성·호출 없음).
//   - ⑤/R3: 알림 응답에 좌표 필드 없음. 좌표 전송 경로 없음.
import { useEffect, useState } from 'react';
import type { Notification } from './request.types';

// 자사 API 상대 경로(절대 URL 금지).
const NOTIFICATIONS_PATH = '/api/notifications';

// 폴링 주기(ms). 채택/확인가/거절 알림 수신용.
const POLL_MS = 15000;

export interface UseNotificationsResult {
  items: Notification[];
  error: string | null;
  /** 즉시 재조회(폴링과 별개로 수동 갱신). */
  reload: () => void;
}

export function useNotifications(): UseNotificationsResult {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // 자사 상대경로 단발 조회. 외부 URL 구성 없음(①).
    const fetchOnce = () => {
      fetch(NOTIFICATIONS_PATH, { headers: { Accept: 'application/json' } })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((json: unknown) => {
          if (cancelled) return;
          const arr = Array.isArray(json) ? (json as Notification[]) : [];
          setItems(arr);
          setError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError(
            e instanceof Error ? e.message : '알림을 불러오지 못했습니다.',
          );
        });
    };

    fetchOnce();
    const timer = setInterval(fetchOnce, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [nonce]);

  return {
    items,
    error,
    reload: () => setNonce((n) => n + 1),
  };
}
