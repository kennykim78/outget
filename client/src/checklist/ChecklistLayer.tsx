// L2 체크리스트 + L3 두 질문 스텝(스펙22 §3.4 · PRD US-004·005, 오케스트레이터 결정 a~d).
//   - L3 전(setup 없음 또는 answeredAt null)에는 L3 부터 — 숫자를 보이지 않는다(d).
//   - 건너뛰기 = 답한 것으로 기록(firstTime null, owned []), 이후 숫자 표시(a). setup_started 는 [다음]으로 처음 답할 때 1회.
//   - 완료 = REQUIRED ≥ 1 이고 전부 ✓(△ 는 완료 아님)(b). 100% 도달 순간 setup_100_reached 1회(reached100At — 해제·재도달 재발화 없음).
//   - 저장 불가면 "이 기기에만 저장돼요" 대신 저장 불가 안내 1회(c — 둘은 동시에 나오지 않는다).
//   - 286 U6(R3 시안·K6): 흰 제목 행 「준비 체크리스트」 + 본문 머리(꼭 필요한 것 먼저 · {동물}의 첫 준비예요 · N개 남았어요).
//     진행 막대·요약 눈썹·접힘 없음 — 모든 그룹 항상 펼침. 권장·선택 그룹은 현 노출 규칙 유지(D8 ①, US-005 범위 불변).
//     꼬리 = 주 버튼 「남은 준비물 살펴보기」(D15 ① 첫 미완료 필수 항목의 L4) + 보조 텍스트(다시 설정 · 기기 안내 · 저장 링크).
//   - 데이터는 ws-data PublicRequirement 그대로(재판정 없음, 불변식 ⑥). 저장·이벤트에 좌표·이메일 0(⑧).
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { PublicRequirement } from '@ws/engine';
import { COPY } from '@ws/copy';
import { useLayerPage } from '../app/layerPage';
import { useAnimalSelection } from '../animal/selection';
import { track } from '../events/track';
import { wsStorage } from '../lib/storage';
import { useSaveLinked } from '../save/useSaveLinked';
import { copyAt, copyFmt } from '../ui/copyText';
import { LayerFoot, useLayerChrome } from '../ui/layer/Layer';
import { layerStore, useLayer, type LayerProps } from '../ui/layer/useLayer';
import CageStep from '../context/CageStep';
import { CAGE_ITEM_ID, useCage } from '../context/cageStore';
import { toDeriveOptions, useCageCompatState } from './cageCompat';
import ChecklistRowView from './ChecklistRow';
import { deriveChecklist, type ChecklistRow, type ChecklistView } from './derive';
import SetupQuestions from './SetupQuestions';
import { useSetup } from './setupStore';
import './checklist.css';

const LEAD_ID = 'ws-check-lead';

/** 본문 머리(R3 시안): 제목 · {동물}의 첫 준비예요 · 남은 개수(바뀌면 낭독, aria-live). */
export function ChecklistLead({ view, animal }: { view: ChecklistView; animal: string }) {
  // 케이지 호환 미판정 중에는 완료·남은 개수를 확정하지 않는다(기존 중립 문구).
  const status = view.compatPending
    ? COPY.homeB.nowBeforeSetup
    : view.requiredTotal === 0
      ? COPY.checklist.requiredNone
      : view.allRequiredReady
        ? COPY.checklist.requiredDone
        : copyFmt('checklist.requiredLeft', { n: view.remainingRequired });
  const note = view.allRequiredReady ? copyAt('checklist.recommendedNote') : null;
  const sub = copyFmt('checklist.leadSub', { animal });
  const tone = view.compatPending ? 'pending' : view.requiredTotal === 0 ? 'none' : view.allRequiredReady ? 'done' : 'left';
  return (
    <div className="ws-check-lead">
      <h3 id={LEAD_ID} className="ws-t-display ws-check-lead-title">{COPY.checklist.lead}</h3>
      {sub ? <p className="ws-t-body ws-check-lead-sub">{sub}</p> : null}
      <p className="ws-t-section ws-check-status" data-ws-status={tone} aria-live="polite">
        {status}
      </p>
      {note ? <p className="ws-t-meta ws-check-muted">{note}</p> : null}
    </div>
  );
}

export default function ChecklistLayer({ props }: { props: LayerProps; close(): void }) {
  const layer = useLayer();
  const page = useLayerPage();
  const chrome = useLayerChrome();
  const selection = useAnimalSelection(page.data.types);
  const propType = typeof props.typeId === 'string' ? props.typeId : null;
  const typeId = propType ?? page.route.typeId ?? selection.typeId;
  const type = page.data.types.find((t) => t.id === typeId) ?? null;

  const { setup, answer, toggle, markReached100 } = useSetup(type?.id ?? '');
  const reqs: PublicRequirement[] = useMemo(
    () => (type ? page.data.requirements.filter((r) => r.animalTypeId === type.id) : []),
    [page.data.requirements, type],
  );
  // 내 케이지(L6 스텝) + 호환 △(F2-3): 케이지가 있을 때만 엔진 requirementCompat, 없으면 영향 0.
  const cageSchema = useMemo(() => reqs.find((r) => r.supplyItemId === CAGE_ITEM_ID)?.item.specSchema ?? null, [reqs]);
  const { cage } = useCage(type?.id ?? '', { schema: cageSchema });
  const compatState = useCageCompatState(type?.id ?? '', reqs, page.catalogUrl, cage);
  const view = useMemo(() => deriveChecklist(reqs, setup, toDeriveOptions(compatState)), [reqs, setup, compatState]);
  const answered = setup !== null && setup.answeredAt !== null;
  const [editing, setEditing] = useState(false);
  const cageStep = props.step === 'L6' && answered && cageSchema !== null;
  const step: 'L3' | 'L2' | 'L6' = cageStep ? 'L6' : !answered || editing ? 'L3' : 'L2';

  const linked = useSaveLinked();
  const [notice, setNotice] = useState(false);
  useEffect(() => wsStorage.onUnavailable(() => setNotice(true)), []);

  // 머리: 흰 제목 행만(밴드 없음, 286 U6). L2 = 「준비 체크리스트」, L3·빈 상태 = 「지금 필요한 것」, L6 = CageStep 이 정한다.
  useEffect(() => {
    chrome.setBand(null);
    if (step === 'L6') return;
    chrome.setBack(null);
    chrome.setTitle(step === 'L2' && type && reqs.length > 0 ? COPY.checklist.layerTitle : COPY.homeB.nowTitle);
  }, [chrome, step, type, reqs.length]);

  // 100% 도달 1회.
  useEffect(() => {
    if (!type || !answered || !view.allRequiredReady || !setup || setup.reached100At) return;
    if (markReached100()) {
      const started = Date.parse(setup.startedAt);
      const elapsedSec = Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0;
      track('setup_100_reached', { animalTypeId: type.id, elapsedSec });
    }
  }, [type, answered, view.allRequiredReady, setup, markReached100]);

  // L6: 같은 URL 에 L2 + step 'L6' push(C-R5-5) — 뒤로 = 지금 필요한 것.
  const openCage = useCallback(() => layer.open('L2', { ...props, step: 'L6' }), [layer, props]);
  const backFromCage = useCallback(() => layerStore.back(), []);

  if (!type || reqs.length === 0) {
    return (
      <div className="ws-layer-body">
        <p className="ws-t-body ws-check-muted">{COPY.homeB.nowEmpty}</p>
      </div>
    );
  }

  const allRows = view.groups.flatMap((g) => g.rows);

  if (step === 'L6') {
    return <CageStep typeId={type.id} schema={cageSchema} backLabel={COPY.cage.stepNow} onBack={backFromCage} />;
  }

  if (step === 'L3') {
    return (
      <SetupQuestions
        rows={allRows}
        initial={answered && setup ? { firstTime: setup.firstTime, owned: setup.owned } : null}
        onNext={(a) => {
          const first = !answered;
          answer(a);
          if (first) track('setup_started', { animalTypeId: type.id, firstTime: a.firstTime, ownedCount: a.owned.length });
          setEditing(false);
        }}
        onSkip={() => {
          if (!answered) answer({ firstTime: null, owned: [] });
          setEditing(false);
        }}
      />
    );
  }

  const onToggle = (row: ChecklistRow) => {
    const r = row.requirement;
    const was = row.source;
    toggle(r.supplyItemId);
    track(was ? 'item_unchecked' : 'item_checked', {
      animalTypeId: type.id,
      supplyItemId: r.supplyItemId,
      priority: r.priority,
      readySource: was ?? 'UNKNOWN',
    });
  };
  const href = (r: PublicRequirement) => encodeURI(`/${type.slug}/supplies/${r.item.id}`);
  // › = L4 push(뒤로 = L2).
  const onOpen = (row: ChecklistRow) =>
    layer.open('L4', { typeId: type.id, itemId: row.requirement.supplyItemId }, { url: href(row.requirement) });
  // 케이지 행이 "보유"이거나 케이지가 저장돼 있으면 행 아래 "내 케이지 수정 ›"(저장됨)/"등록 ›"(스펙33 §4 · DR m-3).
  //   케이지 저장이 행을 보유로 바꾸지는 않는다(체크는 사용자 몫).
  const cageExtra = (row: ChecklistRow) =>
    row.requirement.supplyItemId === CAGE_ITEM_ID && (row.source === 'OWNED' || cage !== null) && cageSchema !== null ? (
      <button type="button" className="ws-check-cage ws-check-link ws-t-meta" onClick={openCage}>
        {cage ? COPY.supplyLayer.cageEntryEdit : COPY.supplyLayer.cageEntryRegister}
      </button>
    ) : null;
  const renderRow = (row: ChecklistRow) => (
    <ChecklistRowView key={row.requirement.supplyItemId} row={row} href={href(row.requirement)} onToggle={onToggle} onOpen={onOpen}>
      {cageExtra(row)}
    </ChecklistRowView>
  );
  // 꼬리 저장 링크 → L8 push(진입점 2곳 중 하나, 스펙33 §5.9). 보조키·새 탭은 기본 이동.
  //   save_prompt_view{entry:'l2_footer'} 는 L8(SaveLayer)이 history 깊이로 판정해 보낸다 — 여기서 보내지 않는다(중복 0).
  const onSave = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    layer.open('L8', {}, { url: '/save' });
  };
  const memoryOnly = wsStorage.isMemoryOnly();
  const deviceLine = notice ? COPY.checklist.storageUnavailable : memoryOnly || linked ? null : COPY.homeB.deviceOnly;
  // D15 ①: 주 버튼 = 화면 순서상 첫 미완료 필수 항목(△ 포함)의 L4. 남은 필수가 없으면 주 버튼 없음.
  const next = view.groups.find((g) => g.priority === 'REQUIRED')?.rows.find((row) => row.state !== 'READY') ?? null;
  const onNext = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!next || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(next);
  };

  return (
    <>
      <div className="ws-layer-body ws-check" data-ws-step="L2">
        <ChecklistLead view={view} animal={type.displayName} />
        {view.groups
          .filter((g) => g.rows.length > 0)
          .map((g) =>
            g.priority === 'REQUIRED' ? (
              // 필수 그룹의 제목 = 머리 제목(꼭 필요한 것 먼저) — 별도 「필수」 머리 없음(R3 시안).
              <section key={g.priority} className="ws-check-group" data-ws-group={g.priority} aria-labelledby={LEAD_ID}>
                <ul className="ws-check-list">{g.rows.map(renderRow)}</ul>
              </section>
            ) : (
              <section key={g.priority} className="ws-check-group" data-ws-group={g.priority}>
                <h3 className="ws-t-section ws-check-group-head">{COPY.priority[g.priority]}</h3>
                <ul className="ws-check-list">{g.rows.map(renderRow)}</ul>
              </section>
            ),
          )}
      </div>
      <LayerFoot>
        <div className="ws-check-foot">
          {next ? (
            <a
              className="ws-btn ws-btn--fill ws-check-next"
              href={href(next.requirement)}
              data-ws-next={next.requirement.supplyItemId}
              onClick={onNext}
            >
              {COPY.checklist.nextCta}
            </a>
          ) : null}
          <p className="ws-t-meta ws-check-muted ws-check-aux">
            <button type="button" className="ws-check-link" onClick={() => setEditing(true)}>
              {COPY.checklist.resetSetup}
            </button>
            {deviceLine ? <span data-ws-note={notice ? 'storage-unavailable' : 'device-only'}>{`${deviceLine} · `}</span> : null}
            <a className="ws-check-save" href="/save" onClick={onSave}>{linked ? COPY.checklist.saveLinked : `${COPY.checklist.saveAsk} ›`}</a>
          </p>
        </div>
      </LayerFoot>
    </>
  );
}
