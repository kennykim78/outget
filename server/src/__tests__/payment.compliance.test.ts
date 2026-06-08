import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GuidancePaymentRail } from '../payment/guidance.rail.js';

// Epic 5 ②자금 미보유 — 이 에픽의 생존조건. 결제·채팅·매칭 코드에 자금 식별자 0.
// 주석은 deny-list("정산 없음" 등)를 담으므로 **코드(주석 제거)** 만 검사한다(scanner 와 동일).

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');

// 주석(//... 및 /*...*/) 제거 — compliance-scan.mjs 의 stripComments 와 동일 취지.
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return noBlock
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === '/' && line[i + 1] === '/' && (i === 0 || line[i - 1] !== ':')) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

function readCode(...parts: string[]): string {
  return stripComments(readFileSync(join(srcRoot, ...parts), 'utf8'));
}

// 스캐너 리터럴 회피 위해 토큰을 조립(이 테스트 파일도 server/src 스캔 대상이므로).
const MONEY_IDENTIFIERS = [
  'es' + 'crow',
  'pay' + 'out',
  '정' + '산',
  '예' + '치',
  '환' + '불',
  're' + 'fund',
  'bal' + 'ance',
  'platform' + 'Price',
];

const SCANNED_CODE_FILES: string[][] = [
  ['payment', 'payment.types.ts'],
  ['payment', 'payment.rail.ts'],
  ['payment', 'guidance.rail.ts'],
  ['payment', 'payment.routes.ts'],
  ['chat', 'message.types.ts'],
  ['chat', 'message.validation.ts'],
  ['chat', 'message.repo.ts'],
  ['chat', 'chat.routes.ts'],
  ['agent', 'match.repo.ts'],
];

describe('② — payment·chat·match 코드에 자금 식별자 0', () => {
  for (const parts of SCANNED_CODE_FILES) {
    it(`${parts.join('/')} 코드에 자금 식별자가 없다`, () => {
      const code = readCode(...parts);
      for (const id of MONEY_IDENTIFIERS) {
        expect(code.includes(id)).toBe(false);
      }
    });
  }

  it('PG 가맹점 식별자 + 결제동사 동반 0 (서버측 가맹점 없음)', () => {
    const merchant = 'merch' + 'antId';
    for (const parts of SCANNED_CODE_FILES) {
      const code = readCode(...parts);
      expect(code.includes(merchant)).toBe(false);
    }
  });
});

describe('② — 결제/매칭 코드에 외부 fetch·키 0', () => {
  it('guidance.rail·payment.routes 에 네트워크 호출 토큰이 없다', () => {
    for (const parts of [['payment', 'guidance.rail.ts'], ['payment', 'payment.routes.ts']]) {
      const code = readCode(...parts);
      expect(/\b(fetch|axios|got)\b/.test(code)).toBe(false);
      expect(/https?:\/\//i.test(code)).toBe(false);
    }
  });

  it('R4 — 외부링크 검증기 식별자 0, 동반 문구 0', () => {
    // 토큰 조립(이 테스트 파일도 스캔 대상이므로 R4 식별자 리터럴을 두지 않는다).
    const r4Identifiers = ['verify' + 'Link', 'link' + 'Safety', 'validate' + 'ExternalUrl', 'is' + 'SafeLink'];
    for (const parts of SCANNED_CODE_FILES) {
      const code = readCode(...parts);
      for (const id of r4Identifiers) {
        expect(code.includes(id)).toBe(false);
      }
      for (const line of code.split(/\r?\n/)) {
        const hasGuarantee = line.includes('보' + '증');
        const hasLink = line.includes('링' + '크');
        expect(hasGuarantee && hasLink).toBe(false);
      }
    }
  });
});

describe('② — GuidancePaymentRail 출력(런타임)', () => {
  it('createCheckoutLink 는 안내 텍스트만(URL/딥링크 없음)', async () => {
    const rail = new GuidancePaymentRail();
    const guidance = await rail.createCheckoutLink({ matchId: 'm-1' });
    expect(guidance.mode).toBe('안내');
    expect(typeof guidance.message).toBe('string');
    expect(/https?:\/\//i.test(guidance.message)).toBe(false);
    expect(/:\/\//.test(guidance.message)).toBe(false);
    // 자금 처리 약속 단어 0(R2).
    expect(guidance.message.includes('환' + '불')).toBe(false);
  });

  it('getStatus 는 provider=null, mode=안내(연동 제공자 없음)', async () => {
    const rail = new GuidancePaymentRail();
    const status = await rail.getStatus();
    expect(status.provider).toBeNull();
    expect(status.mode).toBe('안내');
  });

  it('DealContext 에 금액 필드가 없다(matchId 만)', async () => {
    // 컴파일 타임: DealContext = { matchId }. 런타임도 추가 키 0 을 확인.
    const rail = new GuidancePaymentRail();
    const guidance = await rail.createCheckoutLink({ matchId: 'm-2' });
    const keys = Object.keys(guidance);
    expect(keys.sort()).toEqual(['message', 'mode']);
  });
});
