// 양면 보드 조립(S1): 토글 + 지도 + 마커 + 바텀시트 + 필터 + EmptyState.
// 통신판매중개 고지(IntermediaryNotice) 상시.
// 데이터: useListings(자사 /api 상대경로). 거리: useDistance(클라 Haversine).
// 좌표는 어떤 네트워크 호출에도 싣지 않는다(R3). 외부 절대 URL 0(R1).
import { useMemo, useState } from 'react';
import NaverMapShell from '../map/NaverMapShell';
import type {
  AgentProfile,
  DiscountPost as DiscountPostData,
  LayerKind,
  RequestItem,
} from './board.types';
import { useListings } from './useListings';
import { useDistance } from './useDistance';
import type { ClusterNode } from './cluster';
import LayerToggle from './LayerToggle';
import FilterBar, { EMPTY_FILTERS, type BoardFilters } from './FilterBar';
import MapMarkers from './MapMarkers';
import BottomSheet from './BottomSheet';
import EmptyState from './EmptyState';
import AgentCard from './cards/AgentCard';
import RequestCard from './cards/RequestCard';
import DiscountPost from './cards/DiscountPost';
import IntermediaryNotice from './cards/IntermediaryNotice';
import './board.css';

// 선택된 항목(바텀시트) — 레이어별 union.
type Selected =
  | { layer: 'agents'; items: AgentProfile[] }
  | { layer: 'discounts'; items: DiscountPostData[] }
  | null;

export default function BoardView() {
  const [layer, setLayer] = useState<LayerKind>('agents');
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [mapInstance, setMapInstance] = useState<naver.maps.Map | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  // 매칭 진입 결과 알림(placeholder 토스트). 채팅 본체는 Epic5.
  const [matchNotice, setMatchNotice] = useState<string | null>(null);
  // 대행자 시점 토글 — true 면 요청 카드에 채택 액션 노출(역할 인증은 후속).
  const [viewAsAgent, setViewAsAgent] = useState(false);
  // 채택 결과 알림(placeholder). 채팅 본체는 Epic5.
  const [adoptNotice, setAdoptNotice] = useState<string | null>(null);

  const distance = useDistance();

  // 채팅 매칭 진입 — 자사 상대경로 POST /api/matches(본문은 대상 식별자뿐, 좌표 0).
  const handleMatch = (agentId: string) => {
    setMatchNotice(null);
    fetch('/api/matches', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setMatchNotice('매칭이 생성되었습니다. 채팅은 곧 제공됩니다(Epic 5).');
      })
      .catch(() => {
        setMatchNotice('매칭 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      });
  };

  // region 만 서버 필터로(쿼리). 나머지는 클라측.
  const agents = useListings('agents', filters.region);
  const requests = useListings('requests', filters.region);
  const discounts = useListings('discounts', filters.region);

  const current =
    layer === 'agents' ? agents : layer === 'requests' ? requests : discounts;

  // 클라측 필터(보유 데이터 한정) — 외부 호출 0.
  const kw = filters.keyword.trim().toLowerCase();

  const filteredAgents = useMemo(() => {
    return (agents.data as AgentProfile[]).filter((a) => {
      if (filters.status && a.status !== filters.status) return false;
      if (
        filters.schedule &&
        !a.scheduleText.toLowerCase().includes(filters.schedule.toLowerCase())
      )
        return false;
      if (
        kw &&
        !(
          a.activeRegion.toLowerCase().includes(kw) ||
          (a.bizName ?? '').toLowerCase().includes(kw) ||
          a.scheduleText.toLowerCase().includes(kw)
        )
      )
        return false;
      return true;
    });
  }, [agents.data, filters.status, filters.schedule, kw]);

  const filteredRequests = useMemo(() => {
    return (requests.data as RequestItem[]).filter((r) => {
      if (kw && !r.item.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [requests.data, kw]);

  const filteredDiscounts = useMemo(() => {
    return (discounts.data as DiscountPostData[]).filter((d) => {
      if (
        filters.brand &&
        !d.storeBrand.toLowerCase().includes(filters.brand.toLowerCase())
      )
        return false;
      if (kw && !d.storeBrand.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [discounts.data, filters.brand, kw]);

  // 지도 핀 — agents/discounts 만 좌표 보유(requests 는 좌표 없음 → 리스트 전용).
  const agentPins = filteredAgents;
  const discountPins = filteredDiscounts;

  const isEmpty =
    layer === 'agents'
      ? filteredAgents.length === 0
      : layer === 'requests'
        ? filteredRequests.length === 0
        : filteredDiscounts.length === 0;

  return (
    <div className="board-view">
      <div className="board-view__top">
        <LayerToggle active={layer} onChange={(l) => {
          setLayer(l);
          setSelected(null);
        }} />
        <FilterBar layer={layer} value={filters} onChange={setFilters} />
        <IntermediaryNotice />
      </div>

      <div className="board-view__map">
        <NaverMapShell onMapReady={setMapInstance} />

        {/* 좌표 보유 레이어만 마커 부착. */}
        {layer === 'agents' && (
          <MapMarkers<AgentProfile>
            map={mapInstance}
            pins={agentPins}
            onSelect={(node: ClusterNode<AgentProfile>) =>
              setSelected({ layer: 'agents', items: node.items })
            }
          />
        )}
        {layer === 'discounts' && (
          <MapMarkers<DiscountPostData>
            map={mapInstance}
            pins={discountPins}
            onSelect={(node: ClusterNode<DiscountPostData>) =>
              setSelected({ layer: 'discounts', items: node.items })
            }
          />
        )}
      </div>

      {/* 로딩/에러/빈 상태 — 가짜 데이터 없이 안내만. */}
      {current.status === 'loading' && (
        <p className="board-view__status" role="status">불러오는 중…</p>
      )}
      {current.status === 'error' && (
        <div className="board-view__status" role="alert">
          <p>{current.error ?? '목록을 불러오지 못했습니다.'}</p>
          <button type="button" onClick={current.reload}>다시 시도</button>
        </div>
      )}
      {current.status === 'ready' && isEmpty && (
        <EmptyState />
      )}

      {/* requests 는 좌표가 없어 리스트로 표시(지도 핀 없음). */}
      {layer === 'requests' && current.status === 'ready' && !isEmpty && (
        <div className="board-view__list">
          <label className="board-view__viewpoint">
            <input
              type="checkbox"
              checked={viewAsAgent}
              onChange={(e) => {
                setViewAsAgent(e.target.checked);
                setAdoptNotice(null);
              }}
            />
            <span>대행자 시점 (요청 채택)</span>
          </label>
          {adoptNotice && (
            <p className="board-view__match-notice" role="status">
              {adoptNotice}
            </p>
          )}
          {filteredRequests.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              onAdopt={
                viewAsAgent
                  ? () =>
                      setAdoptNotice(
                        '채택됨 · 채팅은 곧 제공됩니다(Epic 5).',
                      )
                  : undefined
              }
            />
          ))}
          <IntermediaryNotice compact />
        </div>
      )}

      {/* 핀 클릭 → 바텀시트 카드. */}
      <BottomSheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="상세"
      >
        {selected?.layer === 'agents' &&
          selected.items.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              distanceLabel={distance.labelTo(a.lat, a.lng)}
              onMatch={handleMatch}
            />
          ))}
        {matchNotice && (
          <p className="board-view__match-notice" role="status">
            {matchNotice}
          </p>
        )}
        {selected?.layer === 'discounts' &&
          selected.items.map((d) => <DiscountPost key={d.id} post={d} />)}
        <IntermediaryNotice compact />
      </BottomSheet>
    </div>
  );
}
