// 홈 A(미선택) 설명 섹션 데이터(286 U3c·U3d·U3e) — 프리렌더(server/src/prerender/pages/misc.ts)·클라이언트(client/src/home/Explain.tsx) 공용 단일 규칙.
//   순수 함수: 입력은 이미 노출 판정된 요구사항(resolveRequirement 결과 — 엔진 순서 orderHint → priority → 시드 순)·노출 타입·노출 병원뿐이고,
//   숫자·이름은 시드 값 그대로(계산·창작 0, 불변식 ⑥·⑦). 대표 타입(D11 ①) = 노출 타입 중 시드 순 첫 번째. 노출 타입 0 이면 섹션 없음(D12 ①).
//   홈 ws-data 는 요구사항을 싣지 않는다(R6 G3b — 홈 문서에 부분 요구사항이 실리면 레이어 직행 판정 layerLinks·L2·L8 이 바뀐다) —
//   대신 프리렌더가 대표 타입에만 types[].homeExplain(아래 HomeAExplain, 홈 HOME·PICK·SAVE 에서만)을 싣고 클라이언트는 그것을 그대로 그린다.
import { ANIMAL_GROUPS, type AnimalGroup } from './domain.js';
import type { HomeAExplain, PublicAnimalType, PublicRequirement, PublicVet } from './public.js';
import { minSpecFigure } from './spec-text.js';

/** 「숫자로 알려 드려요」 최대 행 수(R3 시안 v1b: 2행). */
export const HOME_A_FIGURES_MAX = 2;
/** 「지금 필요 없는 것도 알려 드려요」 열마다 최대 이름 수(R3 시안 v1b: 3). */
export const HOME_A_NEED_MAX = 3;

/** 대표 타입(D11 ①) — 노출 타입 중 시드 순 첫 번째, 없으면 null. */
export function homeARepType<T>(types: readonly T[]): T | null {
  return types.length > 0 ? types[0] : null;
}

/**
 * 대표 타입 요구사항 → 홈 A 설명 데이터. 둘 다 비면 null(키를 싣지 않는다).
 *   figures(U3c) = REQUIRED 중 최소 규격 숫자(엔진 minSpecFigure — when 없는 숫자 gte 규칙 값 그대로)가 있는 것, 앞에서 최대 HOME_A_FIGURES_MAX.
 *   need·notNow(U3d) = REQUIRED 앞 HOME_A_NEED_MAX · NOT_NOW 앞 HOME_A_NEED_MAX(시드 레코드만, D10). 한 열이라도 비면 두 열 모두 [](섹션 없음).
 */
export function homeAExplainOf(reqs: readonly PublicRequirement[]): HomeAExplain | null {
  const figures: HomeAExplain['figures'] = [];
  for (const r of reqs) {
    if (figures.length >= HOME_A_FIGURES_MAX) break;
    if (r.priority !== 'REQUIRED') continue;
    const f = minSpecFigure(r.item.specSchema, r.minSpec);
    if (f) figures.push({ requirementId: r.requirementId, itemId: r.item.id, itemName: r.item.name, values: [...f.values], unit: f.unit, base: f.base });
  }
  const pick = (p: PublicRequirement['priority']) =>
    reqs
      .filter((r) => r.priority === p)
      .slice(0, HOME_A_NEED_MAX)
      .map((r) => ({ requirementId: r.requirementId, name: r.item.name }));
  const need = pick('REQUIRED');
  const notNow = pick('NOT_NOW');
  const split = need.length > 0 && notNow.length > 0;
  if (figures.length === 0 && !split) return null;
  return { figures, need: split ? need : [], notNow: split ? notNow : [] };
}

export interface HomeAVetRow {
  group: AnimalGroup;
  /** 이 그룹 노출 타입 중 노출 병원(ws-data vets) 1곳 이상이 진료 대상(treats)으로 둔 것 — 타입 시드 순. */
  types: PublicAnimalType[];
}

/**
 * 병원 분할(U3e) 진료 행 — 그룹(ANIMAL_GROUPS 순)마다 「노출 병원이 진료하는 노출 타입」. 진료 타입이 노출 타입이 아니면 세지 않는다.
 *   병원 이름·주소·위치는 쓰지 않는다(집계만, 불변식 ⑧). 결과가 []면 호출부가 「확인된 병원이 아직 없어요」.
 */
export function homeAVetRows(types: readonly PublicAnimalType[], vets: readonly Pick<PublicVet, 'treats'>[]): HomeAVetRow[] {
  const treated = new Set<string>(vets.flatMap((v) => (Array.isArray(v.treats) ? v.treats : [])));
  return ANIMAL_GROUPS.flatMap((group) => {
    const ts = types.filter((t) => t.group === group && treated.has(t.id));
    return ts.length > 0 ? [{ group, types: ts }] : [];
  });
}
