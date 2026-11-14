// /vet · /vet/{region} React 페이지(스펙33 §5.8 · §6, 계획 F3-1, D13·D14·D15).
//   데이터 = 같은 문서 ws-data 의 vets 뿐(런타임 /api/vets 0, D13). 순서는 ws-data 그대로(필터는 거르기만).
//   필터(진료 동물·야간·응급)는 상태 + 쿼리, 저장 0. 지역은 URL(링크) — 위치 권한·현위치 조회 0(D14, 불변식 ⑧).
//   지도: 키 있고 SDK 준비 → ≤1023 [목록][지도] 전환(기본 목록) · ≥1024 목록 + 지도 나란히(DR m-7). 키 없음·실패 → 목록 전용(지도 DOM·안내 0).
//   방문 안내(visitNote)는 항상. 제보는 하단 접힘 섹션 → 접수 안내만(D15 — 제보 병원·"제보됨" 배지 0).
//   R4-6(R4 시안 hospital_list·hospital_map): 제목(진료 동물이 정해지면 「{동물} 진료하는 병원」) → 바로 아래 방문 안내 한 줄 →
//     「지역 선택」 → 「{동물} 진료」 필터 → 목록|지도 탭(밑줄) → 병원 0이면 「확인된 병원이 아직 없어요」(허구 병원·지도 예시 그림 0).
//     프리렌더 renderVet(server/src/prerender/pages/misc.ts)과 같은 순서·마크업(제목의 동물은 쿼리를 읽는 클라이언트만).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WsPageData } from '@ws/engine';
import VetMap from '../map/VetMap';
import { hasMapKey, useNaverMapLoader, type MapLoadStatus } from '../map/useNaverMapLoader';
import { copyAt, copyFmt } from '../ui/copyText';
import StateBlock from '../ui/StateBlock';
import { useMediaQuery } from '../ui/useMediaQuery';
import { applyVetFilter, isFiltered, NO_FILTER, parseVetFilter, queryTreats, treatChoices, vetFilterSearch, type VetFilter } from './filters';
import { sortVets } from './order';
import { chipsFromCaptured, chipsFromVets, type RegionChip } from './regionChips';
import VetCard from './VetCard';
import VetReportForm, { VET_REPORT_SECTION_ID } from './VetReportForm';
import '../styles/vet.css';

export const MQ_VET_WIDE = '(min-width: 1024px)';

export interface VetPageProps {
  page: WsPageData;
  /** 같은 문서의 프리렌더 main(지역 칩 읽기용, /vet/{region}). */
  capturedMain: string | null;
}

/** 키가 있고 그릴 병원이 있을 때만 SDK 를 요청한다(키 없음·병원 0 = 스크립트 주입 0). */
function useMapStatus(enabled: boolean): MapLoadStatus {
  const status = useNaverMapLoader(enabled);
  return enabled && hasMapKey() ? status : 'no-key';
}

function FilterChip({ pressed, label, onClick, className = 'ws-filter-chip' }: { pressed: boolean; label: string; onClick(): void; className?: string }) {
  return (
    // 선택 "✓" 접두는 CSS ::before(대체 텍스트 "") — 상태는 aria-pressed 가 말한다(DR M-4). 목록|지도 탭(ws-vet-mode)은 밑줄·굵기로.
    <button type="button" className={className} aria-pressed={pressed} onClick={onClick}>
      {label}
    </button>
  );
}

export default function VetPage({ page, capturedMain }: VetPageProps) {
  const { kind, region } = page.route;
  const vets = useMemo(() => sortVets(page.data.vets), [page.data.vets]); // 홈 B ④ 와 같은 순서(vet/order.ts 단일 출처)
  const types = page.data.types;
  const typeNames = useMemo(() => new Map(types.map((t) => [t.id, t.displayName])), [types]);
  const choices = useMemo(() => treatChoices(types, vets), [types, vets]);

  const [filter, setFilter] = useState<VetFilter>(() =>
    parseVetFilter(
      typeof window === 'undefined' ? '' : window.location.search,
      choices.map((c) => c.id),
    ),
  );
  const shown = useMemo(() => applyVetFilter(vets, filter), [vets, filter]);
  // R4-6: 병원 0(필터 칩 없음)이면 홈에서 실어 온 ?treats= 노출 타입을 제목에만 쓴다(최초 진입 값, 거르기 0).
  const [fromQuery] = useState(() =>
    queryTreats(
      typeof window === 'undefined' ? '' : window.location.search,
      types.map((t) => t.id),
    ),
  );
  const titleAnimal = typeNames.get(filter.treats ?? (vets.length === 0 ? fromQuery ?? '' : '')) ?? null;

  // 필터 변경 안내(sr-only live): 필터를 건드린 뒤에만 채운다. 지역이 바뀌면(touchedRegion 불일치) 다시 비운다.
  const [touchedRegion, setTouchedRegion] = useState<string | null>(null);
  const changeFilter = (next: VetFilter | ((f: VetFilter) => VetFilter)) => {
    setTouchedRegion(region ?? '');
    setFilter(next);
  };
  const liveText =
    touchedRegion !== null && touchedRegion === (region ?? '') && vets.length > 0
      ? copyAt(shown.length === 0 ? 'vet.filterNoResult' : 'vet.filterUpdated') ?? ''
      : '';

  // 필터 → 쿼리(replaceState, history.state 는 그대로 — 레이어 state 를 덮지 않는다).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const url = `${window.location.pathname}${vetFilterSearch(filter)}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', url);
  }, [filter]);

  const wide = useMediaQuery(MQ_VET_WIDE);
  const status = useMapStatus(vets.length > 0);
  const mapOn = vets.length > 0 && (status === 'ready' || status === 'loading' || status === 'idle');
  const [mode, setMode] = useState<'list' | 'map'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const selectFromMap = useCallback((id: string) => {
    setSelectedId(id);
    const key = `vetClinics#${id}`;
    const el = Array.from(document.querySelectorAll<HTMLElement>('.ws-vet-page [data-ws-id]')).find((x) => x.getAttribute('data-ws-id') === key);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, []);

  const chips: RegionChip[] = useMemo(() => {
    const all = copyAt('vet.all') ?? '';
    if (kind === 'VET') return chipsFromVets(vets, all);
    const fromHtml = chipsFromCaptured(capturedMain);
    return fromHtml.length > 0 ? fromHtml : chipsFromVets(vets, all);
  }, [kind, vets, capturedMain]);

  // 지역 줄 "옆으로 넘겨 보세요" 힌트: 넘칠 때만(초기 false = 하이드레이션 일치).
  const chipsRef = useRef<HTMLUListElement>(null);
  const [moreHint, setMoreHint] = useState(false);
  const updateMoreHint = useCallback(() => {
    const el = chipsRef.current;
    setMoreHint(el !== null && el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
  }, []);
  useLayoutEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth) {
      const cur = el.querySelector<HTMLElement>('a[aria-current="page"]');
      if (cur) {
        // scrollIntoView 는 Chrome 순차 포커스 시작점을 옮기므로(WCAG 2.4.3) 칩 줄 scrollLeft 만 직접 설정한다.
        const max = Math.max(0, el.scrollWidth - el.clientWidth);
        const target = cur.offsetLeft - (el.clientWidth - cur.offsetWidth) / 2;
        el.scrollLeft = Math.min(max, Math.max(0, target));
      }
    }
    updateMoreHint();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateMoreHint);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chips, region, updateMoreHint]);

  const title = titleAnimal
    ? copyFmt('vet.animalTitle', { animal: titleAnimal })
    : region
      ? copyFmt('vet.regionTitle', { name: region })
      : copyAt('vet.title');
  const layout = mapOn ? 'map' : 'list';
  const showMap = mapOn && (wide || mode === 'map');
  const showList = !mapOn || wide || mode === 'list';

  const openReport = () => {
    setReportOpen(true);
    const el = document.getElementById(VET_REPORT_SECTION_ID);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  };

  const list =
    vets.length === 0 ? (
      <StateBlock kind="empty" mark={false} level={2} title={copyAt('vet.emptyTitle') ?? ''} body={copyAt(region ? 'vet.emptyRegion' : 'vet.emptyAll')}>
        <p className="ws-vet-empty-links">
          <a
            href={`#${VET_REPORT_SECTION_ID}`}
            onClick={(e) => {
              e.preventDefault();
              openReport();
            }}
          >
            {copyAt('vet.reportLink')}
          </a>
          {region ? <a href="/vet">{copyAt('vet.nearbyLink')}</a> : null}
        </p>
      </StateBlock>
    ) : shown.length === 0 ? (
      <div className="ws-vet-empty">
        <p>{copyAt('vet.filterNoResult')}</p>
        <p>
          <button type="button" className="ws-vet-clear" onClick={() => changeFilter(NO_FILTER)}>
            {copyAt('vet.filterClear')}
          </button>
        </p>
      </div>
    ) : (
      <ul className="ws-vets">
        {shown.map((v) => (
          <VetCard key={v.id} vet={v} typeNames={typeNames} selected={v.id === selectedId} level={2} onSelect={setSelectedId} />
        ))}
      </ul>
    );

  // ≤767 지도 모드: 마커로 고른 병원 카드 1장, 없으면 안내.
  const selected = selectedId !== null ? shown.find((v) => v.id === selectedId) ?? null : null;
  const mobileMapFooter =
    !wide && mode === 'map' && mapOn ? (
      selected ? (
        <ul className="ws-vets">
          <VetCard vet={selected} typeNames={typeNames} selected level={2} onSelect={setSelectedId} />
        </ul>
      ) : (
        <p className="ws-vet-hint">{copyAt('vet.mapHint')}</p>
      )
    ) : null;

  return (
    <main id="main" className="ws-page ws-vet-page" data-ws-route={kind} data-ws-vet-layout={layout}>
      <h1>{title}</h1>
      <p className="ws-vet-note">{copyAt('vet.visitNote')}</p>
      <div className="ws-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {liveText}
      </div>
      {chips.length > 0 ? (
        <div className="ws-vet-row ws-vet-row--regions">
          <div className="ws-vet-row-head">
            <p className="ws-vet-row-label" id="ws-vet-regions-label">
              {copyAt('vet.regionsTitle')}
            </p>
            <p className="ws-vet-row-hint" aria-hidden="true" hidden={!moreHint}>
              {copyAt('vet.regionsMore')}
            </p>
          </div>
          <ul ref={chipsRef} className="ws-region-chips" aria-labelledby="ws-vet-regions-label" onScroll={updateMoreHint}>
            {chips.map((c) => (
              <li key={c.href}>
                <a href={`${c.href}${vetFilterSearch(filter)}`} aria-current={(c.region ?? null) === (region ?? null) ? 'page' : undefined}>
                  {c.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {vets.length > 0 ? (
        <div className="ws-vet-row ws-vet-row--filters">
          <div className="ws-vet-row-head">
            <p className="ws-vet-row-label" id="ws-vet-filters-label">
              {copyAt('vet.filtersTitle')}
            </p>
          </div>
        <div className="ws-vet-filters" role="group" aria-labelledby="ws-vet-filters-label">
          {choices.map((t) => (
            <FilterChip
              key={t.id}
              label={copyFmt('vet.treatsChip', { name: t.displayName }) ?? t.displayName}
              pressed={filter.treats === t.id}
              onClick={() => changeFilter((f) => ({ ...f, treats: f.treats === t.id ? null : t.id }))}
            />
          ))}
          {copyAt('vet.night') ? (
            <FilterChip label={copyAt('vet.night') ?? ''} pressed={filter.night} onClick={() => changeFilter((f) => ({ ...f, night: !f.night }))} />
          ) : null}
          {copyAt('vet.emergency') ? (
            <FilterChip
              label={copyAt('vet.emergency') ?? ''}
              pressed={filter.emergency}
              onClick={() => changeFilter((f) => ({ ...f, emergency: !f.emergency }))}
            />
          ) : null}
          {isFiltered(filter) && shown.length > 0 ? (
            <button type="button" className="ws-vet-clear" onClick={() => changeFilter(NO_FILTER)}>
              {copyAt('vet.filterClear')}
            </button>
          ) : null}
        </div>
        </div>
      ) : null}
      {mapOn && !wide ? (
        <div className="ws-vet-modes" role="group">
          <FilterChip className="ws-vet-mode" label={copyAt('vet.listTab') ?? ''} pressed={mode === 'list'} onClick={() => setMode('list')} />
          <FilterChip className="ws-vet-mode" label={copyAt('vet.mapTab') ?? ''} pressed={mode === 'map'} onClick={() => setMode('map')} />
        </div>
      ) : null}
      <div className={mapOn && wide ? 'ws-vet-grid' : 'ws-vet-single'}>
        {showList ? <div className="ws-vet-list">{list}</div> : null}
        {showMap ? (
          <div className="ws-vet-mapcol">
            <VetMap vets={shown} status={status} selectedId={selectedId} onSelect={selectFromMap} />
            {mobileMapFooter}
          </div>
        ) : null}
      </div>
      <VetReportForm types={types} open={reportOpen} onToggle={setReportOpen} />
    </main>
  );
}
