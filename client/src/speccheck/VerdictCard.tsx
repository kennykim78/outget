// VerdictCard(스펙33 §3·§4) — 판정 = 정보, 추천 아님. 상품 카드·♥·상품명 0(D-43), 대안은 SupplyItem 만.
//   순서: 머리 행(종합 글리프 + "{용품} · {동물} 기준") → 제품 규격 단 → 내 환경 호환 단(엔진 compat ≠ NONE 일 때만)
//        → 대안 → 검색 블록 → 고정 meta → "{동물} 기준 · 마지막 검수 YYYY.MM · 출처 {n}".
//   이유는 엔진 Reason.message 그대로(앞 3개 + "그 밖에 {n}개" 펼침). 낭독용 라이브 영역은 SpecCheckLayer(항상 마운트) — 여기엔 aria-live 없음.
import { useState, type MouseEvent } from 'react';
import { COPY, formatCopy } from '@ws/copy';
import type { SearchLink, SpecCheckResult, SpecSchema } from '@ws/engine';
import SpecSearch from './SpecSearch';
import { isProductNoCriteria, overallMark, productHeadline, productMark, reasonMessages, visibleCompatMark, type VerdictMark } from './verdictView';

export interface VerdictAlternative {
  supplyItemId: string;
  name: string;
  /** 같은 문서 ws-data 에 있으면 L4 URL(아니면 글자만). */
  href: string | null;
}

export interface VerdictCardProps {
  itemName: string;
  animalName: string;
  animalTypeId: string;
  supplyItemId: string;
  result: SpecCheckResult;
  schema: SpecSchema;
  /** OK 일 때 이유 자리 meta 조각(최소·권장 chipSpecText). */
  minText: string | null;
  recommendedText: string | null;
  alternatives: readonly VerdictAlternative[];
  searchKeyword: string;
  searchLinks: readonly SearchLink[];
  lastVerifiedYm: string | null;
  sourceCount: number;
  /** 제출 회차. */
  seq: number;
  onOpenAlternative(supplyItemId: string): void;
}

const REASONS_SHOWN = 3;

function Reasons({ messages }: { messages: string[] }) {
  const [all, setAll] = useState(false);
  if (messages.length === 0) return null;
  const shown = all ? messages : messages.slice(0, REASONS_SHOWN);
  const rest = messages.length - shown.length;
  return (
    <>
      <ul className="ws-verdict-reasons">
        {shown.map((m) => (
          <li key={m} className="ws-t-meta">
            {m}
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <button type="button" className="ws-verdict-more ws-t-meta" onClick={() => setAll(true)}>
          {formatCopy(COPY.verdict.moreReasons, { n: rest })}
        </button>
      ) : null}
    </>
  );
}

function TierLine({
  tier,
  head,
  mark,
  headline,
  meta,
  messages,
}: {
  tier: 'product' | 'compat';
  head: string;
  mark: VerdictMark;
  headline: string | null;
  meta: string | null;
  messages: string[];
}) {
  return (
    <div className={`ws-verdict-line ws-verdict-line--${mark.tone}`} data-ws-tier={tier} data-ws-tone={mark.tone}>
      <p className="ws-t-label ws-verdict-line-head">{head}</p>
      <p className="ws-verdict-line-mark">
        <span className="ws-verdict-glyph" aria-hidden="true">
          {mark.glyph}
        </span>
        <span className="ws-t-cta">{mark.label}</span>
      </p>
      {headline ? <p className="ws-t-spec-lg ws-verdict-headline">{headline}</p> : null}
      {meta ? <p className="ws-t-meta ws-spec-muted">{meta}</p> : null}
      <Reasons messages={messages} />
    </div>
  );
}

/** 스크린리더 낭독 문구 "{제품}. {호환}" — 라이브 영역은 SpecCheckLayer 가 항상 마운트해 갱신한다(WCAG 4.1.3). */
export function verdictLiveText(result: SpecCheckResult): string {
  const product = productMark(result.product.verdict, isProductNoCriteria(result.product));
  const compat = visibleCompatMark(result);
  return compat ? `${product.label}. ${compat.label}` : product.label;
}

export default function VerdictCard(p: VerdictCardProps) {
  const product = productMark(p.result.product.verdict, isProductNoCriteria(p.result.product));
  const compat = visibleCompatMark(p.result);
  const overall = overallMark(p.result);
  const basis = `${p.animalName} ${COPY.verdict.basisSuffix}`;
  const okMeta =
    p.result.product.verdict === 'OK'
      ? [p.minText ? `${COPY.verdict.min} ${p.minText}` : null, p.recommendedText ? `${COPY.verdict.recommended} ${p.recommendedText}` : null]
          .filter((x): x is string => x !== null)
          .join(' · ') || null
      : null;
  const productMessages = p.result.product.verdict === 'OK' ? [] : reasonMessages(p.result.product.reasons);
  const footMeta = [
    basis,
    p.lastVerifiedYm ? `${COPY.supplyLayer.lastVerified} ${p.lastVerifiedYm}` : null,
    p.sourceCount > 0 ? `${COPY.supplyLayer.source} ${p.sourceCount}` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');
  const headingId = `ws-verdict-h-${p.supplyItemId}`;

  const openAlt = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    p.onOpenAlternative(id);
  };

  return (
    <section className="ws-verdict" role="region" aria-labelledby={headingId} data-ws-verdict={p.result.verdict}>
      <h3 id={headingId} className="ws-visually-hidden">
        {COPY.verdict.resultRegion}
      </h3>
      <div className="ws-verdict-head">
        <span className={`ws-verdict-overall ws-verdict-overall--${overall.tone}`} aria-hidden="true">
          {overall.glyph}
        </span>
        <span className="ws-visually-hidden">{`${COPY.verdict.overall} ${overall.label}`}</span>
        <span className="ws-t-meta ws-spec-muted">{`${p.itemName} · ${basis}`}</span>
      </div>
      <TierLine
        tier="product"
        head={COPY.verdict.productLine}
        mark={product}
        headline={productHeadline(p.schema, p.result.product)}
        meta={okMeta}
        messages={productMessages}
      />
      {compat ? (
        <TierLine
          tier="compat"
          head={COPY.verdict.compatLine}
          mark={compat}
          headline={null}
          meta={null}
          messages={reasonMessages(p.result.compat.reasons)}
        />
      ) : null}
      {p.alternatives.length > 0 ? (
        <div className="ws-verdict-alts" data-ws-part="alternatives">
          <p className="ws-t-label ws-spec-muted">{COPY.supplyLayer.alternatives}</p>
          <ul>
            {p.alternatives.map((a) => (
              <li key={a.supplyItemId}>
                {a.href ? (
                  <a className="ws-t-cta" href={a.href} onClick={(e) => openAlt(e, a.supplyItemId)}>
                    {a.name}
                  </a>
                ) : (
                  <span className="ws-t-body">{a.name}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <SpecSearch animalTypeId={p.animalTypeId} supplyItemId={p.supplyItemId} keyword={p.searchKeyword} links={p.searchLinks} />
      <p className="ws-t-meta ws-spec-muted">{COPY.verdict.fixedNote}</p>
      <p className="ws-t-meta ws-spec-muted">{footMeta}</p>
    </section>
  );
}
