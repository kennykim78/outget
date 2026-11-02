// 이벤트 저장소(PRD US-018) — 쓰기 전용(append). 읽기·집계는 운영자 지표(US-018 GET /api/admin/metrics) 단계에서.
//   행 필드는 EventLog 와 1:1 — IP·UA·헤더·좌표 없음(불변식 8, schema.guard 단언).

export interface EventRow {
  id: string;
  name: string;
  /** 클라이언트 시각 ISO. */
  ts: string;
  animalTypeId: string | null;
  /** event-contract 허용목록 통과 props 의 JSON. */
  props: string;
  sessionKey: string;
  /** 수신 일자 YYYY-MM-DD(Asia/Seoul) — 수신 시각은 일 단위로만. */
  receivedDate: string;
}

export interface EventRepository {
  /** 배치 적재, 적재 행 수 반환. */
  append(rows: EventRow[]): Promise<number>;
  /** 그 수신 일자(서울)에 저장된 행 수 — 일일 상한 카운터 복원용(기동 뒤·날짜 바뀔 때 1회, 264). */
  countOnDate(receivedDate: string): Promise<number>;
}

export class InMemoryEventRepository implements EventRepository {
  private readonly rows: EventRow[] = [];

  async append(rows: EventRow[]): Promise<number> {
    for (const r of rows) this.rows.push({ ...r });
    return rows.length;
  }

  async countOnDate(receivedDate: string): Promise<number> {
    return this.rows.filter((r) => r.receivedDate === receivedDate).length;
  }

  /** 테스트·dev 확인용 사본. */
  all(): EventRow[] {
    return this.rows.map((r) => ({ ...r }));
  }
}
