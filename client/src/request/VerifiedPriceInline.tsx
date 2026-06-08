// 확인가 인라인 최소 표시(Epic4) — 금액·대행자·확인일 + 책임 표기.
// 불변식 ④/R5:
//   - 확인가는 대행자가 제시한 금액이며 플랫폼이 단정한 가격이 아니다.
//   - "대행자 책임 · 플랫폼 단정가 아님" 카피를 항상 동반(책임 주체 명시).
//   - platformPrice/ourPrice/officialPrice 류 변수는 쓰지 않는다(R5).
// (강조/초록/✅ 등 가격 위계 시각 분리는 Epic6 — 여기는 중립 최소 표시.)
import type { VerifiedPrice } from './request.types';
import './request.css';

interface VerifiedPriceInlineProps {
  verifiedPrice: VerifiedPrice;
}

// 확인일 표시(로컬 날짜). 파싱 실패 시 원문 노출.
function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ko-KR');
}

export default function VerifiedPriceInline({
  verifiedPrice,
}: VerifiedPriceInlineProps) {
  return (
    <div className="verified-inline" role="note" aria-label="대행자 확인가">
      <div className="verified-inline__row">
        <span className="verified-inline__label">확인가</span>
        <span className="verified-inline__amount">
          {verifiedPrice.price.toLocaleString('ko-KR')}원
        </span>
      </div>
      <dl className="verified-inline__meta">
        <div className="verified-inline__meta-row">
          <dt>제시 대행자</dt>
          <dd>{verifiedPrice.agentId}</dd>
        </div>
        <div className="verified-inline__meta-row">
          <dt>확인일</dt>
          <dd>{formatDate(verifiedPrice.verifiedAt)}</dd>
        </div>
        {verifiedPrice.note && (
          <div className="verified-inline__meta-row">
            <dt>메모</dt>
            <dd>{verifiedPrice.note}</dd>
          </div>
        )}
      </dl>
      <p className="verified-inline__disclaimer">
        대행자 책임 · 플랫폼 단정가 아님
      </p>
    </div>
  );
}
