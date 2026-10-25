// 검증 컨텍스트 — 파일별 행·id 인덱스·용품 규격 스키마 맵. 순수.
import {
  asRec,
  isNonEmptyStr,
  SEED_KEYS,
  type Collector,
  type RawSeed,
  type Rec,
  type Row,
  type SeedKey,
} from './common.js';
import type { SignatureInput } from './signatures.js';

export interface ValidateOptions {
  /** 기준일 YYYY-MM-DD(미래 날짜·W-STALE 판정). 순수성을 위해 호출자가 넣는다. */
  now: string;
  /** R6 게이트: W-EXPOSURE-ZERO 를 ERROR 로. */
  strict?: boolean;
  /**
   * 서명 매니페스트(G01~G06, 보안 79 H-1). CLI(validate·load·prerender)는 readSeedDirRaw().signatures 를 항상 넘긴다.
   *   생략 = G 규칙 건너뜀 — 메모리 픽스처 단위 테스트 전용. 행 수준 V09·V10(reviewBasis)은 생략과 무관하게 검사한다.
   */
  signatures?: SignatureInput;
}

export interface Ctx {
  out: Collector;
  now: string;
  strict: boolean;
  present: Record<SeedKey, boolean>;
  rows: Record<SeedKey, Row[]>;
  /** 파일별 id → 첫 레코드. */
  byId: Record<SeedKey, Map<string, Rec>>;
  /** supplyItemId → (field key → field 레코드). S05 를 통과한 필드만. */
  schemas: Map<string, Map<string, Rec>>;
  /** `${careProfileId}|${supplyItemId}` 요구사항 존재. */
  reqPairs: Set<string>;
}

export function buildCtx(raw: RawSeed, opts: ValidateOptions, out: Collector): Ctx {
  const present = {} as Record<SeedKey, boolean>;
  const rows = {} as Record<SeedKey, Row[]>;
  const byId = {} as Record<SeedKey, Map<string, Rec>>;
  for (const key of SEED_KEYS) {
    const arr = raw[key];
    present[key] = Array.isArray(arr);
    rows[key] = [];
    byId[key] = new Map();
    if (!Array.isArray(arr)) continue;
    arr.forEach((v, index) => {
      const rec = asRec(v);
      if (!rec) {
        out.error('S01', key, `[${index}]`, '', '배열 원소가 객체가 아니다');
        return;
      }
      const id = isNonEmptyStr(rec.id) ? rec.id : `[${index}]`;
      rows[key].push({ rec, id, index });
      if (isNonEmptyStr(rec.id) && !byId[key].has(rec.id)) byId[key].set(rec.id, rec);
    });
  }
  const reqPairs = new Set<string>();
  for (const { rec } of rows.supplyRequirements) {
    if (isNonEmptyStr(rec.careProfileId) && isNonEmptyStr(rec.supplyItemId)) {
      reqPairs.add(`${rec.careProfileId}|${rec.supplyItemId}`);
    }
  }
  return {
    out,
    now: opts.now,
    strict: opts.strict === true,
    present,
    rows,
    byId,
    schemas: new Map(),
    reqPairs,
  };
}
