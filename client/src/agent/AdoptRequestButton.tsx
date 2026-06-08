// 대행자 시점 채택 + 확인가 제시 UI(S4 대행자측).
// 불변식:
//   - ①/R1: useRequestActions(자사 /api 상대경로)만 사용. 외부 URL 0.
//   - ⑤/R3: 확인가 제시 입력은 금액·메모만 — 좌표 입력란 없음.
//   - ②: 결제/정산 입력 0. 금액은 표시 확인가일 뿐(플랫폼 자금 미보유).
//   - ④: 확인가는 대행자 책임(서버가 agentId·시각 부여). 플랫폼 단정가 아님.
import { useState } from 'react';
import { useRequestActions } from '../request/useRequestActions';
import '../request/request.css';

interface AdoptRequestButtonProps {
  requestId: string;
  /** 채택 성공 후 콜백(상위 갱신·채팅 진입). 매칭 식별자 동반. */
  onAdopted?: (ctx: { matchId?: string; chatThreadId?: string }) => void;
}

export default function AdoptRequestButton({
  requestId,
  onAdopted,
}: AdoptRequestButtonProps) {
  const { busy, error, adopt, setVerifiedPrice } = useRequestActions();
  const [adopted, setAdopted] = useState(false);
  // 확인가 입력 — 금액·메모만(좌표 없음).
  const [priceText, setPriceText] = useState('');
  const [memo, setMemo] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [pricePosted, setPricePosted] = useState(false);

  const handleAdopt = async () => {
    setLocalError(null);
    try {
      const result = await adopt(requestId);
      setAdopted(true);
      onAdopted?.({
        matchId: result.matchId,
        chatThreadId: result.chatThreadId,
      });
    } catch (e: unknown) {
      setLocalError(
        e instanceof Error ? e.message : '채택에 실패했습니다.',
      );
    }
  };

  const handleVerifiedPrice = async () => {
    setLocalError(null);
    const price = Number(priceText);
    if (!priceText.trim() || Number.isNaN(price) || price <= 0) {
      setLocalError('확인가 금액을 숫자로 입력해 주세요.');
      return;
    }
    try {
      await setVerifiedPrice(requestId, {
        price,
        ...(memo.trim() ? { note: memo.trim() } : {}),
      });
      setPricePosted(true);
    } catch (e: unknown) {
      setLocalError(
        e instanceof Error ? e.message : '확인가 제시에 실패했습니다.',
      );
    }
  };

  return (
    <div className="adopt-action">
      {!adopted ? (
        <button
          type="button"
          className="agent-form__btn agent-form__btn--primary"
          onClick={handleAdopt}
          disabled={busy}
        >
          {busy ? '처리 중…' : '이 요청 채택하기'}
        </button>
      ) : (
        <>
          <p className="adopt-action__msg" role="status">
            채택됨 · 채팅은 곧 제공됩니다(Epic 5).
          </p>

          {!pricePosted ? (
            <>
              {/* 확인가 제시 — 금액·메모만(좌표 입력란 없음 ⑤/R3). */}
              <div className="adopt-action__row">
                <input
                  className="adopt-action__input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                  placeholder="현장 확인가(원)"
                  aria-label="확인가 금액"
                />
              </div>
              <div className="adopt-action__row">
                <input
                  className="adopt-action__input"
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="메모 (선택)"
                  aria-label="확인가 메모"
                />
              </div>
              <button
                type="button"
                className="agent-form__btn agent-form__btn--primary"
                onClick={handleVerifiedPrice}
                disabled={busy}
              >
                {busy ? '제출 중…' : '확인가 제시'}
              </button>
              <p className="verified-inline__disclaimer">
                대행자 책임 · 플랫폼 단정가 아님
              </p>
            </>
          ) : (
            <p className="adopt-action__msg" role="status">
              확인가를 제시했습니다(대행자 책임).
            </p>
          )}
        </>
      )}

      {(localError || error) && (
        <p className="adopt-action__error" role="alert">
          {localError ?? error}
        </p>
      )}
    </div>
  );
}
