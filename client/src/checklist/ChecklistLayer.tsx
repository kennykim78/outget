// L2 체크리스트 + L3 두 질문 스텝(스펙22 §3.4 · PRD US-004·005, 오케스트레이터 결정 a~d).
//   - L3 전(setup 없음 또는 answeredAt null)에는 L3 부터 — 숫자를 보이지 않는다(d).
//   - 건너뛰기 = 답한 것으로 기록(firstTime null, owned []), 이후 숫자 표시(a). setup_started 는 [다음]으로 처음 답할 때 1회.
//   - 완료 = REQUIRED ≥ 1 이고 전부 ✓(△ 는 완료 아님)(b). 100% 도달 순간 setup_100_reached 1회(reached100At — 해제·재도달 재발화 없음).
//   - 저장 불가면 "이 기기에만 저장돼요" 대신 저장 불가 안내 1회(c — 둘은 동시에 나오지 않는다).
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
import { useCageCompat } from './cageCompat';
import ChecklistRowView from './ChecklistRow';
import { deriveChecklist, type ChecklistRow, type ChecklistView } from './derive';
import SetupQuestions from './SetupQuestions';
import { useSetup } from './setupStore';
import './checklist.css';

function SummaryBand({ view, titleId }: { view: ChecklistView; titleId: string }) {
  const title = view.allRequiredReady ? COPY.checklist.requiredDone : copyFmt('checklist.requiredLeft', { n: view.remainingRequired });
  const note = view.allRequiredReady ? copyAt('checklist.recommendedNote') : null;
  return (
    <div className="ws-check-band">
      <p className="ws-t-meta ws-check-muted">{COPY.checklist.summaryTitle}</p>
      <h2 id={titleId} className="ws-t-title" tabIndex={-1}>
        {title}
      </h2>
      <div
        className="ws-check-progress"
        role="progressbar"
        aria-labelledby={titleId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.readyPercent}
      >
        <span className="ws-check-progress-fill" style={{ width: `${view.readyPercent}%` }} />
      </div>
      {note ? <p className="ws-t-meta ws-check-muted">{note}</p> : null}
    </div>
  );
}

function NotNowGroup({ rows, render }: { rows: ChecklistRow[]; render(r: ChecklistRow): JSX.Element }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="ws-check-group" data-ws-group="NOT_NOW">
      <h3 className="ws-t-section ws-check-group-head">
        <button type="button" className="ws-check-fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {`${COPY.priority.NOT_NOW} (${rows.length}) ${open ? '▾' : '▸'}`}
        </button>
      </h3>
      {open ? <ul className="ws-check-list">{rows.map(render)}</ul> : null}
    </section>
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
  const compat = useCageCompat(type?.id ?? '', reqs, page.catalogUrl, cage);
  const view = useMemo(() => deriveChecklist(reqs, setup, compat ? { compat } : undefined), [reqs, setup, compat]);
  const answered = setup !== null && setup.answeredAt !== null;
  const [editing, setEditing] = useState(false);
  const cageStep = props.step === 'L6' && answered && cageSchema !== null;
  const step: 'L3' | 'L2' | 'L6' = cageStep ? 'L6' : !answered || editing ? 'L3' : 'L2';

  const linked = useSaveLinked();
  const [notice, setNotice] = useState(false);
  useEffect(() => wsStorage.onUnavailable(() => setNotice(true)), []);

  // 머리: L2 = 요약 밴드(제목 id=titleId), L3 = 흰 제목 행.
  useEffect(() => {
    if (step === 'L6') {
      chrome.setBand(null); // 제목·뒤로는 CageStep 이 정한다
      return;
    }
    chrome.setBack(null);
    if (step === 'L2' && type && reqs.length > 0) chrome.setBand(<SummaryBand view={view} titleId={chrome.titleId} />);
    else {
      chrome.setBand(null);
      chrome.setTitle(COPY.homeB.nowTitle);
    }
  }, [chrome, step, view, type, reqs.length]);
  useEffect(() => () => chrome.setBand(null), [chrome]);

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
      <button type="button" className="ws-check-cage ws-check-fold ws-t-meta" onClick={openCage}>
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

  return (
    <>
      <div className="ws-layer-body ws-check" data-ws-step="L2">
        {view.groups
          .filter((g) => g.rows.length > 0)
          .map((g) =>
            g.collapsed ? (
              <NotNowGroup key={g.priority} rows={g.rows} render={renderRow} />
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
          <button type="button" className="ws-btn ws-btn--outline" onClick={() => setEditing(true)}>
            {COPY.checklist.resetSetup}
          </button>
          <p className="ws-t-meta ws-check-muted">
            {deviceLine ? <span data-ws-note={notice ? 'storage-unavailable' : 'device-only'}>{`${deviceLine} · `}</span> : null}
            <a className="ws-check-save" href="/save" onClick={onSave}>{linked ? COPY.checklist.saveLinked : `${COPY.checklist.saveAsk} ›`}</a>
          </p>
        </div>
      </LayerFoot>
    </>
  );
}
