// L4 내 케이지 서브카드 판정(스펙33 §4 CompatSubcard · G-2 · K-4 가정 문구).
//   엔진 @ws/engine 의 requirementCompat(최소 규격 기준값 × 내 케이지)만 — 별도 판정 로직 0(불변식 ⑥).
//   카탈로그는 이 사이트 정적 파일(speccheck/engine loadEngine — 동일 출처 정확 경로). 실패하면 서브카드 없음.
//   표시용: 결과로 노출·정렬을 바꾸지 않는다(불변식 ③).
import { useEffect, useState } from 'react';
import type { CompatVerdict, Engine, Reason, UserContext } from '@ws/engine';
import { CAGE_ITEM_ID } from '../context/cageStore';
import { loadEngine } from '../speccheck/engine';

export type CageCompat =
  | { state: 'none' }
  /** 케이지 없음 + 이 용품에 케이지 호환 규칙이 있음 → 등록 안내(→ L5). */
  | { state: 'register' }
  | { state: 'result'; verdict: Exclude<CompatVerdict, 'NONE'>; reasons: Reason[] };

/** 테스트 주입용. */
export const compatDeps = {
  load: (catalogUrl: string): Promise<Engine> => loadEngine(catalogUrl),
};

/** 순수 판정(엔진 주어짐). 엔진 조회 오류는 none. */
export function cageCompatOf(engine: Engine, typeId: string, itemId: string, ctx: UserContext | undefined): CageCompat {
  if (itemId === CAGE_ITEM_ID) return { state: 'none' };
  try {
    if (ctx) {
      const c = engine.requirementCompat(typeId, itemId, ctx);
      return c.verdict === 'NONE' ? { state: 'none' } : { state: 'result', verdict: c.verdict, reasons: c.reasons };
    }
    // 케이지 없음: 빈 케이지로 규칙 적용 여부만 본다(값 없음 → 규칙이 있으면 확인 대상, 없으면 NONE).
    const probe = engine.specCheck(typeId, itemId, {}, { ownedItems: { [CAGE_ITEM_ID]: {} } });
    return probe.compat.checkedRuleIds.length > 0 ? { state: 'register' } : { state: 'none' };
  } catch {
    return { state: 'none' };
  }
}

export function useCageCompat(catalogUrl: string, typeId: string, itemId: string, ctx: UserContext | undefined): CageCompat {
  const [engine, setEngine] = useState<Engine | null>(null);
  useEffect(() => {
    if (!catalogUrl || itemId === CAGE_ITEM_ID) return;
    let alive = true;
    compatDeps.load(catalogUrl).then(
      (e) => {
        if (alive) setEngine(e);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [catalogUrl, itemId]);
  if (!engine) return { state: 'none' };
  return cageCompatOf(engine, typeId, itemId, ctx);
}
