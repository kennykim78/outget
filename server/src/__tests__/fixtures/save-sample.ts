// 저장 스냅샷(SaveV1) 테스트 픽스처 — 계약 C-R5-2 예시. 사육 사실 아님(형태만).
/** 검증기 거부 테스트용 — 의도적으로 계약 밖 값을 넣으려고 형 검사를 끈 스냅샷 형. 테스트 전용. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 잘못된 값 주입이 테스트 목적
export type LooseSave = Record<string, any>;

export const ISO = '2026-10-03T01:02:03.004Z';

export function sampleSave(): Record<string, unknown> {
  return {
    v: 1,
    animalTypeId: 'hamster-golden',
    setups: {
      'hamster-golden': {
        v: 2,
        firstTime: true,
        owned: ['cage', 'wheel'],
        answeredAt: ISO,
        startedAt: ISO,
        checks: { cage: { source: 'OWNED', at: ISO }, bedding: { source: 'PURCHASED', at: ISO } },
        reached100At: null,
        updatedAt: ISO,
      },
    },
    cages: {
      'hamster-golden': { v: 1, type: 'WIRE', floorWcm: 60, floorDcm: 40, heightCm: 35, barGapMm: 8, updatedAt: ISO },
    },
    reactions: {
      like: { 'p-cage-01': ISO },
      helpful: { 'SUPPLY_ITEM:wheel': ISO },
      updatedAt: ISO,
    },
  };
}

