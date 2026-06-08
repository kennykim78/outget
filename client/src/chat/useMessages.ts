// 매칭 채팅 메시지 훅 — 신규 라이브러리 0(실시간 라이브러리 금지, 폴링은 setInterval).
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/matches/:id/messages`)만 호출한다.
//     외부 절대 URL(http(s)://...)은 절대 구성/호출하지 않는다(폴링 포함).
//   - ②: 전송 본문은 { body } 텍스트뿐 — 결제·금액·정산 필드 없음.
//   - 본문 길이상한 2000(서버 미러) — 초과는 보내지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../auth/apiFetch';
import type { MessageInput, StoredMessage } from './chat.types';

// 본문 길이상한(서버 validation 미러).
export const MESSAGE_MAX_LENGTH = 2000;

// 폴링 주기(ms). 실시간 라이브러리 대신 단순 폴링.
const POLL_INTERVAL_MS = 4000;

export type MessagesStatus = 'loading' | 'error' | 'ready';

export interface UseMessagesResult {
  status: MessagesStatus;
  data: StoredMessage[];
  error: string | null;
  /** 메시지 전송(POST). 성공 시 즉시 재조회. */
  send: (body: string) => Promise<void>;
  /** 수동 재조회. */
  reload: () => void;
}

// 자사 API 상대 경로 빌더(절대 URL 금지) — matchId 만 받는다.
function messagesPath(matchId: string): string {
  return `/api/matches/${encodeURIComponent(matchId)}/messages`;
}

export function useMessages(matchId: string): UseMessagesResult {
  const [status, setStatus] = useState<MessagesStatus>('loading');
  const [data, setData] = useState<StoredMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 폴링 중 latest matchId 참조용(매칭 전환 시 stale 호출 차단).
  const matchIdRef = useRef(matchId);
  matchIdRef.current = matchId;
  // 인증 최종 실패(401) 시 폴링 정지 신호 — useEffect 가 interval 을 멈춘다.
  const authFailedRef = useRef(false);

  const fetchOnce = useCallback(async (signalMatchId: string) => {
    try {
      const res = await apiFetch(messagesPath(signalMatchId));
      // 401: apiFetch 가 refresh→재시도까지 마친 뒤의 최종 실패. 폴링 가드를 세워
      // 인증 실패 상태의 요청 폭주를 막는다.
      if (res.status === 401) {
        authFailedRef.current = true;
        if (matchIdRef.current !== signalMatchId) return;
        setError('로그인이 필요합니다.');
        setStatus((s) => (s === 'ready' ? s : 'error'));
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: unknown = await res.json();
      // 폴링 응답이 도착했는데 그 사이 matchId 가 바뀌었으면 무시.
      if (matchIdRef.current !== signalMatchId) return;
      const arr = Array.isArray(json) ? (json as StoredMessage[]) : [];
      setData(arr);
      setError(null);
      setStatus('ready');
    } catch (e: unknown) {
      if (matchIdRef.current !== signalMatchId) return;
      setError(
        e instanceof Error ? e.message : '메시지를 불러오지 못했습니다.',
      );
      setStatus((s) => (s === 'ready' ? s : 'error'));
    }
  }, []);

  // 최초 로드 + 폴링(setInterval). 매칭 전환 시 정리. 인증 실패 시 폴링 정지.
  useEffect(() => {
    authFailedRef.current = false;
    setStatus('loading');
    setData([]);
    setError(null);
    void fetchOnce(matchId);
    const timer = setInterval(() => {
      if (authFailedRef.current) {
        clearInterval(timer);
        return;
      }
      void fetchOnce(matchId);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [matchId, fetchOnce]);

  const send = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (trimmed.length === 0) return;
      // 길이상한 가드(서버 미러) — 초과는 보내지 않는다.
      if (trimmed.length > MESSAGE_MAX_LENGTH) {
        setError(`메시지는 ${MESSAGE_MAX_LENGTH}자 이내로 입력해 주세요.`);
        throw new Error('too long');
      }
      const payload: MessageInput = { body: trimmed };
      const res = await apiFetch(messagesPath(matchId), {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const msg = `HTTP ${res.status}`;
        setError(msg);
        throw new Error(msg);
      }
      // 전송 직후 즉시 재조회(폴링 주기 기다리지 않음).
      await fetchOnce(matchId);
    },
    [matchId, fetchOnce],
  );

  return {
    status,
    data,
    error,
    send,
    reload: () => void fetchOnce(matchId),
  };
}
