# docs/design — Claude Design 산출물 내보내기 (코드 참조용)

- `tokens.json` — Design System **v1.2** 토큰(색·타입·간격·라운드·레이아웃). 원본 아티팩트: WithSmall Design System (Claude Design). 코드는 이 파일에서 CSS 변수를 생성한다.
- `README.md`, `components/*/README.md` + `preview.html` — 컴포넌트 계약(AnimalAvatar·TypeCard·ChecklistRow·VerdictCard·BundleCard·GlobalHeader·RailSection·ProductCard·Layer).
- `mascots/*.svg` — 마스코트 8종(96×96 기하, 2색 플랫). 히어로·칩·L1·빈 상태·완료에만.
- `canvas/*.dc.html` — 캔버스 보드 **v14**의 HTML(인라인 CSS). 마크업을 복사하지 말고 **치수·순서·카피의 참조**로만 쓴다: Home390Empty / Home390 / Home1280Empty / Home1280 / LayerChecklist / LayerProduct / LayerEmail / LayerSupply1280 / TypeSelect(L1) / Verdict(L5) / Supply(L4 모바일).
- 규칙의 원문은 `docs/planning-artifacts/디자인-브리프.md` v2.3, 구조는 `UX-기획.md` v2.3.1.

갱신 절차: Claude Design에서 바뀌면 이 폴더를 다시 내보내고 CLAUDE.md 변경 이력에 버전을 적는다. `design-liaison` 에이전트가 이 폴더를 읽어 구현 스펙을 만든다.
