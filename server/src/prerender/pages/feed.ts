// 362 N9 — 「많이 찾는 상품」 아래층 프리렌더 마크업(364 스펙 §2·§3). 클라 N10 FeedCard(row/card)와 같은 클래스·순서.
//   ○·.ws-badge·li.ws-product 0(운영자 확인 카드 전용 표식) — 배지는 span.ws-feed-badge(--listed 중립 / --check △).
//   가격 줄은 단계 full 에서만(noprice 는 줄 자체 없음). 상품명은 몰 원문(개작 0), 링크 아님 — 행동은 몰 버튼 하나.
//   고지: 블록(L4)·레일 머리(홈) 안 공급자별 1회, p.ws-t-meta.ws-aff-note[data-ws-aff=note-feed] = 쿠팡 권장 원문. 알리 고지 = Kenny 결정 전 → 알리 행은 빌드 오류.
import { feedCheckedParts, feedPriceText, specLine, type PublicFeedBlock, type PublicFeedRailCard, type PublicFeedRow, type PublicPhoto, type WsFeedData } from '../../engine/index.js';
import { COPY, feedCheckedText } from '../copy.js';
import { escapeAttr as a, escapeHtml as h } from '../html.js';
import type { RequirementModel, TypeModel } from '../project.js';
import { glyphSpan, photoTile } from './common.js';

/** 페이지 하나에 그릴 피드(site.ts 가 변형 렌더 때만 PageContext 에 싣는다). 없으면 마크업 0 — 기본 파일 바이트 불변. */
export interface PageFeed {
  /** 품목 id → 이 단계 공개 블록(이 페이지가 그릴 수 있는 품목만). */
  blocks: ReadonlyMap<string, PublicFeedBlock>;
  /** 이 페이지 ws-data data.feed 그대로 — 단계·확인일·홈 레일 카드(1.5KB 예산으로 덜어 낸 뒤)는 여기서만 읽는다(마크업 = 하이드레이션 데이터). */
  data: WsFeedData;
}

/** 쿠팡 파트너스 활동 링크 rel(검색 제휴 링크와 같은 토큰 — sponsored 포함). */
export const FEED_REL = 'sponsored nofollow noopener noreferrer';

function coupangOnly(provider: string, where: string): void {
  // 알리 고지 문안(364 §9 K2)이 정해지기 전에는 알리 행을 그리지 않는다 — 조용히 빼지 않고 빌드를 멈춘다(Kenny 결정 대기).
  if (provider !== 'COUPANG') throw new Error(`feed 마크업: ${where} 에 ${provider} 행 — 알리 고지 문안 Kenny 결정 전(364 §9 K2)`);
}

function feedNote(id: string): string {
  return `<p class="ws-t-meta ws-aff-note" id="${a(id)}" data-ws-aff="note-feed">${h(COPY.affiliate.coupang)}</p>`;
}

function thumb(imageUrl: string | null, fallback: PublicPhoto | undefined): string {
  return imageUrl
    ? `<img class="ws-feed-thumb" src="${a(imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : photoTile(fallback, 'ws-feed-photo');
}

function badge(kind: PublicFeedBlock['badge']): string {
  return kind === 'LISTED_PASS'
    ? `<span class="ws-t-label ws-feed-badge ws-feed-badge--listed">${h(COPY.feed.badgeListed)}</span>`
    : `<span class="ws-t-label ws-feed-badge ws-feed-badge--check">${glyphSpan('check')}${h(COPY.feed.badgeCheck)}</span>`;
}

function specText(r: RequirementModel, values: PublicFeedRow['specValues']): string {
  if (values === null) return '';
  const line = specLine(r.item.specSchema, values);
  return line ? `<p class="ws-t-meta ws-feed-spec">${h(`${COPY.feed.specPrefix} · ${line}`)}</p>` : '';
}

function checkedText(checkedOn: string | undefined): string {
  const p = feedCheckedParts(checkedOn);
  if (p === null) throw new Error(`feed 마크업: 확인일 형식 밖 ${String(checkedOn)}`);
  return feedCheckedText(p.month, p.day);
}

function goButton(url: string, noteId: string, compact: boolean): string {
  return `<a class="ws-btn ws-btn--outline ws-feed-go${compact ? ' ws-feed-go--compact' : ''}" href="${a(url)}" target="_blank" rel="${FEED_REL}" aria-describedby="${a(noteId)}" data-ws-merchant="COUPANG">${h(COPY.feed.goCoupang)}<span class="ws-visually-hidden">${h(` ${COPY.a11y.newWindow}`)}</span></a>`;
}

const affLabel = `<span class="ws-t-label ws-muted ws-feed-aff" data-ws-aff="card">${h(COPY.feed.affLabel)}</span>`;

/** L4 아래층 행(§2.1): 썸네일 → 상품명 → 규격 줄(LISTED_PASS) → 배지·제휴 표시 → 가격 줄(full) → 몰 버튼. */
function feedRow(r: RequirementModel, b: PublicFeedBlock, row: PublicFeedRow, noteId: string): string {
  coupangOnly(row.provider, `${b.typeId}/${b.supplyItemId}`);
  const price =
    b.priceCheckedOn !== undefined && row.price
      ? `<p class="ws-t-meta ws-feed-price"><span class="ws-feed-amount">${h(feedPriceText(row.price.amount))}</span><span class="ws-muted">${h(` · ${checkedText(b.priceCheckedOn)} · ${COPY.feed.priceMayDiffer}`)}</span></p>`
      : '';
  return [
    '<li class="ws-feed-row" data-ws-merchant="COUPANG">',
    thumb(row.imageUrl, r.pub.photo),
    '<div class="ws-feed-body">',
    `<p class="ws-t-cta ws-feed-title">${h(row.title)}</p>`,
    b.badge === 'LISTED_PASS' ? specText(r, row.specValues) : '',
    `<p class="ws-feed-meta">${badge(b.badge)}${affLabel}</p>`,
    price,
    goButton(row.url, noteId, false),
    '</div>',
    '</li>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/** L4 피드 블록(§2.4·§3.1) — products 뒤. 블록·행 0 이면 ''(빈 블록 그리지 않음). */
export function feedBlockL4(r: RequirementModel, feed: PageFeed | undefined): string {
  const b = feed?.blocks.get(r.item.id);
  if (!b || b.rows.length === 0) return '';
  const noteId = `ws-aff-feed-${r.item.id}`;
  return [
    '<section class="ws-supply-part ws-feed" data-ws-part="feed" aria-labelledby="ws-feed-title">',
    // 380 S3: 인기순 확인 sort 블록만 「많이 찾는 상품」(client FeedSection 과 같은 규칙).
    `<h3 id="ws-feed-title" class="ws-t-label ws-supply-head">${h(b.popular ? COPY.feed.title : COPY.feed.titleFallback)}</h3>`,
    `<p class="ws-t-meta ws-muted ws-feed-sub">${h(COPY.feed.sub)}</p>`,
    feedNote(noteId),
    '<ul class="ws-feed-rows" role="list">',
    ...b.rows.map((row) => feedRow(r, b, row, noteId)),
    '</ul>',
    '</section>',
  ].join('\n');
}

/** 이 문서에 피드 몰 링크가 그려지는가(푸터 고지 F 유지 — 364 §2.4 D-5). 홈 레일 카드 ≥1 또는 이 L4 품목 블록 행 ≥1. */
export function feedLinksOn(feed: PageFeed | undefined, l4ItemId?: string): boolean {
  if (!feed) return false;
  if (feed.data.rail.length > 0) return true;
  return l4ItemId !== undefined && (feed.blocks.get(l4ItemId)?.rows.length ?? 0) > 0;
}

/** 홈 레일 고지 id(페이지당 1개). */
export const FEED_HOME_NOTE_ID = 'ws-aff-feed-home';

/** 홈 B 레일 피드 카드(§2.2) — 품목명 → 상품명 → 규격 줄 → 배지 → 가격·확인일(full) → 제휴 표시 → 몰 버튼. */
export function feedRailCard(t: TypeModel, c: PublicFeedRailCard, feed: PageFeed): string {
  coupangOnly(c.provider, `${t.id}/${c.supplyItemId} 레일`);
  const r = t.requirements.find((x) => x.item.id === c.supplyItemId);
  if (!r) throw new Error(`feed 마크업: ${t.id} 에 레일 카드 품목 ${c.supplyItemId} 없음`);
  const price =
    feed.data.stage === 'full' && c.price
      ? [
          `<p class="ws-t-meta ws-feed-price"><span class="ws-feed-amount">${h(feedPriceText(c.price.amount))}</span></p>`,
          `<p class="ws-t-meta ws-muted ws-feed-checked">${h(checkedText(feed.data.priceCheckedOn))}</p>`,
        ]
      : [];
  return [
    `<li class="ws-feed-card" data-ws-item="${a(c.supplyItemId)}" data-ws-merchant="COUPANG">`,
    thumb(c.imageUrl, r.pub.photo),
    `<p class="ws-t-label ws-muted ws-feed-item">${h(r.item.name)}</p>`,
    `<p class="ws-t-cta ws-feed-title">${h(c.title)}</p>`,
    specText(r, c.specValues),
    badge('LISTED_PASS'),
    ...price,
    affLabel,
    goButton(c.url, FEED_HOME_NOTE_ID, true),
    '</li>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/** 몰 레일(380 S2) 머리(§2.4): 피드 카드 ≥ 1 일 때만 — 안내(full 단계만, 가격이 없으면 가격 안내 0) + 고지 1회. */
export function feedRailLead(feed: PageFeed | undefined): { lead: string[]; leadHtml: string[] } {
  if (!feed || feed.data.rail.length === 0) return { lead: [], leadHtml: [] };
  return { lead: feed.data.stage === 'full' ? [COPY.feed.homeLead] : [], leadHtml: [feedNote(FEED_HOME_NOTE_ID)] };
}
