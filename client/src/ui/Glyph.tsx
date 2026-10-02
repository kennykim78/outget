// 상태 글리프(스펙22 §2.0) — 텍스트 문자, 색만으로 상태를 말하지 않는다. 단일 소스 @ws/copy GLYPH.
//   글리프 자체는 aria-hidden. 옆에 상태 문구가 없는 자리(NeedChip 등)는 `labelled` 로 시각 숨김 라벨을 붙인다 —
//   라벨은 copy glyphLabel.{kind}(PRD 용어: 준비완료·먼저 준비·확인 필요·나중에, ✕ 기준 미달, ? 확인 전). 키가 없으면 라벨 생략.
import { GLYPH } from '@ws/copy';
import { copyAt } from './copyText';

export type GlyphKind = keyof typeof GLYPH;

export function glyphLabel(kind: GlyphKind): string | null {
  return copyAt(`glyphLabel.${kind}`);
}

export default function Glyph({ kind, labelled = false }: { kind: GlyphKind; labelled?: boolean }) {
  const label = labelled ? glyphLabel(kind) : null;
  return (
    <>
      <span className="ws-glyph" data-ws-glyph={kind} aria-hidden="true">
        {GLYPH[kind]}
      </span>
      {label ? <span className="ws-visually-hidden">{label}</span> : null}
    </>
  );
}
