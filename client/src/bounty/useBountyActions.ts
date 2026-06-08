// 바운티 작성·제출 액션 훅 — 신규 라이브러리 0.
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/bounties`, `/api/bounties/:id/submissions`)만 호출.
//     외부 절대 URL 0. 사진은 MVP 미전송(외부 핫링크 자동수집 0).
//   - ②/R2: 무금전 — 작성/제출 본문에 금액·대금·정산 필드가 없다.
//     보상은 서버가 뱃지/평판으로 지급한다(응답 badgeAwarded).
//   - ⑤/R3: 좌표 필드 없음.
//   - 모든 호출 apiFetch 경유(자사 /api·Bearer·refresh).
import { useState } from 'react';
import { apiFetch } from '../auth/apiFetch';
import type { Bounty, BountyInput, BountySubmission } from './bounty.types';

// 자사 API 상대 경로(절대 URL 금지).
const BOUNTIES_PATH = '/api/bounties';
// 제출 하위경로 — 식별자는 호출자가 주입(자사 식별자만).
const submissionsPath = (bountyId: string): string =>
  `/api/bounties/${encodeURIComponent(bountyId)}/submissions`;

export interface UseBountyActionsResult {
  busy: boolean;
  error: string | null;
  /** 새 바운티 작성(POST). 본문은 미션 텍스트뿐 — 금액 0(②). */
  create: (input: BountyInput) => Promise<Bounty>;
  /**
   * 바운티 수행 제출(POST /:id/submissions). 보상은 서버가 뱃지/평판으로 지급.
   * MVP 에서 사진은 전송하지 않는다(자사 식별자만, 외부 핫링크 0 ①).
   */
  submit: (bountyId: string) => Promise<BountySubmission>;
}

export function useBountyActions(): UseBountyActionsResult {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (input: BountyInput): Promise<Bounty> => {
    setBusy(true);
    setError(null);
    // 전송 본문 — 미션뿐. 금액·결제·좌표 키 없음(②/⑤).
    const body: BountyInput = { mission: input.mission };
    try {
      const res = await apiFetch(BOUNTIES_PATH, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        throw new Error('로그인 후 바운티를 올릴 수 있어요.');
      }
      if (res.status === 403) {
        throw new Error('이 계정은 바운티를 올릴 수 없어요.');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Bounty;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '바운티 등록에 실패했습니다.';
      setError(msg);
      throw new Error(msg);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (bountyId: string): Promise<BountySubmission> => {
    setBusy(true);
    setError(null);
    // 제출 본문 — 비움(서버가 인증 주체로 식별). 사진·금액 없음(①/②).
    try {
      const res = await apiFetch(submissionsPath(bountyId), {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (res.status === 401) {
        throw new Error('로그인 후 확인 제출을 할 수 있어요.');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as BountySubmission;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '제출에 실패했습니다.';
      setError(msg);
      throw new Error(msg);
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, create, submit };
}
