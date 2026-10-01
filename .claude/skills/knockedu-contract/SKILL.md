---
name: knockedu-contract
description: Check client↔server and seed↔UI contracts in WithSmall (위드스몰): API request/response shapes, specSchema↔spec-check form fields, resolved requirement shape↔L2/L4 render, prerender HTML↔hydrated DOM, seed ids↔UI slots. Use after any route/API/schema/seed change, before qa-verifier signs off.
---

# knockedu-contract (WithSmall)

Grep-based, deterministic. For each boundary print `{ boundary, left: file:line, right: file:line, match: true|false, diff }`.
Boundaries: `client/src/api/*` ↔ `server/src/**/routes*` (paths, methods, DTO keys); `SupplyItem.specSchema.fields[].key` ↔ spec-check form field names ↔ `CuratedProduct.specValues` keys; `resolveRequirement()` return type ↔ `ChecklistRow`/`NeedChip`/L4 props; `scripts/prerender.mjs` routes ↔ client router routes; `photos.json`/`curated-products.json`/`testimonials.json` ids ↔ components referencing them; event names in client ↔ PRD US-018 list. Any `match:false` is a blocker for qa-verifier.
