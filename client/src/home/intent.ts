// 홈 A 후기 카드 행동(LinkedAction) → 선택된 동물 기준 이동 경로. 순수 함수(문서 이동은 호출부).
//   CHECKLIST  → /{slug}                 (홈 B 의 "지금 필요한 것" 레일 — L2 는 타입 데이터가 있는 문서에서만 열린다)
//   SPEC_CHECK → /{slug}/check/{itemId}  (L5 딥링크: ws-data 에 규격 필드가 있는 요구사항이 있을 때), 없으면 /{slug}
//   SETUP      → /{slug}/setup           (구성안 상세)
//   VET        → /vet                    (후기 카드가 직접 링크)
import type { LinkedAction, PublicAnimalType, WsPageData } from '@ws/engine';
import { typeHomeHref } from '../shell/shellType';

export function intentHref(action: LinkedAction, type: Pick<PublicAnimalType, 'id' | 'slug'>, page: WsPageData): string {
  const home = typeHomeHref(type);
  switch (action) {
    case 'SETUP':
      return `${home}/setup`;
    case 'SPEC_CHECK': {
      const r = page.data.requirements.find((x) => x.animalTypeId === type.id && x.item.specSchema.fields.length > 0);
      return r ? `${home}/check/${encodeURIComponent(r.supplyItemId)}` : home;
    }
    case 'VET':
      return '/vet';
    default:
      return home;
  }
}
