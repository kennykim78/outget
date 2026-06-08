// Epic 8 바운티 리포지토리 — discount.repo.ts 포트 패턴 복제.
// 인메모리 보관: 프로세스 재시작 시 소실된다. 영속성(Postgres)은 후속 에픽.
//   BountyRepository 포트 뒤로 교체한다.
//
// 불변식 ②(자금 미보유): 바운티/제출은 금액·결제·정산 필드를 일절 보유하지 않는다.
//   제출 보상은 라우터에서 뱃지·평판만 부여한다(금전 경로 0).
// 불변식 ①: 외부 fetch 0(자사 인메모리만). photo 외부 URL 은 검증에서 차단.
// 불변식 ⑤: 좌표를 받지/저장하지 않는다.
import type {
  Bounty,
  BountyInput,
  BountyStatus,
  BountySubmission,
} from './bounty.types.js';

export interface BountyRepository {
  create(requesterId: string, input: BountyInput): Promise<Bounty>;
  findById(id: string): Promise<Bounty | undefined>;
  listAll(): Promise<Bounty[]>;
  listByRequester(requesterId: string): Promise<Bounty[]>;
  // 제출 추가 — badgeAwarded 는 서버가 결정(무금전 보상). 금액 필드 0.
  addSubmission(
    bountyId: string,
    solverId: string,
    photo: string | undefined,
    badgeAwarded: boolean,
  ): Promise<BountySubmission>;
  listSubmissions(bountyId: string): Promise<BountySubmission[]>;
  setStatus(id: string, status: BountyStatus): Promise<Bounty | undefined>;
}

export class InMemoryBountyRepository implements BountyRepository {
  private readonly byId = new Map<string, Bounty>();
  private readonly submissions: BountySubmission[] = [];
  private seq = 0;
  private subSeq = 0;

  async create(requesterId: string, input: BountyInput): Promise<Bounty> {
    const id = `bty-${++this.seq}`;
    const bounty: Bounty = {
      id,
      requesterId,
      mission: input.mission,
      status: '모집',
    };
    this.byId.set(id, bounty);
    return bounty;
  }

  async findById(id: string): Promise<Bounty | undefined> {
    return this.byId.get(id);
  }

  async listAll(): Promise<Bounty[]> {
    return [...this.byId.values()];
  }

  async listByRequester(requesterId: string): Promise<Bounty[]> {
    return [...this.byId.values()].filter((b) => b.requesterId === requesterId);
  }

  async addSubmission(
    bountyId: string,
    solverId: string,
    photo: string | undefined,
    badgeAwarded: boolean,
  ): Promise<BountySubmission> {
    const sub: BountySubmission = {
      id: `bsub-${++this.subSeq}`,
      bountyId,
      solverId,
      createdAt: new Date().toISOString(),
      badgeAwarded,
    };
    if (photo !== undefined) sub.photo = photo;
    this.submissions.push(sub);
    return sub;
  }

  async listSubmissions(bountyId: string): Promise<BountySubmission[]> {
    return this.submissions.filter((s) => s.bountyId === bountyId);
  }

  async setStatus(id: string, status: BountyStatus): Promise<Bounty | undefined> {
    const found = this.byId.get(id);
    if (!found) return undefined;
    const next: Bounty = { ...found, status };
    this.byId.set(id, next);
    return next;
  }
}
