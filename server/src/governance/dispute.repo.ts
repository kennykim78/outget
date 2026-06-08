// Epic 7 분쟁(Dispute) 감사기록 리포지토리 — 인메모리.
//   신원정보 제공(통신판매중개 최소 의무) 등 거버넌스 행위의 감사 추적을 남긴다.
//
// 불변식 ②: 분쟁 레코드에 자금 흐름 필드 0(서버는 계약 이행/정산을 추적하지 않는다).
// 불변식 ⑤: 좌표 필드 0. 증거 보존: 삭제 메서드를 제공하지 않는다.
export interface DisputeAuditEntry {
  id: string;
  matchId: string; // 어느 매칭 맥락의 분쟁/요청인지.
  actorId: string; // 행위자(JWT sub).
  action: string; // '신원정보요청' 등 행위 라벨.
  detail: string; // 사람이 읽는 요약(개인정보 본문은 담지 않는다).
  createdAt: string; // ISO 시각.
}

export interface DisputeRepository {
  appendAudit(
    matchId: string,
    actorId: string,
    action: string,
    detail: string,
  ): Promise<DisputeAuditEntry>;
  listByMatch(matchId: string): Promise<DisputeAuditEntry[]>;
}

export class InMemoryDisputeRepository implements DisputeRepository {
  private readonly items: DisputeAuditEntry[] = [];
  private seq = 0;

  async appendAudit(
    matchId: string,
    actorId: string,
    action: string,
    detail: string,
  ): Promise<DisputeAuditEntry> {
    const entry: DisputeAuditEntry = {
      id: `dsp-${++this.seq}`,
      matchId,
      actorId,
      action,
      detail,
      createdAt: new Date().toISOString(),
    };
    this.items.push(entry);
    return entry;
  }

  async listByMatch(matchId: string): Promise<DisputeAuditEntry[]> {
    return this.items.filter((e) => e.matchId === matchId);
  }
}
