# WithSmall (위드스몰) — 문서 색인

작은 반려동물(골든햄스터부터) 사육 준비·관리 오케스트레이션. 프로젝트 지침과 불변식 요약은 루트 [../CLAUDE.md](../CLAUDE.md), 시작 방법은 [../README.md](../README.md).

## 권위 문서 (우선순위 순)

| # | 문서 | 버전 | 성격 |
|---|---|---|---|
| 1 | [WithSmall-제품기획-v0.2.md](WithSmall-제품기획-v0.2.md) | v0.2.4 (동결) | 정의, 불변식, 데이터 모델, 아키텍처, 복구 순서, 백로그 |
| 2 | [planning-artifacts/PRD.md](planning-artifacts/PRD.md) | v1.3.1 | US-001~026 수용 기준, 부록 A(specSchema/minSpec/CompatibilityRule), 부록 B(시드 공통 필드) |
| 3 | [planning-artifacts/UX-기획.md](planning-artifacts/UX-기획.md) | v2.3.1 | 내비, 흐름, 레이어(L1~L8), 반응형, 홈 2종 |
| 4 | [planning-artifacts/디자인-브리프.md](planning-artifacts/디자인-브리프.md) | v2.3.1 | 시각 규칙 원본 (토큰·마스코트·캔버스는 `design/`) |
| 5 | [planning-artifacts/골든햄스터-콘텐츠-시드-v1.0.md](planning-artifacts/골든햄스터-콘텐츠-시드-v1.0.md) | v1.0 | 첫 동물 콘텐츠 시드 (DRAFT) |
| 6 | [planning-artifacts/이미지-소싱.md](planning-artifacts/이미지-소싱.md), [planning-artifacts/베타-후기-수집.md](planning-artifacts/베타-후기-수집.md) | — | 운영 절차 |

## 보조 기획 문서 (docs/)

- [WithSmall-서비스기획서.md](WithSmall-서비스기획서.md)
- [WithSmall-피벗-타당성-기획-v0.1.md](WithSmall-피벗-타당성-기획-v0.1.md)

## design/ — 디자인 시스템

- [design/README.md](design/README.md): 디자인 시스템 안내
- [design/CANVAS.md](design/CANVAS.md): 캔버스 보드 설명
- [design/tokens.json](design/tokens.json): 디자인 토큰
- `design/canvas/`, `design/components/`, `design/mascots/`: 캔버스 보드, 컴포넌트, 마스코트 자산

## ops/ — 운영

- [ops/deploy.md](ops/deploy.md): 배포·운영 절차 (환경 변수 표의 원본은 루트 `.env.example`)

## planning-artifacts/ — 기획 산출물

- 핵심 문서: [PRD.md](planning-artifacts/PRD.md), [UX-기획.md](planning-artifacts/UX-기획.md), [디자인-브리프.md](planning-artifacts/디자인-브리프.md), [클로드코드-킥오프.md](planning-artifacts/클로드코드-킥오프.md)
- 시드: [골든햄스터-콘텐츠-시드-v1.0.md](planning-artifacts/골든햄스터-콘텐츠-시드-v1.0.md), [드워프햄스터-콘텐츠-시드-v0.1.md](planning-artifacts/드워프햄스터-콘텐츠-시드-v0.1.md), 시드 JSON 초안 폴더 [seed-draft/](planning-artifacts/seed-draft)
- 검수 자료: [골든햄스터-핵심행-확인표.md](planning-artifacts/골든햄스터-핵심행-확인표.md), [드워프햄스터-핵심행-확인표.md](planning-artifacts/드워프햄스터-핵심행-확인표.md), [드워프햄스터-검수-패킷-v0.3.md](planning-artifacts/드워프햄스터-검수-패킷-v0.3.md) (v0.2도 같은 폴더), [저빌-핵심행-확인표.md](planning-artifacts/저빌-핵심행-확인표.md), [기니피그-핵심행-확인표.md](planning-artifacts/기니피그-핵심행-확인표.md)
- 이미지: [이미지-소싱.md](planning-artifacts/이미지-소싱.md), [이미지-대장.md](planning-artifacts/이미지-대장.md)
- 후기: [베타-후기-수집.md](planning-artifacts/베타-후기-수집.md)

## legacy/ — 피벗 전 자료 (수정하지 않음)

- [legacy/outget/](legacy/outget): Outget 문서 (CLAUDE-outget.md, PRD.md, UX-기획.md, architecture.md, epics.md, M1-게이트.md)
- [legacy/교육포털-타당성-기획서.md](legacy/교육포털-타당성-기획서.md), [legacy/학원데이터랩-MASTER-PRD.md](legacy/학원데이터랩-MASTER-PRD.md)
- 피벗 이전 문서(보관): [Outget-개요.md](../_archive/202610/Outget-개요.md), [MVP_모델.md](../_archive/202610/MVP_모델.md)
- 보관 색인: [../_archive/INDEX.md](../_archive/INDEX.md)

## 작성 규칙

- legacy 폴더는 수정하지 않는다 (피벗 전 기록 보존).
- 충돌 시 위 권위 문서 순서(1에서 6)를 따른다.
