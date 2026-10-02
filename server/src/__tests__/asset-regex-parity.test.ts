// 자산 경로 정규식 패리티(Q1 D3): scripts/lib/asset-patterns.mjs(compliance-scan C1-SEEDURL) ↔
//   seed/validate-products.ts(P05)·validate-people.ts(T03). 한쪽만 느슨해지면 실패.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRODUCT_IMAGE_ASSET_RE } from '../seed/validate-products.js';
import { REVIEWER_IMAGE_RE } from '../seed/validate-people.js';

const MJS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'lib', 'asset-patterns.mjs');

interface AssetPatterns {
  PRODUCT_IMAGE_ASSET_RE: RegExp;
  REVIEWER_IMAGE_RE: RegExp;
}

describe('asset-regex-parity — scripts/lib/asset-patterns.mjs ↔ seed validators', async () => {
  const mod = (await import(pathToFileURL(MJS).href)) as AssetPatterns;

  it('상품 imageAsset (P05) source·flags 동일', () => {
    expect(mod.PRODUCT_IMAGE_ASSET_RE).toBeInstanceOf(RegExp);
    expect(mod.PRODUCT_IMAGE_ASSET_RE.source).toBe(PRODUCT_IMAGE_ASSET_RE.source);
    expect(mod.PRODUCT_IMAGE_ASSET_RE.flags).toBe(PRODUCT_IMAGE_ASSET_RE.flags);
  });

  it('후기 reviewerImage (T03) source·flags 동일', () => {
    expect(mod.REVIEWER_IMAGE_RE).toBeInstanceOf(RegExp);
    expect(mod.REVIEWER_IMAGE_RE.source).toBe(REVIEWER_IMAGE_RE.source);
    expect(mod.REVIEWER_IMAGE_RE.flags).toBe(REVIEWER_IMAGE_RE.flags);
  });

  it('동작 표본도 일치', () => {
    const samples = ['/assets/products/cp-001.webp', '/assets/x/Y.svg', '/assets/products/Cp.webp', '/assets/../x.png', '//evil/x.png', '/assets/reviewers/r-1.png'];
    for (const s of samples) {
      expect(mod.PRODUCT_IMAGE_ASSET_RE.test(s)).toBe(PRODUCT_IMAGE_ASSET_RE.test(s));
      expect(mod.REVIEWER_IMAGE_RE.test(s)).toBe(REVIEWER_IMAGE_RE.test(s));
    }
  });
});
