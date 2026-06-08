// 구매자 역경매 요청 카드(S4 요약). 언제까지/무엇/얼마(대행료 포함).
// 대행자 시점이면 채택 액션(onAdopt) 노출. verifiedPrice 있으면 인라인 표시(④).
import type { RequestItem } from '../board.types';
import RequestStatusBadge from '../../request/RequestStatusBadge';
import VerifiedPriceInline from '../../request/VerifiedPriceInline';
import AdoptRequestButton from '../../agent/AdoptRequestButton';
import type { RequestStatus } from '../../request/request.types';
import '../board.css';

interface RequestCardProps {
  request: RequestItem;
  /** 대행자 시점 채택 진입. 지정 시 채택 액션 노출(미지정 시 숨김). */
  onAdopt?: (requestId: string) => void;
}

// 알려진 상태 문자열만 뱃지로(그 외는 중립 텍스트로 안전 표시).
const KNOWN_STATUS: RequestStatus[] = ['대기', '채택', '매칭', '진행', '종료'];

function isKnownStatus(s: string): s is RequestStatus {
  return (KNOWN_STATUS as string[]).includes(s);
}

export default function RequestCard({ request, onAdopt }: RequestCardProps) {
  return (
    <article className="card card--request" aria-label="구매 요청 카드">
      <header className="card__head">
        <span className="badge badge--neutral">요청</span>
        {isKnownStatus(request.status) ? (
          <RequestStatusBadge status={request.status} />
        ) : (
          <span className="badge badge--neutral" aria-label="진행 상태">
            {request.status}
          </span>
        )}
      </header>

      <h3 className="card__title">{request.item}</h3>
      {request.options && <p className="card__sub">{request.options}</p>}

      <dl className="card__meta">
        <div className="card__meta-row">
          <dt>언제까지</dt>
          <dd>{request.deadline}</dd>
        </div>
        <div className="card__meta-row">
          <dt>지역</dt>
          <dd>{request.region}</dd>
        </div>
        <div className="card__meta-row">
          <dt>희망가(대행료 포함)</dt>
          <dd className="card__price-hope">
            {request.hopePrice.toLocaleString('ko-KR')}원
          </dd>
        </div>
      </dl>

      {/* 확인가(있을 때) — 대행자 책임·플랫폼 단정가 아님(④). */}
      {request.verifiedPrice && (
        <VerifiedPriceInline verifiedPrice={request.verifiedPrice} />
      )}

      {/* 대행자 시점이면 채택 + 확인가 제시. */}
      {onAdopt && (
        <AdoptRequestButton
          requestId={request.id}
          onAdopted={() => onAdopt(request.id)}
        />
      )}
    </article>
  );
}
