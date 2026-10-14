// 이 기기의 이메일 연결 여부(ws.save.linked) 구독 훅 — L8 · 헤더 저장 점(F3-3) · L6 "이 기기에만 저장돼요" 숨김(FE2).
import { useCallback, useSyncExternalStore } from 'react';
import { wsStorage, type WsStorage } from '../lib/storage';
import { readSaveState, subscribeSaveState } from './saveStateStore';

export function useSaveLinked(storage: WsStorage = wsStorage): boolean {
  const get = useCallback(() => readSaveState(storage).linked, [storage]);
  return useSyncExternalStore(subscribeSaveState, get, () => false);
}
