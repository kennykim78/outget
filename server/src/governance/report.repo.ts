// 신고(Report) 리포지토리 — 인메모리 포트 패턴.
// 인메모리 보관: 프로세스 재시작 시 소실된다. 영속성(Postgres)은 후속 에픽.
//   ReportRepository 포트 뒤로 교체한다.
//
// 불변식 ③(notice-and-takedown): create 는 status='블라인드'(임시조치)로 **즉시** 스탬프한다.
//   운영자 판단 전 선차단 — 이후 이의/복구/삭제 상태머신으로 전이한다.
// 불변식 ②: 신고에 자금 흐름 필드 0. 불변식 ⑤: 좌표 필드 0(검증에서 차단).
// 증거 보존: 삭제 메서드를 제공하지 않는다(분쟁 동선 보전).
import type {
  Report,
  ReportInput,
  ReportStatus,
  ReportTargetType,
} from './report.types.js';

export interface ReportRepository {
  // 신고 생성 — 즉시 status='블라인드'(임시조치). reporterId 는 라우터가 서버 강제.
  create(reporterId: string, input: ReportInput): Promise<Report>;
  findById(id: string): Promise<Report | undefined>;
  listByStatus(status: ReportStatus): Promise<Report[]>;
  listAll(): Promise<Report[]>;
  setStatus(id: string, status: ReportStatus): Promise<Report | undefined>;
  // 대상(타입+id)이 현재 블라인드(임시조치) 상태인지 — 메시지 등 status 필드 없는 대상 판정.
  isBlinded(targetType: ReportTargetType, targetId: string): Promise<boolean>;
}

export class InMemoryReportRepository implements ReportRepository {
  private readonly byId = new Map<string, Report>();
  private seq = 0;

  async create(reporterId: string, input: ReportInput): Promise<Report> {
    const id = `rep-${++this.seq}`;
    // 불변식 ③: 신고 즉시 블라인드(임시조치). 클라가 status 를 정하지 못한다.
    const report: Report = {
      ...input,
      id,
      reporterId,
      status: '블라인드',
      createdAt: new Date().toISOString(),
    };
    this.byId.set(id, report);
    return report;
  }

  async findById(id: string): Promise<Report | undefined> {
    return this.byId.get(id);
  }

  async listByStatus(status: ReportStatus): Promise<Report[]> {
    return [...this.byId.values()].filter((r) => r.status === status);
  }

  async listAll(): Promise<Report[]> {
    return [...this.byId.values()];
  }

  async setStatus(id: string, status: ReportStatus): Promise<Report | undefined> {
    const found = this.byId.get(id);
    if (!found) return undefined;
    const next: Report = { ...found, status };
    this.byId.set(id, next);
    return next;
  }

  // 대상이 임시조치(블라인드) 상태인지. 동일 대상에 블라인드 신고가 하나라도 있으면 true.
  async isBlinded(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<boolean> {
    for (const r of this.byId.values()) {
      if (
        r.targetType === targetType &&
        r.targetId === targetId &&
        r.status === '블라인드'
      ) {
        return true;
      }
    }
    return false;
  }
}
