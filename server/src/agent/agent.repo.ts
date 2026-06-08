// 대행자 프로필 쓰기 리포지토리 — user.repo.ts 포트 패턴 복제.
// 인메모리 보관: 프로세스 재시작 시 소실된다. 영속성(Postgres)은 M1.
//   AgentProfileRepository 포트 뒤로 교체한다.
//
// 불변식 ⑤: 위경도로 사용자를 추적·저장하지 않는다.
//   StoredAgentProfile 의 lat/lng 는 선택적 매장 앵커일 뿐 사용자 위치가 아니다.
// 불변식 ②(자금 미보유): 이 리포지토리는 자금 흐름 필드를 일절 보유하지 않는다.
import type { AgentProfileInput, StoredAgentProfile } from './agent.types.js';

export interface AgentProfileRepository {
  // owner(JWT sub) 기준 upsert — 1인 1프로필. 신규면 발급, 있으면 갱신.
  upsertByOwner(ownerUserId: string, input: AgentProfileInput): Promise<StoredAgentProfile>;
  findByOwner(ownerUserId: string): Promise<StoredAgentProfile | undefined>;
  findById(id: string): Promise<StoredAgentProfile | undefined>;
  listAll(): Promise<StoredAgentProfile[]>;
  // 무금전 평판 누계(불변식 ②) — 바운티 기여 등으로 +delta. 금액·잔액이 아니다.
  //   소유자(JWT sub) 프로필이 있을 때만 누계되며, 없으면 undefined(노옵).
  //   클라가 reputation 을 직접 못 정하는 위조방지(validation reputation=0)는 그대로 유지된다.
  incrementReputation(
    ownerUserId: string,
    delta: number,
  ): Promise<StoredAgentProfile | undefined>;
}

export class InMemoryAgentProfileRepository implements AgentProfileRepository {
  private readonly byId = new Map<string, StoredAgentProfile>();
  private readonly byOwner = new Map<string, string>(); // ownerUserId → profileId
  private seq = 0;

  async upsertByOwner(
    ownerUserId: string,
    input: AgentProfileInput,
  ): Promise<StoredAgentProfile> {
    const existingId = this.byOwner.get(ownerUserId);
    const id = existingId ?? `ag-${++this.seq}`;
    const profile: StoredAgentProfile = { ...input, id, ownerUserId };
    this.byId.set(id, profile);
    this.byOwner.set(ownerUserId, id);
    return profile;
  }

  async findByOwner(ownerUserId: string): Promise<StoredAgentProfile | undefined> {
    const id = this.byOwner.get(ownerUserId);
    return id ? this.byId.get(id) : undefined;
  }

  async findById(id: string): Promise<StoredAgentProfile | undefined> {
    return this.byId.get(id);
  }

  async listAll(): Promise<StoredAgentProfile[]> {
    return [...this.byId.values()];
  }

  // 무금전 평판 누계(불변식 ②). 소유자 프로필이 없으면 노옵(undefined).
  //   reputation 은 신뢰 점수일 뿐 금액·잔액이 아니다 — 금전 흐름 0.
  async incrementReputation(
    ownerUserId: string,
    delta: number,
  ): Promise<StoredAgentProfile | undefined> {
    const id = this.byOwner.get(ownerUserId);
    if (!id) return undefined;
    const found = this.byId.get(id);
    if (!found) return undefined;
    const next: StoredAgentProfile = {
      ...found,
      reputation: found.reputation + delta,
    };
    this.byId.set(id, next);
    return next;
  }
}
