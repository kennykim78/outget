# Outget (아웃겟) — 문서 색인

지도 기반 아울렛 구매대행 **매칭 보드**(당근형 양면). 모든 기획 문서는 이 `docs/` 한 곳에 모여 있다.
*(프로젝트 하네스 지침은 루트 [../CLAUDE.md](../CLAUDE.md) — Claude Code가 루트에서 로드하므로 여기 두지 않음.)*

## 현행 문서 (권위순)

| 문서 | 성격 | 비고 |
|---|---|---|
| [Outget-개요.md](Outget-개요.md) | 제품 개요 | 한눈에 보는 정체성·불변식·플로우·범위·리스크 |
| [planning-artifacts/PRD.md](planning-artifacts/PRD.md) | **제품 요구사항 정의서 v0.2** | 권위 문서. EPIC·FR/NFR·성공지표·마일스톤 |
| [planning-artifacts/UX-기획.md](planning-artifacts/UX-기획.md) | **UX 기획 v0.2** | 화면·플로우·컴포넌트·카피 |
| [planning-artifacts/architecture.md](planning-artifacts/architecture.md) | **아키텍처 v0.1** | 스택·불변식 제약·데이터모델·M1 게이트 |
| [planning-artifacts/epics.md](planning-artifacts/epics.md) | **에픽·스토리 v0.1** | 10 에픽·24 스토리(AC에 5대 불변식) |
| [planning-artifacts/M1-게이트.md](planning-artifacts/M1-게이트.md) | **M1 게이트** | 안전결제 문의 메일·법률 질의서·DB/호스팅/앵커 권고 |
| [MVP_모델.md](MVP_모델.md) | 사업모델 캐논 | 5턴 수렴 의사결정 이력(일부는 PRD가 갱신) |

## 폴더 구조

```
docs/
  README.md                  ← 이 색인
  Outget-개요.md              ← 제품 개요
  MVP_모델.md                 ← 사업모델 캐논(이력)
  planning-artifacts/         ← BMAD 산출물(output_folder=docs)
    PRD.md · UX-기획.md        ← + 향후 architecture·epics·stories
  implementation-artifacts/   ← BMAD 구현 산출물(향후)
  legacy/                     ← 피벗 전 자료(참고용)
    교육포털-타당성-기획서.md
    학원데이터랩-MASTER-PRD.md
```

## 작성 규칙
- 새 기획 산출물(아키텍처·에픽·스토리)은 `bmad-*` 스킬이 **`docs/planning-artifacts/`** 에 생성(BMAD `output_folder=docs`로 고정 — [../\_bmad/custom/config.toml](../_bmad/custom/config.toml)).
- legacy 폴더는 **수정하지 않음**(피벗 전 기록 보존용).
- 권위는 PRD/UX v0.2 → MVP_모델.md(이력) 순.

## 변경 이력
| 날짜 | 변경 |
|---|---|
| 2026-06-08 | 문서 통합 — `doc/`·루트 `KNOCKEDU.md`·`docs/bmad/`에 흩어진 문서를 `docs/` 한 곳으로 모으고 명칭 정리(KNOCKEDU.md→Outget-개요.md, 참조.md→legacy/학원데이터랩-MASTER-PRD.md). BMAD output_folder `docs/bmad`→`docs`. |
