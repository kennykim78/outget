// 공동대행 슬롯 개설·참여 액션 훅 — 신규 라이브러리 0.
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/group-slots`, `/api/group-slots/:id/join`)만 호출.
//     외부 절대 URL 0.
//   - ②/R2: 금액·대금·정산·결제 본문 없음(개설=일정/지역/정원, 참여=빈 본문).
//   - ⑤/R3: 좌표 필드 없음(region 은 텍스트).
//   - I2/I3: 개설·참여는 호출 전에 경고 모달 동의를 받은 뒤에만 부른다(UI 강제).
//   - 모든 호출 apiFetch 경유(자사 /api·Bearer·refresh).
import { useState } from 'react';
import { apiFetch } from '../auth/apiFetch';
import type { GroupSlot, GroupSlotInput } from './groupslot.types';

// 자사 API 상대 경로(절대 URL 금지).
const GROUP_SLOTS_PATH = '/api/group-slots';
// 참여 하위경로 — 식별자는 호출자가 주입(자사 식별자만).
const joinPath = (slotId: string): string =>
  `/api/group-slots/${encodeURIComponent(slotId)}/join`;

export interface UseGroupSlotActionsResult {
  busy: boolean;
  error: string | null;
  /** 슬롯 개설(POST). 본문은 일정·지역·정원뿐 — 금액·좌표 0(②/⑤). */
  create: (input: GroupSlotInput) => Promise<GroupSlot>;
  /** 슬롯 참여(POST /:id/join). 빈 본문 — 금액 0(②). */
  join: (slotId: string) => Promise<GroupSlot>;
}

export function useGroupSlotActions(): UseGroupSlotActionsResult {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (input: GroupSlotInput): Promise<GroupSlot> => {
    setBusy(true);
    setError(null);
    // 전송 본문 — 일정·지역·정원뿐. 금액·결제·좌표 키 없음(②/⑤).
    const body: GroupSlotInput = {
      scheduleText: input.scheduleText,
      region: input.region,
      capacity: input.capacity,
    };
    try {
      const res = await apiFetch(GROUP_SLOTS_PATH, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        throw new Error('로그인 후 슬롯을 개설할 수 있어요.');
      }
      if (res.status === 403) {
        throw new Error('대행자 계정만 공동대행 슬롯을 개설할 수 있어요.');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as GroupSlot;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '슬롯 개설에 실패했습니다.';
      setError(msg);
      throw new Error(msg);
    } finally {
      setBusy(false);
    }
  };

  const join = async (slotId: string): Promise<GroupSlot> => {
    setBusy(true);
    setError(null);
    // 참여 본문 — 비움(서버가 인증 주체로 식별). 금액·좌표 없음(②/⑤).
    try {
      const res = await apiFetch(joinPath(slotId), {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (res.status === 401) {
        throw new Error('로그인 후 참여할 수 있어요.');
      }
      if (res.status === 403) {
        throw new Error('구매자 계정만 공동대행에 참여할 수 있어요.');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as GroupSlot;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '참여에 실패했습니다.';
      setError(msg);
      throw new Error(msg);
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, create, join };
}
