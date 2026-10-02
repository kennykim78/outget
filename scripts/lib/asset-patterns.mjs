// 시드 이미지 자산 경로 패턴 — server/src/seed/validate-products.ts(P05)·validate-people.ts(T03)와 동일해야 한다.
//   server/src/__tests__/asset-regex-parity.test.ts 가 .source·.flags 일치를 단언한다.
export const PRODUCT_IMAGE_ASSET_RE = /^\/assets\/products\/[a-z0-9][a-z0-9-]*\.(webp|avif|jpg|jpeg|png)$/;
export const REVIEWER_IMAGE_RE = /^\/assets\/reviewers\/[a-z0-9][a-z0-9-]*\.(webp|avif|jpg|jpeg|png)$/;
