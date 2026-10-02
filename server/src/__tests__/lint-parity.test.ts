// E3 정규화 패리티(R3 §2, D8): scripts/lib/normalize.mjs(compliance-scan) ↔ seed/lint.ts(seed:validate)가
//   같은 banned-words.json으로 같은 정규화 문자열·같은 (rule, term) 결과를 내야 한다.
//   위반 문자열은 런타임 조립 — compliance 스캐너가 테스트 파일을 잡지 않게.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lintText, normalizeLintText } from '../seed/lint.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const NORMALIZE_MJS = join(HERE, '..', '..', '..', 'scripts', 'lib', 'normalize.mjs');
const BANNED_JSON = join(HERE, '..', 'seed', 'banned-words.json');

type Hit = { rule: string; term: string };
interface ScriptsNormalize {
  normalizeLintText(s: string, mode: 'spaced' | 'stripped'): string;
  compileBannedWords(data: unknown): unknown;
  lintText(text: string, bw: unknown): Hit[];
}

const j = (...p: string[]): string => p.join('');
const ch = (cp: number): string => String.fromCharCode(cp);
const ZW = ch(0x200b);
const SHY = ch(0x00ad);
const WJ = ch(0x2060);
const BOM = ch(0xfeff);
const RLM = ch(0x200f);

const okay = j('괜', '찮다');
const safe = j('안', '전하다');
const cheapest = j('최', '저가');
const bySales = j('판', '매순');
const best = j('베', '스트');
const accuracy = j('정', '확도');
const signup = j('회원', '가입');
const purchase = j('구', '매');
const expert = j('전문', '가');

// 25문장 코퍼스
const CORPUS: string[] = [
  safe.normalize('NFD'), //                         1 NFD 한글
  j(cheapest.slice(0, 1), ZW, cheapest.slice(1), ' 상품'), // 2 제로폭
  j(signup.split('').join(' '), '하세요'), //        3 공백 분리
  j(expert, ' 열 명이 골랐어요'), //                 4 전문가 열 명
  j(expert, ch(0xff14), '명'), //                    5 전각 숫자
  j('가', purchase[0], ' ', purchase[1], '장'), //  6 가구 매장(L06)
  j(purchase[0], ' ', purchase[1]), //              7 구 매(L06)
  j('안', '전·세척이 쉬워요'), //                    8 어간 안전
  j('괜', '찮은 선택이에요'), //                     9 어간 괜찮
  '바닥이 넓은 케이지를 먼저 확인해요.', //          10 깨끗
  '쳇바퀴 지름은 28cm 이상이 좋아요.', //            11 깨끗
  '병원에 문의할 상황이에요.', //                    12 깨끗
  j(best, ' 셀러'), //                               13 베스트
  j(bySales.slice(0, 1), SHY, bySales.slice(1)), //  14 소프트하이픈
  j(accuracy.slice(0, 2), WJ, accuracy.slice(2)), // 15 워드조이너
  j(BOM, okay), //                                   16 BOM
  j(okay.slice(0, 1), RLM, okay.slice(1)), //         17 방향표식
  j('여기서 ', purchase, '하기'), //                 18 구매
  j(expert, '\t3　명'), //                       19 탭·전각 공백
  j(signup.normalize('NFD').split('').join(ZW)), // 20 NFD + 제로폭 혼합
  j(cheapest.split('').join('  ')), //               21 3자 공백 분리(L01)
  j(safe, '고 ', okay), //                           22 다중 금지어
  j('ＡＢＣ ', '１２３'), //                         23 전각 영숫자(깨끗)
  '  앞뒤   공백\n\n줄바꿈  ', //                    24 공백 정규화
  j('안', '전한 ', '괜', '찮', '아요'), //           25 어간 2개
];

const sortHits = (hs: Hit[]): string[] => hs.map((h) => `${h.rule}:${h.term}`).sort();

describe('lint-parity — scripts/lib/normalize.mjs ↔ seed/lint.ts', async () => {
  const mod = (await import(pathToFileURL(NORMALIZE_MJS).href)) as ScriptsNormalize;
  const bw = mod.compileBannedWords(JSON.parse(readFileSync(BANNED_JSON, 'utf8')));

  it('코퍼스 25문장', () => {
    expect(CORPUS).toHaveLength(25);
  });

  it.each(CORPUS.map((s, i) => [i + 1, s] as const))('#%i 정규화(spaced·stripped) 동일', (_n, s) => {
    expect(mod.normalizeLintText(s, 'spaced')).toBe(normalizeLintText(s, 'spaced'));
    expect(mod.normalizeLintText(s, 'stripped')).toBe(normalizeLintText(s, 'stripped'));
  });

  it.each(CORPUS.map((s, i) => [i + 1, s] as const))('#%i 판정(rule, term) 동일', (_n, s) => {
    expect(sortHits(mod.lintText(s, bw))).toEqual(sortHits(lintText(s)));
  });

  it('코퍼스가 L01·L02·L06·깨끗을 모두 포함(패리티가 공허하지 않음)', () => {
    const rules = new Set(CORPUS.flatMap((s) => lintText(s).map((h) => h.rule)));
    expect([...rules].sort()).toEqual(['L01', 'L02', 'L06']);
    expect(CORPUS.some((s) => lintText(s).length === 0)).toBe(true);
    expect(CORPUS.some((s) => s.normalize('NFKC') !== s)).toBe(true);
  });
});
