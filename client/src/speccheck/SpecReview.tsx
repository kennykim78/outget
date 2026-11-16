// D6-B(Kenny 2026-11-14 · 시안 r5 B_l5_pc1280 / B_mobile360) — L5 결과 상태 아래 「크기 확인에 도움 된 점」.
//   데이터: 같은 문서 ws-data testimonials(서버 투영 = APPROVED ∧ verifiedUsage ∧ 노출 타입, 불변식 ⑦) 중
//   이 동물 ∧ linkedAction=SPEC_CHECK 의 첫 1건. 0건이면 null — 제목·선·여백 모두 없음(빈 박스·안내 문구 금지).
//   모양: 선 1개 + 제목 + 인용 원문 + 「{동물} · {상황}」 한 줄. 카드·별점·배지·사진·행동 버튼 없음. 문장은 원문 그대로(가공 없음).
//   판정과 무관 — 후기는 규격 판정을 바꾸지 않는다(결과 상태 전부에서 같은 모양).
import { useId } from 'react';
import { COPY } from '@ws/copy';
import type { PublicTestimonial } from '@ws/engine';

export function pickSpecReview(list: readonly PublicTestimonial[], animalTypeId: string): PublicTestimonial | null {
  return list.find((t) => t.animalTypeId === animalTypeId && t.linkedAction === 'SPEC_CHECK' && typeof t.quote === 'string' && t.quote.trim() !== '') ?? null;
}

export default function SpecReview({ testimonials, animalTypeId, animalName }: { testimonials: readonly PublicTestimonial[]; animalTypeId: string; animalName: string }) {
  const headId = useId();
  const t = pickSpecReview(testimonials, animalTypeId);
  if (!t) return null;
  const situation = COPY.situation[t.situation] as string | undefined;
  const who = [animalName, situation].filter((x): x is string => typeof x === 'string' && x !== '').join(' · ');
  return (
    <section className="ws-spec-review" aria-labelledby={headId} data-ws-part="review" data-ws-id={`testimonials#${t.id}`}>
      <h4 id={headId} className="ws-t-section ws-spec-review-title">
        {COPY.verdict.reviewTitle}
      </h4>
      <blockquote className="ws-t-body ws-spec-review-quote">{`“${t.quote}”`}</blockquote>
      {who ? <p className="ws-t-meta ws-spec-muted">{who}</p> : null}
    </section>
  );
}
