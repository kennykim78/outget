---
name: knockedu-impact
description: Compute blast radius before editing a shared WithSmall (위드스몰) module — engine, seed loader, Prisma schema, localStorage store, Layer/RailSection components, prerender. Use before architect plans a change to a shared file.
---

# knockedu-impact (WithSmall)

Grep importers/dependents of the target path(s) across `client/src`, `server/src`, `scripts/`, tests. Output `{ target, dependents: [file:line], tests: [...], risk: low|med|high, invariantTouch: [1..8] }`. High risk when touching `server/src/engine/*`, `schema.prisma`, exposure filters, `Layer`, `RailSection`, `prerender.mjs`. Feed the result to `architect`.
