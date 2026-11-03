// 280(Kenny ORDERS §47): 화면에 법 단정 문구 0 — Taxon.legal(note·cites·act6·화이트리스트)은 정보용 메모일 뿐 어떤 산출물에도 싣지 않는다.
//   Taxon 을 전부 VERIFIED(OFFICIAL_SOURCE)로 올리고(메모리 사본만) 합성 note 를 넣어도, 디스크 note 를 그대로 둬도 0 이어야 한다.
//   클라이언트 소스도 legal 을 읽는 코드가 없다(정적 확인).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SeedBundle } from '../engine/index.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { DWARF_PREVIEW_AS_OF, FIXTURE_AS_OF, V_LEGAL, dwarfPreview, promoted, realSeed } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..');
const TEMPLATE = readFileSync(join(ROOT, 'client', 'index.html'), 'utf8');
const build = (seed: SeedBundle, asOf: string): SiteBuild =>
  buildSite(seed, { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), indexable: false, asOf });

/**
 * Taxon.legal 류 법 단정·법 필드 흔적. '신고' 는 개인정보 처리방침(/privacy — 개인정보침해 신고센터 안내)에만 허용.
 *   '동물보호법'·'시행규칙' 은 여기서 보지 않는다: 검수 대상 요구사항 본문(req-syrian-cage.why 등 사육공간 기준 문장)과
 *   출처 제목에 들어 있다 — Taxon.legal 이 아니라 SPEC/CARE 사실값이라 백엔드가 고치지 않는다(280 보고서 참고).
 */
const LEGAL_WORDS = ['CITES', '국제적 멸종위기', '멸종위기', '야생생물', '지정관리', 'animalProtectionAct6', 'designatedWildlife', '"cites"'];
const SYNTH = '합성법메모280';

/** 모든 Taxon VERIFIED(OFFICIAL_SOURCE) + 합성 note + 불리언 true — 실을 경로가 있으면 드러나게. */
function allTaxaVerified(seed: SeedBundle): SeedBundle {
  const s = structuredClone(seed);
  s.taxa = s.taxa.map((t, i) => ({
    ...t,
    ...V_LEGAL,
    legal: { ...t.legal, animalProtectionAct6: true, cites: true, designatedWildlifeWhitelist: true, note: `${SYNTH}-${i} CITES 부속서 신고 대상` },
  }));
  return s;
}

function scan(b: SiteBuild): { legal: string[]; report: string[] } {
  const legal: string[] = [];
  const report: string[] = [];
  for (const [file, text] of b.files) {
    for (const w of [...LEGAL_WORDS, SYNTH]) if (text.includes(w)) legal.push(`${file}: ${w}`);
    if (!file.startsWith('privacy') && text.includes('신고')) report.push(file);
  }
  return { legal, report };
}

describe('280 — 산출물에 법 단정 문구·Taxon.legal 0', () => {
  for (const [name, seed, asOf] of [
    ['골든 노출(promoted)', promoted({ taxonVerified: true }), FIXTURE_AS_OF],
    ['드워프 노출(dwarfPreview)', dwarfPreview(), DWARF_PREVIEW_AS_OF],
  ] as const) {
    it(`${name} + 모든 Taxon VERIFIED·합성 note → legal 문구·법 필드 0 · '신고' 는 개인정보 처리방침 밖 0`, () => {
      const b = build(allTaxaVerified(seed), asOf);
      expect(b.files.size).toBeGreaterThan(3);
      // 카탈로그 Taxon 참조는 생긴다(VERIFIED) — 그래도 legal 은 없다.
      expect(b.catalog.animalTypes.some((t) => typeof t.taxonId === 'string')).toBe(true);
      expect(scan(b)).toEqual({ legal: [], report: [] });
    });

    it(`${name} + 디스크 Taxon(정보용 메모 그대로) → 디스크 legal.note 문장 0`, () => {
      const b = build(seed, asOf);
      const all = [...b.files.values()].join('\n');
      const notes = realSeed().taxa.map((t) => t.legal.note).filter((n): n is string => typeof n === 'string' && n.trim() !== '');
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) expect([n, all.includes(n)]).toEqual([n, false]);
      expect(scan(b).legal).toEqual([]);
    });
  }

  it('client/src(시험 제외)에 Taxon legal 을 읽는 코드 0 — legal·cites·animalProtectionAct6·designatedWildlife 토큰 없음', () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) {
          if (n !== '__tests__' && n !== 'node_modules') walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(n) || /\.test\.(ts|tsx)$/.test(n)) continue;
        const text = readFileSync(p, 'utf8');
        for (const re of [/\blegal\b/, /\bcites\b/, /animalProtectionAct6/, /designatedWildlife/]) if (re.test(text)) hits.push(`${p}: ${re}`);
      }
    };
    walk(join(ROOT, 'client', 'src'));
    expect(hits).toEqual([]);
  });
});
