// 원시 시드 → 노출 집합 독립 재구현(D9). server/src/engine 을 import 하지 않는다.
//   의도: 엔진(exposure.ts)이 틀려도 산출물에 비노출 행이 섞이면 compliance 가 잡는다.
//   애매하면 비노출(fail-closed) — 엔진보다 넓게 허용하는 쪽으로 틀리면 안 된다.
//
//   verified(r)        = reviewStatus === 'VERIFIED' ∧ rank(reviewerType) ≥ rank(OPERATOR)   (AI_DRAFT·미지값 제외)
//                        ∧ fresh(r, asOf): verifiedAt 달력 날짜 ∧ 0 ≤ (asOf − verifiedAt) ≤ STALE_DAYS(180)   (M-1, R4 D5)
//                        computeExposure(seed, asOf) — asOf 필수(YYYY-MM-DD 아니면 RangeError). 아래 "verified" 는 전부 이 뜻.
//   chainOk(r, t)      = verified(r) ∨ (t ∈ GENERAL_INFO_TYPE_IDS(코드 고정 6종) ∧ generalInfoRowOk(r))   (356 예외 2, Kenny 2026-11-23)
//                        generalInfoRowOk = reviewStatus GENERAL_INFO ∧ 알려진 reviewerType ∧ contentKind ∈ {SPEC,CARE,FOOD,HEALTH}
//                        ∧ draftedAt 0~STALE_DAYS ∧ (FOOD·HEALTH → crossCheck 키 3개{CODEX_DISCUSS, checkedAt, AGREE|REVISED}
//                        ∧ draftedAt ≤ checkedAt ≤ asOf). 체인 메타 네 개(type·profile·requirement·item)에만 — 아래 나머지는 verified 그대로.
//   careProfile        = 노출 type 의 프로필(그 type 기준 chainOk)
//   animalType(base)   = status ACTIVE ∧ chainOk(t,t) ∧ careProfile 존재·chainOk(Taxon 은 보지 않음 — Kenny 2026-10-24 K-4 되돌림)
//   requirement(t,r)   = base(t) ∧ r.careProfileId === t.careProfileId ∧ chainOk(r,t) ∧ item chainOk(·,t)
//   animalType         = base ∧ 노출 requirement ≥ 1
//   supplyItem         = 어떤 노출 (type,item) 쌍의 item(그 type 기준 chainOk)
//   curatedProduct     = status ACTIVE ∧ verified ∧ meetsMinSpec === true ∧ ∃ 노출 type t:
//                        t.careProfileId ∈ careProfileIds ∧ (t,item) 노출 ∧ 체인(type·프로필·요구사항·용품) 전부 verified(GENERAL_INFO 불가, 356r M1) ∧ minSpec(base ⊕ override, (key,op) 교체) 전부 충족
//                        (키 누락·미지 op·when 평가 불가 → 비노출)
//   setupBundle        = verified ∧ ∃ 노출 type t: careProfileId 일치 ∧ itemIds 비어있지 않고 전부 (t,item) 노출
//   compatibilityRule  = verified ∧ a·b 둘 다 노출 item ∧ (careProfileId 없음 ∨ 노출 타입의 프로필)
//   taxon              = verified ∧ (노출 type 의 taxonId ∨ 노출 careProfile 의 taxonIds 중 비노출 type 의 taxonId 아닌 것, 277 QA M-1) — 산출물의 Taxon 참조는 이 집합만(불변식 7)
//   vetClinic          = verification.status === 'VERIFIED'
//   testimonial        = status === 'APPROVED' ∧ verifiedUsage === true ∧ animalTypeId ∈ 노출 animalType(F5)
//   photo              = status ∈ {READY} ∧ (license === AI_GENERATED → 생성 기록 전부(source CODEX|AGY·generatedAt·promptPath·asset
//                        ·사람 speciesCheck·원본 URL 없음, 354) | 아래 실사 규칙)
//                        실사: license ∈ I01 ∧ source ∧ https sourceUrl ∧ downloadedAt ∧ (CC0 ∨ author) ∧ (asset 있으면 경로 형식)
//                        ∧ 출처별 호스트 허용목록·userinfo 거부(M-1) ∧ CC_BY_SA 원본·카드 슬롯(L8)
//                        ∧ (CC_BY·CC_BY_SA → licenseUrl 이 같은 종류의 creativecommons.org 증서, M-3)
//   budgetTip          = REFERENCE 별도 경로(Kenny 2026-11-22 — 검수 메타를 보지 않는다, 불변식 7 명시 예외):
//                        kind === 'REFERENCE' ∧ references ≥ 1 모두 유효(키 4개·title·siteName·글 페이지 https URL·checkedAt 0~STALE_DAYS)
//                        ∧ hazards 전부 알려진 태그 ∧ (독성·섭취 → contentKind HEALTH) ∧ 용품 카테고리 ∈ /tips 섹션
//                        ∧ (hazards ≥ 1 → 참조 사이트 도메인 서로 다른 2곳 이상, 총괄 ②(b))
//                        ∧ summaryCheck 유효(키 3개·sources = references[].url 집합·checkedAt 0~STALE_DAYS·checkedBy ≠ AI_DRAFT)
//                        ∧ (contentKind HEALTH ∨ 독성·섭취 태그 → TIP_VET_REVIEW_REQUIRED 이면 vetReview 유효(키 3개·VET 등급·reviewedAt 0~STALE_DAYS·source))
//                        ∧ ∃ 노출 type t: t.careProfileId === careProfileId ∧ (animalTypeIds 없음 ∨ 포함) ∧ (t,item) 노출
//   같은 id 가 여러 행이면 전부 노출일 때만 노출.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SEED_FILES = {
  animalTypes: 'animal-types.json',
  taxa: 'taxa.json',
  careProfiles: 'care-profiles.json',
  supplyItems: 'supply-items.json',
  supplyRequirements: 'supply-requirements.json',
  compatibilityRules: 'compatibility-rules.json',
  setupBundles: 'setup-bundles.json',
  curatedProducts: 'curated-products.json',
  testimonials: 'testimonials.json',
  vetClinics: 'vet-clinics.json',
  photos: 'photos.json',
  budgetTips: 'budget-tips.json',
};
export const SEED_KEYS = Object.keys(SEED_FILES);

const REVIEWER_RANK = ['AI_DRAFT', 'OPERATOR', 'EXPERIENCED_KEEPER', 'VET_PUBLISHED_SOURCE', 'OFFICIAL_SOURCE', 'VET'];
export const PHOTO_LICENSES = new Set(['CC0', 'CC_BY', 'CC_BY_SA', 'SITE_LICENSE', 'PERMISSION']);
export const PRODUCT_IMAGE_LICENSES = new Set(['OWN_PHOTO', 'SELLER_PERMISSION', 'AFFILIATE_API']);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

export function isVerifiedRow(r) {
  return isObj(r) && r.reviewStatus === 'VERIFIED' && REVIEWER_RANK.indexOf(r.reviewerType) >= REVIEWER_RANK.indexOf('OPERATOR');
}

/** 검수 유효 일수 — server/src/engine/domain.ts STALE_DAYS 와 같아야 한다(패리티 테스트 engine.exposure.parity). */
export const STALE_DAYS = 180;

/** 356: 일반 참고 정보 등급 허용 6종 — server/src/engine/general-info.ts 와 같아야 한다(패리티 engine.general-info.parity). */
export const GENERAL_INFO_TYPE_IDS = Object.freeze(['hamster-robo', 'gerbil-mongolian', 'budgie', 'cockatiel', 'lovebird-peach', 'sun-conure']);
export const GENERAL_INFO_MAX_AGE_DAYS = STALE_DAYS;
/** 엔진 server/src/engine/exposure.ts FEED_EXCLUDED_CATEGORIES 미러(피드 0 품목 분류). */
export const FEED_EXCLUDED_CATEGORY_SET = new Set(['FOOD', 'HEALTH']);
const GI_KINDS = new Set(['SPEC', 'CARE', 'FOOD', 'HEALTH']);
const GI_CROSS_KINDS = new Set(['FOOD', 'HEALTH']);

/** 356: GENERAL_INFO 행 유효(타입 범위는 보지 않음 — computeExposure 가 체인 type 으로 본다). 엔진과 독립 구현, fail-closed. */
export function generalInfoRowOk(r, asOfDay) {
  if (!isObj(r) || r.reviewStatus !== 'GENERAL_INFO') return false;
  if (!REVIEWER_RANK.includes(r.reviewerType)) return false;
  if (!GI_KINDS.has(r.contentKind)) return false;
  const d = dayNumber(r.draftedAt);
  if (d === null || asOfDay - d < 0 || asOfDay - d > GENERAL_INFO_MAX_AGE_DAYS) return false;
  if (!GI_CROSS_KINDS.has(r.contentKind)) return true;
  const cc = r.crossCheck;
  if (!isObj(cc)) return false;
  const ks = Object.keys(cc).sort();
  if (ks.length !== 3 || ks[0] !== 'checkedAt' || ks[1] !== 'result' || ks[2] !== 'tool') return false;
  if (cc.tool !== 'CODEX_DISCUSS' || (cc.result !== 'AGREE' && cc.result !== 'REVISED')) return false;
  const c = dayNumber(cc.checkedAt);
  return c !== null && c >= d && c <= asOfDay;
}

/** YYYY-MM-DD(달력상 존재) → 정수 일 번호, 아니면 null. 엔진과 독립 구현(Date 왕복 검사). */
export function dayNumber(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  if (y < 1000) return null;
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return t / 86_400_000;
}

/** verifiedAt 이 asOfDay 기준 0~STALE_DAYS 일 전. 누락·형식 오류·미래는 false(fail-closed). */
export function isFreshRow(r, asOfDay) {
  if (!isObj(r)) return false;
  const v = dayNumber(r.verifiedAt);
  if (v === null) return false;
  const age = asOfDay - v;
  return age >= 0 && age <= STALE_DAYS;
}

/**
 * CC 증서 URL(독립 구현, S1 M-3): https://creativecommons.org/licenses/(by|by-sa)/(2.0|2.5|3.0|4.0)/[deed.xx] → 'CC_BY'|'CC_BY_SA',
 *   /publicdomain/zero/1.0/ → 'CC0', 그 밖(다른 호스트·http·쿼리·userinfo·NC 등) → null.
 */
export function ccLicenseOfUrl(url) {
  if (typeof url !== 'string') return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'creativecommons.org' || u.port !== '' || u.username !== '' || u.password !== '') return null;
  if (u.search !== '' || u.hash !== '' || url !== u.href) return null;
  const m = /^\/(?:licenses\/(by|by-sa)\/(?:2\.0|2\.5|3\.0|4\.0)|publicdomain\/zero\/1\.0)\/(?:deed\.[a-z]{2}(?:-[a-z]{2,4})?)?$/.exec(u.pathname);
  if (!m) return null;
  return m[1] === undefined ? 'CC0' : m[1] === 'by' ? 'CC_BY' : 'CC_BY_SA';
}

/** 사용 가능 사진 상태(S-R4 L-E) — engine PHOTO_USABLE_STATUSES 와 같다(패리티 테스트). SLOT·미지값 불가. */
export const PHOTO_USABLE_STATUSES = new Set(['READY']);

/** https + 점 있는 호스트(engine HTTPS_URL 과 같은 엄격도, S-R4 L-D). */
const HTTPS_DOTTED_URL = /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/;

/**
 * 출처 코드 → 원본 호스트 허용목록(SEC-2 M-1, 독립 구현) — engine PHOTO_SOURCE_HOSTS 와 같다(패리티 테스트).
 *   OWN·SELLER·AFFILIATE 는 사진 증빙 필드 규칙이 문서에 없어 사용 불가(fail-closed).
 */
export const PHOTO_SOURCE_HOSTS = Object.freeze({
  WIKIMEDIA: Object.freeze(['commons.wikimedia.org', 'upload.wikimedia.org']),
  UNSPLASH: Object.freeze(['unsplash.com', 'images.unsplash.com']),
  PEXELS: Object.freeze(['www.pexels.com', 'pexels.com', 'images.pexels.com']),
  PIXABAY: Object.freeze(['pixabay.com', 'cdn.pixabay.com']),
});

/**
 * 원본 URL 이 출처의 허용 호스트인가(M-1, 독립 구현 — WHATWG URL 파싱 + 원문 대조).
 *   https ∧ userinfo·포트 없음 ∧ hostname 허용목록 ∧ 원문 authority 가 hostname 과 글자 그대로 같다(대소문자·끝 점·인코딩 정규화로 통과 금지).
 */
export function photoSourceUrlAllowed(source, sourceUrl) {
  if (typeof source !== 'string' || typeof sourceUrl !== 'string') return false;
  if (!Object.hasOwn(PHOTO_SOURCE_HOSTS, source)) return false;
  if (!HTTPS_DOTTED_URL.test(sourceUrl)) return false;
  let u;
  try {
    u = new URL(sourceUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return false;
  if (!PHOTO_SOURCE_HOSTS[source].includes(u.hostname)) return false;
  const rest = sourceUrl.slice('https://'.length);
  if (!rest.startsWith(u.hostname)) return false;
  const next = rest.charAt(u.hostname.length);
  return next === '' || next === '/' || next === '?' || next === '#';
}

/** CC BY-SA 카드 슬롯 허용목록(L8, 독립 구현) — engine CC_BY_SA_CARD_SLOT_RE 와 같은 집합(패리티 테스트). */
const CC_BY_SA_SLOT_EXACT = new Set(['review-side', 'vet-empty', 'done']);
const CC_BY_SA_SLOT_PREFIX = /^(?:intro-[1-9]|(?:group|l4)-[a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** CC BY-SA 는 원본 그대로(modified === false) ∧ 카드 슬롯만(히어로·합성 금지). 다른 라이선스는 true. */
export function ccBySaPlacementOk(p) {
  if (!isObj(p) || p.license !== 'CC_BY_SA') return true;
  if (p.modified !== false || typeof p.slot !== 'string') return false;
  return CC_BY_SA_SLOT_EXACT.has(p.slot) || CC_BY_SA_SLOT_PREFIX.test(p.slot);
}

// ── 354(Kenny 2026-11-23 「빈 이미지 칸 0」): 생성 이미지 기록 규칙(독립 구현 — engine/photo-ai.ts 와 패리티 시험) ─────────────
export const PHOTO_AI_LICENSE = 'AI_GENERATED';
export const PHOTO_AI_SOURCES = new Set(['CODEX', 'AGY']);
/** 배포 파일 /assets/(photos|items)/<kebab>[--<kebab>].webp — 경로 순회·대문자·다른 확장자 금지. */
export const PHOTO_ASSET_PATH_RE = /^\/assets\/(?:photos|items)\/[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?\.webp$/;
/** 프롬프트 파일 docs/assets/prompts/<kebab>[--<kebab>].md(저장소 상대). */
export const PHOTO_PROMPT_RE = /^docs\/assets\/prompts\/[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?\.md$/;
const MACHINE_SIGNER_EXACT = new Set(['AI', 'AGY', 'GPT']);
const MACHINE_SIGNER_PART = ['AIDRAFT', 'AIGENERATED', 'CODEX', 'ANTIGRAVITY', 'CHATGPT', 'OPENAI', 'GEMINI', 'CLAUDE', 'GPTIMAGE', 'IMAGEGEN'];

/** 종 확인 서명자가 사람이 아닌 표지(AI_DRAFT 변형·생성 도구·모델 이름)인가. */
export function machineSigner(v) {
  if (typeof v !== 'string') return false;
  const letters = v.normalize('NFKC').toUpperCase().replace(/[^A-Z]/g, '');
  return MACHINE_SIGNER_EXACT.has(letters) || MACHINE_SIGNER_PART.some((m) => letters.includes(m));
}

/** AI_GENERATED 행의 누락·위반 필드 이름 목록(빈 배열 = 기록 완전). */
export function aiPhotoRowMissing(p) {
  const miss = [];
  if (!isObj(p)) return ['row'];
  if (!PHOTO_AI_SOURCES.has(p.source)) miss.push('source(CODEX|AGY)');
  if (p.sourceUrl !== null && p.sourceUrl !== undefined) miss.push('sourceUrl(null 이어야 함)');
  if (p.licenseUrl !== null && p.licenseUrl !== undefined) miss.push('licenseUrl(null 이어야 함)');
  const gen = dayNumber(p.generatedAt);
  if (gen === null) miss.push('generatedAt');
  if (typeof p.promptPath !== 'string' || !PHOTO_PROMPT_RE.test(p.promptPath)) miss.push('promptPath(docs/assets/prompts/<kebab>.md)');
  if (typeof p.asset !== 'string' || !PHOTO_ASSET_PATH_RE.test(p.asset)) miss.push('asset(/assets/(photos|items)/<kebab>.webp)');
  const sc = p.speciesCheck;
  if (!isObj(sc)) {
    miss.push('speciesCheck');
    return miss;
  }
  const ks = Object.keys(sc);
  if (ks.length !== 2 || !ks.includes('checkedBy') || !ks.includes('checkedAt')) miss.push('speciesCheck(키 checkedBy·checkedAt 만)');
  if (!nonEmpty(sc.checkedBy) || machineSigner(sc.checkedBy)) miss.push('speciesCheck.checkedBy(사람 — AI_DRAFT·생성 도구 금지)');
  const chk = dayNumber(sc.checkedAt);
  if (chk === null || (gen !== null && chk < gen)) miss.push('speciesCheck.checkedAt(생성일 이후 날짜)');
  return miss;
}

/** engine isPhotoUsable 과 정확히 같은 판정(S-R4 L-D, 패리티 테스트) — 이보다 넓으면 안 된다. */
export function isPhotoUsableRow(p) {
  if (!isObj(p) || !PHOTO_USABLE_STATUSES.has(p.status)) return false;
  if (p.license === PHOTO_AI_LICENSE) return aiPhotoRowMissing(p).length === 0;
  if (p.asset !== undefined && p.asset !== null && (typeof p.asset !== 'string' || !PHOTO_ASSET_PATH_RE.test(p.asset))) return false;
  if ((p.license === 'CC_BY' || p.license === 'CC_BY_SA') && ccLicenseOfUrl(p.licenseUrl) !== p.license) return false;
  if (!PHOTO_LICENSES.has(p.license)) return false;
  if (!nonEmpty(p.source)) return false;
  if (dayNumber(p.downloadedAt) === null) return false;
  if (typeof p.sourceUrl !== 'string' || !HTTPS_DOTTED_URL.test(p.sourceUrl)) return false;
  if (!photoSourceUrlAllowed(p.source, p.sourceUrl)) return false;
  if (!ccBySaPlacementOk(p)) return false;
  return p.license === 'CC0' || nonEmpty(p.author);
}

// ── 359 C6-IMG-SPECIES: 사진 자리 종 범위(독립 구현 — server/src/engine/photo-resolve.ts 와 패리티 시험, compliance-scan.test T23) ──
//   장면 행(scope 없는 ph-xx)은 골든햄스터를 찍은 사진이라 그 종에만 붙는다(359 D-1 A). 엔진을 import 하지 않는다 — 시험이 원문 상수를 대조한다.
export const SCENE_PHOTO_GROUPS = Object.freeze(['SMALL_MAMMAL']);
export const SCENE_PHOTO_TYPE_IDS = Object.freeze(['hamster-golden']);
/** 종 자리(use) → 장면 행 id. ws-data 키는 habitat·nowLead·spec(PHOTO_WS_TYPE_KEYS). */
export const TYPE_SCENE_PHOTOS = Object.freeze({ habitat: 'ph-01', 'now-lead': 'ph-03', spec: 'ph-08' });
/** 품목 자리 장면 대체 — 이 표에 없는 품목은 장면 대체 없음(범용 ph-03 폐지, 359). */
export const ITEM_SCENE_PHOTOS = Object.freeze({ cage: 'ph-08', bedding: 'ph-09', food: 'ph-10' });
/** 홈 A 공용 장면(ws-data types[대표].homeScenes 키 → 장면 행 id). */
export const HOME_A_SCENE_PHOTOS = Object.freeze({ startChecklist: 'ph-03', startSpecCheck: 'ph-08', startSetup: 'ph-01', explainNeed: 'ph-12', explainFigures: 'ph-02' });
/** ws-data types[i].photos 키 → 종 자리 use. */
export const PHOTO_WS_TYPE_KEYS = Object.freeze({ habitat: 'habitat', nowLead: 'now-lead', spec: 'spec' });

/** 이 종(노출 타입 행)의 자리에 장면 행을 붙일 수 있는가 — 그룹 ∧ 종 둘 다(모름 → false, fail-closed). */
export function sceneAllowedForType(t) {
  return isObj(t) && SCENE_PHOTO_GROUPS.includes(t.group) && SCENE_PHOTO_TYPE_IDS.includes(t.id);
}

// ── 저렴 대체 팁 참조 규칙(독립 구현 — engine/tips.ts 와 패리티 테스트 tips.parity) ─────────────
// Kenny 11/22 지시 범위 4종(케이지·은신처·급수·바닥재) — TOY 제거(309 m-2·310 LOW-3).
export const TIP_SECTION_CATEGORIES = Object.freeze(['CAGE', 'HIDE', 'WATER', 'BEDDING']);
export const TIP_HAZARDS = new Set(['TOXIC_MATERIAL', 'INGESTION', 'ENTRAPMENT', 'ESCAPE', 'VENTILATION', 'HEAT', 'TIP_OVER']);
const TIP_HEALTH_HAZARDS = new Set(['TOXIC_MATERIAL', 'INGESTION']);
// 1차 방어 = 글 사이트 허용 목록(310 MED-2, 접미사 일치). 호스트 추가는 PM 결정 행(_workspace/decisions.md) 필요 — engine/tips.ts 와 같은 목록.
export const TIP_ARTICLE_HOSTS = Object.freeze(['namu.wiki', 'brunch.co.kr', 'mirochuu.com', 'gall.dcinside.com', 'vegannews.co.kr']);
// 2차 방어 = 판매처·단축 URL 차단 목록(허용 목록이 잘못 넓어질 때의 안전망).
export const TIP_COMMERCE_HOSTS = Object.freeze([
  'coupang.com', 'gmarket.co.kr', '11st.co.kr', 'auction.co.kr', 'ssg.com', 'emart.com', 'lotteon.com', 'lotteimall.com',
  'wemakeprice.com', 'tmon.co.kr', 'interpark.com', 'kurly.com', 'musinsa.com', 'homeplus.co.kr', 'gsshop.com', 'cjonmall.com',
  'hmall.com', 'danawa.com', 'enuri.com',
  'smartstore.naver.com', 'shopping.naver.com', 'brand.naver.com', 'search.shopping.naver.com',
  'shop.kakao.com', 'store.kakao.com', 'gift.kakao.com',
  'daiso.co.kr', 'daisomall.co.kr', 'ikea.com', 'ohou.se', 'costco.co.kr', 'costco.com',
  'aliexpress.com', 'aliexpress.us', 'temu.com', 'amazon.com', 'amazon.co.jp', 'ebay.com', 'qoo10.com', 'qoo10.jp',
  'shopee.com', 'shopee.sg', 'shopee.tw', 'shopee.co.id', 'shopee.com.my', 'shopee.ph', 'shopee.vn', 'shopee.co.th',
  'iherb.com', 'taobao.com', 'tmall.com', '1688.com', 'rakuten.co.jp',
  'petfriends.co.kr', 'aboutpet.co.kr',
  'ali.ski', 'amzn.to', 'link.naver.com', 'naver.me', 'bit.ly', 'han.gl', 'vo.la', 'tinyurl.com', 'me2.do', 'linktr.ee',
  'inpock.co.kr', 'goo.gl', 't.co', 'is.gd', 'cutt.ly', 'shorturl.at', 'rebrand.ly', 'buly.kr', 'url.kr', 'lrl.kr',
]);
const TIP_AFF_KEY = /^(?:aff|affiliate|aff_?id|aff_?code|ref|referrer|refer|partner|partner_?id|tracking|track|subid|sub_?id|clickid|click_?id|pid|ad|adid|ad_?id|lptag|itemid|vendoritemid|productid|goodsno|utm_[a-z0-9_]*)$/i;
const TIP_PRODUCT_PATH = /\/(?:products?|goods|vp\/products|item|items|itm|dp|gp\/product|shop|store|cart|deal|deals)(?:\/|$)/i;

/** 원문 URL 이 글 페이지로 허용되는가(fail-closed). */
export function tipReferenceUrlAllowed(url) {
  if (typeof url !== 'string' || url === '' || url.trim() !== url) return false;
  if (!HTTPS_DOTTED_URL.test(url)) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return false;
  const rest = url.slice('https://'.length);
  const next = rest.charAt(u.hostname.length);
  if (!rest.startsWith(u.hostname) || !(next === '' || next === '/' || next === '?' || next === '#')) return false;
  // 306 D2: 끝 점 호스트(`a.com.`)는 판매처 판정 전에 정규화 — 그리고 비정규형이므로 어차피 거부(fail-closed).
  const host = u.hostname.replace(/\.+$/, '');
  // IP 리터럴(IPv6 대괄호·콜론, 마지막 라벨이 10진·0x 16진) 별도 거부.
  if (host.startsWith('[') || host.includes(':') || /^(?:\d+|0x[0-9a-f]*)$/.test(host.slice(host.lastIndexOf('.') + 1))) return false;
  if (TIP_COMMERCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return false;
  if (!TIP_ARTICLE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return false;
  if (host !== u.hostname) return false;
  if (TIP_PRODUCT_PATH.test(u.pathname)) return false;
  for (const k of u.searchParams.keys()) if (TIP_AFF_KEY.test(k)) return false;
  return u.hash === '';
}

// 2단계 공개 접미사(server/src/seed/hostname.ts 와 같은 목록 — 시험이 동일성 확인).
export const TIP_MULTI_LABEL_SUFFIXES = new Set([
  'co.kr', 'or.kr', 'go.kr', 'ac.kr', 'ne.kr', 're.kr', 'pe.kr', 'ms.kr', 'hs.kr', 'es.kr', 'sc.kr', 'kg.kr', 'mil.kr',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'nhs.uk', 'com.au', 'org.au', 'gov.au', 'edu.au',
  'co.jp', 'or.jp', 'ac.jp', 'go.jp', 'com.cn', 'co.nz', 'org.nz',
]);

/** 총괄 ②(b): 참조의 서로 다른 사이트 도메인 수(허용 안 되는 URL 은 세지 않음). */
export function tipDomainCount(refs) {
  if (!Array.isArray(refs)) return 0;
  const seen = new Set();
  for (const r of refs) {
    if (!isObj(r) || !tipReferenceUrlAllowed(r.url)) continue;
    const parts = new URL(r.url).hostname.split('.');
    const tail2 = parts.slice(parts.length - 2).join('.');
    const take = TIP_MULTI_LABEL_SUFFIXES.has(tail2) ? 3 : 2;
    if (parts.length >= take) seen.add(parts.slice(parts.length - take).join('.'));
  }
  return seen.size;
}

export function tipReferencesValid(refs, asOfDay) {
  if (!Array.isArray(refs) || refs.length === 0) return false;
  return refs.every((r) => {
    if (!isObj(r)) return false;
    const ks = Object.keys(r);
    if (ks.length !== 4 || !['title', 'url', 'siteName', 'checkedAt'].every((k) => ks.includes(k))) return false;
    if (!nonEmpty(r.title) || !nonEmpty(r.siteName) || !tipReferenceUrlAllowed(r.url)) return false;
    const d = dayNumber(r.checkedAt);
    return d !== null && asOfDay - d >= 0 && asOfDay - d <= STALE_DAYS;
  });
}

// ── 총괄 ORDERS 11/22 18:4x — 수의 검수 표시(vetReview)·요약 원문 대조 기록(summaryCheck). 독립 구현(engine/tips.ts 와 패리티 시험) ──
// 되돌리기 쉬운 플래그 — engine/tips.ts TIP_VET_REVIEW_REQUIRED 와 같은 값이어야 한다.
export const TIP_VET_REVIEW_REQUIRED = true;
export const TIP_VET_REVIEWER_TYPES = Object.freeze(['VET_PUBLISHED_SOURCE', 'OFFICIAL_SOURCE', 'VET']);

const keysExactly = (o, ks) => {
  const own = Object.keys(o);
  return own.length === ks.length && ks.every((k) => own.includes(k));
};
const ageOk = (v, asOfDay) => {
  const d = dayNumber(v);
  return d !== null && asOfDay - d >= 0 && asOfDay - d <= STALE_DAYS;
};

export function tipNeedsVetReview(x) {
  return x.contentKind === 'HEALTH' || (Array.isArray(x.hazards) && x.hazards.some((h) => TIP_HEALTH_HAZARDS.has(h)));
}

export function tipVetReviewValid(v, asOfDay) {
  if (!isObj(v) || !keysExactly(v, ['reviewerType', 'reviewedAt', 'source'])) return false;
  return TIP_VET_REVIEWER_TYPES.includes(v.reviewerType) && nonEmpty(v.source) && ageOk(v.reviewedAt, asOfDay);
}

export function tipSummaryCheckValid(sc, refs, asOfDay) {
  if (!isObj(sc) || !keysExactly(sc, ['sources', 'checkedAt', 'checkedBy'])) return false;
  if (!nonEmpty(sc.checkedBy) || sc.checkedBy.normalize('NFKC').toUpperCase().replace(/[^A-Z]/g, '').includes('AIDRAFT')) return false;
  if (!ageOk(sc.checkedAt, asOfDay)) return false;
  const src = sc.sources;
  if (!Array.isArray(src) || src.length === 0 || !src.every(nonEmpty) || new Set(src).size !== src.length) return false;
  if (!Array.isArray(refs) || refs.length === 0 || !refs.every((r) => isObj(r) && typeof r.url === 'string')) return false;
  const urls = new Set(refs.map((r) => r.url));
  if (!(src.length === urls.size && src.every((u) => urls.has(u)))) return false;
  // QA D4: 대조일 ≥ 가장 늦은 참조 확인일(engine tipSummaryCheckValid 와 동일).
  const checked = dayNumber(sc.checkedAt);
  return refs.every((r) => {
    const rd = dayNumber(r.checkedAt);
    return rd !== null && checked !== null && checked >= rd;
  });
}

export function tipReviewRecordsValid(x, asOfDay) {
  if (!tipSummaryCheckValid(x.summaryCheck, x.references, asOfDay)) return false;
  return !(TIP_VET_REVIEW_REQUIRED && tipNeedsVetReview(x) && !tipVetReviewValid(x.vetReview, asOfDay));
}

/**
 * seedDigest — manifest.seedDigest 결속 값(F3 prerender 와 같은 알고리즘이어야 한다).
 *   seedDir 의 *.json 파일명을 코드 유닛 순 정렬, 각 파일마다 `${name}\n` + 본문(UTF-8, BOM 제거, CRLF→LF) + `\n` 을
 *   sha256 에 순서대로 넣는다. 결과 = 소문자 hex 64자(접두사 없음).
 */
export function seedDigest(seedDir) {
  const names = readdirSync(seedDir).filter((f) => f.endsWith('.json')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const h = createHash('sha256');
  for (const name of names) {
    let text = readFileSync(join(seedDir, name), 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    text = text.replace(/\r\n/g, '\n');
    h.update(`${name}\n`, 'utf8');
    h.update(text, 'utf8');
    h.update('\n', 'utf8');
  }
  return h.digest('hex');
}

/** @returns {{ seed: Record<string, unknown[]>, errors: {file:string, message:string}[] }} */
export function readSeed(seedDir) {
  const seed = {};
  const errors = [];
  for (const key of SEED_KEYS) {
    const file = SEED_FILES[key];
    let text;
    try {
      text = readFileSync(join(seedDir, file), 'utf8');
    } catch {
      seed[key] = [];
      continue; // 누락 파일은 seed:validate(S01) 몫 — 노출 0 으로 취급(fail-closed)
    }
    try {
      const parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
      seed[key] = Array.isArray(parsed) ? parsed : [];
      if (!Array.isArray(parsed)) errors.push({ file, message: '최상위가 배열이 아니다' });
    } catch (e) {
      seed[key] = [];
      errors.push({ file, message: `JSON 파싱 실패: ${e.message}` });
    }
  }
  return { seed, errors };
}

function condOk(c, sv) {
  if (!isObj(c) || typeof c.key !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(sv, c.key)) return null;
  const v = sv[c.key];
  if (v === null || v === undefined) return null;
  switch (c.op) {
    case 'gte':
      return typeof v === 'number' && typeof c.value === 'number' ? v >= c.value : null;
    case 'lte':
      return typeof v === 'number' && typeof c.value === 'number' ? v <= c.value : null;
    case 'eq':
      return typeof c.value === 'object' && c.value !== null ? null : v === c.value;
    case 'in':
      return Array.isArray(c.value) ? c.value.includes(v) : null;
    case 'not_in':
      return Array.isArray(c.value) ? !c.value.includes(v) : null;
    default:
      return null;
  }
}

function rulesOf(set) {
  return isObj(set) && Array.isArray(set.rules) ? set.rules : [];
}

/** base <key> ⊕ AnimalType.careOverrides.requirements[item].<key> — (key, op) 같으면 교체. key = minSpec | recommendedSpec. */
function resolvedRules(req, type, itemId, specKey) {
  const rules = [...rulesOf(req[specKey])];
  const ov = isObj(type.careOverrides) && isObj(type.careOverrides.requirements) ? type.careOverrides.requirements[itemId] : undefined;
  if (ov !== undefined && !isObj(ov)) return null;
  if (isObj(ov) && ov[specKey] !== undefined) {
    if (!isObj(ov[specKey])) return null;
    for (const r of rulesOf(ov[specKey])) {
      if (!isObj(r)) return null;
      const i = rules.findIndex((x) => isObj(x) && x.key === r.key && x.op === r.op);
      if (i >= 0) rules[i] = r;
      else rules.push(r);
    }
  }
  return rules;
}

export function resolvedMinRules(req, type, itemId) {
  return resolvedRules(req, type, itemId, 'minSpec');
}

export function resolvedRecommendedRules(req, type, itemId) {
  return resolvedRules(req, type, itemId, 'recommendedSpec');
}

export function meetsMinRules(rules, specValues) {
  if (!Array.isArray(rules) || !isObj(specValues)) return false;
  for (const r of rules) {
    if (!isObj(r)) return false;
    const when = r.when === undefined ? [] : Array.isArray(r.when) ? r.when : [r.when];
    const ws = when.map((c) => condOk(c, specValues));
    if (ws.some((w) => w === null)) return false;
    if (ws.some((w) => w === false)) continue;
    if (condOk(r, specValues) !== true) return false;
  }
  return true;
}

function groupById(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!isObj(r) || typeof r.id !== 'string') continue;
    if (!m.has(r.id)) m.set(r.id, []);
    m.get(r.id).push(r);
  }
  return m;
}

/** 모든 행이 pred 를 만족하는 id 만. */
function idsWhere(rows, pred) {
  const out = new Set();
  for (const [id, rs] of groupById(rows)) if (rs.every(pred)) out.add(id);
  return out;
}

/**
 * @returns {{
 *   ids: Record<string, Set<string>>,      // seedKey → 노출 id
 *   types: Map<string, object>,            // 노출 animalType id → 행
 *   pairs: Set<string>,                    // `${typeId}|${itemId}` 노출 요구사항
 *   productTypes: Set<string>,             // `${typeId}|${productId}`
 *   vetRegions: Set<string>,
 *   ccByPhotos: string[],                  // 사용 가능 CC_BY·CC_BY_SA 사진 id
 *   licenseUrls: Map<string, string>,      // ccByPhotos id → licenseUrl(C6 /credits 링크 대조)
 *   tipTypes: Set<string>,                 // `${typeId}|${tipId}` 노출 팁(REFERENCE 경로)
 * }}
 * @param {Record<string, unknown[]>} seed
 * @param {string} asOf 노출 기준일 YYYY-MM-DD(필수, M-1)
 */
export function computeExposure(seed, asOf) {
  const asOfDay = dayNumber(asOf);
  if (asOfDay === null) throw new RangeError(`computeExposure: asOf 는 YYYY-MM-DD 여야 한다 (${String(asOf)})`);
  const ok = (r) => isVerifiedRow(r) && isFreshRow(r, asOfDay);
  // 356: 체인 메타 전용 — 코드 고정 6종 type 의 체인이면 GENERAL_INFO 행도 통과. 상품·구성안·호환·Taxon 은 ok 만.
  const giTypes = new Set(GENERAL_INFO_TYPE_IDS);
  const chainOk = (r, typeId) => ok(r) || (giTypes.has(typeId) && generalInfoRowOk(r, asOfDay));
  const rows = (k) => (Array.isArray(seed[k]) ? seed[k] : []);
  const profiles = groupById(rows('careProfiles'));
  const items = groupById(rows('supplyItems'));
  const chainProfile = (id, typeId) => typeof id === 'string' && profiles.has(id) && profiles.get(id).every((r) => chainOk(r, typeId));
  const chainItem = (id, typeId) => typeof id === 'string' && items.has(id) && items.get(id).every((r) => chainOk(r, typeId));

  const typeRows = groupById(rows('animalTypes'));
  const baseType = (t) => isObj(t) && t.status === 'ACTIVE' && chainOk(t, t.id) && chainProfile(t.careProfileId, t.id);

  const reqs = rows('supplyRequirements').filter(isObj);
  const reqIdGroups = groupById(reqs);
  const reqExposedForType = (t, r) =>
    baseType(t) &&
    r.careProfileId === t.careProfileId &&
    chainOk(r, t.id) &&
    chainItem(r.supplyItemId, t.id) &&
    reqIdGroups.get(r.id)?.every((x) => chainOk(x, t.id)) !== false;

  const pairs = new Set();
  const pairReq = new Map(); // typeId|itemId → req rows (같은 프로필·아이템 중복이면 전부 노출일 때만)
  const exposedReqIds = new Set();
  const types = new Map();
  for (const [id, ts] of typeRows) {
    if (ts.length !== 1 || !baseType(ts[0])) continue;
    const t = ts[0];
    const byItem = new Map();
    for (const r of reqs) if (r.careProfileId === t.careProfileId && typeof r.supplyItemId === 'string') {
      if (!byItem.has(r.supplyItemId)) byItem.set(r.supplyItemId, []);
      byItem.get(r.supplyItemId).push(r);
    }
    let any = false;
    for (const [itemId, rs] of byItem) {
      if (rs.length === 1 && reqExposedForType(t, rs[0])) {
        pairs.add(`${id}|${itemId}`);
        pairReq.set(`${id}|${itemId}`, rs[0]);
        exposedReqIds.add(rs[0].id);
        any = true;
      }
    }
    if (any) types.set(id, t);
  }
  // 노출 타입이 없는 쌍은 제거(base 만 통과하고 requirement 0 인 타입은 위에서 이미 제외).
  const exposedItemIds = new Set();
  for (const p of pairs) exposedItemIds.add(p.split('|')[1]);

  // 356r M1(불변식 3·7): 상품 판정용 체인 — type·프로필·요구사항·용품 전 행이 ok(VERIFIED ∧ 유효). GENERAL_INFO 체인(AI 초안 minSpec)에
  //   연결된 상품은 추천 영역에 내지 않는다(엔진 exposure.ts strictChainOk 미러, validate V13 이 연결 자체를 ERROR).
  const allOk = (grp) => Array.isArray(grp) && grp.length > 0 && grp.every(ok);
  const productStrictChain = (t, req, itemId) =>
    ok(t) && allOk(profiles.get(t.careProfileId)) && allOk(reqIdGroups.get(req.id)) && allOk(items.get(itemId));

  const productTypes = new Set();
  const productIds = idsWhere(rows('curatedProducts'), (p) => {
    if (!(p.status === 'ACTIVE' && ok(p) && p.meetsMinSpec === true && Array.isArray(p.careProfileIds))) return false;
    let any = false;
    for (const [tid, t] of types) {
      if (!p.careProfileIds.includes(t.careProfileId)) continue;
      const req = pairReq.get(`${tid}|${p.supplyItemId}`);
      if (!req || !productStrictChain(t, req, p.supplyItemId)) continue;
      const rules = resolvedMinRules(req, t, p.supplyItemId);
      const rec = resolvedRecommendedRules(req, t, p.supplyItemId);
      // M-1(QA): 최소·권장 해석 규칙이 둘 다 비면 무규격 — 엔진 evaluateProductStage 와 같게 CHECK(노출 불가, 불변식 ③ fail-closed).
      if (!rec || (rules && rules.length === 0 && rec.length === 0)) continue;
      if (rules && meetsMinRules(rules, p.specValues)) {
        productTypes.add(`${tid}|${p.id}`);
        any = true;
      }
    }
    return any;
  });

  const bundleIds = idsWhere(rows('setupBundles'), (b) => {
    if (!ok(b) || !Array.isArray(b.itemIds) || b.itemIds.length === 0) return false;
    for (const [tid, t] of types) {
      if (b.careProfileId === t.careProfileId && b.itemIds.every((i) => pairs.has(`${tid}|${i}`))) return true;
    }
    return false;
  });

  const typeProfiles = new Set([...types.values()].map((t) => t.careProfileId));
  const typeTaxa = new Set([...types.values()].map((t) => t.taxonId).filter((x) => typeof x === 'string'));
  // 271 qa LOW-1 → 277 QA M-1(PM 대안 규칙): 노출 프로필 taxonIds 도 더하되, 비노출 type 의 taxonId(노출 type 도 쓰는 것 제외)는 뺀다
  //   — 로보처럼 자기 PLANNED 타입이 있는 종은 가려지고, 자기 타입이 없는 종(캠벨)은 남는다(project.ts 미러).
  const hiddenTypeTaxa = new Set();
  for (const a of rows('animalTypes')) {
    if (isObj(a) && !types.has(a.id) && typeof a.taxonId === 'string' && !typeTaxa.has(a.taxonId)) hiddenTypeTaxa.add(a.taxonId);
  }
  for (const p of rows('careProfiles')) {
    if (!isObj(p) || !typeProfiles.has(p.id) || !Array.isArray(p.taxonIds)) continue;
    for (const x of p.taxonIds) if (typeof x === 'string' && !hiddenTypeTaxa.has(x)) typeTaxa.add(x);
  }

  const vetIds = idsWhere(rows('vetClinics'), (v) => isObj(v.verification) && v.verification.status === 'VERIFIED');
  const vetRegions = new Set();
  for (const v of rows('vetClinics')) if (isObj(v) && vetIds.has(v.id) && typeof v.region === 'string') vetRegions.add(v.region);

  const photoIds = idsWhere(rows('photos'), isPhotoUsableRow);
  const ccByPhotos = rows('photos')
    .filter((p) => isObj(p) && photoIds.has(p.id) && (p.license === 'CC_BY' || p.license === 'CC_BY_SA'))
    .map((p) => p.id);

  const ids = {
    animalTypes: new Set(types.keys()),
    taxa: idsWhere(rows('taxa'), (x) => ok(x) && typeTaxa.has(x.id)),
    // 356: 노출 type 의 baseType·쌍 판정이 이미 그 type 기준 chainOk(같은 id 전 행)를 봤다 — 여기서 ok 를 다시 요구하면 GENERAL_INFO 6종이 빠진다.
    careProfiles: idsWhere(rows('careProfiles'), (x) => typeProfiles.has(x.id)),
    supplyItems: idsWhere(rows('supplyItems'), (x) => exposedItemIds.has(x.id)),
    supplyRequirements: exposedReqIds,
    // M4: 프로필 범위 규칙은 노출 타입의 프로필일 때만(엔진 projectCatalog 와 같은 조건).
    compatibilityRules: idsWhere(
      rows('compatibilityRules'),
      (x) => ok(x) && exposedItemIds.has(x.a) && exposedItemIds.has(x.b) && (!x.careProfileId || typeProfiles.has(x.careProfileId)),
    ),
    setupBundles: bundleIds,
    curatedProducts: productIds,
    // F5: 노출 타입(types)의 후기만 — 비노출 동물 후기는 산출물에 있으면 C3-OUT-ID.
    testimonials: idsWhere(rows('testimonials'), (x) => x.status === 'APPROVED' && x.verifiedUsage === true && typeof x.animalTypeId === 'string' && types.has(x.animalTypeId)),
    vetClinics: vetIds,
    photos: photoIds,
  };
  // 저렴 대체 팁(REFERENCE 별도 경로) — tipTypes = `${typeId}|${tipId}`.
  // 356: 용품 검수는 tipOkFor 의 pairs(type 기준 chainOk)가 본다 — 엔진 isBudgetTipExposable(requirementOk) 미러.
  const itemCategory = (id) => (typeof id === 'string' && items.has(id) && items.get(id).length === 1 ? items.get(id)[0].category : undefined);
  const tipTypes = new Set();
  const tipOkFor = (x, tid, t) =>
    t.careProfileId === x.careProfileId && (x.animalTypeIds === undefined || (Array.isArray(x.animalTypeIds) && x.animalTypeIds.includes(tid))) && pairs.has(`${tid}|${x.supplyItemId}`);
  ids.budgetTips = idsWhere(rows('budgetTips'), (x) => {
    if (x.kind !== 'REFERENCE' || !tipReferencesValid(x.references, asOfDay)) return false;
    if (!Array.isArray(x.hazards) || !x.hazards.every((h) => TIP_HAZARDS.has(h))) return false;
    if (x.hazards.some((h) => TIP_HEALTH_HAZARDS.has(h)) && x.contentKind !== 'HEALTH') return false;
    if (x.hazards.length > 0 && tipDomainCount(x.references) < 2) return false; // 총괄 ②(b)
    if (!tipReviewRecordsValid(x, asOfDay)) return false; // 총괄 ORDERS 11/22 18:4x — summaryCheck·vetReview
    if (!TIP_SECTION_CATEGORIES.includes(itemCategory(x.supplyItemId))) return false;
    return [...types].some(([tid, t]) => tipOkFor(x, tid, t));
  });
  for (const x of rows('budgetTips')) {
    if (!isObj(x) || !ids.budgetTips.has(x.id)) continue;
    for (const [tid, t] of types) if (tipOkFor(x, tid, t)) tipTypes.add(`${tid}|${x.id}`);
  }
  const licenseUrls = new Map();
  for (const p of rows('photos')) if (isObj(p) && ccByPhotos.includes(p.id)) licenseUrls.set(p.id, p.licenseUrl);
  // 362 N16(365/367 틈): 피드 금지 품목 — SupplyItem 행 중 하나라도 FOOD/HEALTH 면(엔진 FEED_EXCLUDED_CATEGORIES 미러, 같은 id 여러 행도 fail-closed).
  const feedExcludedItems = new Set([...items].filter(([, rs]) => rs.some((r) => FEED_EXCLUDED_CATEGORY_SET.has(r?.category))).map(([id]) => id));
  return { ids, types, pairs, productTypes, vetRegions, ccByPhotos, licenseUrls, tipTypes, feedExcludedItems };
}
