// 사진 자리(스펙22 §2.18, D-8 · 359 단계 5). 사진은 ws-data 의 PublicPhoto(engine resolvePhoto → publicPhotoOf, 빌드 타임)만 — 클라이언트는
//   사진 id 를 고르지도 고정하지도 않는다(감사 356r M2). 사용 가능 사진이 없으면 bg-100 빈 블록(글자·아이콘·마스코트 대체 금지).
//   마크업은 프리렌더 server/src/prerender/pages/common.ts photoTile 과 같다(359d 스펙 §2 — 3갈래, T14 패리티 시험):
//     없음: span.ws-photo.{slot}[aria-hidden] · 실사: img.ws-photo.{slot} · 생성: span.ws-photo-frame.{slot} > img.ws-photo + 표기 1(aria-hidden).
import { COPY } from '@ws/copy';
import type { PublicPhoto } from '@ws/engine';

export interface PhotoTileProps {
  /** ws-data 의 고른 결과(있을 때만). 없으면 빈 블록. */
  photo?: PublicPhoto;
  /** 슬롯 클래스(ws-now-photo 등) — 비율·모서리는 슬롯 CSS 가 정한다. */
  className: string;
}

/** 운영자 자산 경로(/assets/…)만 — 외부 호스트·상위 경로면 그리지 않는다(무크롤링 ①, 프리렌더 cli 가 실재 확인). */
const SAME_ORIGIN_ASSET = /^\/assets\/[A-Za-z0-9._/-]+$/;

export default function PhotoTile({ photo, className }: PhotoTileProps) {
  if (!photo || !SAME_ORIGIN_ASSET.test(photo.asset) || photo.asset.includes('..')) {
    return <span className={`ws-photo ${className}`} aria-hidden="true" />;
  }
  if (photo.aiGenerated !== true) {
    return <img className={`ws-photo ${className}`} src={photo.asset} alt="" loading="lazy" decoding="async" data-ws-photo={photo.photoId} />;
  }
  return (
    <span className={`ws-photo-frame ${className}`}>
      <img className="ws-photo" src={photo.asset} alt="" loading="lazy" decoding="async" data-ws-photo={photo.photoId} />
      <span className="ws-photo-notice ws-t-meta" aria-hidden="true">
        {COPY.photoNotice.aiGenerated}
      </span>
    </span>
  );
}
