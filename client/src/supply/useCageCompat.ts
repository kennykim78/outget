// L4 내 케이지 서브카드 판정(스펙33 §4 CompatSubcard · G-2 · K-4 가정 문구).
//   엔진 @ws/engine 의 requirementCompat(최소 규격 기준값 × 내 케이지)만 — 별도 판정 로직 0(불변식 ⑥).
//   카탈로그는 이 사이트 정적 파일(speccheck/engine loadEngine — 동일 출처 정확 경로). 실패하면 서브카드 없음.
//   표시용: 결과로 노출·정렬을 바꾸지 않는다(불변식 ③).
import { useEffect, useState } from 'react';
import type { CompatVerdict, Engine, Reason, SpecValues, UserContext } from '@ws/engine';
import { CAGE_ITEM_ID } from '../context/cageStore';
import { loadEngine } from '../speccheck/engine';

export type CageCompat =
  | { state: 'none' }
  /** 케이지 없음 + 이 용품에 케이지 호환 규칙이 있음 → 등록 안내(→ L5). */
  | { state: 'register' }
  /** usedRecommended: 엔진 requirementCompat 이 권장 규격으로 빈 값을 채웠다고 알릴 때만 true(그대로 전달, 판정 0). */
  | { state: 'result'; verdict: Exclude<CompatVerdict, 'NONE'>; reasons: Reason[]; usedRecommended?: true };

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
      if (c.verdict === 'NONE') return { state: 'none' };
      return c.usedRecommended === true
        ? { state: 'result', verdict: c.verdict, reasons: c.reasons, usedRecommended: true }
        : { state: 'result', verdict: c.verdict, reasons: c.reasons };
    }
    // 케이지 없음: 빈 케이지로 규칙 적용 여부만 본다(값 없음 → 규칙이 있으면 확인 대상, 없으면 NONE).
    const probe = engine.specCheck(typeId, itemId, {}, { ownedItems: { [CAGE_ITEM_ID]: {} } });
    return probe.compat.checkedRuleIds.length > 0 ? { state: 'register' } : { state: 'none' };
  } catch {
    return { state: 'none' };
  }
}

/**
 * L7 상품 상세(작업 183·185, 계획 155 O-1): 상품의 실제 규격값 × 내 케이지 — 엔진 productCageCompat 그대로(별도 판정 0, 불변식 ⑥).
 *   requirementCompat(가상 기준값)을 쓰지 않는다 — 상품 값이 아닌 최소/권장값으로 '호환'을 과대 표시하지 않게.
 *   상품 값이 없으면 엔진이 UNKNOWN → CHECK 로 돌려준다('호환' 아님). 케이지를 참조하지 않는 규칙은 엔진이 NONE(QA184 MEDIUM-1).
 *   케이지 없음 → none(L7 은 등록 안내 없음, 기존 동작).
 *   표시용: 노출·정렬에 쓰지 않는다(불변식 ③).
 */
export function productCageCompatOf(
  engine: Engine,
  typeId: string,
  itemId: string,
  specValues: SpecValues,
  ctx: UserContext | undefined,
): CageCompat {
  if (itemId === CAGE_ITEM_ID || !ctx) return { state: 'none' };
  try {
    const c = engine.productCageCompat(typeId, itemId, specValues, ctx);
    if (c.verdict === 'NONE') return { state: 'none' };
    return { state: 'result', verdict: c.verdict, reasons: c.reasons };
  } catch {
    return { state: 'none' };
  }
}

export function useProductCageCompat(
  catalogUrl: string,
  typeId: string,
  itemId: string,
  specValues: SpecValues,
  ctx: UserContext | undefined,
): CageCompat {
  const engine = useCompatEngine(catalogUrl, itemId);
  if (!engine) return { state: 'none' };
  return productCageCompatOf(engine, typeId, itemId, specValues, ctx);
}

export function useCageCompat(catalogUrl: string, typeId: string, itemId: string, ctx: UserContext | undefined): CageCompat {
  const engine = useCompatEngine(catalogUrl, itemId);
  if (!engine) return { state: 'none' };
  return cageCompatOf(engine, typeId, itemId, ctx);
}

function useCompatEngine(catalogUrl: string, itemId: string): Engine | null {
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
  return engine;
}
