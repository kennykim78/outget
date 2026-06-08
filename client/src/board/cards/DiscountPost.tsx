// 할인소식 UGC 카드(S6 표시). 표시 전용 — 입력 폼 없음(폼은 Epic6).
// 불변식 ④/R5:
//   - 미검증 제보임을 칩으로 명시(중립/회색 — 색 단독 의존 금지, 라벨·아이콘 병행).
//   - listPrice(정가) 없음(unverifiedBase) 이면 `[기준가 미확인·사용자 제보가]` 라벨 강제.
//   - 플랫폼 산정 단정가 변수(플랫폼가/우리가 류)는 사용하지 않는다.
//   - 사진은 "직접 촬영분만" 안내(외부 본문/이미지 자동 수집 아님).
//   - 신고 버튼 → ReportFlow(즉시 블라인드·이의 안내, Epic7).
//   - lat/lng 는 옵셔널(사용자 등록분은 좌표 없음) — 카드는 좌표를 사용하지 않아 영향 없음.
import type { DiscountPost as DiscountPostData } from '../board.types';
import ReportFlow from '../../governance/ReportFlow';
import '../board.css';

interface DiscountPostProps {
  post: DiscountPostData;
}

export default function DiscountPost({ post }: DiscountPostProps) {
  // 정가 미확인 → 라벨 강제. unverifiedBase 가 true 이거나 listPrice 부재면 미확인.
  const baseUnverified = post.unverifiedBase || post.listPrice == null;

  return (
    <article className="card card--discount" aria-label="할인소식 카드">
      <header className="card__head">
        {/* 미검증 제보 칩 — 아이콘(◌) + 텍스트 병행, 회색 중립색. */}
        <span className="chip chip--unverified" aria-label="미검증 제보">
          <span aria-hidden="true">◌</span> 미검증 제보
        </span>
        <ReportFlow targetType="discount" targetId={post.id} />
      </header>

      <h3 className="card__title">{post.storeBrand}</h3>

      <div className="discount-price">
        {post.discountRate != null && (
          <span className="discount-price__rate">{post.discountRate}%</span>
        )}
        {post.discountPrice != null && (
          <span className="discount-price__value">
            {post.discountPrice.toLocaleString('ko-KR')}원
          </span>
        )}
      </div>

      {/* 기준가(정가) 표시 / 미확인 라벨. */}
      {post.listPrice != null ? (
        <p className="list-price">
          정가 {post.listPrice.toLocaleString('ko-KR')}원
        </p>
      ) : null}
      {baseUnverified && (
        <p className="base-unverified" role="note">
          [기준가 미확인·사용자 제보가]
        </p>
      )}

      {post.photo && (
        <figure className="discount-photo">
          <img src={post.photo} alt="제보 사진(직접 촬영분)" loading="lazy" />
          <figcaption>직접 촬영한 사진만 공유됩니다.</figcaption>
        </figure>
      )}

      <footer className="card__foot">
        <span className="card__source">출처: {post.source}</span>
        <span className="card__created">{post.createdAt}</span>
      </footer>
    </article>
  );
}
