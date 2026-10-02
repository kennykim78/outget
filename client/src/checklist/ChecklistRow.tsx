// 체크리스트 행(스펙22 §2.10). 왼쪽 전체 = role=checkbox 버튼(글리프 + 이름 + 상자), 오른쪽 › = L4 문서 이동(D4).
//   상태는 글리프 + 상태 문구(copy, 시각적으로 숨김) + 색 — 색만으로 말하지 않는다. NOT_NOW 는 이유 한 줄(meta, ink-muted).
//   카피는 @ws/copy 경로 조회 — 없으면 그 요소를 그리지 않는다(하드코딩 0).
import type { PublicRequirement } from '@ws/engine';
import { copyAt, copyFmt } from '../ui/copyText';
import Glyph, { type GlyphKind } from '../ui/Glyph';
import type { ChecklistRow as RowView, ItemState } from './derive';

const GLYPH_OF: Record<ItemState, GlyphKind> = { READY: 'ready', FIRST: 'first', CHECK: 'check', LATER: 'later' };

export interface ChecklistRowProps {
  row: RowView;
  href: string;
  onToggle(row: RowView): void;
}

function itemName(r: PublicRequirement): string {
  return r.item.name;
}

export default function ChecklistRow({ row, href, onToggle }: ChecklistRowProps) {
  const r = row.requirement;
  const name = itemName(r);
  const checked = row.source !== null;
  const stateText = copyAt(`glyphLabel.${GLYPH_OF[row.state]}`);
  const ownedText = row.source === 'OWNED' ? copyAt('checklist.owned') : null;
  const detail = copyFmt('checklist.itemDetailAria', { name });
  const notNow = r.priority === 'NOT_NOW';
  return (
    <li className={`ws-check-row${notNow ? ' ws-check-row--later' : ''}`} data-ws-id={`supplyRequirements#${r.supplyItemId}`} data-ws-state={row.state}>
      <button type="button" role="checkbox" aria-checked={checked} className="ws-check-toggle" onClick={() => onToggle(row)}>
        <Glyph kind={GLYPH_OF[row.state]} />
        {stateText ? <span className="ws-visually-hidden">{stateText}</span> : null}
        <span className="ws-check-text">
          <span className="ws-t-body ws-check-name">{name}</span>
          {notNow && r.notNowReason ? <span className="ws-t-meta ws-check-muted">{r.notNowReason}</span> : null}
        </span>
        {ownedText ? <span className="ws-t-meta ws-check-owned">{ownedText}</span> : null}
        <span className={`ws-check-box${checked ? ' ws-check-box--on' : ''}`} aria-hidden="true">
          {checked ? '✓' : ''}
        </span>
      </button>
      <a className="ws-check-more" href={href} aria-label={detail ?? undefined}>
        <span aria-hidden="true">›</span>
      </a>
    </li>
  );
}
