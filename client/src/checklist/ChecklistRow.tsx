// 체크리스트 행(스펙22 §2.10). 왼쪽 전체 = role=checkbox 버튼(글리프 + 이름 + 상자), 오른쪽 › = L4(onOpen 이 있으면 push, 없으면 링크).
//   규격 요약 "{값}{단위} 이상" = 엔진 chipSpecText(스펙33 §0 F3, NOT_NOW 행은 이유 한 줄만). children = 행 아래 보조 줄(내 케이지 링크).
//   상태는 글리프 + 상태 문구(copy, 시각적으로 숨김) + 색 — 색만으로 말하지 않는다. NOT_NOW 는 이유 한 줄(meta, ink-muted).
//   카피는 @ws/copy 경로 조회 — 없으면 그 요소를 그리지 않는다(하드코딩 0).
import type { MouseEvent, ReactNode } from 'react';
import { chipSpecText, type PublicRequirement } from '@ws/engine';
import { COPY } from '@ws/copy';
import { copyAt, copyFmt } from '../ui/copyText';
import Glyph, { type GlyphKind } from '../ui/Glyph';
import type { ChecklistRow as RowView, ItemState } from './derive';

const GLYPH_OF: Record<ItemState, GlyphKind> = { READY: 'ready', FIRST: 'first', CHECK: 'check', LATER: 'later' };

export interface ChecklistRowProps {
  row: RowView;
  href: string;
  onToggle(row: RowView): void;
  /** › 누름 — 주면 기본 이동 대신 호출(레이어 push). 보조키·새 탭은 기본 동작. */
  onOpen?(row: RowView): void;
  children?: ReactNode;
}

/** 행·칩 규격 요약(최소 규격 숫자 gte 만). 없으면 null. */
export function rowSpecText(r: PublicRequirement): string | null {
  return chipSpecText(r.item.specSchema, r.minSpec);
}

function itemName(r: PublicRequirement): string {
  return r.item.name;
}

export default function ChecklistRow({ row, href, onToggle, onOpen, children }: ChecklistRowProps) {
  const r = row.requirement;
  const name = itemName(r);
  const checked = row.source !== null;
  const stateText = copyAt(`glyphLabel.${GLYPH_OF[row.state]}`);
  const ownedText = row.source === 'OWNED' ? copyAt('checklist.owned') : null;
  const detail = copyFmt('checklist.itemDetailAria', { name });
  const notNow = r.priority === 'NOT_NOW';
  const spec = notNow ? null : rowSpecText(r);
  // DR n-5: 호환이 만든 △ 의 이유(CHECK "내 케이지 공간 조건 재확인" · FAIL "현재 케이지 조건에서 최소 요구 미충족").
  //   SPEC_FAIL(arch-23 D-5): 등록 케이지 자체가 최소 규격 미달 — 기존 키 조합 "내 케이지 · 최소 규격 미달".
  const compatReason =
    row.compat === 'CHECK'
      ? COPY.product.reasonCageCheck
      : row.compat === 'FAIL'
        ? COPY.verdict.compatBelowMin
        : row.compat === 'SPEC_FAIL'
          ? `${COPY.cage.title} · ${COPY.verdict.productBelowMin}`
          : null;
  const onMore = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpen || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(row);
  };
  return (
    <li
      className={`ws-check-row${notNow ? ' ws-check-row--later' : ''}${children ? ' ws-check-row--extra' : ''}`} data-ws-id={`supplyRequirements#${r.supplyItemId}`} data-ws-state={row.state}>
      <button type="button" role="checkbox" aria-checked={checked} className="ws-check-toggle" onClick={() => onToggle(row)}>
        <Glyph kind={GLYPH_OF[row.state]} />
        {stateText ? <span className="ws-visually-hidden">{stateText}</span> : null}
        <span className="ws-check-text">
          <span className="ws-t-body ws-check-name">{name}</span>
          {spec ? <span className="ws-t-meta ws-check-muted ws-check-spec">{spec}</span> : null}
          {compatReason ? <span className="ws-t-meta ws-check-compat" data-ws-compat={row.compat ?? undefined}>{compatReason}</span> : null}
          {notNow && r.notNowReason ? <span className="ws-t-meta ws-check-muted">{r.notNowReason}</span> : null}
        </span>
        {ownedText ? <span className="ws-t-meta ws-check-owned">{ownedText}</span> : null}
        <span className={`ws-check-box${checked ? ' ws-check-box--on' : ''}`} aria-hidden="true">
          {checked ? '✓' : ''}
        </span>
      </button>
      <a className="ws-check-more" href={href} aria-label={detail ?? undefined} onClick={onMore}>
        <span aria-hidden="true">›</span>
      </a>
      {children ? <div className="ws-check-extra">{children}</div> : null}
    </li>
  );
}
