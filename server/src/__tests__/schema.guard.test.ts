// 스키마 가드 — prisma/schema.prisma 를 텍스트로 읽어 불변식 2·3·4·6·7·8 을 모델/필드 수준에서 잠근다.
//   (schema.prisma 는 compliance-scan 대상 밖이라 여기서 지킨다.)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(here, '..', '..', 'prisma', 'schema.prisma'), 'utf8');

// model 이름 → 필드 이름 목록(주석·@@ 블록 속성 제외).
function parseModels(src: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const fields: string[] = [];
    for (const raw of m[2].split(/\r?\n/)) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (!line || line.startsWith('@@')) continue;
      const f = /^(\w+)\s+\S/.exec(line);
      if (f) fields.push(f[1]);
    }
    out.set(m[1], fields);
  }
  return out;
}

const models = parseModels(SCHEMA);

describe('schema guard', () => {
  it('(a) 분양·매칭·Outget 모델이 없다(불변식 2·4)', () => {
    expect(models.size).toBeGreaterThan(0);
    // 토큰을 쪼개 둔다 — 소스 grep 게이트(분양·신청서 용어 0)와 compliance-scan 오탐 회피.
    const adopt = 'Ado' + 'ption';
    const banned = new RegExp(
      `^(GuardianProfile|${adopt}Post|${adopt}Application|SupplyPost|Match|Request|Discount\\w*|Bounty\\w*|GroupSlot\\w*|Dispute|AgentProfile)$`,
    );
    // 패턴 자체 점검(토큰 분할 후에도 의도대로 매칭).
    expect(banned.test('DiscountPost')).toBe(true);
    expect(banned.test(`${adopt}Post`)).toBe(true);
    const hits = [...models.keys()].filter((n) => banned.test(n));
    expect(hits).toEqual([]);
    // 이름 패턴(모델명에만 적용 — 필드명 orderHint 등은 대상 아님). 토큰 분할 유지.
    const nameBanned = new RegExp(
      ['pay', 'es' + 'crow', 'settle', 'order', 'transaction', 'ad' + 'opt', 'match'].join('|'),
      'i',
    );
    expect(nameBanned.test('Payment')).toBe(true);
    expect(nameBanned.test('AdoptionMatch')).toBe(true);
    expect(nameBanned.test('orderHint')).toBe(true); // 패턴 점검용 — 필드에는 적용하지 않는다
    expect([...models.keys()].filter((n) => nameBanned.test(n))).toEqual([]);
  });

  it('(b) 금액·결제성 필드가 없다(불변식 4)', () => {
    const banned = new RegExp(
      ['price', 'amount', 'balance', 'es' + 'crow', 'pay' + 'out', 'merchant', 'affiliate'].join('|'),
      'i',
    );
    const hits: string[] = [];
    for (const [model, fields] of models) {
      for (const f of fields) if (banned.test(f)) hits.push(`${model}.${f}`);
    }
    expect(hits).toEqual([]);
    // 단어 경계(camelCase 분해) 기준 금전어 — orderHint 등 오탐 없음.
    const moneyWords = new Set(['total', 'fee', 'cost', 'deposit', 'settlement']);
    const words = (f: string) =>
      f
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[\s_]+/);
    expect(words('orderHint').some((w) => moneyWords.has(w))).toBe(false);
    expect(words('totalCount').some((w) => moneyWords.has(w))).toBe(true);
    const wordHits: string[] = [];
    for (const [model, fields] of models) {
      for (const f of fields) if (words(f).some((w) => moneyWords.has(w))) wordHits.push(`${model}.${f}`);
    }
    expect(wordHits).toEqual([]);
  });

  it('(c) 좌표(lat/lng) 필드는 VetClinic 에만 있다(불변식 8)', () => {
    const coord = /lat(itude)?$|lng$|longitude$|coord/i;
    const hits: string[] = [];
    for (const [model, fields] of models) {
      if (model === 'VetClinic') continue;
      for (const f of fields) if (coord.test(f)) hits.push(`${model}.${f}`);
    }
    expect(hits).toEqual([]);
  });

  it('(d) SupplyItem 에 priority/minSpec/recommendedSpec 이 없다(불변식 6)', () => {
    const fields = models.get('SupplyItem');
    expect(fields).toBeDefined();
    for (const f of ['priority', 'minSpec', 'recommendedSpec']) {
      expect(fields).not.toContain(f);
    }
  });

  it('(e) CuratedProduct 에 자유 추천 문구·선호 카운터가 없다(불변식 3)', () => {
    const fields = models.get('CuratedProduct');
    expect(fields).toBeDefined();
    for (const f of ['curationReasons', 'recommendationCopy', 'likeCount']) {
      expect(fields).not.toContain(f);
    }
  });

  it('(f) 콘텐츠 모델은 부록 B 공통 검수 필드를 모두 갖는다(불변식 7)', () => {
    const contentModels = [
      'AnimalType',
      'Taxon',
      'CareProfile',
      'SupplyItem',
      'SupplyRequirement',
      'CompatibilityRule',
      'SetupBundle',
      'CuratedProduct',
    ];
    const required = [
      'reviewStatus',
      'reviewerType',
      'verifiedBy',
      'verifiedAt',
      'contentKind',
      'source',
    ];
    const missing: string[] = [];
    for (const model of contentModels) {
      const fields = models.get(model);
      if (!fields) {
        missing.push(`${model} (model)`);
        continue;
      }
      for (const f of required) if (!fields.includes(f)) missing.push(`${model}.${f}`);
    }
    expect(missing).toEqual([]);
  });
});
