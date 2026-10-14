// 홈 A 후기 카드 행동(LinkedAction) → 선택된 동물 기준 이동 경로. 순수 함수(문서 이동은 호출부).
//   CHECKLIST  → /{slug}                 (홈 B 의 "지금 필요한 것" 레일 — L2 는 타입 데이터가 있는 문서에서만 열린다)
//   SPEC_CHECK → /{slug}/check/{itemId}  (L5 딥링크: 홈 ws-data types[].specCheckItemId, 또는 규격 필드가 있는 요구사항), 없으면 /{slug}
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
      // 홈 ws-data 는 요구사항을 싣지 않고 타입별 specCheckItemId(서버가 노출 요구사항에서 파생, R6 G3b)만 싣는다.
      //   요구사항이 실린 문서(타입 페이지)면 같은 규칙(규격 필드가 있는 첫 노출 요구사항)으로 찾는다.
      const fromType = page.data.types.find((t) => t.id === type.id)?.specCheckItemId;
      const itemId =
        typeof fromType === 'string' && fromType !== ''
          ? fromType
          : page.data.requirements.find((x) => x.animalTypeId === type.id && x.item.specSchema.fields.length > 0)?.supplyItemId;
      return itemId ? `${home}/check/${encodeURIComponent(itemId)}` : home;
    }
    case 'VET':
      return '/vet';
    default:
      return home;
  }
}
