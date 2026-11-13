// VerdictCard(스펙33 §3·§4 · 286 U5b 결과 상태) — 판정 = 정보, 추천 아님. 상품 카드·♥·상품명 0(D-43), 대안은 SupplyItem 만.
//   순서: 「{동물} · {용품}」 → 판정 제목 문장 → 「최소 {항목}」 큰 숫자(+ 권장 줄) → 제품 규격 단(「내 {용품}」 입력값 · 아이콘+색+단어 · 차이 줄)
//        → 내 환경 호환 단(엔진 compat ≠ NONE 일 때만, 2단 구조 유지) → 케이지 줄 → 대안 → 검색 블록 → 고정 meta → 검수 meta.
//   숫자는 계산하지 않는다(불변식 ⑥): 큰 숫자 = 해석된 minSpec 규칙 값·Reason.expected, 내 값 = 입력, 차이 = expected − actual(표시용 뺄셈).
//   이유는 엔진 Reason.message 그대로(앞 3개 + "그 밖에 {n}개" 펼침). 낭독용 라이브 영역은 SpecCheckLayer(항상 마운트) — 여기엔 aria-live 없음.
//   카드 속 카드 없음: 테두리 상자 대신 구분선으로 단을 나눈다.
import { forwardRef, useState, type MouseEvent, type ReactNode } from 'react';
import { COPY, formatCopy } from '@ws/copy';
import { specLine, type RuleSet, type SearchLink, type SpecCheckResult, type SpecSchema, type SpecValue } from '@ws/engine';
import SpecSearch from './SpecSearch';
import {
  isProductNoCriteria,
  isSmallOnly,
  mineValue,
  minFigure,
  productMark,
  reasonMessages,
  shortfalls,
  verdictTitle,
  visibleCompatMark,
  type VerdictMark,
} from './verdictView';

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
  /** 해석된 최소 규격(ws-data 요구사항 = 서버 resolveRequirement 결과). 큰 숫자의 유일한 출처. */
  minSpec: RuleSet;
  /** 권장 줄 조각(chipSpecText(recommendedSpec)). */
  recommendedText: string | null;
  /** 이 결과를 만든 엔진 입력(「내 {용품}」 표시용). */
  input: Readonly<Record<string, SpecValue>>;
  alternatives: readonly VerdictAlternative[];
  searchKeyword: string;
  searchLinks: readonly SearchLink[];
  lastVerifiedYm: string | null;
  sourceCount: number;
  /** 제출 회차. */
  seq: number;
  /** 호환 단 아래 케이지 줄(등록·수정 링크) — SpecCheckLayer 가 그린다. */
  contextRow?: ReactNode;
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

function Mark({ mark }: { mark: VerdictMark }) {
  return (
    <p className="ws-verdict-line-mark">
      <span className="ws-verdict-glyph" aria-hidden="true">
        {mark.glyph}
      </span>
      <span className="ws-t-cta">{mark.label}</span>
    </p>
  );
}

/** 스크린리더 낭독 문구 "{제품}. {호환}" — 라이브 영역은 SpecCheckLayer 가 항상 마운트해 갱신한다(WCAG 4.1.3). */
export function verdictLiveText(result: SpecCheckResult, schema: SpecSchema, minSpec: RuleSet): string {
  const product = productMark(result.product.verdict, isProductNoCriteria(result.product), isSmallOnly(schema, result.product, minSpec));
  const compat = visibleCompatMark(result);
  return compat ? `${product.label}. ${compat.label}` : product.label;
}

const VerdictCard = forwardRef<HTMLHeadingElement, VerdictCardProps>(function VerdictCard(p, titleRef) {
  const productStage = p.result.product;
  const small = isSmallOnly(p.schema, productStage, p.minSpec);
  const product = productMark(productStage.verdict, isProductNoCriteria(productStage), small);
  const compat = visibleCompatMark(p.result);
  const title = verdictTitle(p.schema, productStage, p.minSpec, { item: p.itemName, animal: p.animalName });
  const figure = minFigure(p.schema, productStage, p.minSpec);
  const mine = mineValue(figure, p.input);
  const mineText = mine === null ? specLine(p.schema, p.input) : '';
  const gaps = shortfalls(p.schema, productStage, p.minSpec);
  const productMessages = productStage.verdict === 'OK' ? [] : reasonMessages(productStage.reasons);
  const basis = `${p.animalName} ${COPY.verdict.basisSuffix}`;
  const footMeta = [
    basis,
    p.lastVerifiedYm ? `${COPY.supplyLayer.lastVerified} ${p.lastVerifiedYm}` : null,
    p.sourceCount > 0 ? `${COPY.supplyLayer.source} ${p.sourceCount}` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');

  const openAlt = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    p.onOpenAlternative(id);
  };

  return (
    <section className="ws-verdict" role="region" aria-label={COPY.verdict.resultRegion} data-ws-verdict={p.result.verdict}>
      <div className="ws-verdict-top">
        <p className="ws-t-meta ws-spec-muted">{`${p.animalName} · ${p.itemName}`}</p>
        <h3 ref={titleRef} className="ws-t-title ws-verdict-title" tabIndex={-1}>
          {title}
        </h3>
        {figure ? (
          <div className="ws-verdict-figure" data-ws-part="min">
            <p className="ws-t-label ws-verdict-figure-label">{figure.label}</p>
            <p className="ws-verdict-num ws-verdict-num--min">
              <span className="ws-verdict-num-value">{figure.value}</span>
              <span className="ws-verdict-num-unit">{figure.unit ? `${figure.unit} ${figure.suffix}` : figure.suffix}</span>
            </p>
          </div>
        ) : null}
        {p.recommendedText ? <p className="ws-t-meta ws-spec-muted">{`${COPY.verdict.recommended} ${p.recommendedText}`}</p> : null}
      </div>
      <div className={`ws-verdict-line ws-verdict-line--${product.tone}`} data-ws-tier="product" data-ws-tone={product.tone}>
        <p className="ws-t-label ws-verdict-line-head">{formatCopy(COPY.verdict.mine, { name: p.itemName })}</p>
        <div className="ws-verdict-mine">
          {mine !== null ? (
            <p className="ws-verdict-num ws-verdict-num--mine">
              <span className="ws-verdict-num-value">{mine}</span>
              {figure?.unit ? <span className="ws-verdict-num-unit">{figure.unit}</span> : null}
            </p>
          ) : mineText ? (
            <p className="ws-t-body">{mineText}</p>
          ) : null}
          <Mark mark={product} />
        </div>
        {productStage.verdict === 'BELOW_RECOMMENDED' ? <p className="ws-t-meta ws-spec-muted">{COPY.verdict.productBelowRecommended}</p> : null}
        {gaps.map((g) => (
          <p key={g.name} className="ws-t-body ws-verdict-gap">
            {formatCopy(COPY.verdict.shortBy, { name: g.name, n: g.n, unit: g.unit })}
          </p>
        ))}
        <Reasons messages={productMessages} />
      </div>
      {compat ? (
        <div className={`ws-verdict-line ws-verdict-line--${compat.tone}`} data-ws-tier="compat" data-ws-tone={compat.tone}>
          <p className="ws-t-label ws-verdict-line-head">{COPY.verdict.compatLine}</p>
          <Mark mark={compat} />
          <Reasons messages={reasonMessages(p.result.compat.reasons)} />
        </div>
      ) : null}
      {p.contextRow ?? null}
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
});

export default VerdictCard;
