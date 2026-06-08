// 대행자 프로필 페치/제출 훅 — 신규 라이브러리 0(React Query 등 금지).
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/agent-profile`, `/api/agent-profile/me`,
//     `/api/matches`)만 호출한다. 외부 절대 URL(http(s)://...)은 절대 구성/호출하지 않는다.
//   - ⑤/R3: 어떤 요청 본문에도 좌표를 싣지 않는다. 폼 DTO(AgentProfileInput)에
//     좌표 필드 자체가 없으므로 전송 경로에서 좌표가 발생하지 않는다.
//   - ②: 매칭 호출은 채팅 진입 placeholder 일 뿐 금액·대금 본문이 없다.
import { useEffect, useState } from 'react';
import { apiFetch } from '../auth/apiFetch';
import type {
  AgentProfileInput,
  MatchResult,
  StoredAgentProfile,
} from './agent.types';

// 자사 API 상대 경로(절대 URL 금지). 인증 헤더는 apiFetch 가 부착한다.
const PROFILE_PATH = '/api/agent-profile';
const PROFILE_ME_PATH = '/api/agent-profile/me';
const MATCHES_PATH = '/api/matches';

export interface UseAgentProfileResult {
  /** 편집 프리필용 내 프로필(GET /me). 없으면(신규) null. */
  me: StoredAgentProfile | null;
  /** 최초 /me 로딩 여부. */
  loading: boolean;
  /** 제출 진행 여부(POST/PUT). */
  saving: boolean;
  error: string | null;
  /** 프리필 재조회. */
  reloadMe: () => void;
  /**
   * 프로필 저장. 기존 프로필이 있으면 PUT, 없으면 POST.
   * 본문은 폼 DTO(AgentProfileInput)뿐 — 좌표 없음.
   */
  save: (input: AgentProfileInput) => Promise<StoredAgentProfile>;
  /** 매칭 진입(POST /api/matches) — 채팅 본체 없음(Epic 5). */
  requestMatch: (agentId: string) => Promise<MatchResult>;
}

export function useAgentProfile(): UseAgentProfileResult {
  const [me, setMe] = useState<StoredAgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // 내 프로필 프리필(GET /me). 자사 상대경로만.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch(PROFILE_ME_PATH)
      .then((res) => {
        if (res.status === 404) return null; // 미작성 — 신규 작성 흐름.
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: unknown) => {
        if (cancelled) return;
        setMe((json as StoredAgentProfile) ?? null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setMe(null);
        setError(
          e instanceof Error ? e.message : '프로필을 불러오지 못했습니다.',
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const save = async (
    input: AgentProfileInput,
  ): Promise<StoredAgentProfile> => {
    setSaving(true);
    setError(null);
    try {
      // 기존 프로필 유무로 method 분기(PUT 수정 / POST 신규).
      const method = me ? 'PUT' : 'POST';
      const res = await apiFetch(PROFILE_PATH, {
        method,
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = (await res.json()) as StoredAgentProfile;
      setMe(saved);
      return saved;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      setError(msg);
      throw new Error(msg);
    } finally {
      setSaving(false);
    }
  };

  const requestMatch = async (agentId: string): Promise<MatchResult> => {
    // 채팅 진입 placeholder. 본문은 대상 식별자뿐 — 금액·대금·좌표 0.
    const res = await apiFetch(MATCHES_PATH, {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as MatchResult;
  };

  return {
    me,
    loading,
    saving,
    error,
    reloadMe: () => setNonce((n) => n + 1),
    save,
    requestMatch,
  };
}
