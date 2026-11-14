// R4-5 L6 등록한 케이지 보기 — 자체 최소 규격(specCheck 제품 단) vs 용품 간 호환(requirementCompat) 분리, 숫자는 해석된 minSpec·엔진 결과만.
//   가짜 엔진(합성 값 — 시드 아님)으로 매핑만 잠근다. 판정 계산 자체는 엔진 시험이 맡는다.
import { COPY, comitativeParticle, formatCopy } from '@ws/copy';
import type { Engine, PublicRequirement, SpecCheckResult, SpecSchema } from '@ws/engine';
import { describe, expect, it, vi } from 'vitest';
import { golden, req } from '../test/fixtures';
import { cageReview } from './cageReview';
import type { CageV1 } from './cageStore';

const SCHEMA: SpecSchema = {
  fields: [
    { key: 'type', label: '형태', type: 'enum', options: ['LIVING_BOX', 'WIRE', 'ACRYLIC', 'OTHER'], optionLabels: { LIVING_BOX: '리빙박스', WIRE: '철망', ACRYLIC: '아크릴', OTHER: '기타' } },
    { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
    { key: 'floorDcm', label: '바닥 세로(cm)', type: 'number', min: 20, max: 120 },
    { key: 'heightCm', label: '높이(cm)', type: 'number', min: 15, max: 100 },
  ],
};

// 합성 최소 규격(실제 기준값 아님) — 표시 숫자가 이 규칙에서만 나오는지 본다.
const cageReq: PublicRequirement = {
  ...req('cage', 'REQUIRED', '케이지'),
  minSpec: {
    rules: [
      { key: 'floorWcm', op: 'gte', value: 71, reason: 'r' },
      { key: 'floorDcm', op: 'gte', value: 41, reason: 'r' },
      { key: 'heightCm', op: 'gte', value: 31, reason: 'r' },
    ],
  },
  item: { ...req('cage', 'REQUIRED', '케이지').item, specSchema: SCHEMA },
};
const wheelReq = req('wheel', 'REQUIRED', '쳇바퀴');
const hideReq = req('hide', 'REQUIRED', '은신처');
const bathReq = req('bath', 'RECOMMENDED', '목욕 모래');
const REQS = [cageReq, wheelReq, hideReq, bathReq];

const CAGE: CageV1 = { v: 1, type: 'LIVING_BOX', floorWcm: 80, floorDcm: 45, heightCm: 33, updatedAt: '2026-11-14T00:00:00.000Z' };

function product(verdict: SpecCheckResult['product']['verdict'], reasons: SpecCheckResult['product']['reasons'] = []): SpecCheckResult['product'] {
  return { verdict, reasons };
}

function fakeEngine(p: SpecCheckResult['product'], compat: Record<string, SpecCheckResult['compat']>) {
  const specCheck = vi.fn(() => ({ verdict: p.verdict, product: p, compat: { verdict: 'NONE', reasons: [], checkedRuleIds: [] }, reasons: p.reasons, alternatives: [] }) as SpecCheckResult);
  const requirementCompat = vi.fn((_t: string, itemId: string) => {
    const c = compat[itemId];
    if (!c) throw new Error('lookup');
    return c;
  });
  return { engine: { specCheck, requirementCompat } as unknown as Pick<Engine, 'specCheck' | 'requirementCompat'>, specCheck, requirementCompat };
}

const NONE = { verdict: 'NONE', reasons: [], checkedRuleIds: [] } as SpecCheckResult['compat'];

describe('cageReview', () => {
  it('① 자체 최소 규격: 저장값만 specCheck(케이지, 사용자 컨텍스트 없음) · OK → 「{케이지} 최소 규격 충족」 ○ + minSpec 숫자', () => {
    const { engine, specCheck } = fakeEngine(product('OK'), { wheel: NONE, hide: NONE, bath: NONE });
    const r = cageReview(engine, golden.id, REQS, CAGE, golden.displayName);
    expect(specCheck).toHaveBeenCalledWith(golden.id, 'cage', { type: 'LIVING_BOX', floorWcm: 80, floorDcm: 45, heightCm: 33 });
    expect(specCheck.mock.calls[0]).toHaveLength(3); // 컨텍스트 인자 없음 — 용품 간 호환과 섞지 않는다
    expect(r.self).toEqual({
      mark: { kind: 'ok', tone: 'ready', label: COPY.verdict.markOk },
      title: formatCopy(COPY.cage.selfOk, { name: '케이지' }),
      minText: `${COPY.verdict.minSpecLabel} 71×41×31cm ${COPY.spec.gte}`,
      messages: [],
    });
    expect(r.self?.title).toBe('케이지 최소 규격 충족');
    expect(r.compat).toEqual([]); // NONE 은 그리지 않는다
  });

  it('① 최소 미달(숫자) → ✕ 「조금 작아요」 + L5 제목 + 엔진 사유', () => {
    const reasons = [{ stage: 'PRODUCT', kind: 'MIN', verdict: 'BELOW_MIN', key: 'heightCm', expected: 31, actual: 20, message: '높이 사유(합성)' }] as SpecCheckResult['product']['reasons'];
    const { engine } = fakeEngine(product('BELOW_MIN', reasons), {});
    const r = cageReview(engine, golden.id, REQS, { ...CAGE, heightCm: 20 }, golden.displayName);
    expect(r.self?.mark).toEqual({ kind: 'fail', tone: 'fail', label: COPY.verdict.markSmall });
    expect(r.self?.title).toBe(formatCopy(COPY.verdict.titleSmall, { name: '케이지' }));
    expect(r.self?.messages).toEqual(['높이 사유(합성)']);
  });

  it('② 용품 간 호환: CHECK·BELOW_MIN 만 요구사항 순서로, 제목 = 용품명+와/과, 사유 = 엔진 message, 조회 실패·OK·NONE 생략', () => {
    const { engine, requirementCompat } = fakeEngine(product('OK'), {
      wheel: { verdict: 'CHECK', reasons: [{ stage: 'COMPAT', kind: 'RULE', verdict: 'CHECK', ruleId: 'cr#0', message: '바퀴 호환 문장(합성)' }], checkedRuleIds: ['cr'] },
      hide: { verdict: 'BELOW_MIN', reasons: [{ stage: 'COMPAT', kind: 'RULE', verdict: 'BELOW_MIN', ruleId: 'cr2#0', message: '은신처 문장(합성)' }], checkedRuleIds: ['cr2'], usedRecommended: true },
      // bath: 조회 실패(throw)
    });
    const r = cageReview(engine, golden.id, REQS, CAGE, golden.displayName);
    expect(requirementCompat).not.toHaveBeenCalledWith(golden.id, 'cage', expect.anything()); // 케이지 자신은 호환 대상 아님
    expect(r.compat.map((c) => c.supplyItemId)).toEqual(['wheel', 'hide']);
    expect(r.compat[0]).toMatchObject({ title: '쳇바퀴와 함께 확인해요', mark: { kind: 'check', tone: 'check' }, messages: ['바퀴 호환 문장(합성)'], usedRecommended: false });
    expect(r.compat[1]).toMatchObject({ title: '은신처와 맞지 않는 조건이 있어요', mark: { kind: 'fail', tone: 'fail' }, usedRecommended: true });
  });

  it('케이지 요구사항이 ws-data 에 없으면 자체 판정 없음(⑦ — 노출분만)', () => {
    const { engine, specCheck } = fakeEngine(product('OK'), { wheel: NONE });
    const r = cageReview(engine, golden.id, [wheelReq], CAGE, golden.displayName);
    expect(r.self).toBeNull();
    expect(specCheck).not.toHaveBeenCalled();
  });

  it('comitativeParticle: 받침 → 과, 없음 → 와, 한글 아님 → 와(과)', () => {
    expect(comitativeParticle('쳇바퀴')).toBe('쳇바퀴와');
    expect(comitativeParticle('은신처')).toBe('은신처와');
    expect(comitativeParticle('급수기')).toBe('급수기와');
    expect(comitativeParticle('목욕 모래통')).toBe('목욕 모래통과');
    expect(comitativeParticle('A4')).toBe('A4와(과)');
  });
});
