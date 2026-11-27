// 362 N10 L4 아래층 블록(364 §2.4 · §3.1 · §3.2) — 프리렌더 feedBlockL4 와 같은 마크업. 자리 = products 뒤(products 0 이어도 같은 자리).
//   요청 안 함·404·행 0 → 블록 없음. 로딩 → 제목 + StateBlock loading(고지는 공급자를 알 때까지 0). 실패 → 제목 + StateBlock error + 테두리 「다시 시도하기」.
//   GENERAL_INFO(398 불변식 7, 362 D-7 폐기): 블록 0 — feedPathFor 가 null(fetch 0), 응답이 와도 parseFeedBlock 이 거부.
import { useEffect, type ReactNode } from 'react';
import { COPY } from '@ws/copy';
import { specLine, type PublicAnimalType, type PublicRequirement, type WsPageData } from '@ws/engine';
import { useLivePage } from '../app/feedClock';
import { FeedNote, FeedRow, feedCheckedLine, feedNoteId } from '../home/FeedCard';
import StateBlock from '../ui/StateBlock';
import { feedPathFor, useFeedBlock } from './feedBlock';
import { rememberedFeedPopular, rememberFeedPopular } from './feedTitle';

const TITLE_ID = 'ws-feed-title';

/** 380 S3: 「많이 찾는 상품」은 블록에 popular(인기순 확인 sort, 서버 FEED_POPULAR_SORTS)가 있을 때만 — 로딩·실패는 기억한 값(385, feedTitle — 프리렌더 제목), 모르면 기본 제목. */
function Shell({ popular, children }: { popular?: boolean; children: ReactNode }) {
  return (
    <section className="ws-supply-part ws-feed" data-ws-part="feed" aria-labelledby={TITLE_ID}>
      <h3 id={TITLE_ID} className="ws-t-label ws-supply-head">
        {popular ? COPY.feed.title : COPY.feed.titleFallback}
      </h3>
      {children}
    </section>
  );
}

export default function FeedSection({ page, type, requirement }: { page: WsPageData; type: PublicAnimalType; requirement: PublicRequirement }) {
  const r = requirement;
  // 377 S1: App 이 이미 거른 page 를 주지만 여기서도 지금 시각으로 다시 잰다(방어 심화). 탭 캐시의 full 블록은 단계가 낮아지면 쓰지 않는다.
  const live = useLivePage(page);
  const path = feedPathFor(live, type, r);
  const generalInfo = Boolean(r.generalInfo || type.generalInfo);
  const { state, retry } = useFeedBlock(path, { typeId: type.id, itemId: r.supplyItemId, stage: live.data.feed?.stage ?? null, generalInfo });
  const readyPopular = state.kind === 'ready' ? state.block.popular === true : null;
  useEffect(() => {
    if (readyPopular !== null) rememberFeedPopular(type.id, r.supplyItemId, readyPopular);
  }, [readyPopular, type.id, r.supplyItemId]);
  const knownPopular = rememberedFeedPopular(type.id, r.supplyItemId);

  // path null(만료) → useFeedBlock 이 아직 옛 상태를 들고 있어도 그리지 않는다.
  if (path === null || state.kind === 'none') return null;
  if (state.kind === 'loading') {
    return (
      <Shell popular={knownPopular}>
        <StateBlock kind="loading" level={4} title={COPY.feed.loadingTitle} />
      </Shell>
    );
  }
  if (state.kind === 'error') {
    return (
      <Shell popular={knownPopular}>
        <StateBlock kind="error" level={4} errorId="feed" title={COPY.feed.errorTitle} body={COPY.feed.errorBody}>
          <button type="button" className="ws-btn ws-btn--outline" onClick={retry}>
            {COPY.feed.retry}
          </button>
        </StateBlock>
      </Shell>
    );
  }
  const b = state.block;
  const noteId = feedNoteId(r.supplyItemId);
  const checked = live.data.feed?.stage === 'full' && b.priceCheckedOn !== undefined ? feedCheckedLine(b.priceCheckedOn) : null;
  return (
    <Shell popular={b.popular === true}>
      <p className="ws-t-meta ws-muted ws-feed-sub">{COPY.feed.sub}</p>
      <FeedNote id={noteId} />
      <ul className="ws-feed-rows" role="list">
        {b.rows.map((row) => (
          <FeedRow
            key={row.url}
            title={row.title}
            url={row.url}
            imageUrl={row.imageUrl}
            priceAmount={checked !== null && row.price ? row.price.amount : null}
            checkedLine={checked}
            badge={b.badge}
            specLine={b.badge === 'LISTED_PASS' && row.specValues !== null ? specLine(r.item.specSchema, row.specValues) || null : null}
            fallbackPhoto={r.photo}
            noteId={noteId}
          />
        ))}
      </ul>
    </Shell>
  );
}
