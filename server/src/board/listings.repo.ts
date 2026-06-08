// Epic 2 읽기 전용 리포지토리 — user.repo.ts 포트 패턴 복제.
// 영속성(Postgres)은 후속 에픽. ListingsRepository 포트 뒤로 교체.
//
// 불변식 ⑤: 사용자 위경도를 받지도/저장하지도/추적하지도 않는다.
//   응답에 포함되는 매장 앵커 좌표는 시드 상수일 뿐, 사용자 위치가 아니다.
// 읽기 전용: 쓰기 메서드 없음(CRUD/매칭/결제는 후속 에픽).
//
// Epic 3 병합: 선택적 agentRepo(쓰기 리포지토리)를 주입받으면 listAgents 에서
//   시드 + 등록 프로필을 합쳐 보여준다. 이 클래스 자체는 여전히 읽기 전용이며,
//   등록/수정 쓰기는 agent.repo.ts(별도 라우터)가 담당한다.
import type { AgentProfile, DiscountPost, RequestItem } from './listings.types.js';
import { AGENT_SEED, DISCOUNT_SEED, REQUEST_SEED } from './listings.seed.js';
import type { AgentProfileRepository } from '../agent/agent.repo.js';
import type { StoredAgentProfile } from '../agent/agent.types.js';
import type { RequestRepository } from '../request/request.repo.js';
import type { StoredRequest } from '../request/request.types.js';

// 등록 요청(StoredRequest)을 보드 응답 shape(RequestItem)로 매핑.
// ownerUserId 는 제외(노출 금지). verifiedPrice/options 는 있으면 그대로.
function toBoardRequest(s: StoredRequest): RequestItem {
  const out: RequestItem = {
    id: s.id,
    item: s.item,
    hopePrice: s.hopePrice,
    deadline: s.deadline,
    region: s.region,
    status: s.status,
  };
  if (s.options !== undefined) out.options = s.options;
  if (s.verifiedPrice !== undefined) out.verifiedPrice = s.verifiedPrice;
  return out;
}

// 등록 프로필(StoredAgentProfile)을 보드 응답 shape(AgentProfile)로 매핑.
// ownerUserId 는 제외(노출 금지). 좌표는 있으면 그대로, 없으면 생략.
function toBoardAgent(s: StoredAgentProfile): AgentProfile {
  const out: AgentProfile = {
    id: s.id,
    status: s.status,
    activeRegion: s.activeRegion,
    scheduleText: s.scheduleText,
    reputation: s.reputation,
  };
  if (s.bizName !== undefined) out.bizName = s.bizName;
  if (s.bizNo !== undefined) out.bizNo = s.bizNo;
  if (s.contact !== undefined) out.contact = s.contact;
  if (typeof s.lat === 'number') out.lat = s.lat;
  if (typeof s.lng === 'number') out.lng = s.lng;
  return out;
}

export interface ListingsRepository {
  listAgents(region?: string): Promise<AgentProfile[]>;
  listRequests(region?: string): Promise<RequestItem[]>;
  listDiscounts(region?: string): Promise<DiscountPost[]>;
}

export class InMemoryListingsRepository implements ListingsRepository {
  private readonly agents: readonly AgentProfile[];
  private readonly requests: readonly RequestItem[];
  private readonly discounts: readonly DiscountPost[];
  private readonly agentRepo?: AgentProfileRepository;
  private readonly requestRepo?: RequestRepository;

  constructor(
    agents: readonly AgentProfile[] = AGENT_SEED,
    requests: readonly RequestItem[] = REQUEST_SEED,
    discounts: readonly DiscountPost[] = DISCOUNT_SEED,
    agentRepo?: AgentProfileRepository,
    requestRepo?: RequestRepository,
  ) {
    this.agents = agents;
    this.requests = requests;
    this.discounts = discounts;
    this.agentRepo = agentRepo;
    this.requestRepo = requestRepo;
  }

  async listAgents(region?: string): Promise<AgentProfile[]> {
    // 시드 + 등록 프로필 병합(agentRepo 주입 시). 등록분은 보드 shape 로 매핑(ownerUserId 제외).
    const registered = this.agentRepo
      ? (await this.agentRepo.listAll()).map(toBoardAgent)
      : [];
    const merged = [...this.agents, ...registered];
    if (region === undefined) return merged;
    return merged.filter((a) => a.activeRegion === region);
  }

  async listRequests(region?: string): Promise<RequestItem[]> {
    // 시드 + 등록 요청 병합(requestRepo 주입 시). 등록분은 보드 shape 로 매핑(ownerUserId 제외).
    const registered = this.requestRepo
      ? (await this.requestRepo.listAll()).map(toBoardRequest)
      : [];
    const merged = [...this.requests, ...registered];
    if (region === undefined) return merged;
    return merged.filter((r) => r.region === region);
  }

  async listDiscounts(_region?: string): Promise<DiscountPost[]> {
    // DiscountPost 계약에는 region 필드가 없다(할인소식은 매장 브랜드 기준).
    // region 쿼리는 현재 무시하고 전체를 반환한다(지역 차원은 후속 에픽에서 도입).
    void _region;
    return [...this.discounts];
  }
}
