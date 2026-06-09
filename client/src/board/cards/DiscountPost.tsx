// 할인소식 UGC 카드(S6 표시). 표시 전용 — 입력 폼 없음(폼은 Epic6).
// 불변식 ④/R5 [표시광고법 최대 표면]:
//   - 미검증 제보임을 칩으로 명시(중립/회색 — 색 단독 의존 금지, 라벨·아이콘 병행).
//   - listPrice(정가) 없음(unverifiedBase) 이면 `[기준가 미확인·사용자 제보가]` 라벨 강제.
//   - 참고가(referencePrice): 외부 출처(네이버쇼핑)이며 플랫폼이 매긴 단정가가 아니다.
//     절대 "정가"라 쓰지 않고 항상 "참고가(네이버쇼핑)"로 표기. platform/our/official 변수 0.
//     참고가가 있을 때만 "참고가 대비 N%" 계산·표기 + 면책 3요소(검색어/보증아님/시세변동)
//     + 출처(referenceSource) + 조회시각(referenceFetchedAt) 을 강제 렌더한다(빠지면 노출).
//   - 사진은 "직접 촬영분만" 안내(외부 본문/이미지 자동 수집 아님).
//   - 신고 버튼 → ReportFlow(즉시 블라인드·이의 안내, Epic7).
//   - lat/lng 는 옵셔널(사용자 등록분은 좌표 없음) — 카드는 좌표를 사용하지 않아 영향 없음.
//   - 외부 호출/핫링크 0: 참고가는 서버가 조회해 스탬프한 값을 렌더만 한다(①/R1).
import type { DiscountPost as DiscountPostData } from '../board.types';
import ReportFlow from '../../governance/ReportFlow';
import '../board.css';

interface DiscountPostProps {
  post: DiscountPostData;
}

const KRW = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** ISO 조회시각 → 사람이 읽는 날짜(YYYY.MM.DD). 파싱 실패 시 원문 그대로. */
function formatFetchedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

export default function DiscountPost({ post }: DiscountPostProps) {
  // 참고가(네이버쇼핑) 존재 여부 — all-or-nothing 으로 referencePrice 만 검사하면 충분.
  const hasReference =
    post.referencePrice != null && post.referencePrice > 0;

  // 참고가 대비 할인율 — 참고가가 있고 제보가가 더 쌀 때만 계산(외부 출처 대비 비율).
  const refRate =
    hasReference && post.discountPrice != null && post.discountPrice > 0
      ? Math.round(
          ((post.referencePrice! - post.discountPrice) / post.referencePrice!) *
            100,
        )
      : null;

  // 정가 미확인 → 라벨 강제. 단, 네이버쇼핑 참고가가 있으면 그 비교를 대신 보여준다.
  // unverifiedBase 가 true 이거나 listPrice 부재면 미확인.
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
        {/* 할인율 — 참고가가 있으면 "참고가 대비 N%"로만, 없으면 기존 제보 할인율. */}
        {hasReference
          ? refRate != null && (
              <span className="discount-price__rate">
                참고가 대비 {refRate}%
              </span>
            )
          : post.discountRate != null && (
              <span className="discount-price__rate">{post.discountRate}%</span>
            )}
        {post.discountPrice != null && (
          <span className="discount-price__value">{KRW(post.discountPrice)}</span>
        )}
      </div>

      {/* 사용자 입력 정가(listPrice) — UGC. 참고가(네이버쇼핑)와 별개로 표기. */}
      {post.listPrice != null ? (
        <p className="list-price">정가 {KRW(post.listPrice)}</p>
      ) : null}

      {/* ── 참고가(네이버쇼핑) 비교 — 외부 출처, 면책 강제 렌더(표시광고법 ④/R5) ── */}
      {hasReference ? (
        <section
          className="reference-price"
          aria-label="네이버쇼핑 참고가 비교"
        >
          <div className="reference-price__compare">
            <div className="reference-price__col reference-price__col--reported">
              <span className="reference-price__caption">제보가</span>
              <span className="reference-price__amount">
                {post.discountPrice != null ? KRW(post.discountPrice) : '—'}
              </span>
            </div>
            <span className="reference-price__vs" aria-hidden="true">
              vs
            </span>
            <div className="reference-price__col reference-price__col--reference">
              <span className="reference-price__caption">참고가(네이버쇼핑)</span>
              <span className="reference-price__amount">
                {KRW(post.referencePrice!)}
              </span>
            </div>
          </div>
          {/* 면책 문구 강제(필수) — 검색어/동일상품 보증 아님/시세 변동 + 출처 + 조회시각. */}
          <p className="reference-price__disclaimer" role="note">
            {post.referenceSource ?? '네이버쇼핑'}
            {post.referenceQuery ? ` '${post.referenceQuery}'` : ''} 검색 최저가 ·
            동일 상품 보증 아님 · 시세 변동
            {post.referenceFetchedAt
              ? ` · 조회 ${formatFetchedAt(post.referenceFetchedAt)}`
              : ''}
          </p>
        </section>
      ) : (
        // 참고가가 없으면 기존 동작: 정가 미확인 시 라벨 강제(④/R5).
        baseUnverified && (
          <p className="base-unverified" role="note">
            [기준가 미확인·사용자 제보가]
          </p>
        )
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
