// 매칭 리포지토리 — Request↔Agent 매칭 레코드 + 채팅 진입 placeholder.
// 인메모리 보관: 프로세스 재시작 시 소실된다. 영속성(Postgres)은 M1.
//
// 불변식 ②(자금 미보유): Match 에 금액·자금 흐름 필드를 절대 두지 않는다.
//   소비자 → 외부 안전결제 → 대행자 직행이며, 서버는 자금 흐름을 보유/추적하지 않는다.
// 채팅 본체는 Epic 5. 여기서는 chatThreadId(스레드 식별자)만 발급한다.

export interface Match {
  id: string;
  agentId: string;
  buyerId: string; // 구매자(JWT sub).
  status: '매칭'; // 거래 상태머신 진입 라벨.
  chatThreadId: string; // 채팅 스레드 식별자(본체는 Epic 5).
  createdAt: string; // ISO 시각.
}

export interface MatchRepository {
  createMatch(agentId: string, buyerId: string): Promise<Match>;
  findById(id: string): Promise<Match | undefined>;
}

export class InMemoryMatchRepository implements MatchRepository {
  private readonly byId = new Map<string, Match>();
  private seq = 0;

  async createMatch(agentId: string, buyerId: string): Promise<Match> {
    const n = ++this.seq;
    const match: Match = {
      id: `m-${n}`,
      agentId,
      buyerId,
      status: '매칭',
      chatThreadId: `thread-${n}`,
      createdAt: new Date().toISOString(),
    };
    this.byId.set(match.id, match);
    return match;
  }

  async findById(id: string): Promise<Match | undefined> {
    return this.byId.get(id);
  }
}
