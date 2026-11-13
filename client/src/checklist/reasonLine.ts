// 체크리스트 행 이유 한 줄(286 U6 · D9 ①): 시드 원문(why)의 첫 문장을 기계적으로 자른다 — 요약·창작 없음(불변식 ⑦).
//   문장 끝 = 마침표·물음표·느낌표 뒤 공백 또는 끝("2.5배" 같은 소수점은 자르지 않는다). 문장 끝이 없으면 원문 전체.
//   화면 한 줄 넘침은 CSS 말줄임이 맡는다(글자 수로 자르지 않는다).
const SENTENCE_END = /[.?!](?=\s|$)/;

export function firstSentence(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  if (t === '') return null;
  const m = SENTENCE_END.exec(t);
  return m ? t.slice(0, m.index + 1) : t;
}
