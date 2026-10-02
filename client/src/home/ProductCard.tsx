// 상품 카드(스펙22 §2.7). 이미지(운영자 자산 imageAsset 만) 또는 대체 타일 → 상품명 → 규격 한 줄 → "✓ 기준 충족" + ♡(비상호작용, D-7).
//   가격·판매처·할인·별점·마스코트 없음. 카드 전체 링크 → L7 문서 이동(/{slug}/products/{id}, 23 D4).
import type { PublicProduct } from '@ws/engine';
import { COPY } from '@ws/copy';
import Glyph from '../ui/Glyph';

const SAME_ORIGIN_ASSET = /^\/assets\/[A-Za-z0-9._/-]+$/;

export interface ProductCardProps {
  product: PublicProduct;
  href: string;
  /** 프리렌더가 만든 규격 한 줄(없으면 생략). */
  specLine: string | null;
  /** 품목 글리프(대체 타일). */
  glyph: string | null;
}

export default function ProductCard({ product, href, specLine, glyph }: ProductCardProps) {
  const img = typeof product.imageAsset === 'string' && SAME_ORIGIN_ASSET.test(product.imageAsset) && !product.imageAsset.includes('..') ? product.imageAsset : null;
  return (
    <li className="ws-product" data-ws-id={`curatedProducts#${product.id}`}>
      <a href={href}>
        {img ? (
          <img src={img} alt={product.title} loading="lazy" decoding="async" width={160} height={160} />
        ) : (
          <span className="ws-tile" aria-hidden="true">
            {glyph ? <span className="ws-tile-glyph">{glyph}</span> : null}
            <span className="ws-tile-label">{COPY.product.imagePending}</span>
          </span>
        )}
        <span className="ws-product-title">{product.title}</span>
        {specLine ? <span className="ws-spec">{specLine}</span> : null}
        <span className="ws-product-foot">
          <span className="ws-badge">
            <Glyph kind="ready" />
            {COPY.product.badge}
          </span>
          <span className="ws-heart" aria-hidden="true">
            {'♡'}
          </span>
        </span>
      </a>
    </li>
  );
}
