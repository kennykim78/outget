// 스냅샷 조각 공급자(계약 C-R5-9) — 조각마다 소유 스토어 하나(단일 소유):
//   setups = checklist/setupStore(FE2) · cages = context/cageStore(FE2) · animalType = context/animalTypeSaveable(FE2)
//   · reactions = reaction/reactionStore(FE1, recheck 제외 — D22).
//   병합 규칙(setups 항목 단위 SetupV3 · 그 외 레코드 updatedAt · animalTypeId 로컬 우선)은 merge.ts 가 정하고, 조각은 쓰라는 값만 검증 후 쓴다.
import { createSetupSaveable } from '../checklist/setupStore';
import { createAnimalTypeSaveable } from '../context/animalTypeSaveable';
import { createCageSaveable } from '../context/cageStore';
import { wsStorage, type WsStorage } from '../lib/storage';
import { createReactionSaveable } from '../reaction/reactionStore';
import type { Saveable, SavePayloads, SaveReactions } from './contract';

export interface SaveSlices {
  setups: Saveable<SavePayloads['setups']>;
  cages: Saveable<SavePayloads['cages']>;
  reactions: Saveable<SaveReactions>;
  animalType: Saveable<SavePayloads['animalType']>;
}

export function defaultSlices(storage: WsStorage = wsStorage): SaveSlices {
  return {
    setups: createSetupSaveable(storage),
    // 스키마는 스냅샷 경로에서 형태만 검사 — 다음 읽기·쓰기(useCage)에서 cage specSchema 범위로 다시 거른다.
    cages: createCageSaveable(storage),
    reactions: createReactionSaveable(storage),
    animalType: createAnimalTypeSaveable(storage),
  };
}
