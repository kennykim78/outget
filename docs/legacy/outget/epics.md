---
stepsCompleted: [1, 2, 3]
inputDocuments:
  - docs/planning-artifacts/PRD.md
  - docs/planning-artifacts/UX-기획.md
  - docs/planning-artifacts/architecture.md
  - CLAUDE.md
project_name: 'Outget (아웃겟)'
date: '2026-06-08'
---

# Outget (아웃겟) - Epic Breakdown

## Overview
PRD v0.2 / UX v0.2 / architecture v0.1을 구현 가능한 에픽·스토리로 분해. **MVP 범위 우선**(전국확장·자동매칭·중개수수료·내장 에스크로 등 Phase 2+ 제외). 외부 P2P 안전결제 제공자는 **M1 보류** → 결제는 *직접거래 + 비수탁 어댑터 추상화*로 스토리화. **5대 법적 불변식**을 인수조건(AC)에 박는다.

> 불변식: ①무크롤링(UGC 포함) ②자금 미보유 ③통신판매중개 최소의무 ④가격은 UGC+현장확인가만(`기준가 미확인`) ⑤외부링크 보증 금지/위치 비실시간.

## Requirements Inventory

### Functional Requirements (PRD EPIC A~I·S)
- **A 지도·양면 보드:** A1 토글(대행자/요청/할인)·클러스터 / A2 앵커 중심 위치표시 / A3 필터(브랜드·지역·일정·지위·키워드) / A4 거리표시(실시간 GPS 없음)
- **B 대행자 공급:** B1 광고·활동지역·출동일정(텍스트) / B2 지위 개인(비사업자)/전문(사업자 인증) / B3 개인 사업자등록 의무 고지 / B4 전문 상호·사업자번호·연락처 / B5 채팅 매칭
- **C 역경매:** C1 "언제까지/무엇/얼마" 요청 / C2 채택·확인가 제시·거절 / C3 상태 추적 / C4 알림
- **D 매칭 채팅·결제선택:** D1 인앱 채팅 / D2 직접/외부 안전결제 선택(자금 미보유) / D3 안전결제 넛지+직접거래 사기경고(링크 보증 안 함) / D4 고지·신고 상시
- **E UGC·가격:** E1 할인소식 게시 / E2 정가 미입력 시 `기준가 미확인` 자동 라벨 / E3 미검증·출처·신고 / E4 현장 확인가 분리 / E5 내 소유 축적
- **F 바운티·평판:** F1 무금전 바운티 / F2 뱃지/평판 보상 / F3 사진 신뢰(시각·위치메타) / F4 평판 노출
- **G 신뢰·분쟁·거버넌스:** G1 통신판매중개 고지 / G2 신고 버튼 / G3 즉시 블라인드+이의/재게시(takedown) / G4 분쟁·제재 / G5 신원정보 제공
- **I 공동대행:** I1 슬롯 개설 / I2 사입·세무 경고 모달 / I3 결제후구매 안내
- **S 창업자 시드:** S1 수동 큐레이션(사실/직접촬영) / S2 현장 출동 시드 / S3 1호 대행

### NonFunctional Requirements
- NFR-C1~C7 컴플라이언스(무크롤링·자금미보유·중개고지·가격 UGC한정+미확인 라벨·지위구분·위치 비실시간·UGC takedown) / 개인정보·LBS / 보안(시크릿·XSS·CORS·HTTPS) / 성능(지도·리스트 비동기·클러스터) / 접근성·모바일우선 / 신뢰성(채팅·신고·분쟁 기록 보존)

### Additional Requirements (architecture)
- 모노레포 스캐폴드(`/client`,`/server`,`/docs`) · PWA(Vite+React+TS) + thin server(Node) · **네이버 지도 SDK**(확정) · PostgreSQL+Prisma(제안) · **PaymentRail 비수탁 어댑터**(제공자 M1 보류 → 직접거래/안내 모드로 가동) · 네이버쇼핑 API(정가) · JWT auth · **GitHub Actions CI + 컴플라이언스/시크릿 스캔 게이트**

### UX Design Requirements (UX v0.2)
- UX-DR1 `DiscountPost`(미검증·`기준가 미확인` 칩) / UX-DR2 `VerifiedPriceCard`(✅·초록·분리) / UX-DR3 `IntermediaryNotice`(상시) / UX-DR4 `PaymentChoice`(직접/안전결제·경고·검증UI 없음) / UX-DR5 `StatusToggle`(개인/전문·고지) / UX-DR6 `ReportButton→BlindFlow`(이의 포함) / UX-DR7 `BadgeReputation` / UX-DR8 `GroupSlotWarning` / UX-DR9 `EmptyState`(가짜 채움 금지) / UX-DR10 `MapCluster`(네이버) / UX-DR11 `AgentCard`/`RequestCard` / UX-DR12 가격 위계(색 단독 의존 금지) / UX-DR13 카피 가이드(고지·경고·라벨 문구)

### FR Coverage Map
A→E2 · B→E3 · C→E4 · D→E5 · E→E6 · F→E8 · G→E7 · I→E9 · S→E10 · (스캐폴드/CI/auth→E1). NFR·UX-DR는 각 에픽 스토리 AC에 분산 반영.

## Epic List
1. **기반 — 스캐폴드·인증·CI 컴플라이언스 게이트**
2. **지도 양면 보드 & 탐색** (A)
3. **대행자 공급 — 프로필·지위·일정** (B)
4. **구매자 역경매 요청** (C)
5. **매칭 채팅 & 거래방식(직접/외부 안전결제)** (D)
6. **UGC 할인소식 & 현장 확인가** (E)
7. **신뢰·분쟁·UGC 거버넌스** (G)
8. **바운티 & 평판** (F)
9. **공동대행 슬롯** (I)
10. **창업자 시드 & 운영(컨시어지)** (S)

> 권장 구현 순서: 1 → 2 → (3∥4) → 5 → 6 → 7 → (8·9·10). 5·6·7은 불변식 밀도가 높아 `security-auditor` 동반 필수.

---

## Epic 1: 기반 — 스캐폴드·인증·CI 컴플라이언스 게이트
모노레포·PWA·thin server·네이버 지도·인증 골격을 세우고, **불변식을 CI에서 강제**하는 토대를 만든다.

### Story 1.1: 모노레포 스캐폴드 & 빌드
As a 개발자, I want `/client`(PWA)·`/server`·공용 설정의 모노레포 스캐폴드, So that 모든 후속 스토리가 일관된 빌드 위에서 진행된다.
**AC**
- **Given** 빈 저장소(GitHub `kennykim78/outget`) **When** 스캐폴드 생성 **Then** `/client`(Vite+React+TS PWA), `/server`(Node+TS) 빌드가 각각 exit 0 **And** `knockedu-run`의 dev 명령이 배선되어 클라가 서빙됨.
- **Given** `.gitignore` **Then** `_bmad/`·시크릿·`settings.local.json`이 추적되지 않음.

### Story 1.2: CI + 컴플라이언스/시크릿 스캔 게이트
As a 팀, I want GitHub Actions가 lint/typecheck/build/test + **컴플라이언스 스캔**을 돌리는 것, So that 불변식 위반·시크릿 커밋이 머지 전에 차단된다.
**AC**
- **Given** PR **When** CI 실행 **Then** lint·typecheck·build·test 통과해야 머지 가능.
- **Given** 코드에 외부사이트 자동수집·플랫폼 결제경유·실시간 위경도 저장·링크검증기 패턴 **When** 컴플라이언스 스캔 **Then** **FAIL**(머지 차단) — `knockedu-qa` 스캔 규칙과 일치.
- **Given** 추적 파일에 API 키 **Then** 시크릿 스캔 FAIL.

### Story 1.3: 인증 골격 (역할 기반)
As a 사용자, I want 가입/로그인과 역할(구매자·개인대행자·전문대행자·소식알림자·운영자), So that 권한별 기능을 쓸 수 있다.
**AC**
- **Given** 가입 **When** JWT 발급 **Then** access/refresh 토큰·만료 검증 동작 **And** 역할이 토큰/세션에 반영.
- **Given** 비인가 요청 **Then** 보호 라우트가 401/403.

### Story 1.4: 네이버 지도 셸 통합
As a 사용자, I want 모바일 화면에 네이버 지도가 뜨고 현위치 기준으로 보이는 것, So that 이후 보드/핀이 얹힌다.
**AC**
- **Given** 지도 화면 진입 **When** 로드 **Then** 네이버 지도 SDK가 모바일 뷰포트에 렌더 **And** 키는 env·도메인 제한(하드코딩 없음).
- **Given** 위치 권한 거부 **Then** 지역(동) 기본값으로 폴백, 크래시 없음 **And** 사용자 위경도를 서버에 저장하지 않음.

---

## Epic 2: 지도 양면 보드 & 탐색  *(FR A)*
대행자·구매자 요청·할인소식을 하나의 지도에서 토글로 본다.

### Story 2.1: 양면 토글 보드 + 클러스터 *(A1, UX-DR10)*
As a 사용자, I want ⟨대행자⟩⟨요청⟩⟨할인소식⟩ 토글과 핀 클러스터링, So that 한 지도에서 양면을 탐색한다.
**AC**
- **Given** 보드 **When** 토글 전환 **Then** 해당 레이어(대행자/요청/할인) 핀만 표시 **And** 밀집 시 클러스터.
- **Given** 데이터 0건 **Then** `EmptyState`가 가짜로 채우지 않고 제보/시드를 유도(UX-DR9).

### Story 2.2: 필터 & 거리 *(A2~A4)*
As a 사용자, I want 브랜드·지역·일정·지위·키워드 필터와 거리 표시, So that 원하는 항목만 본다.
**AC**
- **Given** 필터 적용 **Then** 서버 보유 데이터 한정으로 결과 갱신(외부 크롤링 호출 0).
- **Given** 위치 권한 허용 **Then** 거리 표시 **And** 실시간 GPS 추적·공유·저장 없음.

---

## Epic 3: 대행자 공급 — 프로필·지위·일정  *(FR B)*

### Story 3.1: 대행자 지위 구분 & 고지 *(B2, B3, UX-DR5)*
As a 대행자, I want 가입 시 개인(비사업자)/전문(사업자 인증) 선택, So that 내 지위가 명확히 표시된다.
**AC**
- **Given** 프로필 생성 **When** 개인 선택 **Then** "지속·반복 영리 시 사업자 등록 의무 발생 가능" 고지 상시 노출.
- **Given** 전문 선택 **When** 사업자등록증 인증 **Then** 상호·사업자번호·연락처 저장·표시(B4, 통신판매중개의뢰자 정보).

### Story 3.2: 광고·활동지역·출동일정 게시 *(B1, B5, UX-DR11)*
As a 대행자, I want 광고·활동지역·출동일정을 올리고 구매자가 채팅하게, So that 매칭이 시작된다.
**AC**
- **Given** 프로필 작성 **When** 위치 입력 **Then** **동/지역 단위 텍스트**만(실시간 좌표 불가).
- **Given** 구매자가 대행자 카드 **When** [채팅] **Then** 매칭 스레드 생성.

---

## Epic 4: 구매자 역경매 요청  *(FR C)*

### Story 4.1: 역경매 요청 작성 *(C1, UX-DR11)*
As a 구매자, I want "언제까지/무엇(옵션)/얼마(대행료 포함)" 요청 게시, So that 대행자가 채택한다.
**AC**
- **Given** 요청 폼 **When** 제출 **Then** 품목·옵션·희망가·기한·지역이 저장되고 보드/지도에 노출.

### Story 4.2: 채택·확인가·상태·알림 *(C2~C4)*
As a 구매자, I want 요청 상태 추적과 대행자 채택/확인가 알림, So that 진행을 안다.
**AC**
- **Given** 요청 **When** 대행자 채택/확인가 제시/거절 **Then** 상태 전이(대기·채택·매칭·진행·종료) **And** 구매자에 알림.
- **Given** 직접거래 선택 거래 **Then** 매칭까지만 추적(이행 미추적), 단 고지·분쟁 채널 유지.

---

## Epic 5: 매칭 채팅 & 거래방식  *(FR D)* — ⚠ 자금 미보유 핵심
### Story 5.1: 인앱 채팅 *(D1, D4)*
As a 매칭 당사자, I want 인앱 채팅, So that 거래를 조율한다.
**AC**
- **Given** 채팅 화면 **Then** `IntermediaryNotice`("거래 당사자 아님")와 신고 버튼 상시(UX-DR3).
- **Given** 메시지 송수신 **Then** 기록 보존(분쟁 증거), XSS 방어.

### Story 5.2: 거래방식 선택 + 비수탁 결제 어댑터 *(D2, D3, UX-DR4)*
As a 사용자, I want 직접거래/외부 안전결제 선택, So that 안전하게 거래한다.
**AC**
- **Given** 매칭 **When** 거래방식 선택 **Then** ① 직접거래 ② 외부 P2P 안전결제(딥링크) **And** **결제대금이 플랫폼 계좌/PG/서버를 경유하지 않음**(자금 미보유).
- **Given** 안전결제 제공자 미선정(M1) **Then** 어댑터가 '안내 모드'로 동작(직접거래 + 안전결제 가이드), 빌드·기능 정상.
- **Given** 직접거래 선택 **Then** 선입금 사기 경고 노출 **And** 외부 링크를 **검증·보증하지 않음**(검증기 UI/로직 부재).

---

## Epic 6: UGC 할인소식 & 현장 확인가  *(FR E)* — ⚠ 무크롤링·가격주장 금지
### Story 6.1: 할인소식 게시 + `기준가 미확인` *(E1~E3, E5, UX-DR1)*
As a 소식알림자/대행자, I want 할인소식을 올리는 것, So that 지도에 할인 정보가 쌓인다.
**AC**
- **Given** 폼 **When** 정가 미입력 **Then** **`[기준가 미확인·사용자 제보가]` 라벨 자동 부착**(서버 스탬프) **And** "미검증 제보"·출처·작성자·시각 표기.
- **Given** 사진 업로드 **Then** 직접 촬영분 유도 **And** 외부 사이트 본문/이미지 자동수집 경로 부재(무크롤링).
- **Given** 정가 보조 조회 **Then** **네이버쇼핑 API만** 사용(크롤링 아님).

### Story 6.2: 현장 확인가 분리 표시 *(E4, UX-DR2, UX-DR12)*
As a 사용자, I want 대행자 현장 확인가가 미검증 제보와 명확히 구분되는 것, So that 신뢰 가능한 가격을 안다.
**AC**
- **Given** 현장 확인가 존재 **Then** ✅·대행자·확인일과 함께 강조(초록) **And** UGC 할인소식과 시각·문구로 분리(색 단독 의존 금지).
- **Given** 플랫폼 **Then** 자체 산정 가격을 단정 표기하지 않음(가격 주장 금지).

---

## Epic 7: 신뢰·분쟁·UGC 거버넌스  *(FR G)* — ⚠ 통신판매중개·takedown
### Story 7.1: 통신판매중개 고지 & 신원정보 제공 *(G1, G5, UX-DR3)*
As a 운영자, I want 거래/요청/소식/채팅에 중개 고지와 신원정보 제공, So that 전상법 의무를 이행한다.
**AC**
- **Given** 해당 화면들 **Then** "Outget은 통신판매중개자이며 거래 당사자가 아님" 상시 렌더.
- **Given** 분쟁 시 신원정보 요청 **Then** 상대 신원정보 제공 경로 동작.

### Story 7.2: 신고 → 즉시 블라인드 → 이의/재게시 *(G2, G3, UX-DR6)*
As a 사용자/운영자, I want 모든 UGC 신고와 즉시 임시조치, So that 저작권·허위·사기를 차단한다(OSP 면책).
**AC**
- **Given** UGC **When** 신고 **Then** 즉시 블라인드(임시조치) + 작성자 알림.
- **Given** 블라인드 **When** 작성자 이의 **Then** 운영자 검토 → 복구/삭제 상태 전이.

### Story 7.3: 분쟁·제재 *(G4)*
As a 운영자, I want 분쟁 접수·중재·제재, So that 방치(연대책임)를 피한다.
**AC**
- **Given** 분쟁 신고 + 증빙 **When** 중재 **Then** 처리상태·제재(경고/정지) 기록 보존.

---

## Epic 8: 바운티 & 평판  *(FR F)* — 무금전
### Story 8.1: 무금전 바운티 + 뱃지 *(F1~F4, UX-DR7)*
As a 구매자, I want 현장확인 미션을 무금전으로 걸고 수행자에 뱃지 부여, So that 실시간 데이터가 모인다.
**AC**
- **Given** 바운티 등록 **Then 금전 보상 경로 없음**(뱃지/평판만) — 선불수단·PG 트리거 부재.
- **Given** 사진 제출 **Then** 시각·(가능 시)위치 메타로 재탕/도용 완화 **And** 뱃지·평판이 프로필에 노출.

---

## Epic 9: 공동대행 슬롯  *(FR I)*
### Story 9.1: 공동대행 슬롯 + 경고 *(I1~I3, UX-DR8)*
As a 대행자, I want 출동 일정에 공동대행 슬롯을 여는 것, So that 한 번의 이동으로 여러 건을 대행한다.
**AC**
- **Given** 슬롯 개설/참여 **Then** "대량구매=사입(도소매) 세무 리스크 · 요청 접수 후 구매(선사입 금지)" 경고 모달, 동의 후 진행.

---

## Epic 10: 창업자 시드 & 운영(컨시어지)  *(FR S)* — ⚠ 무크롤링 시드
### Story 10.1: 운영자 수동 큐레이션 *(S1)*
As a 운영자(창업자), I want 공식 채널 행사 정보를 손으로 입력, So that 빈 보드를 합법적으로 채운다.
**AC**
- **Given** 운영자 입력 화면 **Then** 사실(텍스트)만 입력 **And** 이미지는 직접 촬영분 업로드만 **And** 자동수집 경로 부재.

### Story 10.2: 현장 시드 & 1호 대행 운영 *(S2, S3)*
As a 운영자, I want 현장 출동으로 시드와 1호 대행을 수행, So that 초기 양면 콜드스타트를 깬다.
**AC**
- **Given** 운영자 계정 **Then** 소식알림자+대행자+운영자 겸직 역할로 시드·매칭·분쟁 처리 가능.

---

## 변경 이력
| 날짜 | 변경 | 사유 |
|---|---|---|
| 2026-06-08 | 에픽 v0.1 — PRD v0.2 EPIC A~I·S를 10 에픽·24 스토리로 분해, 5대 불변식을 AC에 반영, 결제는 직접거래+비수탁 어댑터(M1 보류) 기준 | PRD/UX/architecture 기반 스토리화. 구현은 `knockedu-build`로 |
