// 상태 글리프 — 텍스트 문자, 색만으로 상태를 말하지 않는다. 단일 소스 @ws/copy GLYPH(R4-1: 판정이 보이는 모든 곳이 이 컴포넌트 하나).
//   판정 4상태: ok ○ 기준 충족 · check △ 확인 필요 · fail ✕ 미달 · none — 기준 없음 (+ unknown ? 입력 필요). 준비 상태: ready ✓ · first !.
//   글리프 자체는 aria-hidden. 옆에 상태 문구가 없는 자리(NeedChip 등)는 `labelled` 로 시각 숨김 라벨을 붙인다 —
//   라벨은 copy glyphLabel.{kind}. 키가 없으면 라벨 생략. className 은 자리별 크기 조정용(색은 data-ws-glyph 규칙).
import { GLYPH } from '@ws/copy';
import { copyAt } from './copyText';

export type GlyphKind = keyof typeof GLYPH;

export function glyphLabel(kind: GlyphKind): string | null {
  return copyAt(`glyphLabel.${kind}`);
}

export default function Glyph({ kind, labelled = false, className }: { kind: GlyphKind; labelled?: boolean; className?: string }) {
  const label = labelled ? glyphLabel(kind) : null;
  return (
    <>
      <span className={className ? `ws-glyph ${className}` : 'ws-glyph'} data-ws-glyph={kind} aria-hidden="true">
        {GLYPH[kind]}
      </span>
      {label ? <span className="ws-visually-hidden">{label}</span> : null}
    </>
  );
}
