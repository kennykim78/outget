# RailSection
The building block of every page: a title (`section` 18/700), an optional subtitle in `ink-muted` ("필수 2개 남았어요"), a right-aligned link ("전체 ›", `brand-text` 13/600) and one horizontal row of cards with `rail-gap`. ≤767 the row scrolls with `rail-peek` of the next card visible; ≥1024 it shows 4–5 cards and ‹ › arrows in the header. Contents are `NeedChip`, `BundleCard`, `ProductCard` or `VetCard`, never mixed. Section titles are fixed copy: 지금 필요한 것 · 처음 준비한다면 · 기준에 맞는 준비물 · 우리 동네 병원 (unselected: 요즘 많이 찾는 준비).

`NeedChip` is a status glyph + supply name + optional spec in a pill: `!` first-prepare on `status-first-soft`, `✓` ready in `ink-muted`, `○` later. Tap opens the supply detail layer; the section header opens the checklist layer.
