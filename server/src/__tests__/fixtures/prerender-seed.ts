// 프리렌더 테스트 픽스처 — 실시드를 읽어 메모리에서만 승격(디스크의 AI_DRAFT 를 VERIFIED 로 기록하지 않는다, 계획 §10-2).
//   승격 값(제목·병원명·후기 문장)은 테스트 전용 자리표시이며 사육·규격 사실이 아니다.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SeedBundle } from '../../engine/index.js';
import { CONTENT_KEYS, SEED_FILES, type SeedKey } from '../../seed/common.js';
import { readSeedDir } from '../../seed/read.js';
import { factHash, requiredBasis, SIGNATURE_FILE, type SignatureEntry } from '../../seed/signatures.js';

export const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'seed');
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** 디스크 시드 그대로(2026-11-16 확인표 5종 서명 반영 — 4 패킷 107행 VERIFIED·매니페스트 107). */
export const realSeed = (): SeedBundle => readSeedDir(SEED_DIR);

/** scripts/apply-review-signatures.mjs(확인표 결과 → 검수 표기·서명 매니페스트). 드워프 미리보기는 같은 함수로 메모리 서명한다. */
export const applyMjs = (await import(pathToFileURL(join(REPO_ROOT, 'scripts', 'apply-review-signatures.mjs')).href)) as {
  CONTENT_FILES: readonly string[];
  MANAGED_KEYS: readonly string[];
  RESULT_FORMAT: string;
  applySignatures: (
    files: Record<string, unknown[]>,
    manifest: unknown[],
    packet: unknown,
    result: unknown,
    opts: { stage?: 'final' | 'review'; now: string },
  ) => { files: Record<string, unknown[]>; manifest: SignatureEntry[]; summary: Record<string, number | string> };
  main: (argv: string[], io?: { out: (l: string) => void; err: (l: string) => void }) => number;
};
export interface DwarfPacket {
  packet: string;
  rowChecked: Array<{ file: string; id: string; items: string[] }>;
  bulk: { item: string; rows: Array<{ file: string; id: string }> };
}
export const DWARF_PACKET_PATH = join(REPO_ROOT, 'scripts', 'review-packets', 'hamster-dwarf-core.json');
/** 실패킷 파일 그대로(확인표 문서와 1:1). 2026-11-15 K1 반영 뒤 dwarfPacketK1() 과 같다(seed.signatures.test 「K1 사본 = 실패킷」). */
export const dwarfPacket = (): DwarfPacket => JSON.parse(readFileSync(DWARF_PACKET_PATH, 'utf8')) as DwarfPacket;

/**
 * 실서명(2026-11-16, Kenny 확인표_서명용_1116.pdf 전 행 체크·서명 — ORDERS 11/16 16:4x) 대상 패킷 4종과 서명일.
 *   디스크 시드는 이 4 패킷을 apply-review-signatures.mjs(--stage review → final)로 적용한 상태다.
 */
export const REAL_PACKETS = ['hamster-golden-core', 'hamster-dwarf-core', 'gerbil-mongolian-core', 'guinea-pig-core'] as const;
export const REAL_SIGNED_AT = '2026-11-16';
export const realPacketPath = (name: (typeof REAL_PACKETS)[number]): string => join(REPO_ROOT, 'scripts', 'review-packets', `${name}.json`);
export const realPacket = (name: (typeof REAL_PACKETS)[number]): DwarfPacket => JSON.parse(readFileSync(realPacketPath(name), 'utf8')) as DwarfPacket;
/** 미서명 결과(형식은 scripts/review-packets/*.result.unsigned.json 과 같다). */
export const unsignedResultOf = (p: { packet: string }): Record<string, unknown> => ({
  format: applyMjs.RESULT_FORMAT,
  packet: p.packet,
  signedBy: 'kenny',
  checkedAt: null,
  checked: [],
  bulkSignedAt: null,
});

/**
 * 콘텐츠 파일 묶음(파일명 키)을 4 패킷 미서명 결과로 되돌린다(메모리 — applySignatures 그대로, 사실 0 변경은 그 함수가 자기 검사).
 *   = 서명 전 시드(대상 107행 DRAFT·AI_DRAFT·verifiedBy/At·reviewBasis null, 상품 specVerifiedBy/At null·status REVIEW|SLOT).
 */
export function unsignFiles(files: Record<string, unknown[]>): Record<string, unknown[]> {
  let cur = files;
  for (const n of REAL_PACKETS) {
    const p = realPacket(n);
    cur = applyMjs.applySignatures(cur, [], p, unsignedResultOf(p), { now: REAL_SIGNED_AT }).files;
  }
  return cur;
}

/**
 * 4 실패킷이 서명 대상으로 정한 행 → { basis, reviewerType } (기대값 계산용 — 패킷 파일만 읽는다, 시드는 보지 않는다).
 *   rowChecked = ROW_CHECKED·행 reviewerType(없으면 패킷), bulk = AI_RESEARCH_BULK·패킷 reviewerType. 키 "file#id".
 */
export function realSignedTargets(): Map<string, { basis: 'ROW_CHECKED' | 'AI_RESEARCH_BULK'; reviewerType: string }> {
  const out = new Map<string, { basis: 'ROW_CHECKED' | 'AI_RESEARCH_BULK'; reviewerType: string }>();
  for (const n of REAL_PACKETS) {
    const p = realPacket(n) as DwarfPacket & { reviewerType: string; rowChecked: Array<{ file: string; id: string; reviewerType?: string }> };
    for (const r of p.rowChecked) out.set(`${r.file}#${r.id}`, { basis: 'ROW_CHECKED', reviewerType: r.reviewerType ?? p.reviewerType });
    for (const r of p.bulk.rows) out.set(`${r.file}#${r.id}`, { basis: 'AI_RESEARCH_BULK', reviewerType: p.reviewerType });
  }
  return out;
}

/**
 * 서명 전 기준 실시드(메모리): 디스크 시드에서 4 패킷 서명만 되돌린 사본 — 매니페스트 [].
 *   메모리 승격 픽스처(promoted·dwarfSigned·dwarfPreview·promotedTwo)와 규칙 주입 시험의 바탕. 디스크는 바꾸지 않는다.
 *   디스크 상태(서명 후)를 보는 시험은 realSeed() 를 쓴다.
 */
export function unsignedRealSeed(): SeedBundle {
  const s = clone(realSeed());
  const files = unsignFiles(filesOf(s));
  for (const k of CONTENT_KEYS) (s as unknown as Record<string, unknown[]>)[k] = files[SEED_FILES[k]];
  return s;
}

/** RawSeed(키 = CONTENT_KEYS 등) 사본을 서명 전 기준으로(readSeedDirRaw 결과를 쓰는 시험용). 입력은 바꾸지 않는다. */
export function unsignRaw<T extends object>(raw: T): T {
  const s = clone(raw) as unknown as Record<string, unknown[]>;
  const files = unsignFiles(Object.fromEntries(CONTENT_KEYS.map((k) => [SEED_FILES[k], s[k] ?? []])));
  for (const k of CONTENT_KEYS) s[k] = files[SEED_FILES[k]];
  return s as unknown as T;
}

/**
 * 서명 전 기준 시드 디렉터리(CLI·dist 시험용): 디스크 시드(src, 기본 server/seed — seed-draft 사본도 가능) 전 파일 복사 → 콘텐츠 8파일을 unsignFiles 결과로, 매니페스트 '[]'.
 *   JSON 2칸 들여쓰기·끝 개행 없음(apply 스크립트 형식). dir 은 호출자가 만든 임시 디렉터리.
 */
export function writeUnsignedSeedDir(dir: string, src: string = SEED_DIR): string {
  mkdirSync(dir, { recursive: true });
  cpSync(src, dir, { recursive: true });
  const files: Record<string, unknown[]> = {};
  for (const k of CONTENT_KEYS) files[SEED_FILES[k]] = JSON.parse(readFileSync(join(src, SEED_FILES[k]), 'utf8')) as unknown[];
  const out = unsignFiles(files);
  for (const [f, rows] of Object.entries(out)) writeFileSync(join(dir, f), JSON.stringify(rows, null, 2));
  writeFileSync(join(dir, SIGNATURE_FILE), '[]');
  return dir;
}

/** 행별 확인 항목 이름 — 원문 발췌가 아닌 whyShort 행 1개당 1항목. 실패킷·확인표 W 절도 같은 이름(WS-<행 id>)을 쓴다. */
export const k1ItemOf = (id: string): string => `WS-${id}`;

/**
 * K1 하위 결정(2026-11-15) 반영 패킷 사본(메모리, 테스트 전용 — 실패킷 파일은 바꾸지 않는다).
 *   bulk(C 일괄) 행 중 requiredBasis(signatures.ts — 규칙 그대로)가 ROW_CHECKED 인 행(= 원문 발췌가 아닌 whyShort 행)을
 *   rowChecked 로 옮기고 행별 확인 항목 k1ItemOf(id) 를 붙인다. 일괄 서명으로 재서술 whyShort 를 VERIFIED 로 만들지 않는다(불변식 7).
 *   실시드에 그런 행이 없으면 입력과 같은 패킷. 실패킷 4종은 2026-11-15 이 규칙대로 갱신됐다(k1Packet(실패킷) = 실패킷 —
 *   seed.signatures.test 「K1 실패킷 ↔ 확인표 W 절」). 남은 용도: 시드·패킷이 다시 어긋났을 때의 사본 생성.
 */
export function k1Packet<P extends DwarfPacket>(packet: P, seed: SeedBundle = realSeed()): P {
  const keyOf = new Map<string, SeedKey>(CONTENT_KEYS.map((k) => [SEED_FILES[k], k]));
  const needsRow = (r: { file: string; id: string }): boolean => {
    const key = keyOf.get(r.file);
    const row = key ? (seed[key as keyof SeedBundle] as unknown as Row[]).find((x) => x.id === r.id) : undefined;
    return key !== undefined && row !== undefined && requiredBasis(key, row) === 'ROW_CHECKED';
  };
  const moved = packet.bulk.rows.filter(needsRow);
  return {
    ...packet,
    rowChecked: [...packet.rowChecked, ...moved.map((r) => ({ file: r.file, id: r.id, items: [k1ItemOf(r.id)] }))],
    bulk: { ...packet.bulk, rows: packet.bulk.rows.filter((r) => !needsRow(r)) },
  };
}
/** 드워프 실패킷의 K1 사본(가짜 전 ☑ 서명용). */
export const dwarfPacketK1 = (): DwarfPacket => k1Packet(dwarfPacket());

/** 시드 사본에서 whyShort 키(요구사항 행·AnimalType override)를 전부 뺀다(메모리 — whyShort 0건 상태 재현용). */
export function withoutWhyShort(seed: SeedBundle): SeedBundle {
  const s = clone(seed);
  for (const r of s.supplyRequirements as unknown as Row[]) delete r.whyShort;
  for (const a of s.animalTypes as unknown as Row[]) {
    const reqs = (a.careOverrides as Row | null | undefined)?.requirements as Record<string, Row | null> | undefined;
    if (reqs) for (const o of Object.values(reqs)) if (o && typeof o === 'object') delete o.whyShort;
  }
  return s;
}

const FIXTURE_SOURCE = [{ url: 'https://example.org/fixture-source', title: 'fixture source', accessedAt: '2026-09-30' }];

/** 메모리 승격 표기. reviewBasis ROW_CHECKED(보안 79 H-1 V09·V10 — 상품·최소 규격 행도 통과). 서명 매니페스트는 signAll()·writeSeedDir 가 만든다. */
export const V = { reviewStatus: 'VERIFIED', reviewerType: 'EXPERIENCED_KEEPER', verifiedBy: 'keeper-hidden-name', verifiedAt: '2026-09-30', reviewBasis: 'ROW_CHECKED' } as const;

/**
 * 노출 기준일(asOf) — 승격 픽스처를 쓰는 모든 테스트는 이 고정값을 프리렌더 --now·buildSite asOf·computeExposure 에 넣는다.
 *   실시계(io.today·localToday)와 결합 금지(F14 시한폭탄: V.verifiedAt + 180일 = 2027-03-29 이후 강등).
 */
export const FIXTURE_AS_OF = '2026-11-22'; // 팁 references checkedAt(2026-11-22) 이상 · 실서명일(REAL_SIGNED_AT, 2026-11-16) 이상 — 디스크 verifiedAt 이 S07 미래 날짜가 되지 않게(옛 값 2026-11-03 = 출처 접근일 최댓값 2026-11-02 이상, 277). V.verifiedAt + 180 = 2027-03-29 전이라 강등 경계 의미 불변.
/** V.verifiedAt + 180일(마지막 노출일) / + 181일(강등 첫날). */
export const FIXTURE_LAST_FRESH = '2027-03-29';
export const FIXTURE_FIRST_STALE = '2027-03-30';

export type Row = Record<string, unknown>;
export function patch(seed: SeedBundle, key: keyof SeedBundle, id: string, p: Row): void {
  const row = (seed[key] as unknown as Row[]).find((r) => r.id === id);
  if (!row) throw new Error(`fixture: ${key}#${id} 없음`);
  Object.assign(row, p);
}

/**
 * LEGAL 승격 값 — Taxon 은 contentKind LEGAL 이라 validate V03 이 OFFICIAL_SOURCE 정확 등급을 요구한다.
 *   검수 표기만 바꾼다(legal 사실값·학명은 디스크 시드 그대로).
 */
export const V_LEGAL = { ...V, reviewerType: 'OFFICIAL_SOURCE' } as const;
export const GOLDEN_TAXON_ID = 'mesocricetus-auratus';

/**
 * golden 체인 승격(메모리): type·profile·cage/wheel 요구사항·항목·cp-001·번들 1·병원 1·CC_BY 사진 1·후기 1.
 *   Taxon 은 디스크 상태(DRAFT) 그대로 — 타입 노출은 Taxon 을 보지 않는다(Kenny 2026-10-24 K-4 되돌림).
 *   taxonVerified: 골든 Taxon 도 승격(Taxon 참조 공개 경로 검사용).
 */
export function promoted(opts: { typeDraft?: boolean; taxonVerified?: boolean; publishable?: boolean; base?: SeedBundle } = {}): SeedBundle {
  const s = clone(opts.base ?? unsignedRealSeed());
  if (opts.taxonVerified) patch(s, 'taxa', GOLDEN_TAXON_ID, { ...V_LEGAL });
  patch(s, 'animalTypes', 'hamster-golden', opts.typeDraft ? {} : { ...V });
  patch(s, 'careProfiles', 'cp-hamster-syrian', { ...V });
  for (const id of PROMOTED_GOLDEN_REQUIREMENTS) patch(s, 'supplyRequirements', id, { ...V });
  for (const id of ['cage', 'wheel']) {
    patch(s, 'supplyItems', id, { ...V });
    labelEnums(s, id);
  }
  patch(s, 'curatedProducts', 'cp-001', {
    ...V,
    status: 'ACTIVE',
    meetsMinSpec: true,
    title: '픽스처 쳇바퀴 A',
    specVerifiedBy: 'keeper-hidden-name',
    specVerifiedAt: '2026-09-30',
    source: FIXTURE_SOURCE,
  });
  patch(s, 'setupBundles', 'sb-syrian-budget', { ...V, itemIds: ['cage', 'wheel'], source: FIXTURE_SOURCE });
  patch(s, 'vetClinics', 'vc-mapo-01', {
    name: '픽스처 동물병원',
    address: '서울 마포구 픽스처로 1',
    phone: '02-000-0000',
    verification: { status: 'VERIFIED', method: 'PHONE_CALL', verifiedAt: '2026-09-28', note: 'hidden-ops-note' },
  });
  patch(s, 'photos', 'ph-01', {
    source: 'WIKIMEDIA',
    license: 'CC_BY',
    author: 'Fixture Author',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    downloadedAt: '2026-09-27',
    status: 'READY',
  });
  patch(s, 'testimonials', 't-001', { status: 'APPROVED', verifiedUsage: true, quote: '픽스처 후기 문장이에요', consentAt: '2026-09-26' });
  demoteUnpromotedRequired(s, 'cp-hamster-syrian', PROMOTED_GOLDEN_REQUIREMENTS);
  if (opts.publishable) completeGoldenMandatory(s);
  return s;
}

/**
 * 보안 79 M-1: validate X01 은 CareProfile 별 코드 고정 필수 항목(cage·food·water·bedding·hideout·wheel)이 전부
 *   REQUIRED·노출 가능해야 통과한다. promoted() 기본형(cage·wheel 만 노출)은 엔진·투영 테스트용 부분 체인이라
 *   seed:validate·프리렌더 CLI 를 통과하지 못한다 — CLI·validate 경로 테스트는 promoted({ publishable: true }) 를 쓴다.
 *   남은 필수 4항목(bedding·water·hideout·food)의 요구사항·SupplyItem 을 메모리에서 승격하고 priority 를 REQUIRED 로 둔다.
 *   FOOD 요구사항은 MIN_GRADE(VET_PUBLISHED_SOURCE·서로 다른 도메인 2·국내 1, V03·V04·V08)를 자리표시 출처로 채운다
 *   — 사육 사실값은 디스크 그대로, 출처·검수 표기만 테스트 전용 자리표시.
 */
export const GOLDEN_MANDATORY_REST = ['bedding', 'water', 'hideout', 'food'] as const;
const FIXTURE_FOOD_SOURCE = [
  { url: 'https://example.org/fixture-food-source', title: 'fixture food source', accessedAt: '2026-09-30' },
  { url: 'https://fixture.example.kr/food-source', title: 'fixture domestic food source', accessedAt: '2026-09-30' },
];
export function completeGoldenMandatory(s: SeedBundle): void {
  for (const itemId of GOLDEN_MANDATORY_REST) {
    const req = s.supplyRequirements.find((r) => r.careProfileId === 'cp-hamster-syrian' && r.supplyItemId === itemId);
    if (!req) throw new Error(`fixture: cp-hamster-syrian 요구사항 ${itemId} 없음`);
    Object.assign(req, { ...V, priority: 'REQUIRED' });
    if (req.contentKind === 'FOOD' || req.contentKind === 'HEALTH') {
      Object.assign(req, { reviewerType: 'VET_PUBLISHED_SOURCE', source: clone(FIXTURE_FOOD_SOURCE) });
    }
    patch(s, 'supplyItems', itemId, { ...V });
    const item = s.supplyItems.find((x) => x.id === itemId);
    if (item?.specSchema.fields.some((f) => f.type === 'enum' && !f.optionLabels)) labelEnums(s, itemId);
  }
}

/** promoted() 가 승격하는 골든 요구사항(cage·wheel). */
export const PROMOTED_GOLDEN_REQUIREMENTS = ['req-syrian-cage', 'req-syrian-wheel'] as const;

/**
 * validate X01(K-B4): 노출 타입의 REQUIRED 요구사항은 전부 노출 가능해야 한다. 픽스처는 체인 일부(cage·wheel)만 승격하므로
 *   그 밖의 같은 프로필 REQUIRED 행을 메모리에서 RECOMMENDED 로 낮춰 "필수 항목이 빠진 공개" 상태를 만들지 않는다.
 *   낮춘 행은 미검수(DRAFT)라 어떤 산출물에도 나가지 않는다 — 화면·ws-data 불변. 디스크 시드는 바꾸지 않는다.
 */
export function demoteUnpromotedRequired(seed: SeedBundle, careProfileId: string, keep: readonly string[]): void {
  for (const r of seed.supplyRequirements) {
    if (r.careProfileId === careProfileId && r.priority === 'REQUIRED' && !keep.includes(r.id)) r.priority = 'RECOMMENDED';
  }
}

/**
 * R7-B B7 드워프 미리보기 — 가짜 확인표 서명일(DWARF_SIGNED_AT = 메모리 verifiedAt)과 기준일(DWARF_PREVIEW_AS_OF).
 *   기준일은 실시드 출처 접근일 최댓값(Taxon 법 칸 출처 2026-11-02, 277) 이상이어야 S07(미래 날짜)이 나지 않는다.
 *   실시계 결합 금지(F14): 2026-10-24 + 180일 = 2027-04-22 까지 노출, 그 뒤 강등.
 */
export const DWARF_SIGNED_AT = '2026-10-24';
export const DWARF_PREVIEW_AS_OF = '2026-11-22'; // 팁 checkedAt(2026-11-22) 이상 · 실서명일 이상(옛 값 2026-11-03). DWARF_SIGNED_AT + 180 = 2027-04-22 전이라 노출 유지.

/**
 * 드워프 패킷 전 항목 ☑(A·B·D + K1 행별 확인) + C 서명(가짜 확인표 결과 — 테스트 전용, 날짜 기본 DWARF_SIGNED_AT).
 *   packet 기본 = dwarfPacketK1()(재서술 whyShort 행은 ROW_CHECKED). 실패킷 그대로 쓰려면 dwarfPacket() 을 넘긴다.
 */
export function dwarfAllCheckedResult(signedAt: string = DWARF_SIGNED_AT, p: DwarfPacket = dwarfPacketK1()): Record<string, unknown> {
  return {
    format: applyMjs.RESULT_FORMAT,
    packet: p.packet,
    signedBy: 'kenny',
    checkedAt: signedAt,
    checked: [...new Set(p.rowChecked.flatMap((r) => r.items))],
    bulkSignedAt: signedAt,
  };
}

/** SeedBundle → 파일명 키 콘텐츠 묶음(apply 스크립트 입력 형식). */
export function filesOf(seed: SeedBundle): Record<string, unknown[]> {
  return Object.fromEntries(CONTENT_KEYS.map((k) => [SEED_FILES[k], seed[k as keyof SeedBundle] as unknown[]]));
}

/**
 * 서명 전 기준 실시드(unsignedRealSeed) + 드워프 확인표 결과를 메모리에서 적용(applySignatures 그대로 — 디스크는 바꾸지 않는다).
 *   result 생략 = 전 항목 ☑·C 서명(가짜). packet 생략 = dwarfPacketK1()(K1: 재서술 whyShort 행은 행별 확인). 반환 seed·매니페스트.
 */
export function dwarfSignedWith(
  result: Record<string, unknown> = dwarfAllCheckedResult(),
  packet: DwarfPacket = dwarfPacketK1(),
): { seed: SeedBundle; manifest: SignatureEntry[] } {
  const s = unsignedRealSeed();
  const res = applyMjs.applySignatures(filesOf(s), [], packet, result, { now: DWARF_PREVIEW_AS_OF });
  for (const k of CONTENT_KEYS) (s as unknown as Record<string, unknown[]>)[k] = res.files[SEED_FILES[k]];
  return { seed: s, manifest: res.manifest };
}

/** 드워프 패킷 52행이 서명된 상태(메모리, 가짜 확인표 결과 — 서명 전 기준 unsignedRealSeed() 위). 디스크는 2026-11-16 실서명 상태. */
export function dwarfSigned(): SeedBundle {
  return dwarfSignedWith().seed;
}

/**
 * 드워프 미리보기(메모리 전용, 게이트 G 전 화면·감사 검증용): dwarfSigned()(메모리 서명) + hamster-dwarf status 만 ACTIVE.
 *   사실값·상품·번들은 디스크 시드 그대로. 디스크의 DRAFT·PLANNED 는 바꾸지 않는다.
 */
export function dwarfPreview(): SeedBundle {
  const s = dwarfSigned();
  const at = s.animalTypes.find((x) => x.id === 'hamster-dwarf');
  if (!at || at.status !== 'PLANNED') throw new Error('fixture: 디스크 hamster-dwarf 는 PLANNED 여야 한다(게이트 G 전)');
  at.status = 'ACTIVE';
  return s;
}

/** promotedTwo() 의 합성 두 번째 타입 식별자(다동물 감사 54 M1). 실제 시드 행(hamster-dwarf 등)이 아니다. */
export const SECOND = {
  typeId: 'fixture-second',
  slug: 'hamster/fixture',
  careProfileId: 'cp-fixture-second',
  requirementIds: ['req-fixture-cage', 'req-fixture-wheel'],
  productId: 'cp-fixture-2',
  bundleId: 'sb-fixture-second',
} as const;

/**
 * 2타입 픽스처(메모리, 감사 54 M1): promoted()(골든) + 합성 두 번째 타입.
 *   두 번째 타입은 골든 행을 복제해 id·slug·표시명만 바꾼 자리표시다 — 드워프 등 실제 종의 사실값을 만들지 않고,
 *   실제 PLANNED 행(hamster-dwarf)을 승격하지도 않는다. 요구사항 2행(cage·wheel)은 골든 행을 id·careProfileId 만 바꿔 복제.
 *   상품 cp-fixture-2(B 프로필 전용)·번들 sb-fixture-second(B 프로필) 추가. 골든 쪽은 promoted() 그대로.
 */
export function promotedTwo(opts: { base?: SeedBundle } = {}): SeedBundle {
  const s = promoted({ base: opts.base });
  const golden = s.animalTypes.find((x) => x.id === 'hamster-golden');
  const profile = s.careProfiles.find((x) => x.id === 'cp-hamster-syrian');
  if (!golden || !profile) throw new Error('fixture: 골든 체인 없음');
  s.animalTypes.push({
    ...clone(golden),
    id: SECOND.typeId,
    slug: SECOND.slug,
    displayName: '픽스처 두번째',
    aliases: ['픽스처 별칭'],
    careProfileId: SECOND.careProfileId,
    careOverrides: {},
    mascot: null,
    oneLiner: null,
    seoTitle: null,
    seoDescription: null,
    ...V,
  });
  s.careProfiles.push({ ...clone(profile), id: SECOND.careProfileId, name: '픽스처 두번째 프로필', ...V });
  const reqSrc: Record<string, string> = { 'req-fixture-cage': 'req-syrian-cage', 'req-fixture-wheel': 'req-syrian-wheel' };
  for (const id of SECOND.requirementIds) {
    const src = s.supplyRequirements.find((x) => x.id === reqSrc[id]);
    if (!src) throw new Error(`fixture: supplyRequirements#${reqSrc[id]} 없음`);
    s.supplyRequirements.push({ ...clone(src), id, careProfileId: SECOND.careProfileId, ...V });
  }
  const prod = s.curatedProducts.find((x) => x.id === 'cp-001');
  const bundle = s.setupBundles.find((x) => x.id === 'sb-syrian-budget');
  if (!prod || !bundle) throw new Error('fixture: cp-001·sb-syrian-budget 없음');
  s.curatedProducts.push({ ...clone(prod), id: SECOND.productId, title: '픽스처 쳇바퀴 B', careProfileIds: [SECOND.careProfileId] });
  s.setupBundles.push({ ...clone(bundle), id: SECOND.bundleId, name: '픽스처 세트 B', careProfileId: SECOND.careProfileId });
  return s;
}


/**
 * enum 표시 라벨(메모리, W-OPTLABEL 게이트 통과용) — 자리표시 "픽스처 라벨 N". 표기일 뿐 규격 사실이 아니다.
 */
export function labelEnums(seed: SeedBundle, itemId: string): void {
  const item = seed.supplyItems.find((x) => x.id === itemId);
  if (!item) throw new Error(`fixture: supplyItems#${itemId} 없음`);
  for (const f of item.specSchema.fields) {
    if (f.type === 'enum') f.optionLabels = Object.fromEntries(f.options.map((o, i) => [o, `픽스처 라벨 ${i + 1}`]));
  }
}

/**
 * 메모리 서명 매니페스트(테스트 전용): VERIFIED 행마다 행의 reviewBasis·verifiedBy·verifiedAt 그대로 서명 항목.
 *   디스크 server/seed/review-signatures.json 은 Kenny 확인표 결과로만 scripts/apply-review-signatures.mjs 가 쓴다.
 */
export function signAll(seed: SeedBundle): SignatureEntry[] {
  const out: SignatureEntry[] = [];
  for (const key of CONTENT_KEYS) {
    for (const r of seed[key as keyof SeedBundle] as unknown as Row[]) {
      if (r.reviewStatus !== 'VERIFIED') continue;
      out.push({
        file: SEED_FILES[key],
        id: r.id as string,
        basis: r.reviewBasis as SignatureEntry['basis'],
        signedBy: r.verifiedBy as string,
        signedAt: r.verifiedAt as string,
        factHash: factHash(SEED_FILES[key], r),
      });
    }
  }
  return out;
}

/**
 * 시드 묶음을 디렉터리에 JSON 으로 쓴다(CLI·spa 테스트용 임시 시드).
 *   서명 매니페스트도 쓴다: 기본 signAll(seed)(메모리 승격 행 전부), 배열 지정 가능, null = 파일 안 씀(G01 검사용).
 */
export function writeSeedDir(dir: string, seed: SeedBundle, signatures: SignatureEntry[] | null = signAll(seed)): void {
  mkdirSync(dir, { recursive: true });
  for (const [key, file] of Object.entries(SEED_FILES)) {
    writeFileSync(join(dir, file), `${JSON.stringify(seed[key as keyof SeedBundle], null, 2)}
`);
  }
  if (signatures) writeFileSync(join(dir, SIGNATURE_FILE), JSON.stringify(signatures, null, 2));
}
