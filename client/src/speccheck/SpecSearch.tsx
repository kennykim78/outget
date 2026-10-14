// L5 검색 블록(스펙33 §2.2): "이 조건으로 찾기" 펼침 → 검색어 행(복사) + 머천트 버튼 2(쿠팡·네이버, 순서·크기 고정, 아웃라인).
//   검색어 = engine.buildSearchKeyword, 링크 = buildSearchLinks — 검색 결과 페이지로 가는 링크만(가격·이미지 수집 0, 불변식 ①④).
//   펼침 버튼이 L5 결과 후의 유일한 채운 CTA(§5.2).
import { useEffect, useId, useRef, useState } from 'react';
import { COPY } from '@ws/copy';
import type { SearchLink } from '@ws/engine';
import { track } from '../events/track';

export interface SpecSearchProps {
  animalTypeId: string;
  supplyItemId: string;
  keyword: string;
  links: readonly SearchLink[];
}

const MERCHANT_TEXT: Readonly<Record<SearchLink['provider'], string>> = {
  COUPANG: COPY.supplyLayer.findCoupang,
  NAVER: COPY.supplyLayer.findNaver,
};
const MERCHANT_ORDER: readonly SearchLink['provider'][] = ['COUPANG', 'NAVER'];
// 허용 호스트 — SearchBlock(client/src/supply/SearchBlock.tsx :10-13, :34)과 동일. 밖의 href 는 그리지 않는다.
const ALLOWED: Readonly<Record<SearchLink['provider'], string>> = {
  COUPANG: 'https://www.coupang.com/',
  NAVER: 'https://search.shopping.naver.com/',
};
const COPIED_MS = 2000;

export default function SpecSearch({ animalTypeId, supplyItemId, keyword, links }: SpecSearchProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const ordered = MERCHANT_ORDER.flatMap((p) => links.filter((l) => l.provider === p && typeof l.href === 'string' && l.href.startsWith(ALLOWED[p])));
  if (keyword.trim() === '' || ordered.length === 0) return null;

  const copy = () => {
    const done = () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    };
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clip && typeof clip.writeText === 'function') clip.writeText(keyword).then(done, () => undefined);
  };

  return (
    <div className="ws-spec-search">
      <button
        type="button"
        className="ws-btn ws-btn--fill ws-spec-search-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {COPY.supplyLayer.findWithCondition}
      </button>
      {open ? (
        <div className="ws-search" id={panelId} data-ws-search={supplyItemId}>
          <div className="ws-search-row">
            <span className="ws-t-body ws-search-keyword">{keyword}</span>
            <button type="button" className="ws-search-copy" aria-label={COPY.supplyLayer.searchCopyAria} onClick={copy}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
            </button>
          </div>
          <p className="ws-t-meta ws-spec-muted" aria-live="polite">
            {copied ? COPY.supplyLayer.searchCopied : ''}
          </p>
          <div className="ws-search-merchants">
            {ordered.map((l) => (
              <a
                key={l.provider}
                className="ws-btn ws-btn--outline ws-search-merchant"
                href={l.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                onClick={() =>
                  track('external_product_clicked', { animalTypeId, supplyItemId, merchant: l.provider })
                }
              >
                {MERCHANT_TEXT[l.provider]}
                <span className="ws-visually-hidden">{` ${COPY.a11y.newWindow}`}</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
