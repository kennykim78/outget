// ♥ LikeToggle(스펙33 §2.4 · D-38·D-40). button.ws-like 44×44, 꺼짐 ♡(status-later) · 켜짐 ♥(brand-text), aria-pressed.
//   count 는 L7 에서만 넘긴다(GET counts) — publicLikeCount 를 통과한 ≥10 정수일 때만 숫자, 그 외 숫자 0.
//   켤 때만 reaction_like{productId}. 노출·정렬 영향 0(불변식 ③).
import { COPY } from '@ws/copy';
import { track } from '../events/track';
import { publicLikeCount, useReaction } from './reactionStore';

export interface LikeToggleProps {
  productId: string;
  /** L7 전용 공개 수(null·undefined = 숫자 없음). */
  count?: number | null;
}

export default function LikeToggle({ productId, count }: LikeToggleProps) {
  const [on, toggle] = useReaction('like', 'PRODUCT', productId);
  const shown = publicLikeCount(count);
  return (
    <button
      type="button"
      className={`ws-like${on ? ' ws-like--on' : ''}`}
      aria-pressed={on}
      aria-label={COPY.product.likeAria}
      onClick={() => {
        if (toggle()) track('reaction_like', { productId });
      }}
    >
      <span className="ws-like-glyph" aria-hidden="true">
        {on ? '♥' : '♡'}
      </span>
      {shown !== null ? <span className="ws-like-count ws-t-meta">{` ${shown}`}</span> : null}
    </button>
  );
}
