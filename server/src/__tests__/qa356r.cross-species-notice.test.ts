// 356r QA(적대 검증) 허점 시험 — 6종 활성화(cd3f468) 뒤 종 간 혼입·고지 1회를 실시드로 고정한다.
//   (1) 공유 CareProfile(cp-parrot-small = 사랑앵무·벚꽃모란앵무, cp-parrot-medium = 왕관앵무·썬코뉴어)의 요구사항 문구는
//       두 종 화면에 함께 나가므로 특정 종 이름을 담으면 다른 종 화면에 혼입된다(356f S2 회귀 방지).
//   (2) 앵무 체인(요구사항·용품) 문구에 햄스터 전용 어휘 0, 소동물 체인 문구에 앵무 어휘 0.
//   (3) 빌드 산출물(asOf 2026-11-25): 6종 종 라우트 페이지마다 고지 문장 정확히 1회, VERIFIED 3종 페이지는 0회.
//   careNotes 는 현재 화면에 렌더되지 않아(클라이언트 소비처 0) 범위 밖 — 렌더하게 되면 이 시험에 넣는다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../prerender/site.js';
import { realSeed } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(here, '..', '..', '..', 'client', 'index.html'), 'utf8');
const NOTICE = '일반 참고 정보예요';

const strings = (o: unknown, skip: ReadonlySet<string>, acc: string[] = []): string[] => {
  if (typeof o === 'string') acc.push(o);
  else if (Array.isArray(o)) for (const v of o) strings(v, skip, acc);
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!skip.has(k)) strings(v, skip, acc);
  return acc;
};
const EXPOSED = new Set(['VERIFIED', 'GENERAL_INFO']); // DRAFT 행(공유 저울 등)은 화면에 안 나간다
const SKIP = new Set(['source', 'url', 'id', 'careProfileId', 'supplyItemId', 'reviewBasis', 'reviewStatus', 'reviewerType', 'contentKind']);

describe('356r 종 간 혼입(실시드)', () => {
  const s = realSeed();
  const items = new Map(s.supplyItems.map((i) => [i.id, i] as const));
  const reqTexts = (cp: string): Array<[string, string]> =>
    s.supplyRequirements
      .filter((r) => r.careProfileId === cp && EXPOSED.has(String(r.reviewStatus)) && EXPOSED.has(String(items.get(r.supplyItemId)?.reviewStatus)))
      .flatMap((r) => [...strings(r, SKIP), ...strings(items.get(r.supplyItemId), SKIP)].map((t) => [r.id, t] as [string, string]));

  it('공유 앵무 프로필 요구사항 문구에 개별 종 이름 0(사랑앵무 화면의 모란앵무 등)', () => {
    const names = /사랑앵무|모란앵무|러브버드|왕관앵무|코카티엘|코뉴어/;
    const hits = ['cp-parrot-small', 'cp-parrot-medium'].flatMap((cp) => reqTexts(cp).filter(([, t]) => names.test(t)));
    expect(hits).toEqual([]);
  });

  it('앵무 체인 문구에 햄스터 전용 어휘 0', () => {
    const hw = /햄스터|쳇바퀴|모래 ?목욕|베딩|톱밥|저빌|기니피그/;
    const hits = ['cp-parrot-small', 'cp-parrot-medium'].flatMap((cp) => reqTexts(cp).filter(([, t]) => hw.test(t)));
    expect(hits).toEqual([]);
  });

  it('소동물 체인 문구에 앵무 어휘 0', () => {
    const pw = /앵무|새장|횃대|모이/;
    const cps = ['cp-hamster-syrian', 'cp-hamster-dwarf', 'cp-hamster-robo', 'cp-gerbil-mongolian', 'cp-guineapig'];
    const hits = cps.flatMap((cp) => reqTexts(cp).filter(([, t]) => pw.test(t)));
    expect(hits).toEqual([]);
  });
});

describe('356r 고지 1회(빌드 산출물, asOf 2026-11-25)', () => {
  const b = buildSite(realSeed(), { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), indexable: true, asOf: '2026-11-25' });
  const visible = (html: string): string => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
  const count = (html: string): number => visible(html).split(NOTICE).length - 1;
  const GI = /^\/(parrot\/(budgie|cockatiel|lovebird-peach|sun-conure)|hamster\/robo|gerbil)(\/|$)/;
  const VER = /^\/(hamster\/(golden|dwarf)|guinea-pig)(\/|$)/;

  it('6종 종 라우트: 페이지마다 정확히 1회', () => {
    const pages = b.pages.filter((p) => GI.test(p.route.path));
    expect(pages.length).toBeGreaterThanOrEqual(6 * 20);
    expect(pages.filter((p) => count(p.html) !== 1).map((p) => `${p.route.path}=${count(p.html)}`)).toEqual([]);
  });

  it('VERIFIED 3종 종 라우트: 0회', () => {
    const pages = b.pages.filter((p) => VER.test(p.route.path));
    expect(pages.length).toBeGreaterThan(50);
    expect(pages.filter((p) => count(p.html) !== 0).map((p) => p.route.path)).toEqual([]);
  });
});
