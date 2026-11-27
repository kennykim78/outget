# 393. 출처 8행 대조 결과 (총괄 위임, ORDERS 11/27 13:00)

- 판정: Codex `aux/codex/withsmall/261127_1301_src8-verify.md` (인용문 대조). 8행 모두 축소·삭제 대상.
- 적용: server/seed · seed-draft `supply-requirements.json` 동일. 삭제·축소만, 새 숫자 0. reviewStatus·source·crossCheck(11/23, 축소 전 문구 기준) 그대로.
- PM 추가 원문 확인(11/27 curl, VCA lovebirds-feeding V3): "The recommended diet for lovebirds is pelleted food formulated for birds." · "Seeds should only be a very small part of a balanced diet but should never be the majority of the diet." · "slowly weaned off seeds onto a pelleted diet."
  → 소형 사료 why 는 Codex 의 「사랑앵무」 좁히기 대신 「소형 앵무」 유지(V2+V3). forSize 이유는 V3 에 크기 문장이 없어 사랑앵무로 좁힘.

| 행 | 판정 → 처리 (고친 문구) | 출처 |
|---|---|---|
| req-robo-food | why 약함 → 「펠릿을 기본으로 해요. 씨앗 한 종류만 주지 않아요.」 (「햄스터용 주식」 삭제, [총괄] 판단) · caution·avoid 지지 | H1·V1 |
| req-robo-scale (숨김) | why 약함 → 「로보의 체중 감소를 살펴요.」 · 「낮은 위치에서 통에…」 없음 → 삭제 | H2 |
| req-parrot-small-bird-food | why → 「소형 앵무에게 맞는 주식을 준비해요. 씨앗만으로 식단을 채우지 않고 펠릿을 활용해요.」(채소 삭제) · caution 「실제로 먹는지」 삭제 · form 이유 → 「조류용 펠릿을 권해요.」 · forSize → 「사랑앵무에게는 소형 조류용 펠릿을 권해요.」 · avoid 지지 | V2·V3 |
| req-parrot-small-mineral | why → 「모든 새에게 별도로 필요한 것은 아니에요.」 · caution → 「보충제는 병원과 상의해요.」 · avoid 지지 | B2·V2·V3 |
| req-parrot-small-scale (숨김) | why → 「몸무게 변화를 살펴요.」 · resolutionG 1g 규격·이유 삭제 · 검색어 「1g」 삭제 | B3·V2 |
| req-parrot-medium-bird-food | why → 「앵무용 주식을 중심으로 제공해요. 씨앗만 주는 식단은 피해요.」 · caution → 「새 먹이는 천천히 익숙하게 해요.」+병원 문장 · form 이유 → 「조류용 주식 펠릿을 권해요.」 · avoid 지지 | V4·V5·V2·M1 |
| req-parrot-medium-mineral | why 두 문장 약함/없음 → 칸 필수라 같은 출처(B2, 이 행 source)가 지지한 「모든 새에게 별도로 필요한 것은 아니에요.」 · caution 영양 성분·겹쳐 쓰기 삭제 · avoid → 「썬코뉴어에게 소화용 모래나 자갈을 상시 먹이는 방식」 | B2·V4·V5 |
| req-parrot-medium-scale (숨김) | why → 「체중 변화를 살펴요.」 · 1g 규격·이유·검색어 삭제 | B3 |

## 남긴 숙제
- 저울(scale) 공개 전: 로보·중형 저울 「통/받침 무게」 안내가 없어 통째 값을 몸무게로 오해할 수 있음(현재 노출 0).
- 「갑오징어뼈」는 mineral 검색어·용품 설명에 남음(8행 범위 밖).
