// L1 선택 가로채기(모듈 단일 등록). L1 은 layerStore.open('L1', props) 로 열리고 props 는 history 에 문자열만 남으므로
//   함수 콜백은 props 로 못 넘긴다 — 여는 쪽(예: HomeA 의도 이동)이 여기 등록한다.
//   AnimalPicker.choose(): 저장 + species_selected 를 먼저 한 뒤 핸들러를 부르고, true 면 기본 이동(nav.assign / 같은 페이지면 close)을 생략.
//   한 번에 하나: 다시 등록하면 이전 핸들러를 덮는다. 해제는 setPickHandler 가 돌려준 함수(자기 핸들러일 때만 지움).
import type { PublicAnimalType } from '@ws/engine';
import type { SelectVia } from './selection';

/** true = 이동을 핸들러가 맡았다(기본 이동 생략). false = 기본 이동. */
export type PickHandler = (type: PublicAnimalType, via: SelectVia) => boolean;

let handler: PickHandler | null = null;

export function setPickHandler(fn: PickHandler): () => void {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

/** AnimalPicker 전용 — 핸들러가 없거나 throw 하면 false(기본 이동). */
export function runPickHandler(type: PublicAnimalType, via: SelectVia): boolean {
  if (handler === null) return false;
  try {
    return handler(type, via) === true;
  } catch (err) {
    if (import.meta.env.DEV) console.error('[pickHandler] 선택 핸들러 오류', err);
    return false;
  }
}
