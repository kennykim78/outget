// 사람·장소·사진 규칙 T01~T03·VC01·VC02·I01·I02 (불변식 1·7·8, A-18 — 부록 B 면제 파일).
import { PHOTO_USABLE_STATUSES, isoDayNumber, parseCcLicenseUrl } from '../engine/index.js';
import { asRec, isIsoDate, isNonEmptyStr, isSlotRow } from './common.js';
import type { Ctx } from './context.js';

export const TESTIMONIAL_SOURCE_RE = /^BETA_\d{4}_\d{2}$|^IN_APP$/;
export const QUOTE_MAX = 80;
/** T03(M7): 작성자 사진은 동일 오리진 자산 경로만(외부 URL·경로 순회·프로토콜 상대 금지). */
export const REVIEWER_IMAGE_RE = /^\/assets\/reviewers\/[a-z0-9][a-z0-9-]*\.(webp|avif|jpg|jpeg|png)$/;
/** 대한민국 대략 경계(VC02). 병원 고정 주소 좌표만 — 사용자 위치는 어디에도 두지 않는다(불변식 8). */
/** I01 사진 원본 URL — engine exposure.ts HTTPS_URL 과 같은 식(https + 점 있는 호스트). 패리티: seed.validate.test.ts. */
export const PHOTO_SOURCE_URL_RE = /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/;
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
    if (!isNonEmptyStr(rec.source)) out.error('I01', 'photos', id, 'source', '출처 사이트 기록 필요');
    // engine isPhotoUsable 과 같은 엄격도(검증 통과 ↔ 노출 가능 일치 — 통과했는데 조용히 안 보이는 사진 금지).
    if (typeof rec.sourceUrl !== 'string' || !PHOTO_SOURCE_URL_RE.test(rec.sourceUrl)) {
      out.error('I01', 'photos', id, 'sourceUrl', '원본 URL 필요 — https 이고 점 있는 호스트(engine isPhotoUsable 과 같음)');
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

export function checkPeople(ctx: Ctx): void {
  checkTestimonials(ctx);
  checkVets(ctx);
  checkPhotos(ctx);
}
