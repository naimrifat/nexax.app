Migration Guide — Phase 3.4 Cleanup

- Objective: Consolidate the API surface to a single gateway and move all logic into in-repo cores, eliminating old serverless endpoints to stay under hosting plan limits.
- Gateway: /api/ebay-api handles all ebay-related actions via action + payload.
- Core modules: analyzeListingCore, reconcileSpecificsCore, publishListingCore, transcribeCore, ebayCategoriesCore live under api/cores.
- Phases completed: Phase 3.1 (gateway + cores wired), Phase 3.2 (production-grade in-core logic), Phase 3.3 (full removal of old endpoints).
- Phase 3.4: Final cleanup done. Old endpoints removed; gateway-only path validated.

What to test after this change:
- Build and deploy: ensure no TypeScript errors and gateway compiles.
- End-to-end: simulate analyze, reconcile, publish, transcribe, and category fetch across multiple categories using /api/ebay-api.
- Rollback plan: if needed, restore old endpoints quickly (using versioned deploys) for a short window.
