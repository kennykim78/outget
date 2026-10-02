// 구성안 카드(스펙22 §2.6). 글리프(🌿 BUDGET · ☁ BALANCED · ♻ USED_MIX) → 이름 → 목적 → 개수 → 범위 → 면책(범위 있으면).
//   묶음 판매 표현·상품 이미지 없음. 개수 문구는 copy(bundle.itemCount / bundle.newCount) — 없으면 줄 생략.
import type { PublicBundle } from '@ws/engine';
import { COPY } from '@ws/copy';
import { copyFmt } from '../ui/copyText';

const TIER_GLYPH: Record<PublicBundle['tier'], string> = { BUDGET: '\u{1F33F}', BALANCED: '☁', USED_MIX: '♻' };

export interface BundleCardProps {
  bundle: PublicBundle;
  /** 보유 항목 제외 개수(L3 후·보유 있을 때만). */
  remainingCount: number | null;
}

export default function BundleCard({ bundle, remainingCount }: BundleCardProps) {
  const count =
    remainingCount !== null
      ? copyFmt('bundle.newCount', { n: remainingCount })
      : copyFmt('bundle.itemCount', { n: bundle.itemIds.length });
  return (
    <li className="ws-bundle" data-ws-id={`setupBundles#${bundle.id}`} data-ws-tier={bundle.tier}>
      <span className="ws-bundle-glyph" aria-hidden="true">
        {TIER_GLYPH[bundle.tier]}
      </span>
      <h3 className="ws-t-section">{bundle.name}</h3>
      <p className="ws-t-meta ws-muted">{bundle.purpose}</p>
      {count ? <p className="ws-t-spec">{count}</p> : null}
      {bundle.estimatedRangeText ? (
        <>
          <p className="ws-range ws-t-meta ws-muted">{bundle.estimatedRangeText}</p>
          <p className="ws-range-note ws-t-meta ws-muted">{COPY.setup.priceNote}</p>
        </>
      ) : null}
    </li>
  );
}
