// SEC-2 M-1(R5 B3-1) + L8(B3-2): 사진 출처 코드 ↔ 원본 호스트 허용목록 · userinfo 거부 · CC BY-SA 카드 슬롯.
//   세 구현이 같은 판정이어야 한다: engine exposure.ts(isPhotoUsable) · scripts/lib/seed-exposure.mjs(isPhotoUsableRow)
//   · seed/validate-people.ts(validateSeed I01·I02·I03 오류 0). 한 곳만 느슨해지면 실패(패리티 테이블).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CC_BY_SA_CARD_SLOT_RE,
  PHOTO_SOURCE_HOSTS,
  isCcBySaPlacementOk,
  isPhotoSourceUrlAllowed,
  isPhotoUsable,
} from '../engine/exposure.js';
import { CC_BY_SA_SLOTS_RE, PHOTO_SOURCE_HOSTS as VALIDATE_HOSTS, photoSourceHostIssue } from '../seed/validate-people.js';
import { readSeedDirRaw } from '../seed/read.js';
import { validateSeed } from '../seed/validate.js';
import type { RawSeed, Rec } from '../seed/common.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mjs = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'seed-exposure.mjs')).href)) as {
  PHOTO_SOURCE_HOSTS: Record<string, readonly string[]>;
  photoSourceUrlAllowed: (s: unknown, u: unknown) => boolean;
  ccBySaPlacementOk: (p: unknown) => boolean;
  isPhotoUsableRow: (p: unknown) => boolean;
};

const BASE_SEED = readSeedDirRaw(join(ROOT, 'server', 'seed')).raw;
const NOW = '2026-10-01';

/** validate 쪽 판정: ph-01 에 주입했을 때 사진 규칙(I01·I02·I03·S03) 오류 0 인가. */
function validatePasses(p: Record<string, unknown>): boolean {
  const s = structuredClone(BASE_SEED) as Required<RawSeed>;
  const row = (s.photos as Rec[]).find((r) => r.id === 'ph-01') as Rec;
  Object.assign(row, p);
  const res = validateSeed(s, { now: NOW });
  return !res.errors.some((i) => i.file === 'photos.json' && ['I01', 'I02', 'I03', 'I04', 'S03'].includes(i.rule));
}

const BASE = {
  status: 'READY', source: 'WIKIMEDIA', license: 'CC0', author: null, licenseUrl: null,
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg', downloadedAt: '2026-09-30', slot: 'intro-1', modified: false,
};

// [이름, 패치, 기대(사용 가능)]
const TABLE: Array<[string, Record<string, unknown>, boolean]> = [
  ['WIKIMEDIA commons', {}, true],
  ['WIKIMEDIA upload', { sourceUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg' }, true],
  ['UNSPLASH 페이지', { source: 'UNSPLASH', license: 'SITE_LICENSE', author: 'A', sourceUrl: 'https://unsplash.com/photos/abc' }, true],
  ['UNSPLASH images', { source: 'UNSPLASH', license: 'SITE_LICENSE', author: 'A', sourceUrl: 'https://images.unsplash.com/photo-1?w=1' }, true],
  ['PEXELS www', { source: 'PEXELS', license: 'SITE_LICENSE', author: 'A', sourceUrl: 'https://www.pexels.com/photo/x-1/' }, true],
  ['PEXELS apex', { source: 'PEXELS', license: 'SITE_LICENSE', author: 'A', sourceUrl: 'https://pexels.com/photo/x-1/' }, true],
  ['PEXELS images', { source: 'PEXELS', license: 'SITE_LICENSE', author: 'A', sourceUrl: 'https://images.pexels.com/photos/1/x.jpeg' }, true],
  ['PIXABAY', { source: 'PIXABAY', license: 'SITE_LICENSE', author: 'A', sourceUrl: 'https://pixabay.com/photos/x-1/' }, true],
  ['PIXABAY cdn', { source: 'PIXABAY', license: 'SITE_LICENSE', author: 'A', sourceUrl: 'https://cdn.pixabay.com/photo/x.jpg' }, true],
  ['호스트만(경로 없음)', { sourceUrl: 'https://commons.wikimedia.org' }, true],
  ['쿼리 바로', { sourceUrl: 'https://commons.wikimedia.org?x=1' }, true],
  // M-1 거부
  ['WIKIMEDIA + instagram', { sourceUrl: 'https://www.instagram.com/p/abc/' }, false],
  ['WIKIMEDIA + smartstore', { sourceUrl: 'https://smartstore.naver.com/x/products/1' }, false],
  ['WIKIMEDIA + unsplash 호스트(교차)', { sourceUrl: 'https://unsplash.com/photos/abc' }, false],
  ['UNSPLASH + commons 호스트(교차)', { source: 'UNSPLASH', license: 'SITE_LICENSE', author: 'A' }, false],
  ['userinfo', { sourceUrl: 'https://u@commons.wikimedia.org/wiki/File:x.jpg' }, false],
  ['userinfo:pass', { sourceUrl: 'https://u:p@commons.wikimedia.org/wiki/File:x.jpg' }, false],
  ['userinfo 위장', { sourceUrl: 'https://commons.wikimedia.org@evil.example/x.jpg' }, false],
  ['포트', { sourceUrl: 'https://commons.wikimedia.org:443/wiki/File:x.jpg' }, false],
  ['대문자 호스트', { sourceUrl: 'https://Commons.Wikimedia.org/wiki/File:x.jpg' }, false],
  ['끝 점', { sourceUrl: 'https://commons.wikimedia.org./wiki/File:x.jpg' }, false],
  ['하위 도메인', { sourceUrl: 'https://evil.commons.wikimedia.org/x.jpg' }, false],
  ['접미 위장', { sourceUrl: 'https://commons.wikimedia.org.evil.example/x.jpg' }, false],
  ['다른 wikimedia 하위', { sourceUrl: 'https://en.wikipedia.org/wiki/File:x.jpg' }, false],
  ['백슬래시', { sourceUrl: 'https://commons.wikimedia.org\\@evil.example/x.jpg' }, false],
  ['퍼센트 인코딩 호스트', { sourceUrl: 'https://commons%2ewikimedia.org/x.jpg' }, false],
  ['http', { sourceUrl: 'http://commons.wikimedia.org/wiki/File:x.jpg' }, false],
  ['OWN(증빙 규칙 미정 → fail-closed)', { source: 'OWN', license: 'PERMISSION', author: 'A' }, false],
  ['SELLER(fail-closed)', { source: 'SELLER', license: 'PERMISSION', author: 'A' }, false],
  ['AFFILIATE(fail-closed)', { source: 'AFFILIATE', license: 'PERMISSION', author: 'A' }, false],
  ['소문자 출처 코드', { source: 'wikimedia' }, false],
  ['미지 출처', { source: 'FLICKR', sourceUrl: 'https://www.flickr.com/photos/x' }, false],
  ['프로토타입 키 출처', { source: 'constructor' }, false],
  // L8 CC BY-SA 배치
  ['CC_BY_SA 카드 슬롯 원본', { license: 'CC_BY_SA', author: 'A', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', slot: 'l4-cage' }, true],
  ['CC_BY_SA group 슬롯', { license: 'CC_BY_SA', author: 'A', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', slot: 'group-small-mammal' }, true],
  ['CC_BY_SA 히어로', { license: 'CC_BY_SA', author: 'A', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', slot: 'hero' }, false],
  ['CC_BY_SA 합성 슬롯', { license: 'CC_BY_SA', author: 'A', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', slot: 'composite-intro' }, false],
  ['CC_BY_SA modified', { license: 'CC_BY_SA', author: 'A', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', modified: true }, false],
  ['CC_BY_SA modified 누락', { license: 'CC_BY_SA', author: 'A', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', modified: undefined }, false],
  ['CC_BY 히어로(BY-SA 아님 → 슬롯 무관)', { license: 'CC_BY', author: 'A', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', slot: 'hero', modified: true }, true],
];

describe('사진 호스트·CC BY-SA 패리티 테이블 — engine ↔ mjs ↔ validate', () => {
  it('호스트 허용목록 세 곳 동일', () => {
    const norm = (t: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(t).map(([k, v]) => [k, [...v].sort()]).sort(([a], [b]) => (a < b ? -1 : 1)));
    expect(norm(mjs.PHOTO_SOURCE_HOSTS)).toEqual(norm(PHOTO_SOURCE_HOSTS));
    expect(norm(VALIDATE_HOSTS)).toEqual(norm(PHOTO_SOURCE_HOSTS));
    expect(Object.keys(PHOTO_SOURCE_HOSTS).sort()).toEqual(['PEXELS', 'PIXABAY', 'UNSPLASH', 'WIKIMEDIA']);
  });

  it.each(TABLE)('%s', (_n, patch, want) => {
    const p = { ...BASE, ...patch };
    expect(isPhotoUsable(p as never), 'engine').toBe(want);
    expect(mjs.isPhotoUsableRow(p), 'mjs').toBe(want);
    expect(validatePasses(p), 'validate').toBe(want);
  });

  it('호스트 판정 단독 함수도 같다(engine isPhotoSourceUrlAllowed ↔ mjs ↔ validate photoSourceHostIssue)', () => {
    for (const [n, patch] of TABLE) {
      const p = { ...BASE, ...patch } as { source: unknown; sourceUrl: unknown };
      const e = isPhotoSourceUrlAllowed(p.source, p.sourceUrl);
      expect(mjs.photoSourceUrlAllowed(p.source, p.sourceUrl), n).toBe(e);
      // validate 는 http·공백 등 형식 오류를 PHOTO_SOURCE_URL_RE 에서 먼저 잡는다 — 호스트 함수 자체도 같은 결론.
      expect(photoSourceHostIssue(p.source, p.sourceUrl) === null, n).toBe(e);
    }
  });

  it('CC BY-SA 슬롯 집합 동일(엔진 ↔ validate ↔ mjs)', () => {
    const slots = [
      'intro-1', 'intro-4', 'intro-0', 'intro-10', 'group-small-mammal', 'group-parrot', 'group-', 'review-side', 'l4-cage', 'l4-bedding',
      'vet-empty', 'done', 'hero', 'hero-1', 'composite', 'composite-intro', 'mascot', 'done-2', 'L4-cage', ' done', 'l4--x', '',
    ];
    for (const slot of slots) {
      const e = CC_BY_SA_CARD_SLOT_RE.test(slot);
      expect(CC_BY_SA_SLOTS_RE.test(slot), slot).toBe(e);
      expect(mjs.ccBySaPlacementOk({ license: 'CC_BY_SA', slot, modified: false }), slot).toBe(e);
      expect(isCcBySaPlacementOk({ license: 'CC_BY_SA', slot, modified: false }), slot).toBe(e);
    }
    for (const slot of ['intro-1', 'group-parrot', 'review-side', 'l4-food', 'vet-empty', 'done']) expect(CC_BY_SA_CARD_SLOT_RE.test(slot)).toBe(true);
    for (const slot of ['hero', 'composite-intro']) expect(CC_BY_SA_CARD_SLOT_RE.test(slot)).toBe(false);
  });

  it('실제 시드 사진 슬롯은 모두 CC BY-SA 카드 슬롯(현재 장면 리스트 = 카드)', () => {
    // 354: 종·품목 단위 행(scope 있음)은 장면 슬롯이 아니라 화면 자리(scope)로 붙는다 — 장면 행만 본다.
    for (const r of (BASE_SEED.photos as Rec[]).filter((x) => x.scope === null || x.scope === undefined)) expect(CC_BY_SA_CARD_SLOT_RE.test(String(r.slot)), String(r.slot)).toBe(true);
  });
});
