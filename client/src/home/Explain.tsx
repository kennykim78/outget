// 홈 A(미선택) 설명 섹션(286 U3c·U3d·U3e, R3 시안 v1b 순서): 「지금 필요 없는 것도 알려 드려요」 → 「숫자로 알려 드려요」 → 「함께 살 집을 살펴봐요」
//   → 「진료하는 병원만 보여 드려요」. 데이터 = ws-data types[0].homeExplain(서버가 엔진 home-a.ts homeAExplainOf 로 대표 타입 노출 요구사항에서 고른 값)
//   · 노출 타입 · 노출 병원(엔진 homeAVetRows 집계) — 품목명·숫자·동물은 시드 노출 값 그대로(하드코딩·창작 0, 불변식 ⑥·⑦).
//   노출 타입이 0이면 아무것도 그리지 않는다(D12 ①). 홈 ws-data 는 요구사항을 싣지 않는다(레이어 직행 판정 불변).
//   대표 타입(D11 ①) = 노출 타입 시드 순 첫 번째(저장된 선택과 무관 — 프리렌더와 같은 DOM). 사진 = ws-data 값(없으면 빈 블록).
//   병원 = 그룹별 진료 타입 집계만 — 지도 그림 없음(사용권 자산 없음, D14), 네이버 지도 SDK 미로드, 위치 0(불변식 ⑧).
//   서버 프리렌더 server/src/prerender/pages/misc.ts homeExplain 과 같은 태그·클래스·id·aria(parity 시험 2종).
import type { HomeAExplain, WsPageData } from '@ws/engine';
import { SPEC_WORDS, figureValueText, homeARepType, homeAVetRows } from '@ws/engine';
import { COPY, formatCopy } from '@ws/copy';
import PhotoTile from '../ui/PhotoTile';
import RailSection from '../ui/RailSection';
import { typeHomeHref } from '../shell/shellType';
import { PickBarArrow } from './Hero';

// 사진(359 단계 5, 감사 356r M2): 설명 장면 = 대표 타입 homeScenes.explainNeed·explainFigures, 함께 살 집 카드 = 종마다 photos.habitat(ws-data 만, 고정 id 0).

function Arrow() {
  return <span aria-hidden="true"> →</span>;
}

function ExplainHead({ id, title, lead }: { id: string; title: string; lead: string }) {
  return (
    <div className="ws-home-sec-head">
      <h2 id={id} className="ws-t-display ws-home-sec-title">
        {title}
      </h2>
      <p className="ws-t-body ws-muted ws-home-sec-lead">{lead}</p>
    </div>
  );
}

function NeedCol({ col, title, rows }: { col: 'need' | 'not-now'; title: string; rows: HomeAExplain['need'] }) {
  return (
    <div className="ws-need-col" data-ws-col={col}>
      <h3 className="ws-t-cta ws-need-col-title">{title}</h3>
      <ul className="ws-need-list" role="list">
        {rows.map((r) => (
          <li key={r.requirementId} className="ws-t-body" data-ws-id={`supplyRequirements#${r.requirementId}`}>
            {r.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Explain({ page }: { page: WsPageData }) {
  const { types, vets } = page.data;
  const rep = homeARepType(types);
  if (!rep) return null;
  const repHome = typeHomeHref(rep);
  const ex = rep.homeExplain;
  const split = ex && ex.need.length > 0 && ex.notNow.length > 0 ? ex : null;
  const figures = ex ? ex.figures : [];
  const rows = homeAVetRows(types, vets);
  return (
    <>
      {split ? (
        <section className="ws-home-sec ws-explain ws-need-split" data-ws-section="need-split" aria-labelledby="ws-sec-need-split-title">
          <div className="ws-explain-text">
            <p className="ws-t-meta ws-eyebrow ws-explain-eyebrow">{formatCopy(COPY.homeA.needEyebrow, { animal: rep.displayName })}</p>
            <ExplainHead id="ws-sec-need-split-title" title={COPY.homeA.needTitle} lead={COPY.homeA.needBody} />
            <a className="ws-home-link" href={repHome}>
              {COPY.homeA.needLink}
              <Arrow />
            </a>
          </div>
          <div className="ws-explain-side">
            <PhotoTile photo={rep.homeScenes?.explainNeed} className="ws-explain-photo" />
            <div className="ws-need-cols">
              <NeedCol col="need" title={COPY.homeA.needCol} rows={split.need} />
              <NeedCol col="not-now" title={COPY.homeA.notNowCol} rows={split.notNow} />
            </div>
          </div>
        </section>
      ) : null}

      {figures.length > 0 ? (
        <section className="ws-home-sec ws-explain ws-figures" data-ws-section="figures" aria-labelledby="ws-sec-figures-title">
          <PhotoTile photo={rep.homeScenes?.explainFigures} className="ws-explain-photo" />
          <div className="ws-explain-text">
            <ExplainHead id="ws-sec-figures-title" title={COPY.homeA.figuresTitle} lead={COPY.homeA.figuresSub} />
            <p className="ws-t-meta ws-eyebrow ws-explain-eyebrow">{formatCopy(COPY.homeA.figuresEyebrow, { animal: rep.displayName })}</p>
            <ul className="ws-figure-list" role="list">
              {figures.map((figure) => (
                <li key={figure.requirementId} className="ws-figure" data-ws-id={`supplyRequirements#${figure.requirementId}`}>
                  <p className="ws-t-section ws-figure-label">{figure.base !== null ? `${figure.itemName} ${figure.base}` : figure.itemName}</p>
                  <p className="ws-figure-num">
                    <span className="ws-figure-value">{figureValueText(figure)}</span>
                    <span className="ws-figure-unit">{figure.unit ? `${figure.unit} ${SPEC_WORDS.gte}` : SPEC_WORDS.gte}</span>
                  </p>
                </li>
              ))}
            </ul>
            <a className="ws-home-link" href={encodeURI(`/${rep.slug}/check/${figures[0].itemId}`)}>
              {COPY.homeA.figuresLink}
              <Arrow />
            </a>
          </div>
        </section>
      ) : null}

      {/* 함께 살 집(D4) — 노출 타입 카드만(PLANNED 는 ws-data types 에 없다), 카드 → 타입 홈. 한 줄 = 시드 oneLiner(없으면 줄 없음). */}
      <RailSection
        id="habitats"
        kind="habitat"
        layout="grid3"
        tone="home"
        title={COPY.homeA.habitatsTitle}
        lead={[COPY.homeA.habitatsLead]}
        prevLabel={null}
        nextLabel={null}
      >
        {types.map((t) => (
          <li key={t.id} className="ws-starter-item">
            <a className="ws-starter ws-habitat" href={typeHomeHref(t)} data-ws-id={`animalTypes#${t.id}`}>
              <PhotoTile photo={t.photos?.habitat} className="ws-starter-photo" />
              <span className="ws-starter-head">
                <span className="ws-t-cta ws-starter-title">{t.displayName}</span>
                <span className="ws-starter-go">
                  <PickBarArrow />
                </span>
              </span>
              {t.oneLiner ? <span className="ws-t-meta ws-muted ws-starter-sub">{t.oneLiner}</span> : null}
            </a>
          </li>
        ))}
      </RailSection>

      <section className="ws-home-sec ws-explain ws-vet-split" data-ws-section="vet-split" aria-labelledby="ws-sec-vet-split-title">
        <div className="ws-explain-text">
          <ExplainHead id="ws-sec-vet-split-title" title={COPY.homeA.vetTitle} lead={COPY.homeA.vetSub} />
          <a className="ws-home-link" href="/vet">
            {COPY.homeB.vetLink}
            <Arrow />
          </a>
        </div>
        <div className="ws-explain-side">
          {rows.length > 0 ? (
            <ul className="ws-vet-rows" role="list">
              {rows.map((row) => (
                <li key={row.group} data-ws-group={row.group}>
                  <span className="ws-t-cta ws-vet-row-name">{formatCopy(COPY.homeA.vetRow, { name: COPY.groups[row.group] })}</span>
                  <span className="ws-t-body ws-muted ws-vet-row-types">{row.types.map((t) => t.displayName).join(' · ')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ws-t-body ws-muted ws-vet-rows-empty">{COPY.homeB.vetEmpty}</p>
          )}
        </div>
      </section>
    </>
  );
}
