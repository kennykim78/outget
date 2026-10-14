# WithSmall — 제품 요구사항 정의서 (PRD) v1.0 · Phase 0

| 항목 | 값 |
|---|---|
| 제품 | **WithSmall(위드스몰)** — 소동물 사육 준비·구매·관리 오케스트레이션 |
| 버전 | **v1.3.1** (UX v2.3 연동: 검증 후기·저장 유도 2곳·L3 전 숫자 비노출) |
| 상태 | Confirmed — 개발 착수 기준. 변경은 §14 규칙으로만 |
| 최종수정 | 2026-09-30 |
| 입력 캐논 | [WithSmall-제품기획-v0.2.md](../WithSmall-제품기획-v0.2.md) v0.2.3 (동결) — 제품 정의·불변식·데이터 모델·백로그의 권위. 본 PRD는 그것을 스토리·수용 기준·QA 기준으로 내린 문서 |
| 범위 | **Phase 0만.** 큐레이션 제품은 발견만, 계정은 이메일 링크 저장만(US-025). 제휴·중고·재입양·AI 사용자 기능·커뮤니티 없음 |
| 이전 PRD | Outget PRD v0.2 → `docs/legacy/outget/` 보존 |

> 법적 서술은 리스크 분석이며 법률 자문이 아니다. AI는 Phase 0에 사용자 기능·시스템 컴포넌트로 존재하지 않는다.

---

## 0. 목적과 성공 정의

Phase 0가 답해야 할 질문 하나:

> **"사용자가 동물을 선택했을 때, WithSmall이 무엇을 준비해야 하는지 행동 수준으로 정리해 주고, 그 결과가 제품 검색과 병원 이용까지 이어지는가?"**

기능적 성공 = 다음 루프가 골든햄스터 1종으로 끝까지 작동하고, 몽골리안저빌이 CareProfile 재사용 + override만으로 붙는다.

```
SEO 유입 → 동물 선택 → CareProfile 결정 → Setup Checklist → 용품 상세 → 규격 확인(+내 케이지 호환)
        → 외부 검색 → 근처 병원
```

가설: 사용자는 "햄스터 용품"을 검색할 때보다 "지금 무엇을 준비해야 하는지"가 먼저 정리됐을 때 더 빨리 구매 행동으로 간다.

**Phase 0 완료 조건(§13)**은 "타입 7개"가 아니라 **골든햄스터·저빌 VERIFIED 완주 + 기능 전부 + 품질 게이트**다. 나머지 타입은 검수 완료에 따라 `PLANNED → ACTIVE`로 순차 공개.

---

## 1. 범위

### 1.1 포함
| 영역 | 내용 |
|---|---|
| 동물 | **초기 지원 AnimalType = 다음 목록 전부**(숫자 아님): 골든햄스터 · 윈터화이트 · 캠벨 · 로보로브스키 · 차이니즈 · 몽골리안저빌 · 기니피그 · 사랑앵무 · 왕관앵무. `ACTIVE` 여부는 검수 상태로만 결정(완주 기준은 골든햄스터+저빌, 나머지 `PLANNED`). CareProfile 4~5, 별칭("사막다람쥐"→저빌) |
| 코어 | **발견형 홈**(히어로·지금 필요한 것·구성안·기준에 맞는 준비물·병원 레일) · Setup Checklist(레이어, 2질문·상태 엔진·localStorage) · SupplyItem/SupplyRequirement · SetupBundle 정의 · 수동 규격 확인기 · 내 케이지 컨텍스트 + CompatibilityRule 3~5 · 외부 검색 딥링크 · 용품으로 찾기 |
| 상품(발견만) | **CuratedProduct**: 운영자 큐레이션 대표 상품(항목당 1~3, 이미지·상품명·규격 한 줄·✓ 기준 충족·추천 이유 자동 조립) + **♥ 마음에 들어요**. 가격·판매처·제휴 URL·구매 표현은 없음(Phase 1) |
| 지역 | 병원 맵(시드 + 제보, 검수 전 비공식) |
| 획득 | 빌드 타임 프리렌더 SEO |
| 신호 | 👍 도움됐어요 / ⚠ 다시 확인 / ♥ 마음에 들어요(익명). ♥ 숫자는 임계치(10) 이상일 때만 표시 |
| 운영 | 시드 JSON 기반 콘텐츠 입력 + 검수 상태 워크플로 + 최소 이벤트 |

### 1.2 제외 (v0.2.3 §9 백로그 — 트리거 충족 시에만)
비밀번호·소셜 로그인·프로필·여러 마리 관리(My Small) · 소모품/계절 리마인더 · 상품 가격·판매처·제휴 링크·구매 버튼 · 묶음 상품 자동 채우기 · 중고/나눔/구해요 · 재입양 · AI 사용자 기능 · 커뮤니티/댓글 · 상품 URL/이미지 판정 · 예산 등 추가 개인화 질문 · 식별 도우미 · 종간 비교.

---

## 2. 사용자와 성공 행동

| 페르소나 | 상황 | 성공 행동 |
|---|---|---|
| A 처음 키움 | "햄스터를 처음 키우는데 뭐부터?" | 동물 선택 → 필수 항목 이해 → 체크 → 외부 검색 클릭 |
| B 이미 키움 | "케이지·물통은 있는데 나머지는?" | 보유품 제외 → 남은 항목만 봄 → 내 케이지 등록 → 호환 판정 |
| C 특정 용품 | "쳇바퀴 몇 cm 사야 하지?" | 용품으로 찾기 → 동물 선택 → 규격 → 판정 |
| D 병원 | "햄스터 진료 되는 병원이 어디?" | 동물 → 병원 → 지역 → 전화/길찾기 |

---

## 3. 에픽 구조

```
EPIC-01 진입 · 동물 선택          EPIC-07 외부 검색 실행
EPIC-02 Animal Hub               EPIC-08 병원
EPIC-03 Setup Checklist          EPIC-09 반응 신호
EPIC-04 용품 상세 · 용품으로 찾기  EPIC-10 SEO · 프리렌더
EPIC-05 규격 확인기              EPIC-11 콘텐츠 운영 · 검수
EPIC-06 내 케이지 · 호환성        EPIC-12 기반 · 품질 게이트
```

수용 기준 표기: `[ ]` 체크박스 = QA 게이트 항목. **모든 스토리 공통**: 비로그인 동작, **반응형 3단**(모든 폭에서 같은 상하 흐름·상단 글로벌 헤더, 넓어지면 레일 카드 수만 증가, 레이어는 ≤767 바텀시트 / ≥768 모달·드로어, UX v2.0 §2.3 — 좌측 레일·고정 패널·2열 CRM 구조 금지) — 360~1440px 가로 스크롤 0, 같은 URL·같은 마크업을 CSS로 재배치, 폭별 전용 기능 없음. 시각은 **WithSmall Design System v1.1** 토큰만(흰 바탕, 단일 라이트 테마, `color-scheme: light` 고정, Outget 토큰 사용 금지). AA 대비, 이벤트는 §11 스키마.

---

## 4. EPIC-01 진입 · 동물 선택

### US-001 그룹 → 세부 타입 2단계 선택
As 신규 사용자, I want 키우는 동물을 두 번의 선택으로 고르고, so that 그 동물에 맞는 준비 정보를 본다.
- [ ] 미선택 홈 구성은 US-026을 따른다(타입 8개를 홈에 나열하지 않음).
- [ ] 그룹 선택 후 `status=ACTIVE`인 AnimalType만 카드로 노출. `PLANNED`는 "준비 중" 배지로 비활성 노출(클릭 불가).
- [ ] 드워프계(윈터화이트·캠벨·로보·차이니즈)는 "드워프 햄스터" 하위로 접혀 노출 가능(UI 선택), 데이터는 개별 타입.
- [ ] 각 그룹에 `잘 모르겠어요` 선택지가 있다.
- [ ] 타입 선택 즉시 선택한 동물의 홈(`/{slug}`)으로 이동, 선택은 localStorage `ws.animalType`에 저장.
- [ ] 재방문 시 저장된 타입이 있으면 홈에 "이어서: 골든햄스터" 바로가기 표시(자동 리다이렉트 아님).
- [ ] 존재하지 않는 slug → 404 페이지 + 그룹 선택 진입.
- [ ] 이벤트 `species_selected{animalTypeId, group, via: 'picker'|'alias'|'url'}`.

### US-002 "잘 모르겠어요" — 별칭 검색·후보 안내
- [ ] 텍스트 입력 1개. `AnimalType.displayName`·`aliases`를 부분일치·초성 무관 단순 매칭(서버 검색 없이 시드 JSON 클라이언트 매칭).
- [ ] "사막다람쥐" 입력 → 몽골리안저빌 후보 + 한 줄 설명("흔히 사막다람쥐로 불리지만 햄스터가 아닌 모래쥐(저빌)입니다").
- [ ] 후보는 최대 5개, "이 친구가 맞아요" 선택 시 US-001과 동일 경로. **종 확정·법적 판정에 쓰지 않는다**(문구 고정).
- [ ] 매칭 없음 → "아직 준비 중인 친구예요" + 그룹 선택으로 복귀. 이벤트 `unknown_species_clicked{query}`.

---

## 5. EPIC-02 Animal Hub

### US-003 발견형 홈 (`/`, `/{slug}`)
As 사용자, I want 홈에서 내 동물 기준으로 "지금 필요한 것 → 구성안 → 기준에 맞는 준비물 → 병원"을 발견하고 싶다.
- [ ] 섹션 순서 고정: ① 히어로(마스코트 + 동물 선택/변경) ② 지금 필요한 것(요약 문구 + 항목 칩 레일) ③ 처음 준비한다면(구성안 카드 3) ④ 기준에 맞는 준비물(CuratedProduct 카드 레일) ⑤ 우리 동네 병원(카드 레일 + 전체 보기).
- [ ] 동물 미선택 홈 구성은 US-026을 따른다. 동물을 선택하면 선택한 동물의 홈(`/{slug}`)으로 이동한다.
- [ ] ② 헤더 탭 → L2 체크리스트 레이어, 칩 탭 → L4 용품 레이어. ③ 카드 → `/setup`. ④ 카드 → L7 상품 레이어. ⑤ 카드 [전화][길찾기], 전체 보기 → `/vet`.
- [ ] 시각 비중 캐릭터 > 구성안 > 용품 > 상품: 상품 카드 폭 ≤ 200px, ④가 뷰포트 높이의 절반을 넘지 않는다.
- [ ] `/{slug}`(예: `/hamster/golden`, `/gerbil`)는 동물 컨텍스트가 고정된 같은 홈(SEO 랜딩). 학명 소표기, 별칭 "○○라고도 불러요".
- [ ] `PLANNED` 타입 URL 직접 진입 시 "준비 중" 화면 + 다른 타입 안내(빈 콘텐츠 노출 금지).
- [ ] 정적 HTML만으로 타입명·필수 항목 이름·병원 진입 링크가 보인다(프리렌더, US-018).
- [ ] 하이드레이션 후 체크·입력 인터랙션이 동작한다.

---

## 6. EPIC-03 Setup Checklist

### US-004 2질문 개인화
- [ ] 첫 진입 시에만 2질문: ① `처음 키워요 / 이미 키우고 있어요` ② `이미 가진 것`(용품 다중 선택, 건너뛰기 가능).
- [ ] 질문은 2개를 넘지 않는다(예산·공간·생활패턴 없음).
- [ ] 답은 localStorage `ws.setup.{animalTypeId}`에 저장. "다시 설정" 링크로 언제든 변경.
- [ ] 이벤트 `setup_started{animalTypeId, firstTime, ownedCount}`.

### US-005 상태 엔진 체크리스트 (L2 레이어)
- [ ] 체크리스트는 홈 섹션이 아니라 **레이어**다(모바일 바텀시트 / PC 모달). 홈 ②의 요약 문구·칩 레일이 이 레이어의 창이다.
- [ ] 항목은 SupplyRequirement(CareProfile × SupplyItem)에서 파생. **최종값 계산 순서 고정: `SupplyItem 기본값 → SupplyRequirement(CareProfile) → AnimalType.careOverrides` — 뒤가 앞을 덮는다.** `resolveRequirement(animalTypeId, supplyItemId)` 순수 함수 1곳에서만 계산.
- [ ] **priority · minSpec · recommendedSpec · notNowReason · orderHint · searchKeyword는 SupplyRequirement가 소유.** SupplyItem에는 이 필드를 두지 않는다(용품 자체는 동물 무관).
- [ ] 4그룹: `필수(REQUIRED)` · `권장(RECOMMENDED)` · `선택(OPTIONAL)` · `지금 필요 없음(NOT_NOW)`. NOT_NOW는 `notNowReason` 한 줄과 함께, 접힘 상태로 노출(숨기지 않음).
- [ ] 항목 상태 4종: `✓ 준비완료` · `! 먼저 준비`(REQUIRED 미완료) · `△ 확인 필요`(호환 CHECK 또는 규격 미달) · `○ 나중에`(OPTIONAL/NOT_NOW 미완료).
- [ ] 보유품으로 답한 항목은 자동 `✓`. 구매 대상 집계에서 제외.
- [ ] 상단 요약: "오늘 바로 데려와도 되는 준비 ████░░ · 필수 2개 미완료". 필수 전부 완료 시 "필수 준비 끝" + 권장 안내.
- [ ] 정렬: `orderHint`(입양 전 → 첫 주 → 적응 후 → 필요 시) → priority.
- [ ] 체크 토글은 즉시 반영·저장, 새로고침 후 유지. 이벤트 `item_checked / item_unchecked{animalTypeId, supplyItemId, priority, readySource}`.
- [ ] 완료 상태는 출처를 가진다: `readySource ∈ {OWNED(2질문 보유), PURCHASED(외부 검색 클릭 후 체크), UNKNOWN(그 외 수동)}`. UI 노출 없음, localStorage·이벤트에만. Supply Action Rate 계산에서 OWNED는 분모 제외.
- [ ] 외부 검색(새 탭)에서 복귀 시 Hub·용품 상세의 체크·요약·스크롤 위치가 복원된다(localStorage 또는 세션 메모리).
- [ ] **준비율 정의: REQUIRED 항목 중 `✓ 준비완료` 비율.** RECOMMENDED/OPTIONAL/NOT_NOW는 계산에 포함하지 않는다. `△ 확인 필요` 상태의 REQUIRED는 완료로 세지 않는다. REQUIRED 전부 `✓` = 100%.
- [ ] REQUIRED 전부 `✓` 되는 순간 1회 `setup_100_reached{animalTypeId, elapsedSec}`.
- [ ] localStorage 접근 실패(시크릿 모드 등) 시 세션 메모리로 동작, 저장 불가 안내 1회.

### US-006 구성안(SetupBundle) 보기
- [ ] **Phase 0 구성안은 운영자 정의 정적 구성**(시드 `setup-bundles.json`). priority 기반 자동 조합·최적화는 만들지 않는다(Phase 1 이후, v0.2.3 §9).
- [ ] CareProfile별 `실속 / 균형 / 기존 물품 활용` 3안. 각 안에 목적 설명 1~2줄 + 포함 항목 + `estimatedRangeText`(운영자 텍스트, "7만 원대").
- [ ] "상품 세트"·"최저가"·"판매순" 표현 금지. "기존 물품 활용"은 보유품을 제외한 남은 항목만 표시.
- [ ] 항목 클릭 → 용품 상세(US-007). 가격 비교·상품 없음(Phase 1).
- [ ] 이벤트 `bundle_viewed{animalTypeId, tier}`.

---

## 7. EPIC-04 용품 상세 · 용품으로 찾기

### US-024 레이어 라우팅
- [ ] 레이어 7종(동물 선택·체크리스트·2질문·용품 상세·규격 확인·내 케이지·상품 상세)은 URL을 가진 것(용품·규격·상품)은 딥링크 시 **부모 페이지 + 레이어 열림**으로 렌더되고, 프리렌더 HTML에 레이어 본문이 포함된다.
- [ ] 한 번에 하나만 열림, 스텝 전환은 같은 레이어 안. 닫기·뒤로가기·ESC로 닫히고 부모의 스크롤·상태가 유지된다. `role=dialog`, 포커스 트랩.
- [ ] ≤767 바텀시트, ≥768 센터 모달(600/720), 용품·상품 상세는 ≥1024에서 우측 드로어 480(UX §10-1로 조정 가능).

### US-025 이메일로 저장(가벼운 가입, L8)
- [ ] 진입점은 2곳뿐: 선택 홈 저장 밴드 보조 링크, L2 푸터("지금 준비 상태를 저장해 둘까요?"). 콜드스타트 홈·히어로·헤더에는 없음. 모달 자동 팝업·기능 잠금·가입 게이트 없음.
- [ ] 입력은 이메일 하나. 비밀번호 없음. 매직 링크(15분 유효, 1회) 전송 → 클릭 시 세션 쿠키(HttpOnly, 90일). 소셜 로그인 없음.
- [ ] 저장 대상은 `animalTypeId`, `ws.setup.*`(체크 상태·readySource), `ws.context.*.cage`, ♥/👍 반응뿐. 병합 규칙: 로컬이 더 최신이면 로컬 우선, 아니면 서버 → 로컬.
- [ ] 문구 고정: "이메일로 저장해 둘까요?" / "선택한 동물과 준비 상태만 저장해요. 비밀번호 없이 메일의 링크로 확인해요." / "광고 메일은 보내지 않아요". 마케팅 수신 동의 체크박스 없음(수집 목적 = 저장·복원만, 개인정보처리방침 한 줄 링크).
- [ ] 로그인 상태 표시는 헤더 동물 칩 옆 6px 점 + 툴팁 "이메일로 저장 중". 로그아웃은 L8 안 "이 기기에서 연결 해제".
- [ ] 이벤트: `save_prompt_view{entry}`, `save_email_submit`, `save_link_confirm`, `save_merge{winner}`. 지표는 North Star에 넣지 않는다(보조).

### US-026 콜드스타트 홈 · 후기 · 소개
- [ ] 동물 미선택 홈 4섹션: 친구 선택(+기능 칩 4개 한 줄, 앵커) → 실제 이용 후기 → WithSmall 소개(슬라이드 4 = 지금 필요한 것 · 규격 판정 · 구성안 · 동네 병원, 한 화면 한 내용; PC는 sticky 이미지 + 항목 전환, IntersectionObserver) → 시작 배너(저장 유도 없음). 별도 '주요 기능' 섹션 없음.
- [ ] `Testimonial{id, quote(≤80자), animalTypeId, situation(FIRST_TIME|ALREADY), linkedAction(CHECKLIST|SPEC_CHECK|SETUP|VET), verifiedUsage(bool), reviewerImage(asset|null), reviewerImageConsent(bool), status(SUBMITTED|APPROVED|HIDDEN)}`. 노출은 APPROVED ∧ verifiedUsage만. 리뷰어 사진은 `reviewerImageConsent=true`일 때만, 얼굴이 식별되는 사진은 받지 않는다(동물·손·케이지 컷 권장); 없으면 회색 이니셜 원. 별점·점수 필드 없음. 사다리: 0 → 섹션 숨김, 1~2 → 단일 카드, 3~5 → 정지 레일, ≥6 → 마퀴 2줄(역방향, 호버·터치 정지, reduced-motion 정지). 카드 본문은 프리렌더 HTML에 포함. 운영자·AI가 문장을 작성·수정하지 않는다(맞춤법만).
- [ ] 런칭 시 초기 후기 10개는 **비공개 베타 테스트 참가자의 실제 후기**로 채운다(`source=BETA_2026_10`, 부제 "비공개 베타 테스터"). 임의 작성·AI 작성 금지. 절차는 `베타-후기-수집.md`.
- [ ] 수집 경로(런칭 후): L2에서 필수 완료 시 1회 "한 줄 남겨 주실래요?"(선택, 닫기 가능, 재노출 없음). 이벤트 `testimonial_prompt`, `testimonial_submit`.
- [ ] 쇼케이스 카드 데이터는 시드에서 정적 생성(실제 골든햄스터 판정·구성안 값). 가짜 사용자 수·다운로드 수 등 지표 표기 금지.
- [ ] 소개·그룹·빈 상태의 실사는 무료 라이선스 이미지(Wikimedia CC0/CC BY, Unsplash·Pexels·Pixabay)만, 자동 수집 금지. 기록 필드 `source, license(CC0|CC_BY|CC_BY_SA|SITE_LICENSE|PERMISSION), author, sourceUrl, downloadedAt, modified`. CC BY/BY-SA가 있으면 `/credits` 페이지와 푸터 링크 자동 생성. 상품 이미지는 US-023 규칙 그대로(판매자 허가·제휴 API·직접 촬영). 절차·장면 리스트는 `이미지-소싱.md`. 마스코트는 히어로에만.
- [ ] 동물 선택 홈 = 컨텍스트 헤더 + 5섹션: 지금 필요한 것 → 처음 준비한다면 → 기준에 맞는 준비물 → 동네 병원 → 저장 배너. 소개·후기 없음. L3 완료 전 ①은 "필수 준비를 먼저 확인해요" + 기본 REQUIRED 칩, 숫자 비노출.

### US-007 용품 상세(프로필 규격 적용, L4)
- [ ] 순서 고정: **왜 필요한가 → 확인할 조건(최소/권장 규격, 수치) → 주의 → 피해야 할 것 → 준비했어요 / 새 제품 찾기 / 규격 확인**.
- [ ] priority 배지, NOT_NOW면 이유, `orderHint` 문구("입양 전에 준비").
- [ ] `compatibleAlternativeIds`가 있으면 "이것 대신 ○○로도 구성 가능".
- [ ] 하단 작게 "마지막 검수 2026.09" + 👍/⚠ 버튼(US-015). 그 아래 "이 항목에 맞는 준비물" CuratedProduct 카드 2~3(있을 때).
- [ ] `reviewStatus=VERIFIED`가 아닌 항목·요구사항은 렌더되지 않는다(서버·프리렌더 공통 필터).
- [ ] "괜찮다/안전하다"류 의료 단정 문구는 콘텐츠 린트(§12)에서 차단.

### US-008 용품으로 찾기(역방향 진입)
As 이미 키우는 사용자, I want 용품에서 시작해 내 동물의 규격을 보고 싶다.
- [ ] 홈 `용품으로 찾기` → 용품 카테고리 그리드(케이지·쳇바퀴·베딩·먹이·급수·은신처·목욕·장난감·건강·기타).
- [ ] 용품 선택 → "어떤 친구가 쓰나요?" → 해당 용품에 SupplyRequirement가 있는 ACTIVE 타입만 노출.
- [ ] 선택 → US-007과 같은 상세(추가 데이터 0, SupplyRequirement 역조회).
- [ ] URL `/supplies/{item}` (프리렌더) 및 `/supplies/{item}/{type}`.

---

## 8. EPIC-05 규격 확인기

### US-009 수동 규격 판정
- [ ] 폼 필드는 `SupplyItem.specSchema`에서 자동 생성(부록 A). URL·이미지 입력 없음, 외부 데이터 호출 0.
- [ ] `specCheck()`는 순수 함수(`server/src/spec-check/`), 클라이언트·프리렌더·서버 동일 코드, 동일 입력 → 동일 결과.
- [ ] 결과는 **2단**으로 반환·표시: ① 제품 규격(`OK | BELOW_RECOMMENDED | BELOW_MIN | CHECK`) ② 내 환경 호환(`OK | CHECK | BELOW_MIN | NONE`=컨텍스트 없음). 종합 아이콘은 나쁜 쪽. 억지로 PASS하지 않는다.
- [ ] 결과에 이유 문장(어느 기준·어느 값)과 대안 SupplyItem(있으면) 포함.
- [ ] 단독 URL `/{group}/{type}/check/{item}` 프리렌더(폼은 하이드레이션 후 활성).
- [ ] 이벤트 `spec_checker_used{animalTypeId, supplyItemId, verdict}`.
- [ ] 단위 테스트: 프로필별 경계값(최소 정확히 충족·1 미만·권장 사이) 전 케이스.

---

## 9. EPIC-06 내 케이지 · 호환성

### US-010 내 케이지 등록
- [ ] 입력: 타입(`리빙박스 / 철장 / 아크릴 / 기타`) + 바닥 가로·세로·높이(cm). 규격 확인기 또는 체크리스트 "케이지 있어요"에서 진입.
- [ ] localStorage `ws.context.{animalTypeId}.cage`. 수정·삭제 가능. 이메일 저장(US-025) 시 서버로 병합.
- [ ] 등록 후 관련 용품 상세·규격 확인기가 자동 참조("내 케이지 기준" 라벨 표시).
- [ ] 메모(구현 변경 아님): 케이지는 공통 자산이고 적합성만 동물별이므로 장기적으로 `ws.context.cage` 공통 저장 + (animalType × cage) 판정이 자연스럽다. Phase 0는 동물별 저장 유지(단순), 저빌 추가 시 "다시 입력" 마찰이 관찰되면 Phase 1에서 공통화.

### US-011 호환 판정
- [ ] `CompatibilityRule` 시드로 정의, Phase 0 규칙: ① 쳇바퀴 지름 ↔ 케이지 높이·바닥 ② 급수기 거치 방식 ↔ 케이지 타입 ③ 은신처 크기 ↔ 바닥 면적 (+ 최대 2개 추가 가능).
- [ ] 판정은 `specCheck(…, userContext)`의 확장으로 실행, 별도 엔진 없음.
- [ ] 결과: `✓ 현재 케이지에서 사용 가능한 조건` · `△ 공간 조건 재확인` · `✕ 현재 케이지 조건에서 최소 요구 미충족`. 컨텍스트 없으면 판정 생략(오류 아님).
- [ ] 상품 간 비교 없음, CuratedProduct 없이 동작.
- [ ] 체크리스트 항목 상태에 반영(`△ 확인 필요`).
- [ ] 이벤트 `compatibility_checked{animalTypeId, ruleId, verdict}`. 단위 테스트: 규칙별 경계값.

---

## 10. EPIC-07 · 08 · 09 실행·지역·신호

### US-012 외부 검색 딥링크
- [ ] 검색어는 `buildSearchKeyword(animalType, resolvedRequirement)` **순수 함수**로 생성: `동물명 + 용품명 + 핵심 규격 1~2개`(예 "골든햄스터 쳇바퀴 30cm 무소음"). 조건은 최대 2개 — 과다 조건은 검색 결과를 오히려 비운다. `SupplyRequirement.searchKeyword`는 수동 override 슬롯(비어 있으면 함수 결과).
- [ ] QA: 골든햄스터 REQUIRED 항목 전부에 대해 생성 검색어가 "햄스터 쳇바퀴" 같은 무조건 검색어가 아니라 규격 조건을 포함하는지 스냅샷 테스트.
- [ ] 버튼 2개: `이 조건으로 쿠팡에서 찾기` · `네이버에서 찾기`. 검색어는 화면에 노출·복사 가능.
- [ ] 쿠팡·네이버 검색 URL로 새 탭. 가격·이미지·재고 수집 0. 제휴 태그·"제휴" 표현 없음(Phase 1).
- [ ] 클릭 시 `external_product_clicked{animalTypeId, supplyItemId, merchant}`.

### US-013 병원 찾기
- [ ] 진입: Hub "근처 병원" 또는 하단 탭 `병원`. 지역 선택은 시/도 → 시/군/구(텍스트). 위치 권한은 **선택**(거리 정렬용, 좌표 저장 0).
- [ ] 필터: 진료 동물(햄스터·기니피그·저빌·앵무 … `VetClinic.animals`), 야간, 응급.
- [ ] ≤767 리스트 ⇄ 지도(NaverMapShell) 토글; ≥768 리스트 | 지도 동시 표시. 카드: 이름·진료 동물·야간/응급·`전화`·`길찾기`(네이버 지도 앱/웹 딥링크).
- [ ] `status=VERIFIED`만 기본 노출. `REPORTED`(제보)는 "제보됨·확인 전" 배지로 구분 노출, `BLINDED` 비노출.
- [ ] 제보 폼: 병원명·주소·진료 동물·연락처. 저장 시 `REPORTED`. 신고→블라인드는 기존 governance 재사용.
- [ ] 빈 상태: "이 지역엔 아직 확인된 병원이 없어요 — 제보하기 / 인접 지역 보기".
- [ ] 이벤트 `vet_clicked{clinicId, action: 'call'|'route'|'detail'}`.

### US-014 병원 데이터 시드
- [ ] 서울·경기 우선, 운영자 확인 전화 후 `VERIFIED`. `source(SEED|USER_REPORT)`, `verifiedAt`.
- [ ] 진료 동물은 병원 확인 기준으로만 기록(추정 금지).

### US-015 반응 신호(정보)
- [ ] 용품 상세·가이드·구성안에 `👍 도움됐어요` `⚠ 다시 확인해 주세요` 2버튼. 댓글·피드·팔로우 없음.
- [ ] 익명: `anonKey = sha256(salt_daily + ip + ua)` 서버 계산 + localStorage 토글 상태. 동일 키·대상 1회, `POST /api/reactions` 분당 20회 IP 제한.
- [ ] 집계 캐시(`helpfulCount`, `recheckCount`, 향후 `likeCount`)는 표시·운영 큐용. **검수 상태·노출 정렬·규격 판정에 영향 0**(테스트로 잠금).
- [ ] "정확도 %" 등 신뢰 수치화 표현 금지.
- [ ] 이벤트 `reaction_helpful / reaction_recheck{targetType, targetId}`.

### US-016 상품 좋아요 · 추천 이유
- [ ] `ReactionSignal.kind=LIKE, targetType=PRODUCT` 활성. 상품 카드·L7에 ♥ 토글(익명, localStorage+anonKey). 반응 수는 **≥10일 때만 숫자 표시**, 미만은 아이콘만("♥ 0" 노출 금지).
- [ ] **불변식 반복: `likeCount`는 어떤 Phase에서도 추천 순위·적합성 판정을 바꾸지 않는다.** 노출 순서는 항상 규격 통과 → 검수 → 선호(표시 보조).
- [ ] **추천 이유는 자동 조립만** — `CuratedProduct` 노출 시 "왜 추천"은 `resolvedRequirement.why` + `specCheck` 판정 이유 + `CompatibilityRule` 판정 메시지에서 생성한다. 상품별 자유 문구 필드(`recommendationCopy` 류)는 만들지 않는다. 스키마 예약: `CuratedProduct.eligibility{ meetsMinSpec, checkedRules[], reasons[] }`.

---

### US-022 CuratedProduct 카드·상세 (Phase 0 = 발견, 판매 아님)
As 사용자, I want 기준에 맞는 실제 준비물을 보고 싶다, so that 무엇을 찾아야 할지 감이 온다.
- [ ] 카드: 이미지(1:1) · 상품명 1줄 · 규격 한 줄(`30cm · 무소음`) · `✓ 기준 충족` 배지(항상) · ♥. 가격·판매처·"구매/최저가/베스트" 없음.
- [ ] L7 상세: 이미지 · 상품명 · 용품 종류 · 규격 · **WithSmall 추천 이유**(`eligibility.reasons[]`에서 자동 조립: 규격 충족·프로필 일치·내 케이지 호환) · 검수일 · ♥ · [이 조건으로 찾기](검색 딥링크, US-012).
- [ ] 노출 조건: `meetsMinSpec=true` AND `status=ACTIVE` AND `specVerifiedAt` 존재. 미충족 상품은 어떤 레일에도 나오지 않는다(불변식 3, compliance 테스트).
- [ ] 레일 "기준에 맞는 준비물"은 검수 기준 정렬. "많이 선택한 준비물"(♥ 기준)은 ♥ 데이터가 임계치를 넘은 항목이 5개 이상일 때만 별도 레일로 생성, 같은 레일에 섞지 않는다.
- [ ] 이벤트 `product_viewed{productId, supplyItemId}`, `reaction_like{productId}`.

### US-023 큐레이션 입력·이미지 규칙 (운영)
- [ ] 시드 `curated-products.json`: `id, supplyItemId, careProfileIds[], title, imageAsset, specValues(JSON, specSchema 키), meetsMinSpec(빌드 시 specCheck로 재계산·불일치면 validate 실패), specVerifiedBy/At, status, imageLicense(OWN_PHOTO|SELLER_PERMISSION|AFFILIATE_API|NONE)`.
- [ ] `imageLicense=NONE`이면 이미지 대신 용품 아이콘 타일 렌더. 외부 페이지 이미지 자동 수집 0(불변식 1).
- [ ] Phase 0 목표: 골든햄스터 REQUIRED 5항목 × 2 = **10개**, 저빌 재사용 확인.
- [ ] 상품별 자유 설명 필드 없음(추천 이유는 자동 조립).

## 11. EPIC-10 SEO · 프리렌더

### US-017 프리렌더 페이지
- [ ] 대상: `/`, `/{group}`, `/{group}/{type}`, `/{group}/{type}/check/{item}`, `/supplies/{item}`, `/supplies/{item}/{type}`, `/vet`, `/vet/{region}`.
- [ ] 빌드 타임 정적 HTML + 하이드레이션(Vite + Express 유지, 프레임워크 이전 없음). `ACTIVE` 타입·`VERIFIED` 콘텐츠만 생성.
- [ ] 페이지별 `title`·`description`·`canonical`·OG·구조화 데이터(Article/FAQ 또는 Product 아님 — `HowTo`/`ItemList`), `sitemap.xml`·`robots.txt` 자동 생성.
- [ ] JS 비활성 상태에서 핵심 본문(타입명·필수 항목·규격 문장·병원 리스트)이 HTML에 존재. 잘못된 slug 404.
- [ ] 모바일·데스크톱 LCP ≤ 2.5s(로컬 Lighthouse 기준), 이미지 lazy. 프리렌더 HTML은 폭과 무관하게 하나(반응형 CSS 포함).
- [ ] 데스크톱(≥1024)에서 `/{group}/{type}/supplies/{item}` 및 `/check/{item}` 직접 진입 시 허브 + 우측 패널로 렌더되고 정적 본문에 항목 내용이 포함된다.

### US-018 이벤트 수집
- [ ] `POST /api/events` 배치, 필드: `name, ts, animalTypeId?, props(JSON ≤ 1KB), sessionKey(랜덤·localStorage)`. IP·UA 원문 저장 0, 개인식별 목적 0.
- [ ] Phase 0 이벤트 목록(§4~10): `species_selected, unknown_species_clicked, setup_started, item_checked, item_unchecked, setup_100_reached, bundle_viewed, spec_checker_used, compatibility_checked, external_product_clicked, vet_clicked, reaction_helpful, reaction_recheck`.
- [ ] 운영자 조회 `GET /api/admin/metrics`(role=운영자): Setup Completion Rate, Supply Action Rate, TTFUA 중앙값.

---

## 12. EPIC-11 콘텐츠 운영 · 검수

### US-019 시드 파일 구조와 입력 경로
Phase 0에 어드민 UI는 없다. 콘텐츠는 레포의 시드 JSON을 PR로 편집한다.
- [ ] `server/seed/`: `animal-types.json`, `taxa.json`, `care-profiles.json`, `supply-items.json`, `supply-requirements.json`, `compatibility-rules.json`, `setup-bundles.json`, `vet-clinics.json`. 스키마는 부록 A·B, `npm run seed:validate`로 검증(CI 게이트).
- [ ] 모든 콘텐츠 레코드에 `source[](url, title, accessedAt)`, `reviewerType`, `verifiedBy`, `verifiedAt`, `reviewStatus` 필수. 누락 시 validate 실패.
- [ ] `contentKind`별 최소 `reviewerType`(v0.2.3 §7.3)을 validate가 강제: SPEC/CARE ≥ EXPERIENCED_KEEPER, FOOD/HEALTH ≥ VET_PUBLISHED_SOURCE + 출처 2.
- [ ] `AI_DRAFT`는 `reviewStatus=VERIFIED`와 공존 불가(validate 실패).
- [ ] 콘텐츠 린트: 금지 표현("괜찮다", "안전하다", "최저가", "판매순", "정확도", "전문가 N명") 포함 시 실패.

### US-020 검수 워크플로
- [ ] `DRAFT → NEEDS_REVIEW → VERIFIED`. VERIFIED만 노출·프리렌더.
- [ ] `verifiedAt` + 180일 경과 → 빌드 시 자동 `NEEDS_REVIEW` 강등 리포트(노출은 유지하되 운영자 큐에 표시 — Phase 0에서는 리포트만).
- [ ] 운영자 큐 정렬 신호: `recheckCount / views` 상위, `helpfulCount / views` 하위. `GET /api/admin/review-queue`.

---

## 13. EPIC-12 기반 · 품질 게이트 · 완료 조건

### US-021 코드 복구 (v0.2.3 §7.4)
- [ ] 미커밋 상태 `wip/withsmall-v01` 브랜치로 보존.
- [ ] Outget 모듈(agent·request·board/discount·listings·bounty·groupslot·shopping·payment) + v0.1 adoption/application 삭제, `repos.ts`·`app.ts` 정리, `tsc` 통과.
- [ ] Prisma 마이그레이션 초기화, v0.2.3 §5 스키마 적용.
- [ ] `compliance-scan.mjs` 규칙 교체: 외부 fetch 호스트 0(허용 목록 비움) · 결제/가격 필드 0 · 실시간 좌표 저장 0 · VERIFIED 아닌 콘텐츠 렌더 0 · ReactionSignal(helpful/recheck/like)이 정렬/판정 코드 경로에서 참조되지 않음 · `SupplyItem`에 priority/minSpec 필드 없음.
- [ ] 순수 함수 3종은 `server/src/engine/`에 모아 클라이언트가 같은 소스를 import: `resolveRequirement`, `specCheck`(+호환), `buildSearchKeyword`. 각각 단위 테스트 필수.
- [ ] CLAUDE.md 불변식을 v0.2.3 §2로 교체.

### Phase 0 완료 조건
**데이터**: 골든햄스터·저빌 `ACTIVE`(SupplyItem ≥ 15, 요구사항 전부 VERIFIED, 구성안 3안, CompatibilityRule ≥ 3) · **CuratedProduct ≥ 10(골든 REQUIRED 항목당 2, 이미지 사용권 확인)** · 나머지 타입은 `PLANNED` 이상 · 병원 VERIFIED ≥ 30(서울·경기).
**기능**: US-001~US-026 수용 기준 전부.
**품질**: `tsc`·lint·build 통과 · `spec-check`·`compatibility`·seed validate·콘텐츠 린트 테스트 통과 · 프리렌더 검증(JS-off 본문 존재) · compliance-scan 0 위반 · 반응형 스모크(360 · 768 · 1024 · 1440 네 폭에서 QA 시나리오 A·D·E, 가로 스크롤 0) · 모바일 PWA 오프라인 셸.
**모델 검증**: 저빌 추가에 SupplyItem 신규 작성 0건 — 프로필 연결 + override만으로 붙었는지 기록. 아니면 v0.2.4를 연다.
**검색어 검증**: 골든햄스터 REQUIRED 항목의 생성 검색어 스냅샷이 규격 조건을 포함(US-012).
**QA 스모크 시나리오(필수)**: A 처음 완주 · B 보유품 제외 · C 규격 미달(25cm) · D 내 케이지 호환 2단 판정 · E 병원 전화 · F JS-off 정적 본문 · **G 외부 검색 후 복귀 시 상태 복원** · H "사막다람쥐" → 저빌 후보.

### 개발 순서
코드 복구 → 스키마·시드 로더 → `spec-check`(+호환) 순수 함수·테스트 → 골든햄스터 시드 완주 → US-001~007·009~011 화면 → 프리렌더 → 병원 → 반응 신호·이벤트 → 저빌 재사용 검증 → 통합 QA.

---

## 14. 변경 규칙
- 이 PRD의 범위 변경은 v0.2.3 §9 트리거 충족 시에만, 그리고 게이트 "기존 AnimalType/CareProfile + SupplyRequirement/SupplyItem + Checklist 데이터로 해결되는가?"를 통과할 때만.
- 개발 중 제안("AI 추천", "상품 자동 비교", "중고 같이", "예산 입력", "소셜 로그인·프로필") → 백로그. 답변 문구 고정: "Phase 0 범위 밖, §9 트리거 참조".

---

## 부록 A. specSchema / minSpec / CompatibilityRule JSON 규격

```jsonc
// SupplyItem.specSchema — 규격 확인기 폼 정의
{ "fields": [
  { "key": "diameterCm", "label": "지름(cm)", "type": "number", "min": 5, "max": 60 },
  { "key": "silent", "label": "무소음(베어링)", "type": "boolean" }
]}
// 케이지: type(enum: LIVING_BOX|WIRE|ACRYLIC|OTHER), floorWcm, floorDcm, heightCm

// SupplyRequirement.minSpec / recommendedSpec — 규칙 배열(AND). op: gte|lte|eq|in|not_in
{ "rules": [ { "key": "diameterCm", "op": "gte", "value": 28, "reason": "골든햄스터 성체 척추 보호 기준" } ] }

// CompatibilityRule.expr — 두 항목 값 참조. a=대상 용품 입력, b=userContext 항목
{ "a": "wheel", "b": "cage", "rules": [
  { "expr": "a.diameterCm + 4 <= b.heightCm", "onFail": "BELOW_MIN", "message": "쳇바퀴가 케이지 높이보다 큽니다" },
  { "expr": "b.type in ['LIVING_BOX','ACRYLIC'] ? a.mount != 'HANG' : true", "onFail": "CHECK", "message": "리빙박스엔 걸이형 급수기 거치가 어렵습니다" }
]}
```
`expr`는 화이트리스트 연산자만 허용하는 미니 파서로 평가(eval 금지). 판정 우선: BELOW_MIN > CHECK > BELOW_RECOMMENDED > OK.

## 부록 B. 시드 레코드 공통 필드
```jsonc
{ "id": "...", "reviewStatus": "VERIFIED", "reviewerType": "EXPERIENCED_KEEPER", "verifiedBy": "handle",
  "verifiedAt": "2026-10-05", "source": [ { "url": "...", "title": "...", "accessedAt": "2026-10-01" } ],
  "contentKind": "SPEC" }
```

## 변경 이력
| 날짜 | 변경 |
|---|---|
| 2026-10-02 | **v1.3.1** — US-001/US-003 미선택 홈·동물 전환 문구를 US-026·구현(URL 이동)에 맞춤(Kenny 결정) · US-015 띄어쓰기 |
| 2026-09-30 | **v1.3** — UX v2.3 연동: 콜드스타트 쇼케이스 → 검증 후기(Testimonial 모델·사다리·수집 경로), 저장 유도 2곳, L3 전 숫자 비노출, 레이어 URL history 확장 |
| 2026-09-30 | **v1.2.1** — UX v2.2 연동: US-026을 미선택 5섹션/선택 5섹션으로 정정 |
| 2026-09-30 | **v1.2** — UX v2.1 연동: 콜드스타트 홈 쇼케이스·서비스 설명(US-026), 이메일 링크 저장(US-025, 비밀번호·소셜 없음), 실사 이미지 원칙. 범위 표의 '계정 없음'을 '이메일 저장만'으로 완화 |
| 2026-09-30 | **v1.1** — UX v2.0 연동: US-003을 발견형 홈으로 교체, 체크리스트를 레이어로(US-005), 레이어 라우팅 US-024, CuratedProduct 발견 편입(US-022·023: 카드·상세·노출 조건·시드·이미지 사용권), ♥ 활성(US-016, 임계치 10), 완료 조건에 큐레이션 10개. 가격·판매처·제휴는 Phase 1 유지 |
| 2026-09-30 | v1.0.3 — 반응형 3단을 공통 AC로(360~1440 · 같은 URL·마크업 · 폭별 전용 기능 없음), 데스크톱 패널 직접 진입 프리렌더 AC, 병원 ≥768 동시 표시, 네 폭 반응형 스모크. 시각 기준을 WithSmall DS v1.1(흰 바탕·단일 테마)로, Outget 토큰 사용 금지 |
| 2026-09-30 | v1.0.2 — UX v1.0.1 연동: 완료 출처 `readySource`(OWNED/PURCHASED/UNKNOWN), 외부 복귀 상태 복원 AC, 규격 확인 2단 판정 반환 구조, QA 스모크 시나리오 A~H 명시 |
| 2026-09-30 | v1.0.1 — 해석 잠금 7건: AnimalType 숫자→명시 목록, 최종 요구사항 계산 순서(SupplyItem→CareProfile→AnimalType override), priority/spec는 SupplyRequirement 소유, Phase 0 구성안=운영자 정적 정의, 준비율=REQUIRED만·△ 미포함, 추천 이유 자동 조립 스키마 예약(상품별 자유 문구 금지)·likeCount 순위 불변식 반복, `buildSearchKeyword` 순수 함수+스냅샷 QA. 케이지 컨텍스트 공통화는 메모 |
| 2026-09-30 | v1.0 — Phase 0 PRD 확정. 입력: 제품기획 v0.2.3 + 외부 초안. 초안 대비 수정: URL 체계 `/{group}/{type}`, 용품으로 찾기·"잘 모르겠어요"·시드 입력 경로·병원 지역/권한/빈 상태 스토리 추가, specSchema/CompatibilityRule JSON 규격 확정, 완료 조건을 "골든+저빌 완주"로, 이벤트·compliance 규칙을 수용 기준화 |
