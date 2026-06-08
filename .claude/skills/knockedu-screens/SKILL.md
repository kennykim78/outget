---
name: knockedu-screens
description: Capture every key Outget (아웃겟 — 지도 기반 아울렛 구매대행 당근형 양면 매칭 보드) screen at a mobile viewport for visual UI/UX review, using the Playwright MCP browser. Use when asked to screenshot the app, do a design/UI review, verify the redesigned screens, or compare layout against the plan. Pairs with knockedu-run (app must be serving).
---

# Outget (아웃겟) screen capture & UI/UX review

Drives the running Outget app through every key screen at a phone viewport, screenshots each, and reports a layout-review summary. Requires the **Playwright MCP** server (in `.mcp.json`) and the app serving locally (`knockedu-run`). Use **Chrome DevTools MCP** when the ask is performance/console/accessibility rather than visual layout.

## 0. Preconditions
- Client running locally. If not, run `knockedu-run`.
- Playwright MCP tools available (`browser_navigate`, `browser_take_screenshot`, `browser_resize`, `browser_evaluate`, `browser_click`, `browser_type`). If missing, reload the IDE so `.mcp.json` servers connect.

## 1. Set a phone viewport
```
browser_resize  width=390 height=844      # iPhone 12/13/14 logical px
```
Keep the viewport identical across all shots for apples-to-apples comparison.

## 2. Seed state to reach gated screens (fill in once routes exist)
Some screens need a logged-in role (구매자/대행자) or a matched chat. Seed auth/role + a fixtured 요청/매칭 into client storage, then navigate directly. Use fixtured external-API responses (지도 SDK·네이버쇼핑) so the map renders deterministically.

## 3. Capture list (per UX-기획 v0.2, S1~S9 — fill in real routes as built)
For each: `browser_navigate` → wait for content → `browser_take_screenshot` with a stable filename.

| Screen | filename |
|---|---|
| S1 지도 양면 보드(대행자/요청/할인 토글) | `01-board.png` |
| S2 할인소식 상세(미검증 라벨 / 현장확인가) | `02-discount.png` |
| S3 대행자 프로필(지위·일정·평판) | `03-agent.png` |
| S4 역경매 요청 작성 | `04-request.png` |
| S5 매칭 채팅 + 거래방식 선택 | `05-chat-pay.png` |
| S6 할인소식 올리기 폼(기준가 미확인 라벨) | `06-post-form.png` |
| S7 바운티(무금전·뱃지) | `07-bounty.png` |
| S8 공동대행 경고 모달 | `08-groupbuy-warn.png` |
| S9 신고→블라인드 | `09-report-blind.png` |

## 4. Review each shot against the plan (`docs/planning-artifacts/UX-기획.md`)
- **정보 정직성:** UGC 할인소식에 `[기준가 미확인·사용자 제보가]`/"미검증" 라벨이 보이고, 현장 확인가(✅)와 시각·문구로 분리되는가.
- **컴플라이언스 가시성:** 통신판매중개 고지가 요청/소식/채팅에 상시, 직접거래에 사기 경고, 개인 대행자에 사업자등록 고지.
- **빈 상태 정직성:** 빈 보드가 가짜로 안 채워지고 제보/시드를 유도하는가.
- **Map fit + mobile:** 핀/클러스터·바텀시트가 뷰포트 안, 탭 타깃 충분, 고정 UI 뒤로 콘텐츠가 가려지지 않는지.

## 5. Report
Compact table: screen → pass/issue → one-line note + filename. List concrete fixes (`file:line` where known). Do NOT claim a screen is correct without having captured and looked at it — this is the anti-hallucination point of the skill.
