// Epic 2 읽기 전용 리포지토리 — user.repo.ts 포트 패턴 복제.
// 영속성(Postgres)은 후속 에픽. ListingsRepository 포트 뒤로 교체.
//
// 불변식 ⑤: 사용자 위경도를 받지도/저장하지도/추적하지도 않는다.
//   응답에 포함되는 매장 앵커 좌표는 시드 상수일 뿐, 사용자 위치가 아니다.
// 읽기 전용: 쓰기 메서드 없음(CRUD/매칭/결제는 후속 에픽).
import type { AgentProfile, DiscountPost, RequestItem } from './listings.types.js';
import { AGENT_SEED, DISCOUNT_SEED, REQUEST_SEED } from './listings.seed.js';

export interface ListingsRepository {
  listAgents(region?: string): Promise<AgentProfile[]>;
  listRequests(region?: string): Promise<RequestItem[]>;
  listDiscounts(region?: string): Promise<DiscountPost[]>;
}

export class InMemoryListingsRepository implements ListingsRepository {
  private readonly agents: readonly AgentProfile[];
  private readonly requests: readonly RequestItem[];
  private readonly discounts: readonly DiscountPost[];

  constructor(
    agents: readonly AgentProfile[] = AGENT_SEED,
    requests: readonly RequestItem[] = REQUEST_SEED,
    discounts: readonly DiscountPost[] = DISCOUNT_SEED,
  ) {
    this.agents = agents;
    this.requests = requests;
    this.discounts = discounts;
  }

  async listAgents(region?: string): Promise<AgentProfile[]> {
    if (region === undefined) return [...this.agents];
    return this.agents.filter((a) => a.activeRegion === region);
  }

  async listRequests(region?: string): Promise<RequestItem[]> {
    if (region === undefined) return [...this.requests];
    return this.requests.filter((r) => r.region === region);
  }

  async listDiscounts(_region?: string): Promise<DiscountPost[]> {
    // DiscountPost 계약에는 region 필드가 없다(할인소식은 매장 브랜드 기준).
    // region 쿼리는 현재 무시하고 전체를 반환한다(지역 차원은 후속 에픽에서 도입).
    void _region;
    return [...this.discounts];
  }
}
