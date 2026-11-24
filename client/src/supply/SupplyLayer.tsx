// L4 용품 상세(UX §4 L4 · 스펙33 §5.1 · 계획 F1-2). 데이터는 같은 문서 ws-data(useLayerPage)만 — 재판정·재정렬 없음.
//   R4-4(R4 시안 l4_supply — 규격 → 검수 → 상인 링크): (고지 B) → 「{동물} · {용품}」 → 메타 행 → 사진 자리(PhotoTile 빈 블록)
//   → (NOT_NOW 이유) → 왜 → 조건(최소|권장 표 + ruleText 목록) → 주의 → 피할 것 → 대안 → 내 케이지 서브카드 → [준비했어요]
//   → 이 항목에 맞는 준비물(ws-data 순서 앞 3) → 검수 내용(마지막 검수 · 출처 · 👍⚠) → 이 조건으로 찾기(SearchBlock, 상인 링크).
//   꼬리: [규격 확인](채움, → L5) | [이 조건으로 찾기](아웃라인, → SearchBlock 스크롤·머리 포커스, D-36).
//   가격·판매처명·"구매"·마스코트 0(불변식 ③⑤). 규격 문장은 엔진 ruleText·chipSpecText·specLine 단일 소스(C-R5-8).
//   사진은 photos.json 슬롯(전부 SLOT → 빈 블록, 생성 이미지 커밋 금지 ①) — 프리렌더 layerL4 와 같은 자리.
import { useId, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { COPY } from '@ws/copy';
import { SPEC_WORDS, chipSpecText, ruleText, specLine, type PublicRequirement, type SpecSchema, type SpecRule } from '@ws/engine';
import { useLayerPage } from '../app/layerPage';
import { toDeriveOptions, useCageCompatState as useChecklistCompat } from '../checklist/cageCompat';
import { deriveChecklist, type ItemState } from '../checklist/derive';
import { useSetup } from '../checklist/setupStore';
import { CAGE_ITEM_ID, toUserContext, useCage } from '../context/cageStore';
import ProductCard from '../home/ProductCard';
import ReactionBar from '../reaction/ReactionBar';
import Glyph, { type GlyphKind } from '../ui/Glyph';
import PhotoTile from '../ui/PhotoTile';
import { LayerBody, LayerFoot, useLayerChrome } from '../ui/layer/Layer';
import type { LayerContentProps } from '../ui/layer/LayerHost';
import AffNote from './AffNote';
import SearchBlock from './SearchBlock';
import { affiliateDisclosureOn } from './searchLinks';
import { useCageCompat, type CageCompat } from './useCageCompat';
import '../styles/layers.css';

/** 상태 칩 문구 키(copy glyphLabel)·클래스. 글리프는 전역 Glyph(R4-1) — LATER 는 글리프 없이 단어만(○ 는 기준 충족 전용). */
const STATE_KEY: Record<ItemState, 'ready' | 'first' | 'check' | 'later'> = { READY: 'ready', FIRST: 'first', CHECK: 'check', LATER: 'later' };
const STATE_GLYPH: Partial<Record<ItemState, GlyphKind>> = { READY: 'ready', FIRST: 'first', CHECK: 'check' };
const MAX_PRODUCTS = 3;
/** photos.json L4 슬롯(l4-cage·l4-bedding·l4-food, 홈 B ITEM_PHOTO 와 같은 표) — 추적용 id, 표시 영향 0. 슬롯 없는 용품은 요약 슬롯 ph-03. */
const L4_PHOTO: Readonly<Record<string, string>> = { cage: 'ph-08', bedding: 'ph-09', food: 'ph-10' };
const L4_PHOTO_FALLBACK = 'ph-03';

/** "YYYY.MM"(프리렌더 yearMonth 와 같은 형식). */
export function yearMonth(d: string | null | undefined): string | null {
  return typeof d === 'string' && /^\d{4}-\d{2}/.test(d) ? `${d.slice(0, 4)}.${d.slice(5, 7)}` : null;
}

/** 조건 목록 한 줄 = 프리렌더와 같은 문장("{ruleText} — {reason}"). 라벨 없는 enum 행은 숨김(null). */
function ruleLines(schema: SpecSchema, rules: SpecRule[]): string[] {
  return rules.flatMap((r) => {
    const t = ruleText(schema, r);
    return t === null ? [] : [r.reason ? `${t} — ${r.reason}` : t];
  });
}

function Part({ part, title, children }: { part: string; title: string; children: ReactNode }) {
  return (
    <section className="ws-supply-part" data-ws-part={part}>
      <h3 className="ws-t-label ws-supply-head">{title}</h3>
      {children}
    </section>
  );
}

/**
 * chipSpecText 결과 "28cm 이상" → 숫자(spec-lg) + " 이상"(meta ink-muted) 분리(스펙33 §5.1 · DR m-1). 접미사가 없으면 전체를 숫자 스타일로.
 *   값이 1개라 필드 이름이 앞에 붙은 "높이 50cm 이상"(356f S1)은 이름을 label 로 떼어 meta 로 — 숫자가 문장에서 가장 크게(브리프).
 *   문구 자체는 엔진 chipSpecText 그대로(재조립 없음, 텍스트 내용 = 엔진 출력).
 */
export function splitChipText(text: string): { label?: string; value: string; suffix: string | null } {
  const tail = ` ${SPEC_WORDS.gte}`;
  const hasTail = text.endsWith(tail);
  const body = hasTail ? text.slice(0, -tail.length) : text;
  const m = /^(\D*?\S)\s+(\d.*)$/.exec(body);
  const head = m ? { label: m[1], value: m[2] } : { value: body };
  return { ...head, suffix: hasTail ? SPEC_WORDS.gte : null };
}

function ChipValue({ text }: { text: string }) {
  const { label, value, suffix } = splitChipText(text);
  return (
    <dd>
      {label ? (
        <>
          <span className="ws-t-meta">{label}</span>{' '}
        </>
      ) : null}
      <span className="ws-t-spec-lg">{value}</span>
      {suffix ? (
        <>
          {' '}
          <span className="ws-t-meta">{suffix}</span>
        </>
      ) : null}
    </dd>
  );
}

function Conditions({ r }: { r: PublicRequirement }) {
  const schema = r.item.specSchema;
  const minChip = chipSpecText(schema, r.minSpec);
  const recChip = chipSpecText(schema, r.recommendedSpec);
  const minLines = ruleLines(schema, r.minSpec.rules);
  const recLines = ruleLines(schema, r.recommendedSpec.rules);
  if (!minChip && !recChip && minLines.length === 0 && recLines.length === 0) return null;
  return (
    <Part part="conditions" title={COPY.supplyLayer.conditions}>
      {minChip || recChip ? (
        <dl className={`ws-cond-table${minChip && recChip ? ' ws-cond-table--2' : ''}`}>
          {minChip ? (
            <div className="ws-cond-cell">
              <dt className="ws-t-meta">{COPY.supplyLayer.min}</dt>
              <ChipValue text={minChip} />
            </div>
          ) : null}
          {recChip ? (
            <div className="ws-cond-cell">
              <dt className="ws-t-meta">{COPY.supplyLayer.recommended}</dt>
              <ChipValue text={recChip} />
            </div>
          ) : null}
        </dl>
      ) : null}
      {[
        [COPY.supplyLayer.min, minLines] as const,
        [COPY.supplyLayer.recommended, recLines] as const,
      ].map(([label, lines]) =>
        lines.length ? (
          <div key={label} className="ws-cond-list">
            <h4 className="ws-t-meta">{label}</h4>
            <ul>
              {lines.map((l, i) => (
                <li key={i} className="ws-t-meta">
                  {l}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </Part>
  );
}

/** 호환 판정 글리프 = L5 호환 단과 같은 표(○ △ ✕, R4-1). */
const COMPAT_GLYPH = { OK: 'ok', CHECK: 'check', BELOW_MIN: 'fail' } as const satisfies Record<string, GlyphKind>;
const COMPAT_WORD = {
  OK: COPY.verdict.compatOk,
  CHECK: COPY.verdict.compatCheck,
  BELOW_MIN: COPY.verdict.compatBelowMin,
} as const;

function CompatSubcard({ compat, checkHref }: { compat: CageCompat; checkHref: string }) {
  if (compat.state === 'none') return null;
  if (compat.state === 'register') {
    return (
      <div className="ws-supply-part" data-ws-part="compat">
        <a className="ws-t-meta ws-compat-link" href={checkHref}>
          {COPY.supplyLayer.compatRegisterLink}
        </a>
      </div>
    );
  }
  return (
    <div className="ws-supply-part" data-ws-part="compat">
      <div className={`ws-compat ws-compat--${compat.verdict.toLowerCase()}`}>
        <p className="ws-t-label">{COPY.supplyLayer.compatSubLabel}</p>
        <p className="ws-compat-verdict ws-t-body">
          <Glyph kind={COMPAT_GLYPH[compat.verdict]} />
          {COMPAT_WORD[compat.verdict]}
        </p>
        {compat.reasons.map((x, i) => (
          <p key={i} className="ws-t-meta">
            {x.message}
          </p>
        ))}
        <p className="ws-t-meta">
          {compat.usedRecommended ? COPY.supplyLayer.compatSubNoteRecommended : COPY.supplyLayer.compatSubNote}
        </p>
      </div>
    </div>
  );
}

export default function SupplyLayer({ props, close }: LayerContentProps) {
  const page = useLayerPage();
  const chrome = useLayerChrome();
  const typeId = typeof props.typeId === 'string' ? props.typeId : '';
  const itemId = typeof props.itemId === 'string' ? props.itemId : '';
  const requirement = page.data.requirements.find((r) => r.animalTypeId === typeId && r.supplyItemId === itemId) ?? null;
  const type = page.data.types.find((t) => t.id === typeId) ?? null;
  const searchHeadId = `ws-search-head-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useLayoutEffect(() => {
    if (requirement && type) {
      chrome.setTitle(requirement.item.name);
    } else close();
  }, [chrome, requirement, type, close]);

  const { setup, purchase } = useSetup(typeId);
  const cageSchema = page.data.requirements.find((r) => r.animalTypeId === typeId && r.supplyItemId === CAGE_ITEM_ID)?.item.specSchema ?? null;
  const { cage } = useCage(typeId, { schema: cageSchema });
  const compat = useCageCompat(page.catalogUrl, typeId, itemId, toUserContext(cage));

  // 홈B·L2 와 같은 △ 입력(케이지 있을 때만 카탈로그 요청, 없으면 undefined — DR#38).
  const reqs = useMemo(() => (requirement ? [requirement] : []), [requirement]);
  const checklistCompat = useChecklistCompat(typeId, reqs, page.catalogUrl, cage);
  const state = useMemo<ItemState | null>(() => {
    if (!requirement || !setup?.answeredAt) return null;
    const row = deriveChecklist([requirement], setup, toDeriveOptions(checklistCompat)).groups.flatMap((g) => g.rows)[0];
    if (!row) return null;
    // 케이지는 있는데 호환 미판정(로드 중·실패) — READY(✓)를 확정하지 않는다(칩 보류).
    if (checklistCompat.pending && row.state === 'READY') return null;
    return row.state;
  }, [requirement, setup, checklistCompat]);

  if (!requirement || !type) return null;
  const r = requirement;
  const base = `/${type.slug}`;
  const href = (p: string) => encodeURI(`${base}${p}`);
  const checkHref = href(`/check/${r.supplyItemId}`);
  const checked = Boolean(setup?.checks[r.supplyItemId]);
  const lm = yearMonth(r.lastVerifiedAt);
  const alts = r.item.alternativeIds.flatMap((id) => {
    const x = page.data.requirements.find((q) => q.animalTypeId === typeId && q.supplyItemId === id);
    return x ? [x] : [];
  });
  const products = page.data.products.filter((p) => p.supplyItemId === r.supplyItemId).slice(0, MAX_PRODUCTS);

  const goSearch = () => {
    const head = document.getElementById(searchHeadId);
    head?.scrollIntoView?.({ block: 'start' });
    head?.focus();
  };

  return (
    <>
      <LayerBody>
        <div className="ws-supply" data-ws-id={`supplyItems#${r.supplyItemId}`}>
          {affiliateDisclosureOn(r.searchLinks) ? <AffNote kind="b" /> : null}
          <p className="ws-t-label ws-supply-eyebrow">{`${type.displayName} · ${r.item.name}`}</p>
          <div className="ws-supply-meta">
            {state ? (
              <span className={`ws-state-chip ws-state-chip--${STATE_KEY[state]} ws-t-label`}>
                {STATE_GLYPH[state] ? <Glyph kind={STATE_GLYPH[state]} /> : null}
                {COPY.glyphLabel[STATE_KEY[state]]}
              </span>
            ) : null}
            <span className="ws-t-meta">{`${COPY.priority[r.priority]} · ${COPY.orderHint[r.orderHint]}`}</span>
          </div>
          <PhotoTile photoId={L4_PHOTO[r.supplyItemId] ?? L4_PHOTO_FALLBACK} className="ws-supply-photo" />

          {r.priority === 'NOT_NOW' ? (
            <section className="ws-supply-part ws-supply-notnow" data-ws-part="notNow">
              <p className="ws-t-body">
                {r.notNowReason ? `${COPY.supplyLayer.notNow} — ${r.notNowReason}` : COPY.supplyLayer.notNow}
              </p>
            </section>
          ) : null}

          <Part part="why" title={COPY.supplyLayer.why}>
            <p className="ws-t-body">{r.why}</p>
          </Part>
          <Conditions r={r} />
          {r.caution ? (
            <Part part="caution" title={COPY.supplyLayer.caution}>
              <p className="ws-t-body">{r.caution}</p>
            </Part>
          ) : null}
          {r.avoid ? (
            <Part part="avoid" title={COPY.supplyLayer.avoid}>
              <p className="ws-t-body">{r.avoid}</p>
            </Part>
          ) : null}
          {alts.length ? (
            <Part part="alternatives" title={COPY.supplyLayer.alternatives}>
              <p className="ws-t-meta">{COPY.supplyLayer.alternativesNote}</p>
              <ul className="ws-supply-alts">
                {alts.map((x) => (
                  <li key={x.supplyItemId} data-ws-id={`supplyItems#${x.supplyItemId}`}>
                    <a href={href(`/supplies/${x.supplyItemId}`)}>{x.item.name}</a>
                  </li>
                ))}
              </ul>
            </Part>
          ) : null}
          <CompatSubcard compat={compat} checkHref={checkHref} />

          <div className="ws-supply-part" data-ws-part="ready">
            <button
              type="button"
              className="ws-btn ws-btn--outline ws-supply-ready"
              aria-pressed={checked}
              onClick={() => purchase(r.supplyItemId)}
            >
              {checked ? <Glyph kind="ready" /> : null}
              {COPY.supplyLayer.markReady}
            </button>
          </div>

          {products.length ? (
            <Part part="products" title={COPY.supplyLayer.matchingProducts}>
              <ul className="ws-supply-products" role="list">
                {products.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    href={href(`/products/${p.id}`)}
                    specLine={specLine(r.item.specSchema, p.specValues) || null}
                    glyph={r.item.glyph}
                  />
                ))}
              </ul>
            </Part>
          ) : null}

          <section className="ws-supply-part ws-supply-verified" data-ws-part="verified">
            {/* 356 K4: 일반 참고 정보면 「검수 내용」·마지막 검수 대신 출처 라벨(고지 문장은 종 페이지 헤더 1회 — 여기 중복 0). */}
            <h3 className="ws-t-label ws-supply-head">{r.generalInfo ? COPY.supplyLayer.source : COPY.supplyLayer.reviewTitle}</h3>
            <p className="ws-t-meta" data-ws-source={r.generalInfo ? 'general-info' : undefined}>
              {r.generalInfo ? COPY.generalInfo.sourceLabel : lm ? `${COPY.supplyLayer.lastVerified} ${lm}` : null}
              {r.source.length ? (
                <>
                  {r.generalInfo || lm ? ' · ' : null}
                  {r.generalInfo ? null : `${COPY.supplyLayer.source} `}
                  {r.source.map((s, i) => (
                    <span key={s.url}>
                      {i > 0 ? ' · ' : null}
                      {/^https:\/\//.test(s.url) ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                          {s.title}
                          <span className="ws-visually-hidden">{` ${COPY.a11y.newWindow}`}</span>
                        </a>
                      ) : (
                        s.title
                      )}
                    </span>
                  ))}
                </>
              ) : null}
            </p>
            <ReactionBar targetType="SUPPLY_ITEM" targetId={r.supplyItemId} />
          </section>

          <div className="ws-supply-part">
            <SearchBlock requirement={r} headingId={searchHeadId} />
          </div>
        </div>
      </LayerBody>
      <LayerFoot>
        <div className="ws-supply-foot">
          <a className="ws-btn ws-btn--fill" href={checkHref}>
            {COPY.supplyLayer.checkSpec}
          </a>
          <button type="button" className="ws-btn ws-btn--outline" onClick={goSearch}>
            {COPY.supplyLayer.findWithCondition}
          </button>
        </div>
      </LayerFoot>
    </>
  );
}
