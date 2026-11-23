// 사진 고르기 — 종·품목 단위 사진의 대체 순서를 정하는 한 곳(351 §3-4, 354). 순수·결정론.
//   품목 자리: (종, 품목) → (케어프로필, 품목) → (품목) → 장면 행.
//   종 자리(habitat·now-lead·spec): (종) → (케어프로필) → 장면 행.
//   각 단계는 scope 키 집합이 정확히 같은 행만 보고, 그중 사용 가능(isPhotoUsable)한 첫 행을 고른다(SLOT·기록 미비 행은 건너뜀).
//   장면 행은 햄스터 사진(ph-01·03·08·09·10 …)이라 SCENE_PHOTO_GROUPS(지금 SMALL_MAMMAL) 종에만 대체로 붙는다 — 앵무(PARROT) 등
//   그룹 밖 종은 종·케어프로필 단위 행만 본다 — 사용 가능한 행이 없으면 가장 구체적인 빈 자리 행(SLOT 등, usable=false → I07),
//   그것도 없으면 null(I06 ERROR, 356 ⑦ 충돌 H). 그룹 모름(null)도 같은 취급(닫힌 쪽).
//   마지막 장면 행은 사용 가능 여부와 무관하게 돌려준다(아직 빈 자리면 usable=false → 호출자가 빈 블록). 장면 행조차 없으면 null
//   → validate I06 ERROR(빈 칸을 빌드에서 막는다). 사진은 scope 키로만 고른다 — 종 데이터(CareProfile 등)와 섞지 않는다(불변식 6).
import { isPhotoUsable } from './exposure.js';
import { isAiGeneratedPhoto } from './photo-ai.js';
import type { AnimalGroup } from './domain.js';
import type { PhotoRec, PhotoScope } from './types.js';

/** 화면 자리 종류. item = 품목 그림(홈 B 항목 카드 P6 · L4 P8 · 상품 대체 타일 P9 공용). */
export const PHOTO_USES = ['habitat', 'now-lead', 'spec', 'item'] as const;
export type PhotoUse = (typeof PHOTO_USES)[number];
export const PHOTO_TYPE_USES = ['habitat', 'now-lead', 'spec'] as const satisfies readonly PhotoUse[];

/**
 * 장면 행(photo id) — 지금 클라이언트가 쓰는 표와 같다(client Explain.tsx·HomeB.tsx·StartCards.tsx·SupplyLayer.tsx).
 *   홈 A 공용 자리(P1~P3)는 종·품목이 없어 장면 행만 쓴다.
 */
export const HOME_A_SCENE_PHOTOS = Object.freeze({
  startChecklist: 'ph-03',
  startSpecCheck: 'ph-08',
  startSetup: 'ph-01',
  explainNeed: 'ph-12',
  explainFigures: 'ph-02',
} as const);
export const TYPE_SCENE_PHOTOS: Readonly<Record<(typeof PHOTO_TYPE_USES)[number], string>> = Object.freeze({
  habitat: 'ph-01',
  'now-lead': 'ph-03',
  spec: 'ph-08',
});
export const ITEM_SCENE_PHOTOS: Readonly<Record<string, string>> = Object.freeze({ cage: 'ph-08', bedding: 'ph-09', food: 'ph-10' });
export const ITEM_SCENE_FALLBACK = 'ph-03';

/**
 * 장면 행(scope 없는 ph-xx)이 대체로 붙을 수 있는 동물 그룹. 지금 장면 행은 전부 햄스터 사진이라 SMALL_MAMMAL 만
 *   (356 ⑦ 충돌 H: 앵무 자리에 햄스터 케이지 사진이 붙지 않게). 앵무 장면 행이 생기면 그룹별 장면 표를 따로 둔다.
 */
export const SCENE_PHOTO_GROUPS: readonly AnimalGroup[] = Object.freeze(['SMALL_MAMMAL'] as const);

/** 이 그룹의 종 자리가 장면 행으로 대체될 수 있는가(그룹 모름 → false). */
export function sceneFallbackAllowed(group: AnimalGroup | null | undefined): boolean {
  return typeof group === 'string' && (SCENE_PHOTO_GROUPS as readonly string[]).includes(group);
}

/** 장면 행 id(대체 순서의 마지막). */
export function scenePhotoIdFor(use: PhotoUse, supplyItemId?: string | null): string {
  if (use === 'item') {
    return typeof supplyItemId === 'string' && Object.prototype.hasOwnProperty.call(ITEM_SCENE_PHOTOS, supplyItemId)
      ? ITEM_SCENE_PHOTOS[supplyItemId]
      : ITEM_SCENE_FALLBACK;
  }
  return TYPE_SCENE_PHOTOS[use];
}

export interface PhotoQuery {
  use: PhotoUse;
  animalTypeId: string;
  /** 종의 그룹(AnimalType.group). 장면 행 대체는 SCENE_PHOTO_GROUPS 안에서만 — null 이면 대체 없음. */
  group: AnimalGroup | null;
  /** 종의 케어프로필(없으면 그 단계를 건너뜀). */
  careProfileId: string | null;
  /** use === 'item' 에서 필수. */
  supplyItemId?: string | null;
}

export type PhotoLevel = 'TYPE_ITEM' | 'PROFILE_ITEM' | 'ITEM' | 'TYPE' | 'PROFILE' | 'SCENE';

export interface ResolvedPhoto {
  photo: PhotoRec;
  level: PhotoLevel;
  /** isPhotoUsable — false 면 아직 빈 자리(장면 행 SLOT 등). */
  usable: boolean;
  /** 「생성 이미지 · 임시」 표기 대상(usable ∧ AI_GENERATED). */
  aiGenerated: boolean;
}

/** scope 허용 키. */
export const PHOTO_SCOPE_KEYS = ['use', 'animalTypeId', 'careProfileId', 'supplyItemId'] as const;

/** scope 의 정규 키 — `use|t:<id>|p:<id>|i:<id>`(없는 키는 빠짐). 중복 판정·단계 일치에 쓴다. 형식 오류면 null. */
export function photoScopeKey(scope: unknown): string | null {
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) return null;
  const s = scope as Record<string, unknown>;
  if (Object.keys(s).some((k) => !(PHOTO_SCOPE_KEYS as readonly string[]).includes(k))) return null;
  if (typeof s.use !== 'string') return null;
  const parts = [s.use];
  for (const [k, tag] of [['animalTypeId', 't'], ['careProfileId', 'p'], ['supplyItemId', 'i']] as const) {
    if (s[k] === undefined) continue;
    if (typeof s[k] !== 'string' || s[k] === '') return null;
    parts.push(`${tag}:${s[k] as string}`);
  }
  return parts.join('|');
}

function wantKey(use: string, t?: string | null, p?: string | null, i?: string | null): string {
  const s: PhotoScope = { use };
  if (t) s.animalTypeId = t;
  if (p) s.careProfileId = p;
  if (i) s.supplyItemId = i;
  return photoScopeKey(s) as string;
}

/** 이 질의의 단계별 scope 키(구체적인 것부터). */
export function photoLevels(q: PhotoQuery): Array<[Exclude<PhotoLevel, 'SCENE'>, string]> {
  const out: Array<[Exclude<PhotoLevel, 'SCENE'>, string]> = [];
  if (q.use === 'item') {
    const item = q.supplyItemId;
    if (typeof item !== 'string' || item === '') return out;
    out.push(['TYPE_ITEM', wantKey('item', q.animalTypeId, null, item)]);
    if (q.careProfileId) out.push(['PROFILE_ITEM', wantKey('item', null, q.careProfileId, item)]);
    out.push(['ITEM', wantKey('item', null, null, item)]);
    return out;
  }
  out.push(['TYPE', wantKey(q.use, q.animalTypeId)]);
  if (q.careProfileId) out.push(['PROFILE', wantKey(q.use, null, q.careProfileId)]);
  return out;
}

const hasScope = (p: PhotoRec): boolean => p.scope !== undefined && p.scope !== null;

/** 종·품목 단위 사진 고르기. 장면 행까지 없거나 그룹이 장면 대체 밖인데 종·프로필 행도 없으면 null(validate I06). */
export function resolvePhoto(photos: readonly PhotoRec[], q: PhotoQuery): ResolvedPhoto | null {
  if (!(PHOTO_USES as readonly string[]).includes(q.use)) return null;
  if (q.use === 'item' && (typeof q.supplyItemId !== 'string' || q.supplyItemId === '')) return null;
  for (const [level, key] of photoLevels(q)) {
    for (const p of photos) {
      if (!hasScope(p) || photoScopeKey(p.scope) !== key) continue;
      if (isPhotoUsable(p)) return { photo: p, level, usable: true, aiGenerated: isAiGeneratedPhoto(p) };
    }
  }
  if (!sceneFallbackAllowed(q.group)) {
    // 장면 대체 밖 그룹: 장면 행 대신 가장 구체적인 종·프로필 자리 행(아직 SLOT·기록 미비)을 빈 자리로 돌려준다(usable=false → I07).
    //   그런 행도 없으면 null(I06) — 종 단위 슬롯을 먼저 두어야 한다(356 ⑦ 충돌 H).
    for (const [level, key] of photoLevels(q)) {
      const p = photos.find((x) => hasScope(x) && photoScopeKey(x.scope) === key);
      if (p) return { photo: p, level, usable: false, aiGenerated: false };
    }
    return null;
  }
  return resolveScenePhoto(photos, scenePhotoIdFor(q.use, q.supplyItemId));
}

/** 장면 행(scope 없는 photo id) — 홈 A 공용 자리와 대체 순서의 마지막. */
export function resolveScenePhoto(photos: readonly PhotoRec[], photoId: string): ResolvedPhoto | null {
  const p = photos.find((x) => x.id === photoId && !hasScope(x));
  if (!p) return null;
  const usable = isPhotoUsable(p);
  return { photo: p, level: 'SCENE', usable, aiGenerated: usable && isAiGeneratedPhoto(p) };
}

/** 렌더 자리 하나(validate I06·I07 이 전부 확인한다). */
export type PhotoPlacement =
  | { kind: 'scene'; photoId: string }
  | { kind: 'query'; query: PhotoQuery };

/**
 * 화면에 그려지는 사진 자리 전수 — 홈 A 공용 장면 + 종마다 종 자리 3개 + 그 종 케어프로필의 요구 품목마다 품목 자리.
 *   types 는 화면에 나갈 수 있는 타입(호출자가 고른다: validate 는 status ACTIVE ∧ careProfileId 있음).
 */
export function photoPlacements(
  types: ReadonlyArray<{ id: string; group: AnimalGroup | null; careProfileId: string | null }>,
  itemsOfProfile: (careProfileId: string) => readonly string[],
): PhotoPlacement[] {
  const out: PhotoPlacement[] = Object.values(HOME_A_SCENE_PHOTOS).map((photoId) => ({ kind: 'scene', photoId }));
  for (const t of types) {
    for (const use of PHOTO_TYPE_USES) out.push({ kind: 'query', query: { use, animalTypeId: t.id, group: t.group, careProfileId: t.careProfileId } });
    if (!t.careProfileId) continue;
    for (const item of itemsOfProfile(t.careProfileId)) {
      out.push({ kind: 'query', query: { use: 'item', animalTypeId: t.id, group: t.group, careProfileId: t.careProfileId, supplyItemId: item } });
    }
  }
  return out;
}

/** 자리 하나 풀기. */
export function resolvePlacement(photos: readonly PhotoRec[], pl: PhotoPlacement): ResolvedPhoto | null {
  return pl.kind === 'scene' ? resolveScenePhoto(photos, pl.photoId) : resolvePhoto(photos, pl.query);
}
