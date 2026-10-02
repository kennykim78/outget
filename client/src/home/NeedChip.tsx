// 지금 필요한 것 칩(스펙22 §2.5). neutral(2질문 전): 글리프·규격 없음(D-4) · first ! · ready ✓ · check △ · later ○.
//   상태는 글리프 + 이름(+ 칩 배경)으로 — 색만으로 말하지 않는다. 누르면 L4 문서 이동(/{slug}/supplies/{item}, 23 D4).
import Glyph, { type GlyphKind } from '../ui/Glyph';

export type NeedState = 'neutral' | 'first' | 'ready' | 'check' | 'later';

const GLYPH_OF: Record<Exclude<NeedState, 'neutral'>, GlyphKind> = { first: 'first', ready: 'ready', check: 'check', later: 'later' };

export interface NeedChipProps {
  /** supplyItemId(data-ws-item). requirementId 는 공개 투영에 없어 data-ws-id 는 프리렌더만 단다. */
  itemId: string;
  name: string;
  state: NeedState;
  href: string;
}

export default function NeedChip({ itemId, name, state, href }: NeedChipProps) {
  return (
    <li data-ws-item={itemId}>
      <a className={`ws-need ws-need--${state}`} href={href} data-ws-state={state}>
        {state !== 'neutral' ? <Glyph kind={GLYPH_OF[state]} labelled /> : null}
        <span className="ws-need-name">{name}</span>
      </a>
    </li>
  );
}
