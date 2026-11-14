// 가로 레일 섹션(스펙22 §2.4). section[data-ws-section aria-labelledby] > 머리(h2 + 부제, 오른쪽 ‹ › + 전체 ›) + ul[role=list] 레일.
//   가로 스크롤·스냅(CSS), 키보드: 레일 자체가 포커스 가능(화살표로 스크롤). ‹ › 는 ≥1024 에서 넘칠 때만(CSS + 상태), 끝이면 비활성.
//   화살표 라벨·"전체" 문구는 호출부가 @ws/copy 에서 넘긴다(카피 단일 소스 D3).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type RailKind = 'need' | 'bundle' | 'product' | 'vet' | 'review' | 'starter';

// 프리렌더 클래스와 같은 이름(ul.ws-chips|ws-bundles|ws-products) — CSS 가 정적 ul 도 레일로 그린다.
const LIST_CLASS: Record<RailKind, string> = {
  need: 'ws-chips',
  bundle: 'ws-bundles',
  product: 'ws-products',
  vet: 'ws-vets',
  review: 'ws-reviews',
  starter: 'ws-starters',
};

/** 286 U3b — 'grid3' = ≥768 3열 그리드 / ≤767 가로 레일 peek(홈 A 시작 카드 전용, CSS). 생략 = 기존 레일(홈 B 무변경). */
export type RailLayout = 'grid3';

export interface RailMore {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface RailSectionProps {
  /** data-ws-section 값(now·bundles·products·vet·reviews 등). */
  id: string;
  kind: RailKind;
  title: ReactNode;
  subtitle?: ReactNode;
  more?: RailMore;
  /** 화살표 aria-label(@ws/copy). null 이면 화살표를 그리지 않는다(레일은 스크롤·키보드로 여전히 이동 가능). */
  prevLabel: string | null;
  nextLabel: string | null;
  /** section 의 data-* 추가 속성(예: data-ws-ladder). */
  sectionData?: Record<`data-${string}`, string>;
  /** 배치 변형(서버 railSection layout 과 같은 값) — section 에 ws-rail-section--{layout} 클래스만 더한다. */
  layout?: RailLayout;
  /** li 요소들. */
  children: ReactNode;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function RailSection({ id, kind, title, subtitle, more, prevLabel, nextLabel, sectionData, layout, children }: RailSectionProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ overflow: false, atStart: true, atEnd: true });
  const titleId = `ws-sec-${id}-title`;
  // 사용자가 레일을 직접 움직이기 전(pinned)에는 시작(scrollLeft 0)에 고정한다.
  //   원인(qa MED-1): 하이드레이션 뒤 칩이 재정렬되면(예: 케이지 호환 판정 대기 중 ✓ → 판정 후 △ 로 맨 앞 이동) Chrome 이
  //   scroll-snap 재스냅으로 '이전에 스냅된 요소'(원래 첫 칩)를 따라가 레일이 끝까지 밀리고 새 첫 칩이 왼쪽으로 잘린다.
  //   포인터·휠·터치·키보드·포커스·화살표 버튼 중 하나라도 있으면 해제(그 뒤 위치는 사용자 몫).
  const pinnedRef = useRef(true);

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { overflow: max > 1, atStart: el.scrollLeft <= 1, atEnd: el.scrollLeft >= max - 1 };
    setEdges((p) => (p.overflow === next.overflow && p.atStart === next.atStart && p.atEnd === next.atEnd ? p : next));
  }, []);

  // 매 렌더(children 재정렬 포함) 커밋 직후 — 페인트 전에 시작으로 되돌린다.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && pinnedRef.current && el.scrollLeft !== 0) el.scrollLeft = 0;
  });

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const release = () => {
      pinnedRef.current = false;
    };
    const onScroll = () => {
      // 렌더 밖 레이아웃 변화(폰트·이미지 로드 등)로 인한 재스냅도 같은 이유로 되돌린다.
      if (pinnedRef.current && el.scrollLeft !== 0) el.scrollLeft = 0;
      measure();
    };
    const intents = ['pointerdown', 'wheel', 'touchstart', 'keydown', 'focusin'] as const;
    measure();
    for (const t of intents) el.addEventListener(t, release, { passive: true });
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      for (const t of intents) el.removeEventListener(t, release);
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const scrollByPage = (dir: -1 | 1) => {
    const el = listRef.current;
    if (!el) return;
    pinnedRef.current = false;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 1), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <section
      className={`ws-rail-section ws-rail-section--${kind}${layout ? ` ws-rail-section--${layout}` : ''}`}
      data-ws-section={id}
      aria-labelledby={titleId}
      {...sectionData}
    >
      <div className="ws-rail-head">
        <div className="ws-rail-heading">
          <h2 id={titleId} className="ws-t-section">
            {title}
          </h2>
          {subtitle ? <p className="ws-rail-sub ws-t-body">{subtitle}</p> : null}
        </div>
        <div className="ws-rail-tools">
          {edges.overflow && prevLabel !== null && nextLabel !== null ? (
            <>
              <button
                type="button"
                className="ws-rail-arrow"
                aria-label={prevLabel}
                aria-disabled={edges.atStart}
                onClick={() => !edges.atStart && scrollByPage(-1)}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <button
                type="button"
                className="ws-rail-arrow"
                aria-label={nextLabel}
                aria-disabled={edges.atEnd}
                onClick={() => !edges.atEnd && scrollByPage(1)}
              >
                <span aria-hidden="true">›</span>
              </button>
            </>
          ) : null}
          {more ? (
            more.href !== undefined ? (
              <a className="ws-rail-more ws-t-meta" href={more.href} onClick={more.onClick}>
                {more.label}
                <span aria-hidden="true"> ›</span>
              </a>
            ) : (
              <button type="button" className="ws-rail-more ws-t-meta" onClick={more.onClick}>
                {more.label}
                <span aria-hidden="true"> ›</span>
              </button>
            )
          ) : null}
        </div>
      </div>
      <ul
        ref={listRef}
        className={`ws-rail ${LIST_CLASS[kind]}`}
        role="list"
        // grid3(≥768 에서 스크롤 없음): 레일 자체 tabindex 를 빼도 카드 링크가 포커스를 받아 모바일 레일 키보드 이동은 유지된다.
        tabIndex={layout === 'grid3' ? undefined : 0}
        aria-labelledby={titleId}
      >
        {children}
      </ul>
    </section>
  );
}
