// 287 S4(Kenny 2026-11-16 결정 4) — 홈 A 병원 행 그룹명은 COPY.homeA.vetGroups(PARROT = 「조류」),
//   L1(/pick 정적 본문) 그룹 머리는 COPY.groups(「앵무새」) 그대로(F3 — 결정 범위 밖).
//   합성 시드: promotedTwo() 의 합성 두 번째 타입을 PARROT 그룹으로 옮기고 VERIFIED 병원이 그 타입을 진료하게 한다(메모리 전용, 앵무 사실값 0).
import { describe, expect, it } from 'vitest';
import type { SeedBundle } from '../engine/index.js';
import { COPY, formatCopy } from '../prerender/copy.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { FIXTURE_AS_OF, SECOND, promotedTwo } from './fixtures/prerender-seed.js';

const TEMPLATE = '<!doctype html><html><head><!--ws:head--></head><body><div id="root"><!--ws:body--></div></body></html>';
const build = (s: SeedBundle): SiteBuild =>
  buildSite(s, { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), asOf: FIXTURE_AS_OF });
const mainOf = (b: SiteBuild, path: string): string => {
  const p = b.pages.find((x) => x.route.path === path);
  if (!p) throw new Error(`no page ${path}`);
  return p.html.slice(p.html.indexOf('<main'), p.html.indexOf('</main>'));
};
const sectionHtml = (main: string, id: string): string => {
  const at = main.indexOf(`data-ws-section="${id}"`);
  if (at < 0) return '';
  const start = main.lastIndexOf('<section', at);
  return main.slice(start, main.indexOf('</section>', at) + '</section>'.length);
};

function parrotSeed(): SeedBundle {
  const s = promotedTwo();
  const t = s.animalTypes.find((x) => x.id === SECOND.typeId);
  const v = s.vetClinics.find((x) => x.id === 'vc-mapo-01');
  if (!t || !v) throw new Error('fixture: 두 번째 타입·병원 없음');
  t.group = 'PARROT';
  v.treats = [...v.treats, SECOND.typeId];
  return s;
}

describe('287 S4 — 병원 행 「조류」 · L1 그룹 머리 「앵무새」', () => {
  const s = parrotSeed();
  const b = build(s);
  const second = b.model.types.find((t) => t.pub.id === SECOND.typeId);

  it('전제: 합성 PARROT 타입 노출 + 그 타입을 진료하는 VERIFIED 병원', () => {
    expect(second?.pub.group).toBe('PARROT');
    expect(s.vetClinics.find((x) => x.id === 'vc-mapo-01')?.verification.status).toBe('VERIFIED');
  });

  it('홈 A 병원 행 이름 = 「조류 진료 병원」(PARROT), 「소동물 진료 병원」(SMALL_MAMMAL)', () => {
    expect(COPY.homeA.vetGroups).toEqual({ SMALL_MAMMAL: '소동물', PARROT: '조류' });
    const sec = sectionHtml(mainOf(b, '/'), 'vet-split');
    expect(formatCopy(COPY.homeA.vetRow, { name: COPY.homeA.vetGroups.PARROT })).toBe('조류 진료 병원');
    expect(sec).toContain(
      `<li data-ws-group="PARROT"><span class="ws-t-cta ws-vet-row-name">조류 진료 병원</span><span class="ws-t-body ws-muted ws-vet-row-types">${second?.pub.displayName}</span></li>`,
    );
    expect(sec).toContain('<li data-ws-group="SMALL_MAMMAL"><span class="ws-t-cta ws-vet-row-name">소동물 진료 병원</span>');
    expect(sec).not.toContain(COPY.groups.PARROT);
  });

  it('같은 시드의 L1(/pick 정적) PARROT 그룹 머리 = 「앵무새」', () => {
    expect(COPY.groups.PARROT).toBe('앵무새');
    const html = b.pages.find((x) => x.route.path === '/pick')?.html ?? '';
    const head = '<section class="ws-picker-group" data-ws-group="PARROT"><h3 class="ws-t-section">앵무새</h3>';
    expect(html.split(head)).toHaveLength(2);
    const at = html.indexOf(head);
    const pickSec = html.slice(at, html.indexOf('</section>', at));
    expect(pickSec).toContain(String(second?.pub.displayName));
    expect(pickSec).not.toContain('조류');
  });
});
