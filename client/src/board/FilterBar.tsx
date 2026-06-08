// 필터 바(S1 보조): 브랜드·지역·일정·지위·키워드.
// region 만 서버 필터(useListings 쿼리)로 올라가고, 나머지는 클라측 필터다 —
// 보유 데이터 한정으로만 거른다(외부 호출 0).
import type { LayerKind } from './board.types';
import './board.css';

export interface BoardFilters {
  /** 서버 쿼리(region=)로 전달. */
  region: string;
  /** 클라측 필터(보유 데이터 한정). */
  brand: string;
  schedule: string;
  status: string; // 대행자 지위('' | '개인' | '전문')
  keyword: string;
}

export const EMPTY_FILTERS: BoardFilters = {
  region: '',
  brand: '',
  schedule: '',
  status: '',
  keyword: '',
};

interface FilterBarProps {
  layer: LayerKind;
  value: BoardFilters;
  onChange: (next: BoardFilters) => void;
}

export default function FilterBar({ layer, value, onChange }: FilterBarProps) {
  const set = (patch: Partial<BoardFilters>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="filter-bar" role="search" aria-label="목록 필터">
      <input
        className="filter-bar__input"
        type="search"
        inputMode="search"
        placeholder="지역(서버 필터)"
        aria-label="지역 필터"
        value={value.region}
        onChange={(e) => set({ region: e.target.value })}
      />

      <input
        className="filter-bar__input"
        type="search"
        placeholder="키워드"
        aria-label="키워드 필터"
        value={value.keyword}
        onChange={(e) => set({ keyword: e.target.value })}
      />

      {layer === 'discounts' && (
        <input
          className="filter-bar__input"
          type="search"
          placeholder="브랜드"
          aria-label="브랜드 필터"
          value={value.brand}
          onChange={(e) => set({ brand: e.target.value })}
        />
      )}

      {layer === 'agents' && (
        <>
          <input
            className="filter-bar__input"
            type="search"
            placeholder="출동일정(텍스트)"
            aria-label="일정 필터"
            value={value.schedule}
            onChange={(e) => set({ schedule: e.target.value })}
          />
          <select
            className="filter-bar__input"
            aria-label="지위 필터"
            value={value.status}
            onChange={(e) => set({ status: e.target.value })}
          >
            <option value="">지위 전체</option>
            <option value="개인">개인</option>
            <option value="전문">전문</option>
          </select>
        </>
      )}
    </div>
  );
}
