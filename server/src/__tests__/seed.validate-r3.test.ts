// R3 레인 C — slug(SL00~SL05)·병원 지역(VC03)·출처 registrable domain(V04/M6)·이미지 경로(P05/T03, M7)·키 허용목록(S08, L2).
//   실제 server/seed 를 깊은 복사해 규칙마다 하나씩 주입한다. 시드 사실은 바꾸지 않는다(메모리 복사본만).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSeedDirRaw } from '../seed/read.js';
import { unsignRaw } from './fixtures/prerender-seed.js';
import { validateSeed, type ValidateResult } from '../seed/validate.js';
import { registrableDomain, registrableDomainOfUrl } from '../seed/hostname.js';
import type { RawSeed, Rec, SeedKey } from '../seed/common.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = '2026-11-22'; // 팁 references checkedAt(2026-11-22) 이상 · 실서명일(2026-11-16) 이상 — 디스크 verifiedAt S07 방지(옛 값 2026-11-03, 277: 출처 접근일 2026-11-02 이상)
/** 디스크 시드 그대로(2026-11-16 확인표 5종 서명 후). */
const DISK_READ = readSeedDirRaw(SEED_DIR);
const DISK: RawSeed = DISK_READ.raw;
/** 규칙 주입 바탕 = 서명 전 기준(4 패킷 미서명, 메모리 — 주입 시험 의미 보존). */
const BASE: RawSeed = unsignRaw(DISK);

function fresh(): Required<RawSeed> {
  return structuredClone(BASE) as Required<RawSeed>;
}

function row(s: RawSeed, key: SeedKey, id: string): Rec {
  const r = (s[key] ?? []).find((x) => (x as Rec).id === id);
  if (!r) throw new Error(`fixture: ${key}#${id} 없음`);
  return r as Rec;
}

const errorRules = (r: ValidateResult): string[] => r.errors.map((i) => i.rule);
const NEW_RULES = ['SL00', 'SL01', 'SL02', 'SL03', 'SL04', 'SL05', 'VC03', 'P05', 'T03'];

describe('R3 C1 — 실제 시드 slug', () => {
  it('9행 slug 라벨(결정 로그 값, 271 로보 hamster/robo — 결정 ⑤)', () => {
    const slugs = Object.fromEntries((DISK.animalTypes as Rec[]).map((r) => [r.id, r.slug]));
    expect(slugs).toEqual({
      'hamster-golden': 'hamster/golden',
      'hamster-dwarf': 'hamster/dwarf',
      'gerbil-mongolian': 'gerbil',
      'guinea-pig': 'guinea-pig',
      budgie: 'parrot/budgie',
      cockatiel: 'parrot/cockatiel',
      'lovebird-peach': 'parrot/lovebird-peach',
      'sun-conure': 'parrot/sun-conure',
      'hamster-robo': 'hamster/robo',
    });
  });

  it('실제 시드(디스크, 서명 후): errors 0, 신규 규칙 0, S08 0, W-SLUG 제거', () => {
    const res = validateSeed(DISK, { now: NOW, signatures: DISK_READ.signatures });
    expect(res.errors).toEqual([]);
    const all = [...res.errors, ...res.warnings].map((i) => i.rule);
    for (const r of [...NEW_RULES, 'S08', 'W-SLUG']) expect(all).not.toContain(r);
  });
});

describe('R3 C3 — registrableDomain', () => {
  const rd = registrableDomain;
  it.each([
    ['a.vet.example.com', 'b.vet.example.com', true],
    ['example.com.', 'example.com', true],
    ['x.co.kr', 'y.co.kr', false],
    ['snu.ac.kr', 'vet.snu.ac.kr', true],
    ['www.rspca.org.uk', 'rspca.org.uk', true],
    ['a.example.com.au', 'b.example.com.au', true],
    ['EXAMPLE.COM', 'www.example.com', true],
    ['a.go.jp', 'b.go.jp', false],
  ])('%s vs %s → 같은 registrable domain = %s', (h1, h2, same) => {
    const a = rd(h1);
    const b = rd(h2);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a === b).toBe(same);
  });

  it('값', () => {
    expect(rd('a.vet.example.com')).toBe('example.com');
    expect(rd('example.com.')).toBe('example.com');
    expect(rd('x.co.kr')).toBe('x.co.kr');
    expect(rd('vet.snu.ac.kr')).toBe('snu.ac.kr');
    expect(rd('deep.a.b.nhs.uk')).toBe('b.nhs.uk');
    expect(rd('미술관.한국')).toBe(new URL('http://미술관.한국/').hostname);
    expect(rd('www.미술관.한국')).toBe(rd('미술관.한국'));
    expect(rd('미술관.한국')).toMatch(/^xn--/);
  });

  it.each(['127.0.0.1', '10.0.0.1', '0x7f.1', '[::1]', '::1', 'localhost', 'a.localhost', 'intranet', '', '.', 'co.kr', 'ac.kr', 'com', 'a..com', 'evil.com@x.com', 'a.com/x', 'a.com:80', ' a.com'])(
    '%j → null(fail-closed)',
    (h) => {
      expect(rd(h)).toBeNull();
    },
  );

  it('registrableDomainOfUrl: http(s)만, 파싱 실패 null', () => {
    expect(registrableDomainOfUrl('https://www.rspca.org.uk/a')).toBe('rspca.org.uk');
    expect(registrableDomainOfUrl('https://user@a.vet.example.com:8443/x')).toBe('example.com');
    expect(registrableDomainOfUrl('ftp://example.com/x')).toBeNull();
    expect(registrableDomainOfUrl('https://127.0.0.1/x')).toBeNull();
    expect(registrableDomainOfUrl('not a url')).toBeNull();
  });
});

interface Case {
  name: string;
  rule: string;
  inject: (s: Required<RawSeed>) => void;
}

function foodWithSources(s: Required<RawSeed>, urls: string[]): void {
  const r = row(s, 'supplyRequirements', 'req-syrian-food');
  Object.assign(r, { reviewStatus: 'VERIFIED', reviewerType: 'VET_PUBLISHED_SOURCE', verifiedBy: 'vet-handle', verifiedAt: '2026-09-30', reviewBasis: 'ROW_CHECKED' });
  r.source = urls.map((url, i) => ({ url, title: `t${i}`, accessedAt: '2026-09-30' }));
}

const setSlug = (id: string, slug: unknown) => (s: Required<RawSeed>): void => {
  row(s, 'animalTypes', id).slug = slug;
};

function unslotVet(s: Required<RawSeed>, region: string): void {
  const v = row(s, 'vetClinics', 'vc-mapo-01');
  v.region = region;
  v.verification = { status: 'REPORTED', method: 'PHONE_CALL', verifiedAt: null, note: null };
}

const CASES: Case[] = [
  // SL00
  { name: 'SL00 ACTIVE slug 삭제', rule: 'SL00', inject: (s) => { delete row(s, 'animalTypes', 'hamster-golden').slug; } },
  { name: 'SL00 ACTIVE slug null', rule: 'SL00', inject: setSlug('hamster-golden', null) },
  { name: 'SL00 ACTIVE slug 공백', rule: 'SL00', inject: setSlug('hamster-golden', '  ') },
  // SL01
  { name: 'SL01 대문자', rule: 'SL01', inject: setSlug('hamster-dwarf', 'Hamster/dwarf') },
  { name: 'SL01 3 세그먼트', rule: 'SL01', inject: setSlug('hamster-dwarf', 'hamster/dwarf/x') },
  { name: 'SL01 빈 세그먼트', rule: 'SL01', inject: setSlug('hamster-dwarf', 'hamster//dwarf') },
  { name: 'SL01 선행 슬래시', rule: 'SL01', inject: setSlug('hamster-dwarf', '/hamster') },
  { name: 'SL01 후행 하이픈', rule: 'SL01', inject: setSlug('hamster-dwarf', 'hamster-') },
  { name: 'SL01 한글', rule: 'SL01', inject: setSlug('hamster-dwarf', '햄스터') },
  { name: 'SL01 점 세그먼트', rule: 'SL01', inject: setSlug('hamster-dwarf', 'hamster/..') },
  { name: 'SL01 PLANNED 빈 문자열', rule: 'SL01', inject: setSlug('hamster-dwarf', '') },
  // SL02
  { name: 'SL02 중복', rule: 'SL02', inject: setSlug('hamster-dwarf', 'hamster/golden') },
  // SL03
  { name: 'SL03 supplies/*', rule: 'SL03', inject: setSlug('budgie', 'supplies/budgie') },
  { name: 'SL03 vet', rule: 'SL03', inject: setSlug('budgie', 'vet') },
  { name: 'SL03 api', rule: 'SL03', inject: setSlug('budgie', 'api/x') },
  { name: 'SL03 404', rule: 'SL03', inject: setSlug('budgie', '404') },
  // SL04
  { name: 'SL04 단일 세그먼트 = 다른 타입 첫 세그먼트', rule: 'SL04', inject: setSlug('gerbil-mongolian', 'hamster') },
  { name: 'SL04 parrot', rule: 'SL04', inject: setSlug('guinea-pig', 'parrot') },
  // SL05
  { name: 'SL05 setup', rule: 'SL05', inject: setSlug('cockatiel', 'parrot/setup') },
  { name: 'SL05 products', rule: 'SL05', inject: setSlug('cockatiel', 'parrot/products') },
  // VC03
  { name: 'VC03 영문 지역', rule: 'VC03', inject: (s) => unslotVet(s, 'Seoul Mapo') },
  { name: 'VC03 공백 없음', rule: 'VC03', inject: (s) => unslotVet(s, '서울마포구') },
  { name: 'VC03 경로 문자', rule: 'VC03', inject: (s) => unslotVet(s, '서울 마포구/../x') },
  { name: 'VC03 이중 공백', rule: 'VC03', inject: (s) => unslotVet(s, '서울  마포구') },
  { name: 'VC03 4 토큰', rule: 'VC03', inject: (s) => unslotVet(s, '경기 성남시 분당구 정자동') },
  // V04 (M6)
  {
    name: 'V04 서브도메인 우회(a.vet.example.com + b.vet.example.com)',
    rule: 'V04',
    inject: (s) => foodWithSources(s, ['https://a.vet.example.com/x', 'https://b.vet.example.com/y']),
  },
  { name: 'V04 후행 점 우회', rule: 'V04', inject: (s) => foodWithSources(s, ['https://example.com./x', 'https://example.com/y']) },
  { name: 'V04 IP 출처는 세지 않음', rule: 'V04', inject: (s) => foodWithSources(s, ['https://127.0.0.1/x', 'https://example.com/y']) },
  { name: 'V04 ac.kr 서브도메인', rule: 'V04', inject: (s) => foodWithSources(s, ['https://snu.ac.kr/x', 'https://vet.snu.ac.kr/y']) },
  // P05 / T03 (M7)
  { name: 'P05 외부 URL', rule: 'P05', inject: (s) => { Object.assign(row(s, 'curatedProducts', 'cp-001'), { imageAsset: 'https://cdn.x/a.jpg', imageLicense: 'OWN_PHOTO' }); } },
  { name: 'P05 경로 순회', rule: 'P05', inject: (s) => { Object.assign(row(s, 'curatedProducts', 'cp-001'), { imageAsset: '/assets/../x.png', imageLicense: 'OWN_PHOTO' }); } },
  { name: 'P05 프로토콜 상대', rule: 'P05', inject: (s) => { Object.assign(row(s, 'curatedProducts', 'cp-001'), { imageAsset: '//evil/x.png', imageLicense: 'OWN_PHOTO' }); } },
  { name: 'P05 다른 폴더', rule: 'P05', inject: (s) => { Object.assign(row(s, 'curatedProducts', 'cp-001'), { imageAsset: '/assets/reviewers/a.png', imageLicense: 'OWN_PHOTO' }); } },
  { name: 'P05 svg', rule: 'P05', inject: (s) => { Object.assign(row(s, 'curatedProducts', 'cp-001'), { imageAsset: '/assets/products/a.svg', imageLicense: 'OWN_PHOTO' }); } },
  { name: 'T03 외부 URL', rule: 'T03', inject: (s) => { Object.assign(row(s, 'testimonials', 't-001'), { reviewerImage: 'https://cdn.x/a.jpg', reviewerImageConsent: true }); } },
  { name: 'T03 경로 순회', rule: 'T03', inject: (s) => { Object.assign(row(s, 'testimonials', 't-001'), { reviewerImage: '/assets/../x.png', reviewerImageConsent: true }); } },
  { name: 'T03 프로토콜 상대', rule: 'T03', inject: (s) => { Object.assign(row(s, 'testimonials', 't-001'), { reviewerImage: '//evil/x.png', reviewerImageConsent: true }); } },
  // S08 허용목록 (L2) — SLOT 행 포함
  { name: 'S08 상품 link', rule: 'S08', inject: (s) => { row(s, 'curatedProducts', 'cp-001').link = 'https://shop.x/p'; } },
  { name: 'S08 상품 sellerName', rule: 'S08', inject: (s) => { row(s, 'curatedProducts', 'cp-001').sellerName = '가게'; } },
  { name: 'S08 상품 rating', rule: 'S08', inject: (s) => { row(s, 'curatedProducts', 'cp-001').rating = 5; } },
  { name: 'S08 후기 link', rule: 'S08', inject: (s) => { row(s, 'testimonials', 't-001').link = 'https://x'; } },
  { name: 'S08 후기 sellerName', rule: 'S08', inject: (s) => { row(s, 'testimonials', 't-001').sellerName = '가게'; } },
];

describe('R3 레인 C — 규칙별 주입 → ERROR', () => {
  for (const c of CASES) {
    it(`${c.name} → [${c.rule}]`, () => {
      const s = fresh();
      c.inject(s);
      const res = validateSeed(s, { now: NOW });
      expect(errorRules(res)).toContain(c.rule);
    });
  }
});

describe('R3 레인 C — 정상 입력은 통과(양방향)', () => {
  const clean = (inject: (s: Required<RawSeed>) => void, rules: string[]): void => {
    const s = fresh();
    inject(s);
    const res = validateSeed(s, { now: NOW });
    for (const r of rules) expect(errorRules(res)).not.toContain(r);
  };

  it('PLANNED slug 없음 → SL00 아님', () => clean((s) => { delete row(s, 'animalTypes', 'hamster-dwarf').slug; }, ['SL00', 'SL01']));
  it('하이픈 세그먼트 hamster/golden-x → 통과', () => clean(setSlug('hamster-dwarf', 'hamster/golden-x'), ['SL01', 'SL02', 'SL04', 'SL05']));
  it('단일 세그먼트가 다른 타입과 무관 → SL04 아님', () => clean(setSlug('gerbil-mongolian', 'gerbil-x'), ['SL04']));
  it('VC03 3 토큰 · SLOT 은 면제', () => {
    clean((s) => unslotVet(s, '경기 성남시 분당구'), ['VC03']);
    clean((s) => { row(s, 'vetClinics', 'vc-mapo-01').region = 'anything/../'; }, ['VC03']);
  });
  it('V04 서로 다른 registrable domain(x.co.kr + y.co.kr) → V04 아님', () =>
    clean((s) => foodWithSources(s, ['https://x.co.kr/a', 'https://y.co.kr/b']), ['V04']));
  it('P05/T03 정상 경로', () => {
    clean((s) => { Object.assign(row(s, 'curatedProducts', 'cp-001'), { imageAsset: '/assets/products/cp-001.webp', imageLicense: 'OWN_PHOTO' }); }, ['P05', 'P03']);
    clean((s) => { Object.assign(row(s, 'testimonials', 't-001'), { reviewerImage: '/assets/reviewers/t-001.jpg', reviewerImageConsent: true }); }, ['T03', 'T02']);
  });
  it('S08 허용목록: 다른 파일 미지 키는 여전히 S09 WARN', () => {
    const s = fresh();
    row(s, 'supplyItems', 'cage').foo = 1;
    const res = validateSeed(s, { now: NOW });
    expect(res.errors).toEqual([]);
    expect(res.warnings.map((i) => i.rule)).toContain('S09');
  });
});
