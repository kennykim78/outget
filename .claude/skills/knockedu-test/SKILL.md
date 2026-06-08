---
name: knockedu-test
description: Scaffold and run automated tests for Outget (아웃겟 — 지도 기반 아울렛 구매대행 당근형 양면 매칭 보드) — client unit/component tests, E2E of the 요청→매칭→채팅→거래방식 flow, server tests for listings/requests/matching/UGC/report routes, and compliance-invariant tests. Use when asked to add tests, set up a test suite, write a unit/integration/E2E test, or check coverage. The project currently has ZERO tests (greenfield).
---

# Testing Outget (아웃겟)

Greenfield: no tests yet, no committed stack. Pick the runner when the stack lands; the test *priorities* below hold regardless. Spec: `docs/planning-artifacts/PRD.md`+`UX-기획.md`.

## Highest-risk units to cover first (test these before breadth)

1. **매칭 상태머신:** Request → 채택 → 매칭 → 진행 → 종료, and 신고 → 블라인드 → 이의/재게시. Pure logic — test all transitions incl. invalid ones.
2. **가격 표시 규칙 (컴플라이언스):** UGC 할인소식에서 **정가 미입력 시 `기준가 미확인` 라벨이 강제로 붙는지**, 현장 확인가와 시각·문구 분리가 유지되는지. A regression here is a 표시광고법 risk — test explicitly.
3. **거래방식 분기:** 직접거래 vs 외부 안전결제 선택 — **결제 금액이 플랫폼을 경유하지 않는지**(자금 미보유), 직접거래에 사기 경고가 노출되는지.
4. **통신판매중개 고지 렌더:** 거래/요청/소식/채팅 화면에 고지 컴포넌트가 항상 존재하는지(스냅샷/존재 테스트).
5. **지오/거리·필터:** 지도 SDK 응답 파싱 + 지역/지위 필터. Pure logic — fixtured responses, incl. malformed/empty.
6. **Server:** listings/requests/matching/UGC/report routes — auth + validation; 외부 안전결제 딥링크 생성이 자금을 보유하지 않는지.

## Compliance-invariant tests (this product's special suite)

Add tests that FAIL if an invariant breaks: no crawler module imported, no platform-account payment path, 고지 컴포넌트 존재, `기준가 미확인` 라벨 경로, no real-time GPS persistence. These complement the static scan in `knockedu-qa`.

## Stack-specific scaffolding (fill in once chosen)

- **Client (likely Vite + React):** Vitest + @testing-library/react + jsdom. Co-locate `*.test.tsx`.
- **E2E:** Playwright. First spec = the core flow: 요청 등록(S4) → 대행자 채택 → 채팅(S5) → 거래방식 선택. Use fixtured external-API responses (지도 SDK·네이버쇼핑·안전결제) so tests are deterministic.
- **Server (likely Node):** runner matching the framework + Supertest for routes.

## Running

Once wired, expose standard commands (`npm test`, `npx playwright test`) and document them here + in `knockedu-qa`.

## Rule

A test that does not assert real behavior is worse than none — it manufactures false confidence. Every test must fail if the behavior it covers breaks. For external-API calls, **always test against fixtures**, never live providers (quota + non-determinism). Show a test passing *and* failing-when-broken before declaring coverage.
