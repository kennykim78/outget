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

// 네이버쇼핑 참고가 서버 스탬프(불변식 ④) — 라우터가 외부 조회 결과를 repo 로 전달한다.
//   all-or-nothing: 이 객체가 있으면 4필드 전부, 없으면(undefined) 전부 미스탬프(폴백).
//   referenceSource/Query 는 라우터가 채우고, referencePrice/FetchedAt 는 어댑터 결과다.
//   클라가 입력으로 보낼 수 없는 서버 권위 값이다(검증에서 차단).
export interface DiscountReferenceStamp {
  referencePrice: number;
  referenceSource: string;
  referenceQuery: string;
  referenceFetchedAt: string;
}

export interface DiscountRepository {
  create(
    authorId: string,
    input: DiscountInput,
    reference?: DiscountReferenceStamp,
  ): Promise<StoredDiscountPost>;
  findById(id: string): Promise<StoredDiscountPost | undefined>;
  listByOwner(authorId: string): Promise<StoredDiscountPost[]>;
  listAll(): Promise<StoredDiscountPost[]>;
  // 거버넌스 상태 전이(신고→블라인드, 이의/복구/삭제). 없는 글이면 undefined.
  setStatus(id: string, status: DiscountStatus): Promise<StoredDiscountPost | undefined>;
}

export class InMemoryDiscountRepository implements DiscountRepository {
  private readonly byId = new Map<string, StoredDiscountPost>();
  private seq = 0;

  async create(
    authorId: string,
    input: DiscountInput,
    reference?: DiscountReferenceStamp,
  ): Promise<StoredDiscountPost> {
    const id = `disc-${++this.seq}`;
    // referenceQuery 는 입력 검색어일 뿐 — 단독 저장 금지(참고가 4필드는 reference 로만).
    const { referenceQuery: _rq, ...rest } = input;
    void _rq;
    // 불변식 ④: 정가 미입력이면 unverifiedBase=true 강제(클라 우회 불가).
    const stored: StoredDiscountPost = {
      ...rest,
      id,
      authorId,
      unverifiedBase: input.listPrice === undefined,
      createdAt: new Date().toISOString(),
      status: '정상',
    };
    // 참고가 서버 스탬프(있을 때만, all-or-nothing) — 외부 출처(불변식 ④).
    if (reference) {
      stored.referencePrice = reference.referencePrice;
      stored.referenceSource = reference.referenceSource;
      stored.referenceQuery = reference.referenceQuery;
      stored.referenceFetchedAt = reference.referenceFetchedAt;
    }
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
