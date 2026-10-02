// 홈 A ③ WithSmall 소개(스펙22 §2.14). 카피 homeA.introSlides[0..3] + 눈썹 homeA.featureChips[i].
//   ≤1023: 세로 4장 article#ws-intro-{i}(사진 자리 → 눈썹 → 제목 → 본문), 페이지 scroll-snap 없음.
//   ≥1024: 트랙 4×70dvh 안 sticky 2열 [사진 520 | 목록], 활성 항목 = IntersectionObserver(트랙 구간 중앙선),
//          항목 button[aria-expanded][aria-controls], 클릭 → 활성 + 그 구간으로 스크롤, 활성 본문 + [지금 해보기](아웃라인 → L1).
//   reduced-motion 이면 스크롤 이동 즉시(전환 없음). 사진은 photos.json SLOT(ph-01~04) → 빈 블록(D-8).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { COPY } from '@ws/copy';
import { copyAt } from '../ui/copyText';
import PhotoTile from '../ui/PhotoTile';
import { MQ_DESKTOP, MQ_REDUCED_MOTION, useMediaQuery } from '../ui/useMediaQuery';
import SplitTitle from './SplitTitle';

const PHOTO_IDS = ['ph-01', 'ph-02', 'ph-03', 'ph-04'] as const;

export interface IntroSlidesHandle {
  /** 기능 칩 → 해당 소개로 이동(≥1024 이면 활성까지). */
  goTo(index: number): void;
}

export interface IntroSlidesProps {
  onTry(): void;
}

const IntroSlides = forwardRef<IntroSlidesHandle, IntroSlidesProps>(function IntroSlides({ onTry }, ref) {
  const desktop = useMediaQuery(MQ_DESKTOP);
  const reduced = useMediaQuery(MQ_REDUCED_MOTION);
  const [active, setActive] = useState(0);
  const anchors = useRef<Array<HTMLElement | null>>([]);
  const slides = COPY.homeA.introSlides;
  const chips = COPY.homeA.featureChips;
  const tryLabel = copyAt('homeA.introTry');

  useImperativeHandle(
    ref,
    () => ({
      goTo(index: number) {
        const el = anchors.current[index];
        if (desktop) setActive(index);
        el?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      },
    }),
    [desktop, reduced],
  );

  // ≥1024: 각 구간(70dvh)이 화면 중앙선을 지날 때 활성 전환.
  useEffect(() => {
    if (!desktop || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = anchors.current.indexOf(e.target as HTMLElement);
          if (i >= 0) setActive(i);
        }
      },
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 },
    );
    for (const el of anchors.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, [desktop]);

  const heading = (
    <h2 id="ws-sec-intro-title" className="ws-t-title ws-center-title">
      <SplitTitle text={COPY.homeA.introTitle} />
    </h2>
  );

  if (!desktop) {
    return (
      <section className="ws-intro" data-ws-section="intro" data-ws-intro="stack" aria-labelledby="ws-sec-intro-title">
        {heading}
        {slides.map((s, i) => (
          <article
            key={i}
            id={`ws-intro-${i + 1}`}
            className="ws-intro-slide"
            ref={(el) => {
              anchors.current[i] = el;
            }}
          >
            <PhotoTile photoId={PHOTO_IDS[i]} className="ws-intro-photo" />
            <p className="ws-t-label ws-eyebrow">{chips[i]}</p>
            <h3 className="ws-t-title">{s.title}</h3>
            <p className="ws-t-body ws-muted">{s.body}</p>
          </article>
        ))}
      </section>
    );
  }

  return (
    <section className="ws-intro" data-ws-section="intro" data-ws-intro="sticky" aria-labelledby="ws-sec-intro-title">
      {heading}
      <div className="ws-intro-track">
        {slides.map((_, i) => (
          <div
            key={i}
            id={`ws-intro-${i + 1}`}
            className="ws-intro-anchor"
            aria-hidden="true"
            ref={(el) => {
              anchors.current[i] = el;
            }}
          />
        ))}
        <div className="ws-intro-stage">
          <PhotoTile photoId={PHOTO_IDS[active]} className="ws-intro-photo ws-intro-photo--wide" />
          <ol className="ws-intro-list">
            {slides.map((s, i) => {
              const on = i === active;
              const panelId = `ws-intro-panel-${i + 1}`;
              return (
                <li key={i} className={`ws-intro-item${on ? ' ws-intro-item--active' : ''}`}>
                  <p className="ws-t-label ws-eyebrow">{chips[i]}</p>
                  <button
                    type="button"
                    className={`ws-intro-head ${on ? 'ws-t-title' : 'ws-t-section ws-muted'}`}
                    aria-expanded={on}
                    aria-controls={panelId}
                    onClick={() => {
                      setActive(i);
                      anchors.current[i]?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
                    }}
                  >
                    {s.title}
                  </button>
                  <div id={panelId} className="ws-intro-panel" hidden={!on}>
                    <p className="ws-t-body ws-muted">{s.body}</p>
                    {tryLabel ? (
                      <button type="button" className="ws-btn ws-btn--outline" onClick={onTry}>
                        {tryLabel}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
});

export default IntroSlides;
