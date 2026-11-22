// seed:validate 공용 — 파일 목록·이슈 수집기·JSON 값 헬퍼.
//   순수 모듈(fs·Date.now·process 없음). read.ts 만 fs 를 쓴다.
import type { SeedBundle } from '../engine/types.js';

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
} as const;

export type SeedKey = keyof typeof SEED_FILES;
export const SEED_KEYS = Object.keys(SEED_FILES) as SeedKey[];

/** 부록 B 공통 필드를 갖는 9개 콘텐츠 파일(A-18: 후기·병원·사진은 자체 규칙). budgetTips 는 기록용 메타(노출은 REFERENCE 별도 경로). */
export const CONTENT_KEYS: readonly SeedKey[] = [
  'animalTypes',
  'taxa',
  'careProfiles',
  'supplyItems',
  'supplyRequirements',
  'compatibilityRules',
  'setupBundles',
  'curatedProducts',
  'budgetTips',
];

/** 파일별 JSON 배열(읽기 실패·누락 = undefined). */
export type RawSeed = { [K in SeedKey]?: unknown[] };

export type Severity = 'ERROR' | 'WARN';

export interface Issue {
  severity: Severity;
  rule: string;
  file: string;
  id: string | null;
  path: string;
  message: string;
}

export class Collector {
  readonly issues: Issue[] = [];

  add(severity: Severity, rule: string, key: SeedKey | null, id: string | null, path: string, message: string): void {
    this.issues.push({ severity, rule, file: key ? SEED_FILES[key] : '-', id, path, message });
  }

  error(rule: string, key: SeedKey | null, id: string | null, path: string, message: string): void {
    this.add('ERROR', rule, key, id, path, message);
  }

  warn(rule: string, key: SeedKey | null, id: string | null, path: string, message: string): void {
    this.add('WARN', rule, key, id, path, message);
  }
}

export function formatIssue(i: Issue): string {
  const where = i.id === null ? i.file : `${i.file}#${i.id}`;
  return `${i.severity} [${i.rule}] ${where} ${i.path || '-'}: ${i.message}`;
}

// ── JSON 값 헬퍼 ─────────────────────────────────────────────
export type Rec = Record<string, unknown>;

export function asRec(v: unknown): Rec | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null;
}

export function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

export function isNonEmptyStr(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function has(r: Rec, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(r, k);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD 이고 달력상 존재하는 날짜. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** 두 YYYY-MM-DD 사이 일수(b - a). */
export function daysBetween(a: string, b: string): number {
  const p = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86_400_000);
}

export function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(v);
}

/** URL 호스트명(소문자, www. 제거). URL 파싱 실패 시 null. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface Row {
  rec: Rec;
  /** 유효한 id 가 없으면 `[index]`. */
  id: string;
  index: number;
}

/** SLOT(빈 자리) 행 — 로더가 건너뛰고 대부분 규칙에서 면제. */
export function isSlotRow(key: SeedKey, r: Rec): boolean {
  if (key === 'vetClinics') return asRec(r.verification)?.status === 'SLOT';
  if (key === 'curatedProducts' || key === 'testimonials' || key === 'photos') return r.status === 'SLOT';
  return false;
}

/**
 * 검증을 통과한 RawSeed 를 엔진 타입으로 본다. 호출 전에 validateSeed 의 errors 가 0 이어야 한다
 * (형태 보장은 validate-structure/refs 가 한다 — 여기선 캐스트만).
 */
export function asSeedBundle(raw: RawSeed): SeedBundle {
  const pick = <T>(v: unknown[] | undefined): T[] => (v ?? []) as T[];
  return {
    animalTypes: pick(raw.animalTypes),
    taxa: pick(raw.taxa),
    careProfiles: pick(raw.careProfiles),
    supplyItems: pick(raw.supplyItems),
    supplyRequirements: pick(raw.supplyRequirements),
    compatibilityRules: pick(raw.compatibilityRules),
    setupBundles: pick(raw.setupBundles),
    curatedProducts: pick(raw.curatedProducts),
    testimonials: pick(raw.testimonials),
    vetClinics: pick(raw.vetClinics),
    photos: pick(raw.photos),
    budgetTips: pick(raw.budgetTips),
  };
}
