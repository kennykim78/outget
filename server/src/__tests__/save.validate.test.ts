// B1-3 SaveV1 검증기(계약 C-R5-2): 엄격 스키마(알 수 없는 키 거부), 깊은 금지 키, 개수 상한, ≤32KB.
import { describe, expect, it } from 'vitest';
import {
  SAVE_FORBIDDEN_KEYS,
  SAVE_MAX_BYTES,
  findForbiddenKey,
  validateSaveV1,
} from '../save/validate.js';
import { ISO, sampleSave, type LooseSave } from './fixtures/save-sample.js';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('validateSaveV1 — 정상', () => {
  it('계약 예시 통과, 정규화 결과 = 입력', () => {
    const r = validateSaveV1(sampleSave());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(sampleSave());
  });

  it('빈 상태(animalTypeId null, 빈 레코드, reactions.updatedAt null) 통과', () => {
    const r = validateSaveV1({ v: 1, animalTypeId: null, setups: {}, cages: {}, reactions: { like: {}, helpful: {}, updatedAt: null } });
    expect(r.ok).toBe(true);
  });

  it('WIRE 아닌 케이지는 barGapMm 없이 통과', () => {
    const s = sampleSave();
    (s.cages as Record<string, Record<string, unknown>>)['hamster-golden'] = {
      v: 1, type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: ISO,
    };
    expect(validateSaveV1(s).ok).toBe(true);
  });
});

describe('validateSaveV1 — 거부', () => {
  const bad: Array<[string, (s: LooseSave) => void]> = [
    ['v ≠ 1', (s) => { s.v = 2; }],
    ['알 수 없는 최상위 키', (s) => { s.extra = 1; }],
    ['recheck 포함(D22 제외 대상)', (s) => { s.reactions.recheck = {}; }],
    ['typeId 슬러그 아님', (s) => { s.setups['Hamster Golden'] = s.setups['hamster-golden']; }],
    ['animalTypeId 슬러그 아님', (s) => { s.animalTypeId = '../x'; }],
    ['setup v ≠ 2', (s) => { s.setups['hamster-golden'].v = 1; }],
    ['setup 알 수 없는 키', (s) => { s.setups['hamster-golden'].note = 'x'; }],
    ['check source 미지', (s) => { s.setups['hamster-golden'].checks.cage.source = 'BOUGHT'; }],
    ['ISO 아닌 시각', (s) => { s.setups['hamster-golden'].updatedAt = 'yesterday'; }],
    ['cage type 미지', (s) => { s.cages['hamster-golden'].type = 'GLASS'; }],
    ['cage 음수', (s) => { s.cages['hamster-golden'].floorWcm = -1; }],
    ['cage 문자열 숫자', (s) => { s.cages['hamster-golden'].heightCm = '35'; }],
    ['cage 과대', (s) => { s.cages['hamster-golden'].floorDcm = 100000; }],
    ['barGapMm 는 WIRE 만', (s) => { s.cages['hamster-golden'].type = 'ACRYLIC'; }],
    ['helpful 키 형식', (s) => { s.reactions.helpful = { wheel: ISO }; }],
    ['like 키 슬러그 아님', (s) => { s.reactions.like = { 'P!': ISO }; }],
    ['배열 최상위', (s) => { Object.keys(s).forEach((k) => delete s[k]); }],
  ];
  for (const [name, mutate] of bad) {
    it(name, () => {
      const s = clone(sampleSave()) as LooseSave;
      mutate(s);
      expect(validateSaveV1(s).ok).toBe(false);
    });
  }

  it('null·배열·원시값 거부', () => {
    for (const x of [null, [], 1, 'x', undefined]) expect(validateSaveV1(x).ok).toBe(false);
  });

  it('타입 21개 → 거부(≤20)', () => {
    const s = clone(sampleSave()) as LooseSave;
    const one = s.setups['hamster-golden'];
    s.setups = {};
    for (let i = 0; i < 21; i++) s.setups[`t-${i}`] = one;
    expect(validateSaveV1(s).ok).toBe(false);
    delete s.setups['t-20'];
    expect(validateSaveV1(s).ok).toBe(true);
  });

  it('checks 201개 → 거부(≤200)', () => {
    const s = clone(sampleSave()) as LooseSave;
    const checks: Record<string, unknown> = {};
    for (let i = 0; i < 201; i++) checks[`i-${i}`] = { source: 'UNKNOWN', at: ISO };
    s.setups['hamster-golden'].checks = checks;
    expect(validateSaveV1(s).ok).toBe(false);
    delete checks['i-200'];
    expect(validateSaveV1(s).ok).toBe(true);
  });
});

// F 계약 SetupV3: v2 필드 의미·형 그대로 + uncheckedAt(id → ISO) + v:3. setups 는 v2|v3 혼재 수용.
const ISO2 = '2026-10-04T05:06:07.008Z';
function v3Setup(): LooseSave {
  return {
    v: 3,
    firstTime: true,
    owned: ['cage', 'wheel'],
    answeredAt: ISO,
    startedAt: ISO,
    checks: { cage: { source: 'OWNED', at: ISO }, bedding: { source: 'PURCHASED', at: ISO } },
    uncheckedAt: { wheel: ISO2 },
    reached100At: null,
    updatedAt: ISO2,
  };
}
function v3Save(): LooseSave {
  const s = clone(sampleSave()) as LooseSave;
  s.setups['hamster-golden'] = v3Setup();
  return s;
}

describe('SetupV3(uncheckedAt) — F 계약', () => {
  it('v3 통과, 정규화 결과 = 입력', () => {
    const r = validateSaveV1(v3Save());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(v3Save());
  });

  it('빈 uncheckedAt 통과', () => {
    const s = v3Save();
    s.setups['hamster-golden'].uncheckedAt = {};
    expect(validateSaveV1(s).ok).toBe(true);
  });

  it('v2 계속 통과, v2·v3 혼재 통과(각자 형 그대로 보존)', () => {
    expect(validateSaveV1(sampleSave()).ok).toBe(true);
    const s = v3Save();
    s.setups['rabbit'] = clone((sampleSave() as LooseSave).setups['hamster-golden']);
    const r = validateSaveV1(s);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.setups['rabbit'].v).toBe(2);
      expect('uncheckedAt' in r.value.setups['rabbit']).toBe(false);
      expect(r.value.setups['hamster-golden'].v).toBe(3);
      expect(r.value).toEqual(s);
    }
  });

  it('같은 id 가 checks·uncheckedAt 에 동시 존재 — 허용(병합 정리 전 일시 상태, 판정은 클라 몫)', () => {
    const s = v3Save();
    s.setups['hamster-golden'].uncheckedAt = { cage: ISO2 };
    const r = validateSaveV1(s);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(s);
  });

  it('uncheckedAt 201개 → invalid_snapshot, 200개 → 통과(checks 와 합산 아님)', () => {
    const s = v3Save();
    const u: Record<string, string> = {};
    const c: Record<string, unknown> = {};
    for (let i = 0; i < 201; i++) u[`u-${i}`] = ISO;
    for (let i = 0; i < 200; i++) c[`c-${i}`] = { source: 'UNKNOWN', at: ISO };
    s.setups['hamster-golden'].uncheckedAt = u;
    s.setups['hamster-golden'].checks = c;
    expect(validateSaveV1(s)).toEqual({ ok: false, error: 'invalid_snapshot' });
    delete u['u-200'];
    expect(validateSaveV1(s).ok).toBe(true); // checks 200 + uncheckedAt 200
  });

  it('uncheckedAt 금지 키(레코드 키·대소문자 무시) → forbidden_key', () => {
    for (const k of ['email', 'Region', 'TOKEN']) {
      const s = v3Save();
      s.setups['hamster-golden'].uncheckedAt = { [k]: ISO };
      expect(validateSaveV1(s), k).toEqual({ ok: false, error: 'forbidden_key' });
    }
  });

  const badV3: Array<[string, (u: LooseSave) => void]> = [
    ['uncheckedAt 값 비ISO', (u) => { u.uncheckedAt = { wheel: 'yesterday' }; }],
    ['uncheckedAt 값 오프셋 표기(Z 아님)', (u) => { u.uncheckedAt = { wheel: '2026-10-03T01:02:03+09:00' }; }],
    ['uncheckedAt 값 숫자', (u) => { u.uncheckedAt = { wheel: 1 }; }],
    ['uncheckedAt 값 null', (u) => { u.uncheckedAt = { wheel: null }; }],
    ['uncheckedAt 키 슬러그 아님', (u) => { u.uncheckedAt = { 'Wheel X': ISO }; }],
    ['uncheckedAt 배열', (u) => { u.uncheckedAt = [ISO]; }],
    ['uncheckedAt null', (u) => { u.uncheckedAt = null; }],
    ['v3 인데 uncheckedAt 없음', (u) => { delete u.uncheckedAt; }],
    ['v2 인데 uncheckedAt 있음', (u) => { u.v = 2; }],
    ['v3 알 수 없는 키', (u) => { u.note = 'x'; }],
    ['v = 4', (u) => { u.v = 4; }],
    ['v3 startedAt null(v2 형 유지)', (u) => { u.startedAt = null; }],
  ];
  for (const [name, mutate] of badV3) {
    it(`거부: ${name} → invalid_snapshot`, () => {
      const s = v3Save();
      mutate(s.setups['hamster-golden']);
      expect(validateSaveV1(s)).toEqual({ ok: false, error: 'invalid_snapshot' });
    });
  }

  it('32KB 경계 유지 — v3 정규화 결과가 32KB 초과면 invalid_snapshot', () => {
    // 개수 상한 안(uncheckedAt 200/타입)이어도 정규화 결과 바이트가 32KB 를 넘으면 막힌다.
    const s = v3Save();
    const u: Record<string, string> = {};
    for (let i = 0; i < 200; i++) u[`item-${'x'.repeat(40)}-${i}`] = ISO;
    for (let t = 0; t < 5; t++) s.setups[`t-${t}`] = { ...v3Setup(), uncheckedAt: u };
    const bytes = Buffer.byteLength(JSON.stringify(s), 'utf8');
    expect(bytes).toBeGreaterThan(SAVE_MAX_BYTES);
    expect(validateSaveV1(s)).toEqual({ ok: false, error: 'invalid_snapshot' });
    // 한 타입만이면 32KB 이하 → 통과
    const one = v3Save();
    one.setups['hamster-golden'].uncheckedAt = u;
    expect(Buffer.byteLength(JSON.stringify(one), 'utf8')).toBeLessThanOrEqual(SAVE_MAX_BYTES);
    expect(validateSaveV1(one).ok).toBe(true);
  });
});

describe('깊은 금지 키', () => {
  it('계약 금지 키 포함(email·lat·lng·region·token·sid 등)', () => {
    for (const k of ['email', 'lat', 'lng', 'region', 'token', 'sid', 'gps', 'sigungu', 'password', 'q', 'address', 'phone']) {
      expect(SAVE_FORBIDDEN_KEYS.has(k)).toBe(true);
    }
  });

  it('어느 깊이든(레코드 키 포함·대소문자 무시) 금지 키를 찾는다', () => {
    expect(findForbiddenKey({ a: { b: [{ c: { Email: 'x' } }] } })).toBe('email');
    expect(findForbiddenKey({ setups: { region: {} } })).toBe('region');
    expect(findForbiddenKey(sampleSave())).toBeNull();
  });

  it('validateSaveV1 은 금지 키를 forbidden_key 로 거부(레코드 키로 숨겨도)', () => {
    const s = clone(sampleSave()) as LooseSave;
    s.setups.email = s.setups['hamster-golden'];
    const r = validateSaveV1(s);
    expect(r).toEqual({ ok: false, error: 'forbidden_key' });
  });

  it('과도한 중첩은 거부(스택 보호)', () => {
    let x: unknown = 1;
    for (let i = 0; i < 5000; i++) x = [x];
    expect(validateSaveV1({ ...sampleSave(), deep: x }).ok).toBe(false);
  });
});

it('SAVE_MAX_BYTES = 32KB', () => {
  expect(SAVE_MAX_BYTES).toBe(32 * 1024);
});

// R-1: 금지 키 단일 소스(server/src/shared/forbidden-keys.ts) — 목록의 모든 키가 서버 검증기를 막는다.
describe('공용 금지 키 목록 전수(R-1)', () => {
  it('서버 검증기 집합 = 공용 집합(같은 객체), 30개, 소문자·중복 없음', async () => {
    const shared = await import('../shared/forbidden-keys.js');
    expect(SAVE_FORBIDDEN_KEYS).toBe(shared.FORBIDDEN_KEYS);
    expect(shared.FORBIDDEN_KEY_LIST).toHaveLength(30);
    expect(new Set(shared.FORBIDDEN_KEY_LIST).size).toBe(30);
    for (const k of shared.FORBIDDEN_KEY_LIST) expect(k).toBe(k.toLowerCase());
    expect(Object.isFrozen(shared.FORBIDDEN_KEY_LIST)).toBe(true);
  });

  it('isForbiddenKey: 정확 일치·대소문자 무시(부분 문자열 아님)', async () => {
    const { isForbiddenKey } = await import('../shared/forbidden-keys.js');
    expect(isForbiddenKey('IP')).toBe(true);
    expect(isForbiddenKey('UserAgent')).toBe(true);
    expect(isForbiddenKey('quote')).toBe(false);
    expect(isForbiddenKey('zipper')).toBe(false);
  });

  it('목록의 모든 키 — 레코드 키·중첩 키·대문자로 넣으면 forbidden_key', async () => {
    const { FORBIDDEN_KEY_LIST } = await import('../shared/forbidden-keys.js');
    for (const key of FORBIDDEN_KEY_LIST) {
      const asRecord = clone(sampleSave()) as LooseSave;
      asRecord.cages[key] = asRecord.cages['hamster-golden'];
      expect(validateSaveV1(asRecord), `record ${key}`).toEqual({ ok: false, error: 'forbidden_key' });
      const nested = clone(sampleSave()) as LooseSave;
      nested.setups['hamster-golden'].checks.cage[key.toUpperCase()] = 1;
      expect(validateSaveV1(nested), `nested ${key}`).toEqual({ ok: false, error: 'forbidden_key' });
    }
  });
});
