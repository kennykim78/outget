import { describe, expect, it } from 'vitest';
import { InMemoryBadgeRepository } from '../badge/badge.repo.js';

// Epic 8 뱃지 리포지토리 — 멱등 부여(무금전). 금액·잔액 0.

describe('BadgeRepository.grant 멱등', () => {
  it('같은 (userId, type) 을 두 번 부여해도 한 번만 보유', async () => {
    const repo = new InMemoryBadgeRepository();
    await repo.grant('u-1', '확인러');
    await repo.grant('u-1', '확인러');
    const badges = await repo.listByUser('u-1');
    expect(badges).toEqual(['확인러']);
  });

  it('grant 재호출은 같은 grantedAt(기존 레코드) 을 반환', async () => {
    const repo = new InMemoryBadgeRepository();
    const first = await repo.grant('u-2', '확인러');
    const second = await repo.grant('u-2', '확인러');
    expect(second.grantedAt).toBe(first.grantedAt);
  });

  it('다른 type 은 별개로 누적', async () => {
    const repo = new InMemoryBadgeRepository();
    await repo.grant('u-3', '확인러');
    await repo.grant('u-3', '단골');
    const badges = await repo.listByUser('u-3');
    expect(badges.sort()).toEqual(['단골', '확인러']);
  });

  it('listByUser 는 다른 사용자 뱃지를 섞지 않는다', async () => {
    const repo = new InMemoryBadgeRepository();
    await repo.grant('u-4', '확인러');
    await repo.grant('u-5', '확인러');
    expect(await repo.listByUser('u-4')).toEqual(['확인러']);
    expect(await repo.listByUser('u-5')).toEqual(['확인러']);
    expect(await repo.listByUser('u-none')).toEqual([]);
  });

  it('저장 레코드에 금액·잔액 키가 없다(무금전)', async () => {
    const repo = new InMemoryBadgeRepository();
    const badge = await repo.grant('u-6', '확인러');
    const keys = Object.keys(badge);
    expect(keys.sort()).toEqual(['grantedAt', 'type', 'userId']);
  });
});
