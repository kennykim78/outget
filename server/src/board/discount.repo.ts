// Epic 6 할인소식(UGC) 쓰기 리포지토리 — request.repo.ts 포트 패턴 복제.
// 인메모리 보관: 프로세스 재시작 시 소실된다. 영속성(Postgres)은 후속 에픽.
//   DiscountRepository 포트 뒤로 교체한다.
//
// 불변식 ④(기준가 미확인 강제): create 에서 정가(listPrice) 미입력이면 unverifiedBase=true 를
//   **서버가 스탬프**한다 — 클라가 false 로 덮을 수 없다. platformPrice/ourPrice 류 변수 0(R5).
// 불변식 ⑤: 사용자 위경도를 받지/저장하지 않는다 — UGC 등록분은 좌표 없이 보관한다.
// 불변식 ①: 외부 fetch 0(자사 인메모리만). photo 외부 URL 은 검증에서 이미 차단.
import type { DiscountInput, StoredDiscountPost } from './listings.types.js';

export type DiscountStatus = StoredDiscountPost['status'];

export interface DiscountRepository {
  create(authorId: string, input: DiscountInput): Promise<StoredDiscountPost>;
  findById(id: string): Promise<StoredDiscountPost | undefined>;
  listByOwner(authorId: string): Promise<StoredDiscountPost[]>;
  listAll(): Promise<StoredDiscountPost[]>;
  // 거버넌스 상태 전이(신고→블라인드, 이의/복구/삭제). 없는 글이면 undefined.
  setStatus(id: string, status: DiscountStatus): Promise<StoredDiscountPost | undefined>;
}

export class InMemoryDiscountRepository implements DiscountRepository {
  private readonly byId = new Map<string, StoredDiscountPost>();
  private seq = 0;

  async create(authorId: string, input: DiscountInput): Promise<StoredDiscountPost> {
    const id = `disc-${++this.seq}`;
    // 불변식 ④: 정가 미입력이면 unverifiedBase=true 강제(클라 우회 불가).
    const stored: StoredDiscountPost = {
      ...input,
      id,
      authorId,
      unverifiedBase: input.listPrice === undefined,
      createdAt: new Date().toISOString(),
      status: '정상',
    };
    this.byId.set(id, stored);
    return stored;
  }

  async findById(id: string): Promise<StoredDiscountPost | undefined> {
    return this.byId.get(id);
  }

  async listByOwner(authorId: string): Promise<StoredDiscountPost[]> {
    return [...this.byId.values()].filter((d) => d.authorId === authorId);
  }

  async listAll(): Promise<StoredDiscountPost[]> {
    return [...this.byId.values()];
  }

  async setStatus(
    id: string,
    status: DiscountStatus,
  ): Promise<StoredDiscountPost | undefined> {
    const found = this.byId.get(id);
    if (!found) return undefined;
    const next: StoredDiscountPost = { ...found, status };
    this.byId.set(id, next);
    return next;
  }
}
