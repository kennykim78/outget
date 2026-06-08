// 양면 토글 보드 헤더(S1): ⟨대행자⟩⟨구매자 요청⟩⟨할인소식⟩.
// 단일 활성 레이어 선택(라디오 그룹). 색 단독 의존 금지 — aria-pressed + 텍스트.
import type { LayerKind } from './board.types';
import './board.css';

interface LayerToggleProps {
  active: LayerKind;
  onChange: (layer: LayerKind) => void;
}

const LAYERS: { kind: LayerKind; label: string }[] = [
  { kind: 'agents', label: '대행자' },
  { kind: 'requests', label: '구매자 요청' },
  { kind: 'discounts', label: '할인소식' },
];

export default function LayerToggle({ active, onChange }: LayerToggleProps) {
  return (
    <div className="layer-toggle" role="tablist" aria-label="보드 레이어 선택">
      {LAYERS.map(({ kind, label }) => {
        const selected = kind === active;
        return (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={selected}
            className={
              'layer-toggle__btn' +
              (selected ? ' layer-toggle__btn--active' : '')
            }
            onClick={() => onChange(kind)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
