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
  isNoCriteria,
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
export { EngineLookupError, checkAnimalMinSpec, checkProfileMinSpec, createEngine, minSpecBaseline, productCageCompat, requirementBaseline, requirementCompat, specCheck } from './spec-check.js';
export type { Engine, MinSpecResult, RequirementBaseline } from './spec-check.js';
export { buildSearchKeyword } from './search-keyword.js';
export { SPEC_WORDS, chipSpecText, figureValueText, firstSentence, minSpecFigure, reasonLine, ruleText, specLine } from './spec-text.js';
export type { MinSpecFigure } from './spec-text.js';
export { HOME_A_FIGURES_MAX, HOME_A_NEED_MAX, homeAExplainOf, homeARepType, homeAVetRows } from './home-a.js';
export type { HomeAVetRow } from './home-a.js';
export { naverMapSearchUrl } from './links.js';
export {
  VET_LISTED_STATUS,
  isAnimalTypeExposable,
  isBudgetTipExposable,
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
  FEED_EXCLUDED_CATEGORIES,
  selectFeedRows,
} from './exposure.js';
export type {
  BudgetTipForExposure,
  CcLicenseRef,
  ExposableProduct,
  FeedSelectOptions,
  FeedSelection,
  ProductForExposure,
  SelectedFeedRow,
} from './exposure.js';
export {
  CROSS_CHECK_CONTENT_KINDS,
  CROSS_CHECK_KEYS,
  CROSS_CHECK_RESULTS,
  CROSS_CHECK_TOOLS,
  GENERAL_INFO_CONTENT_KINDS,
  GENERAL_INFO_MAX_AGE_DAYS,
  GENERAL_INFO_STATUS,
  GENERAL_INFO_TYPE_IDS,
  isCrossCheckShape,
  isGeneralInfoMeta,
  isGeneralInfoTypeId,
} from './general-info.js';
export type { GeneralInfoTypeId } from './general-info.js';
export {
  PHOTO_AI_LICENSE,
  PHOTO_AI_SOURCES,
  PHOTO_ASSET_RE,
  PHOTO_PROMPT_PATH_RE,
  aiPhotoRecordProblems,
  isAiGeneratedPhoto,
  isAiPhotoRecordOk,
  isMachineSignerMarker,
} from './photo-ai.js';
export {
  HOME_A_SCENE_PHOTOS,
  ITEM_SCENE_PHOTOS,
  PHOTO_SCOPE_KEYS,
  PHOTO_TYPE_USES,
  PHOTO_USES,
  SCENE_PHOTO_GROUPS,
  SCENE_PHOTO_TYPE_IDS,
  TYPE_SCENE_PHOTOS,
  photoLevels,
  photoPlacements,
  photoScopeKey,
  publicHomeScenes,
  publicItemPhoto,
  publicPhotoOf,
  publicTypePhotos,
  resolvePhoto,
  resolvePlacement,
  resolveScenePhoto,
  sceneFallbackAllowed,
  scenePhotoIdFor,
} from './photo-resolve.js';
export type { PhotoLevel, PhotoPlacement, PhotoQuery, PhotoTypeRef, PhotoUse, ResolvedPhoto } from './photo-resolve.js';
export {
  TIP_ARTICLE_HOSTS,
  TIP_COMMERCE_HOSTS,
  TIP_HAZARD_MIN_DOMAINS,
  TIP_MULTI_LABEL_SUFFIXES,
  TIP_SECTION_CATEGORIES,
  TIP_VET_REVIEWER_TYPES,
  TIP_VET_REVIEW_REQUIRED,
  isAiDraftMarker,
  isIpLiteralHost,
  isTipArticleHost,
  isTipCommerceHost,
  isTipReferenceValid,
  isTipSectionCategory,
  isTipSummaryCheckValid,
  isTipVetReviewValid,
  stripTrailingDots,
  tipDistinctDomainCount,
  tipHazardSourcesOk,
  tipReferenceDomain,
  tipReferenceUrlProblem,
  tipNeedsVetReview,
  tipReferencesOk,
  tipReviewRecordsOk,
} from './tips.js';
export { buildSearchLinks, hasAffiliateLink, type AffiliateCodes, type SearchLink, type SearchLinkKind, type SearchProvider } from './search-links.js';
export {
  COUPANG_AFFILIATE_CODE_RE,
  COUPANG_AFFILIATE_PREFIX,
  PROVIDERS,
  SEARCH_PROVIDER_ORDER,
  affiliateCodeFromHref,
  affiliateHref,
  isAffiliateCode,
} from './providers.js';
export type { ProviderAffiliate, ProviderEntry, ProviderId, ProviderSearch } from './providers.js';
export * from './public.js';
// 362 N9 — 피드 변형 경로·표기 공용(프리렌더·클라·spa). 값 상수는 feed-types(제휴 모듈 아님), 링크·이미지 검사는 feed-wire(providers 경유 — HomeB 는 import 금지).
export { FEED_PAGE_VARIANT, FEED_SCREEN_ROWS, feedCheckedParts, feedJsonFile, feedJsonPath, feedPriceText, feedStage, feedVariantFile } from './feed-types.js';
export type { FeedLiveStage, FeedStage } from './feed-types.js';
export { isFeedImageUrl, isFeedLink, isWsFeedData } from './feed-wire.js';
export { WS_WIRE_VERSION, WS_WIRE_VERSION_AFF, decodeWsPage, encodeWsPage, toWsPageV1 } from './ws-wire.js';
export type { WsPageWire, WsWireAff, WsWireRequirement, WsWireSource } from './ws-wire.js';
/** K1(51 레인 A): 친구 선택 정적 URL — 홈 A 부모 + L1 정적 본문(noindex·sitemap 제외). client shell/pickLink.ts PICK_PATH 와 같은 값. */
export const PICK_PATH = '/pick';
