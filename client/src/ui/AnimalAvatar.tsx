// 마스코트 아바타(스펙22 §2.16). 디스크(pill) 안 /mascots/{asset}.svg — 리포 자산만(불변식 ①).
//   허용 위치: 히어로·컨텍스트 헤더·AnimalChip·L1·빈 상태·완료. 판정·규격·병원·법적·상품·후기·L2/L4/L5/L7 금지. ≤120.
//   히어로·컨텍스트 헤더의 인라인 SVG(D-2)는 프리렌더 보관분을 쓴다(F4/F5).
const ASSET_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AvatarSize = 'lg' | 'md' | 'sm' | 'type';
export type AvatarTone = 'brand-soft' | 'peach-soft' | 'surface';

const IMG_PX: Record<AvatarSize, number> = { lg: 96, md: 40, sm: 24, type: 56 };

export interface AnimalAvatarProps {
  /** 마스코트 자산 이름(예: hamster-golden). 없거나 형식이 틀리면 빈 디스크. */
  asset: string | null | undefined;
  size: AvatarSize;
  tone: AvatarTone;
  /** 옆에 이름이 있으면 ''(장식). */
  alt: string;
}

/**
 * R6 F2b ②: lg·peach-soft = 홈 선택 컨텍스트 헤더 마스코트(유일 조합, /{group}/{type} LCP 요소).
 *   그 img 만 fetchpriority=high + decoding 생략(동기 디코드로 첫 페인트에 바로). 다른 마스코트는 decoding=async 그대로.
 *   프리렌더 server/src/prerender/pages/common.ts mascotAvatar 와 같은 규칙(하이드레이션 골격 일치).
 */
function isLcpAvatar(size: AvatarSize, tone: AvatarTone): boolean {
  return size === 'lg' && tone === 'peach-soft';
}

// React 18 은 fetchPriority 카멜 prop 을 모른다(경고) — 소문자 HTML 속성으로 그대로 내보낸다.
const LCP_IMG_ATTRS = { fetchpriority: 'high' } as const;
const LAZY_IMG_ATTRS = { decoding: 'async' } as const;

export default function AnimalAvatar({ asset, size, tone, alt }: AnimalAvatarProps) {
  const ok = typeof asset === 'string' && ASSET_RE.test(asset);
  const px = IMG_PX[size];
  const extra = isLcpAvatar(size, tone) ? LCP_IMG_ATTRS : LAZY_IMG_ATTRS;
  return (
    <span className={`ws-avatar ws-avatar--${size} ws-avatar--${tone}`} aria-hidden={ok && alt !== '' ? undefined : true}>
      {ok ? <img src={`/mascots/${asset}.svg`} width={px} height={px} alt={alt} {...extra} /> : null}
    </span>
  );
}
