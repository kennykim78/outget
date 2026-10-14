// 헤더 저장 점(PRD US-025 · 스펙33 §4 SaveDot · F3-3 · DR m-4). AnimalChip 이 이름 뒤에 렌더한다.
//   - 마운트 시 bootSaveSync() 1회(GET /auth/session 1회 → 연결이면 병합·자동 저장 시작). 재마운트·StrictMode 에도 1회.
//   - 연결(ws.save.linked)일 때만 span.ws-save-dot 6×6 + title·sr-only "이메일로 저장 중". 아니면 아무것도 그리지 않는다.
//   - 링크·버튼 아님 — 저장 진입점이 아니다(진입점은 홈 B 배너·L2 꼬리 둘뿐, 스펙33 §5.9).
import { useEffect } from 'react';
import { COPY } from '@ws/copy';
import { bootSaveSync } from './sync';
import { useSaveLinked } from './useSaveLinked';
import '../styles/save.css';

export default function SaveDot() {
  const linked = useSaveLinked();
  useEffect(() => {
    void bootSaveSync();
  }, []);
  if (!linked) return null;
  // 칩(<a data-ws-chip>) 안 이름 뒤에 놓인다(DR m-4) — sr-only 문구가 칩 접근 이름에 포함된다. 래퍼 없음(칩 flex 항목 = 점 하나).
  return (
    <>
      {' '}
      <span className="ws-save-dot" data-ws-save-dot="" aria-hidden="true" title={COPY.save.dotTitle} />
      <span className="ws-visually-hidden">{COPY.save.dotTitle}</span>
    </>
  );
}
