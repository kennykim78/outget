// 엔진 단위 테스트용 합성 카탈로그 — 실제 시드 사실과 무관(값은 임의).
//   실제 시드 기반 케이스는 engine.seed-fixtures.test.ts 에서만.
import type {
  AnimalTypeRec,
  CareProfileRec,
  CompatibilityRuleRec,
  ContentMeta,
  SeedBundle,
  SpecSchema,
  SupplyItemRec,
  SupplyRequirementRec,
} from '../../engine/types.js';

export const META: ContentMeta = {
  reviewStatus: 'DRAFT',
  reviewerType: 'AI_DRAFT',
  verifiedBy: null,
  verifiedAt: null,
  contentKind: 'SPEC',
  source: [],
};

export const BOX_SCHEMA: SpecSchema = {
  fields: [
    {
      key: 'type',
      label: '형태',
      type: 'enum',
      options: ['BOX', 'MESH_BOX', 'OTHER'],
      optionLabels: { BOX: '상자형', MESH_BOX: '망형' },
    },
    { key: 'widthCm', label: '가로(cm)', type: 'number', min: 10, max: 200 },
    { key: 'heightCm', label: '높이(cm)', type: 'number', min: 10, max: 100 },
    { key: 'gapMm', label: '간격(mm)', type: 'number', min: 1, max: 30, optional: true },
    { key: 'lid', label: '뚜껑(잠금식)', type: 'boolean', optional: true },
  ],
};

export const SPINNER_SCHEMA: SpecSchema = {
  fields: [
    { key: 'sizeCm', label: '지름(cm)', type: 'number', min: 5, max: 60 },
    { key: 'face', label: '바닥면', type: 'enum', options: ['FLAT', 'GRID'] },
    { key: 'mount', label: '설치', type: 'enum', options: ['FLOOR', 'CLIP'] },
    { key: 'quiet', label: '저소음(베어링)', type: 'boolean', optional: true },
  ],
};

function item(
  id: string,
  name: string,
  specSchema: SpecSchema,
  extra: Partial<SupplyItemRec> = {},
): SupplyItemRec {
  return {
    ...META,
    id,
    name,
    category: 'ETC',
    glyph: '·',
    lifecycle: 'DURABLE',
    specSchema,
    compatibleAlternativeIds: [],
    description: `${name} 설명`,
    ...extra,
  };
}

function req(
  careProfileId: string,
  supplyItemId: string,
  extra: Partial<SupplyRequirementRec> = {},
): SupplyRequirementRec {
  return {
    ...META,
    id: `rq-${careProfileId}-${supplyItemId}`,
    careProfileId,
    supplyItemId,
    priority: 'REQUIRED',
    orderHint: 'BEFORE_ARRIVAL',
    why: `${supplyItemId} 이유`,
    caution: null,
    avoid: null,
    minSpec: { rules: [] },
    recommendedSpec: { rules: [] },
    notNowReason: null,
    searchKeyword: null,
    ...extra,
  };
}

export function makeBundle(): Pick<
  SeedBundle,
  'animalTypes' | 'careProfiles' | 'supplyItems' | 'supplyRequirements' | 'compatibilityRules'
> {
  const supplyItems: SupplyItemRec[] = [
    item('box', '상자', BOX_SCHEMA),
    item('spinner', '회전판', SPINNER_SCHEMA, { compatibleAlternativeIds: ['disc', 'nope'] }),
    item('disc', '원반', { fields: [{ key: 'sizeCm', label: '지름(cm)', type: 'number', min: 5, max: 60 }] }),
    item('litter', '깔개', {
      fields: [
        { key: 'material', label: '재질', type: 'enum', options: ['P', 'Q', 'R'], optionLabels: { P: '종이' } },
        { key: 'scented', label: '향 첨가', type: 'boolean' },
      ],
    }),
    item('gadget', '도구', { fields: [] }),
  ];

  const careProfiles: CareProfileRec[] = [
    { ...META, id: 'pf-test', name: '테스트 프로필', taxonIds: [], facts: {}, careNotes: [] },
    { ...META, id: 'pf-other', name: '다른 프로필', taxonIds: [], facts: {}, careNotes: [] },
  ];

  // 시드 순서를 의도적으로 섞어 둔다(E8 정렬 검증).
  const supplyRequirements: SupplyRequirementRec[] = [
    req('pf-test', 'gadget', { priority: 'OPTIONAL', orderHint: 'AS_NEEDED' }),
    req('pf-test', 'litter', {
      priority: 'RECOMMENDED',
      orderHint: 'BEFORE_ARRIVAL',
      minSpec: {
        rules: [
          { key: 'material', op: 'not_in', value: ['R'], reason: '자극 성분' },
          { key: 'scented', op: 'eq', value: false, reason: '후각 자극' },
        ],
      },
      recommendedSpec: { rules: [{ key: 'material', op: 'in', value: ['P', 'Q'], reason: '굴 유지' }] },
    }),
    req('pf-test', 'box', {
      minSpec: {
        rules: [
          { key: 'widthCm', op: 'gte', value: 50, reason: '활동 공간' },
          { key: 'heightCm', op: 'gte', value: 25, reason: '설치 공간' },
          {
            key: 'gapMm',
            op: 'lte',
            value: 10,
            reason: '탈출 방지',
            when: [{ key: 'type', op: 'eq', value: 'MESH_BOX' }],
          },
        ],
      },
      recommendedSpec: { rules: [{ key: 'widthCm', op: 'gte', value: 80, reason: '여유 공간' }] },
      searchKeyword: '{animal}  큰 상자 {animal}',
    }),
    req('pf-test', 'disc', { priority: 'NOT_NOW', orderHint: 'AS_NEEDED', notNowReason: '적응 후' }),
    req('pf-test', 'spinner', {
      minSpec: {
        rules: [
          { key: 'sizeCm', op: 'gte', value: 20, reason: '등 수평' },
          { key: 'face', op: 'eq', value: 'FLAT', reason: '발 끼임 방지' },
        ],
      },
      recommendedSpec: {
        rules: [
          { key: 'sizeCm', op: 'gte', value: 25, reason: '성체 여유' },
          { key: 'quiet', op: 'eq', value: true, reason: '밤 소음' },
        ],
      },
    }),
    req('pf-other', 'box', { minSpec: { rules: [{ key: 'widthCm', op: 'gte', value: 30, reason: '공간' }] } }),
  ];

  const compatibilityRules: CompatibilityRuleRec[] = [
    {
      ...META,
      id: 'cx-spinner-box',
      a: 'spinner',
      b: 'box',
      rules: [
        { expr: 'a.sizeCm + 5 <= b.heightCm', onFail: 'BELOW_MIN', message: '회전판이 상자보다 커요.' },
        { expr: 'a.sizeCm + 10 <= b.heightCm', onFail: 'CHECK', message: '깔개를 깔면 닿을 수 있어요.' },
        {
          expr: "a.mount == 'CLIP' ? b.type == 'MESH_BOX' : true",
          onFail: 'CHECK',
          message: '걸이형은 망형 상자에만 고정돼요.',
        },
      ],
    },
    {
      ...META,
      id: 'cx-litter-box-other',
      a: 'litter',
      b: 'box',
      careProfileId: 'pf-other',
      rules: [{ expr: 'false', onFail: 'BELOW_MIN', message: '다른 프로필 전용 규칙이에요.' }],
    },
    {
      ...META,
      id: 'cx-broken',
      a: 'gadget',
      b: 'box',
      rules: [{ expr: 'a.x +', onFail: 'BELOW_MIN', message: '깨진 식이에요.' }],
    },
  ];

  const animalTypes: AnimalTypeRec[] = [
    {
      ...META,
      id: 'critter',
      group: 'SMALL_MAMMAL',
      displayName: '테스트동물',
      status: 'ACTIVE',
      aliases: ['테동'],
      taxonId: null,
      careProfileId: 'pf-test',
      careOverrides: {
        requirements: {
          spinner: {
            priority: 'RECOMMENDED',
            why: '덮어쓴 이유',
            minSpec: {
              rules: [
                { key: 'sizeCm', op: 'gte', value: 22, reason: '덮어쓴 지름' },
                { key: 'mount', op: 'eq', value: 'FLOOR', reason: '추가 규칙' },
              ],
            },
          },
          disc: { orderHint: 'FIRST_WEEK', notNowReason: null },
        },
      },
    },
    {
      ...META,
      id: 'critter-plain',
      group: 'SMALL_MAMMAL',
      displayName: '기본동물',
      status: 'ACTIVE',
      aliases: ['기동'],
      taxonId: null,
      careProfileId: 'pf-test',
      careOverrides: {},
    },
    {
      ...META,
      id: 'ghost',
      group: 'PARROT',
      displayName: '유령새',
      status: 'PLANNED',
      aliases: ['유령'],
      taxonId: null,
      careProfileId: null,
      careOverrides: {},
    },
  ];

  return { animalTypes, careProfiles, supplyItems, supplyRequirements, compatibilityRules };
}

/** 깊은 동결 — E11(입력 불변) 검증용. */
export function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
  }
  return x;
}
