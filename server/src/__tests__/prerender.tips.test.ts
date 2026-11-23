// 301 /{slug}/tips — 저렴 대체 팁(REFERENCE, Kenny 2026-11-22 · 302 r2) 프리렌더.
//   팁 0 = 라우트·링크·sitemap 0. 팁 ≥ 1 = /hamster/golden/tips(색인·sitemap) + 고지 원문 + 외부 링크 rel ugc + 검수 라벨 0
//   + /setup·/supplies/{item}·/supplies/{item}/{type} 진입 링크. 시드 팁은 시험 안 고정값(사육 사실 아님).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { COPY } from '../prerender/copy.js';
import { lintText } from '../seed/lint.js';
import type { BudgetTipRec, SeedBundle } from '../engine/index.js';
import { FIXTURE_AS_OF, promoted, realSeed } from './fixtures/prerender-seed.js';
import { stripTipChecks, withTipChecks } from './fixtures/tip-records.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..');
const TEMPLATE = readFileSync(join(ROOT, 'client', 'index.html'), 'utf8');
const ORIGIN = 'https://withsmall.example';
const AS_OF = '2026-11-22';

const REF = { title: '수납함 집 만들기 기록', url: 'https://namu.wiki/w/test-123', siteName: '예시 블로그', checkedAt: '2026-11-20' };
// 총괄 ORDERS 11/22 18:4x: 시험용 검수 기록(summaryCheck·vetReview)을 채운다 — p 에 키가 있으면(null 포함) 그대로.
function tip(p: Partial<BudgetTipRec> = {}): BudgetTipRec {
  return withTipChecks({
    id: 'tip-test-cage',
    kind: 'REFERENCE',
    careProfileId: 'cp-hamster-syrian',
    supplyItemId: 'cage',
    substitute: '시험 대체물',
    sourceHint: 'LIVING_GOODS_STORE',
    materials: ['시험 물품'],
    steps: ['시험 단계 하나', '시험 단계 둘'],
    dimensions: ['시험 치수 줄'],
    cautions: ['시험 주의'],
    hazards: [],
    mustCheck: ['시험 확인'],
    references: [REF],
    reviewStatus: 'DRAFT',
    reviewerType: 'AI_DRAFT',
    verifiedBy: null,
    verifiedAt: null,
    reviewBasis: null,
    contentKind: 'CARE',
    source: [],
    ...p,
  });
}

const build = (seed: SeedBundle): SiteBuild => buildSite(seed, { template: TEMPLATE, origin: ORIGIN, seedDigest: 'c'.repeat(64), asOf: AS_OF });
const withTips = (tips: BudgetTipRec[]): SeedBundle => ({ ...realSeed(), budgetTips: tips });
const pageAt = (b: SiteBuild, path: string) => b.pages.find((p) => p.route.path === path);
const allHtml = (b: SiteBuild) => [...b.files.entries()].filter(([f]) => f.endsWith('.html')).map(([, c]) => c).join('\n');

describe('팁 0건 — 라우트·링크·sitemap 0', () => {
  it.each([
    ['빈 배열', [] as BudgetTipRec[]],
    ['노출 불가 팁만(참조 없음·ETC)', [tip({ references: [] }), tip({ id: 'tip-etc', supplyItemId: 'carrier' })]],
    // 총괄 ORDERS 11/22 18:4x — 요약 원문 대조 기록 없음 · HEALTH·섭취 팁 수의 검수 표시 없음 → 비노출
    [
      '검수 기록 빈 팁만(summaryCheck null · HEALTH vetReview null)',
      [
        tip({ summaryCheck: null }),
        tip({ id: 'tip-h', supplyItemId: 'bedding', hazards: ['INGESTION'], contentKind: 'HEALTH', references: [REF, { ...REF, url: 'https://brunch.co.kr/@a/1' }], vetReview: null }),
      ],
    ],
    ['실시드 팁(사람 대조·수의 검수 기록 null — 의도된 전부 비노출)', realSeed().budgetTips ?? []],
  ])('%s', (_n, tips) => {
    const b = build(withTips(tips));
    expect(b.routes.some((r) => r.kind === 'TIPS')).toBe(false);
    const html = allHtml(b);
    expect(html).not.toContain('/tips');
    expect(html).not.toContain(COPY.tips.entry);
    expect(html).not.toContain('ws-tips-');
    expect(b.files.get('sitemap.xml')).not.toContain('/tips');
  });

  it('실제 시드(budget-tips.json 5행, 2026-11-22) → 검수 기록 null 이라 /tips 0 · 같은 행에 시험용 기록만 채우면 골든 /tips 1라우트 · 노출 팁 4(wheel 은 /tips 섹션 밖 W-TIP-CAT)', () => {
    // 총괄 ORDERS 11/22 18:4x: 실시드엔 사람 대조(summaryCheck)·수의 검수(vetReview) 기록이 없다 → 팁 페이지·진입 링크 전부 비노출(의도된 결과).
    const real = build(realSeed());
    expect(real.routes.filter((r) => r.kind === 'TIPS')).toEqual([]);
    expect(allHtml(real)).not.toContain('/tips');
    const s = realSeed();
    const b = build({ ...s, budgetTips: (s.budgetTips ?? []).map((t) => withTipChecks(stripTipChecks(t))) });
    expect(b.routes.filter((r) => r.kind === 'TIPS').map((r) => r.path)).toEqual(['/hamster/golden/tips']);
    const html = b.files.get('hamster/golden/tips/index.html') as string;
    expect([...html.matchAll(/data-ws-id="budgetTips#([^"]+)"/g)].map((m) => m[1])).toEqual([
      'tip-syrian-cage-storage-box',
      'tip-syrian-hideout-cardboard',
      'tip-syrian-water-heavy-bowl',
      'tip-syrian-bedding-plain-paper',
    ]);
  });
});

describe('팁 ≥ 1 — /hamster/golden/tips', () => {
  const b = build(
    withTips([
      tip(),
      tip({ id: 'tip-test-hide', supplyItemId: 'hideout', substitute: '시험 은신처 대체물', references: [{ ...REF, url: 'https://mirochuu.com/test-7/' }] }),
      tip({ id: 'tip-test-etc', supplyItemId: 'carrier' }),
    ]),
  );
  const p = pageAt(b, '/hamster/golden/tips');

  it('라우트 TIPS·색인·sitemap 포함', () => {
    expect(p?.route.kind).toBe('TIPS');
    expect(p?.route.indexable).toBe(true);
    expect(b.files.get('sitemap.xml')).toContain(`${ORIGIN}/hamster/golden/tips`);
  });

  it('상단 고정 고지 원문 · 섹션 순서 CAGE → HIDE · ETC 미표시', () => {
    const html = p!.html;
    const disc = html.indexOf(`<p class="ws-tips-disclaimer">${COPY.tips.disclaimer}</p>`);
    expect(disc).toBeGreaterThan(html.indexOf('<h1>'));
    expect(disc).toBeLessThan(html.indexOf('data-ws-tips-cat="CAGE"'));
    expect(html.indexOf('data-ws-tips-cat="CAGE"')).toBeLessThan(html.indexOf('data-ws-tips-cat="HIDE"'));
    expect(html).toContain('data-ws-id="budgetTips#tip-test-cage"');
    expect(html).not.toContain('tip-test-etc');
    expect(html).not.toContain('data-ws-tips-cat="ETC"');
  });

  it('외부 링크 = <a href> 만, rel 에 ugc·noopener·nofollow, 새 창 안내', () => {
    const anchors = [...p!.html.matchAll(/<a [^>]*href="https:\/\/[^"]+"[^>]*>/g)].map((x) => x[0]);
    expect(anchors.length).toBe(2);
    for (const x of anchors) {
      expect(x).toContain('target="_blank"');
      expect(x).toContain('rel="noopener noreferrer nofollow ugc"');
    }
    expect(p!.html).toContain(COPY.tips.externalNewWindow);
    // 외부 이미지·스크립트 로드 0
    expect(p!.html).not.toMatch(/<(img|script|iframe|link)[^>]+(src|href)="https?:\/\/(?!withsmall\.example)/);
  });

  it('검수 라벨·검수일·「확인됨」 0, 팁 내용은 ws-data 에 없음', () => {
    const main = p!.html.slice(p!.html.indexOf('<main'), p!.html.indexOf('</main>'));
    expect(main).not.toMatch(/검수|확인됨|AI_DRAFT|reviewerType|2026-11-20/);
    const data = p!.html.slice(p!.html.indexOf('id="ws-data"'));
    expect(data).not.toContain('시험 대체물');
    expect(data).not.toContain('namu.wiki/w/test-123');
  });

  it('최소 규격 인용(엔진 ruleText) + /check/{item} 링크 + 병원 문의 마무리', () => {
    const html = p!.html;
    expect(html).toContain(COPY.tips.ourMin);
    expect(html).toContain('href="/hamster/golden/check/cage"');
    expect(html).toContain('href="/hamster/golden/supplies/cage"');
    expect(html).toContain(COPY.tips.closing);
    expect(html).toContain('href="/vet"');
  });

  it('진입 링크 — /setup · /supplies/cage · /supplies/cage/hamster-golden', () => {
    // 실시드는 노출 번들 0(/setup 없음) — 번들 승격 픽스처(기준일 FIXTURE_AS_OF)로 /setup 진입 링크를 본다.
    const pb = buildSite(
      { ...promoted(), budgetTips: [tip({ references: [{ ...REF, checkedAt: '2026-11-10' }] })] },
      { template: TEMPLATE, origin: ORIGIN, seedDigest: 'c'.repeat(64), asOf: FIXTURE_AS_OF },
    );
    expect(pageAt(pb, '/hamster/golden/setup')?.html).toContain('<p class="ws-tips-entry"><a href="/hamster/golden/tips">');
    expect(pageAt(build(realSeed()), '/hamster/golden/setup')).toBeUndefined();
    expect(pageAt(b, '/supplies/cage')?.html).toContain('href="/hamster/golden/tips#ws-tips-cage"');
    const l4 = pageAt(b, '/supplies/cage/hamster-golden')!.html;
    // 313(311 S-3): 진입 링크는 본문 ul.ws-tips-entries 1개뿐 — 정적 L4(aside, 하이드레이션 후 사라짐) 안엔 0(JS 켬/끔 같은 수·위치).
    expect(l4.match(/\/hamster\/golden\/tips#ws-tips-cage/g)).toHaveLength(1);
    const asideAt = l4.indexOf('<aside class="ws-layer"');
    expect(asideAt).toBeGreaterThan(0);
    expect(l4.indexOf('<ul class="ws-tips-entries">')).toBeGreaterThan(-1);
    expect(l4.indexOf('<ul class="ws-tips-entries">')).toBeLessThan(asideAt);
    expect(l4.slice(asideAt)).not.toContain('ws-tips-entry');
    // 팁 없는 항목엔 진입 링크 0
    expect(pageAt(b, '/supplies/water')?.html ?? '').not.toContain('/tips');
    // 타입 레이어(하이드레이션 대상)는 바꾸지 않는다
    expect(pageAt(b, '/hamster/golden/supplies/cage')?.html).not.toContain('ws-tips-entry');
  });

  it('고정 카피는 금지어·광고어 린트 통과', () => {
    for (const v of [COPY.tips.disclaimer, COPY.tips.lead, COPY.tips.entry, COPY.tips.closing, ...Object.values(COPY.tips.sourceHints)]) {
      expect(lintText(v)).toEqual([]);
    }
  });
});

// 306 D5(302 r2 마크업) · 총괄 ②(위험 태그 고정 주의 상자) — 308.
describe('306 D5 · 총괄 ② 마크업', () => {
  const REF2 = { title: '다른 기록', url: 'https://brunch.co.kr/@other/9', siteName: '다른 블로그', checkedAt: '2026-11-20' };
  const b = build(
    withTips([
      tip({ hazards: ['VENTILATION', 'ESCAPE'], references: [REF, REF2] }),
      tip({ id: 'tip-test-bed', supplyItemId: 'bedding', substitute: '시험 베딩 대체물', references: [{ ...REF, url: 'https://mirochuu.com/test-8/' }] }),
      tip({ id: 'tip-test-hide', supplyItemId: 'hideout', substitute: '시험 은신처 대체물', references: [{ ...REF, url: 'https://mirochuu.com/test-7/' }] }),
      tip({ id: 'tip-test-hide2', supplyItemId: 'hideout', substitute: '시험 은신처 둘', mustCheck: [], references: [{ ...REF, url: 'https://mirochuu.com/test-9/' }] }),
    ]),
  );
  const html = pageAt(b, '/hamster/golden/tips')!.html;
  const art = (id: string): string => {
    const i = html.indexOf(`<article class="ws-tip" data-ws-id="budgetTips#${id}">`);
    expect(i, id).toBeGreaterThanOrEqual(0);
    return html.slice(i, html.indexOf('</article>', i));
  };

  it('위험 태그 팁: h3 바로 뒤 고정 주의 상자 — 라벨 「수의사가 확인하지 않은 참고 정보」 + 태그마다 고정 한 줄(TIP_HAZARDS 순서)', () => {
    const a = art('tip-test-cage');
    expect(a.indexOf('<section class="ws-tip-hazard" data-ws-tip-part="hazard">')).toBe(a.indexOf('</h3>') + '</h3>\n'.length);
    expect(a).toContain(`<p class="ws-tip-hazard-label">${COPY.tips.hazardLabel}</p>`);
    expect(COPY.tips.hazardLabel).toBe('수의사가 확인하지 않은 참고 정보');
    expect(a.indexOf('data-ws-hazard="ESCAPE"')).toBeLessThan(a.indexOf('data-ws-hazard="VENTILATION"'));
    expect(a).toContain(`<li data-ws-hazard="VENTILATION">${COPY.tips.hazardNotes.VENTILATION}</li>`);
    expect(a).toContain(`<li data-ws-hazard="ESCAPE">${COPY.tips.hazardNotes.ESCAPE}</li>`);
    // 위험 태그 없는 팁엔 상자 0
    expect(art('tip-test-bed')).not.toContain('ws-tip-hazard');
  });

  it('고정 주의 문구 7종: 린트 통과(금지어·광고어·단위) · 의료 판단 0 · 끝은 「병원에 문의」 이하', () => {
    for (const [z, v] of Object.entries(COPY.tips.hazardNotes)) {
      expect([z, lintText(v)]).toEqual([z, []]);
      expect([z, /괜찮|안전|진단|치료|처방|약을|먹이세요/.test(v)]).toEqual([z, false]);
      // 312(309 m-3·310 LOW-2): 7종 모두 「…병원에 문의하세요.」 어미로 끝난다(ESCAPE 포함, 단정 없이 문의까지).
      expect([z, v.endsWith('병원에 문의하세요.')]).toEqual([z, true]);
    }
    for (const v of [COPY.tips.hazardLabel, COPY.tips.hazardTitle, COPY.tips.writerCaution, COPY.tips.dimensions, COPY.tips.dimensionsBasis, COPY.tips.checkSpec, COPY.tips.vetLink]) expect(lintText(v)).toEqual([]);
  });

  it('치수 라벨 「치수와 개수」 + 메타 「· 글쓴이 기준」', () => {
    expect(art('tip-test-cage')).toContain(`<h4>${COPY.tips.dimensions}<span class="ws-t-meta"> · ${COPY.tips.dimensionsBasis}</span></h4>`);
  });

  it('반드시 확인할 것: 우리 최소 규격은 .ws-t-spec · 「글쓴이 주의점」 소제목 뒤 글쓴이 항목', () => {
    const a = art('tip-test-cage');
    expect(a).toMatch(/<li><span class="ws-t-spec">[^<]+<\/span><\/li>/);
    // 311 N-2: 조건 접두는 .ws-tip-when(본문 굵기)로 떼고 수치만 .ws-t-spec · 숫자 없는 규칙(베딩 재질·향)은 .ws-t-spec 0.
    expect(a).toMatch(/<li><span class="ws-tip-when">[^<]+일 때 — <\/span><span class="ws-t-spec">[^<]*\d[^<]*<\/span><\/li>/);
    expect(a).not.toMatch(/<span class="ws-t-spec">[^<]*일 때 —/);
    const bedMins = art('tip-test-bed').match(/<p class="ws-tip-min">[\s\S]*?<\/ul>/)?.[0] ?? '';
    expect(bedMins).toMatch(/<li>[^<]+<\/li>/);
    expect(bedMins).not.toContain('ws-t-spec');
    const w = a.indexOf(`<p class="ws-tip-writer">${COPY.tips.writerCaution}</p>`);
    expect(w).toBeGreaterThan(a.indexOf(COPY.tips.ourMin));
    expect(a.indexOf('<li>시험 확인</li>')).toBeGreaterThan(w);
  });

  it('판정 링크 카피: 숫자 규칙(케이지) 「크기」 · 재질·종류 규칙만(베딩) 「조건」 · 규칙 0(은신처) 링크 없음 · 둘 다 비면 밴드 생략', () => {
    expect(art('tip-test-cage')).toContain('내 케이지 크기 확인하기 →');
    const bed = art('tip-test-bed');
    expect(bed).toContain('href="/hamster/golden/check/bedding"');
    expect(bed).toContain('내 베딩 조건 확인하기 →');
    expect(bed).not.toContain('크기 확인하기');
    const hide = art('tip-test-hide');
    expect(hide).toContain('data-ws-tip-part="must-check"');
    expect(hide).not.toContain('/check/hideout');
    expect(hide).not.toContain(COPY.tips.ourMin);
    expect(art('tip-test-hide2')).not.toContain('data-ws-tip-part="must-check"');
  });

  it('참고 줄: 「원문 보기 ↗ · 사이트명」(글 제목 없음) · 스크린리더 「새 창, 외부 사이트」 괄호 없음', () => {
    const a = art('tip-test-cage');
    expect(a).not.toContain(REF.title);
    expect(a).toContain(`${COPY.tips.original}<span aria-hidden="true"> ↗</span><span class="ws-visually-hidden"> ${COPY.tips.externalNewWindow}</span></a> · ${REF.siteName}</li>`);
    expect(COPY.tips.externalNewWindow).not.toMatch(/[()]/);
  });

  it('마무리 병원 링크 = /vet?treats={typeId}', () => {
    expect(html).toContain(`<a href="/vet?treats=hamster-golden">${'골든햄스터 진료하는 병원 찾기 →'}</a>`);
  });
});
