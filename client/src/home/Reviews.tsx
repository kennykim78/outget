// 실제 이용 후기(스펙22 §2.13) — 홈 A 에서는 비노출(D6, 286 U3a), 컴포넌트·사다리 로직은 보존. ws-data testimonials(APPROVED ∧ verifiedUsage 만 — 서버 투영) 그대로, 순서 유지.
//   사다리: 0 → 섹션 없음 · 1–2 → 정지(모바일 세로, ≥768 한 줄) · 3–5 → 정지 레일 · ≥6 → 마퀴 2줄(위 앞 절반 ←, 아래 나머지 →).
//   마퀴: hover·focus-within·터치 정지, 복제 묶음 aria-hidden+inert, 페이드 없음, "멈추기/다시 흐르게 하기" 토글(D-18, WCAG 2.2.2).
//   reduced-motion 이거나 토글 문구가 아직 없으면 마퀴 대신 한 줄 수동 레일(정지 상태가 기본).
//   별점·점수 없음. 리뷰어 사진은 동의분(reviewerImage, 동일 출처 /assets/)만, 없으면 빈 원(이니셜 없음 D-17).
import { useState, type ReactNode } from 'react';
import type { LinkedAction, PublicAnimalType, PublicTestimonial } from '@ws/engine';
import { COPY } from '@ws/copy';
import { copyAt } from '../ui/copyText';
import RailSection from '../ui/RailSection';
import { MQ_REDUCED_MOTION, useMediaQuery } from '../ui/useMediaQuery';

/** " — " 기준 제목/부제(구분 기호는 시각적으로 숨김) — 홈 소개 섹션 삭제(286 U3a)로 후기 전용이 되어 여기로 옮김. */
function SplitTitle({ text }: { text: string }) {
  const i = text.indexOf(' — ');
  if (i < 0) return <span className="ws-split-title">{text}</span>;
  return (
    <>
      <span className="ws-split-title">{text.slice(0, i)}</span>
      <span className="ws-visually-hidden"> — </span>
      <span className="ws-split-sub">{text.slice(i + 3)}</span>
    </>
  );
}

const SAME_ORIGIN_ASSET = /^\/assets\/[A-Za-z0-9._/-]+$/;

export type ReviewLadder = 'none' | 'single' | 'rail' | 'marquee';

export function reviewLadder(n: number): ReviewLadder {
  if (n <= 0) return 'none';
  if (n <= 2) return 'single';
  if (n <= 5) return 'rail';
  return 'marquee';
}

interface CardProps {
  t: PublicTestimonial;
  animalName: string | null;
  onAction(action: LinkedAction): void;
  /** VET 행동 링크 허용(페이지 데이터에 병원 ≥ 1). 아니면 VET 후기의 행동 링크 생략(K1). */
  vetAvailable: boolean;
  /** 복제 묶음(마퀴) — 링크·버튼 포커스 제외. */
  clone?: boolean;
}

export function ReviewCard({ t, animalName, onAction, vetAvailable, clone = false }: CardProps) {
  const actionLabel = t.linkedAction === 'VET' && !vetAvailable ? null : copyAt(`homeA.reviewAction.${t.linkedAction}`);
  const img = typeof t.reviewerImage === 'string' && SAME_ORIGIN_ASSET.test(t.reviewerImage) && !t.reviewerImage.includes('..') ? t.reviewerImage : null;
  const who = [animalName, COPY.situation[t.situation]].filter((x): x is string => typeof x === 'string' && x !== '').join(' · ');
  let action: ReactNode = null;
  if (actionLabel) {
    const inner = (
      <>
        {actionLabel}
        <span aria-hidden="true"> ›</span>
      </>
    );
    action =
      t.linkedAction === 'VET' ? (
        <a className="ws-review-action ws-t-meta" href="/vet" tabIndex={clone ? -1 : undefined}>
          {inner}
        </a>
      ) : (
        <button type="button" className="ws-review-action ws-t-meta" tabIndex={clone ? -1 : undefined} onClick={() => onAction(t.linkedAction)}>
          {inner}
        </button>
      );
  }
  return (
    <li className="ws-review" data-ws-id={clone ? undefined : `testimonials#${t.id}`}>
      <blockquote className="ws-review-quote">{`“${t.quote}”`}</blockquote>
      <div className="ws-review-who">
        {img ? <img className="ws-review-photo" src={img} alt="" width={40} height={40} loading="lazy" decoding="async" /> : <span className="ws-review-photo" aria-hidden="true" />}
        <span className="ws-t-meta ws-muted">{who}</span>
        <span className="ws-pill-chip ws-pill-chip--brand">{COPY.homeA.reviewVerifiedChip}</span>
      </div>
      {action}
    </li>
  );
}

export interface ReviewsProps {
  testimonials: readonly PublicTestimonial[];
  types: readonly Pick<PublicAnimalType, 'id' | 'displayName'>[];
  onAction(action: LinkedAction): void;
  vetAvailable: boolean;
}

export default function Reviews({ testimonials, types, onAction, vetAvailable }: ReviewsProps) {
  const reduced = useMediaQuery(MQ_REDUCED_MOTION);
  const [paused, setPaused] = useState(false);
  const [touching, setTouching] = useState(false);
  // 포커스가 든 행은 애니메이션·transform 을 해제(정적 배치) — 원본 묶음이 항상 x≥0 에 놓여 링이 보이고 브라우저가 행을 스크롤해 따라간다(WCAG 2.4.7·2.4.11).
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const ladder = reviewLadder(testimonials.length);
  if (ladder === 'none') return null;

  const nameOf = (id: string) => types.find((x) => x.id === id)?.displayName ?? null;
  const cards = (list: readonly PublicTestimonial[], clone = false) =>
    list.map((t) => <ReviewCard key={`${clone ? 'c-' : ''}${t.id}`} t={t} animalName={nameOf(t.animalTypeId)} onAction={onAction} vetAvailable={vetAvailable} clone={clone} />);
  const title = <SplitTitle text={COPY.homeA.reviewsTitle} />;

  const pauseLabel = copyAt('homeA.reviewPause');
  const resumeLabel = copyAt('homeA.reviewResume');
  const prev = copyAt('rail.prev');
  const next = copyAt('rail.next');
  const canMarquee = ladder === 'marquee' && !reduced && pauseLabel !== null && resumeLabel !== null;

  if (ladder === 'single') {
    return (
      <section className="ws-reviews-section" data-ws-section="reviews" data-ws-ladder="single" aria-labelledby="ws-sec-reviews-title">
        <h2 id="ws-sec-reviews-title" className="ws-t-title ws-center-title">
          {title}
        </h2>
        <ul className="ws-reviews-static" role="list">
          {cards(testimonials)}
        </ul>
      </section>
    );
  }

  if (!canMarquee) {
    return (
      <RailSection
        id="reviews"
        kind="review"
        title={title}
        prevLabel={prev}
        nextLabel={next}
        sectionData={{ 'data-ws-ladder': ladder === 'marquee' ? 'marquee-static' : 'rail' }}
      >
        {cards(testimonials)}
      </RailSection>
    );
  }

  const half = Math.ceil(testimonials.length / 2);
  const rows = [testimonials.slice(0, half), testimonials.slice(half)];
  const stopped = paused || touching;
  return (
    <section className="ws-reviews-section" data-ws-section="reviews" data-ws-ladder="marquee" aria-labelledby="ws-sec-reviews-title">
      <div className="ws-rail-head">
        <h2 id="ws-sec-reviews-title" className="ws-t-section">
          {title}
        </h2>
        <button type="button" className="ws-btn ws-btn--outline ws-marquee-toggle" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
          {paused ? resumeLabel : pauseLabel}
        </button>
      </div>
      <div
        className={`ws-marquee${stopped ? ' ws-marquee--paused' : ''}`}
        onTouchStart={() => setTouching(true)}
        onTouchEnd={() => setTouching(false)}
        onTouchCancel={() => setTouching(false)}
      >
        {rows.map((row, i) => (
          <div
            key={i}
            className={`ws-marquee-row ws-marquee-row--${i === 0 ? 'left' : 'right'}${focusRow === i ? ' ws-marquee-row--focus' : ''}`}
            onFocus={() => setFocusRow(i)}
            onBlur={(e) => {
              if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
              e.currentTarget.scrollLeft = 0;
              setFocusRow((cur) => (cur === i ? null : cur));
            }}
          >
            <div className="ws-marquee-track">
              <ul className="ws-marquee-set" role="list">
                {cards(row)}
              </ul>
              <ul className="ws-marquee-set" role="list" aria-hidden="true" {...{ inert: '' }}>
                {cards(row, true)}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
