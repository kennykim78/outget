// 지금 필요한 것 칩(스펙22 §2.5). neutral(2질문 전): 글리프·규격 없음(D-4) · first ! · ready ✓ · check △ · later ○.
//   상태는 글리프 + 이름(+ 칩 배경)으로 — 색만으로 말하지 않는다. 링크 /{slug}/supplies/{item} — 같은 문서면 layerLinks 가 L4 push.
//   규격 "{값}{단위} 이상"(스펙33 §0 F3): 엔진 chipSpecText 결과를 spec 으로 받는다(needChipSpec). "↑" 표기 없음. neutral 도 규격 표시(DR M-1).
import { chipSpecText, type PublicRequirement } from '@ws/engine';
import Glyph, { type GlyphKind } from '../ui/Glyph';
import '../checklist/checklist.css';

export type NeedState = 'neutral' | 'first' | 'ready' | 'check' | 'later';

const GLYPH_OF: Record<Exclude<NeedState, 'neutral'>, GlyphKind> = { first: 'first', ready: 'ready', check: 'check', later: 'later' };

export interface NeedChipProps {
  /** supplyItemId(data-ws-item). requirementId 는 공개 투영에 없어 data-ws-id 는 프리렌더만 단다. */
  itemId: string;
  name: string;
  state: NeedState;
  href: string;
  /** 규격 요약(needChipSpec). 문자열이 있으면 neutral 포함 항상 표시(DR M-1 — 프리렌더와 같게, D-4 개정: neutral 은 글리프만 없음). */
  spec?: string | null;
}

/** 칩 규격 요약 = 엔진 chipSpecText(item.specSchema, minSpec). 숫자 최소 규격이 없으면 null. */
export function needChipSpec(r: PublicRequirement): string | null {
  return chipSpecText(r.item.specSchema, r.minSpec);
}

export default function NeedChip({ itemId, name, state, href, spec }: NeedChipProps) {
  const showSpec = typeof spec === 'string' && spec !== '';
  return (
    <li data-ws-item={itemId}>
      <a className={`ws-need ws-need--${state}`} href={href} data-ws-state={state}>
        {state !== 'neutral' ? <Glyph kind={GLYPH_OF[state]} labelled /> : null}
        <span className="ws-need-name">{name}</span>
        {showSpec ? <span className="ws-t-meta ws-need-spec">{spec}</span> : null}
      </a>
    </li>
  );
}
