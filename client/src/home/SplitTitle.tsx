// " — " 기준 제목/부제 분리(D-19). 구분 기호는 시각적으로 숨기고 스크린리더에는 전문을 그대로 읽힌다.
export default function SplitTitle({ text }: { text: string }) {
  const i = text.indexOf(' — ');
  if (i < 0) return <span className="ws-split-title">{text}</span>;
  return (
    <>
      <span className="ws-split-title">{text.slice(0, i)}</span>
      <span className="ws-visually-hidden"> — </span>
      <span className="ws-split-sub">{text.slice(i + 3)}</span>
    </>
  );
}
