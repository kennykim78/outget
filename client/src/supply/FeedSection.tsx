// 362 N10 L4 아래층 블록(364 §2.4 · §3.1 · §3.2) — 프리렌더 feedBlockL4 와 같은 마크업. 자리 = products 뒤(products 0 이어도 같은 자리).
//   요청 안 함·404·행 0 → 블록 없음. 로딩 → 제목 + StateBlock loading(고지는 공급자를 알 때까지 0). 실패 → 제목 + StateBlock error + 테두리 「다시 시도하기」.
//   GENERAL_INFO(D-7): 행은 전부 △, 규격 줄 생략 — LISTED_PASS 블록은 feedBlock 검사가 거부한다.
import type { ReactNode } from 'react';
import { COPY } from '@ws/copy';
import { specLine, type PublicAnimalType, type PublicRequirement, type WsPageData } from '@ws/engine';
import { FeedNote, FeedRow, feedCheckedLine, feedNoteId } from '../home/FeedCard';
import StateBlock from '../ui/StateBlock';
import { feedPathFor, useFeedBlock } from './feedBlock';

const TITLE_ID = 'ws-feed-title';

function Shell({ children }: { children: ReactNode }) {
  return (
    <section className="ws-supply-part ws-feed" data-ws-part="feed" aria-labelledby={TITLE_ID}>
      <h3 id={TITLE_ID} className="ws-t-label ws-supply-head">
        {COPY.feed.title}
      </h3>
      {children}
    </section>
  );
}

export default function FeedSection({ page, type, requirement }: { page: WsPageData; type: PublicAnimalType; requirement: PublicRequirement }) {
  const r = requirement;
  const path = feedPathFor(page, type, r);
  const generalInfo = Boolean(r.generalInfo || type.generalInfo);
  const { state, retry } = useFeedBlock(path, { typeId: type.id, itemId: r.supplyItemId, stage: page.data.feed?.stage ?? null, generalInfo });

  if (state.kind === 'none') return null;
  if (state.kind === 'loading') {
    return (
      <Shell>
        <StateBlock kind="loading" level={4} title={COPY.feed.loadingTitle} />
      </Shell>
    );
  }
  if (state.kind === 'error') {
    return (
      <Shell>
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
  const checked = b.priceCheckedOn !== undefined ? feedCheckedLine(b.priceCheckedOn) : null;
  return (
    <Shell>
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
