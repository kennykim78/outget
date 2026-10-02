// 가로 레일 섹션(스펙22 §2.4). section[data-ws-section aria-labelledby] > 머리(h2 + 부제, 오른쪽 ‹ › + 전체 ›) + ul[role=list] 레일.
//   가로 스크롤·스냅(CSS), 키보드: 레일 자체가 포커스 가능(화살표로 스크롤). ‹ › 는 ≥1024 에서 넘칠 때만(CSS + 상태), 끝이면 비활성.
//   화살표 라벨·"전체" 문구는 호출부가 @ws/copy 에서 넘긴다(카피 단일 소스 D3).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type RailKind = 'need' | 'bundle' | 'product' | 'vet' | 'review';

// 프리렌더 클래스와 같은 이름(ul.ws-chips|ws-bundles|ws-products) — CSS 가 정적 ul 도 레일로 그린다.
const LIST_CLASS: Record<RailKind, string> = {
  need: 'ws-chips',
  bundle: 'ws-bundles',
  product: 'ws-products',
  vet: 'ws-vets',
  review: 'ws-reviews',
};

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
  /** li 요소들. */
  children: ReactNode;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function RailSection({ id, kind, title, subtitle, more, prevLabel, nextLabel, sectionData, children }: RailSectionProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ overflow: false, atStart: true, atEnd: true });
  const titleId = `ws-sec-${id}-title`;

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { overflow: max > 1, atStart: el.scrollLeft <= 1, atEnd: el.scrollLeft >= max - 1 };
    setEdges((p) => (p.overflow === next.overflow && p.atStart === next.atStart && p.atEnd === next.atEnd ? p : next));
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const scrollByPage = (dir: -1 | 1) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 1), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <section className={`ws-rail-section ws-rail-section--${kind}`} data-ws-section={id} aria-labelledby={titleId} {...sectionData}>
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
        tabIndex={0}
        aria-labelledby={titleId}
      >
        {children}
      </ul>
    </section>
  );
}
