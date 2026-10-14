// 그룹(slug 첫 세그먼트) 표시명 단일 출처 — type.ts·misc.ts 가 import(순환 방지로 별도 파일). 56 G3 D1·D2.
import { COPY } from '../copy.js';

/** 그룹 표시명. copy 에 없으면 빌드 실패(' · ' 로 타입명을 이어 붙이지 않는다). */
export function familyName(family: string): string {
  const names: Readonly<Record<string, string>> = COPY.group.names;
  const n = Object.prototype.hasOwnProperty.call(names, family) ? names[family] : undefined;
  if (typeof n !== 'string' || n === '') throw new Error(`prerender: 그룹 표시명 없음 — COPY.group.names["${family}"]`);
  return n;
}
