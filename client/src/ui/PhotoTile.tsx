// 사진 자리(스펙22 §2.18, D-8). 사용권 사진이 없으면 bg-100 빈 블록(글자·아이콘·마스코트 대체 금지). R4 는 photos.json 전부 SLOT.
export interface PhotoTileProps {
  /** photos.json 슬롯 id(ph-01 …) — 표시 안 함, 추적용. */
  photoId: string;
  /** 운영자 자산 경로(/assets/…)만. 없으면 빈 블록. */
  asset?: string | null;
  className?: string;
}

const SAME_ORIGIN_ASSET = /^\/assets\/[A-Za-z0-9._/-]+$/;

export default function PhotoTile({ photoId, asset, className }: PhotoTileProps) {
  const cls = `ws-photo${className ? ` ${className}` : ''}`;
  if (typeof asset === 'string' && SAME_ORIGIN_ASSET.test(asset) && !asset.includes('..')) {
    return <img className={cls} src={asset} alt="" loading="lazy" decoding="async" data-ws-photo={photoId} />;
  }
  return <span className={cls} aria-hidden="true" data-ws-photo={photoId} />;
}
