# WithSmall 제품기획 v0.2 — 소동물 사육 준비·구매·관리 오케스트레이션

Status: **동결(Frozen) v0.2.7** — Phase 0 개발 기준. 이후 변경은 §9 백로그의 트리거 조건으로만 연다.
Date: 2026-09-30 · 이전 버전: v0.1(피벗 타당성·분양 플랫폼 안) — 본 문서가 대체
추가 아이디어 게이트: **기존 AnimalType/CareProfile + SupplyRequirement/SupplyItem + Checklist 데이터로 해결되는가?** Yes → Phase 0 검토, No → §9 백로그.
법적 서술은 리스크 분석이며 법률 자문이 아니다.

---

## 0. 한 줄 정의

**사용자용:** 작은 반려동물을 처음 준비할 때부터, 필요한 용품·사육정보·병원까지 종에 맞춰 한곳에서.
**사업용:** 종별 검수 지식을 사육 체크리스트·구매 실행·지역 서비스로 조립하는 소동물 생활 오케스트레이션 플랫폼.
**차별점:** 검색을 대신해 주는 게 아니라, **무엇을 준비해야 하고 무엇은 지금 필요 없는지를 먼저 결정해 준다.**

v0.1(분양 플랫폼)에서 바뀐 핵심: 재입양은 게시판+절차 도구로 격하하고 Phase 0에서 제외. 지도는 병원·지역 실행 도구로 축소. 진짜 경쟁자는 당근·카페가 아니라 **흩어진 검색 결과 + 쿠팡/네이버 상품 검색 경험**이다.

---

## 1. 문제 정의

초보 보호자의 문제는 정보 부족이 아니라 **정보 분산과 선택 비용**이다. 무엇이 필수인지, 어떤 규격인지, 무엇을 먼저 사야 하는지, 새것/중고 중 무엇을 고를지, 어디서 살지를 각각 검색하고 서로 다른 답 사이에서 판단해야 한다.

WithSmall의 답: **정보 → 왜 필요한가 → 어떤 규격 → 어디서 구하나 → 준비했는가**가 한 화면·한 객체(SupplyItem)에서 이어진다.

---

## 2. 구조적 불변식 (Phase와 무관하게 유지)

| # | 불변식 | 이유 |
|---|---|---|
| 1 | **상품·외부 사이트 크롤링 금지.** 가격·규격·이미지를 외부에서 자동 수집하지 않는다. 링크·검색 딥링크·제휴 API(약관 내)만 | 저작권·DB권·(카)목. Outget 불변식 승계 |
| 2 | **플랫폼은 입양자를 선별·매칭하지 않는다.** 재입양은 게시판+절차 도구까지 | 동물보호법 동물판매업 "알선·중개" 해당 리스크 |
| 3 | **최소 규격 미달 제품은 돈을 받아도 추천 영역에 넣지 않는다.** 광고·제휴는 명시 | 신뢰가 유일한 자산. 무너지면 제휴 수익도 같이 무너짐 |
| 4 | **플랫폼 자금 미보유.** 결제·에스크로 없음 | Outget 승계 |
| 5 | **의료 판단 금지.** "병원에 문의할 상황"만 제시, "괜찮다"는 판단은 쓰지 않는다 | 수의사법·책임 |
| 6 | **사육·법적 정보는 마스터 데이터가 결정.** 법적 판정은 실제 종(taxonomy) 단위, 사육 요구사항은 CareProfile 단위, 사용자 언어(AnimalType)는 접근 레이어일 뿐 — 셋을 섞지 않는다(최종값 계산은 `resolveRequirement` 한 곳 — whyShort 포함, override가 why만 바꾸면 whyShort는 비운다) | 일관성·검수 가능성·종 추가 비용 비선형화 |
| 7 | **콘텐츠는 출처·검수자 유형·검수일·상태를 갖는다.** 콘텐츠 종류별 최소 검수 등급(§7.3) 미달이면 노출 불가. AI 초안과 좋아요는 검수를 대체하지 않는다 | 먹이·규격 오류는 동물 사망으로 이어짐 |
| 8 | **실시간 위치 저장 안 함.** 시군구 텍스트 + 게시글 옵션 핀 | Outget 승계 |

**불변식 7 예외 2(Kenny 11/23·11/25, GENERAL_INFO 「일반 참고 정보」):** 코드에 고정한 6종(`hamster-robo`·`gerbil-mongolian`·`budgie`·`cockatiel`·`lovebird-peach`·`sun-conure`)의 체인 메타 네 가지(AnimalType·SupplyRequirement·SupplyItem·CareProfile)에 한해 `reviewStatus=GENERAL_INFO` 행을 검수 완료 없이 노출한다. contentKind 는 SPEC/CARE/FOOD/HEALTH 만(LEGAL 제외), FOOD/HEALTH 는 교차 확인 기록(`crossCheck`)과 출처 1곳 이상(https, Kenny 11/25: 영문 수의 기관 출처 인정 — 기관 선정은 사람이 확인)이 있어야 하고, 초안 작성일(`draftedAt`)부터 180일까지만 노출한다. 일반 참고 정보 행이 보이는 종의 종 페이지에는 「일반 참고 정보」 고지를 둔다. 상품·구성안·호환 규칙·Taxon·후기의 자체 메타는 이 등급이 될 수 없고, GENERAL_INFO 체인에 연결된 상품은 노출하지 않는다. 검수자·검수일은 비워 두며 VERIFIED 승격이 아니다. `AI_DRAFT`→VERIFIED 금지는 그대로다.

---

## 3. 제품 구조

```
                         WITHSMALL
                             │
                    Care & Supply Engine
   AnimalType(사용자 언어) → taxonomy(법) → CareProfile(사육) → SupplyRequirement → SupplyItem
                    (역방향: 용품 → 어떤 동물? → 규격 도 같은 데이터)
                             │
             ┌───────────────┼───────────────┐
           CARE            SUPPLY            VET
        Setup Checklist   규격·필요도        병원 검색(지도)
        수동 규격 확인기   새제품 검색 딥링크  진료가능 종·야간
        계절 관리(후속)    큐레이션(Phase 1)  전화·길찾기
                             │
                      [Phase 2+] MY SMALL — 준비율·소모품·생활 일정
                      [Phase 3+] 중고·나눔·구해요
                      [Phase 4+] 재입양 — 게시판 + 절차 도구
```

반복 사용의 세 순간: **첫 세팅**(1회·고구매의도) → **소모품**(반복·저단가) → **이상 징후**(비정기·고가치). Phase 0은 첫 번째만 완성한다.

---

## 4. Phase 0 확정 범위

### 4.1 포함
| 항목 | 내용 | 비고 |
|---|---|---|
| AnimalType 7~8개 | **소동물:** 골든햄스터 · 드워프계(윈터화이트·캠벨·로보로브스키·차이니즈 — 타입은 개별, 프로필은 공유) · 몽골리안저빌(별칭 "사막다람쥐") · 기니피그. **앵무:** 사랑앵무 · 왕관앵무(둘 다 CITES 제외종 → 법적 콘텐츠 부담 0). 모란·코뉴어·퀘이커(CITES II)·친칠라·토끼는 §9 | "종 수"가 목표가 아님. 목표 = **소형 설치류·소형 앵무 첫 세팅 핵심 용품 커버율 90%** |
| CareProfile 4~5개 | 대형 굴파기 설치류(골든) / 소형 굴파기 설치류(드워프·저빌) / 초식 대형 소동물(기니피그) / 소형 앵무(사랑) / 소형 볏 앵무(왕관) — **규격이 실제로 갈리는 축(체구·굴파기·단독/군집·비행)으로만** 나눔 | 종만큼 프로필을 만들면 분류군 구조로 회귀 |
| SupplyItem 15~30 + SupplyRequirement | 용품은 동물 무관 15~30개, CareProfile×용품 매핑에 priority·규격·주의·구매 순서. 종별 예외는 override | 저빌 추가 = 프로필 연결 + override 몇 개 |
| Animal Hub | `/hamster`, `/hamster/golden`, `/gerbil`, `/parrot/budgie` … — 사육·먹이·용품·병원 진입 | SEO 대상. 타입별 URL이 랜딩을 촘촘하게 |
| 용품으로 찾기 | 용품 → "어떤 친구가 쓰나요?" → 규격·필요도·주의 | SupplyRequirement 역조회, 추가 데이터 0. 이미 키우는 사용자의 진입점 |
| Setup Checklist | 2질문(처음/이미 키움 + 가진 것) → 항목 리스트. 상태 엔진 `✓준비완료 / !먼저준비 / △확인필요 / ○나중에`. 비로그인 localStorage | "필수 2개 미완료"처럼 행동 중심 표시 |
| SupplyItem | 4단계 priority(REQUIRED / RECOMMENDED / OPTIONAL / **NOT_NOW**) + 규격 + lifecycle + 출처·검수 | OPTIONAL="있으면 좋음", NOT_NOW="**지금 단계에선** 안 사도 됨"(구매 시점 판단) — `notNowReason`+`orderHint`가 함께 움직임 |
| SetupBundle(구성안) | 종별 **실속 / 균형 / 중고 활용** 3안 = SupplyItem 묶음 + 예상 총액 범위(텍스트) + 구매 순서. "이미 가진 것"은 구성에서 제외 계산 | 데이터 정의만. 실제 상품·가격 채우기는 Phase 1(§9). **"최저가"·"판매순" 표현 금지** — 가격 전수 수집 불가라 보증 못 함. 조건 명시 가능해질 때만 "검색 기준 최저가" |
| 반응 신호(좋아요) | **정보 → 👍 도움됐어요**, **상품 → ♥ 마음에 들어요**(상품은 Phase 1 CuratedProduct와 함께). 보조로 "⚠ 다시 확인해주세요". 댓글·피드·팔로우 없음 — 커뮤니티가 아니라 데이터 레이어. 익명(localStorage+IP 제한) | 용도: 재검수 우선순위(조회 多·도움 少·확인요청 多 항목부터), Supply Action 보조, 향후 상품 선호 순위. **검수 등급·규격 적합성을 대체하지 않음** |
| 수동 규격 확인기 + **호환성** | 사용자가 치수·수치 입력 → 프로필 기준 판정. **"내 케이지"(타입·바닥 치수)를 한 번 입력(localStorage)하면 이후 항목 판정이 그 컨텍스트를 참조** — 쳇바퀴 지름 vs 케이지 바닥·높이, 급수기 거치 방식 vs 케이지 타입, 은신처 vs 바닥 면적 등 규칙 3~5개 | URL 분석 아님(불변식 1). 낱개 판매하는 몰이 못 주는 "이 조합이 맞는가". 상품 간 호환은 Phase 1 |
| 새 제품 검색 딥링크 | 종 조건을 붙인 검색어 자동 생성 → 쿠팡·네이버 검색 링크. 검색 블록은 어느 화면에서나 처음부터 펼쳐 둔다(접기·펼침 버튼·더보기 없음) | 공급자 공식 제휴 링크로 바꾸는 것만 허용(같은 검색 결과 페이지·고지 필수·노출·순서 영향 0, PRD US-012). 상품 단위 제휴는 Phase 1 |
| 병원 맵 | 운영자 시드(서울·경기 우선) + 진료가능 종·야간 필터 + 전화·길찾기. 제보는 받되 검수 전 비공식 표시, 확인(VERIFIED)되지 않은 사용자 제보는 접수 후 180일 보존 뒤 삭제(처리방침 보존 기간 표에 기재) | NaverMapShell 재사용 |
| 프리렌더 SEO | 빌드 타임 정적 HTML + 하이드레이션. title/description/canonical/sitemap/robots/OG/구조화 데이터 | 프레임워크 이전 없음 |
| 최소 이벤트 | `species_selected, setup_started, item_checked, item_unchecked, setup_100_reached, spec_checker_used, external_product_clicked, vet_clicked, bundle_viewed, helpful_clicked` | 비로그인 익명 |

### 4.2 Phase 0에 없음 (§9 백로그 참조)
계정, 큐레이션 제품 단위 제휴(상품 URL·가격·판매처), 비용 계산기, My Small·리마인더·계절, 중고·나눔·구해요, 재입양, AI, 커뮤니티.

### 4.3 착수 조건
1. CareProfile별 **규격·용품 검수자**(햄스터·저빌·기니피그·소형앵무 각 1명 이상, 카페 경험 집사, `EXPERIENCED_KEEPER`) 확보. 먹이·건강 항목은 수의사 인맥 없이 **출처 등급**(§7.3)으로 푼다 — 수의사 공개 발행 자료·수의대·해외 특수동물 기관 자료 인용 없이는 노출하지 않는다. 검수자가 없으면 종 수를 줄인다.
1-1. AnimalType별 taxonomy(학명) 확정 — 법적 판정 단위. "드워프"·"코뉴어"는 종이 아니므로 하위 타입까지 내려간다.
2. 쿠팡파트너스·네이버 쇼핑커넥트 계정 신청(승인 대기 기간 고려, Phase 1 전 필요).
3. 코드 복구(§7.4) 완료 후 착수.

### 4.4 첫 검증 = 골든햄스터 + 저빌 완주
기획 논의를 더 하기보다 **골든햄스터(대형 굴파기 프로필) → SupplyItem 15개 → SupplyRequirement(priority·minSpec·NOT_NOW·orderHint) → 검수 출처 → SEO 페이지 → 체크리스트 → 규격 확인기 → 외부 검색 링크**를 끝까지 채우고, 이어서 **저빌을 소형 굴파기 프로필 연결 + override만으로** 추가해 본다. 두 번째 동물이 "프로필 재사용"으로 정말 싸게 붙는지가 이 모델의 검증이다. 어색하면 그때 고친다.

---

## 5. 데이터 모델

```
AnimalType                      ← 사용자 접근 레이어(친숙한 이름). 데이터의 축이 아님
  id, slug, displayName, aliases[]("사막다람쥐"→저빌), group(SMALL_MAMMAL|PARROT), parentTypeId?(드워프계·코뉴어계 하위)
  taxonId, careProfileId, careOverrides(JSON)   ← 종별 예외(규격·주의)만
  seoTitle, seoDescription, status(ACTIVE|PLANNED)

Taxon                           ← 실제 종. 법적 판정 단위
  id, nameSci, nameKo, rank(SPECIES|GROUP)
  legal: animalProtectionGroup(A6종|없음), wildlifeGroup, citesAppendix, whitelistListed(bool|null)
  source, verifiedAt

TaxonLegalRevision              ← 백색목록 연 갱신·CITES 개정 이력. 재입양 전까지 비워둬도 됨
  taxonId, legalGroup, citesAppendix, whitelistListed, sourceUrl, sourceTitle, verifiedAt, effectiveFrom, effectiveTo

CareProfile                     ← 사육 요구사항이 같은 묶음(분류가 아님)
  id, name(대형 굴파기 설치류 …), axes(JSON: bodySize, burrowing, social, flight, diet)
  care: housing, feeding, sociality, noise, activity (JSON, 출처 포함)
  seasonal: JSON (Phase 2)
  source[], reviewerType, verifiedBy, verifiedAt, reviewStatus

SupplyItem                      ← 용품 자체. 동물 무관
  id, category(CAGE|WHEEL|BEDDING|FOOD|WATER|HIDE|BATH|TOY|HEALTH|ETC), name, description
  lifecycle(DURABLE|CONSUMABLE), replaceCycleDays, inspectCycleDays   ← Phase 2 리마인더·점검용, 지금 채움
  compatibleAlternativeIds[]    ← "이것 대신 이걸로도 구성 가능"(기능 단위 대체안, 제품 아님)
  specSchema(JSON)              ← 이 용품의 판정 입력 필드 정의(예: 쳇바퀴 {diameterCm}, 케이지 {type, floorWcm, floorDcm, heightCm})
  source[], reviewerType, verifiedBy, verifiedAt, reviewStatus

CompatibilityRule               ← 용품 간 호환(spec-check 확장). Phase 0 규칙 3~5개
  id, careProfileId?, itemAId, itemBId, expr(JSON 규칙: A.diameterCm + margin <= B.heightCm 등)
  verdictOnFail(BELOW_MIN|CHECK), message, source, verifiedAt
  → 사용자 컨텍스트(내 케이지 등)는 localStorage `UserContext{ownedItems: {itemId: specValues}}`

SupplyRequirement               ← 핵심 객체 = CareProfile × SupplyItem
  careProfileId, supplyItemId
  priority(REQUIRED|RECOMMENDED|OPTIONAL|NOT_NOW), notNowReason
  minSpec(JSON), recommendedSpec(JSON), why, whyShort?, caution, forbidden[]
                                         ↑ 이유 한 줄(선택, 6~30자·한 문장). 없으면 화면은 why 첫 문장. careOverrides 로 덮을 수 있음
  orderHint(BEFORE_ARRIVAL|FIRST_WEEK|AFTER_ADAPTATION|AS_NEEDED)   ← NOT_NOW와 함께 구매 시점을 결정
  searchKeyword                 ← 프로필 조건 포함 자동 생성 검색어(AnimalType 이름으로 치환)
  contentKind(SPEC|CARE|FOOD|HEALTH)   ← 최소 검수 등급 결정(§7.3)
  source[], reviewerType, verifiedBy, verifiedAt, reviewStatus
  → 역조회: supplyItemId → careProfiles → animalTypes = "용품으로 찾기"

SetupBundle                     ← Phase 0 정의, Phase 1에서 상품 채움. CareProfile 단위로 정의, AnimalType 선택 시 규격 치환
  id, careProfileId, tier(BUDGET|BALANCED|USED_MIX), name(실속|균형|중고 활용), description
  items[]: {supplyItemId, note}   ← 순서 = 구매 순서
  estimatedRangeText            ← "7만 원대"(운영자 관리, 가격 데이터 미보유)
  [Phase 1] resolvedProducts[]: {supplyItemId, curatedProductId, priceAtResolve, resolvedAt}
             ← 규격 검증된 CuratedProduct 풀 안에서만 최저가/추천 조합. API 결과 직접 사용 금지(잡템 문제)

ReactionSignal                  ← 좋아요(반응 신호). 커뮤니티 아님
  targetType(SUPPLY_ITEM|GUIDE|BUNDLE|PRODUCT), targetId
  kind(HELPFUL|LIKE|RECHECK)    ← 정보=HELPFUL(👍 도움됐어요), 상품=LIKE(♥ 마음에 들어요), 보조=RECHECK(⚠ 다시 확인)
  anonKey(hash), createdAt
  → 집계 캐시: SupplyItem.helpfulCount / CuratedProduct.likeCount / *.recheckCount

상품 노출 순서(고정): ① meetsMinSpec 통과 → ② 검수 → ③ likeCount. 규격 미달은 좋아요가 많아도 추천 불가.
"WithSmall 추천"(①② 기준)과 "많이 선택한 제품"(③ 기준)은 라벨을 분리하고 한 목록에 섞지 않는다.

CuratedProduct                  ← Phase 1. 모델만 지금 생성
  id, supplyItemId, merchant, url, title, priceAtCuration, curatedAt
  specVerifiedBy, specVerifiedAt, meetsMinSpec(bool, false면 노출 불가)
  affiliateUrl, disclosure(bool), sponsored(bool), status(ACTIVE|DISCONTINUED|REVIEW)
  likeCount                     ← ReactionSignal(LIKE) 집계. 순위 3차 기준(규격·검수 다음)

VetClinic
  id, name, address, region, lat, lng, animals[], hours, nightCare, emergency
  source(SEED|USER_REPORT), verifiedAt, status(VERIFIED|REPORTED|BLINDED)

[Phase 2 예약] UserPet(userId, speciesId, name, since) · UserSetup(userPetId, supplyItemId, state, checkedAt) · CareSchedule(userPetId, kind, dueAt, done)
```

원칙: **요구 규격은 SupplyRequirement(프로필×용품)가, 제품 적합성은 CuratedProduct가, 광고 여부는 CuratedProduct의 필드가** 갖는다. CuratedProduct는 SupplyItem을 참조하되 `meetsMinSpec`은 SupplyRequirement 기준으로 프로필별 판정한다. 그 이상 과정규화하지 않는다. "Care Graph"는 개념이며 관계형 테이블로 구현한다. 새 동물 추가 비용 = AnimalType 1행 + 프로필 연결 + override — 용품 콘텐츠를 다시 쓰지 않는다.

---

## 6. UI/UX

### 6.1 IA
```
홈 ── "어떤 친구와 함께하시나요?"  [🐹 소동물] [🦜 앵무새]      + [용품으로 찾기]
 └ 2단계 ── 소동물: 골든햄스터 · 드워프계(→윈터화이트/캠벨/로보/차이니즈) · 저빌 · 기니피그 · 잘 모르겠어요
            앵무새: 사랑앵무 · 왕관앵무 · 잘 모르겠어요
    └ Animal Hub ── 준비하기(체크리스트) · 용품 · 먹이 · 병원 · [규격 확인기]
                    └ 용품 상세(프로필 규격 적용) ── 왜 / 규격 / 주의 / 피할 것 / [새 제품 찾기] [준비했어요]
용품으로 찾기 ── 용품 선택 → "어떤 친구가 쓰나요?" → 규격·필요도·주의 (이미 키우는 사용자 진입점)
병원 ── 지도 중심. 진료 동물 필터 · 야간/응급 · 전화 · 길찾기
```
탭은 **홈 · 병원** 2개로 시작. 홈에 8개 타입을 나열하지 않는다 — 그룹 2개 → 세부 타입. 채팅·마이·글쓰기 탭은 Phase 2 이후.

### 6.2 핵심 화면
- **S0 동물 선택(2단계)**: 그룹 2개 → 세부 타입 + "잘 모르겠어요"(별칭 검색: "사막다람쥐" 입력 → 몽골리안저빌로 안내). 식별 질문·특징 기반 탐색은 §9. 별칭 정정은 종 확정·법적 판정에 쓰지 않는다.
- **S0' 용품으로 찾기**: 용품 그리드 → 동물 선택 → 규격·필요도. 추가 데이터 없이 SupplyRequirement 역조회.
- **S1 Animal Hub / 체크리스트**: 상단 "오늘 바로 데려와도 되는 준비 ████░░ · 필수 2개 미완료". 2질문(처음/이미 · 가진 것)은 첫 진입에서만, 건너뛰기 가능. 항목은 필수/권장/선택/**지금 필요 없음** 4그룹. 각 카드에 `[새 제품] [가이드] [✓]`. 하단 "근처 {종} 진료 병원".
- **S2 SupplyItem 상세**: 왜 필요한가 → 확인할 것(규격) → 피해야 할 것 → 검색 딥링크(종 조건 검색어 노출: "이 조건으로 찾으세요") → 준비 완료. 마지막 검수일 작게 표시.
- **S3 규격 확인기**: 항목 선택 → 수치 입력 → `✓ 적합 / △ 권장 미달 / ✕ 최소 미달` + 이유 + 대안 안내. 단독 URL(`/species/hamster/check/wheel`)로 SEO 노출.
- **S4 병원 맵**: NaverMapShell + 리스트 토글. 제보 버튼(검수 전 "제보됨" 표시).

### 6.3 카피 원칙
- 판매·거래 대신 준비·구하기. "이건 지금 안 사셔도 됩니다"를 숨기지 않는다. 구성안은 "상품 세트"가 아니라 **"첫 환경 — 실속/균형/기존 물품 활용"**처럼 "왜 이 조합인가"가 먼저 나오는 사육 구성으로 부른다.
- 신뢰를 숫자로 만들지 않는다("정확도 98%", "전문가 4명 추천" 금지). 근거(규격·출처·검수)와 반응(👍♥⚠)만 분리해 표시.
- 규격은 수치로, 근거는 한 줄로. 의료 문구는 "병원에 문의"까지만.
- 상품 카드의 제휴·광고는 카드 안에 표시(Phase 1). 검색 딥링크 제휴(Phase 0)는 공급자 권장 문구 원문으로 검색 블록 안(상인 버튼 바로 위)과 레이어·페이지 본문 첫 부분에 고지하고, 접기·더보기·툴팁 뒤에 두지 않는다(PRD US-012).

---

## 7. 아키텍처

### 7.1 스택 결정
- 유지: 모노레포(client Vite+React PWA / server Express ESM), SQLite+Prisma(M2 Postgres), 동일 오리진 단일 컨테이너, CI compliance-scan, auth(US-025 이메일 저장용 — Phase 0 동안 운영자 경로 `/auth/login`·`/auth/refresh`·`/auth/me`·`/admin`·`/admin/*`는 외부에서 404, 이메일 저장 경로는 유지)·security-headers·rate-limit·governance·notification 모듈. chat·badge는 Phase 0 범위 밖 — R5에서 언마운트(UGC·계정 기능 도입 시 재검토).
- **SEO: 빌드 타임 프리렌더.** `/{group}/{type}`(예 `/hamster/golden`, `/gerbil`, `/parrot/budgie`), `/{group}/{type}/check/{item}`, `/supplies/{item}`, `/vet/*`를 시드 데이터에서 정적 HTML 생성 + 하이드레이션. 프레임워크 이전 없음. Express는 정적 파일 + JSON API.
- 신규 서버 모듈: `animal/`(AnimalType·Taxon·CareProfile 마스터 + 별칭 검색), `supply/`(SupplyItem·SupplyRequirement·SetupBundle·CuratedProduct), `vet/`(기존 보강), `spec-check/`(판정 로직, 순수 함수·테스트 가능), `reaction/`(ReactionSignal), `analytics/`(이벤트 수집 최소).
- 신규 클라이언트: `animal/`(2단계 선택·Hub), `supply/`(용품 상세·용품으로 찾기), `checklist/`(localStorage 스토어), `speccheck/`, `vet/`. 재사용: `map/`, `board/` 카드·바텀시트, 테마 CSS, `governance/` 신고.
- 삭제: Outget 전용 `agent request board/discount board/listings bounty groupslot shopping payment` + `adoption application`(v0.1 신청서 모델 — 불변식 2 위반) + 대응 클라이언트 폴더·테스트. `supply/`는 기존 SupplyPost(중고 게시)를 Phase 3까지 비활성.

### 7.2 규격 판정 로직
`specCheck(animalTypeId, supplyItemId, input, userContext?) → {verdict: OK|BELOW_RECOMMENDED|BELOW_MIN|CHECK, reasons[], alternatives[]}` — AnimalType → CareProfile → SupplyRequirement의 `minSpec/recommendedSpec` + `careOverrides` 병합 후 JSON 규칙(수치 비교·enum) 판정. `userContext`(내 케이지 등 보유품 규격)가 있으면 `CompatibilityRule`을 추가 평가해 "조합" 판정을 덧붙인다. 순수 함수, 서버·프리렌더 양쪽에서 같은 코드.

### 7.3 검수 워크플로 — 수의사 인맥 없이 돌아가는 구조
상태: DRAFT → NEEDS_REVIEW → VERIFIED. VERIFIED만 노출. 6개월 경과 시 NEEDS_REVIEW로 자동 강등(운영자 큐). "도움됐어요" 대비 조회가 많고 신호가 낮은 항목을 큐 상단에.

`reviewerType`: `AI_DRAFT` < `OPERATOR` < `EXPERIENCED_KEEPER` < `VET_PUBLISHED_SOURCE` < `OFFICIAL_SOURCE` / `VET`

| contentKind | 최소 검수 등급 | 비고 |
|---|---|---|
| SPEC(케이지 크기·쳇바퀴 지름·급수) | EXPERIENCED_KEEPER + OPERATOR | 카페 경험 집사 검수로 충분 |
| CARE(사육 환경·행동) | EXPERIENCED_KEEPER + 출처 1 | |
| FOOD(먹이·간식·금지 식품) | VET_PUBLISHED_SOURCE 이상 + 독립 출처 2 | 수의사 공개 자료·수의대·해외 특수동물 기관 |
| HEALTH(병원 문의 상황) | VET_PUBLISHED_SOURCE 이상 + 독립 출처 2 | "괜찮다" 판단 문구 금지(불변식 5) |

**AI의 자리:** 초안 생성·출처 수집·출처 간 모순 검출까지 — **운영자의 작업 방식이지 시스템 컴포넌트가 아니다.** Phase 0에 AI 관련 코드는 0줄이며, 시스템에 남는 것은 출처 라벨 `reviewerType=AI_DRAFT`뿐이다. `AI_DRAFT`는 어떤 contentKind에서도 VERIFIED가 될 수 없다. **예외(Kenny 11/22, 알뜰 꾸미기 팁):** `budgetTips` REFERENCE 행은 인터넷 글 링크·요약으로 검수자 없이 노출하되 참조 2곳 이상·위험 태그 주의 상자·허용 호스트 목록을 조건으로 한다(VERIFIED 승격이 아님). 출처가 서로 다르면 NEEDS_REVIEW로 올린다. 사용자 노출 추천·구성·판정은 전부 결정론적 규칙(규격 통과 → 검수 → 선호)이며 "왜 추천"을 항상 함께 보여준다 — 같은 입력이면 같은 결과, 불변식 3은 자동 테스트로 잠근다.
**사용자 반응의 자리:** 👍 도움됐어요 / ♥ 마음에 들어요 / ⚠ 다시 확인 — 세 신호뿐이며 커뮤니티 기능이 아니다. 운영자는 "조회 많음 + 도움 적음 + 확인 요청 많음" 조합으로 재검수 큐를 정렬한다. 좋아요 수는 검수 등급·규격 적합성의 근거가 아니고, "정확도 %" 같은 표현으로 바꾸지 않는다. 경험 기반 항목은 화면에 "집사 경험 기반" 배지로 구분.
**사용자에게 보이는 기준은 하나:** "WithSmall 추천" + 왜(규격 충족·검수·출처) + 반응 수. AI 개입 여부·검수자 유형은 운영 도구에서만 관리하고 화면에 4종류 기준(AI/인기/평가/전문가)을 섞어 보이지 않는다.
**수의사 검수로 가는 경로:** 병원 맵 시드 시 확인 전화 → 관계 형성 → FOOD/HEALTH 검수 요청. 인맥이 아니라 병원 데이터 작업의 부산물로 만든다.

### 7.4 복구·마이그레이션 순서
1. 미커밋 상태를 `wip/withsmall-v01` 브랜치로 커밋(보존).
2. §7.1 삭제 목록 제거 → `repos.ts`·`app.ts` 참조 정리 → `tsc` 통과.
3. Prisma 마이그레이션 히스토리 초기화(프로덕션 데이터 없음). §5 스키마 적용.
4. AnimalType·Taxon·CareProfile·SupplyItem·SupplyRequirement·VetClinic 시드 파일(JSON) + 로더. 골든햄스터 → 저빌 순(§4.4).
5. `spec-check/` 순수 함수 + 테스트.
6. 프리렌더 스크립트(`scripts/prerender.mjs`) + sitemap/robots 생성.
7. `compliance-scan.mjs` 규칙 교체: 외부 fetch 허용 호스트 0(제휴 API 도입 시 화이트리스트), 결제 코드 0, 실시간 좌표 금지, VERIFIED 아닌 콘텐츠 노출 금지 테스트.
8. CLAUDE.md 불변식을 §2로 교체, 제품명·역할 정리.
9. 클라이언트: 2탭 셸, S0→S1→S2→S3, 병원 맵.

---

## 8. 수익 모델과 지표

**공식:** `SEO 유입 × Setup 의도 × 큐레이션 전환 × 재구매`. 상한은 월 수백만 원의 니치 미디어 커머스이며 인건비 회수 모델이 아니다. 가치는 니치 미디어 자산·포트폴리오·전문몰 제휴 옵션.

| 층 | 경로 | 시점 |
|---|---|---|
| 1 | 제휴 커머스 — 첫 세팅(장바구니 10~20만 원×~3%) + 소모품 반복 | Phase 1~ |
| 2 | 전문몰·브랜드 제휴 — 규격 충족 제품 슬롯(불변식 3 적용) | Phase 1 후반 |
| 3 | 병원 로컬 광고 — 검색 결과와 분리 | Phase 2 |
| 4 | 종별·용품별·지역별 수요 데이터(비식별) | 장기 |

**North Star: Setup Completion Rate**(종 선택 후 준비 완료 도달 비율). **보조: Supply Action Rate**(준비 항목 중 외부 검색·큐레이션·중고 클릭으로 이어진 비율). 두 지표를 분리하는 이유: 체크리스트가 짧아서 쉽게 100%가 되는 것과 실제 준비 행동을 구분하기 위해. **디버깅 지표: Time to First Useful Action**(종 선택 → 첫 SupplyItem 클릭 또는 규격 확인까지 시간) — 길면 사용자가 뭘 할지 모르는 것. North Star로 올리지 않는다.
Phase 0 판단 기준: 4주 내 검색 유입 → 종 선택 → 첫 체크 전환이 보이지 않으면 콘텐츠·SEO를 먼저 고친다(기능 추가 아님).

---

## 9. 백로그 — "금지"가 아니라 "지금 범위 밖"

§2 불변식 4개(크롤링·매칭·규격미달 광고·자금 보유)와 의료 판단만 구조적 금지다. 아래는 **트리거가 충족되면 여는 것**이다.

| 항목 | 지금 안 만드는 이유 | 재검토 트리거 |
|---|---|---|
| **AnimalType 확장**: 모란앵무(복면모란 외 CITES II)·코뉴어(그린칙/썬…)·퀘이커(CITES II) / 친칠라·토끼(백색목록·6종 판정) | CITES 신고 안내 콘텐츠와 종 단위 법적 데이터가 먼저 필요 | Taxon 법적 필드 검증 + 해당 CareProfile(중형 앵무 등) 검수 완료 시. 추가 비용은 프로필 연결+override |
| 식별 도우미("잘 모르겠어요" → 특징 질문 → 후보 타입 안내) | 오인 시 법적 판정 오류 위험 | 후보 안내에만 쓰고 종 확정·법적 판정에 쓰지 않는다는 UI 원칙 확정 후 → Phase 1 |
| 종간 비교("골든 vs 로보", "사랑앵무 vs 왕관앵무") | CareProfile 2개 이상 검수 완료 필요. 순위 매기지 않음 | 프로필 4개 VERIFIED → SEO 유틸리티로 |
| 계정·My Small·소모품/계절 리마인더 | 첫 세팅이 먼저. 계정 강제는 이탈 | Setup Completion 사용자 중 재방문 의도(이벤트)가 보이면 → Phase 2 |
| 큐레이션 제품·제휴·비용 범위 | 제휴 계정 승인·검수 인력 필요 | 제휴 승인 + 종당 필수 항목 검수 완료 → Phase 1 |
| **묶음 구성안 상품 채우기**(실속/균형/많이 선택 조합) + ♥ 상품 좋아요 | 가격은 공식 API(네이버 쇼핑 검색·쿠팡파트너스)로만 — 크롤링 아님. 단 API 최저가 1위는 잡템(Outget 경험) → 규격 검증된 CuratedProduct 풀 필요 | CuratedProduct가 종당 필수 항목을 덮으면 → Phase 1. "판매순"은 API에 없어 쿠팡 베스트 카테고리로 "많이 선택" 근사만. 일괄 장바구니 딥링크 없음 → 링크 목록+총액 범위로 제공 |
| 상품 간 호환(CuratedProduct끼리) · 사용량 기반 소진 예측 · 내구재 점검 알림 | 상품 치수 데이터·사용량 입력·계정 필요 | 상품 호환은 CuratedProduct에 치수 필드가 채워지면(Phase 1); 소진·점검은 My Small과 함께(Phase 2) |
| 내 예산으로 맞추기 / 구매하지 않고 준비하기(가진 것·중고·새것 합산) | Bundle+Checklist+Priority 조합이라 데이터는 있으나 가격 데이터 필요 | CuratedProduct 가격 + 중고 게시가 있으면 → Phase 1~3 |
| 개인화 질문 확장(공간·예산) | 항목별 사이즈·가격 등급 데이터가 없음 | CuratedProduct가 등급별로 쌓이면 |
| 중고·나눔·구해요 | 양면 콜드스타트, 검수 부담 | 활성 계정이 지역 밀도를 만들면 → Phase 3. 그 전엔 당근·번개 검색 딥링크로 대체 |
| 재입양 게시판+절차 도구 | 법률 자문·백색목록 원문 확인 필요 | 자문 완료 + 종 마스터 법적 필드 검증 → Phase 4. 매칭은 영구 제외 |
| URL·이미지 상품 판정 | 크롤링 없이는 규격 추출 불가 | 제휴 API가 규격 데이터를 제공하면 |
| AI 코치(자연어 세팅) | 검증 데이터가 먼저. 추천 자체는 룰 엔진으로 충분 | CareProfile 4개 이상 VERIFIED 후. 역할은 **자연어 → 구조화 입력 번역**까지, 추천은 여전히 결정론적 엔진 |
| AI 운영 보조(초안·출처 비교·갱신 감지 자동화) | 지금은 운영자가 수작업으로 AI 활용 — 코드 불필요 | 항목 수가 수작업 한계(수백 개)를 넘으면 → Phase 2 |
| 커뮤니티 | 카페 하나 더가 됨 | 지역·거래 보완 데이터로 한정해 재검토. 피드·댓글·좋아요형은 트리거 없음 |
| 가격 비교 엔진 | 크롤링 없이 불가 | 제휴 API 가격 데이터 범위 내에서만 |

---

## 10. 미결 항목
1. 검수자 확보(§4.3-1) — 착수 조건.
2. 백색목록·CITES 원문 확인 — Phase 0 타입(사랑앵무·왕관앵무·저빌·기니피그·햄스터)은 법적 콘텐츠를 노출하지 않으므로 보류 가능. 단 저빌(모래쥐)의 백색목록 등재 여부는 Taxon에 기록. 양도·양수 신고 기한("익월 10일")은 시행규칙 확인 전 제품에 고정하지 않음.
3. 쿠팡파트너스·네이버 쇼핑커넥트 승인 및 고지 문구.
4. 병원 시드 출처: 지자체 인허가 공공데이터(진료 종 없음) + 운영자 확인 전화.
5. 브랜드: WithSmall 유지. 슬로건은 "작은 반려동물을 처음부터 제대로 준비하는 곳"으로 교체.

## 변경 이력
| 날짜 | 변경 |
|---|---|
| 2026-09-30 | v0.1(분양 플랫폼) → v0.2(사육 준비·구매·관리 오케스트레이션) 전환·동결. 재입양 격하, Phase 0 범위 확정, 데이터 모델·프리렌더·검수 워크플로·백로그 트리거 정의 |
| 2026-11-15 | **v0.2.7** — §3 데이터 모델 SupplyRequirement에 선택 칸 `whyShort`(이유 한 줄, 6~30자·한 문장, careOverrides로 덮기 가능) 추가, 불변식 ⑥ 괄호 보충(`resolveRequirement` 결합 — override가 why만 바꾸면 whyShort는 비움). DB: `SupplyRequirement.whyShort TEXT NULL`(마이그레이션 20261115000000_requirement_why_short, 추가형 1열). Kenny 승인 2026-11-15 |
| 2026-11-03 | **v0.2.6** — 법 게이트(X02)·「시행규칙 해석 전 로보 공개 불가」 폐기: 법적 의무는 위드스몰과 무관(분양·양도·매칭 안 함), 공개 차단은 검수(사실값 서명)뿐, Taxon.legal 은 null/중립·화면 법 단정 문구 없음, CITES 는 노출 조건 아님. 앵무는 크기 묶음(소·중·대) 설계 검토 중(Kenny §47) |
| 2026-11-02 | **v0.2.5** — §4.1 검색 딥링크: 공급자 공식 제휴 링크로 바꾸는 범위(같은 검색 결과 페이지·고지·노출·순서 영향 0)와 검색 블록 전부 펼침(제휴 여부 무관), 병원 맵 제보 보존 180일. §4.2 Phase 0 제외를 「큐레이션 제품 단위 제휴」로 좁힘. §6.3 검색 딥링크 제휴 고지(검색 블록 안 + 본문 첫 부분, 접기 금지). §7.1 Phase 0 운영자 경로 외부 404(Kenny 결정 2026-10-27·2026-11-02) |
| 2026-10-02 | **v0.2.4** — §7.1 유지 목록에서 chat·badge를 "Phase 0 범위 밖 — R5에서 언마운트(UGC·계정 기능 도입 시 재검토)"로 정정, auth는 US-025 이메일 저장용으로 유지(Kenny 결정) |
| 2026-09-30 | **v0.2.3** — 호환성(CompatibilityRule) 추가: "내 케이지" 컨텍스트 기반 용품 간 조합 판정을 규격 확인기에 확장(Phase 0 규칙 3~5개), `specSchema`·`inspectCycleDays` 필드, 구성안 카피 원칙("상품 세트" 아님·신뢰 수치화 금지). 상품 간 호환·소진 예측·점검 알림은 §9 |
| 2026-09-30 | **v0.2.2** — "Species 3종" 폐기. 데이터 축을 `AnimalType(사용자 언어) → Taxon(법) → CareProfile(사육) → SupplyRequirement → SupplyItem`으로 교체(Care & Supply Engine). 종 추가 비용 비선형화, "용품으로 찾기" 역방향 진입, 2단계 동물 선택 + 별칭("사막다람쥐"→저빌). Phase 0 타입 7~8개(햄스터 5·저빌·기니피그·사랑앵무·왕관앵무), CareProfile 4~5개, 목표 지표를 종 수→핵심 용품 커버율로. 모란·코뉴어·퀘이커·친칠라·토끼·식별 도우미·종간 비교는 §9 |
| 2026-09-30 | **v0.2.1** — SetupBundle(실속/균형/중고 활용 구성안, Phase 0 정의·Phase 1 상품 채움; "최저가·판매순" 표현 금지) 추가. 수의사 인맥 없는 검수 구조: reviewerType 등급 + contentKind별 최소 등급, AI=초안/출처/모순 검출. 좋아요는 커뮤니티가 아닌 반응 신호로 Phase 0 포함 — 정보 👍 도움됐어요 / 상품 ♥ 마음에 들어요(Phase 1) / ⚠ 다시 확인, 노출 순서 규격→검수→선호 고정. 앵무 종명 확정 조건, alternativeIds, NOT_NOW·orderHint 의미 고정, TTFUA 디버깅 지표, 추가 아이디어 게이트 문구 |
