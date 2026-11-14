// 홈 B(동물 선택) — R4 시안 home_selected(R4-2, 286 §2): 컨텍스트 헤더(눈썹 · 이름 · 바꾸기, 섹션 아님)
//   → 지금 필요한 것(요약 카드 + 남은 필수 항목 카드 · 모바일은 준비완료/아직 준비 중 줄) → 나중에 필요한 것(NOT_NOW 시드 레코드)
//   → {용품} 규격 확인(엔진 minSpecFigure 숫자) → {동물}를 진료하는 병원(안내 + /vet 링크) → 저장 안내(이메일 링크 → L8).
//   숫자·품목명·이유는 전부 ws-data(시드 → resolveRequirement) — 하드코딩 0(불변식 ⑥·⑦). 데이터 없는 섹션은 그리지 않는다.
//   2질문(L3) 전: 개수 숫자 0 — 요약 카드 줄 "필수 준비를 먼저 확인해요", 항목 카드 neutral(글리프 없음).
//   항목 순서 = deriveChecklist 순서(orderHint → 입력 순서) 고정 — 상태로 재정렬하지 않는다(판정 대기 중 순서 흔들림 없음, R4-1 qa 이월).
//   서버 프리렌더 server/src/prerender/pages/type.ts typeMain 이 빈 저장소(L3 전·케이지 없음·미연결) 출력과 같은 태그·클래스·id·aria.
//   route.typeId ≠ 저장된 ws.animalType 이면 저장 + species_selected{via:'url'} 1회(selection 이 같은 값이면 생략).
import { useEffect, useMemo, useRef } from 'react';
import { figureValueText, firstSentence, minSpecFigure, type PublicAnimalType, type PublicRequirement, type WsPageData } from '@ws/engine';
import { COPY, formatCopy, objectParticle } from '@ws/copy';
import { useAnimalSelection } from '../animal/selection';
import { deriveChecklist, type ChecklistRow, type ItemState } from '../checklist/derive';
import { toDeriveOptions, useCageCompatState } from '../checklist/cageCompat';
import { useSetup } from '../checklist/setupStore';
import { CAGE_ITEM_ID, useCage } from '../context/cageStore';
import { useSaveLinked } from '../save/useSaveLinked';
import { PICK_PATH, pickLinkClick } from '../shell/pickLink';
import Glyph from '../ui/Glyph';
import PhotoTile from '../ui/PhotoTile';
import { copyFmt } from '../ui/copyText';
import { NO_FILTER, vetFilterSearch } from '../vet/filters';

export type NowState = 'neutral' | 'first' | 'check' | 'ready' | 'later';
const STATE_OF: Record<ItemState, NowState> = { READY: 'ready', FIRST: 'first', CHECK: 'check', LATER: 'later' };

/** photos.json 슬롯(전부 SLOT → 빈 블록, 생성 이미지 금지 ①) — 추적용 id. 요약 카드 = 사료·급수·은신처 코너, 규격 = 자로 재는 케이지. */
const PHOTO_NOW = 'ph-03';
const PHOTO_SPEC = 'ph-08';
/** 항목 카드 사진 슬롯(L4 슬롯이 있는 항목만, 없으면 요약 카드 슬롯) — 표시 영향 0, 추적용. */
const ITEM_PHOTO: Readonly<Record<string, string>> = { cage: 'ph-08', bedding: 'ph-09', food: 'ph-10' };

export interface HomeBProps {
  page: WsPageData;
  type: PublicAnimalType;
  capturedMain: string | null;
  onOpenL1(): void;
  onOpenL2(): void;
  /** 저장 안내 텍스트 링크 → L8(진입점 1/2, 스펙33 §5.9). */
  onOpenL8(): void;
}

/** 동물 컨텍스트가 있으면 /vet 에 그 동물 필터(VetPage 가 읽는 ?treats=)를 싣는다 — 최초 진입 시에만 적용, 이후는 병원 페이지가 소유. */
export function vetHrefFor(typeId: string): string {
  return `/vet${vetFilterSearch({ ...NO_FILTER, treats: typeId })}`;
}

/**
 * 「{용품} 규격 확인」 대상 — ws-data 순서(서버 t.requirements 와 같은 순서)에서 처음 나오는 REQUIRED 중 최소 규격 숫자(엔진 minSpecFigure)가 있는 것.
 *   서버 typeMain 과 같은 규칙. 없으면 null(섹션 없음).
 */
export function specTarget(reqs: readonly PublicRequirement[]): { r: PublicRequirement; figure: NonNullable<ReturnType<typeof minSpecFigure>> } | null {
  for (const r of reqs) {
    if (r.priority !== 'REQUIRED') continue;
    const figure = minSpecFigure(r.item.specSchema, r.minSpec);
    if (figure) return { r, figure };
  }
  return null;
}

function SectionHead({ id, title, lead }: { id: string; title: string; lead?: string | null }) {
  return (
    <div className="ws-home-sec-head">
      <h2 id={id} className="ws-t-display ws-home-sec-title">
        {title}
      </h2>
      {lead ? <p className="ws-t-body ws-muted ws-home-sec-lead">{lead}</p> : null}
    </div>
  );
}

function Arrow() {
  return <span aria-hidden="true"> →</span>;
}

/** 남은 필수 항목 카드(≥768 그리드 셀). 링크 /{slug}/supplies/{item} — 같은 문서면 layerLinks 가 L4 push. 이유 = 시드 why 첫 문장(D9 ①). */
function NowCard({ row, state, href }: { row: ChecklistRow; state: NowState; href: string }) {
  const r = row.requirement;
  const reason = firstSentence(r.why);
  return (
    <li className="ws-now-item" data-ws-item={r.supplyItemId} data-ws-id={`supplyRequirements#${r.requirementId}`}>
      <a className="ws-now-card" href={href} data-ws-state={state}>
        <PhotoTile photoId={ITEM_PHOTO[r.supplyItemId] ?? PHOTO_NOW} className="ws-now-photo" />
        <span className="ws-t-title ws-now-name">
          {state === 'check' ? <Glyph kind="check" labelled /> : null}
          {r.item.name}
        </span>
        {reason ? <span className="ws-t-body ws-muted ws-now-reason">{reason}</span> : null}
      </a>
    </li>
  );
}

export default function HomeB({ page, type, onOpenL1, onOpenL2, onOpenL8 }: HomeBProps) {
  const { setup } = useSetup(type.id);
  const vetHref = vetHrefFor(type.id);
  const selection = useAnimalSelection(page.data.types);
  const answered = setup !== null && setup.answeredAt !== null;

  // URL 로 들어온 동물을 저장(다르면 1회).
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    if (selection.typeId !== type.id) selection.select(type.id, 'url');
  }, [selection, type.id]);

  const reqs: PublicRequirement[] = useMemo(() => page.data.requirements.filter((r) => r.animalTypeId === type.id), [page.data.requirements, type.id]);
  // △(F2-3 · DR #38): 내 케이지가 있을 때만 엔진 requirementCompat(카탈로그 로드도 그때만) — ChecklistLayer 와 같은 경로.
  const cageSchema = useMemo(() => reqs.find((r) => r.supplyItemId === CAGE_ITEM_ID)?.item.specSchema ?? null, [reqs]);
  const { cage } = useCage(type.id, { schema: cageSchema });
  const compatState = useCageCompatState(type.id, reqs, page.catalogUrl, cage);
  const view = useMemo(() => deriveChecklist(reqs, setup, toDeriveOptions(compatState)), [reqs, setup, compatState]);
  const requiredRows = view.groups.find((g) => g.priority === 'REQUIRED')?.rows ?? [];
  const laterRows = view.groups.find((g) => g.priority === 'NOT_NOW')?.rows ?? [];

  // 숫자 문구는 L3 응답 후에만(answeredAt — 건너뛰기 포함), 케이지 호환 미판정(로드 중·실패)이면 숫자·완료를 확정하지 않는다.
  const counted = answered && !view.compatPending && view.requiredTotal >= 1;
  // 완료는 REQUIRED ≥ 1 이고 전부 ✓ 일 때만(△ 는 미완료) — REQUIRED 0 인 시드가 거짓 완료를 띄우지 않게(K1).
  const allDone = counted && view.allRequiredReady;
  const remaining = view.remainingRequired;
  const countLine =
    view.requiredTotal === 0
      ? COPY.homeB.nowEmpty
      : allDone
        ? COPY.homeB.doneLine
        : counted
          ? copyFmt('homeB.nowCount', { total: view.requiredTotal, n: remaining })
          : COPY.homeB.nowBeforeSetup;
  const ctaLabel = allDone ? COPY.homeB.doneCta : counted ? copyFmt('homeB.nowCta', { n: remaining }) : COPY.homeB.nowCtaStart;

  // 카드 = L3 전엔 필수 전부(neutral), 후엔 준비완료(✓)가 아닌 필수(! · △). 순서는 derive 순서 그대로.
  const cards = answered ? requiredRows.filter((row) => row.state !== 'READY') : requiredRows;
  const readyNames = answered ? requiredRows.filter((row) => row.state === 'READY').map((row) => row.requirement.item.name) : [];
  const pendingNames = cards.map((row) => row.requirement.item.name);
  const itemHref = (row: ChecklistRow) => encodeURI(`/${type.slug}/supplies/${row.requirement.item.id}`);

  const spec = useMemo(() => specTarget(reqs), [reqs]);
  const linked = useSaveLinked();

  return (
    <main id="main" className="ws-page ws-home-b" data-ws-route={page.route.kind} data-ws-type={type.id}>
      <section className="ws-context" data-ws-id={`animalTypes#${type.id}`} aria-labelledby="ws-context-title">
        <div className="ws-context-text">
          <p className="ws-t-meta ws-muted ws-context-eyebrow">{COPY.homeB.contextEyebrow}</p>
          <h1 id="ws-context-title" className="ws-t-display">
            {type.displayName}
          </h1>
        </div>
        <a className="ws-context-change" data-ws-action="change-animal" href={PICK_PATH} aria-label={COPY.nav.changeFriend} onClick={pickLinkClick(onOpenL1)}>
          {COPY.homeB.change}
        </a>
      </section>

      {/* ① 지금 필요한 것 — 채운 CTA 는 이 페이지에 하나(요약 카드) */}
      <section className="ws-home-sec ws-now" data-ws-section="now" data-ws-answered={answered ? '1' : '0'} aria-labelledby="ws-sec-now-title">
        <SectionHead id="ws-sec-now-title" title={COPY.homeB.nowTitle} lead={COPY.homeB.nowLead} />
        <ul className="ws-now-grid" role="list">
          <li className="ws-now-lead">
            <PhotoTile photoId={PHOTO_NOW} className="ws-now-photo" />
            <h3 className="ws-t-title ws-now-name">{COPY.homeB.nowCardTitle}</h3>
            {countLine ? <p className="ws-t-body ws-muted ws-now-count">{countLine}</p> : null}
            <button type="button" className="ws-btn ws-btn--fill ws-now-cta" data-ws-action="open-checklist" onClick={onOpenL2}>
              {ctaLabel}
            </button>
          </li>
          {cards.map((row) => (
            <NowCard key={row.requirement.supplyItemId} row={row} state={answered ? STATE_OF[row.state] : 'neutral'} href={itemHref(row)} />
          ))}
        </ul>
        {readyNames.length > 0 || pendingNames.length > 0 ? (
          <div className="ws-now-lines">
            {readyNames.length > 0 ? (
              <p className="ws-t-body ws-now-line" data-ws-line="ready">
                <Glyph kind="ready" labelled />
                <span>{readyNames.join(' · ')}</span>
              </p>
            ) : null}
            {pendingNames.length > 0 ? (
              <p className="ws-t-body ws-now-line" data-ws-line={answered ? 'pending' : 'all'}>
                {answered ? <span className="ws-muted ws-now-line-label">{COPY.homeB.nowPendingLabel}</span> : null}
                <span>{pendingNames.join(' · ')}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ② 나중에 필요한 것 — NOT_NOW 시드 레코드만(이름 + notNowReason), 0 이면 섹션 없음 */}
      {laterRows.length > 0 ? (
        <section className="ws-home-sec ws-later" data-ws-section="later" aria-labelledby="ws-sec-later-title">
          <SectionHead id="ws-sec-later-title" title={COPY.homeB.laterTitle} />
          <ul className="ws-later-list" role="list">
            {laterRows.map((row) => {
              const r = row.requirement;
              const reason = r.notNowReason ?? firstSentence(r.why);
              return (
                <li key={r.supplyItemId} data-ws-item={r.supplyItemId} data-ws-id={`supplyRequirements#${r.requirementId}`}>
                  <span className="ws-t-cta ws-later-name">{r.item.name}</span>
                  {reason ? <span className="ws-t-body ws-muted ws-later-reason">{reason}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* ③ {용품} 규격 확인 — 엔진 minSpecFigure(규칙 값 그대로), 숫자 규칙 없으면 섹션 없음 */}
      {spec ? (
        <section
          className="ws-home-sec ws-spec-sec"
          data-ws-section="spec"
          data-ws-id={`supplyRequirements#${spec.r.requirementId}`}
          aria-labelledby="ws-sec-spec-title"
        >
          <div className="ws-spec-sec-text">
            <SectionHead id="ws-sec-spec-title" title={formatCopy(COPY.homeB.specTitle, { name: spec.r.item.name })} />
            <p className="ws-t-meta ws-muted ws-spec-sec-basis">{formatCopy(COPY.homeB.specBasis, { animal: type.displayName })}</p>
            <p className="ws-t-section ws-spec-sec-label">
              {spec.figure.base !== null ? formatCopy(COPY.verdict.minOf, { name: spec.figure.base }) : COPY.verdict.minSpecLabel}
            </p>
            <p className="ws-spec-sec-num">
              <span className="ws-spec-sec-value">{figureValueText(spec.figure)}</span>
              {spec.figure.unit ? <span className="ws-spec-sec-unit">{spec.figure.unit}</span> : null}
            </p>
            <a className="ws-home-link" href={encodeURI(`/${type.slug}/check/${spec.r.item.id}`)}>
              {formatCopy(COPY.homeB.specMine, { name: spec.r.item.name })}
              <Arrow />
            </a>
          </div>
          <PhotoTile photoId={PHOTO_SPEC} className="ws-spec-sec-photo" />
        </section>
      ) : null}

      {/* ④ 병원 — 안내 + /vet(?treats=) 링크. 병원 목록·지도는 /vet 페이지(네이버 SDK 는 병원 페이지만) */}
      <section className="ws-home-sec ws-vet-sec" data-ws-section="vet" aria-labelledby="ws-sec-vet-title">
        <SectionHead id="ws-sec-vet-title" title={formatCopy(COPY.homeB.vetTitle, { animal: objectParticle(type.displayName) })} />
        <p className="ws-t-body ws-muted">{COPY.homeB.vetLead}</p>
        <p className="ws-t-body ws-muted">{COPY.homeB.vetAsk}</p>
        <a className="ws-home-link" href={vetHref}>
          {COPY.homeB.vetLink}
          <Arrow />
        </a>
      </section>

      {/* ⑤ 저장 안내 — /save 는 텍스트 링크(L8) */}
      <section className="ws-home-sec ws-save-sec" data-ws-section="save" aria-labelledby="ws-save-title">
        <h2 id="ws-save-title" className="ws-t-display ws-home-sec-title">
          {COPY.homeB.saveTitle}
        </h2>
        <a
          className="ws-home-link ws-save-link"
          href="/save"
          onClick={(e) => {
            // 진입점 1/2(home_band): L8 레이어(push, URL /save). href 는 JS 꺼짐·새 탭용 딥링크 문서.
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onOpenL8();
          }}
        >
          {linked ? (
            COPY.homeB.saveLinked
          ) : (
            <>
              {COPY.homeB.saveLink}
              <Arrow />
            </>
          )}
        </a>
      </section>
    </main>
  );
}
