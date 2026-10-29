// L7 상품 상세(UX §4 L7 · 스펙33 §5.4 · 계획 F1-3). 데이터는 같은 문서 ws-data(useLayerPage)만.
//   순서: 이미지 1:1 160(운영자 자산만, 없으면 대체 타일) → meta "{용품명} · {specLine}" → ✓ 기준 충족 + 검수일 + ♥(공개 수 ≥10 만)
//   → "WithSmall 추천 이유"(템플릿만: reasonCodes + 케이지 호환 줄·규칙 문구) → "{용품명} 기준 보기 ›"(→ L4 — 용품 why 는 L4 에서, DR B-1).
//   꼬리 [이 조건으로 찾기](채움) → SearchBlock 펼침 + meta 가격·판매처 안내.
//   상품별 자유 문구 0(추천 이유는 copy 템플릿 + 케이지 등록 시 호환 규칙 문구만), 가격·판매처명·별점·"구매"·마스코트 0.
//   케이지 호환은 표시만 — 결과가 무엇이든 노출·순서 불변(불변식 ③). 판정 = 상품 실제 규격값 기준 엔진 productCageCompat(작업 183·185, 보유품 근거 없는 항목 제외). counts GET 은 이 레이어에서만(C-R5-3).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COPY, formatCopy } from '@ws/copy';
import { specLine, type PublicProduct, type PublicRequirement } from '@ws/engine';
import { useLayerPage } from '../app/layerPage';
import { toUserContext, useCage, CAGE_ITEM_ID } from '../context/cageStore';
import { track } from '../events/track';
import { safeProductImage } from '../home/ProductCard';
import LikeToggle from '../reaction/LikeToggle';
import { reactionCounts } from '../reaction/reactionStore';
import SearchBlock from '../supply/SearchBlock';
import { yearMonth } from '../supply/SupplyLayer';
import { useProductCageCompat, type CageCompat } from '../supply/useCageCompat';
import Glyph, { type GlyphKind } from '../ui/Glyph';
import { LayerBody, LayerFoot, useLayerChrome } from '../ui/layer/Layer';
import type { LayerContentProps } from '../ui/layer/LayerHost';
import '../styles/layers.css';

const EMPTY_SPEC: PublicProduct['specValues'] = {};

export interface ReasonLine {
  glyph: GlyphKind;
  text: string;
}

/** 추천 이유(템플릿만). SPEC_MET 은 verdict 로 권장/최소, PROFILE_MATCH 는 용품명, 케이지 호환은 결과가 있을 때만. */
export function productReasons(p: PublicProduct, r: PublicRequirement, animal: string, compat: CageCompat): ReasonLine[] {
  const out: ReasonLine[] = p.reasonCodes.map((c) =>
    c === 'SPEC_MET'
      ? { glyph: 'ready', text: formatCopy(p.verdict === 'OK' ? COPY.product.reasonSpecRecommended : COPY.product.reasonSpecMinimum, { animal }) }
      : { glyph: 'ready', text: formatCopy(COPY.product.reasonProfileTpl, { name: r.item.name }) },
  );
  if (compat.state === 'result') {
    if (compat.verdict === 'OK') out.push({ glyph: 'ready', text: COPY.product.reasonCageOk });
    else if (compat.verdict === 'CHECK') out.push({ glyph: 'check', text: COPY.product.reasonCageCheck });
    else out.push({ glyph: 'fail', text: COPY.product.reasonCageBelowMin });
  }
  return out;
}

export default function ProductLayer({ props, close }: LayerContentProps) {
  const page = useLayerPage();
  const chrome = useLayerChrome();
  const productId = typeof props.productId === 'string' ? props.productId : '';
  const typeId = typeof props.typeId === 'string' ? props.typeId : '';
  const product = page.data.products.find((p) => p.id === productId) ?? null;
  const requirement =
    product !== null ? (page.data.requirements.find((r) => r.animalTypeId === typeId && r.supplyItemId === product.supplyItemId) ?? null) : null;
  const type = page.data.types.find((t) => t.id === typeId) ?? null;
  const ok = product !== null && requirement !== null && type !== null;
  const searchHeadId = `ws-search-head-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [searchOpen, setSearchOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (ok && product) chrome.setTitle(product.title);
    else close();
  }, [chrome, ok, product, close]);

  // product_viewed — 이 레이어를 열 때 1회.
  const viewed = useRef(false);
  useEffect(() => {
    if (!ok || !product || viewed.current) return;
    viewed.current = true;
    track('product_viewed', { productId: product.id, supplyItemId: product.supplyItemId });
  }, [ok, product]);

  // ♥ 공개 수 — L7 에서만 GET(≥10 만 숫자).
  useEffect(() => {
    if (!ok || !product) return;
    let alive = true;
    reactionCounts.get([product.id]).then((c) => {
      if (alive) setCount(c[product.id] ?? null);
    });
    return () => {
      alive = false;
    };
  }, [ok, product]);

  useEffect(() => {
    if (!searchOpen) return;
    const head = document.getElementById(searchHeadId);
    head?.scrollIntoView?.({ block: 'start' });
    head?.focus();
  }, [searchOpen, searchHeadId]);

  const cageSchema = page.data.requirements.find((r) => r.animalTypeId === typeId && r.supplyItemId === CAGE_ITEM_ID)?.item.specSchema ?? null;
  const { cage } = useCage(typeId, { schema: cageSchema });
  const userCtx = useMemo(() => toUserContext(cage), [cage]);
  // 작업 183(155 O-1): L7 은 상품 실제 규격값 × 내 케이지(엔진 productCageCompat, 작업 185) — 가상 기준값(requirementCompat) 아님.
  const compat = useProductCageCompat(page.catalogUrl, typeId, product?.supplyItemId ?? '', product?.specValues ?? EMPTY_SPEC, userCtx);

  if (!product || !requirement || !type) return null;
  const p = product;
  const r = requirement;
  const img = safeProductImage(p.imageAsset);
  const spec = specLine(r.item.specSchema, p.specValues);
  const lm = yearMonth(p.specVerifiedAt);
  const reasons = productReasons(p, r, type.displayName, compat);

  return (
    <>
      <LayerBody>
        <div className="ws-product-detail">
          {img ? (
            <img className="ws-product-detail-img" src={img} alt={p.title} decoding="async" width={160} height={160} />
          ) : (
            <span className="ws-tile ws-product-detail-img" aria-hidden="true">
              {r.item.glyph ? <span className="ws-tile-glyph">{r.item.glyph}</span> : null}
              <span className="ws-tile-label">{COPY.product.imagePending}</span>
            </span>
          )}
          <p className="ws-t-meta" data-ws-id={`supplyItems#${r.supplyItemId}`}>
            {spec ? `${r.item.name} · ${spec}` : r.item.name}
          </p>
          <div className="ws-product-detail-row">
            <span className="ws-badge">
              <Glyph kind="ready" />
              {COPY.product.badge}
            </span>
            {lm ? <span className="ws-t-meta">{`${COPY.supplyLayer.lastVerified} ${lm}`}</span> : null}
            <LikeToggle productId={p.id} count={count} />
          </div>
          <section className="ws-supply-part" data-ws-part="reasons">
            <h3 className="ws-t-label ws-supply-head">{COPY.product.reasonsTitle}</h3>
            <ul className="ws-reasons">
              {reasons.map((x, i) => (
                <li key={i} className="ws-t-body" data-ws-reason={x.glyph}>
                  <Glyph kind={x.glyph} />
                  {x.text}
                </li>
              ))}
            </ul>
            {compat.state === 'result'
              ? compat.reasons.map((x, i) => (
                  <p key={i} className="ws-t-meta" data-ws-reason-note="compat">
                    {x.message}
                  </p>
                ))
              : null}
          </section>
          <a className="ws-compat-link" href={encodeURI(`/${type.slug}/supplies/${r.supplyItemId}`)}>
            {formatCopy(COPY.product.supplyBasisLink, { name: r.item.name })}
          </a>
          {searchOpen ? (
            <div className="ws-supply-part">
              <SearchBlock requirement={r} headingId={searchHeadId} />
              <p className="ws-t-meta">{COPY.product.priceNote}</p>
            </div>
          ) : null}
        </div>
      </LayerBody>
      <LayerFoot>
        <button type="button" className="ws-btn ws-btn--fill ws-product-detail-find" aria-expanded={searchOpen} onClick={() => setSearchOpen(true)}>
          {COPY.product.findWithCondition}
        </button>
      </LayerFoot>
    </>
  );
}
