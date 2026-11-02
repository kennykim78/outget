// SearchBlock(스펙33 §2.2) — L4·L5·L7 공용. "이 조건으로 찾기" 라벨 + 검색어 행(복사 버튼) + 머천트 버튼 2(쿠팡·네이버 순서 고정, 아웃라인 동등 D-37).
//   링크는 ws-data searchLinks(빌드 시 buildSearchLinks)만 — 허용 필터(./searchLinks: SEARCH 기존 호스트, AFFILIATE 레지스트리 prefix+codeRe) 밖은 그리지 않는다. 새 창, nofollow.
//   제휴(AFFILIATE) 링크가 그려질 때만 고지 A(복사 안내 뒤·상인 버튼 앞) + 쿠팡 a rel sponsored·aria-describedby(261 §1). 꺼짐이면 지금과 같은 DOM.
//   가격·판매처명·"구매" 0. 클릭 = external_product_clicked{animalTypeId, supplyItemId, merchant}.
import { useEffect, useRef, useState } from 'react';
import { COPY } from '@ws/copy';
import type { PublicRequirement, SearchProvider } from '@ws/engine';
import { track } from '../events/track';
import AffNote from './AffNote';
import { REL_AFFILIATE, REL_SEARCH, affNoteId, renderSearchLinks } from './searchLinks';

const LABEL: Readonly<Record<SearchProvider, string>> = {
  COUPANG: COPY.supplyLayer.findCoupang,
  NAVER: COPY.supplyLayer.findNaver,
};

export interface SearchBlockProps {
  requirement: PublicRequirement;
  /** 머리(라벨) id — 꼬리 [이 조건으로 찾기]가 포커스를 옮긴다(D-36). */
  headingId: string;
}

export default function SearchBlock({ requirement, headingId }: SearchBlockProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const links = renderSearchLinks(requirement.searchLinks);
  const affOn = links.some((l) => l.kind === 'AFFILIATE');
  const noteId = affNoteId(requirement.supplyItemId);

  const onCopy = () => {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip || typeof clip.writeText !== 'function') return;
    clip.writeText(requirement.searchKeyword).then(
      () => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      },
      () => undefined,
    );
  };

  return (
    <div className="ws-search" id={`ws-search-${requirement.supplyItemId}`} data-ws-part="search">
      <h3 id={headingId} className="ws-t-label ws-supply-head" tabIndex={-1}>
        {COPY.supplyLayer.findWithCondition}
      </h3>
      <div className="ws-search-row">
        <span className="ws-search-keyword ws-t-body">{requirement.searchKeyword}</span>
        <button type="button" className="ws-search-copy" aria-label={COPY.supplyLayer.searchCopyAria} onClick={onCopy}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        </button>
      </div>
      <p className="ws-t-meta ws-search-copied" aria-live="polite">
        {copied ? COPY.supplyLayer.searchCopied : ''}
      </p>
      {affOn ? <AffNote kind="a" id={noteId} /> : null}
      {links.length > 0 ? (
        <div className="ws-search-merchants">
          {links.map((l) => (
            <a
              key={l.provider}
              className="ws-btn ws-btn--outline"
              href={l.href}
              target="_blank"
              rel={l.kind === 'AFFILIATE' ? REL_AFFILIATE : REL_SEARCH}
              aria-describedby={l.kind === 'AFFILIATE' ? noteId : undefined}
              data-ws-merchant={l.provider}
              onClick={() =>
                track('external_product_clicked', {
                  animalTypeId: requirement.animalTypeId,
                  supplyItemId: requirement.supplyItemId,
                  merchant: l.provider,
                })
              }
            >
              {LABEL[l.provider]}
              <span className="ws-visually-hidden">{` ${COPY.a11y.newWindow}`}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
