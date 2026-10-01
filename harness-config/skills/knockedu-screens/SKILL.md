---
name: knockedu-screens
description: Capture every key WithSmall (위드스몰) screen at 390 (mobile) and 1280 (desktop) viewports for design review, using the Playwright MCP browser. Use when asked to screenshot the app, run a design/UI review, verify screens against UX v2.3.1 / 디자인-브리프, or hand results to design-liaison. Pairs with knockedu-run.
---

# WithSmall screen capture (390 + 1280)

Requires Playwright MCP (`.mcp.json`) and the app serving (`knockedu-run`). Save to `_workspace/screens/{name}-{w}.png`. Same viewport across all shots per width.

## Viewports
```
browser_resize width=390  height=844
browser_resize width=1280 height=900
```

## Seed state
Set localStorage `ws.animalType='hamster-golden'`, `ws.setup.hamster-golden` (2질문 완료, 베딩·급수 보유), `ws.context.hamster-golden.cage={type:'LIVING_BOX',floorWcm:60,floorDcm:40,heightCm:35}` for the selected-state shots; clear it for cold-start shots. Use fixtured vets (마포구).

## Capture list
| Screen | route / action | file |
|---|---|---|
| 홈 미선택 (4섹션, 후기 마퀴, 소개 슬라이드, 배너) | `/` | `home-empty` |
| 홈 선택 — L3 전 ("필수 준비를 먼저 확인해요") | `/hamster/golden` (setup cleared) | `home-pre-l3` |
| 홈 선택 — L3 후 ("필수 2개 남았어요") | `/hamster/golden` | `home` |
| L1 동물 선택 + 잘 모르겠어요("사막다람쥐") | chip → L1 | `l1`, `l1-alias` |
| L2 체크리스트 (푸터 저장 링크) | 지금 필요한 것 › 전체 | `l2` |
| L4 용품 상세 쳇바퀴 (호환 △) | chip 쳇바퀴 | `l4` |
| L5 규격 확인 (30cm ⇒ OK/△, 20cm ⇒ ✕) | L4 › 규격 확인 | `l5-ok`, `l5-fail` |
| L7 상품 상세 | 준비물 카드 | `l7` |
| L8 이메일 저장 | 배너 링크 | `l8` |
| 구성안 페이지 | `/hamster/golden/setup` | `setup` |
| 병원 (list / list|map at 1280) | `/vet/서울-마포구` | `vet` |
| 404 / PLANNED 타입 | `/gerbil/mongolian` | `planned` |

## Review handoff
Return the file list to `design-liaison`, which applies the 10-point checklist from 디자인-브리프 (token drift, side nav, product weight, product card contents, mascot placement, status color-only, tool-as-page, banned words, icons-where-photos, save nudge count) plus review stars, section count/order, L3-before counts.
