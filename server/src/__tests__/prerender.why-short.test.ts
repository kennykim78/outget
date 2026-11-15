// D9 ② — 프리렌더 whyShort: 값이 있을 때만 ws-data·catalog 키, 이유 줄 = whyShort ?? firstSentence(why)(engine reasonLine).
//   값이 하나도 없으면 whyShort 이전 산출물과 바이트 동일(그 상태는 실시드에서 whyShort 만 뺀 승격 픽스처로 재현).
//   실시드 whyShort 17건(2026-11-15 채택, DRAFT)은 승격 픽스처(promotedTwo — req-syrian-wheel)에서만 산출물에 나온다 → 기준선은 재생성했다(off-baseline·v1).
//   가짜 whyShort 는 메모리 픽스처에만 넣는다 — 실시드 파일 불변.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { firstSentence, type SeedBundle } from '../engine/index.js';
import { WS_WIRE_VERSION, decodeWsPage } from '../engine/ws-wire.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { BASELINE_FILE, baseOptions, hashFiles } from './fixtures/affiliate/baseline.js';
import type { BaselineFile } from './fixtures/affiliate/gen-baseline.js';
import { FIXTURE_AS_OF, SECOND, V, labelEnums, patch, promotedTwo, realSeed, withoutWhyShort } from './fixtures/prerender-seed.js';

const WS_RE = /<script id="ws-data" type="application\/json">([\s\S]*?)<\/script>/;
const SHORT_CAGE = '바닥을 넓게 쓰는 동물이라 넓어야 해요.'; // 테스트 전용 가짜 값
const SHORT_WHEEL = '등이 수평으로 달리는 지름이 필요해요.'; // 테스트 전용 가짜 값(override)

type Rec = Record<string, unknown>;

/** 실시드에서 whyShort 만 뺀 승격 2타입 픽스처(= whyShort 0건 상태). */
const promotedTwoNoShort = (): SeedBundle => promotedTwo({ base: withoutWhyShort(realSeed()) });

function seedWith(): SeedBundle {
  const s = promotedTwoNoShort();
  const cage = s.supplyRequirements.find((r) => r.id === 'req-syrian-cage')!;
  cage.whyShort = SHORT_CAGE;
  const golden = s.animalTypes.find((a) => a.id === 'hamster-golden')!;
  golden.careOverrides = { requirements: { wheel: { whyShort: SHORT_WHEEL } } };
  return s;
}

const build = (s: SeedBundle): SiteBuild => buildSite(s, baseOptions(FIXTURE_AS_OF));
const typePage = (b: SiteBuild, typeId: string) => b.pages.find((p) => p.route.kind === 'TYPE' && p.route.typeId === typeId)!;
const wireReqs = (html: string): Rec[] => ((JSON.parse(WS_RE.exec(html)![1]) as Rec).data as Rec).requirements as Rec[];
const reqById = (rs: Rec[], id: string): Rec => rs.find((r) => r.requirementId === id)!;
const nowReason = (html: string, item: string): string | null => {
  const m = new RegExp(`<li class="ws-now-item" data-ws-item="${item}"[^>]*>[\\s\\S]*?<span class="ws-t-body ws-muted ws-now-reason">([^<]*)</span>`).exec(html);
  return m ? m[1] : null;
};
const SHORT_SAUCER = '쳇바퀴부터 갖추고 나서 봐도 돼요.'; // 테스트 전용 가짜 값(NOT_NOW)
const laterReason = (html: string, item: string): string | null => {
  const m = new RegExp(`<li data-ws-item="${item}"[^>]*><span class="ws-t-cta ws-later-name">[^<]*</span><span class="ws-t-body ws-muted ws-later-reason">([^<]*)</span>`).exec(html);
  return m ? m[1] : null;
};

const OFF = build(promotedTwoNoShort());
const ON = build(seedWith());
const REAL = build(promotedTwo()); // 실시드 whyShort 그대로(승격 행 중 req-syrian-wheel·복제 req-fixture-wheel 에 값)

describe('값 없음 — 키 부재(실시드에서 whyShort 만 뺀 승격 픽스처)', () => {
  it('어느 산출물에도 whyShort 문자열이 없다', () => {
    for (const [f, c] of OFF.files) expect(c.includes('whyShort'), f).toBe(false);
  });
  it('기준선(off-baseline promotedTwo) = 실시드 whyShort 그대로 빌드, whyShort 만 빼면 카탈로그는 whyShort 키만 다르다', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as BaselineFile;
    expect(hashFiles(REAL)).toEqual(baseline.cases.promotedTwo);
    expect(OFF.catalogFile).not.toBe(REAL.catalogFile);
    const drop = (x: unknown): unknown =>
      Array.isArray(x) ? x.map(drop) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x as Rec).filter(([k]) => k !== 'whyShort').map(([k, v]) => [k, drop(v)])) : x;
    expect(drop(REAL.catalog)).toEqual(OFF.catalog);
    const withKey = (REAL.catalog as unknown as { supplyRequirements: Rec[] }).supplyRequirements.filter((r) => Object.prototype.hasOwnProperty.call(r, 'whyShort')).map((r) => r.id);
    expect(withKey).toEqual(['req-syrian-wheel', SECOND.requirementIds[1]]);
  });
  it('실시드 값(채택 whyShort, 승격 메모리 사본)은 이유 줄에 그대로 — 골든 쳇바퀴', () => {
    const wheel = realSeed().supplyRequirements.find((r) => r.id === 'req-syrian-wheel')!;
    expect(typeof wheel.whyShort).toBe('string');
    expect(nowReason(typePage(REAL, 'hamster-golden').html, 'wheel')).toBe(wheel.whyShort);
    expect(nowReason(typePage(OFF, 'hamster-golden').html, 'wheel')).toBe(firstSentence(wheel.why));
  });
  it('이유 줄 = firstSentence(why)(D9 ① 동작 보존)', () => {
    const p = typePage(OFF, 'hamster-golden');
    const cage = reqById(p.data.data.requirements as unknown as Rec[], 'req-syrian-cage');
    expect(nowReason(p.html, 'cage')).toBe(firstSentence(cage.why as string));
  });
});

describe('값 있음 — 있는 행만 키, 이유 줄 = whyShort', () => {
  const golden = typePage(ON, 'hamster-golden');
  const second = typePage(ON, SECOND.typeId);

  it('ws-data: 기본 행 whyShort·override whyShort 는 키, 나머지 행·다른 타입은 키 부재', () => {
    const rs = wireReqs(golden.html);
    expect(reqById(rs, 'req-syrian-cage').whyShort).toBe(SHORT_CAGE);
    expect(reqById(rs, 'req-syrian-wheel').whyShort).toBe(SHORT_WHEEL);
    for (const r of rs.filter((x) => !['req-syrian-cage', 'req-syrian-wheel'].includes(x.requirementId as string))) {
      expect(Object.prototype.hasOwnProperty.call(r, 'whyShort'), String(r.requirementId)).toBe(false);
    }
    for (const r of wireReqs(second.html)) expect(Object.prototype.hasOwnProperty.call(r, 'whyShort')).toBe(false);
    // 키 순서: why 바로 뒤.
    const keys = Object.keys(reqById(rs, 'req-syrian-cage'));
    expect(keys[keys.indexOf('why') + 1]).toBe('whyShort');
  });

  it('와이어 버전 불변(v2) · decodeWsPage 가 whyShort 를 그대로 통과', () => {
    const wire = JSON.parse(WS_RE.exec(golden.html)![1]) as Rec;
    expect(wire.v).toBe(WS_WIRE_VERSION);
    const page = decodeWsPage(wire)!;
    expect(page).not.toBeNull();
    const cage = page.data.requirements.find((r) => r.requirementId === 'req-syrian-cage')!;
    expect(cage.whyShort).toBe(SHORT_CAGE);
    expect(page).toEqual(golden.data);
  });

  it('홈 B 지금 필요한 것 카드: whyShort 행은 whyShort, 다른 타입(같은 why, whyShort 없음)은 firstSentence', () => {
    expect(nowReason(golden.html, 'cage')).toBe(SHORT_CAGE);
    expect(nowReason(golden.html, 'wheel')).toBe(SHORT_WHEEL);
    const why = (reqById(second.data.data.requirements as unknown as Rec[], 'req-fixture-cage').why as string);
    expect(nowReason(second.html, 'cage')).toBe(firstSentence(why));
  });

  it('나중에 필요한 것(NOT_NOW): notNowReason 없는 행은 whyShort, notNowReason 있는 행은 notNowReason(client HomeB 와 같은 우선순위)', () => {
    // NOT_NOW 행(원반형 쳇바퀴)을 메모리에서만 승격 — 실시드 파일 불변.
    const withSaucer = (keepReason: boolean) => {
      const s = seedWith();
      patch(s, 'supplyRequirements', 'req-syrian-saucer', { ...V });
      patch(s, 'supplyItems', 'saucer', { ...V });
      labelEnums(s, 'saucer');
      const saucer = s.supplyRequirements.find((r) => r.id === 'req-syrian-saucer')!;
      expect(saucer.priority).toBe('NOT_NOW');
      if (!keepReason) saucer.notNowReason = null;
      saucer.whyShort = SHORT_SAUCER;
      return { saucer, html: typePage(build(s), 'hamster-golden').html };
    };
    const noReason = withSaucer(false);
    // whyShort 는 why 첫 문장과 달라야 reasonLine({why}) 변이가 드러난다.
    expect(firstSentence(noReason.saucer.why as string)).not.toBe(SHORT_SAUCER);
    expect(laterReason(noReason.html, 'saucer')).toBe(SHORT_SAUCER);
    // notNowReason 이 있으면 그것이 이긴다.
    const withReason = withSaucer(true);
    expect(withReason.saucer.notNowReason).toBeTruthy();
    expect(laterReason(withReason.html, 'saucer')).toBe(withReason.saucer.notNowReason);
  });

  it('catalog: 기본 행 whyShort 만 supplyRequirements 에, override 는 careOverrides 그대로', () => {
    const cat = ON.catalog as unknown as { supplyRequirements: Rec[]; animalTypes: Rec[] };
    expect(cat.supplyRequirements.find((r) => r.id === 'req-syrian-cage')!.whyShort).toBe(SHORT_CAGE);
    expect(cat.supplyRequirements.filter((r) => Object.prototype.hasOwnProperty.call(r, 'whyShort')).map((r) => r.id)).toEqual(['req-syrian-cage']);
    const g = cat.animalTypes.find((a) => a.id === 'hamster-golden')!;
    expect(g.careOverrides).toEqual({ requirements: { wheel: { whyShort: SHORT_WHEEL } } });
  });

  it('승격 픽스처 기준선 변화(콘텐츠 단계에 기준선 재생성이 필요하다는 사실 고정): 카탈로그 해시·골든 타입 페이지가 바뀐다', () => {
    const baseline = (JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as BaselineFile).cases.promotedTwo;
    const now = hashFiles(ON);
    const changed = Object.keys({ ...baseline, ...now }).filter((k) => baseline[k] !== now[k]);
    expect(changed.length).toBeGreaterThan(0);
    expect(ON.catalogFile).not.toBe(OFF.catalogFile);
    expect(changed).toContain(golden.route.file);
    // 이유 줄은 HTML 본문에도 바뀐다(ws-data 밖).
    expect(golden.html.replace(WS_RE, '')).not.toBe(typePage(OFF, 'hamster-golden').html.replace(WS_RE, ''));
    // 두 번째 타입 본문(ws-data 밖)은 그대로 — catalogUrl 만 ws-data 안에서 바뀐다.
    expect(second.html.replace(WS_RE, '')).toBe(typePage(OFF, SECOND.typeId).html.replace(WS_RE, ''));
  });
});
