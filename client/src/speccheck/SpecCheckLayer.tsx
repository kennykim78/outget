// L5 규격 확인(UX §4 L5 · 스펙33 §3·§4·§5.2 · PRD US-009·010·011 · 계획 F2-2).
//   specSchema 폼 → [판정하기] → @ws/engine specCheck(+ 내 케이지 UserContext) → VerdictCard(제품 / 내 환경 — NONE 단 생략).
//   - 판정은 제출 시만, 입력이 바뀌면 결과 제거(D-35). 케이지가 바뀌면 같은 입력으로 다시 계산(이벤트 없음 — 제출이 아님).
//   - 이벤트: spec_checker_used 제출당 1, compatibility_checked 확인한 규칙당 1.
//   - L6(내 케이지)는 레이어가 아니라 스텝: 같은 URL 에 step='L6' push → 뒤로 = 규격 확인(C-R5-5).
//   - 카탈로그 로드 전·실패: 폼 비활성(+ 실패 안내). URL·이미지 입력 없음. 결과에 상품·♥·상품명 0(D-43, 불변식 ③).
//   - 데이터: 같은 문서 ws-data 요구사항(useLayerPage) + 공개 카탈로그 엔진. 대상 없으면 닫는다.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COPY } from '@ws/copy';
import { buildSearchLinks, chipSpecText, type SpecCheckResult } from '@ws/engine';
import { useLayerPage } from '../app/layerPage';
import CageStep from '../context/CageStep';
import { CAGE_ITEM_ID, toUserContext, useCage } from '../context/cageStore';
import { track } from '../events/track';
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
  const verdictRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!requirement || !type) {
      close();
      return;
    }
    if (step === 'L5') {
      chrome.setTitle(`${COPY.checkLayer.title} · ${requirement.item.name}`);
      chrome.setBack(null);
    }
  }, [chrome, requirement, type, step, close]);

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
    if (!outcome) return;
    const text = verdictLiveText(outcome.result);
    const id = window.setTimeout(() => setLiveText(text), 150);
    return () => window.clearTimeout(id);
  }, [outcome, outcomeSeq]);

  if (!requirement || !type) return null;

  if (step === 'L6') {
    return <CageStep typeId={typeId} schema={cageSchema} backLabel={COPY.cage.stepSpecCheck} onBack={backFromCage} />;
  }

  const schema = requirement.item.specSchema;
  const minText = chipSpecText(schema, requirement.minSpec);
  const recText = chipSpecText(schema, requirement.recommendedSpec);
  const headMeta = [
    `${type.displayName} ${COPY.verdict.basisSuffix}`,
    minText,
    recText ? `${COPY.verdict.recommended} ${recText}` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');

  const onChange = (key: string, value: string) => {
    setRaw((r) => ({ ...r, [key]: value }));
    setOutcome(null); // D-35
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
    setOutcome({ result, raw: { ...raw }, seq: seq.current });
    track('spec_checker_used', { animalTypeId: typeId, supplyItemId: itemId, verdict: result.verdict });
    for (const r of perRuleVerdicts(result.compat)) {
      track('compatibility_checked', { animalTypeId: typeId, ruleId: r.ruleId, verdict: r.verdict });
    }
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => verdictRef.current?.scrollIntoView?.({ block: 'nearest' }));
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
  const links = buildSearchLinks(keyword);
  const unavailable = catalog.status === 'failed' ? copyAt('checkLayer.unavailable') : null;

  return (
    <div className="ws-spec-layer" data-ws-step="L5">
      <LayerBody>
        <div className="ws-spec-body">
          <div className="ws-visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-ws-live="">
            {liveText}
          </div>
          <p className="ws-t-meta ws-spec-muted">{headMeta}</p>
          <p className="ws-t-body">{COPY.checkLayer.intro}</p>
          {catalog.status === 'failed' ? (
            <p className="ws-t-body ws-spec-notice" role="status" data-ws-notice="catalog">
              {unavailable}
            </p>
          ) : null}
          <form
            id={formId}
            className="ws-spec-formwrap"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            <SpecForm schema={schema} rules={requirement} values={raw} onChange={onChange} disabled={ready === null} />
          </form>
          {cageRule ? (
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
          ) : null}
          {outcome ? (
            <div ref={verdictRef}>
              <VerdictCard
                itemName={requirement.item.name}
                animalName={type.displayName}
                animalTypeId={typeId}
                supplyItemId={itemId}
                result={outcome.result}
                schema={schema}
                minText={minText}
                recommendedText={recText}
                alternatives={alternatives}
                searchKeyword={keyword}
                searchLinks={links}
                lastVerifiedYm={yearMonth(requirement.lastVerifiedAt)}
                sourceCount={requirement.source.length}
                seq={outcome.seq}
                onOpenAlternative={openAlternative}
              />
            </div>
          ) : null}
        </div>
      </LayerBody>
      <LayerFoot>
        <button
          type="submit"
          form={formId}
          className={`ws-btn ${outcome ? 'ws-btn--outline' : 'ws-btn--fill'} ws-spec-submit`}
          disabled={ready === null}
        >
          {COPY.checkLayer.submit}
        </button>
      </LayerFoot>
    </div>
  );
}
