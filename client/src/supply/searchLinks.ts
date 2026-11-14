// 상인 링크 렌더 필터 + 제휴 고지 판정(261 §1·§2.1, 265 K6) — SearchBlock(L4·L7)·SpecSearch(L5)·레이어 본문 고지 B 공용.
//   허용: SEARCH(kind 없음 포함) = 기존 검색 호스트로 시작하는 href만, AFFILIATE = 레지스트리 prefix + codeRe(@ws/engine affiliateCodeFromHref)만.
//   그 밖의 kind·호스트·코드 형식은 그리지 않는다(fail-closed). 순서는 공급자 순서(쿠팡 → 네이버) 고정 — 제휴 여부로 바뀌지 않는다(불변식 ③).
//   고지 A·B 는 같은 판정(affiliateDisclosureOn: 필터를 통과한 AFFILIATE ≥ 1). 문구 = 서버 COPY.affiliate.coupang 원문(@ws/copy, 한 곳).
//   제휴 호스트 리터럴은 두지 않는다(compliance C10-AFF-HOST — providers.ts 만).
import { PROVIDERS, SEARCH_PROVIDER_ORDER, affiliateCodeFromHref, type SearchLink, type SearchLinkKind, type SearchProvider, type WsPageData } from '@ws/engine';

/** 일반 검색 링크 허용 접두 — 서버 renderableSearchLinks 와 같은 규칙(PROVIDERS 검색 base?param=). */
function searchPrefix(p: SearchProvider): string | null {
  const s = PROVIDERS[p].search;
  return s === null ? null : `${s.base}?${s.param}=`;
}

export interface RenderLink {
  provider: SearchProvider;
  kind: SearchLinkKind;
  href: string;
}

function allowed(l: SearchLink, p: SearchProvider): RenderLink | null {
  if (l.provider !== p || typeof l.href !== 'string') return null;
  if (l.kind === 'AFFILIATE') return affiliateCodeFromHref(p, l.href) !== null ? { provider: p, kind: 'AFFILIATE', href: l.href } : null;
  if (l.kind !== undefined && l.kind !== 'SEARCH') return null;
  const pre = searchPrefix(p);
  return pre !== null && l.href.startsWith(pre) ? { provider: p, kind: 'SEARCH', href: l.href } : null;
}

/** 공급자마다 허용 필터를 통과한 첫 링크 1개(쿠팡 → 네이버). */
export function renderSearchLinks(links: readonly SearchLink[]): RenderLink[] {
  return SEARCH_PROVIDER_ORDER.flatMap((p) => {
    for (const l of links) {
      const ok = allowed(l, p);
      if (ok) return [ok];
    }
    return [];
  });
}

/** 고지 A·B 공통 판정 — 실제로 그릴 링크 중 AFFILIATE 가 있는가. */
export function affiliateDisclosureOn(links: readonly SearchLink[]): boolean {
  return renderSearchLinks(links).some((l) => l.kind === 'AFFILIATE');
}

/** 고지 A id — 정적판(type.ts affNoteId)과 같은 규칙. 레이어는 한 번에 하나라 문서 안에서 유일하다. */
export const affNoteId = (supplyItemId: string): string => `ws-aff-a-${supplyItemId}`;

export const REL_SEARCH = 'noopener noreferrer nofollow';
export const REL_AFFILIATE = 'sponsored nofollow noopener noreferrer';

/**
 * R4-3 푸터 고지 F 판정 — 지금 열린 레이어가 검색 블록을 그리는 L4·L7 이고 그 요구사항에 제휴 링크가 그려지는가.
 *   서버 renderFooter(affOn) 와 같은 규칙(type.ts renderTypePage affReq · misc.ts renderSupplyItem footerAff): L4 = typeId·itemId 요구사항,
 *   L7 = 상품의 supplyItemId 요구사항. L5 는 정적판에 검색 블록이 없어 대상 밖(레이어 안 고지 A·B 는 그대로).
 */
export function layerAffiliateOn(
  page: WsPageData,
  open: { kind: string; props: Readonly<Record<string, unknown>> } | null,
): boolean {
  if (open === null || (open.kind !== 'L4' && open.kind !== 'L7')) return false;
  const typeId = open.props.typeId;
  let itemId = open.props.itemId;
  if (open.kind === 'L7') itemId = page.data.products.find((p) => p.id === open.props.productId)?.supplyItemId;
  if (typeof typeId !== 'string' || typeof itemId !== 'string') return false;
  const r = page.data.requirements.find((x) => x.animalTypeId === typeId && x.supplyItemId === itemId);
  return r !== undefined && affiliateDisclosureOn(r.searchLinks);
}
