// L5 검색 블록(스펙33 §2.2 · 265 K6 전부 펼침): 라벨 "이 조건으로 찾기" → 검색어 행(복사) + 머천트 버튼 2(쿠팡·네이버, 순서·크기 고정, 아웃라인).
//   K6(Kenny 2026-11-02, ORDERS §41): 제휴 여부와 무관하게 펼침 토글 없이 판정 뒤 처음부터 그린다. 토글 자리는 라벨(VerdictCard 대안 라벨과 같은 스타일).
//   검색어 = engine.buildSearchKeyword, 링크 = 빌드 타임 searchLinks(키워드 일치) 또는 buildSearchLinks — 검색 결과 페이지로 가는 링크만(가격·이미지 수집 0, 불변식 ①④).
//   허용 필터·제휴 고지 A 판정은 SearchBlock 과 같은 함수(../supply/searchLinks). 판정 뒤 채운 CTA 0(261 §6 — 상한 규칙으로 읽음).
import { useEffect, useRef, useState } from 'react';
import { COPY } from '@ws/copy';
import type { SearchLink } from '@ws/engine';
import { track } from '../events/track';
import AffNote from '../supply/AffNote';
import { REL_AFFILIATE, REL_SEARCH, affNoteId, renderSearchLinks } from '../supply/searchLinks';

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
const COPIED_MS = 2000;

export default function SpecSearch({ animalTypeId, supplyItemId, keyword, links }: SpecSearchProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const ordered = renderSearchLinks(links);
  if (keyword.trim() === '' || ordered.length === 0) return null;
  const affOn = ordered.some((l) => l.kind === 'AFFILIATE');
  const noteId = affNoteId(supplyItemId);

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
      <p className="ws-t-label ws-spec-muted">{COPY.supplyLayer.findWithCondition}</p>
      <div className="ws-search" data-ws-search={supplyItemId}>
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
        {affOn ? <AffNote kind="a" id={noteId} /> : null}
        <div className="ws-search-merchants">
          {ordered.map((l) => (
            <a
              key={l.provider}
              className="ws-btn ws-btn--outline ws-search-merchant"
              href={l.href}
              target="_blank"
              rel={l.kind === 'AFFILIATE' ? REL_AFFILIATE : REL_SEARCH}
              aria-describedby={l.kind === 'AFFILIATE' ? noteId : undefined}
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
    </div>
  );
}
