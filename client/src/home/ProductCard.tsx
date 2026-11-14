// 상품 카드(스펙22 §2.7). 이미지(운영자 자산 imageAsset 만) 또는 대체 타일 → 상품명 → 규격 한 줄 → "○ 기준 충족". ♥ 는 링크 형제 button.ws-like(D-38, reaction/LikeToggle — 숫자 없음).
//   가격·판매처·할인·별점·마스코트 없음. 카드 전체 링크(/{slug}/products/{id}) → app/layerLinks 가 L7 push(C-R5-5), JS 꺼짐이면 딥링크 문서.
import type { PublicProduct } from '@ws/engine';
import { COPY } from '@ws/copy';
import LikeToggle from '../reaction/LikeToggle';
import Glyph from '../ui/Glyph';

const SAME_ORIGIN_ASSET = /^\/assets\/[A-Za-z0-9._/-]+$/;

/** 운영자 자산(동일 출처 /assets/…)만 — 그 밖은 null(불변식 ①). */
export function safeProductImage(asset: string | null): string | null {
  return typeof asset === 'string' && SAME_ORIGIN_ASSET.test(asset) && !asset.includes('..') ? asset : null;
}

export interface ProductCardProps {
  product: PublicProduct;
  href: string;
  /** 프리렌더가 만든 규격 한 줄(없으면 생략). */
  specLine: string | null;
  /** 품목 글리프(대체 타일). */
  glyph: string | null;
}

export default function ProductCard({ product, href, specLine, glyph }: ProductCardProps) {
  const img = safeProductImage(product.imageAsset);
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
            <Glyph kind="ok" />
            {COPY.product.badge}
          </span>
        </span>
      </a>
      <LikeToggle productId={product.id} />
    </li>
  );
}
