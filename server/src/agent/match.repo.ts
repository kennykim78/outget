// 매칭 리포지토리 — Request↔Agent 매칭 레코드 + 채팅 진입 placeholder.
// 인메모리 보관: 프로세스 재시작 시 소실된다. 영속성(Postgres)은 M1.
//
// 불변식 ②(자금 미보유): Match 에 금액·자금 흐름 필드를 절대 두지 않는다.
//   소비자 → 외부 안전결제 → 대행자 직행이며, 서버는 자금 흐름을 보유/추적하지 않는다.
//   dealMethod 는 단순 **라벨**일 뿐 — 이행/완료/정산을 추적하지 않는다(Epic 5).
import type { DealMethod } from '../payment/payment.types.js';

export interface Match {
  id: string;
  agentId: string;
  buyerId: string; // 구매자(JWT sub).
  requestId?: string; // 역경매 요청 식별자(Epic 4 채택 진입 시 동반). 자금 필드 아님.
  status: '매칭'; // 거래 상태머신 진입 라벨.
  chatThreadId: string; // 채팅 스레드 식별자(Epic 5 채팅 본체).
  createdAt: string; // ISO 시각.
  dealMethod?: DealMethod; // 거래방식 라벨('직접'|'안전결제'). 자금 필드 아님(Epic 5).
}

// 당사자 인가 헬퍼 — 매칭의 buyer/agent 만 채팅·거래방식에 접근한다.
export function isParticipant(match: Match, userId: string): boolean {
  return match.buyerId === userId || match.agentId === userId;
}

export interface MatchRepository {
  createMatch(agentId: string, buyerId: string, requestId?: string): Promise<Match>;
  findById(id: string): Promise<Match | undefined>;
  // 거래방식 라벨 설정(자금 흐름 아님). 없는 매칭이면 undefined.
  setDealMethod(matchId: string, method: DealMethod): Promise<Match | undefined>;
}

export class InMemoryMatchRepository implements MatchRepository {
  private readonly byId = new Map<string, Match>();
  private seq = 0;

  async createMatch(
    agentId: string,
    buyerId: string,
    requestId?: string,
  ): Promise<Match> {
    const n = ++this.seq;
    const match: Match = {
      id: `m-${n}`,
      agentId,
      buyerId,
      status: '매칭',
      chatThreadId: `thread-${n}`,
      createdAt: new Date().toISOString(),
    };
    // requestId 는 채택 진입 시에만 동반(없으면 일반 매칭). 자금 흐름 필드 아님.
    if (requestId !== undefined) match.requestId = requestId;
    this.byId.set(match.id, match);
    return match;
  }

  async findById(id: string): Promise<Match | undefined> {
    return this.byId.get(id);
  }

  // 거래방식 라벨만 갱신한다. 금액/자금 필드는 절대 추가하지 않는다(불변식 ②).
  async setDealMethod(matchId: string, method: DealMethod): Promise<Match | undefined> {
    const found = this.byId.get(matchId);
    if (!found) return undefined;
    const next: Match = { ...found, dealMethod: method };
    this.byId.set(matchId, next);
    return next;
  }
}
