// 사람·장소·사진 규칙 T01~T03·VC01·VC02·I01~I08 (불변식 1·7·8, A-18 — 부록 B 면제 파일).
import {
  PHOTO_AI_LICENSE,
  PHOTO_ASSET_RE,
  PHOTO_SCOPE_KEYS,
  PHOTO_USABLE_STATUSES,
  PHOTO_USES,
  aiPhotoRecordProblems,
  isAnimalGroup,
  isoDayNumber,
  parseCcLicenseUrl,
  photoPlacements,
  photoScopeKey,
  resolvePlacement,
  sceneFallbackAllowed,
  scenePhotoIdFor,
  type PhotoRec,
} from '../engine/index.js';
import { asRec, isIsoDate, isNonEmptyStr, isSlotRow } from './common.js';
import type { Ctx } from './context.js';

export const TESTIMONIAL_SOURCE_RE = /^BETA_\d{4}_\d{2}$|^IN_APP$/;
export const QUOTE_MAX = 80;
/** T03(M7): 작성자 사진은 동일 오리진 자산 경로만(외부 URL·경로 순회·프로토콜 상대 금지). */
export const REVIEWER_IMAGE_RE = /^\/assets\/reviewers\/[a-z0-9][a-z0-9-]*\.(webp|avif|jpg|jpeg|png)$/;
/** 대한민국 대략 경계(VC02). 병원 고정 주소 좌표만 — 사용자 위치는 어디에도 두지 않는다(불변식 8). */
/** I01 사진 원본 URL — engine exposure.ts HTTPS_URL 과 같은 식(https + 점 있는 호스트). 패리티: seed.validate.test.ts. */
export const PHOTO_SOURCE_URL_RE = /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/;
/**
 * I01 출처 코드 → 원본 호스트 허용목록(SEC-2 M-1, 세 번째 독립 구현) — engine PHOTO_SOURCE_HOSTS ·
 *   scripts/lib/seed-exposure.mjs PHOTO_SOURCE_HOSTS 와 같다(패리티: engine.exposure.photo-host.test.ts).
 *   OWN·SELLER·AFFILIATE 는 사진 증빙 필드 규칙이 문서에 없어 사용 불가(fail-closed, 오류로 보고).
 */
export const PHOTO_SOURCE_HOSTS: Readonly<Record<string, readonly string[]>> = {
  WIKIMEDIA: ['commons.wikimedia.org', 'upload.wikimedia.org'],
  UNSPLASH: ['unsplash.com', 'images.unsplash.com'],
  PEXELS: ['www.pexels.com', 'pexels.com', 'images.pexels.com'],
  PIXABAY: ['pixabay.com', 'cdn.pixabay.com'],
};

/** 원본 URL 호스트 문제(없으면 null): authority = 'https://' 뒤 첫 '/'·'?'·'#' 전까지 원문, 허용 호스트와 정확히 같아야 한다. */
export function photoSourceHostIssue(source: unknown, sourceUrl: unknown): string | null {
  if (typeof source !== 'string' || !Object.prototype.hasOwnProperty.call(PHOTO_SOURCE_HOSTS, source)) {
    return `출처 ${JSON.stringify(source)} 는 사진에 쓸 수 없다 — ${Object.keys(PHOTO_SOURCE_HOSTS).join('/')} 만(OWN·SELLER·AFFILIATE 증빙 규칙 미정)`;
  }
  if (typeof sourceUrl !== 'string' || !sourceUrl.startsWith('https://')) return '원본 URL 은 https';
  const tail = sourceUrl.slice('https://'.length);
  const cut = tail.search(/[/?#]/);
  const authority = cut < 0 ? tail : tail.slice(0, cut);
  if (authority.includes('@')) return '원본 URL 에 userinfo(@) 금지';
  if (!PHOTO_SOURCE_HOSTS[source].includes(authority)) {
    return `${source} 원본 호스트는 ${PHOTO_SOURCE_HOSTS[source].join('|')} 만 (현재 ${JSON.stringify(authority)})`;
  }
  return null;
}

/** I03(L8) CC BY-SA 카드 슬롯 — 히어로·합성 금지, 원본 그대로 쓰는 카드만(이미지-소싱 §1). 패리티 테스트로 engine 과 같은 집합. */
export const CC_BY_SA_SLOTS_RE = /^(?:intro-[1-9]|group-[a-z0-9]+(?:-[a-z0-9]+)*|l4-[a-z0-9]+(?:-[a-z0-9]+)*|review-side|vet-empty|done)$/;

export const KR_BOUNDS ={ latMin: 33, latMax: 39, lngMin: 124, lngMax: 132 } as const;

function checkTestimonials(ctx: Ctx): void {
  const { out } = ctx;
  for (const { rec, id } of ctx.rows.testimonials) {
    const img = rec.reviewerImage;
    if (img !== null && img !== undefined) {
      if (rec.reviewerImageConsent !== true) out.error('T02', 'testimonials', id, 'reviewerImageConsent', '작성자 사진은 별도 동의 필요');
      if (typeof img !== 'string' || !REVIEWER_IMAGE_RE.test(img)) {
        out.error('T03', 'testimonials', id, 'reviewerImage', `reviewerImage 는 /assets/reviewers/<kebab>.(webp|avif|jpg|jpeg|png) 만 (현재 ${JSON.stringify(img)})`);
      }
    }
    if (rec.status !== 'APPROVED') continue;
    if (rec.verifiedUsage !== true) out.error('T01', 'testimonials', id, 'verifiedUsage', 'APPROVED 후기는 verifiedUsage=true(실사용 확인)만');
    const q = typeof rec.quote === 'string' ? rec.quote.trim() : '';
    const len = [...q].length;
    if (len < 1 || len > QUOTE_MAX) out.error('T01', 'testimonials', id, 'quote', `quote 1~${QUOTE_MAX}자 (현재 ${len})`);
    if (!isIsoDate(rec.consentAt)) out.error('T01', 'testimonials', id, 'consentAt', 'APPROVED 후기는 게시 동의일 필요');
    if (typeof rec.source !== 'string' || !TESTIMONIAL_SOURCE_RE.test(rec.source)) {
      out.error('T01', 'testimonials', id, 'source', 'source 는 BETA_YYYY_MM 또는 IN_APP');
    }
  }
}

function inRange(v: unknown, lo: number, hi: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

function checkVets(ctx: Ctx): void {
  const { out } = ctx;
  for (const { rec, id } of ctx.rows.vetClinics) {
    // VC02 — 둘 다 null 이거나 둘 다 국내 범위.
    const y = rec.lat;
    const x = rec.lng;
    const bothNull = y === null && x === null;
    const bothIn = inRange(y, KR_BOUNDS.latMin, KR_BOUNDS.latMax) && inRange(x, KR_BOUNDS.lngMin, KR_BOUNDS.lngMax);
    if (!bothNull && !bothIn) out.error('VC02', 'vetClinics', id, 'lat/lng', '좌표는 둘 다 null 이거나 둘 다 국내 범위');

    const v = asRec(rec.verification);
    if (!v || isSlotRow('vetClinics', rec) || v.status !== 'VERIFIED') continue;
    for (const f of ['name', 'address', 'phone', 'region'] as const) {
      if (!isNonEmptyStr(rec[f])) out.error('VC01', 'vetClinics', id, f, `VERIFIED 병원은 ${f} 필요`);
    }
    if (!isIsoDate(v.verifiedAt)) out.error('VC01', 'vetClinics', id, 'verification.verifiedAt', 'VERIFIED 병원은 확인일 필요');
    if (v.method !== 'PHONE_CALL') out.error('VC01', 'vetClinics', id, 'verification.method', '전화 확인(PHONE_CALL)만 VERIFIED — 홈페이지 문구만으로 확인 금지');
  }
}

function checkPhotos(ctx: Ctx): void {
  const { out } = ctx;
  for (const { rec, id } of ctx.rows.photos) {
    if (isSlotRow('photos', rec)) continue;
    // L-E(S-R4): 사용 가능 상태는 허용목록만(SLOT 은 빈 자리). 미지 상태는 조용히 숨기지 않고 오류로.
    if (!(PHOTO_USABLE_STATUSES as readonly unknown[]).includes(rec.status)) {
      out.error('I01', 'photos', id, 'status', `사진 status 는 SLOT 또는 ${PHOTO_USABLE_STATUSES.join('/')} (현재 ${JSON.stringify(rec.status)})`);
    }
    if (rec.license === null || rec.license === undefined) out.error('I01', 'photos', id, 'license', '사용권 기록 필요(불변식 1)');
    // I04(354, Kenny 2026-11-23): 생성 이미지는 원본 URL·저작자 대신 생성 기록 전부(engine isPhotoUsable AI 분기와 같은 규칙).
    if (rec.license === PHOTO_AI_LICENSE) {
      for (const p of aiPhotoRecordProblems(rec)) out.error('I04', 'photos', id, p.field, p.message);
      continue;
    }
    if (rec.asset !== null && rec.asset !== undefined && (typeof rec.asset !== 'string' || !PHOTO_ASSET_RE.test(rec.asset))) {
      out.error('I04', 'photos', id, 'asset', `배포 파일은 /assets/(photos|items)/<kebab>[--<kebab>].webp (현재 ${JSON.stringify(rec.asset)})`);
    }
    if (!isNonEmptyStr(rec.source)) out.error('I01', 'photos', id, 'source', '출처 사이트 기록 필요');
    // engine isPhotoUsable 과 같은 엄격도(검증 통과 ↔ 노출 가능 일치 — 통과했는데 조용히 안 보이는 사진 금지).
    if (typeof rec.sourceUrl !== 'string' || !PHOTO_SOURCE_URL_RE.test(rec.sourceUrl)) {
      out.error('I01', 'photos', id, 'sourceUrl', '원본 URL 필요 — https 이고 점 있는 호스트(engine isPhotoUsable 과 같음)');
    } else if (isNonEmptyStr(rec.source)) {
      // M-1: 출처 코드 ↔ 원본 호스트 허용목록 + userinfo 거부(engine isPhotoSourceUrlAllowed 와 같음).
      const hostIssue = photoSourceHostIssue(rec.source, rec.sourceUrl);
      if (hostIssue) out.error('I01', 'photos', id, 'sourceUrl', hostIssue);
    }
    // I03(L8): CC BY-SA 는 원본 그대로(modified=false) 카드 슬롯에만 — 히어로·합성 결과물 동일 라이선스 공개 의무 회피.
    if (rec.license === 'CC_BY_SA') {
      if (rec.modified !== false) out.error('I03', 'photos', id, 'modified', 'CC_BY_SA 는 자르기·합성 없이 원본 그대로만(modified=false)');
      if (typeof rec.slot !== 'string' || !CC_BY_SA_SLOTS_RE.test(rec.slot)) {
        out.error('I03', 'photos', id, 'slot', `CC_BY_SA 는 원본을 쓰는 카드 슬롯에만 — 히어로·합성 슬롯 금지 (현재 ${JSON.stringify(rec.slot)})`);
      }
    }
    if (isoDayNumber(rec.downloadedAt) === null) out.error('I01', 'photos', id, 'downloadedAt', '내려받은 날짜 필요(달력상 YYYY-MM-DD)');
    if (rec.license !== 'CC0' && !isNonEmptyStr(rec.author)) out.error('I01', 'photos', id, 'author', 'CC0 외에는 저작자 기록 필요');

    // I02(S1 M-3) — CC BY 계열은 같은 종류의 creativecommons.org 증서 URL 필수(/credits 라이선스 링크). 있으면 허용목록만.
    const lic = rec.licenseUrl;
    const parsed = parseCcLicenseUrl(lic);
    if (rec.license === 'CC_BY' || rec.license === 'CC_BY_SA') {
      if (lic === null || lic === undefined) out.error('I02', 'photos', id, 'licenseUrl', `${rec.license} 는 라이선스 증서 URL 필요(https://creativecommons.org/licenses/…)`);
      else if (parsed?.license !== rec.license) out.error('I02', 'photos', id, 'licenseUrl', `licenseUrl 이 ${rec.license} 증서가 아니다(creativecommons.org 허용목록)`);
    } else if (lic !== null && lic !== undefined && parsed?.license !== rec.license) {
      out.error('I02', 'photos', id, 'licenseUrl', 'licenseUrl 은 creativecommons.org 증서(라이선스와 같은 종류)만');
    }
  }
}

/**
 * I05(354) — 사진 scope 형식·참조·종 정합. SLOT 행 포함(생성 대기 자리도 scope 가 맞아야 한다).
 *   키는 use·animalTypeId·careProfileId·supplyItemId 만, use ∈ PHOTO_USES, 단계 조합만(resolvePhoto 가 보는 키 집합),
 *   참조 존재, (종|프로필)+품목은 그 프로필에 요구 행이 있어야 한다(기니피그+쳇바퀴 같은 종 오류 사진을 막는다), 같은 scope 중복 금지,
 *   품목 자리 asset 은 /assets/items/, 종 자리는 /assets/photos/.
 */
function checkPhotoScopes(ctx: Ctx): void {
  const { out } = ctx;
  const seen = new Map<string, string>();
  const reqItems = new Set([...ctx.reqPairs].map((k) => k.slice(k.indexOf('|') + 1)));
  for (const { rec, id } of ctx.rows.photos) {
    if (rec.scope === null || rec.scope === undefined) continue;
    const err = (path: string, msg: string): void => out.error('I05', 'photos', id, path, msg);
    const s = asRec(rec.scope);
    if (!s) {
      err('scope', 'scope 는 객체 또는 null');
      continue;
    }
    const key = photoScopeKey(s);
    if (key === null) {
      err('scope', `scope 키는 ${PHOTO_SCOPE_KEYS.join('·')} 만, 값은 비어 있지 않은 문자열`);
      continue;
    }
    const use = s.use as string;
    if (!(PHOTO_USES as readonly string[]).includes(use)) {
      err('scope.use', `use 는 ${PHOTO_USES.join('/')} 중 하나 (현재 ${JSON.stringify(use)})`);
      continue;
    }
    const t = s.animalTypeId as string | undefined;
    const p = s.careProfileId as string | undefined;
    const i = s.supplyItemId as string | undefined;
    if (use === 'item') {
      if (i === undefined) err('scope.supplyItemId', 'item 자리는 supplyItemId 필요');
      if (t !== undefined && p !== undefined) err('scope', 'animalTypeId 와 careProfileId 는 함께 쓰지 않는다(대체 순서 단계 하나만)');
    } else {
      if (i !== undefined) err('scope.supplyItemId', `${use} 자리는 supplyItemId 를 쓰지 않는다`);
      if ((t === undefined) === (p === undefined)) err('scope', `${use} 자리는 animalTypeId 또는 careProfileId 중 하나만`);
    }
    if (t !== undefined && !ctx.byId.animalTypes.has(t)) err('scope.animalTypeId', `AnimalType "${t}" 없음`);
    if (p !== undefined && !ctx.byId.careProfiles.has(p)) err('scope.careProfileId', `CareProfile "${p}" 없음`);
    if (i !== undefined && !ctx.byId.supplyItems.has(i)) err('scope.supplyItemId', `SupplyItem "${i}" 없음`);
    if (i !== undefined) {
      const profile = p ?? (t !== undefined ? (ctx.byId.animalTypes.get(t)?.careProfileId as string | null | undefined) : undefined);
      if (t !== undefined || p !== undefined) {
        if (typeof profile !== 'string' || !ctx.reqPairs.has(`${profile}|${i}`)) {
          err('scope', `이 종(${t ?? p})의 요구 품목에 "${i}" 가 없다 — 다른 종의 용품 사진을 붙이지 않는다`);
        }
      } else if (!reqItems.has(i)) {
        err('scope.supplyItemId', `어느 종의 요구 품목에도 "${i}" 가 없다`);
      }
    }
    const prev = seen.get(key);
    if (prev !== undefined) err('scope', `같은 scope 가 이미 ${prev} 에 있다`);
    else seen.set(key, id);
    if (typeof rec.asset === 'string' && PHOTO_ASSET_RE.test(rec.asset)) {
      const dir = use === 'item' ? '/assets/items/' : '/assets/photos/';
      if (!rec.asset.startsWith(dir)) err('asset', `${use} 자리 파일은 ${dir} 아래`);
    }
  }
}

/**
 * I06·I07(354) — 화면 사진 자리 전수(engine photoPlacements: 홈 A 장면 + ACTIVE 종마다 종 자리 3 + 요구 품목 자리)를
 *   resolvePhoto 로 풀어 본다. 장면 행까지 없으면 I06 ERROR(빈 칸을 빌드에서 막는다). 풀렸지만 아직 사용 불가(SLOT·기록 미비)인
 *   자리는 I07 WARN 한 줄로 센다(생성 라운드 진척 — 0 이 「빈 이미지 칸 0」).
 */
function checkPhotoCoverage(ctx: Ctx): void {
  const { out } = ctx;
  const photos = ctx.rows.photos.map((r) => r.rec as unknown as PhotoRec);
  const types = ctx.rows.animalTypes
    .filter(({ rec }) => rec.status === 'ACTIVE' && isNonEmptyStr(rec.id))
    .map(({ rec }) => ({
      id: rec.id as string,
      group: isAnimalGroup(rec.group) ? rec.group : null,
      careProfileId: isNonEmptyStr(rec.careProfileId) ? rec.careProfileId : null,
    }));
  const itemsOf = (cp: string): string[] =>
    [...new Set(ctx.rows.supplyRequirements.filter(({ rec }) => rec.careProfileId === cp && isNonEmptyStr(rec.supplyItemId)).map(({ rec }) => rec.supplyItemId as string))];
  let empty = 0;
  let total = 0;
  for (const pl of photoPlacements(types, itemsOf)) {
    total++;
    const r = resolvePlacement(photos, pl);
    const where = pl.kind === 'scene' ? `홈 A 장면 ${pl.photoId}` : `${pl.query.animalTypeId} ${pl.query.use}${pl.query.supplyItemId ? ` ${pl.query.supplyItemId}` : ''}`;
    const scene = pl.kind === 'scene'
      ? pl.photoId
      : sceneFallbackAllowed(pl.query.group, pl.query.animalTypeId) ? scenePhotoIdFor(pl.query.use, pl.query.supplyItemId) : null;
    if (r === null && pl.kind === 'query' && scene === null) {
      // 356 ⑦ 충돌 H · 359 D-1 A: 장면 행(골든햄스터 사진)은 SCENE_PHOTO_TYPE_IDS 종의 종 자리·장면 표 품목에만 붙는다 —
      //   그 밖의 종·품목은 종·케어프로필 단위 행이 있어야 한다.
      out.error('I06', 'photos', null, 'scope', `사진 자리 ${where}: 그룹 ${pl.query.group ?? '(모름)'} 종 ${pl.query.animalTypeId} 은 장면 행(햄스터 사진) 대체 밖 — 종·케어프로필 단위 사진 행(scope)이 필요하다`);
    } else if (r === null) {
      out.error('I06', 'photos', null, 'scope', `사진 자리 ${where}: 종·품목 사진도 장면 행(${scene}, scope 없음)도 없다 — 빈 칸`);
    } else if (!r.usable) {
      empty++;
    }
  }
  if (empty > 0) out.warn('I07', 'photos', null, '', `빈 사진 칸 ${empty}/${total} — 사용 가능한 사진(READY·사용권 기록)이 아직 없다`);
}

/**
 * I08(359 H4) — 품목 단위(ITEM: 종·프로필 없이 supplyItemId 만) 사진 행은 그 품목을 요구하는 모든 종 화면에 같은 사진을 붙인다.
 *   요구 프로필이 두 그룹 이상(예: water — SMALL_MAMMAL·PARROT)에 걸치는 품목이면 다른 동물의 용품 사진이 섞이므로 ERROR —
 *   케어프로필 단위 행(careProfileId + supplyItemId)으로 나눈다. 프로필의 그룹은 그 프로필을 쓰는 AnimalType.group 으로 본다.
 */
function checkPhotoItemGroups(ctx: Ctx): void {
  const groupsOfProfile = new Map<string, Set<string>>();
  for (const { rec } of ctx.rows.animalTypes) {
    if (!isNonEmptyStr(rec.careProfileId) || !isAnimalGroup(rec.group)) continue;
    const g = groupsOfProfile.get(rec.careProfileId) ?? new Set<string>();
    g.add(rec.group);
    groupsOfProfile.set(rec.careProfileId, g);
  }
  const groupsOfItem = (item: string): string[] => {
    const out = new Set<string>();
    for (const { rec } of ctx.rows.supplyRequirements) {
      if (rec.supplyItemId !== item || !isNonEmptyStr(rec.careProfileId)) continue;
      for (const g of groupsOfProfile.get(rec.careProfileId) ?? []) out.add(g);
    }
    return [...out].sort();
  };
  for (const { rec, id } of ctx.rows.photos) {
    const s = asRec(rec.scope);
    if (!s || s.use !== 'item' || !isNonEmptyStr(s.supplyItemId)) continue;
    if (s.animalTypeId !== undefined || s.careProfileId !== undefined) continue;
    const groups = groupsOfItem(s.supplyItemId);
    if (groups.length >= 2) {
      ctx.out.error('I08', 'photos', id, 'scope', `품목 "${s.supplyItemId}" 는 여러 그룹(${groups.join('·')})이 요구한다 — 품목 단위 행 대신 케어프로필 단위 행(careProfileId)으로 나눈다(다른 동물 용품 사진 혼입 금지)`);
    }
  }
}

export function checkPeople(ctx: Ctx): void {
  checkTestimonials(ctx);
  checkVets(ctx);
  checkPhotos(ctx);
  checkPhotoScopes(ctx);
  checkPhotoCoverage(ctx);
  checkPhotoItemGroups(ctx);
}
