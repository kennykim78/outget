// 체크리스트 상태 엔진(PRD US-005: ✓ ! △ ○, 준비율 = REQUIRED 중 ✓ 비율, △ 제외).
//   입력은 ws-data PublicRequirement 그대로 — priority·orderHint·notNowReason 은 서버 resolve 결과를 읽기만 한다
//   (재판정·재계산 없음, 불변식 ⑥). 하는 일은 그룹핑·정렬(orderHint)·사용자 체크 상태 결합뿐.
import { ORDER_HINTS, PRIORITIES, type PublicRequirement } from '@ws/engine';
import type { ReadySource, SetupV1 } from './setupStore';

/** ✓ 준비완료 · ! 먼저 준비(REQUIRED 미완료) · △ 확인 필요 · ○ 나중에. */
export type ItemState = 'READY' | 'FIRST' | 'CHECK' | 'LATER';

export interface ChecklistRow {
  requirement: PublicRequirement;
  state: ItemState;
  /** 체크 출처(이벤트 readySource 용, UI 비노출). 미체크 null. */
  source: ReadySource | null;
}

export interface ChecklistGroup {
  priority: PublicRequirement['priority'];
  rows: ChecklistRow[];
  /** NOT_NOW 그룹은 기본 접힘. */
  collapsed: boolean;
}

export interface ChecklistView {
  /** 항상 4개, PRIORITIES 순서(필수·권장·선택·지금 필요 없음). 빈 그룹 표시 여부는 화면이 정한다. */
  groups: ChecklistGroup[];
  /** 0~100 정수(내림 — 전부 ✓ 일 때만 100). REQUIRED 0개면 0. */
  readyPercent: number;
  /** REQUIRED 중 ✓ 가 아닌 것(△ 포함). */
  remainingRequired: number;
  requiredTotal: number;
  /** REQUIRED ≥ 1 이고 전부 ✓. */
  allRequiredReady: boolean;
}

export interface DeriveOptions {
  /** 케이지 호환 판정(R5). CHECK/FAIL 이면 체크 여부와 무관하게 △. */
  compat?: Record<string, 'OK' | 'CHECK' | 'FAIL'>;
}

const hintRank = (h: string): number => {
  const i = (ORDER_HINTS as readonly string[]).indexOf(h);
  return i < 0 ? ORDER_HINTS.length : i;
};

function stateFor(r: PublicRequirement, checked: boolean, compat: DeriveOptions['compat']): ItemState {
  const c = compat && Object.prototype.hasOwnProperty.call(compat, r.supplyItemId) ? compat[r.supplyItemId] : undefined;
  if (c === 'CHECK' || c === 'FAIL') return 'CHECK';
  if (checked) return 'READY';
  return r.priority === 'REQUIRED' ? 'FIRST' : 'LATER';
}

export function deriveChecklist(
  reqs: PublicRequirement[],
  setup: SetupV1 | null,
  opts?: DeriveOptions,
): ChecklistView {
  const checks = setup?.checks ?? {};
  const rows: ChecklistRow[] = reqs.map((requirement) => {
    const c = Object.prototype.hasOwnProperty.call(checks, requirement.supplyItemId)
      ? checks[requirement.supplyItemId]
      : undefined;
    return { requirement, state: stateFor(requirement, Boolean(c), opts?.compat), source: c ? c.source : null };
  });

  const groups: ChecklistGroup[] = PRIORITIES.map((priority) => ({
    priority,
    // Array.prototype.sort 는 안정 정렬 — 같은 orderHint 는 ws-data 순서 그대로.
    rows: rows
      .filter((r) => r.requirement.priority === priority)
      .sort((a, b) => hintRank(a.requirement.orderHint) - hintRank(b.requirement.orderHint)),
    collapsed: priority === 'NOT_NOW',
  }));

  const required = rows.filter((r) => r.requirement.priority === 'REQUIRED');
  const ready = required.filter((r) => r.state === 'READY').length;
  const requiredTotal = required.length;
  return {
    groups,
    readyPercent: requiredTotal === 0 ? 0 : Math.floor((ready * 100) / requiredTotal),
    remainingRequired: requiredTotal - ready,
    requiredTotal,
    allRequiredReady: requiredTotal > 0 && ready === requiredTotal,
  };
}
