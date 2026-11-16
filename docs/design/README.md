Soft character, clean utility. WithSmall helps a first-time keeper of a hamster, gerbil, guinea pig or small parrot decide what to prepare, check a spec, and go find it. Cuteness lives only in the mascots; every other pixel is a quiet tool. One line to remember: **귀여움은 진입을, 정보는 절제, 판정은 전문적으로, 구매는 조용하게.**

## Principles

1. **Action before number.** Lead with "필수 2개 미완료", not "71%". Progress bars are secondary.
2. **Evidence beside every claim.** A spec, a verdict, a hospital line each carry a reason and a review date (`meta` in `ink-muted`). Never a trust score, a star rating, "정확도 98%" or "전문가 N명".
3. **Show what not to buy.** `NOT_NOW` rows stay visible (collapsed, `status-later`), never hidden. This is the one visual promise a shop cannot make.
4. **Rows over cards.** Lists are rows divided by `line`. A card (`surface` + `line` border + `radius-md`) is reserved for TypeCard, VerdictCard, BundleCard and VetCard. No shadows except `shadow-sheet`.
5. **One decision per screen, one filled CTA.** The single `brand` button is the exit; everything else is outlined or text.
6. **Mascots enter, never judge.** A mascot appears on group/type selection, the hub header, empty states and the completion moment. It never appears on a spec table, a verdict, a hospital detail or legal text.
7. **No medical certainty.** Copy never says 괜찮아요 / 안전해요. It stops at "병원에 문의하세요".
8. **One product, three widths, one rhythm.** Mobile-first. The page is a top-to-bottom flow of sections with horizontal rails at every width; wider tiers show more cards per rail and turn bottom sheets into modals or a right drawer. No side navigation, no fixed side panel, no admin-style two-column layout anywhere. Nothing exists on desktop that does not exist on mobile.
9. **Service outside, tool inside.** The home is for discovery (mascot, bundles, supply chips, curated products, vets). Checklist, supply detail, spec checker and animal selector are layers opened over the page, never pages of their own. Visual weight is fixed: mascot > bundle > supply > product.

## Content fundamentals

- Voice: 존댓말, short sentences, plain words. Talk to one person about one animal.
- Numbers are the loudest thing in a sentence: set `28cm`, `60×40cm` in `spec`, `ink`, `tabular-nums`. Units follow the number with no space (`28cm`), the qualifier after (`28cm 이상`).
- Say 준비·구하기·찾기, never 구매·판매·거래·세트·최저가·판매순·베스트. Say "이 조건으로 찾기", not "추천 상품".
- Fixed phrases: "지금은 필요 없어요" + one reason · "이 기기에만 저장돼요" · "후보 안내일 뿐, 종을 확정하지 않아요" · "참고 범위예요. 최저가를 보장하지 않아요".
- Emoji only as category glyphs on the supplies grid and hospital header; never as decoration, never in body text.
- Scientific names in `meta` beside the display name (`골든햄스터` / `Mesocricetus auratus`). Aliases as "○○라고도 불러요".

## Tokens v2.0 (R3 순백 + 청록, 2026-11-14)

`tokens.json` 2.0.0 replaces the v1.2 sage-mint palette with the approved R3 direction. Token **names are unchanged**; values were swapped and new leaves added. Font stays Pretendard (the R3 mockups were typeset in 맑은 고딕 only as a Windows rendering stand-in).

- Color: `bg-000` #ffffff · `ink` #102326 · `ink-body` #48575a (new: running body text) · `brand` #007f8b · `line` #d7dfdf. `on-brand` is now white on teal; `brand-text` #00707b (darker so it holds ≥4.5:1 on `brand-soft`); `focus` = `brand`. `bg-100` / `brand-soft` / `line-strong` moved to cool neutrals. Scrim = ink at 44%.
- Status keeps the same five-state mapping; `status-first` and `status-check` were darkened so every status color is ≥4.5:1 on white, `bg-100`, `brand-soft` and its own soft ground. `status-later` now equals `ink-muted` (the v1.2 3.9:1 exception is gone). Enforced by `client/src/styles/tokensContrast.test.ts`.
- Layout (new): `content-max` 1200 (was 1120; outer margin 40 at 1280) · `grid-gutter` 24 (12 columns of 78) · `section-gap` 120 / `section-gap-mobile` 72 · `layer-pad` 40 / `layer-pad-mobile` 16 (720 → 640 content, 360 → 328) · `btn-h` 52 · `input-h` 72 · `row-h` 76 / `row-h-mobile` 72 · `radius-photo` 20 / `radius-photo-mobile` 14 · `num-unit-gap` 8 (large number → unit, same baseline).
- `drawer-w` is **deprecated**: every PC layer becomes a `modal-w` 720 modal. The token stays only until the component step removes its last reference. Until then the prose below that mentions the right drawer describes v1.2 behavior.

## Color

Ground everything on `bg-000` (plain white). `bg-100` (cool off-white since v2.0) is for bands, sheet headers, the sheet/modal header, category tiles and image placeholders, never the page ground. `surface` is white too, so a card is defined by its 1px `line` border and radius, not by tone. Headings and numbers are `ink`; running text `ink-body`; secondary text `ink-muted` (5.5:1 on `bg-000`). Borders `line`; inputs and selected cards `line-strong`.

`brand` (teal since v2.0) is the one identity hue: selected TypeCard tint (`brand-soft`), progress fill, the single filled CTA (text `on-brand`, white). Links and brand-colored small text use `brand-text`; raw `brand` as small text only on white. `peach` is warmth for mascots and the empty-state illustration; `butter` is the parrots' yellow and the completion celebration. Neither is ever a control.

Status is a separate system and is never pastelled into the brand:

| state | icon | color | ground |
|---|---|---|---|
| 준비완료 | ✓ | `status-ready` | `status-ready-soft` |
| 먼저 준비 (REQUIRED open) | ! | `status-first` | `status-first-soft` |
| 확인 필요 / 권장 미달 | △ | `status-check` | `status-check-soft` |
| 나중에 / NOT_NOW | ○ | `status-later` | none |
| 최소 미달 | ✕ | `status-fail` | `status-fail-soft` |

Every state is icon + color + word. `status-first` (coral) and `status-fail` (deep red) differ in lightness and glyph so the two never read alike; `status-ready` sits away from the red axis. `status-later` equals `ink-muted` since v2.0 (≥4.5:1) and is still never the only carrier of meaning.

Single theme. There is no dark theme in Phase 0; the product forces `color-scheme: light` so system dark mode does not invert the mascots or the status colors.

## Typography

One family, `sans` (Pretendard; the product self-hosts the variable file, this reference lists the stack only). Scale: `display` 32/800 for the animal name beside its mascot; `title` 24/700 one per screen; `section` 18/700 for the four checklist headers; `body` 16/400; `cta` 16/600; `meta` 13/400 in `ink-muted`; `label` 12/600 with `0.04em` tracking above a value; `spec` 18/700 and `spec-lg` 28/800 for numbers, always `tabular-nums`. Headings get `text-wrap: balance`. Running text stays near 34 Korean characters wide.

## Layout and responsive rules

Three tiers from `layout` tokens, one page rhythm. A page is: `GlobalHeader` (`header-h`) → hero → sections, each a `RailSection` (title, optional subtitle, "전체 ›", one horizontal row of cards). Home order is fixed: ① 히어로 ② 지금 필요한 것 (NeedChip rail) ③ 처음 준비한다면 (BundleCard rail) ④ 기준에 맞는 준비물 (ProductCard rail) ⑤ 우리 동네 병원 (VetCard rail). **≤767** one column, `gutter-mobile`, header shows logo + `AnimalChip`, bottom tab bar (`tabbar-h`: 홈 · 용품 · 병원), rails scroll horizontally with `rail-peek`, layers are bottom sheets. **768–1023** `gutter-wide`, content max 960 centered, header shows the text menu (용품 찾기 · 병원) and the tab bar goes away, rails show 2.5–3 cards, layers are 600px center modals. **≥1024** content `content-max` centered, rails show 4–5 cards with ‹ › arrows, checklist / animal selector / spec checker are `modal-w` center modals, supply and product detail open as a `drawer-w` right drawer over the dimmed page. The only side-by-side pair in the product is the vet page list | map (≥1024, `col-gap`). When the viewport gets wider, add cards to rails; never place sections next to each other.

## Layers

A layer (`Layer` component) is a tool opened over the page: checklist (L2), 2 questions (L3, as a step inside L2), supply detail (L4), spec checker (L5), my cage (L6, a step inside L5), product detail (L7), animal selector (L1). One layer at a time; steps change inside the same layer. The page behind stays visible under a `rgba(16,35,38,.44)` scrim (v2.0; ink at 44%) and keeps its scroll position; closing (✕, ESC, back, scrim tap) returns to it unchanged. Sheets and drawers use `shadow-sheet`; modals use it too. The header band of a layer is `bg-100` when it carries a summary (checklist), otherwise white. A layer has at most one filled CTA in its footer.

## Product surface

`ProductCard` is discovery, not commerce. Fixed anatomy: 1:1 image → name (one line) → spec line ("30cm · 무소음", `tabular-nums`) → `✓ 기준 충족` chip (always) → ♥ (icon only until the count passes the threshold, then "♥ 128"). No price, no seller, no "구매", no "최저가", no badges, no mascot. Only images the operator has rights to (own photo, seller permission, affiliate API); a product without one gets a `bg-100` tile with the supply glyph and "이미지 준비 중". Product cards are the smallest cards on the page (`product-card-w`), sit in one row, and never form a grid.

## Spacing, radius, borders

Screen gutter `space-4`; rows are `space-3` tall padding and divided by a 1px `line`; sections separated by `space-6`; a page title sits `space-8` from the top. Radii: `radius-sm` inputs and verdict lines, `radius-md` buttons and cards, `radius-lg` sheets and the hub summary block, `radius-pill` chips, progress track and mascot discs. Borders, not shadows: only the mobile bottom sheet and sticky action bar use `shadow-sheet`; the desktop panel is separated by a 1px `line`.

## Mascot system

One base, many variants. Every animal is built on the same 96×96 grid: a round head at (48,54) r≈30, two ears on the top corners, eyes r=3.4 at y≈50 in `mascot-ink`, a small nose or beak at the center line, and a lighter belly/cheek shape. Fur uses two flat fills per animal (no outlines, no gradients, no highlights). Expressions are three: neutral (default), happy (mouth curve up, used at completion), sleepy (eyes as lines, used in empty states). A new AnimalType is a color and ear/snout variant of the nearest base, never a new drawing.

Sizes: 96px on the group/type selectors and hub header (on a `brand-soft` or `peach-soft` disc), 40px as a row avatar in "이어서" and the supplies-to-animal picker, 24px as a chip glyph. Never above 120px. Group mascots (`group-small-mammal`, `group-parrot`) are single-ink `brand` silhouettes on their soft disc and mark the two entry groups only.

Assets: `assets/Mascots/` (hamster-golden, hamster-dwarf, gerbil, guinea-pig, budgie, cockatiel, group-small-mammal, group-parrot). Show via `<img>`; the SVGs carry their own fills.

## Iconography

Status glyphs are text characters (✓ ! △ ○ ✕ ?) set in `cta` weight and the status color, inside a 24px box, so they render identically in static HTML and after hydration. Category glyphs on the supplies grid are emoji at 24px. No icon font in Phase 0.

## States and interaction

Touch targets 44px. Focus is a 2px solid `focus` ring, offset 2px, on every surface. Pressed state darkens the fill 8%; disabled is 40% opacity with no color change. Checklist rows toggle from the whole left area, not only the checkbox. Reduced motion: no transitions beyond 120ms opacity.
