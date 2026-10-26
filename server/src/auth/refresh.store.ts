// Refresh 토큰 회전(rotation) 저장소 포트 + 두 구현(InMemory / Prisma).
//
// 회전 정책: 발급(issue) → 사용 시 활성 확인(isActive) → 새 토큰 발급 + 이전 jti revoke.
//   이미 revoke 된 jti 가 다시 들어오면(재사용 공격) isActive=false → 라우터 401.
// 불변식 ②/⑤: 자금·좌표 필드 0(jti/sub/만료/폐기 메타데이터만).
import type { PrismaClient } from '@prisma/client';

export interface RefreshTokenStore {
  // 발급된 refresh jti 를 활성으로 기록(만료 시각 동반).
  issue(jti: string, sub: string, expiresAt: Date): Promise<void>;
  // jti 가 현재 활성(미폐기·미만료)인지.
  isActive(jti: string): Promise<boolean>;
  // 특정 jti 폐기(회전 시 이전 토큰).
  revoke(jti: string): Promise<void>;
  // 사용자(sub)의 모든 토큰 폐기(로그아웃-올, 보안 사고 대응).
  revokeAllForUser(sub: string): Promise<void>;
}

interface StoredRefresh {
  jti: string;
  sub: string;
  expiresAt: Date;
  revoked: boolean;
}

export class InMemoryRefreshTokenStore implements RefreshTokenStore {
  private readonly byJti = new Map<string, StoredRefresh>();

  async issue(jti: string, sub: string, expiresAt: Date): Promise<void> {
    this.byJti.set(jti, { jti, sub, expiresAt, revoked: false });
  }

  async isActive(jti: string): Promise<boolean> {
    const rec = this.byJti.get(jti);
    if (!rec) return false;
    if (rec.revoked) return false;
    if (rec.expiresAt.getTime() <= Date.now()) return false;
    return true;
  }

  async revoke(jti: string): Promise<void> {
    const rec = this.byJti.get(jti);
    if (rec) this.byJti.set(jti, { ...rec, revoked: true });
  }

  async revokeAllForUser(sub: string): Promise<void> {
    for (const [jti, rec] of this.byJti) {
      if (rec.sub === sub && !rec.revoked) {
        this.byJti.set(jti, { ...rec, revoked: true });
      }
    }
  }

  /** P2 삭제(privacy 인메모리 eraser 전용, 동기): sub 의 행 전부 제거(폐기가 아니라 삭제). 삭제 수. */
  removeAllForSubSync(sub: string): number {
    let n = 0;
    for (const [jti, rec] of this.byJti) {
      if (rec.sub === sub) {
        this.byJti.delete(jti);
        n++;
      }
    }
    return n;
  }
}

export class PrismaRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly prisma: PrismaClient) {}

  async issue(jti: string, sub: string, expiresAt: Date): Promise<void> {
    await this.prisma.refreshToken.create({
      data: { jti, sub, expiresAt, revoked: false },
    });
  }

  async isActive(jti: string): Promise<boolean> {
    const rec = await this.prisma.refreshToken.findUnique({ where: { jti } });
    if (!rec) return false;
    if (rec.revoked) return false;
    if (rec.expiresAt.getTime() <= Date.now()) return false;
    return true;
  }

  async revoke(jti: string): Promise<void> {
    // 없는 jti 도 무해하게 통과(updateMany — 0행 갱신 허용).
    await this.prisma.refreshToken.updateMany({
      where: { jti },
      data: { revoked: true },
    });
  }

  async revokeAllForUser(sub: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { sub, revoked: false },
      data: { revoked: true },
    });
  }
}
