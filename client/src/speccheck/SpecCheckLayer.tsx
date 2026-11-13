// L5 크기 확인(UX §4 L5 · 스펙33 §3·§4·§5.2 · PRD US-009·010·011 · 계획 F2-2 · 286 U5a/U5b).
//   입력 상태: 「{동물} · {용품}」 + 질문 문장 + specSchema 폼(숫자 칸 72·단위 칸 안) → [확인하기]
//   → 결과 상태: @ws/engine specCheck(+ 내 케이지 UserContext) → VerdictCard(제품 / 내 환경 — NONE 단 생략) + [{용품} 기준 살펴보기] · 다시 입력하기.
//   - 판정은 제출 시만, 입력이 바뀌면 결과 제거(D-35 — 결과 상태에선 「다시 입력하기」가 결과를 걷고 값은 유지). 케이지가 바뀌면 같은 입력으로 다시 계산(이벤트 없음 — 제출이 아님).
//   - 이벤트: spec_checker_used 제출당 1, compatibility_checked 확인한 규칙당 1.
//   - L6(내 케이지)는 레이어가 아니라 스텝: 같은 URL 에 step='L6' push → 뒤로 = 규격 확인(C-R5-5).
//   - 카탈로그 로드 전·실패: 폼 비활성(+ 실패 안내). URL·이미지 입력 없음. 결과에 상품·♥·상품명 0(D-43, 불변식 ③).
//   - 데이터: 같은 문서 ws-data 요구사항(useLayerPage) + 공개 카탈로그 엔진. 대상 없으면 닫는다.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { COPY, formatCopy } from '@ws/copy';
import { buildSearchLinks, chipSpecText, type SpecCheckResult } from '@ws/engine';
import { useLayerPage } from '../app/layerPage';
import CageStep from '../context/CageStep';
import { CAGE_ITEM_ID, toUserContext, useCage } from '../context/cageStore';
import { track } from '../events/track';
import AffNote from '../supply/AffNote';
import { affiliateDisclosureOn } from '../supply/searchLinks';
import { copyAt } from '../ui/copyText';
import { LayerBody, LayerFoot, useLayerChrome } from '../ui/layer/Layer';
import type { LayerContentProps } from '../ui/layer/LayerHost';
import { layerStore } from '../ui/layer/useLayer';
import SpecForm from './SpecForm';
import { useSpecCatalog } from './useSpecCatalog';
import VerdictCard, { verdictLiveText, type VerdictAlternative } from './VerdictCard';
import { cageSummary, hasCageRule, perRuleVerdicts, toSpecInput, yearMonth } from './verdictView';
import '../styles/speccheck.css';

interface Outcome {
  result: SpecCheckResult;
  /** 이 결과를 만든 입력(케이지 변경 시 재계산용). */
  raw: Record<string, string>;
  seq: number;
}

export default function SpecCheckLayer({ props, close }: LayerContentProps) {
  const page = useLayerPage();
  const chrome = useLayerChrome();
  const formId = useId();
  const typeId = typeof props.typeId === 'string' ? props.typeId : '';
  const itemId = typeof props.itemId === 'string' ? props.itemId : '';
  const step: 'L5' | 'L6' = props.step === 'L6' ? 'L6' : 'L5';
  const type = page.data.types.find((t) => t.id === typeId) ?? null;
  const requirement =
    page.data.requirements.find((r) => r.animalTypeId === typeId && r.supplyItemId === itemId) ?? null;

  const catalog = useSpecCatalog(page.catalogUrl);
  const ready = catalog.status === 'ready' ? catalog.value : null;

  // 케이지 스키마: 같은 문서 ws-data(케이지 요구사항) → 카탈로그 순.
  const cageSchema = useMemo(() => {
    const fromPage = page.data.requirements.find((r) => r.animalTypeId === typeId && r.supplyItemId === CAGE_ITEM_ID);
    if (fromPage) return fromPage.item.specSchema;
    return ready?.catalog.supplyItems.get(CAGE_ITEM_ID)?.specSchema ?? null;
  }, [page.data.requirements, typeId, ready]);
  const { cage } = useCage(typeId, { schema: cageSchema });
  const cageRule = ready !== null && type !== null && hasCageRule(ready.catalog, type.careProfileId, itemId);

  const [raw, setRaw] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const seq = useRef(0);
  const describedId = `${chrome.titleId}-desc`;

  useLayoutEffect(() => {
    if (!requirement || !type) {
      close();
      return;
    }
    if (step === 'L5') {
      chrome.setTitle(COPY.checkLayer.title); // 286 U5a: 제목행 「크기 확인」, 「{동물} · {용품}」은 본문 첫 줄
      chrome.setBack(null);
      chrome.setDescribedBy(describedId); // 대화상자 이름은 「크기 확인」 그대로, 「{동물} · {용품}」 줄은 설명으로 연결
    }
  }, [chrome, requirement, type, step, close, describedId]);

  // 케이지가 바뀌면(L6 저장·지우기, 다른 탭) 결과가 있을 때만 같은 입력으로 다시 계산 — 이벤트 없음.
  const userContext = useMemo(() => toUserContext(cage), [cage]);
  const lastContext = useRef(userContext);
  useEffect(() => {
    if (lastContext.current === userContext) return;
    lastContext.current = userContext;
    if (!ready || !requirement) return;
    setOutcome((o) =>
      o
        ? { ...o, result: ready.engine.specCheck(typeId, itemId, toSpecInput(requirement.item.specSchema, o.raw, requirement), userContext) }
        : o,
    );
  }, [userContext, ready, requirement, typeId, itemId]);

  const openCage = useCallback(() => {
    layerStore.open('L5', { typeId, itemId, step: 'L6' });
  }, [typeId, itemId]);
  const backFromCage = useCallback(() => {
    layerStore.back();
  }, []);

  // 낭독 라이브 영역(WCAG 4.1.3): 항상 마운트. 판정 제출마다(seq) 비우고 약 150ms 뒤 채워
  // 같은 입력·같은 문구도 별개의 변경 2회로 전달되어 다시 읽힌다. 재판정·언마운트 시 타이머 해제.
  const [liveText, setLiveText] = useState('');
  const outcomeSeq = outcome?.seq ?? 0;
  useEffect(() => {
    setLiveText('');
    if (!outcome || !requirement) return;
    const text = verdictLiveText(outcome.result, requirement.item.specSchema, requirement.minSpec);
    const id = window.setTimeout(() => setLiveText(text), 150);
    return () => window.clearTimeout(id);
  }, [outcome, outcomeSeq, requirement]);

  // 286 U5a/U5b 상태 전환 포커스: 제출 → 결과 제목(입력 칸·제출 버튼이 사라진다), 다시 입력하기 → 첫 입력 칸.
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const focusNext = useRef<'title' | 'form' | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'title') titleRef.current?.focus();
    if (target === 'form') formRef.current?.querySelector<HTMLElement>('input, select')?.focus();
  }, [outcomeSeq, outcome]);

  if (!requirement || !type) return null;

  if (step === 'L6') {
    return <CageStep typeId={typeId} schema={cageSchema} backLabel={COPY.cage.stepSpecCheck} onBack={backFromCage} />;
  }

  const schema = requirement.item.specSchema;
  const minText = chipSpecText(schema, requirement.minSpec);
  const recText = chipSpecText(schema, requirement.recommendedSpec);
  // 입력 상태 보조줄 — 값은 해석된 요구사항(ws-data)의 chipSpecText 만. 프리렌더 layerL5 와 같은 조립.
  const headMeta = [
    `${type.displayName} ${COPY.verdict.basisSuffix}`,
    minText ? `${COPY.verdict.min} ${minText}` : null,
    recText ? `${COPY.verdict.recommended} ${recText}` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');

  const onChange = (key: string, value: string) => {
    setRaw((r) => ({ ...r, [key]: value }));
    setOutcome(null); // D-35
  };

  // 286 U5b: 「다시 입력하기」 — 결과를 걷고 같은 값이 든 입력 상태로(값 유지, 이벤트 없음).
  const reenter = () => {
    focusNext.current = 'form';
    setOutcome(null);
  };
  const basisHref = `/${type.slug}/supplies/${itemId}`;
  const openBasis = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    layerStore.open('L4', { typeId, itemId }, { url: basisHref });
  };

  const onSubmit = () => {
    if (!ready) return;
    let result: SpecCheckResult;
    try {
      result = ready.engine.specCheck(typeId, itemId, toSpecInput(schema, raw, requirement), userContext);
    } catch {
      return; // 카탈로그에 이 요구사항이 없음(공개 범위 밖) — 판정하지 않는다.
    }
    seq.current += 1;
    focusNext.current = 'title';
    setOutcome({ result, raw: { ...raw }, seq: seq.current });
    track('spec_checker_used', { animalTypeId: typeId, supplyItemId: itemId, verdict: result.verdict });
    for (const r of perRuleVerdicts(result.compat)) {
      track('compatibility_checked', { animalTypeId: typeId, ruleId: r.ruleId, verdict: r.verdict });
    }
  };

  const alternatives: VerdictAlternative[] = (outcome?.result.alternatives ?? []).map((a) => {
    const inPage = page.data.requirements.some((r) => r.animalTypeId === typeId && r.supplyItemId === a.supplyItemId);
    return { supplyItemId: a.supplyItemId, name: a.name, href: inPage ? `/${type.slug}/supplies/${a.supplyItemId}` : null };
  });
  const openAlternative = (altId: string) =>
    layerStore.open('L4', { typeId, itemId: altId }, { url: `/${type.slug}/supplies/${altId}` });

  // 검색어 = 엔진 buildSearchKeyword(같은 카탈로그), 링크 = buildSearchLinks. 엔진에 없으면 ws-data(빌드 때 같은 함수로 만든 값).
  let keyword = requirement.searchKeyword;
  if (ready) {
    const resolved = ready.engine.resolveRequirement(typeId, itemId);
    if (resolved) {
      try {
        keyword = ready.engine.buildSearchKeyword(typeId, resolved);
      } catch {
        // 동물 없음 — ws-data 값 유지
      }
    }
  }
  // 265: 키워드가 빌드 때와 같으면 ws-data 의 빌드 타임 링크(제휴 링크 포함) — 다르면 일반 검색 링크로 다시 만든다(제휴·고지 0).
  const links = keyword === requirement.searchKeyword ? requirement.searchLinks : buildSearchLinks(keyword);
  const affOn = affiliateDisclosureOn(links);
  const unavailable = catalog.status === 'failed' ? copyAt('checkLayer.unavailable') : null;

  // 케이지 줄(호환 2단의 입력) — 입력 상태는 폼 아래, 결과 상태는 호환 단 바로 아래(VerdictCard contextRow).
  const cageRow = cageRule ? (
    <div className="ws-cage-row" data-ws-cage-row={cage ? 'set' : 'empty'}>
      {cage ? (
        <>
          <span className="ws-t-label ws-spec-muted">{COPY.cage.basis}</span>
          <span className="ws-t-spec">{cageSummary(cage, cageSchema)}</span>
          <button type="button" className="ws-spec-link ws-t-meta" onClick={openCage}>
            {COPY.cage.edit}
          </button>
        </>
      ) : (
        <>
          <span className="ws-t-body ws-spec-muted">{COPY.verdict.compatNoCage}</span>
          <button type="button" className="ws-spec-link ws-t-meta" onClick={openCage}>
            {COPY.cage.register}
          </button>
        </>
      )}
    </div>
  ) : cage && ready !== null && itemId !== CAGE_ITEM_ID ? (
    // DR m-8: 케이지는 있는데 이 용품엔 케이지 규칙이 없음 — 같은 자리에 meta 한 줄, 링크 없음.
    <div className="ws-cage-row ws-cage-row--norule" data-ws-cage-row="norule">
      <span className="ws-t-meta">{COPY.verdict.compatNoRule}</span>
    </div>
  ) : null;

  return (
    <div className="ws-spec-layer" data-ws-step="L5" data-ws-state={outcome ? 'result' : 'input'}>
      <LayerBody>
        <div className="ws-spec-body">
          {affOn ? <AffNote kind="b" /> : null}
          <div className="ws-visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-ws-live="">
            {liveText}
          </div>
          {outcome ? (
            <VerdictCard
              ref={titleRef}
              itemName={requirement.item.name}
              animalName={type.displayName}
              animalTypeId={typeId}
              supplyItemId={itemId}
              result={outcome.result}
              schema={schema}
              minSpec={requirement.minSpec}
              recommendedText={recText}
              input={toSpecInput(schema, outcome.raw, requirement)}
              alternatives={alternatives}
              searchKeyword={keyword}
              searchLinks={links}
              lastVerifiedYm={yearMonth(requirement.lastVerifiedAt)}
              sourceCount={requirement.source.length}
              seq={outcome.seq}
              describedId={describedId}
              contextRow={cageRow}
              onOpenAlternative={openAlternative}
            />
          ) : (
            <>
              <div className="ws-spec-intro">
                <p id={describedId} className="ws-t-meta ws-spec-muted">{`${type.displayName} · ${requirement.item.name}`}</p>
                <h3 className="ws-t-title ws-spec-ask">{formatCopy(COPY.checkLayer.ask, { name: requirement.item.name })}</h3>
                <p className="ws-t-meta ws-spec-muted">{headMeta}</p>
              </div>
              {catalog.status === 'failed' ? (
                <p className="ws-t-body ws-spec-notice" role="status" data-ws-notice="catalog">
                  {unavailable}
                </p>
              ) : null}
              <form
                ref={formRef}
                id={formId}
                className="ws-spec-formwrap"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  onSubmit();
                }}
              >
                <SpecForm schema={schema} rules={requirement} values={raw} onChange={onChange} disabled={ready === null} unitInside />
              </form>
              {cageRow}
            </>
          )}
        </div>
      </LayerBody>
      <LayerFoot>
        {outcome ? (
          // 결과 상태: 채운 버튼 1 = 이 용품 기준(L4, 상인 링크 아님) + 텍스트 링크 「다시 입력하기」.
          <div className="ws-spec-foot">
            <a className="ws-btn ws-btn--fill ws-spec-basis" href={basisHref} onClick={openBasis}>
              {formatCopy(COPY.verdict.seeBasis, { name: requirement.item.name })}
            </a>
            <button type="button" className="ws-spec-link ws-t-meta ws-spec-reenter" onClick={reenter}>
              {COPY.verdict.reenter}
            </button>
          </div>
        ) : (
          <button type="submit" form={formId} className="ws-btn ws-btn--fill ws-spec-submit" disabled={ready === null}>
            {COPY.checkLayer.submit}
          </button>
        )}
      </LayerFoot>
    </div>
  );
}
