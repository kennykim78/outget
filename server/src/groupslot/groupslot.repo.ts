// Epic 9 공동대행 슬롯 리포지토리 — discount.repo.ts 포트 패턴 복제.
// 인메모리 보관: 프로세스 재시작 시 소실된다. 영속성(Postgres)은 후속 에픽.
//   GroupSlotRepository 포트 뒤로 교체한다.
//
// 불변식 ②(자금 미보유): 슬롯은 금액·결제·정산 필드를 일절 보유하지 않는다.
//   join 은 인원 카운트만 증가시킨다(금전 처리 0).
// 불변식 ⑤: scheduleText·region 은 텍스트만(좌표 0).
import type {
  GroupSlot,
  GroupSlotInput,
  GroupSlotStatus,
} from './groupslot.types.js';

// join 결과 — 정원 초과/마감은 라우터에서 409 로 변환한다.
export type JoinResult =
  | { ok: true; slot: GroupSlot }
  | { ok: false; reason: '없음' | '마감' };

export interface GroupSlotRepository {
  create(agentId: string, input: GroupSlotInput): Promise<GroupSlot>;
  findById(id: string): Promise<GroupSlot | undefined>;
  listAll(): Promise<GroupSlot[]>;
  // 참여 — 정원 미달이면 +1(도달 시 status='마감'). 정원 초과/없음이면 실패.
  join(id: string): Promise<JoinResult>;
}

export class InMemoryGroupSlotRepository implements GroupSlotRepository {
  private readonly byId = new Map<string, GroupSlot>();
  private seq = 0;

  async create(agentId: string, input: GroupSlotInput): Promise<GroupSlot> {
    const id = `gs-${++this.seq}`;
    const slot: GroupSlot = {
      id,
      agentId,
      scheduleText: input.scheduleText,
      region: input.region,
      capacity: input.capacity,
      joinedCount: 0,
      status: '모집',
    };
    this.byId.set(id, slot);
    return slot;
  }

  async findById(id: string): Promise<GroupSlot | undefined> {
    return this.byId.get(id);
  }

  async listAll(): Promise<GroupSlot[]> {
    return [...this.byId.values()];
  }

  async join(id: string): Promise<JoinResult> {
    const found = this.byId.get(id);
    if (!found) return { ok: false, reason: '없음' };
    // 정원 가드: 이미 정원 도달/마감이면 더 받지 않는다.
    if (found.joinedCount >= found.capacity || found.status === '마감') {
      return { ok: false, reason: '마감' };
    }
    const joinedCount = found.joinedCount + 1;
    const status: GroupSlotStatus = joinedCount >= found.capacity ? '마감' : '모집';
    const next: GroupSlot = { ...found, joinedCount, status };
    this.byId.set(id, next);
    return { ok: true, slot: next };
  }
}
