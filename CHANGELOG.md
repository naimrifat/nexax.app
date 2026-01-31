 Phase 3.4 — Final Cleanup (Gateway-Only Deployment)
 
 Summary
 - Removed all remaining legacy endpoint files to complete the migration to a single gateway surface and in-repo core modules.
 - Gateway (api/ebay-api.ts) is the sole public API for all eBay-related operations.
 - Core modules now fully own the business logic for analyze, reconcile, publish, transcribe, and category specifics.
 
 What changed
 - Deleted: api/analyze-listing.ts, api/reconcile-specifics.ts, api/publish-listing.ts, api/transcribe.ts, api/ebay-categories.ts, api/ebay-item-conditions.ts
 - Implemented Phase 3.2 core logic for all actions and wired into the gateway (Phase 3.3 completed earlier).
 - Added Phase 3.4 cleanup to ensure a clean, minimal surface area for deployment.
 
 How to verify
 1) Build and run tests: npm ci; npm run build; npm test (if tests exist).
 2) Deploy to staging and verify the gateway path (POST /api/ebay-api) works for all actions.
 3) Perform end-to-end flows: analyze, reconcile, publish, transcribe, and category fetch across multiple categories.
 4) Ensure old endpoints are not present in the deployed bundle and codebase.
