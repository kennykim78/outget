---
name: knockedu-contract
description: Cross-check Outget (아웃겟 — 지도 기반 아울렛 구매대행 당근형 양면 매칭 보드) client API calls against server routes — find client calls with no matching route (likely 404/mismatch) and unused routes — plus verify the external-API contracts (지도 SDK, 네이버쇼핑 API, 외부 P2P 안전결제/페이링크) match how the client consumes their responses. Token-efficient contract verification. Use when asked to verify the API contract, find interface mismatches, or after changing a server route, the client API layer, or an external-API integration.
---

# Outget API Contract (token-efficient)

Two contracts matter in Outget: the client↔own-server matching/UGC API, and a few external APIs.

## 1. Client ↔ own server

The server owns **listings/requests/matching/chat, UGC(할인소식·현장확인가), 신고-블라인드, 외부 안전결제 딥링크 브로커링, auth**. Check that every client call has a matching route and the request/response shapes match (Request·Match·DiscountPost·Report·AgentProfile).

## 2. Client ↔ external APIs

Verify the client consumes each response in the shape the provider actually returns:

| External API | Client must match |
|---|---|
| 지도 SDK (네이버맵 등, 미확정) | 좌표 필드/순서, 마커·클러스터 API, geocoding 응답 shape |
| 네이버쇼핑 API (정가 조회) | item 필드(title/price/품번), HTML 태그, rate-limit/error. **정가 입력 보조용만 — 크롤링 대체 아님** |
| 외부 P2P 안전결제(페이링크/네이버페이/토스/KCP, 미확정) | 딥링크 생성 파라미터·콜백/상태 shape. **자금이 플랫폼을 경유하지 않는 연동인지 계약상 확인**(약관 서면확답 전까지 추상화) |

A field-name/coordinate-order mismatch is a silent render bug, not a 404 — verify shapes against provider docs, not just presence. For 안전결제, also verify the integration is *non-custodial*(플랫폼 자금 미보유) — that's a legal invariant, not just a contract detail.

## Stack status: skeleton mode

No committed stack yet, so there is no bundled `contract.mjs`. Until then:
- Use `Grep` to list client call sites (client API/service layer) and server route decorators, diff by hand.
- For external APIs, read the integration module and compare each consumed field against the provider's documented response.

## Wire the real script when a stack lands

Drop a `contract.mjs` that extracts server routes + client calls and diffs them (non-zero exit on an orphan call), and optionally validates external-API response shapes against a small fixtures file. Then:

```bash
node .claude/skills/knockedu-contract/contract.mjs
node .claude/skills/knockedu-contract/contract.mjs --json
```

Log the wiring in CLAUDE.md's harness change history.

## Limits

- Heuristic string matching for own-server routes — verify an orphan against the real route before treating it as a break.
- External-API shape drift only shows against real/fixtured responses; provider changes won't surface until you refresh fixtures.
- The non-custodial(자금 미보유) property of the 안전결제 integration is a *contract + legal* check — confirm with `security-auditor`, not just shape diffing.
