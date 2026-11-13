// 체크리스트 행(286 U6 · R3 시안: 체크 + 이름 + 이유 한 줄 + ›, 행 높이 PC 76 / 모바일 72).
//   왼쪽 전체 = role=checkbox 버튼(체크 표시 + 이름 + 이유), 오른쪽 › = L4(onOpen 이 있으면 push, 없으면 링크).
//   체크 표시: ✓(준비완료 GLYPH.ready) · △(확인 필요 GLYPH.check — 케이지 호환이 만든 것, 이유 줄이 함께 보인다) · 빈 원(미체크 — 체크박스 모양, 글리프 아님).
//   상태는 표시 + 색 + 상태 문구(copy glyphLabel, 시각적으로 숨김) — 색만으로 말하지 않는다. 별도 상태칩·보유 알약 없음(286 U6).
//   이유 한 줄 = 호환 이유(△) > NOT_NOW 이유(notNowReason) > 시드 why 첫 문장(D9 ① 기계적 절단, 창작 없음).
//   규격 요약 "{값}{단위} 이상" = 엔진 chipSpecText(스펙33 §0 F3) — 이름 옆 meta(NOT_NOW 행 제외). children = 행 아래 보조 줄(내 케이지 링크).
//   카피는 @ws/copy 경로 조회 — 없으면 그 요소를 그리지 않는다(하드코딩 0).
import type { MouseEvent, ReactNode } from 'react';
import { chipSpecText, type PublicRequirement } from '@ws/engine';
import { COPY } from '@ws/copy';
import { copyAt, copyFmt } from '../ui/copyText';
import Glyph, { type GlyphKind } from '../ui/Glyph';
import type { ChecklistRow as RowView, ItemState } from './derive';
import { firstSentence } from './reasonLine';

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

/** DR n-5: 호환이 만든 △ 의 이유(CHECK "공간 조건 재확인" 계열 · FAIL · SPEC_FAIL "내 케이지 · 최소 규격 미달"). */
function compatReasonOf(compat: RowView['compat']): string | null {
  if (compat === 'CHECK') return COPY.product.reasonCageCheck;
  if (compat === 'FAIL') return COPY.verdict.compatBelowMin;
  if (compat === 'SPEC_FAIL') return `${COPY.cage.title} · ${COPY.verdict.productBelowMin}`;
  return null;
}

function Mark({ state }: { state: ItemState }) {
  if (state === 'READY' || state === 'CHECK') {
    return (
      <span className="ws-check-mark" data-ws-mark={state === 'READY' ? 'on' : 'check'}>
        <Glyph kind={GLYPH_OF[state]} />
      </span>
    );
  }
  return (
    <span className="ws-check-mark" data-ws-mark="off" aria-hidden="true">
      <span className="ws-check-circle" />
    </span>
  );
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
  const compatReason = compatReasonOf(row.compat);
  const reason = compatReason ? null : (notNow ? r.notNowReason : null) ?? firstSentence(r.why);
  const onMore = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpen || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(row);
  };
  return (
    <li
      className={`ws-check-row${notNow ? ' ws-check-row--later' : ''}${children ? ' ws-check-row--extra' : ''}`} data-ws-id={`supplyRequirements#${r.supplyItemId}`} data-ws-state={row.state}>
      <button type="button" role="checkbox" aria-checked={checked} className="ws-check-toggle" onClick={() => onToggle(row)}>
        <Mark state={row.state} />
        {stateText ? <span className="ws-visually-hidden">{stateText}</span> : null}
        <span className="ws-check-text">
          <span className="ws-check-nameline">
            <span className="ws-check-name">{name}</span>
            {spec ? <span className="ws-t-meta ws-check-muted ws-check-spec">{spec}</span> : null}
            {ownedText ? <span className="ws-visually-hidden">{ownedText}</span> : null}
          </span>
          {compatReason ? <span className="ws-t-meta ws-check-reason ws-check-compat" data-ws-compat={row.compat ?? undefined}>{compatReason}</span> : null}
          {reason ? <span className="ws-t-meta ws-check-reason">{reason}</span> : null}
        </span>
      </button>
      <a className="ws-check-more" href={href} aria-label={detail ?? undefined} onClick={onMore}>
        <span aria-hidden="true">›</span>
      </a>
      {children ? <div className="ws-check-extra">{children}</div> : null}
    </li>
  );
}
