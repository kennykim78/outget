// SEC L6(R5 B3-2): 프리렌더 상품 이미지는 허용목록 — imageLicense ∈ {OWN_PHOTO, SELLER_PERMISSION, AFFILIATE_API}
//   ∧ imageAsset 이 운영자 자산 경로(/assets/products/<kebab>.(webp|avif|jpg|jpeg|png)). 그 외(NONE·미지 값·외부 URL)는 null → 아이콘 타일.
import { describe, expect, it } from 'vitest';
import { projectSite } from '../prerender/project.js';
import { FIXTURE_AS_OF, patch, promoted } from './fixtures/prerender-seed.js';

function imageOf(p: Record<string, unknown>): string | null | undefined {
  const s = promoted();
  patch(s, 'curatedProducts', 'cp-001', p);
  const m = projectSite(s, FIXTURE_AS_OF);
  const prod = m.types.flatMap((t) => t.requirements.flatMap((r) => r.products)).find((x) => x.id === 'cp-001');
  expect(prod, 'cp-001 노출(픽스처 전제)').toBeDefined();
  return prod?.imageAsset;
}

describe('projectSite — 상품 imageAsset 허용목록(L6)', () => {
  it.each(['OWN_PHOTO', 'SELLER_PERMISSION', 'AFFILIATE_API'])('%s + 운영자 자산 → 경로 유지', (lic) => {
    expect(imageOf({ imageLicense: lic, imageAsset: '/assets/products/cp-001.webp' })).toBe('/assets/products/cp-001.webp');
  });
  it.each<[string, Record<string, unknown>]>([
    ['NONE', { imageLicense: 'NONE', imageAsset: '/assets/products/cp-001.webp' }],
    ['미지 라이선스(거부목록이면 통과하던 값)', { imageLicense: 'SCRAPED', imageAsset: '/assets/products/cp-001.webp' }],
    ['소문자 라이선스', { imageLicense: 'own_photo', imageAsset: '/assets/products/cp-001.webp' }],
    ['라이선스 null', { imageLicense: null, imageAsset: '/assets/products/cp-001.webp' }],
    ['외부 URL', { imageLicense: 'OWN_PHOTO', imageAsset: 'https://shop.example.com/p.jpg' }],
    ['프로토콜 상대', { imageLicense: 'OWN_PHOTO', imageAsset: '//cdn.example.com/p.jpg' }],
    ['경로 순회', { imageLicense: 'OWN_PHOTO', imageAsset: '/assets/products/../x.webp' }],
    ['다른 자산 폴더', { imageLicense: 'OWN_PHOTO', imageAsset: '/assets/reviewers/a.webp' }],
    ['비문자열', { imageLicense: 'OWN_PHOTO', imageAsset: 42 }],
  ])('%s → null', (_n, p) => {
    expect(imageOf(p)).toBeNull();
  });
});
