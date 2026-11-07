// 체크리스트 △(케이지 호환, 계획 F2-3 · 스펙33 G-2 · K-4 가정): 내 케이지가 있을 때만 엔진 requirementCompat(최소 규격 제품 기준)으로
//   항목별 호환을 구해 deriveChecklist 의 compat 옵션으로 넘긴다. BELOW_MIN·CHECK → △, OK·NONE → 영향 0, 케이지 없음 → 맵 없음.
//   판정은 @ws/engine 한 곳(불변식 ⑥), 결과는 표시만 — 노출·정렬 영향 0(불변식 ③).
import { useEffect, useMemo, useState } from 'react';
import type { CompatVerdict, Engine, PublicRequirement, UserContext } from '@ws/engine';
import { CAGE_ITEM_ID, toUserContext, type CageV1 } from '../context/cageStore';
import { loadSpecCatalog } from '../speccheck/engine';
import type { DeriveOptions } from './derive';

type CompatMap = NonNullable<DeriveOptions['compat']>;

/** 카탈로그 로드 실패 뒤 자동 재요청까지의 대기(1회). */
export const COMPAT_RETRY_MS = 4000;

const TO_STATE: Partial<Record<CompatVerdict, CompatMap[string]>> = { OK: 'OK', CHECK: 'CHECK', BELOW_MIN: 'FAIL' };

/** 요구사항마다 requirementCompat → {itemId: OK|CHECK|FAIL}. 컨텍스트 없음 → {}. NONE·조회 실패·케이지 자신은 생략. */
export function cageCompatMap(
  engine: Pick<Engine, 'requirementCompat'>,
  typeId: string,
  reqs: readonly PublicRequirement[],
  ctx: UserContext | undefined,
): CompatMap {
  const out: CompatMap = {};
  if (!ctx) return out;
  for (const r of reqs) {
    if (r.supplyItemId === CAGE_ITEM_ID) continue;
    let v: CompatVerdict;
    try {
      v = engine.requirementCompat(typeId, r.supplyItemId, ctx).verdict;
    } catch {
      continue; // 공개 카탈로그에 없는 요구사항 — 판정하지 않는다
    }
    const s = TO_STATE[v];
    if (s) out[r.supplyItemId] = s;
  }
  return out;
}

export interface CageCompatState {
  /** 판정 맵. 케이지 없음·미판정 → undefined. */
  compat: CompatMap | undefined;
  /** 케이지는 있는데 판정이 아직 없다(카탈로그 로드 중·실패) — "문제 없음"이 아니다. */
  pending: boolean;
}

/** deriveChecklist 옵션으로(미판정이면 compatPending). */
export function toDeriveOptions(s: CageCompatState): DeriveOptions | undefined {
  if (s.compat) return { compat: s.compat };
  return s.pending ? { compatPending: true } : undefined;
}

/** 케이지가 있을 때만 카탈로그를 불러(동일 출처) 맵을 만든다. 케이지 없음 → 영향 0, 있는데 로드 전·실패 → pending(완료 확정 보류). */
export function useCageCompatState(
  typeId: string,
  reqs: readonly PublicRequirement[],
  catalogUrl: string,
  cage: CageV1 | null,
): CageCompatState {
  const [engine, setEngine] = useState<Engine | null>(null);
  const need = cage !== null;
  useEffect(() => {
    if (!need) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 실패하면 일정 시간 뒤 1회만 자동 재요청(문구 없음) — 새로고침 전까지 pending 으로 굳지 않게.
    const attempt = (retry: boolean): void => {
      loadSpecCatalog(catalogUrl).then(
        (x) => {
          if (live) setEngine(x.engine);
        },
        () => {
          if (live && retry) timer = setTimeout(() => attempt(false), COMPAT_RETRY_MS);
        },
      );
    };
    attempt(true);
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [need, catalogUrl]);
  return useMemo(() => {
    if (!cage) return { compat: undefined, pending: false };
    if (!engine) return { compat: undefined, pending: true };
    return { compat: cageCompatMap(engine, typeId, reqs, toUserContext(cage)), pending: false };
  }, [cage, engine, typeId, reqs]);
}

/** 기존 호출용 — 맵만(미판정 구분이 필요하면 useCageCompatState). */
export function useCageCompat(
  typeId: string,
  reqs: readonly PublicRequirement[],
  catalogUrl: string,
  cage: CageV1 | null,
): CompatMap | undefined {
  return useCageCompatState(typeId, reqs, catalogUrl, cage).compat;
}
