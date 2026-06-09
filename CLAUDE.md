# Outget (아웃겟) — 지도 기반 아울렛 구매대행 매칭 보드(당근형 양면)

오프라인 아울렛 정보를 **지도 위**에 모으고, 당근마켓처럼 **현장 구매대행자와 구매자의 리스트를 지도에서 매칭**하는 보드. 플랫폼은 *정보·매칭만* 제공하고 **결제·계약 당사자가 아니다.** 데이터를 긁지 않고 **창업자 시드 + 거래·UGC가 내 소유 데이터를 축적**한다("거래가 데이터를 만든다"). 상세는 [docs/Outget-개요.md](docs/Outget-개요.md)(제품 개요) · [docs/MVP_모델.md](docs/MVP_모델.md)(캐논 사업모델) · [docs/planning-artifacts/](docs/planning-artifacts/)(PRD·UX) 참조. 전체 색인은 [docs/README.md](docs/README.md).

> **코드네임 안내:** 프로젝트 코드네임/폴더는 `knockedu`(legacy, 교육포털 LECV에서 피벗) → 폴더 `outget`. 제품명은 **Outget**. 하네스 스킬은 아직 `knockedu-*` 이름을 유지(리네이밍은 미실행 — 아래 *하네스 재배선* 참조).

**Stack (Epic 1 확정):** 모노레포 **npm workspaces** — `client`(Vite+React+TS **PWA**) · `server`(**Express** thin, TS, ESM). DB는 **인메모리 stub**(Postgres는 후속·M1). 지도=**네이버 지도 JS v3**. 테스트=server **Vitest**(client 단위·E2E 미배선). CI=**GitHub Actions** + `scripts/compliance-scan.mjs`. 도구 스킬(`knockedu-qa`/`-run`/`-test`) 실명령 배선 완료(`-impact`/`-contract`는 grep 기반).

## 법적 불변식 (매 변경에서 지킨다)

피벗으로 불변식이 **포털 데이터 비적재** → **마켓플레이스 컴플라이언스**로 바뀌었다.

1. **No crawling — UGC 포함.** 자동 수집(지속·일회성) 모두 금지. 시드는 *창업자 수동 큐레이션*(공식 채널 **사실/텍스트**만, 이미지는 **직접 촬영분만**) + 현장 출동 + UGC. UGC도 타 출처 본문·이미지 **불펌 금지** → 신고 시 **즉시 블라인드(notice-and-takedown)**.
2. **Platform holds no funds.** 통합 에스크로 미보유. 결제는 **직접거래 + 외부 P2P 안전결제(페이링크류, 예: 네이버페이/토스/KCP)** 병행, 자금이 플랫폼을 경유하지 않음. **외부 링크 안전성은 보증·검증하지 않음**(링크 검증기 미도입 — 주의의무 인수 회피). 직접거래엔 선입금 사기 경고.
3. **통신판매중개자, not 판매자.** 거래 당사자가 아님을 화면마다 고지(전상법 §20). 가격확정·결제·배송 비관여. **단, 최소 의무는 유지**(고지·요청 시 신원정보 제공·분쟁 신고 채널) — *완전 블라인드 금지*(§20-2 방치→연대책임). 면책은 약관이 아니라 구조로.
4. **가격 = UGC + 현장확인가만(플랫폼 가격 주장 금지).** 할인 정보는 전부 **UGC 할인소식**("미검증 제보"·출처·정가 미입력 시 `기준가 미확인` 자동 라벨, 할인 부분 중심)과 대행자 **현장 확인가**(✅·책임 귀속). 둘을 시각·문구로 명확 분리(표시광고법 방어).
5. **대행자 지위 + 거래 무결성.** 대행자는 **개인(비사업자)/전문(사업자 인증)** 구분, 개인엔 "반복 영리 시 사업자등록 의무" 상시 고지. 공동대행은 **사입·세무 경고 + 결제후구매 안내**로 방어(직접거래라 시스템 강제 불가 → 고지로). 바운티는 **무금전(뱃지)**.

## 하네스: Outget feature delivery

**목표:** Plan → implement → adversarially verify. 실제 build/test 증거 없이는 어떤 것도 "done"으로 보고하지 않는다. 그리고 위 **법적 불변식**을 매 변경에서 지킨다.

**트리거:** Outget에서 무언가를 구현·추가·변경·수정·리팩터·배포하라는 요청 — 및 후속(다시/재실행/업데이트/보완) — 이면 `knockedu-build` 오케스트레이터 스킬을 사용하라. 전문 에이전트(`architect`, `frontend-engineer`, `backend-engineer`, `qa-verifier` + on-demand `security-auditor`/`refactorer`)와 `knockedu-*` 도구 스킬을 dispatch한다. 단순 질문·사소한 단일 편집은 직접 응답 가능.

**팀:** 6 에이전트 — `architect`(계획) → `frontend-engineer`(지도 양면 보드·채팅·UGC 폼) / `backend-engineer`(리스트/매칭/UGC·신고-블라인드·외부 안전결제 브로커링) → `qa-verifier`(불변식 게이트) + on-demand `security-auditor`(컴플라이언스)·`refactorer`. 도구 스킬 6 + 오케스트레이터 `knockedu-build`. *ML 없음*(MVP에 광고필터·자동정제 없음).

> **스킬 네이밍:** 폴더명은 `knockedu-*`(legacy) 유지 — 세션 중 Skill 도구가 등록된 이름으로만 호출 가능하기 때문. 내용은 전부 Outget 기준으로 재배선됨. `outget-*` 일괄 rename은 다음 세션 시작 시 가능(내부 식별자라 가시성 낮음).

**기획(BMAD) / 규율(Superpowers):** PRD·아키텍처·UX·스토리 등 기획 산출물은 `bmad-*` 스킬 → `docs/planning-artifacts/`(BMAD output_folder=`docs`). 브레인스토밍·TDD·검증 규율은 `superpowers:*` (user-global). 구현과 권위 있는 QA 게이트는 이 하네스(`knockedu-build`)가 담당한다 — BMAD/Superpowers 리뷰 스킬은 보조 렌즈.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-06-07 | 초기 구성 — 7 에이전트 + `knockedu-build` 오케스트레이터 + 7 도구 스킬 + 2 워크플로우. BMAD(bmm) 설치, Superpowers(user-global) 연계 | 전체 | pigout_us(rxloop) 하네스를 LECV 도메인에 맞춰 신규 구축. 스택 미정이라 도구 스킬은 골격(skeleton) 모드 |
| 2026-06-08 | **피벗: 교육포털(LECV) → 아울렛 구매대행 마켓플레이스(Outget).** 법적 불변식을 포털 비적재 → 마켓플레이스 컴플라이언스(무크롤링·자금 미보유·통신판매중개·2층 가격)로 전면 교체. 폴더 `knockedu`→`outget`, 제품명 Outget 확정. 완전 무크롤링 결정. CLAUDE.md/KNOCKEDU.md 갱신 + 기획서·UX 작성 | 문서·불변식 | (카)목/저작권·DB권 리스크가 사업 생존을 가른다는 결론 → "거래가 데이터를 만드는" 구조로 전환. 하네스 코드 재배선은 미실행(pending) |
| 2026-06-08 | **당근형 양면 매칭 보드로 수렴.** 불변식 갱신: 통합 에스크로 폐기→직접+외부 P2P 안전결제(자금 미보유·링크 보증 안 함), 2층 가격→UGC 할인소식(미검증 라벨)+현장확인가, UGC notice-and-takedown, 대행자 지위구분(개인/전문)·바운티 뱃지·통신판매중개 최소 의무 유지 추가. PRD/UX v0.2 작성, MVP_모델.md 갱신 | 문서·불변식 | 적대적 검증 3턴: 에스크로 폐기는 PG는 회피하나 통신판매중개 책임은 불변, 링크 검증기는 책임 인수 함정 → 사람 중심 당근형으로 수렴 |
| 2026-06-08 | **문서 통합** — `doc/`·루트 `KNOCKEDU.md`·`docs/bmad/`를 `docs/` 한 곳으로(개요/MVP모델/planning-artifacts/legacy + README 색인). BMAD output_folder `docs/bmad`→`docs`(custom/config.toml 고정) | 문서·BMAD설정 | 3곳 분산 + `doc`/`docs` 혼란 해소 |
| 2026-06-08 | **Epic 1(기반) 구현 + 스택 확정.** 모노레포(client PWA/server Express)·JWT 인증 골격·네이버 지도 셸·CI 컴플라이언스 게이트(`scripts/compliance-scan.mjs`). security-auditor가 스캐너 R1/R3 갭 발견→보강. 도구 스킬 `knockedu-qa`/`-run`/`-test` skeleton→실명령 배선 | skills/knockedu-qa·run·test, client/, server/, scripts/, .github/ | 스택 랜딩 → 게이트가 실제 빌드/테스트/스캔으로 작동. GitHub push 완료 |
| 2026-06-08 | **하네스 재배선 완료(LECV→Outget).** `ml-engineer` 에이전트 + `knockedu-filter-eval` 스킬 폐기. security-auditor→Outget 컴플라이언스 불변식, qa-verifier→불변식 게이트(ML eval 제거), backend/frontend/architect/refactorer→당근형 양면 보드, 오케스트레이터·qa/test/contract/run/impact/screens 재배선 | agents/*, skills/knockedu-* | 교육 메타서치 잔재(ML·크롤러·포털)가 구현을 오도. 스킬 폴더명은 세션 호환 위해 `knockedu-*` 유지(내용만 Outget). `feature-audit`/`review` 워크플로우는 프로젝트에 파일 부재(미관리) |
| 2026-06-09 | **네이버쇼핑 참고가 연동(Story 6.1 구현).** 할인소식 등록 시 사용자 검색어로 네이버쇼핑 최저가를 **서버측 단일 어댑터**(`naver.shopping.adapter.ts`, 호스트 openapi.naver.com 하나)로 조회→`referencePrice`/`Source`/`Query`/`FetchedAt` 4필드 서버 스탬프(all-or-nothing). 키 없으면 noop→`기준가 미확인` 폴백. 카드에 제보가 vs 참고가 비교 + 면책 3요소(검색어 기준 최저가·동일상품 보증 아님·시세 변동) 강제 렌더. ShoppingPrice 포트(PaymentRail 패턴). SQLite 마이그레이션 1건(+4 nullable 컬럼) | server/src/shopping/*, board/discount.*, prisma, client/discount·cards, .env.example | 불변식 ④(가격주장 금지)를 지키며 사용자 시세 비교 가치 제공 — 참고가를 "플랫폼 정가"가 아닌 "외부 출처가 보여주는, 검색어 기준 최저가"로 격하. ①(공식 API·크롤링 아님)·시크릿 env-only. qa-verifier 4주장 verified, security-auditor 0 CRIT/HIGH, 212 테스트 |
| 2026-06-09 | **비주얼 디자인 시스템 적용(Claude Design 핸드오프, 타입 A 「동네」).** 코랄 액센트·따뜻한 중립·알약 토글·둥근 카드. 드롭인 CSS 2종(`outget-theme.css` 토큰+셸·보드·카드·가격위계, `outget-theme.forms.css` 폼·채팅·요청·바운티·신고) — 기존 클래스명만 재스타일, 마크업/로직/TS 변경 0, main.tsx에서 index.css 뒤 로드. 원격 Pretendard @import 제거(프로덕션 CSP 충돌 회피→시스템 폰트 폴백). 의미색(확인가 초록/미검증 회색/경고 앰버/위험 적) 브랜드와 분리 고정, 색+아이콘+라벨 병행 유지 | client/src/outget-theme*.css, main.tsx | UX 기획 §8(디자인 시스템=별도 시안)의 다음 단계. 클래스 100% 매칭, 라이브 스모크로 가격위계·면책·중개고지 보존 확인. qa-verifier 지적 2건 수정(--ink-3 대비 4.85~5.7:1로 AA 통과·면책 회귀 해소, 고아 .card__report 제거) |
| 2026-06-09 | **네이버쇼핑 참고가 재설계 + 키 배선 + 지도 인증 수정.** 라이브 스모크에서 "자동 최저가 1건"이 60원 잡템을 집는 문제 발견 → **대화형 검색→사용자 선택→두 가격(대표가+온라인 최저가)** 으로 전환. `GET /api/shopping/search`(auth+role+searchLimiter 30/IP), 클라는 query+productId만 전송→서버 confirm 재조회 스탬프(가격 주입 400), 잡템필터(lprice≥기준가×0.1), 외부 본문(title/image/link/mallName) **DB 미저장**(컴플라이언스 테스트로 잠금), 카드 음수 할인율 가드. 검색 키(server/.env)·지도 키(client/.env) 배선, 지도 인증 파라미터 `ncpClientId→ncpKeyId`(NCP 신버전). 마이그레이션 1건(+3 컬럼) | server/src/shopping/*, board/discount.*, middleware/rate-limit, prisma, client/discount·cards·map, architecture.md | 자동 최저가는 무관 잡템을 집어 참고가 품질·할인율(-98233%) 붕괴 → 사람 선택으로 오인↓. 라이브 e2e 검증(대표가 93,900·최저가 49,000·본문 누출 0·주입 400). qa APPROVED, security 0 CRIT/HIGH(MED 1=limiter 순서 수정 반영), 217 테스트 |
