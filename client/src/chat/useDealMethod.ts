// 거래방식 선택 훅 — 신규 라이브러리 0.
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/matches/:id/deal-method`·`/payment-guidance`)만.
//     외부 절대 URL(http(s)://...)은 절대 구성/호출하지 않는다.
//   - ②: 거래방식은 '직접'|'안전결제' 라벨 전송뿐 — 결제·금액·정산 필드 없음.
//     payment-guidance 는 안내 텍스트(mode:'안내')만 읽는다. 자금 경로 아님.
//   - 링크 검증/보증 경로 없음(R4): 외부 링크 검증기를 호출하지 않는다.
import { useCallback, useState } from 'react';
import { apiFetch } from '../auth/apiFetch';
import type { DealMethod, PaymentGuidance } from './chat.types';

// 자사 API 상대 경로 빌더(절대 URL 금지).
function dealMethodPath(matchId: string): string {
  return `/api/matches/${encodeURIComponent(matchId)}/deal-method`;
}
function guidancePath(matchId: string): string {
  return `/api/matches/${encodeURIComponent(matchId)}/payment-guidance`;
}

export interface UseDealMethodResult {
  busy: boolean;
  error: string | null;
  /** 선택된 거래방식(미선택이면 null). */
  selected: DealMethod | null;
  /** 안전결제 안내(안전결제 선택 시 로드). */
  guidance: PaymentGuidance | null;
  /** 거래방식 선택(POST). 안전결제면 안내 텍스트도 로드한다. */
  choose: (method: DealMethod) => Promise<void>;
}

export function useDealMethod(matchId: string): UseDealMethodResult {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DealMethod | null>(null);
  const [guidance, setGuidance] = useState<PaymentGuidance | null>(null);

  const loadGuidance = useCallback(async (id: string) => {
    const res = await apiFetch(guidancePath(id));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as PaymentGuidance;
    setGuidance(json);
  }, []);

  const choose = useCallback(
    async (method: DealMethod) => {
      setBusy(true);
      setError(null);
      // 선택을 **즉시(낙관적)** 반영한다. 직접거래 선입금 사기 경고는 안전 핵심이라
      // 서버 왕복 성공 여부와 무관하게 사용자가 직접거래를 고르는 순간 떠야 한다.
      // 서버 POST는 선택을 기록(best-effort)하며, 실패해도 경고/선택은 유지한다.
      setSelected(method);
      if (method !== '안전결제') setGuidance(null);
      try {
        const res = await apiFetch(dealMethodPath(matchId), {
          method: 'POST',
          // ② 라벨만 전송 — 금액·결제 필드 없음.
          body: JSON.stringify({ dealMethod: method }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // 안전결제는 안내 텍스트(mode:'안내')만 로드. 직접거래는 경고만(아래 UI).
        if (method === '안전결제') {
          await loadGuidance(matchId);
        }
      } catch (e: unknown) {
        setError(
          e instanceof Error ? e.message : '거래방식 선택에 실패했습니다.',
        );
        throw e instanceof Error ? e : new Error('deal-method failed');
      } finally {
        setBusy(false);
      }
    },
    [matchId, loadGuidance],
  );

  return { busy, error, selected, guidance, choose };
}
