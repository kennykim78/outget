// 홈 A 「처음 준비, 여기서 시작해요」 시작 카드 3(R3 시안 v1b, 286 U3b). RailSection kind=starter layout=grid3
//   (≥768 3열 그리드 / ≤767 가로 레일 peek — CSS). 카드 = li > a.ws-starter(사진 자리 + 제목·화살표 + 한 줄). 카드 안 카드·상태 칩·수치 없음.
//   문구는 @ws/copy 고정 UI 문구(종 공통, 품목명·숫자 없음). 노출 판정·순서는 서버 misc.ts starterActions 와 같은 규칙(fail-closed, D12 ①).
//   이동: 선택된 동물이 있으면 href = intentHref(대상 직행), 없으면 href=/pick(정적과 같음) + 일반 클릭은 L1 열고 의도 보존(onIntent).
//   서버 프리렌더 server/src/prerender/pages/misc.ts homeStarters 와 같은 태그·클래스(parity 시험 2종).
import type { PublicAnimalType, PublicHomeScenes, WsPageData } from '@ws/engine';
import { COPY } from '@ws/copy';
import { PICK_PATH, pickLinkClick } from '../shell/pickLink';
import PhotoTile from '../ui/PhotoTile';
import RailSection from '../ui/RailSection';
import { PickBarArrow } from './Hero';
import { intentHref } from './intent';

export const STARTER_ACTIONS = ['CHECKLIST', 'SPEC_CHECK', 'SETUP'] as const;
export type StarterAction = (typeof STARTER_ACTIONS)[number];

/** 카드 → 대표 타입 homeScenes 키(서버 misc.ts STARTER_SCENE 와 같은 표). 사진 id 는 ws-data 값만(359 D-3 — 장면 허용 종이 아니면 키 0 → 빈 블록). */
const STARTER_SCENE: Record<StarterAction, keyof PublicHomeScenes> = { CHECKLIST: 'startChecklist', SPEC_CHECK: 'startSpecCheck', SETUP: 'startSetup' };

/** 노출 카드 — 노출 타입 0 이면 없음, 대상이 하나도 없는 카드는 빠진다(서버 starterActions 와 같은 규칙). */
export function starterActions(types: WsPageData['data']['types']): StarterAction[] {
  if (types.length === 0) return [];
  return STARTER_ACTIONS.filter((x) =>
    x === 'SPEC_CHECK'
      ? types.some((t) => typeof t.specCheckItemId === 'string' && t.specCheckItemId !== '')
      : x === 'SETUP'
        ? types.some((t) => t.setupAvailable === true)
        : true,
  );
}

export interface StartCardsProps {
  page: WsPageData;
  /** 저장된 동물(data.types 안) — 있으면 카드가 대상으로 직접 링크. */
  selected: PublicAnimalType | null;
  /** 미선택 일반 클릭 — L1 을 열고 의도를 보존한다(HomeA). */
  onIntent(action: StarterAction): void;
}

export default function StartCards({ page, selected, onIntent }: StartCardsProps) {
  const acts = starterActions(page.data.types);
  if (acts.length === 0) return null;
  const scenes = page.data.types[0]?.homeScenes;
  return (
    <RailSection id="starters" kind="starter" layout="grid3" title={COPY.homeA.startersTitle} prevLabel={null} nextLabel={null}>
      {acts.map((x) => {
        const c = COPY.homeA.starters[x];
        return (
          <li key={x} className="ws-starter-item">
            <a
              className="ws-starter"
              data-ws-action="start-card"
              data-ws-intent={x}
              href={selected ? intentHref(x, selected, page) : PICK_PATH}
              onClick={selected ? undefined : pickLinkClick(() => onIntent(x))}
            >
              <PhotoTile photo={scenes?.[STARTER_SCENE[x]]} className="ws-starter-photo" />
              <span className="ws-starter-head">
                <span className="ws-t-cta ws-starter-title">{c.title}</span>
                <span className="ws-starter-go">
                  <PickBarArrow />
                </span>
              </span>
              <span className="ws-t-meta ws-muted ws-starter-sub">{c.sub}</span>
            </a>
          </li>
        );
      })}
    </RailSection>
  );
}
