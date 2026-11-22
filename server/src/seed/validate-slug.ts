// URL 세그먼트 규칙 SL00~SL05(AnimalType.slug) + VC03(병원 지역) — R3 C2, 계획 §4·D3·D12.
//   slug 는 라벨 데이터(사실 아님). 프리렌더 라우트(/{type}/…, /vet/{region})가 충돌·순회 없이 만들어지도록 형태만 강제한다.
import { isSlotRow } from './common.js';
import type { Ctx } from './context.js';

/** 1~2 세그먼트, 세그먼트는 소문자·숫자 kebab-case(D3). */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)?$/;

/** 첫 세그먼트로 쓸 수 없는 값 — 고정 라우트·서버 경로(SL03). */
export const RESERVED_FIRST_SEGMENTS: readonly string[] = [
  'supplies', 'vet', 'credits', 'save', 'pick', 'api', 'auth', 'assets', 'data', 'health', '404',
  'mascots', 'admin', // SEC-5 L-5: /mascots/{asset}.svg 정적 자산·/admin 서버 경로
];

/** 둘째 세그먼트로 쓸 수 없는 값 — 타입 하위 라우트(/{type}/setup 등, SL05). */
export const RESERVED_SECOND_SEGMENTS: readonly string[] = ['setup', 'supplies', 'check', 'products', 'tips'];

/** 비SLOT 병원 region: 한글 토큰 2~3개, 단일 공백 구분(D12 — URL 은 공백→'-' 후 percent-encode). */
export const VET_REGION_RE = /^[가-힣]+( [가-힣]+){1,2}$/;

function checkAnimalSlugs(ctx: Ctx): void {
  const { out } = ctx;
  const valid: Array<{ id: string; slug: string; segs: string[] }> = [];

  for (const { rec, id } of ctx.rows.animalTypes) {
    const slug = rec.slug;
    const blank = slug === undefined || slug === null || (typeof slug === 'string' && slug.trim() === '');
    // SL00 — 노출 대상(ACTIVE)은 라우트가 있어야 한다.
    if (blank && rec.status === 'ACTIVE') {
      out.error('SL00', 'animalTypes', id, 'slug', 'ACTIVE 동물은 slug 필요(라우트 /{slug})');
      continue;
    }
    if (slug === undefined || slug === null) continue;
    if (typeof slug !== 'string') continue; // 타입 오류는 S03.
    // SL01
    if (!SLUG_RE.test(slug)) {
      out.error('SL01', 'animalTypes', id, 'slug', `slug 형식 오류 ${JSON.stringify(slug)} — 소문자·숫자 kebab-case 세그먼트 1~2개('/' 구분)`);
      continue;
    }
    valid.push({ id, slug, segs: slug.split('/') });
  }

  const firstOfOthers = (selfId: string): Set<string> =>
    new Set(valid.filter((v) => v.id !== selfId).map((v) => v.segs[0]));
  const seen = new Map<string, string>();

  for (const v of valid) {
    // SL02
    const dup = seen.get(v.slug);
    if (dup !== undefined) out.error('SL02', 'animalTypes', v.id, 'slug', `slug "${v.slug}" 중복(${dup})`);
    else seen.set(v.slug, v.id);
    // SL03
    if (RESERVED_FIRST_SEGMENTS.includes(v.segs[0])) {
      out.error('SL03', 'animalTypes', v.id, 'slug', `첫 세그먼트 "${v.segs[0]}" 는 예약 경로(${RESERVED_FIRST_SEGMENTS.join('/')})`);
    }
    // SL04 — 단일 세그먼트가 다른 타입의 family(/{group}) 경로와 겹치면 안 된다.
    if (v.segs.length === 1 && firstOfOthers(v.id).has(v.segs[0])) {
      out.error('SL04', 'animalTypes', v.id, 'slug', `단일 세그먼트 "${v.segs[0]}" 가 다른 동물 slug 의 첫 세그먼트(family 페이지)와 충돌`);
    }
    // SL05
    if (v.segs.length === 2 && RESERVED_SECOND_SEGMENTS.includes(v.segs[1])) {
      out.error('SL05', 'animalTypes', v.id, 'slug', `둘째 세그먼트 "${v.segs[1]}" 는 예약 하위 경로(${RESERVED_SECOND_SEGMENTS.join('/')})`);
    }
  }
}

function checkVetRegions(ctx: Ctx): void {
  for (const { rec, id } of ctx.rows.vetClinics) {
    if (isSlotRow('vetClinics', rec)) continue;
    if (typeof rec.region !== 'string') continue; // 타입 오류는 S03.
    if (!VET_REGION_RE.test(rec.region)) {
      ctx.out.error('VC03', 'vetClinics', id, 'region', `region ${JSON.stringify(rec.region)} — 한글 시도·시군구 2~3 토큰, 단일 공백(예: "서울 마포구")`);
    }
  }
}

export function checkSlugs(ctx: Ctx): void {
  checkAnimalSlugs(ctx);
  checkVetRegions(ctx);
}
