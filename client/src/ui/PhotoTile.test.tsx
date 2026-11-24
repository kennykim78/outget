// 359 단계 5(T14) — PhotoTile 은 ws-data 의 PublicPhoto(engine resolvePhoto → publicPhotoOf)만 그린다(사진 id 고정 0).
//   마크업은 프리렌더 헬퍼 server/src/prerender/pages/common.ts photoTile 과 같다(359d 스펙 §2 — 3갈래). 바이트 패리티는
//   두 출력을 같은 DOM 직렬화기(innerHTML)로 통과시켜 비교한다(React 는 void 요소를 `/>` 로 쓰지만 DOM 에 넣으면 같은 노드다).
//   서버 모듈 import 예외(사유): prerenderParity.test.tsx 와 같다 — lazy import.meta.glob, 테스트 전용(번들 0).
import { render } from '@testing-library/react';
import { COPY } from '@ws/copy';
import type { PublicPhoto } from '@ws/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import PhotoTile from './PhotoTile';

type PhotoTileHtml = (photo: PublicPhoto | undefined, slotClass: string) => string;
const SERVER = import.meta.glob(['../../../server/src/prerender/pages/common.ts']);
let serverTile: PhotoTileHtml;
beforeAll(async () => {
  const load = SERVER['../../../server/src/prerender/pages/common.ts'];
  if (!load) throw new Error('server common.ts not globbed');
  serverTile = ((await load()) as { photoTile: PhotoTileHtml }).photoTile;
}, 30_000);

const REAL: PublicPhoto = { photoId: 'ph-test-real', asset: '/assets/photos/test-real.webp' };
const AI: PublicPhoto = { photoId: 'ph-test-ai', asset: '/assets/photos/test-ai.webp', aiGenerated: true };

function reactHtml(photo: PublicPhoto | undefined, slot: string): string {
  const { container, unmount } = render(<PhotoTile photo={photo} className={slot} />);
  const html = container.innerHTML;
  unmount();
  return html;
}
function domHtml(s: string): string {
  const d = document.createElement('div');
  d.innerHTML = s;
  return d.innerHTML;
}

describe('PhotoTile(359 T14)', () => {
  it('사진 없음 → 빈 블록 span.ws-photo.{slot}[aria-hidden], data-ws-photo·img 0', () => {
    const { container } = render(<PhotoTile className="ws-now-photo" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toBe('ws-photo ws-now-photo');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.hasAttribute('data-ws-photo')).toBe(false);
    expect(container.querySelector('img')).toBeNull();
    expect(el.childNodes).toHaveLength(0);
  });

  it('실사 → img.ws-photo.{slot} src=asset alt="" lazy·async data-ws-photo=photoId, 표기 0', () => {
    const { container } = render(<PhotoTile photo={REAL} className="ws-spec-sec-photo" />);
    const img = container.firstElementChild as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.className).toBe('ws-photo ws-spec-sec-photo');
    expect(img.getAttribute('src')).toBe(REAL.asset);
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('data-ws-photo')).toBe(REAL.photoId);
    expect(container.querySelectorAll('.ws-photo-notice')).toHaveLength(0);
  });

  it('생성 이미지 → 틀 span.ws-photo-frame.{slot} > img.ws-photo + 표기 1개(ws-t-meta, aria-hidden, copy.photoNotice.aiGenerated)', () => {
    const { container } = render(<PhotoTile photo={AI} className="ws-starter-photo" />);
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.tagName).toBe('SPAN');
    expect(frame.className).toBe('ws-photo-frame ws-starter-photo');
    expect(frame.hasAttribute('aria-hidden')).toBe(false);
    // 틀엔 ws-photo 클래스 0(빈 자리 세는 시험과 분리 — 359d §2)
    expect(frame.classList.contains('ws-photo')).toBe(false);
    const img = frame.querySelector('img') as HTMLImageElement;
    expect(img.className).toBe('ws-photo');
    expect(img.getAttribute('data-ws-photo')).toBe(AI.photoId);
    const notes = frame.querySelectorAll('.ws-photo-notice');
    expect(notes).toHaveLength(1);
    expect(notes[0].className).toBe('ws-photo-notice ws-t-meta');
    expect(notes[0]).toHaveAttribute('aria-hidden', 'true');
    expect(notes[0].textContent).toBe(COPY.photoNotice.aiGenerated);
    expect(Array.from(frame.children).map((c) => c.tagName)).toEqual(['IMG', 'SPAN']);
  });

  it('같은 오리진 /assets/ 경로가 아니면 그리지 않는다(외부 호스트·상위 경로 0 — 빈 블록)', () => {
    for (const asset of ['https://x.example/a.webp', '//x.example/a.webp', '/assets/../secret.webp', 'assets/a.webp', '/assets/a b.webp']) {
      const { container, unmount } = render(<PhotoTile photo={{ photoId: 'ph-x', asset, aiGenerated: true }} className="ws-now-photo" />);
      expect({ asset, html: container.innerHTML }).toEqual({ asset, html: '<span class="ws-photo ws-now-photo" aria-hidden="true"></span>' });
      unmount();
    }
  });

  it.each([
    ['없음', undefined],
    ['실사', REAL],
    ['생성', AI],
  ] as const)('프리렌더 photoTile 과 마크업 바이트 동일(%s) — 슬롯 5종', (_n, photo) => {
    for (const slot of ['ws-starter-photo', 'ws-explain-photo', 'ws-now-photo', 'ws-spec-sec-photo', 'ws-supply-photo']) {
      expect({ slot, html: reactHtml(photo, slot) }).toEqual({ slot, html: domHtml(serverTile(photo, slot)) });
    }
  });
});
