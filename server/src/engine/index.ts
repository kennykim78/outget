// 엔진 배럴 — 서버·프리렌더·클라이언트 공용(PRD US-021). 상대 './x.js' import 만.
export * from './domain.js';
export type * from './types.js';
export { createCatalog } from './catalog.js';
export type { CatalogInput } from './catalog.js';
export { ExprSyntaxError, evalExpr, exprComparedLiterals, exprRefs, parseExpr } from './expr.js';
export type { BinaryOp, ExprNode } from './expr.js';
export {
  VERDICT_SEVERITY,
  evaluateProductStage,
  evaluateRuleSet,
  findField,
  hasCompleteOptionLabels,
  isFieldOptionalForDisplay,
  optionLabel,
  readSpecValue,
  referencedSpecKeys,
  sanitizeSpecValues,
  splitLabel,
  visibleSpecFields,
  worstVerdict,
} from './rules.js';
export type { RuleKind, SpecRead } from './rules.js';
export { listResolvedRequirements, resolveRequirement } from './resolve.js';
export { EngineLookupError, checkAnimalMinSpec, checkProfileMinSpec, createEngine, minSpecBaseline, requirementCompat, specCheck } from './spec-check.js';
export type { Engine, MinSpecResult } from './spec-check.js';
export { buildSearchKeyword } from './search-keyword.js';
export { SPEC_WORDS, chipSpecText, ruleText, specLine } from './spec-text.js';
export { naverMapSearchUrl } from './links.js';
export {
  VET_LISTED_STATUS,
  isAnimalTypeExposable,
  isBundleExposable,
  isCompatRuleExposable,
  isFresh,
  PHOTO_USABLE_STATUSES,
  isPhotoUsable,
  parseCcLicenseUrl,
  isProductExposable,
  isRequirementExposable,
  isTaxonExposable,
  isTestimonialExposable,
  isTestimonialPublic,
  isVerified,
  isVetListed,
  isVetStatusListed,
  orderExposableProducts,
} from './exposure.js';
export type { CcLicenseRef, ExposableProduct, ProductForExposure } from './exposure.js';
export { buildSearchLinks, type SearchLink, type SearchProvider } from './search-links.js';
export * from './public.js';
export { WS_WIRE_VERSION, decodeWsPage, encodeWsPage } from './ws-wire.js';
export type { WsPageWire, WsWireRequirement, WsWireSource } from './ws-wire.js';
/** K1(51 레인 A): 친구 선택 정적 URL — 홈 A 부모 + L1 정적 본문(noindex·sitemap 제외). client shell/pickLink.ts PICK_PATH 와 같은 값. */
export const PICK_PATH = '/pick';
