// D9 ② — whyShort(이유 한 줄): resolveRequirement 결합 규칙(한 곳, 불변식 6) + reasonLine 폴백(firstSentence).
//   테스트용 가짜 값은 이 파일 메모리 픽스처에만(실시드에 넣지 않는다).
import { describe, expect, it } from 'vitest';
import { createCatalog, firstSentence, listResolvedRequirements, reasonLine, resolveRequirement } from '../engine/index.js';
import { makeBundle } from './fixtures/engine-catalog.js';

type Bundle = ReturnType<typeof makeBundle>;

function withShort(mut: (b: Bundle) => void) {
  const b = makeBundle();
  mut(b);
  return createCatalog(b);
}
const reqOf = (b: Bundle, profile: string, item: string) =>
  b.supplyRequirements.find((r) => r.careProfileId === profile && r.supplyItemId === item)!;
const critter = (b: Bundle) => b.animalTypes.find((a) => a.id === 'critter')!;

describe('D9 ② resolveRequirement — whyShort 결합', () => {
  it('시드에 키가 없으면 null(키 부재 = 미작성), provenance REQUIREMENT', () => {
    const r = resolveRequirement(createCatalog(makeBundle()), 'critter-plain', 'box')!;
    expect(r.whyShort).toBeNull();
    expect(r.provenance.whyShort).toBe('REQUIREMENT');
  });

  it('기본 행 whyShort 유지(override 없음)', () => {
    const cat = withShort((b) => {
      reqOf(b, 'pf-test', 'box').whyShort = '상자 짧은 이유예요.';
    });
    const r = resolveRequirement(cat, 'critter-plain', 'box')!;
    expect(r.whyShort).toBe('상자 짧은 이유예요.');
    expect(r.provenance.whyShort).toBe('REQUIREMENT');
  });

  it('override 가 why 만 바꾸고 whyShort 를 주지 않으면 null(옛 요약이 새 why 와 어긋나지 않게)', () => {
    const cat = withShort((b) => {
      reqOf(b, 'pf-test', 'spinner').whyShort = '회전판 짧은 이유예요.';
    });
    // critter 는 spinner 의 why 를 덮는다(fixtures). critter-plain 은 override 없음.
    const over = resolveRequirement(cat, 'critter', 'spinner')!;
    expect(over.why).toBe('덮어쓴 이유');
    expect(over.whyShort).toBeNull();
    expect(over.provenance.whyShort).toBe('OVERRIDE');
    expect(reasonLine(over)).toBe(firstSentence('덮어쓴 이유'));
    expect(resolveRequirement(cat, 'critter-plain', 'spinner')!.whyShort).toBe('회전판 짧은 이유예요.');
  });

  it('override whyShort 는 why 와 함께든 단독이든 이긴다', () => {
    const cat = withShort((b) => {
      reqOf(b, 'pf-test', 'spinner').whyShort = '회전판 짧은 이유예요.';
      reqOf(b, 'pf-test', 'box').whyShort = '상자 짧은 이유예요.';
      const ov = critter(b).careOverrides.requirements!;
      ov.spinner = { ...ov.spinner, whyShort: '덮어쓴 짧은 이유예요.' };
      ov.box = { whyShort: '상자만 바꾼 이유예요.' };
    });
    const sp = resolveRequirement(cat, 'critter', 'spinner')!;
    expect(sp.whyShort).toBe('덮어쓴 짧은 이유예요.');
    expect(sp.provenance.whyShort).toBe('OVERRIDE');
    const bx = resolveRequirement(cat, 'critter', 'box')!;
    expect(bx.why).toBe('box 이유');
    expect(bx.whyShort).toBe('상자만 바꾼 이유예요.');
    expect(bx.provenance.whyShort).toBe('OVERRIDE');
  });

  it('override 가 why 를 바꾸지 않는 다른 키만 바꾸면 기본 whyShort 유지', () => {
    const cat = withShort((b) => {
      reqOf(b, 'pf-test', 'disc').whyShort = '원반 짧은 이유예요.';
    });
    // critter.disc override = { orderHint, notNowReason: null } — why 없음.
    const r = resolveRequirement(cat, 'critter', 'disc')!;
    expect(r.whyShort).toBe('원반 짧은 이유예요.');
    expect(r.provenance.whyShort).toBe('REQUIREMENT');
  });

  it('문자열 아닌 값(시드 validate 가 막는 형태)은 null 로 — fail-closed', () => {
    const cat = withShort((b) => {
      (reqOf(b, 'pf-test', 'box') as unknown as Record<string, unknown>).whyShort = null;
      (critter(b).careOverrides.requirements as Record<string, Record<string, unknown>>).disc.whyShort = 42;
    });
    expect(resolveRequirement(cat, 'critter-plain', 'box')!.whyShort).toBeNull();
    expect(resolveRequirement(cat, 'critter', 'disc')!.whyShort).toBeNull();
  });

  it('기본 행 whyShort 가 문자열 아님(42) → null(fail-closed), override 없는 경로·why 안 바꾸는 override 경로 모두', () => {
    const cat = withShort((b) => {
      (reqOf(b, 'pf-test', 'box') as unknown as Record<string, unknown>).whyShort = 42;
      (reqOf(b, 'pf-test', 'disc') as unknown as Record<string, unknown>).whyShort = 42;
    });
    const plain = resolveRequirement(cat, 'critter-plain', 'box')!;
    expect(plain.whyShort).toBeNull();
    expect(plain.provenance.whyShort).toBe('REQUIREMENT');
    // critter.disc override 는 why 를 바꾸지 않는다 → 기본 행 경로(42 → null).
    expect(resolveRequirement(cat, 'critter', 'disc')!.whyShort).toBeNull();
    expect(reasonLine(plain)).toBe(firstSentence(plain.why as string));
  });

  it('정렬·노출 계산은 whyShort 와 무관(표시 전용, 불변식 3)', () => {
    const base = createCatalog(makeBundle());
    const cat = withShort((b) => {
      for (const r of b.supplyRequirements) r.whyShort = '아무 짧은 이유예요.';
    });
    for (const t of ['critter', 'critter-plain']) {
      expect(listResolvedRequirements(cat, t).map((r) => r.supplyItemId)).toEqual(listResolvedRequirements(base, t).map((r) => r.supplyItemId));
    }
  });

  it('입력 레코드를 바꾸지 않는다(새 객체)', () => {
    const b = makeBundle();
    const before = JSON.stringify(b);
    resolveRequirement(createCatalog(b), 'critter', 'spinner');
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe('D9 ② reasonLine — whyShort ?? firstSentence(why)', () => {
  it('whyShort 가 있으면 그것', () => {
    expect(reasonLine({ why: '첫 문장이에요. 둘째 문장.', whyShort: '짧은 이유예요.' })).toBe('짧은 이유예요.');
  });
  it('키 부재·null·공백이면 firstSentence(why) 폴백(D9 ① 동작 보존)', () => {
    expect(reasonLine({ why: '첫 문장이에요. 둘째 문장.' })).toBe('첫 문장이에요.');
    expect(reasonLine({ why: '첫 문장이에요. 둘째 문장.', whyShort: null })).toBe('첫 문장이에요.');
    expect(reasonLine({ why: '첫 문장이에요. 둘째 문장.', whyShort: '   ' })).toBe('첫 문장이에요.');
    expect(reasonLine({ why: '' })).toBeNull();
  });
});
