// 354(Kenny 2026-11-23 「빈 이미지 칸 0」): 생성 이미지(AI_GENERATED) 사진 기록 · 종·품목 단위 사진 고르기(resolvePhoto) ·
//   validate I04(생성 기록)·I05(scope)·I06(장면 행까지 없음)·I07(빈 칸 경고).
//   세 구현 패리티: engine isPhotoUsable · scripts/lib/seed-exposure.mjs isPhotoUsableRow · validate-people I04.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  HOME_A_SCENE_PHOTOS,
  PHOTO_ASSET_RE,
  PHOTO_PROMPT_PATH_RE,
  isMachineSignerMarker,
  isPhotoUsable,
  photoPlacements,
  photoScopeKey,
  publicHomeScenes,
  publicPhotoOf,
  publicTypePhotos,
  resolvePhoto,
  resolveScenePhoto,
  SCENE_PHOTO_GROUPS,
  SCENE_PHOTO_TYPE_IDS,
  sceneFallbackAllowed,
  type PhotoRec,
} from '../engine/index.js';
import { readSeedDirRaw } from '../seed/read.js';
import { validateSeed } from '../seed/validate.js';
import type { RawSeed, Rec } from '../seed/common.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mjs = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'seed-exposure.mjs')).href)) as {
  isPhotoUsableRow: (p: unknown) => boolean;
  machineSigner: (v: unknown) => boolean;
  PHOTO_ASSET_PATH_RE: RegExp;
  PHOTO_PROMPT_RE: RegExp;
};

const BASE_SEED = readSeedDirRaw(join(ROOT, 'server', 'seed')).raw;
const NOW = '2026-11-23';

const AI = {
  id: 'ph-01', slot: 'intro-1', status: 'READY', license: 'AI_GENERATED', source: 'CODEX', sourceUrl: null, licenseUrl: null,
  author: null, downloadedAt: null, modified: false, generatedAt: '2026-11-20', promptPath: 'docs/assets/prompts/intro-1.md',
  asset: '/assets/photos/intro-1.webp', speciesCheck: { checkedBy: '운영자 Kenny', checkedAt: '2026-11-21' },
};

function seedWith(mut: (photos: Rec[]) => void): Required<RawSeed> {
  const s = structuredClone(BASE_SEED) as Required<RawSeed>;
  mut(s.photos as Rec[]);
  return s;
}

/** ph-01 을 p 로 바꿨을 때 사진 규칙(I01~I04·S03·S07) 오류 0 인가. */
function validatePasses(p: Record<string, unknown>): boolean {
  const s = seedWith((ph) => {
    const row = ph.find((r) => r.id === 'ph-01') as Rec;
    Object.assign(row, p);
    for (const k of Object.keys(row)) if (!(k in p) && !['scene', 'query'].includes(k)) delete row[k];
  });
  const res = validateSeed(s, { now: NOW });
  return !res.errors.some((i) => i.file === 'photos.json' && ['I01', 'I02', 'I03', 'I04', 'S03', 'S07'].includes(i.rule));
}

const TABLE: Array<[string, Record<string, unknown>, boolean]> = [
  ['완전한 CODEX 기록', {}, true],
  ['AGY', { source: 'AGY' }, true],
  ['품목 그림 경로', { asset: '/assets/items/cage--cp-guineapig.webp', promptPath: 'docs/assets/prompts/cage--cp-guineapig.md' }, true],
  ['종 확인일 = 생성일', { speciesCheck: { checkedBy: 'Kenny', checkedAt: '2026-11-20' } }, true],
  ['SLOT 은 사용 불가', { status: 'SLOT' }, false],
  ['source WIKIMEDIA', { source: 'WIKIMEDIA' }, false],
  ['source 소문자', { source: 'codex' }, false],
  ['sourceUrl 있음', { sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg' }, false],
  ['licenseUrl 있음', { licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' }, false],
  ['generatedAt 없음', { generatedAt: null }, false],
  ['generatedAt 달력 아님', { generatedAt: '2026-02-30' }, false],
  ['promptPath 없음', { promptPath: undefined }, false],
  ['promptPath 순회', { promptPath: 'docs/assets/prompts/../x.md' }, false],
  ['promptPath 다른 폴더', { promptPath: 'docs/x.md' }, false],
  ['asset 없음', { asset: null }, false],
  ['asset png', { asset: '/assets/photos/intro-1.png' }, false],
  ['asset products 폴더', { asset: '/assets/products/intro-1.webp' }, false],
  ['asset 외부 URL', { asset: 'https://example.com/a.webp' }, false],
  ['asset 대문자', { asset: '/assets/photos/Intro-1.webp' }, false],
  ['speciesCheck 없음', { speciesCheck: null }, false],
  ['speciesCheck 추가 키', { speciesCheck: { checkedBy: 'Kenny', checkedAt: '2026-11-21', note: 'x' } }, false],
  ['checkedBy 빈칸', { speciesCheck: { checkedBy: ' ', checkedAt: '2026-11-21' } }, false],
  ['checkedBy AI_DRAFT', { speciesCheck: { checkedBy: 'AI_DRAFT', checkedAt: '2026-11-21' } }, false],
  ['checkedBy ai-draft 변형', { speciesCheck: { checkedBy: 'ａｉ－ｄｒａｆｔ', checkedAt: '2026-11-21' } }, false],
  ['checkedBy CODEX', { speciesCheck: { checkedBy: 'codex', checkedAt: '2026-11-21' } }, false],
  ['checkedBy agy', { speciesCheck: { checkedBy: 'agy', checkedAt: '2026-11-21' } }, false],
  ['checkedBy Claude', { speciesCheck: { checkedBy: 'Claude Opus', checkedAt: '2026-11-21' } }, false],
  ['checkedAt < generatedAt', { speciesCheck: { checkedBy: 'Kenny', checkedAt: '2026-11-19' } }, false],
  ['checkedAt 없음', { speciesCheck: { checkedBy: 'Kenny', checkedAt: null } }, false],
];

describe('AI_GENERATED 사진 기록 — engine ↔ mjs ↔ validate 패리티', () => {
  it.each(TABLE)('%s', (_n, patch, want) => {
    const p: Record<string, unknown> = { ...AI, ...patch };
    for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
    expect(isPhotoUsable(p as never), 'engine').toBe(want);
    expect(mjs.isPhotoUsableRow(p), 'mjs').toBe(want);
    // SLOT 행은 validate 가 기록을 보지 않는다(빈 자리) — 사용 불가지만 오류도 아님.
    if (p.status !== 'SLOT') expect(validatePasses(p), 'validate').toBe(want);
  });

  it('미래 생성일·확인일은 validate S07(엔진은 날짜 형식만 본다 — 시계 없음)', () => {
    expect(validatePasses({ ...AI, generatedAt: '2026-11-24', speciesCheck: { checkedBy: 'Kenny', checkedAt: '2026-11-24' } })).toBe(false);
  });

  it('비 AI 행의 asset 도 경로 형식(세 구현 같음)', () => {
    const real = {
      id: 'ph-01', slot: 'intro-1', status: 'READY', source: 'WIKIMEDIA', license: 'CC0', author: null, licenseUrl: null,
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg', downloadedAt: '2026-09-30', modified: false,
    };
    for (const [asset, want] of [[undefined, true], [null, true], ['/assets/photos/intro-1.webp', true], ['/assets/photos/../x.webp', false], ['/x.webp', false]] as const) {
      const p: Record<string, unknown> = { ...real };
      if (asset !== undefined) p.asset = asset;
      expect(isPhotoUsable(p as never), String(asset)).toBe(want);
      expect(mjs.isPhotoUsableRow(p), String(asset)).toBe(want);
      expect(validatePasses(p), String(asset)).toBe(want);
    }
  });

  it('경로 정규식·기계 서명 판정 engine ↔ mjs 동일', () => {
    expect(mjs.PHOTO_ASSET_PATH_RE.source).toBe(PHOTO_ASSET_RE.source);
    expect(mjs.PHOTO_PROMPT_RE.source).toBe(PHOTO_PROMPT_PATH_RE.source);
    for (const v of ['Kenny', '운영자', 'AI_DRAFT', 'ai draft', 'A.I.', 'AGY', 'Codex', 'Antigravity', 'gpt', 'gpt-image-1', 'OpenAI', 'Gemini', 'aidan', 'Agnes', '', 3]) {
      expect(mjs.machineSigner(v), String(v)).toBe(isMachineSignerMarker(v));
    }
    expect(isMachineSignerMarker('Kenny')).toBe(false);
    expect(isMachineSignerMarker('A.I.')).toBe(true);
  });
});

// ── resolvePhoto ─────────────────────────────────────────────────────────────────────────────────────────────
const ready = (id: string, scope: PhotoRec['scope'], extra: Record<string, unknown> = {}): PhotoRec =>
  ({ ...AI, id, slot: id, scope, asset: `/assets/${scope?.use === 'item' ? 'items' : 'photos'}/${id}.webp`, promptPath: `docs/assets/prompts/${id}.md`, ...extra }) as unknown as PhotoRec;
const sceneRows = (): PhotoRec[] =>
  ['ph-01', 'ph-02', 'ph-03', 'ph-08', 'ph-09', 'ph-10', 'ph-12'].map((id) => ({ id, slot: 'intro-1', status: 'SLOT', license: null }) as unknown as PhotoRec);

describe('resolvePhoto — 종+품목 → 케어프로필+품목 → 품목 → 장면', () => {
  const gp = { use: 'item' as const, animalTypeId: 'guinea-pig', group: 'SMALL_MAMMAL' as const, careProfileId: 'cp-guineapig', supplyItemId: 'cage' };
  // 359 D-1 A: 장면 행(햄스터 사진)은 그 사진을 찍은 종 hamster-golden 에만 대체로 붙는다 — 장면 단계 단언은 골든 질의로 본다.
  const golden = { use: 'item' as const, animalTypeId: 'hamster-golden', group: 'SMALL_MAMMAL' as const, careProfileId: 'cp-hamster-syrian', supplyItemId: 'cage' };

  it('종+품목 행이 가장 먼저', () => {
    const photos = [...sceneRows(), ready('cage', { use: 'item', supplyItemId: 'cage' }), ready('cage--cp-guineapig', { use: 'item', careProfileId: 'cp-guineapig', supplyItemId: 'cage' }), ready('cage--guinea-pig', { use: 'item', animalTypeId: 'guinea-pig', supplyItemId: 'cage' })];
    const r = resolvePhoto(photos, gp);
    expect(r?.level).toBe('TYPE_ITEM');
    expect(r?.photo.id).toBe('cage--guinea-pig');
    expect(r?.usable).toBe(true);
    expect(r?.aiGenerated).toBe(true);
  });

  it('케어프로필+품목 → 품목 → 장면 순으로 내려간다(사용 불가 행은 건너뜀)', () => {
    const slotTypeItem = { ...ready('cage--guinea-pig', { use: 'item', animalTypeId: 'guinea-pig', supplyItemId: 'cage' }), status: 'SLOT' } as PhotoRec;
    const prof = ready('cage--cp-guineapig', { use: 'item', careProfileId: 'cp-guineapig', supplyItemId: 'cage' });
    const item = ready('cage', { use: 'item', supplyItemId: 'cage' });
    expect(resolvePhoto([...sceneRows(), slotTypeItem, item, prof], gp)?.level).toBe('PROFILE_ITEM');
    expect(resolvePhoto([...sceneRows(), slotTypeItem, item], gp)?.level).toBe('ITEM');
    // 359 D-1 A: 기니피그는 장면 대체 밖 — 사용 가능한 행이 없으면 가장 구체적인 빈 자리(SLOT 종+품목 행)를 돌려준다(I07).
    const slotOnly = resolvePhoto([...sceneRows(), slotTypeItem], gp);
    expect([slotOnly?.photo.id, slotOnly?.level, slotOnly?.usable]).toEqual(['cage--guinea-pig', 'TYPE_ITEM', false]);
    // 장면 단계는 골든 질의로(장면 행 = 골든 사진).
    const scene = resolvePhoto(sceneRows(), golden);
    expect(scene?.level).toBe('SCENE');
    expect(scene?.photo.id).toBe('ph-08');
    expect(scene?.usable).toBe(false);
    expect(scene?.aiGenerated).toBe(false);
  });

  it('다른 종의 행은 고르지 않는다(골든햄스터 쳇바퀴 사진이 기니피그 자리에 오지 않음)', () => {
    const syrian = ready('wheel--hamster-golden', { use: 'item', animalTypeId: 'hamster-golden', supplyItemId: 'wheel' });
    const r = resolvePhoto([...sceneRows(), syrian], { use: 'item', animalTypeId: 'guinea-pig', group: 'SMALL_MAMMAL', careProfileId: 'cp-guineapig', supplyItemId: 'wheel' });
    // 359 D-1 A: 예전엔 장면 ph-03 으로 대체됐다 — 이제 기니피그는 장면 대체 밖이고 자기 행도 없어 null(I06), 골든 행은 여전히 0.
    expect(r).toBeNull();
  });

  it('종 자리: 종 → 케어프로필 → 장면, 장면 행 표는 클라이언트와 같다', () => {
    const prof = ready('habitat--cp-hamster-dwarf', { use: 'habitat', careProfileId: 'cp-hamster-dwarf' });
    const q = { use: 'habitat' as const, animalTypeId: 'hamster-dwarf', group: 'SMALL_MAMMAL' as const, careProfileId: 'cp-hamster-dwarf' };
    expect(resolvePhoto([...sceneRows(), prof], q)?.level).toBe('PROFILE');
    // 359 D-1 A: 장면 표 단언은 골든 질의로(드워프는 장면 대체 밖 — 아래 T2).
    const gq = { use: 'habitat' as const, animalTypeId: 'hamster-golden', group: 'SMALL_MAMMAL' as const, careProfileId: 'cp-hamster-syrian' };
    expect(resolvePhoto(sceneRows(), gq)?.photo.id).toBe('ph-01');
    expect(resolvePhoto(sceneRows(), { ...gq, use: 'now-lead' })?.photo.id).toBe('ph-03');
    expect(resolvePhoto(sceneRows(), { ...gq, use: 'spec' })?.photo.id).toBe('ph-08');
    expect(resolvePhoto(sceneRows(), { ...golden, supplyItemId: 'bedding' })?.photo.id).toBe('ph-09');
    expect(resolvePhoto(sceneRows(), { ...golden, supplyItemId: 'food' })?.photo.id).toBe('ph-10');
    expect(HOME_A_SCENE_PHOTOS).toEqual({ startChecklist: 'ph-03', startSpecCheck: 'ph-08', startSetup: 'ph-01', explainNeed: 'ph-12', explainFigures: 'ph-02' });
  });

  it('장면 행(scope 없음)까지 없으면 null, scope 있는 같은 id 는 장면으로 보지 않는다', () => {
    const noScene = sceneRows().filter((p) => p.id !== 'ph-08');
    expect(resolvePhoto(noScene, golden)).toBeNull();
    const scopedSameId = { ...ready('ph-08', { use: 'item', supplyItemId: 'tubes' }) } as PhotoRec;
    expect(resolvePhoto([...noScene, scopedSameId], golden)).toBeNull();
  });

  it('item 자리에 supplyItemId 없으면 null · scope 키 정규화', () => {
    expect(resolvePhoto(sceneRows(), { use: 'item', animalTypeId: 'guinea-pig', group: 'SMALL_MAMMAL', careProfileId: null })).toBeNull();
    expect(photoScopeKey({ supplyItemId: 'cage', use: 'item', animalTypeId: 'x' })).toBe('item|t:x|i:cage');
    expect(photoScopeKey({ use: 'item', other: 1 })).toBeNull();
    expect(photoScopeKey({ use: 'item', supplyItemId: '' })).toBeNull();
  });

  it('356 ⑦ 충돌 H: 앵무(PARROT) 자리에는 장면 행(햄스터 사진)이 붙지 않는다 — 종·프로필 행 우선, 없으면 null', () => {
    const budgie = { use: 'habitat' as const, animalTypeId: 'budgie', group: 'PARROT' as const, careProfileId: 'cp-parrot-small' };
    // 장면 행만 있으면: 앵무 종 자리 3 · 품목 자리 전부 null(햄스터 ph-01·03·08·09·10 이 오지 않음)
    for (const use of ['habitat', 'now-lead', 'spec'] as const) expect(resolvePhoto(sceneRows(), { ...budgie, use })).toBeNull();
    for (const item of ['cage', 'bedding', 'food', 'perch']) {
      expect(resolvePhoto(sceneRows(), { ...budgie, use: 'item', supplyItemId: item })).toBeNull();
    }
    // 장면 행이 사용 가능(READY)이어도 마찬가지
    const readyScenes = sceneRows().map((p) => ready(p.id, undefined));
    expect(resolvePhoto(readyScenes, budgie)).toBeNull();
    // 359 D-1 A: 그룹을 SMALL_MAMMAL 로 속여도 종이 골든이 아니면 장면 대체 없음. 골든이면 SCENE.
    expect(resolvePhoto(readyScenes, { ...budgie, group: 'SMALL_MAMMAL' })).toBeNull();
    expect(resolvePhoto(readyScenes, { ...budgie, group: 'SMALL_MAMMAL', animalTypeId: 'hamster-golden', careProfileId: 'cp-hamster-syrian' })?.level).toBe('SCENE');
    // 종 행 → 케어프로필 행 순으로는 그대로 고른다
    const typeRow = ready('habitat--budgie', { use: 'habitat', animalTypeId: 'budgie' });
    const profRow = ready('habitat--cp-parrot-small', { use: 'habitat', careProfileId: 'cp-parrot-small' });
    expect(resolvePhoto([...readyScenes, profRow, typeRow], budgie)?.photo.id).toBe('habitat--budgie');
    expect(resolvePhoto([...readyScenes, profRow], budgie)?.level).toBe('PROFILE');
    // 종 행이 아직 SLOT 이면 장면 행이 아니라 그 종 행을 빈 자리로 돌려준다(usable=false → I07, I06 아님)
    const slotType = { ...typeRow, status: 'SLOT' } as PhotoRec;
    const slotRes = resolvePhoto([...readyScenes, slotType], budgie);
    expect([slotRes?.photo.id, slotRes?.level, slotRes?.usable, slotRes?.aiGenerated]).toEqual(['habitat--budgie', 'TYPE', false, false]);
    // 사용 가능한 프로필 행이 SLOT 종 행보다 먼저(사용 가능 우선 → 빈 자리는 마지막)
    expect(resolvePhoto([...readyScenes, slotType, profRow], budgie)?.photo.id).toBe('habitat--cp-parrot-small');
    const cockatiel = { ...budgie, animalTypeId: 'cockatiel' };
    expect(resolvePhoto([...readyScenes, typeRow], cockatiel)).toBeNull(); // 다른 앵무 종 행도 안 붙음
    // 그룹 모름(null)도 닫힌 쪽
    expect(resolvePhoto(readyScenes, { ...budgie, group: null })).toBeNull();
    // 359 D-1 A: 그룹 ∧ 종 둘 다(종 인자 추가 — 그룹만으로는 열리지 않는다).
    expect(sceneFallbackAllowed('SMALL_MAMMAL', 'hamster-golden')).toBe(true);
    expect(sceneFallbackAllowed('SMALL_MAMMAL', 'guinea-pig')).toBe(false);
    expect(sceneFallbackAllowed('PARROT', 'hamster-golden')).toBe(false);
    expect(sceneFallbackAllowed(undefined, 'hamster-golden')).toBe(false);
    expect(sceneFallbackAllowed('SMALL_MAMMAL', undefined)).toBe(false);
    expect(SCENE_PHOTO_GROUPS).toEqual(['SMALL_MAMMAL']);
    expect(SCENE_PHOTO_TYPE_IDS).toEqual(['hamster-golden']);
  });

  // ── 359 T2~T5 ──
  const SM_OTHERS = [
    { animalTypeId: 'hamster-dwarf', careProfileId: 'cp-hamster-dwarf' },
    { animalTypeId: 'hamster-robo', careProfileId: 'cp-hamster-robo' },
    { animalTypeId: 'gerbil-mongolian', careProfileId: 'cp-gerbil-mongolian' },
    { animalTypeId: 'guinea-pig', careProfileId: 'cp-guineapig' },
  ] as const;
  const allReadyScenes = (): PhotoRec[] => ['ph-01', 'ph-02', 'ph-03', 'ph-08', 'ph-09', 'ph-10', 'ph-12'].map((id) => ready(id, undefined));
  const SCENE_IDS = /^ph-\d{2}$/;

  it('T2(D-1): 장면 행이 전부 READY 여도 골든만 SCENE — 드워프·로보·저빌·기니피그 종 자리는 장면 0(종 SLOT 행 있으면 그 행, 없으면 null)', () => {
    const scenes = allReadyScenes();
    for (const use of ['habitat', 'now-lead', 'spec'] as const) {
      const g = resolvePhoto(scenes, { use, animalTypeId: 'hamster-golden', group: 'SMALL_MAMMAL', careProfileId: 'cp-hamster-syrian' });
      expect([g?.level, g?.usable]).toEqual(['SCENE', true]);
      for (const t of SM_OTHERS) {
        const q = { use, group: 'SMALL_MAMMAL' as const, ...t };
        expect(resolvePhoto(scenes, q), `${t.animalTypeId} ${use}`).toBeNull();
        const slot = { ...ready(`ph-${t.animalTypeId}-${use}`, { use, animalTypeId: t.animalTypeId }), status: 'SLOT' } as PhotoRec;
        const r = resolvePhoto([...scenes, slot], q);
        expect([r?.photo.id, r?.level, r?.usable]).toEqual([`ph-${t.animalTypeId}-${use}`, 'TYPE', false]);
      }
    }
  });

  it('T3(D-1): 품목 자리 범용 장면 대체(ph-03) 폐지 — 골든 비매핑 품목 null, 기니피그 cage 에 ph-08 0', () => {
    const scenes = allReadyScenes();
    for (const item of ['hay', 'wheel', 'water', 'hideout']) {
      expect(resolvePhoto(scenes, { ...golden, supplyItemId: item }), item).toBeNull();
    }
    expect(resolvePhoto(scenes, { ...golden, supplyItemId: 'cage' })?.photo.id).toBe('ph-08');
    for (const item of ['cage', 'bedding', 'food', 'hay']) {
      const r = resolvePhoto(scenes, { ...gp, supplyItemId: item });
      expect(r === null || !SCENE_IDS.test(r.photo.id), item).toBe(true);
    }
    // 프로필 단위 SLOT 행이 있으면 그 행(빈 자리)
    const slot = { ...ready('ph-hamster-syrian-wheel', { use: 'item', careProfileId: 'cp-hamster-syrian', supplyItemId: 'wheel' }), status: 'SLOT' } as PhotoRec;
    const r = resolvePhoto([...scenes, slot], { ...golden, supplyItemId: 'wheel' });
    expect([r?.photo.id, r?.level, r?.usable]).toEqual(['ph-hamster-syrian-wheel', 'PROFILE_ITEM', false]);
  });

  it('T4: 로보 종·프로필 행이 READY 여도 저빌·드워프 결과에 그 id 0(역방향도)', () => {
    const rows = [
      ready('ph-hamster-robo-habitat', { use: 'habitat', animalTypeId: 'hamster-robo' }),
      ready('ph-cp-hamster-robo-habitat', { use: 'habitat', careProfileId: 'cp-hamster-robo' }),
      ready('ph-hamster-robo-wheel', { use: 'item', careProfileId: 'cp-hamster-robo', supplyItemId: 'wheel' }),
      ready('ph-gerbil-mongolian-habitat', { use: 'habitat', animalTypeId: 'gerbil-mongolian' }),
      ready('ph-gerbil-mongolian-wheel', { use: 'item', careProfileId: 'cp-gerbil-mongolian', supplyItemId: 'wheel' }),
      ...allReadyScenes(),
    ];
    const pick = (t: (typeof SM_OTHERS)[number], use: 'habitat' | 'item') =>
      resolvePhoto(rows, { use, group: 'SMALL_MAMMAL', ...t, ...(use === 'item' ? { supplyItemId: 'wheel' } : {}) })?.photo.id ?? null;
    const [dwarf, robo, gerbil] = SM_OTHERS;
    expect(pick(robo, 'habitat')).toBe('ph-hamster-robo-habitat');
    expect(pick(robo, 'item')).toBe('ph-hamster-robo-wheel');
    expect(pick(gerbil, 'habitat')).toBe('ph-gerbil-mongolian-habitat');
    expect(pick(gerbil, 'item')).toBe('ph-gerbil-mongolian-wheel');
    expect(pick(dwarf, 'habitat')).toBeNull();
    expect(pick(dwarf, 'item')).toBeNull();
  });

  it('T5: 프로필 공유 — cp-parrot-small water READY → 사랑앵무·모란앵무 같은 PROFILE_ITEM, 왕관앵무·썬코뉴어 0, 종 행은 그 종만', () => {
    const prof = ready('ph-parrot-small-water', { use: 'item', careProfileId: 'cp-parrot-small', supplyItemId: 'water' });
    const typeRow = ready('ph-budgie-water', { use: 'item', animalTypeId: 'budgie', supplyItemId: 'water' });
    const q = (animalTypeId: string, careProfileId: string) => ({ use: 'item' as const, animalTypeId, group: 'PARROT' as const, careProfileId, supplyItemId: 'water' });
    for (const id of ['budgie', 'lovebird-peach']) {
      const r = resolvePhoto([...allReadyScenes(), prof], q(id, 'cp-parrot-small'));
      expect([r?.photo.id, r?.level]).toEqual(['ph-parrot-small-water', 'PROFILE_ITEM']);
    }
    for (const id of ['cockatiel', 'sun-conure']) expect(resolvePhoto([...allReadyScenes(), prof, typeRow], q(id, 'cp-parrot-medium'))).toBeNull();
    expect(resolvePhoto([prof, typeRow], q('budgie', 'cp-parrot-small'))?.level).toBe('TYPE_ITEM');
    expect(resolvePhoto([prof, typeRow], q('lovebird-peach', 'cp-parrot-small'))?.photo.id).toBe('ph-parrot-small-water');
  });

  it('결정론: 같은 입력 같은 결과, 자리 전수에 홈 A 장면 5 + 종 자리 3', () => {
    const pl = photoPlacements([{ id: 'guinea-pig', group: 'SMALL_MAMMAL', careProfileId: 'cp-guineapig' }], () => ['cage', 'hay']);
    expect(pl.length).toBe(5 + 3 + 2);
    expect(JSON.stringify(photoPlacements([{ id: 'guinea-pig', group: 'SMALL_MAMMAL', careProfileId: 'cp-guineapig' }], () => ['cage', 'hay']))).toBe(JSON.stringify(pl));
  });
});

// ── 359 T1: 공개 투영 ─────────────────────────────────────────────────────────────────────────────────────────
describe('publicPhotoOf · publicTypePhotos · publicHomeScenes(ws-data 공개형 — 있을 때만 키)', () => {
  const slot = { id: 'ph-01', slot: 'intro-1', status: 'SLOT', license: null } as unknown as PhotoRec;
  const real = {
    id: 'ph-08', slot: 'l4-cage', status: 'READY', source: 'WIKIMEDIA', license: 'CC0', author: null, licenseUrl: null,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg', downloadedAt: '2026-09-30', modified: false, asset: '/assets/photos/l4-cage.webp',
  } as unknown as PhotoRec;

  it('T1: SLOT·usable=false·asset 없음 → undefined, READY+asset → {photoId, asset}, AI → aiGenerated:true, 다른 키 0', () => {
    expect(publicPhotoOf(null)).toBeUndefined();
    expect(publicPhotoOf(resolveScenePhoto([slot], 'ph-01'))).toBeUndefined();
    expect(publicPhotoOf({ photo: real, level: 'SCENE', usable: false, aiGenerated: false })).toBeUndefined();
    const noAsset = { ...real, asset: undefined } as unknown as PhotoRec;
    expect(publicPhotoOf(resolveScenePhoto([noAsset], 'ph-08'))).toBeUndefined();
    const bad = { ...real, asset: 'https://example.com/a.webp' } as unknown as PhotoRec;
    expect(publicPhotoOf({ photo: bad, level: 'SCENE', usable: true, aiGenerated: false })).toBeUndefined();
    expect(publicPhotoOf(resolveScenePhoto([real], 'ph-08'))).toEqual({ photoId: 'ph-08', asset: '/assets/photos/l4-cage.webp' });
    const ai = ready('ph-hamster-golden-x', { use: 'habitat', animalTypeId: 'hamster-golden' });
    const out = publicPhotoOf({ photo: ai, level: 'TYPE', usable: true, aiGenerated: true });
    expect(out).toEqual({ photoId: 'ph-hamster-golden-x', asset: '/assets/photos/ph-hamster-golden-x.webp', aiGenerated: true });
    expect(Object.keys(out ?? {})).toEqual(['photoId', 'asset', 'aiGenerated']); // speciesCheck·promptPath·source·author 0
  });

  it('publicTypePhotos: 사용 가능 자리만 키, 전부 비면 undefined · 앵무 종은 장면 0', () => {
    const golden = { animalTypeId: 'hamster-golden', group: 'SMALL_MAMMAL' as const, careProfileId: 'cp-hamster-syrian' };
    expect(publicTypePhotos(sceneRows(), golden)).toBeUndefined();
    const rows = [...sceneRows().filter((p) => p.id !== 'ph-08'), real];
    expect(publicTypePhotos(rows, golden)).toEqual({ spec: { photoId: 'ph-08', asset: '/assets/photos/l4-cage.webp' } });
    expect(publicTypePhotos(rows, { animalTypeId: 'budgie', group: 'PARROT', careProfileId: 'cp-parrot-small' })).toBeUndefined();
    expect(publicTypePhotos(rows, { animalTypeId: 'guinea-pig', group: 'SMALL_MAMMAL', careProfileId: 'cp-guineapig' })).toBeUndefined();
    const all = sceneRows().map((p) => ready(p.id, undefined));
    expect(Object.keys(publicTypePhotos(all, golden) ?? {})).toEqual(['habitat', 'nowLead', 'spec']);
  });

  it('publicHomeScenes(D-3): 대표 타입이 장면 허용일 때만, 사용 가능 장면만 키', () => {
    const all = sceneRows().map((p) => ready(p.id, undefined));
    const g = publicHomeScenes(all, { id: 'hamster-golden', group: 'SMALL_MAMMAL' });
    expect(Object.keys(g ?? {})).toEqual(['startChecklist', 'startSpecCheck', 'startSetup', 'explainNeed', 'explainFigures']);
    expect(g?.startSpecCheck?.photoId).toBe('ph-08');
    expect(publicHomeScenes(all, { id: 'budgie', group: 'PARROT' })).toBeUndefined();
    expect(publicHomeScenes(all, { id: 'guinea-pig', group: 'SMALL_MAMMAL' })).toBeUndefined();
    expect(publicHomeScenes(sceneRows(), { id: 'hamster-golden', group: 'SMALL_MAMMAL' })).toBeUndefined();
    expect(publicHomeScenes(all, null)).toBeUndefined();
  });
});

// ── validate I05·I06·I07 ─────────────────────────────────────────────────────────────────────────────────────
const rulesOf = (s: Required<RawSeed>, rule: string) => validateSeed(s, { now: NOW }).errors.filter((i) => i.rule === rule);

describe('validate 사진 scope·자리 전수', () => {
  it('실제 시드: I04·I05·I06 오류 0, I07 경고는 빈 칸 수를 센다', () => {
    const res = validateSeed(structuredClone(BASE_SEED), { now: NOW });
    expect(res.errors.filter((i) => ['I04', 'I05', 'I06'].includes(i.rule))).toEqual([]);
    const w = res.warnings.filter((i) => i.rule === 'I07');
    expect(w.length).toBe(1);
    expect(w[0].message).toMatch(/빈 사진 칸 \d+\/\d+/);
  });

  it('I06: 장면 행이 없어지면 그 자리마다 ERROR', () => {
    const s = seedWith((ph) => ph.splice(ph.findIndex((r) => r.id === 'ph-09'), 1));
    const e = rulesOf(s, 'I06');
    expect(e.length).toBeGreaterThan(0);
    expect(e.every((i) => i.message.includes('ph-09'))).toBe(true);
  });

  it('I06: 홈 A 전용 장면 행(ph-12)이 없으면 그 자리 하나만 ERROR', () => {
    const s = seedWith((ph) => {
      ph.splice(ph.findIndex((r) => r.id === 'ph-12'), 1);
    });
    // ph-12 는 홈 A 장면 전용 — 대체 경로가 없으므로 오류.
    expect(rulesOf(s, 'I06').length).toBe(1);
  });

  it('I06(356 ⑦ 충돌 H): 앵무가 ACTIVE 가 되면 장면 행(햄스터 사진)으로 메우지 않고 종 자리마다 ERROR — 종·프로필 행이 있으면 해소', () => {
    const activate = (s: Required<RawSeed>) => {
      (s.animalTypes as Rec[]).find((r) => r.id === 'budgie')!.status = 'ACTIVE';
      return s;
    };
    const budgieI06 = (s: Required<RawSeed>) => rulesOf(s, 'I06').filter((i) => i.message.includes('budgie'));
    // 356(6종 활성화): 실시드에서 앵무는 이미 ACTIVE 이고 종 자리 3개(ph-budgie-*)가 SLOT 행으로 있다 → 실시드엔 I06 0.
    expect((BASE_SEED.animalTypes as Rec[]).find((r) => r.id === 'budgie')?.status).toBe('ACTIVE');
    expect(budgieI06(seedWith(() => {}))).toEqual([]);
    // 종 자리 행을 빼면 장면 행(햄스터 사진)으로 메우지 않고 자리마다 ERROR.
    const dropBudgieRows = (ph: Rec[]) => {
      for (let i = ph.length - 1; i >= 0; i--) if ((ph[i].scope as Record<string, unknown> | undefined)?.animalTypeId === 'budgie') ph.splice(i, 1);
    };
    const e = budgieI06(activate(seedWith(dropBudgieRows)));
    expect(e.length).toBeGreaterThanOrEqual(3);
    expect(e.every((i) => i.message.includes('PARROT') && i.message.includes('대체 밖'))).toBe(true);
    // 종 자리 3개를 종 단위 행(SLOT 이라도 자리는 있음 — usable=false 는 I07)으로 채우면 그 3개 오류는 사라진다
    const withRows = activate(seedWith((ph) => {
      dropBudgieRows(ph);
      for (const use of ['habitat', 'now-lead', 'spec']) {
        ph.push({ ...AI, id: `ph-budgie-${use}`, slot: `budgie-${use}`, scope: { use, animalTypeId: 'budgie' }, asset: `/assets/photos/budgie-${use}.webp`, promptPath: `docs/assets/prompts/budgie-${use}.md` } as Rec);
      }
    }));
    const left = budgieI06(withRows);
    expect(left.some((i) => / (habitat|now-lead|spec):/.test(i.message))).toBe(false);
  });

  // 359 D-1 A: 실시드에 종·프로필 SLOT 행(예: guinea-pig habitat, cp-hamster-dwarf wheel)이 생겼다 — 같은 scope 의 기존 행을 먼저 빼고
  //   시험 행을 넣는다(시험하려는 것은 그 scope 형식이지 실시드와의 중복이 아니다. 중복 자체는 아래 「같은 scope 중복」 시험이 본다).
  const scoped = (scope: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    seedWith((ph) => {
      const key = photoScopeKey(scope);
      for (let i = ph.length - 1; i >= 0; i--) {
        const s = ph[i].scope as Record<string, unknown> | null | undefined;
        if (key !== null && s && photoScopeKey(s) === key) ph.splice(i, 1);
      }
      ph.push({ id: 'ph-x', slot: 'item-x', status: 'SLOT', license: null, source: null, sourceUrl: null, author: null, licenseUrl: null, downloadedAt: null, modified: false, scope, ...extra } as Rec);
    });

  it.each([
    ['정상 종+품목', { use: 'item', animalTypeId: 'guinea-pig', supplyItemId: 'hay' }, 0],
    ['정상 프로필+품목', { use: 'item', careProfileId: 'cp-hamster-dwarf', supplyItemId: 'wheel' }, 0],
    ['정상 품목만', { use: 'item', supplyItemId: 'cage' }, 0],
    ['정상 종 자리', { use: 'habitat', animalTypeId: 'guinea-pig' }, 0],
    ['기니피그+쳇바퀴(요구 없음)', { use: 'item', animalTypeId: 'guinea-pig', supplyItemId: 'wheel' }, 1],
    ['없는 종', { use: 'habitat', animalTypeId: 'cat' }, 1],
    ['없는 품목', { use: 'item', supplyItemId: 'laser' }, 2],
    ['미지 use', { use: 'hero', animalTypeId: 'guinea-pig' }, 1],
    ['미지 키', { use: 'habitat', animalTypeId: 'guinea-pig', x: 1 }, 1],
    ['종 자리에 품목', { use: 'spec', animalTypeId: 'guinea-pig', supplyItemId: 'cage' }, 1],
    ['종 자리에 종·프로필 둘 다', { use: 'spec', animalTypeId: 'guinea-pig', careProfileId: 'cp-guineapig' }, 1],
    ['item 에 품목 없음', { use: 'item', animalTypeId: 'guinea-pig' }, 1],
  ])('I05 %s', (_n, scope, n) => {
    expect(rulesOf(scoped(scope), 'I05').length).toBe(n);
  });

  it('I05: 같은 scope 중복 · 품목 자리 asset 은 /assets/items/', () => {
    const s = seedWith((ph) => {
      for (const id of ['ph-x', 'ph-y']) ph.push({ id, slot: id, status: 'SLOT', license: null, modified: false, scope: { use: 'item', supplyItemId: 'cage' } } as Rec);
    });
    expect(rulesOf(s, 'I05').map((i) => i.message).join()).toMatch(/같은 scope/);
    expect(rulesOf(scoped({ use: 'item', supplyItemId: 'cage' }, { asset: '/assets/photos/cage.webp' }), 'I05').length).toBe(1);
    expect(rulesOf(scoped({ use: 'habitat', animalTypeId: 'guinea-pig' }, { asset: '/assets/items/x.webp' }), 'I05').length).toBe(1);
  });

  // T6(359 H4): 두 그룹(SMALL_MAMMAL·PARROT)이 함께 요구하는 품목의 품목 단위(ITEM, 종·프로필 없음) 행은 다른 그룹 화면에 다른 동물 용품 사진을
  //   붙이게 된다 → I08 ERROR. 한 그룹 전용 품목(perch)은 통과. 실시드는 0.
  it('I08: 두 그룹 공용 품목의 ITEM 단위 행은 ERROR, 한 그룹 전용은 통과, 실시드 0', () => {
    expect(rulesOf(structuredClone(BASE_SEED) as Required<RawSeed>, 'I08')).toEqual([]);
    const water = rulesOf(scoped({ use: 'item', supplyItemId: 'water' }), 'I08');
    expect(water.length).toBe(1);
    expect(water[0].message).toMatch(/SMALL_MAMMAL/);
    expect(water[0].message).toMatch(/PARROT/);
    expect(rulesOf(scoped({ use: 'item', supplyItemId: 'perch' }), 'I08')).toEqual([]);
    expect(rulesOf(scoped({ use: 'item', supplyItemId: 'hay' }), 'I08')).toEqual([]);
    // 프로필·종 단위 행은 그 종에 묶이므로 I08 대상이 아니다.
    expect(rulesOf(scoped({ use: 'item', careProfileId: 'cp-hamster-dwarf', supplyItemId: 'water' }), 'I08')).toEqual([]);
    expect(rulesOf(scoped({ use: 'item', animalTypeId: 'budgie', supplyItemId: 'water' }), 'I08')).toEqual([]);
  });

  it('I07: 사용 가능 AI 행이 자리를 채우면 빈 칸 수가 준다', () => {
    const count = (s: Required<RawSeed>) => {
      const w = validateSeed(s, { now: NOW }).warnings.find((i) => i.rule === 'I07');
      return w ? Number(/빈 사진 칸 (\d+)/.exec(w.message)?.[1]) : 0;
    };
    const before = count(structuredClone(BASE_SEED) as Required<RawSeed>);
    const after = count(seedWith((ph) => ph.push({ ...AI, id: 'ph-gp-hay', slot: 'item-hay', scope: { use: 'item', supplyItemId: 'hay' }, asset: '/assets/items/hay.webp', promptPath: 'docs/assets/prompts/hay.md' } as Rec)));
    // hay 요구 프로필은 기니피그·저빌 — 356(6종 활성화)으로 저빌도 ACTIVE 가 되어 자리 전수(ACTIVE 종만)에서 두 자리가 찬다.
    expect((BASE_SEED.animalTypes as Rec[]).filter((r) => ['guinea-pig', 'gerbil-mongolian'].includes(String(r.id))).map((r) => r.status)).toEqual(['ACTIVE', 'ACTIVE']);
    expect(before - after).toBe(2);
  });
});
