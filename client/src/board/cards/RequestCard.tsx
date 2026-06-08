// 구매자 역경매 요청 카드(S4 요약). 언제까지/무엇/얼마(대행료 포함).
import type { RequestItem } from '../board.types';
import '../board.css';

interface RequestCardProps {
  request: RequestItem;
}

export default function RequestCard({ request }: RequestCardProps) {
  return (
    <article className="card card--request" aria-label="구매 요청 카드">
      <header className="card__head">
        <span className="badge badge--neutral">요청</span>
        <span className="badge badge--neutral" aria-label="진행 상태">
          {request.status}
        </span>
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
    </article>
  );
}
