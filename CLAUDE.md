# WithSmall (위드스몰) — 소동물·앵무새 사육 준비·구매·관리 오케스트레이션

작은 반려동물(골든햄스터부터)을 처음 준비할 때 **무엇이 필요하고 무엇은 지금 필요 없는지를 종별 기준으로 먼저 결정해 주고**, 규격을 숫자로 판정하고, 기준에 맞는 준비물과 진료 병원까지 한곳에서 잇는 서비스. 정보 사이트도 쇼핑몰도 분양 플랫폼도 아니다 — **"겉은 서비스, 속은 도구."** Outget(지도 기반 아울렛 구매대행 보드)에서 피벗했다. Outget 문서는 `docs/legacy/outget/`.

**권위 문서(동결·이 순서로 우선):**
1. `docs/WithSmall-제품기획-v0.2.md` **v0.2.3** — 정의·불변식·데이터 모델·아키텍처·복구 순서 §7.4·백로그 §9
2. `docs/planning-artifacts/PRD.md` **v1.3** — US-001~026 수용 기준, 부록 A(specSchema/minSpec/CompatibilityRule JSON), 부록 B(시드 공통 필드)
3. `docs/planning-artifacts/UX-기획.md` **v2.3.1** — 상단 내비 + 상하 흐름 + 가로 레일 + 레이어(L1~L8), 반응형 3단, 홈 2종(미선택 4섹션 / 선택 컨텍스트 헤더+5섹션)
4. `docs/planning-artifacts/디자인-브리프.md` v2.3.1 + `docs/design/`(디자인 시스템 토큰·마스코트·캔버스 보드 HTML) — 시각 규칙의 원본
5. `docs/planning-artifacts/골든햄스터-콘텐츠-시드-v1.0.md` + `seed-draft/*.json` — 첫 동물 시드(DRAFT)
6. `docs/planning-artifacts/이미지-소싱.md` · `베타-후기-수집.md` — 운영 절차

**Stack(유지, 프레임워크 이전 없음):** npm workspaces 모노레포 — `client`(Vite+React+TS PWA) · `server`(Express ESM, TS) · **SQLite+Prisma**(M2 Postgres) · 동일 오리진 단일 컨테이너 · **빌드 타임 프리렌더**(`scripts/prerender.mjs`, 시드 → 정적 HTML + 하이드레이션) · 네이버 지도 JS v3(병원 페이지만) · Vitest(server+client) · GitHub Actions + `scripts/compliance-scan.mjs`. Phase 0에 **AI 코드 0줄**(AI는 운영자의 초안 도구일 뿐, 시스템엔 `reviewerType=AI_DRAFT` 라벨만 남는다).

## 구조적 불변식 (매 변경에서 지킨다 — 제품기획 §2)

1. **상품·외부 사이트 크롤링 금지.** 가격·규격·이미지를 자동 수집하지 않는다. 링크·검색 딥링크·제휴 API(약관 내)만. 이미지는 운영자가 사용권을 확인한 것만(`imageLicense`/`source`·`license` 기록).
2. **플랫폼은 입양자를 선별·매칭하지 않는다.** 재입양은 Phase 4+ 게시판+절차 도구까지. 동물 거래·분양·신청서 모델 없음.
3. **최소 규격 미달 제품은 돈을 받아도 추천 영역에 넣지 않는다.** `CuratedProduct.meetsMinSpec`은 빌드 시 `specCheck`로 재계산, 불일치면 validate 실패. 노출 순서 규격 → 검수 → 선호 고정.
4. **플랫폼 자금 미보유.** 결제·에스크로·정산 코드 0.
5. **의료 판단 금지.** "병원에 문의할 상황"까지만. 콘텐츠 린트 금지어: 괜찮다·안전하다·최저가·판매순·베스트·정확도·전문가 N명·회원가입·구매.
6. **사육·법적 정보는 마스터 데이터가 결정.** `AnimalType(사용자 언어) → Taxon(법) → CareProfile(사육) → SupplyRequirement → SupplyItem`. 셋을 섞지 않는다. 최종값 계산은 `resolveRequirement` 한 곳(SupplyItem 기본 → SupplyRequirement → AnimalType.careOverrides).
7. **콘텐츠는 출처·검수자 유형·검수일·상태를 갖는다.** VERIFIED만 노출. contentKind별 최소 검수 등급(SPEC/CARE ≥ EXPERIENCED_KEEPER, FOOD/HEALTH ≥ VET_PUBLISHED_SOURCE + 출처 2). **`AI_DRAFT`는 어떤 경우에도 VERIFIED가 될 수 없다.** 후기(Testimonial)는 `APPROVED ∧ verifiedUsage`만, 임의·AI 작성 금지.
8. **실시간 위치 저장 안 함.** 시군구 텍스트 + 게시글 옵션 핀.

## 하네스: WithSmall delivery (다중 에이전트)

**목표:** Plan → implement → adversarially verify. 실제 build/test 증거 없이는 어떤 것도 "done"으로 보고하지 않는다. 위 불변식을 매 변경에서 지킨다. **Kenny의 판단이 필요한 것 외에는 오케스트레이터가 판단·디자인 조율·지시·개발까지 관할한다**(결정 권한 매트릭스는 `withsmall-build` 스킬).

**트리거:** WithSmall에서 무언가를 구현·추가·변경·수정·리팩터·시드·복구·배포하라는 요청 — 및 후속(다시/재실행/업데이트/보완) — 이면 **`withsmall-build`** 오케스트레이터 스킬을 사용하라. 단순 질문·사소한 단일 편집은 직접 응답 가능.

**팀과 모델 등급:**
| 에이전트 | 모델 | 역할 |
|---|---|---|
| (메인 스레드) 오케스트레이터 | **opus** | 판단·계획 승인·디스패치·게이트·결정 로그 |
| `architect` | **opus** | 분해·영향 범위·불변식 위험 플래그 |
| `backend-engineer` | **opus** | 서버(Prisma·시드 로더·엔진 `resolveRequirement/specCheck/buildSearchKeyword`·API·프리렌더) |
| `frontend-engineer` | **opus** | 클라이언트(홈 2종·레일·레이어 L1~L8·병원·반응형) |
| `design-liaison` | **opus** | 디자인 시스템·캔버스 → 구현 스펙 변환, 화면 검수(브리프 체크 10항목), 디자인 조율 결정 |
| `qa-verifier` | **opus** | 모든 "done" 주장을 적대적으로 재현·검증, 불변식 스캔 |
| `security-auditor` | **opus** | 컴플라이언스·시크릿·콘텐츠 노출 규칙 감사(읽기 전용) |
| `small-dev` | **sonnet** | 크지 않은 개발: 단일 파일·카피·토큰·테스트 보강·시드 JSON 편집·스크립트 |
| `content-curator` | **sonnet** | 시드 검증·콘텐츠 린트·출처 형식·검수 상태 전이(내용 창작 금지) |
| `refactorer` | **sonnet** | 동작 변경 없는 정리 |

도구 스킬(결정론·저토큰): `knockedu-qa`(게이트) · `knockedu-run` · `knockedu-test` · `knockedu-screens`(390/1280) · `knockedu-contract` · `knockedu-impact`. 폴더명은 세션 등록 호환을 위해 `knockedu-*` 유지, 내용은 WithSmall.

**기획(BMAD) / 규율(Superpowers):** 기획 산출물은 `bmad-*` → `docs/planning-artifacts/`. 브레인스토밍·TDD·검증 규율은 `superpowers:*`. 구현과 권위 있는 QA 게이트는 `withsmall-build`.

**작업 공간:** `_workspace/{step}_{agent}_{artifact}.md` + `_workspace/decisions.md`(오케스트레이터 결정 로그 — Kenny가 나중에 뒤집을 수 있게 근거 포함).

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-06-07~09 | Outget 하네스 구축·재배선·Epic 1~6 구현(상세는 `docs/legacy/outget/CLAUDE-outget.md`) | 전체 | — |
| 2026-09-30 | **피벗: Outget → WithSmall.** 불변식을 제품기획 v0.2.3 §2로 교체. 기획 문서(제품기획·PRD v1.3·UX v2.3.1·브리프·시드 스펙·이미지/베타 절차) 작성, 디자인 시스템 v1.2·캔버스 v14를 `docs/design/`로 내보냄 | 문서·불변식·design | 분양 플랫폼은 법적으로 무리(동물판매업 알선·중개) → 사육 준비 오케스트레이션으로 정의 |
| 2026-09-30 | **하네스 재배선(Outget→WithSmall) + 모델 등급제.** 오케스트레이터 `withsmall-build`(결정 권한 매트릭스·라운드 R0~R6), 에이전트 6→9(`design-liaison`·`small-dev`·`content-curator` 신설), opus/sonnet 등급 지정, 도구 스킬 내용 교체, `settings.json` 기본 모델 opus | .claude/*, CLAUDE.md | Kenny 판단 외 전부 자율 진행 요구. 코드 복구(§7.4)부터 Claude Code에서 일괄 진행 |
