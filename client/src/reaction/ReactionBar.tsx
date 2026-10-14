// 👍·⚠ 반응 바(스펙33 §2.3 · §8). L4 검수 행·/setup 구성안. 숫자 표시 없음(R5 — 계획 D9), 커뮤니티 요소 0.
//   aria-pressed 토글, 이모지 aria-hidden. ⚠ 를 켠 직후 1회 고마움 문구(aria-live). 이벤트는 켤 때만.
import { useState } from 'react';
import { COPY } from '@ws/copy';
import { track } from '../events/track';
import { useReaction, type ReactionTarget } from './reactionStore';

export interface ReactionBarProps {
  targetType: Extract<ReactionTarget, 'SUPPLY_ITEM' | 'BUNDLE'>;
  targetId: string;
}

export default function ReactionBar({ targetType, targetId }: ReactionBarProps) {
  const [helpful, toggleHelpful] = useReaction('helpful', targetType, targetId);
  const [recheck, toggleRecheck] = useReaction('recheck', targetType, targetId);
  const [thanked, setThanked] = useState(false);

  const onHelpful = () => {
    if (toggleHelpful()) track('reaction_helpful', { targetType, targetId });
  };
  const onRecheck = () => {
    if (toggleRecheck()) {
      track('reaction_recheck', { targetType, targetId });
      setThanked(true);
    }
  };

  return (
    <div className="ws-reactions">
      <button type="button" className="ws-reaction ws-t-meta" aria-pressed={helpful} onClick={onHelpful}>
        <span aria-hidden="true">{'\u{1F44D}'}</span>
        {COPY.reaction.helpful}
      </button>
      <button type="button" className="ws-reaction ws-t-meta" aria-pressed={recheck} onClick={onRecheck}>
        <span aria-hidden="true">{'⚠'}</span>
        {COPY.reaction.recheck}
      </button>
      <p className="ws-t-meta ws-reaction-thanks" aria-live="polite">
        {thanked ? COPY.reaction.recheckThanks : ''}
      </p>
    </div>
  );
}
