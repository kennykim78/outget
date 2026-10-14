// 선택한 동물(ws.animalType)의 저장 조각(계약 C-R5-1 · C-R5-9 Saveable<'animalType'>).
//   export = 형식이 맞는 typeId 또는 null · import = 형식이 맞을 때만 쓴다(null·깨진 값 → 로컬 그대로, D23 삭제 tombstone 없음).
//   노출 타입 목록 검증은 읽는 쪽(useAnimalSelection) 몫 — 여기서는 slug 형식만(이메일·좌표 등이 들어갈 자리 없음, 불변식 ⑧).
//   병합 규칙(animalTypeId 로컬 우선)은 save 병합기(F3-2)가 정한다 — 이 조각은 쓰라는 값만 쓴다.
import { ANIMAL_TYPE_KEY, notifyAnimalType, subscribeAnimalType } from '../animal/selection';
import { isWsId, wsStorage, type WsStorage } from '../lib/storage';
import type { Saveable, SavePayloads } from '../save/contract';

export function createAnimalTypeSaveable(storage: WsStorage = wsStorage): Saveable<SavePayloads['animalType']> {
  return {
    key: 'animalType',
    export() {
      const raw = storage.get(ANIMAL_TYPE_KEY);
      return isWsId(raw) ? raw : null;
    },
    import(p) {
      if (!isWsId(p)) return;
      if (storage.get(ANIMAL_TYPE_KEY) === p) return;
      storage.set(ANIMAL_TYPE_KEY, p);
      notifyAnimalType();
    },
    subscribe(fn) {
      return subscribeAnimalType(fn);
    },
  };
}
