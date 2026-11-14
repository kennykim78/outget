// 체크리스트 행 이유 한 줄(286 U6 · D9 ①②) — 엔진 단일 소스(server/src/engine/spec-text.ts, 홈 B 프리렌더와 공용) 재노출.
//   reasonLine(r) = r.whyShort ?? firstSentence(r.why). firstSentence 는 기존 호출·테스트 호환용.
export { firstSentence, reasonLine } from '@ws/engine';
