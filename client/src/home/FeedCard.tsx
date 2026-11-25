// 362 N10 「많이 찾는 상품」 아래층 카드(364 §2.1 row · §2.2 card · §2.3 배지). 마크업은 프리렌더 server/src/prerender/pages/feed.ts 와 같다(클래스·순서).
//   운영자 확인 표식(○ · .ws-badge · li.ws-product · ♥ · L7 링크) 0 — 배지는 span.ws-feed-badge(--listed 중립 / --check △).
//   상품명은 몰 원문(개작 0), 링크 아님 — 행동은 몰 버튼 하나(rel sponsored·noopener, 새 창, 고지 aria-describedby).
//   가격 줄은 단계 full 에서만(noprice 는 줄 자체 없음 — 「가격 없음」 대체 문구 0). 숫자·날짜 표기는 엔진 feedPriceText·feedCheckedParts 공용.
//   썸네일: 피드 imageUrl(데이터 검사 통과분) → 실패(onerror·CSP 차단) 시 요구사항 사진 PhotoTile(빈 블록 / 실사 / 생성 표기). 글자·글리프 대체 0.
//   HomeB(클라 순서 모듈)가 이 파일을 import 한다 — 제휴 모듈(searchLinks·AffNote·providers)·feed-wire 를 import 하지 않는다(compliance C10-AFF-IMPORT).
import { useState } from 'react';
import { COPY, feedCheckedText } from '@ws/copy';
import { feedCheckedParts, feedPriceText, type PublicPhoto } from '@ws/engine';
import Glyph from '../ui/Glyph';
import PhotoTile from '../ui/PhotoTile';

/** 피드 몰 링크 rel — 프리렌더 FEED_REL 과 같은 토큰(sponsored 포함). */
export const FEED_REL = 'sponsored nofollow noopener noreferrer';
/** 홈 레일 고지 id(페이지당 1 — 프리렌더 FEED_HOME_NOTE_ID). */
export const FEED_HOME_NOTE_ID = 'ws-aff-feed-home';
/** L4 블록 고지 id. */
export const feedNoteId = (itemId: string): string => `ws-aff-feed-${itemId}`;

export type FeedBadgeKind = 'LISTED_PASS' | 'CHECK_NEEDED';

/** 확인일 문구 「{M}월 {D}일 확인」 — 형식 밖이면 null(가격 줄을 그리지 않는다). */
export function feedCheckedLine(checkedOn: string | undefined): string | null {
  const p = feedCheckedParts(checkedOn);
  return p === null ? null : feedCheckedText(p.month, p.day);
}

/** 블록·레일 고지(쿠팡 권장 원문 — 공급자별 1회). */
export function FeedNote({ id }: { id: string }) {
  return (
    <p className="ws-t-meta ws-aff-note" id={id} data-ws-aff="note-feed">
      {COPY.affiliate.coupang}
    </p>
  );
}

function FeedBadge({ kind }: { kind: FeedBadgeKind }) {
  return kind === 'LISTED_PASS' ? (
    <span className="ws-t-label ws-feed-badge ws-feed-badge--listed">{COPY.feed.badgeListed}</span>
  ) : (
    <span className="ws-t-label ws-feed-badge ws-feed-badge--check">
      <Glyph kind="check" />
      {COPY.feed.badgeCheck}
    </span>
  );
}

function FeedThumb({ imageUrl, fallback }: { imageUrl: string | null; fallback: PublicPhoto | undefined }) {
  const [failed, setFailed] = useState(false);
  if (!imageUrl || failed) return <PhotoTile photo={fallback} className="ws-feed-photo" />;
  return (
    <img
      className="ws-feed-thumb"
      src={imageUrl}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function SpecLine({ line }: { line: string | null }) {
  return line ? <p className="ws-t-meta ws-feed-spec">{`${COPY.feed.specPrefix} · ${line}`}</p> : null;
}

const AffLabel = () => (
  <span className="ws-t-label ws-muted ws-feed-aff" data-ws-aff="card">
    {COPY.feed.affLabel}
  </span>
);

function GoButton({ url, noteId, compact }: { url: string; noteId: string; compact: boolean }) {
  return (
    <a
      className={`ws-btn ws-btn--outline ws-feed-go${compact ? ' ws-feed-go--compact' : ''}`}
      href={url}
      target="_blank"
      rel={FEED_REL}
      aria-describedby={noteId}
      data-ws-merchant="COUPANG"
    >
      {COPY.feed.goCoupang}
      <span className="ws-visually-hidden">{` ${COPY.a11y.newWindow}`}</span>
    </a>
  );
}

export interface FeedRowProps {
  title: string;
  url: string;
  imageUrl: string | null;
  /** 가격 금액(full 단계 ∧ 값 있음일 때만). null 이면 가격 줄 없음. */
  priceAmount: number | null;
  /** 확인일 문구(full 단계만). null 이면 가격 줄 없음. */
  checkedLine: string | null;
  badge: FeedBadgeKind;
  /** 규격 한 줄(엔진 specLine) — LISTED_PASS 만 그린다. */
  specLine: string | null;
  fallbackPhoto: PublicPhoto | undefined;
  noteId: string;
}

/** L4 아래층 행(§2.1): 썸네일 → 상품명 → 규격 줄(LISTED_PASS) → 배지·제휴 표시 → 가격 줄(full) → 몰 버튼. */
export function FeedRow({ title, url, imageUrl, priceAmount, checkedLine, badge, specLine, fallbackPhoto, noteId }: FeedRowProps) {
  return (
    <li className="ws-feed-row" data-ws-merchant="COUPANG">
      <FeedThumb imageUrl={imageUrl} fallback={fallbackPhoto} />
      <div className="ws-feed-body">
        <p className="ws-t-cta ws-feed-title">{title}</p>
        {badge === 'LISTED_PASS' ? <SpecLine line={specLine} /> : null}
        <p className="ws-feed-meta">
          <FeedBadge kind={badge} />
          <AffLabel />
        </p>
        {priceAmount !== null && checkedLine !== null ? (
          <p className="ws-t-meta ws-feed-price">
            <span className="ws-feed-amount">{feedPriceText(priceAmount)}</span>
            <span className="ws-muted">{` · ${checkedLine} · ${COPY.feed.priceMayDiffer}`}</span>
          </p>
        ) : null}
        <GoButton url={url} noteId={noteId} compact={false} />
      </div>
    </li>
  );
}

export interface FeedCardProps {
  supplyItemId: string;
  itemName: string;
  title: string;
  url: string;
  imageUrl: string | null;
  priceAmount: number | null;
  checkedLine: string | null;
  specLine: string | null;
  fallbackPhoto: PublicPhoto | undefined;
}

/** 홈 B 레일 피드 카드(§2.2) — 품목명 → 상품명 → 규격 줄 → 배지(LISTED_PASS 만) → 가격·확인일(full) → 제휴 표시 → 몰 버튼. */
export default function FeedCard({ supplyItemId, itemName, title, url, imageUrl, priceAmount, checkedLine, specLine, fallbackPhoto }: FeedCardProps) {
  return (
    <li className="ws-feed-card" data-ws-item={supplyItemId} data-ws-merchant="COUPANG">
      <FeedThumb imageUrl={imageUrl} fallback={fallbackPhoto} />
      <p className="ws-t-label ws-muted ws-feed-item">{itemName}</p>
      <p className="ws-t-cta ws-feed-title">{title}</p>
      <SpecLine line={specLine} />
      <FeedBadge kind="LISTED_PASS" />
      {priceAmount !== null && checkedLine !== null ? (
        <>
          <p className="ws-t-meta ws-feed-price">
            <span className="ws-feed-amount">{feedPriceText(priceAmount)}</span>
          </p>
          <p className="ws-t-meta ws-muted ws-feed-checked">{checkedLine}</p>
        </>
      ) : null}
      <AffLabel />
      <GoButton url={url} noteId={FEED_HOME_NOTE_ID} compact />
    </li>
  );
}
