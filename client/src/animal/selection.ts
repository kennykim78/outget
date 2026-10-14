// 동물 선택 상태(계약 C-1 ws.animalType — 원시 typeId 문자열). 동물 전환 화면 이동(D4 location.assign)은 호출부 몫.
//   - typeId: 저장값이 types(ws-data data.types — 노출 타입 전체)에 없으면 null(저장값은 지우지 않는다).
//   - select: types 에서 찾은 타입만 저장 + species_selected{animalTypeId, group, via}. 못 찾으면 아무것도 안 함.
//     via='url'(타입 페이지 진입 동기화)은 이미 같은 값이면 저장·이벤트를 생략한다(F5 "다르면 1회").
//   - types 를 생략하면 읽기는 형식만 검증하고, select 는 그룹을 알 수 없어 무시한다(dev 경고).
import type { PublicAnimalType } from '@ws/engine';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { track } from '../events/track';
import { isWsId, wsStorage, type WsStorage } from '../lib/storage';

export type SelectVia = 'picker' | 'alias' | 'url';

export interface AnimalSelection {
  /** 저장된 typeId(data.types 에 없으면 null). */
  typeId: string | null;
  select(typeId: string, via: SelectVia): void;
}

export type SelectableType = Pick<PublicAnimalType, 'id' | 'group'>;

export interface AnimalSelectionOptions {
  /** 테스트 주입용. 기본 = 브라우저 localStorage(실패 시 메모리). */
  storage?: WsStorage;
}

export const ANIMAL_TYPE_KEY = 'ws.animalType';

const listeners = new Set<() => void>();

/** ws.animalType 변경 구독(같은 탭 + 다른 탭) — 저장 조각(context/animalTypeSaveable)도 같은 경로를 쓴다. */
export function subscribeAnimalType(l: () => void): () => void {
  return subscribe(l);
}

/** 같은 탭 구독자에게 ws.animalType 변경을 알린다(저장 import 후). */
export function notifyAnimalType(): void {
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent): void => {
    if (e.key === null || e.key === ANIMAL_TYPE_KEY) l();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

function devWarn(msg: string): void {
  // eslint-disable-next-line no-console
  if (import.meta.env.DEV) console.warn(msg);
}

export function useAnimalSelection(
  types?: readonly SelectableType[],
  opts: AnimalSelectionOptions = {},
): AnimalSelection {
  const storage = opts.storage ?? wsStorage;
  const getSnapshot = useCallback(() => storage.get(ANIMAL_TYPE_KEY), [storage]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);

  const typeId = useMemo(() => {
    if (!isWsId(raw)) return null;
    if (types && !types.some((t) => t.id === raw)) return null;
    return raw;
  }, [raw, types]);

  const select = useCallback(
    (id: string, via: SelectVia) => {
      const t = types?.find((x) => x.id === id);
      if (!t || !isWsId(id)) {
        devWarn(`[selection] 선택할 수 없는 동물: ${String(id)}`);
        return;
      }
      if (via === 'url' && storage.get(ANIMAL_TYPE_KEY) === id) return;
      storage.set(ANIMAL_TYPE_KEY, id);
      for (const l of [...listeners]) l();
      track('species_selected', { animalTypeId: id, group: t.group, via });
    },
    [types, storage],
  );

  return useMemo(() => ({ typeId, select }), [typeId, select]);
}
