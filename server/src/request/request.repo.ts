// Epic 4 역경매 요청 쓰기 리포지토리 — agent.repo.ts 포트 패턴 복제.
// 인메모리 보관: 프로세스 재시작 시 소실된다. 영속성(Postgres)은 후속 에픽.
//   RequestRepository 포트 뒤로 교체한다.
//
// 불변식 ②(자금 미보유): 이 리포지토리는 자금 흐름 필드를 일절 보유하지 않는다.
//   hopePrice·verifiedPrice.price 는 표시값일 뿐 — 정산·예치·환불을 처리하지 않는다.
// 불변식 ⑤: 위경도를 저장/추적하지 않는다 — region(동/지역 텍스트)만 보유한다.
// 채택은 선착 1건만(대기→채택). 이미 비대기면 거부한다.
import type { RequestInput, StoredRequest, VerifiedPrice } from './request.types.js';

export interface RequestRepository {
  create(ownerUserId: string, input: RequestInput): Promise<StoredRequest>;
  findById(id: string): Promise<StoredRequest | undefined>;
  listByOwner(ownerUserId: string): Promise<StoredRequest[]>;
  listAll(): Promise<StoredRequest[]>;
  // 선착 채택: 대기→채택. 이미 비대기면 undefined(거부).
  adopt(
    reqId: string,
    agentId: string,
    matchId: string,
  ): Promise<StoredRequest | undefined>;
  setVerifiedPrice(reqId: string, vp: VerifiedPrice): Promise<StoredRequest | undefined>;
  reject(reqId: string): Promise<StoredRequest | undefined>;
}

export class InMemoryRequestRepository implements RequestRepository {
  private readonly byId = new Map<string, StoredRequest>();
  private seq = 0;

  async create(ownerUserId: string, input: RequestInput): Promise<StoredRequest> {
    const id = `req-${++this.seq}`;
    // status 는 서버가 '대기' 로 강제한다(클라가 정하지 못한다).
    const stored: StoredRequest = { ...input, id, ownerUserId, status: '대기' };
    this.byId.set(id, stored);
    return stored;
  }

  async findById(id: string): Promise<StoredRequest | undefined> {
    return this.byId.get(id);
  }

  async listByOwner(ownerUserId: string): Promise<StoredRequest[]> {
    return [...this.byId.values()].filter((r) => r.ownerUserId === ownerUserId);
  }

  async listAll(): Promise<StoredRequest[]> {
    return [...this.byId.values()];
  }

  async adopt(
    reqId: string,
    agentId: string,
    matchId: string,
  ): Promise<StoredRequest | undefined> {
    const found = this.byId.get(reqId);
    if (!found) return undefined;
    // 선착 1채택: 이미 비대기 상태면 거부(재채택 불가).
    if (found.status !== '대기') return undefined;
    const next: StoredRequest = {
      ...found,
      status: '채택',
      adoptedBy: agentId,
      matchId,
    };
    this.byId.set(reqId, next);
    return next;
  }

  async setVerifiedPrice(
    reqId: string,
    vp: VerifiedPrice,
  ): Promise<StoredRequest | undefined> {
    const found = this.byId.get(reqId);
    if (!found) return undefined;
    const next: StoredRequest = { ...found, verifiedPrice: vp };
    this.byId.set(reqId, next);
    return next;
  }

  async reject(reqId: string): Promise<StoredRequest | undefined> {
    // 거절은 상태를 바꾸지 않는다(대기 유지). 알림만 라우터에서 발송.
    return this.byId.get(reqId);
  }
}
