---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - docs/planning-artifacts/PRD.md
  - docs/planning-artifacts/UX-기획.md
  - docs/MVP_모델.md
  - CLAUDE.md
workflowType: 'architecture'
project_name: 'Outget (아웃겟)'
user_name: 'kennykim'
date: '2026-06-08'
---

# Outget (아웃겟) — 솔루션 아키텍처

지도 기반 아울렛 구매대행 **당근형 양면 매칭 보드**. 입력: [PRD.md](PRD.md) v0.2 · [UX-기획.md](UX-기획.md) v0.2 · [MVP_모델.md](../MVP_모델.md) · 불변식 [CLAUDE.md](../../CLAUDE.md). 산출물 위치: `docs/planning-artifacts/`.

> ⚠️ 스택 미확정(greenfield). 아래 **권장 기본**은 제안이며, **M1 게이트** 항목(§9)은 미결정으로 명시. 법적 서술은 리스크 분석이며 법률 자문 아님.

---

## 1. 아키텍처를 지배하는 제약 — 5대 법적 불변식

아키텍처의 1순위 입력은 기능이 아니라 **불변식**이다. 각 불변식을 *구조로* 강제한다("약관 한 줄"이 아니라 코드/스키마/배포로).

| # | 불변식 | 구조적 강제 방식 |
|---|---|---|
| 1 | **무크롤링(UGC 포함)** | 서버/클라에 외부 사이트 수집기(스크래퍼·헤드리스·cron fetch) **부재**. 정가는 **네이버쇼핑 API**만. 시드는 **운영자 수동 입력 엔드포인트**만. CI 컴플라이언스 스캔(`knockedu-qa`)이 위반 패턴 차단 |
| 2 | **자금 미보유** | 결제는 **비수탁(non-custodial) 어댑터**. 플랫폼 명의 계좌/PG 가맹점 **없음**. 서버는 잔액·정산·환불 로직 **미보유** — 외부 안전결제 **딥링크 생성/상태 안내**만 |
| 3 | **통신판매중개 최소 의무** | `IntermediaryNotice` 컴포넌트를 거래/요청/소식/채팅에 **필수 렌더**. **신고·분쟁 채널** + **상대 신원정보 제공 엔드포인트** 상시. 직접거래 계약 이행은 미추적 |
| 4 | **가격 = UGC + 현장확인가만** | 스키마에서 `DiscountPost`(미검증)와 `VerifiedPrice`(대행자 책임)를 **분리**. 정가 미입력 시 서버가 **`기준가 미확인` 플래그 자동 부여**. 플랫폼 생성 가격 **없음** |
| 5 | **외부링크 보증 금지 / 위치 비실시간** | 링크 "검증·보증" 서비스 **부재**(경고 문구만). 사용자 위경도 **미저장** — 위치는 **동/지역 텍스트**만 |

이 다섯이 모듈 경계·스키마·CI 게이트·코드리뷰(`security-auditor`)에 박혀 있어야 한다.

---

## 2. 의사결정 로그 (이번 세션 확정)

| 결정 | 값 | 상태 | 근거 |
|---|---|---|---|
| 지도 SDK | **네이버 지도(Naver Maps JS v3 / Web Dynamic Map)** | ✅ 확정 | 국내 POI·지오코딩 품질, 사용자 지정 |
| 코드 저장소 | **GitHub `kennykim78/outget`** | ✅ 확정 | 사용자 지정 |
| 데이터 저장소(DB) | PostgreSQL (관계형) | 🟡 제안 | 매칭·거래·UGC의 관계·상태머신에 적합. 확정 전이라 ORM으로 추상화 |
| 외부 P2P 안전결제 제공자 | (네이버페이/토스/KCP 등) | ⛔ **보류(M1)** | 약관의 구매대행 허용 서면확답 전까지 미선정 → **결제 어댑터 추상화**로 흡수 |

---

## 3. 권장 스택 (제안)

| 레이어 | 권장 | 근거 / 대안 |
|---|---|---|
| **클라이언트** | **Vite + React + TypeScript, 모바일우선 PWA(≤480px shell)** | UX-기획의 양면 보드·채팅·폼 중심. 팀 타 앱과 정합. 대안: Next.js(SSR 필요 시) |
| 지도 | **네이버 지도 JS SDK** + 마커 클러스터링 | 확정. 키는 클라 env, 도메인 제한 |
| 클라 상태 | React Query(서버 상태) + 경량 store(Zustand) | 매칭·채팅 실시간성 |
| **서버** | **Node + NestJS(or Express) thin REST 서버 + TypeScript** | 리스트/매칭/UGC/신고/auth/결제 딥링크 브로커링. 의도적으로 얇게 |
| **DB** | PostgreSQL + Prisma(ORM) | 🟡 제안. ORM으로 교체 가능하게 |
| 실시간(채팅) | 1차 폴링/SSE → 2차 WebSocket | MVP는 단순. 채팅은 매칭 후 한정 |
| 인증 | JWT(access+refresh) + 역할 | 구매자/개인대행자/전문대행자/소식알림자/운영자 |
| 외부 결제 | **PaymentRail 포트(어댑터)** — 비수탁 딥링크 | 제공자 보류 → 인터페이스만 고정, 구현은 M1 후 |
| 정가 조회 | 네이버쇼핑(검색) API | 크롤링 대체 |
| 배포 | 클라: 정적호스팅(Vercel/Netlify/CF Pages) · 서버: 컨테이너 호스트 · DB: 관리형 PG | 🟡 제안(§9) |
| CI | GitHub Actions — lint/typecheck/build/test + **컴플라이언스 스캔** | `knockedu-qa` 게이트를 CI에 배선 |

---

## 4. 시스템 구성도 (논리)

```
[모바일 PWA 클라이언트]
  ├─ 지도 양면 보드(대행자/요청/할인 토글) ── 네이버 지도 SDK
  ├─ 매칭 채팅 + 거래방식 선택(직접/안전결제 딥링크)
  ├─ UGC 폼(할인소식·현장확인가·바운티) · 신고 버튼
  └─ IntermediaryNotice(상시) · 가격 위계(미검증/확인가)
        │  REST/HTTPS (자사 API만)
        ▼
[Thin REST 서버 (Node)]
  ├─ Listings/Requests/Match/Chat
  ├─ UGC(DiscountPost/VerifiedPrice) + `기준가 미확인` 스탬프
  ├─ Report → Blind 상태머신(notice-and-takedown)
  ├─ Bounty/Badge(무금전) · AgentProfile(개인/전문 인증)
  ├─ Auth(JWT) · 신원정보 제공 엔드포인트
  └─ PaymentRail 어댑터 ──(딥링크/상태만, 자금 미경유)──▶ [외부 P2P 안전결제] (M1)
        │
        ▼
[PostgreSQL]  ── *내 소유* 데이터만(시드·거래·UGC). 외부 원문/위경도 미저장
        ▲
[네이버쇼핑 API] ──(정가 조회, 서버 or 클라)── 크롤링 아님
```

핵심: 클라이언트는 **자사 API + 네이버 지도 + (선택)안전결제 딥링크**만 호출. **자금/외부 원문/실시간 위치는 어디에도 적재되지 않는다.**

---

## 5. 데이터 모델 (PRD §8 → 물리 스케치)

PostgreSQL 기준. 모든 데이터는 *내 소유*(시드/거래/UGC).

- **users**(id, role[구매자/개인대행자/전문대행자/소식알림자/운영자], …)
- **agent_profiles**(user_id, status[개인/전문], biz_name?, biz_no?, contact?, active_region, schedule_text, reputation)
- **requests**(id, buyer_id, item, options, hope_price, deadline, region, status[대기·채택·매칭·진행·종료])
- **matches**(id, request_id, agent_id, deal_method[직접/안전결제], chat_thread_id, status)
- **messages**(id, thread_id, sender_id, body, created_at)
- **discount_posts**(id, author_id, store/brand, discount_rate?, discount_price?, list_price?, **unverified_base flag**, source, photo(직접촬영), created_at)
- **verified_prices**(id, item_ref, price, agent_id, verified_at)
- **bounties**(id, requester_id, mission, status) / **bounty_submissions**(id, bounty_id, solver_id, photo, taken_at, badge)
- **reports**(id, target_type, target_id, reason, status[정상·블라인드·이의·복구·삭제]) / **disputes**(id, match_id, reason, evidence, status)
- **badges**(user_id, type, granted_at)

> 제약: `discount_posts.list_price` NULL이면 `unverified_base=true` 자동(트리거/서비스 레벨). 사용자 위경도 컬럼 **없음**. 외부 원문 본문/이미지 저장 **없음**(사진은 직접 촬영 업로드만).

---

## 6. 컴포넌트별 결정

### 6-1. 클라이언트
- **지도 양면 보드**가 핵심 — 토글(대행자/요청/할인) + 네이버 마커 클러스터. 데이터-페치와 표현 분리.
- **가격 위계 컴포넌트**: `VerifiedPriceCard`(✅·강조) vs `DiscountPost`(미검증·`기준가 미확인` 칩) — 색 단독 의존 금지.
- **PaymentChoice**: 직접/안전결제. 안전결제=외부 딥링크. **링크 검증 UI 없음**, 경고만.
- 오프라인/빈 상태: PWA 셸 + EmptyState(가짜 채움 금지).

### 6-2. 서버 (thin)
- REST 리소스: requests/matches/messages/discount-posts/verified-prices/reports/disputes/agent-profiles/bounties.
- **신고→블라인드 상태머신**을 서버 권위로(임시조치 즉시, 이의/재게시 경로).
- **PaymentRail 포트**: `createCheckoutLink(deal) / getStatus()` 인터페이스만. 구현체는 M1 후. **자금 미경유** 계약을 인터페이스 주석+테스트로 못박음.
- 신원정보 제공·고지 데이터 제공 엔드포인트(통신판매중개 의무).

### 6-3. 외부 통합
- **네이버 지도**: 클라 SDK, 키 도메인 제한. 지오코딩도 네이버 사용 가능.
- **네이버쇼핑 API**: 정가 보조. rate-limit·에러 graceful. **크롤링 대체이지 크롤링 아님.** *(구현됨 2026-06-09 — `server/src/shopping/naver.shopping.adapter.ts` 서버측 단일 어댑터, 호스트 openapi.naver.com 하나, 키 없으면 noop 폴백. DiscountPost에 참고가 4필드 서버 스탬프, 카드에 면책 3요소 강제 렌더. 키 발급은 M1 사용자 작업.)*
- **외부 P2P 안전결제(M1)**: 어댑터 뒤로. 제공자 약관 서면확답 전까지 **'직접거래 + 안내'만으로도 MVP 가동 가능**하게 설계(결제 어댑터 no-op/안내 모드).

---

## 7. 횡단 관심사

- **보안:** 키/시크릿 서버·env(커밋 금지, `.gitignore` 적용). JWT 만료·갱신. UGC/채팅 XSS·인젝션 방어. CORS 오리진 게이팅. HTTPS 강제.
- **개인정보/위치:** 위경도 미저장. 위치=지역 텍스트. 영수증/제보 개인정보 마스킹.
- **성능:** 지도/리스트 비동기·스켈레톤, 마커 클러스터링, 코드 스플리팅.
- **테스트:** `knockedu-test` 우선순위 — 매칭 상태머신·가격 라벨 규칙·거래방식 분기·고지 렌더 + **컴플라이언스 불변식 테스트**.
- **CI 게이트:** GitHub Actions에 lint/typecheck/build/test + `knockedu-qa` 컴플라이언스/시크릿 스캔. 위반 시 머지 차단.

---

## 8. 배포 & 저장소

- **저장소:** GitHub `kennykim78/outget` (확정). 모노레포 권장(`/client`, `/server`, `/docs`). BMAD 툴링(`_bmad/`)·개인 설정은 `.gitignore` 제외.
- **베타 배포(확정):** **동일 오리진 단일 컨테이너** — 서버가 `/api`·`/auth` + 빌드된 SPA(`client/dist`)를 함께 서빙(apiFetch 상대경로 전제 충족, CORS 불필요). DB=SQLite + `/data` 볼륨(`file:/data/prod.db`), 기동 시 `prisma migrate deploy`. SPA 정적 서빙은 `NODE_ENV==='production'` 게이팅이라 test/dev 동작(404·CSP)은 불변. SPA HTML 응답 CSP 의 외부 출처는 네이버 지도뿐(불변식 ①).
- **배포(이후 확장, M1에서 확정):** 클라=정적 호스팅(Vercel/CF Pages, PWA) · 서버=컨테이너(Fly/Render/Railway) · DB=관리형 PostgreSQL · 환경별 키 분리.
- **브랜치/CI:** main 보호 + PR + Actions 게이트.

---

## 9. 미해결 — M1 게이트 (구현 전 확정)

| 항목 | 상태 | 비고 |
|---|---|---|
| **외부 P2P 안전결제 제공자** | ⛔ 보류 | 약관의 **구매대행 허용 서면(메일) 확답** 후 어댑터 구현. 그 전엔 '직접거래+안내' 모드 |
| **데이터 저장소 확정** | 🟡 제안(PostgreSQL) | ORM 추상화로 교체 여지 |
| **호스팅/배포 타깃** | 🟡 제안 | 클라/서버/DB 호스트 선정 |
| **법률 자문** | 진행 필요 | 통신판매중개 책임·개인대행자 사업자등록 임계·UGC 표시광고/저작권 |
| **앵커 지역** | 미정 | 여주/김포 — 아키텍처 비종속 |

---

## 10. 다음 단계
1. M1 게이트 해소(특히 안전결제 서면확답·스택 최종확정).
2. `bmad-create-epics-and-stories` — EPIC A~I·S를 스토리로 분해.
3. 스택 확정 시 `knockedu-*` 도구 스킬에 실제 명령 배선(CLAUDE.md 변경이력 기록).
4. `knockedu-build` 하네스로 스토리별 구현 → 불변식 게이트 검증.

## 변경 이력
| 날짜 | 변경 | 사유 |
|---|---|---|
| 2026-06-08 | 아키텍처 v0.1 — 5대 불변식 제약, 네이버 지도·GitHub 저장소 확정, PostgreSQL/PWA/thin server 제안, 결제 어댑터(비수탁) 추상화, 안전결제 제공자 M1 보류 | PRD/UX v0.2 기반 솔루션 설계. 사용자 결정(네이버 지도·GitHub·결제 보류) 반영 |
