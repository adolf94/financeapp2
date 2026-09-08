---
github_issue: 20
github_url: https://github.com/adolf94/financeapp2/issues/20
status: open
---
# PBI-020: Per-App (Package ID) Runbook for App Notification Classification
## Overview
Introduce a second, additive tier of runbooks for the **App** classification pipeline: a per-application runbook keyed by the notification's **package id** (`raw_payload["notif_pkg"]`, e.g. `com.globe.gcash.android`). During classification, the pipeline fetches the global app runbook (`runbook`) AND, when a package id is present, the matching `runbook-app:{pkg}` document, combining both into the Gemini prompt with explicit precedence rules.

## Background & Rationale
1. Today the App pipeline uses a single `runbook` document (`IngestionService._get_runbook_id()` → `"runbook"`, stored in the CosmosDB `Settings` container, partitioned by `UserId`).
2. Rules that only apply to one app (e.g., GCash-specific merchant naming, Maya transfer reference formats) bloat the global runbook and can conflict across apps.
3. Package id is already available in the payload and used by `AiService` (`hook.raw_payload.get("notif_pkg")` in `ai_service.py:448` / `ai_service.py:560`), so no ingestion-schema change is required.
4. Storage/endpoint patterns already exist per notification type (`runbook-sms`, `runbook-email`, `runbook-image` via `runbook_id` param in `finance_api_service.py:602` and `function_app.py` GET/PUT `/runbook?type=...`). Extending with a namespaced id `runbook-app:{pkg}` is a natural fit.

## Design

### Document Keying & Storage
- CosmosDB `Settings` container, one document per (user, package):
  - `id`: `runbook-app:{package_id}` (package id lowercased, trimmed)
  - `UserId`: partition key (unchanged)
  - `content`: markdown, same format as the global runbook
  - optional `packageId`, `label` (human-readable app name) fields for listing/UI.
- No bootstrapping of defaults — a missing per-app runbook simply means "global rules only" (zero extra prompt cost).

### Resolution Order (App pipeline only)
1. `pkg = hook.raw_payload.get("notif_pkg")` — if empty/None (e.g., SMS fallback), skip per-app lookup.
2. Fetch base runbook (`runbook`) as today.
3. Point-read `runbook-app:{pkg}`. If found, combine:
   ```
   {global runbook}

   ## App-Specific Rules ({pkg})
   The following rules apply ONLY to notifications from this app and OVERRIDE
   conflicting rules above.
   {app runbook}
   ```
4. Combined content flows through the existing `runbook_content` parameter — no signature churn beyond the prompt template.

## Tasks & Scope

### 1. Backend — Repository/Service Layer (`finance_api_service.py`)
- [x] Add `get_app_runbook_content_async(user_id, package_id)` and `save_app_runbook_content_async(user_id, package_id, content, label=None)` wrappers over the existing `get/save_runbook_content_async` using id `runbook-app:{pkg}`.
- [x] Add `list_app_runbooks_async(user_id)` — Cosmos SQL query on `Settings` for `STARTSWITH c.id, "runbook-app:"`, returning `{package_id, label, updated}` summaries.

### 2. Backend — Pipeline Wiring (`ingestion_service.py`)
- [x] In `process_hook_async()` (step 3b, ~line 335) and the reclassify path (~line 526), resolve `notif_pkg` from `hook.raw_payload` (or `hook_like` for reclassify) and append the per-app runbook via a shared helper `_compose_runbook_content(user_id, base_content, raw_payload)`.
- [x] Apply only in the App pipeline: gate on `notification_type` so SMS/Email/Image subclasses are unaffected.
- [x] Log when a per-app runbook is applied (observability: hook id + pkg).

### 3. Backend — Prompts (`prompts/app_prompts.py`, `ai_service.py`)
- [x] Add an explicit precedence instruction to the app classification prompt: app-specific section overrides global rules; global rules apply when the app section is silent.
- [x] Keep SMS/Email/Image prompts untouched.

### 4. Backend — API Endpoints (`function_app.py`)
- [x] `GET /runbook` — accept `?type=app&pkg={package_id}` to fetch a per-app runbook; existing behavior unchanged when `pkg` omitted.
- [x] `PUT /runbook` — same `pkg` param for saving.
- [x] `GET /runbook/apps` — list configured per-app runbooks for the user (from `list_app_runbooks_async`), JWT auth, for the UI picker.
- [x] Runbook review endpoints (`/runbook/review/start|chat|approve`) — accept `runbook_type: "app"` + optional `pkg` so the AI can propose edits to the correct document; corrections should be grouped per package id when a review targets an app runbook.

### 5. Frontend (`frontend/`)
- [x] Settings > Runbook tab: add a source selector — `App (global)`, `App: {package}` entries (populated from `GET /runbook/apps` + distinct `notif_pkg` values seen in recent ingestions), plus SMS/Email/Image (existing).
- [x] Reuse `RunbookReviewModal` / `useRunbookReview` hooks with the extra `pkg` query/body param; `pythonApiClient` only (no direct fetch).
- [x] Allow creating a new per-app runbook by picking a package id from recent notifications (avoids manual package-id typing).

### 6. Tests (`notif-ingester/tests/`) — via `finance-test-scaffold` skill
- [x] Unit: `_compose_runbook_content` — no pkg → base only; pkg with no runbook → base only; pkg with runbook → combined with override header.
- [x] Unit: `FinanceApiService` get/save/list for `runbook-app:` ids (mock Cosmos).
- [x] Endpoint: GET/PUT `/runbook` with `pkg`; `/runbook/apps` listing; review start/approve with app+pkg.
- [x] Regression: SMS/Email/Image pipelines never fetch `runbook-app:*`.

### 7. Spec Update
- [x] Use `spec-updater` skill: document per-app runbook tier in §2.4 step 2 (Classify), the `RUNBOOK.md` architecture note (§ last bullet), and the `/runbook*` endpoint list.

## Edge Cases & Decisions
- **Package id normalization:** trim + lowercase before keying; reject ids containing `/` or `#` (invalid Cosmos item id characters) with a warning log.
- **Unseen packages:** no auto-creation; a future enhancement (out of scope) can seed a draft `runbook-app:{pkg}` from the runbook-review flow once ≥ N corrections exist for that package.
- **Prompt size:** per-app runbook is additive only when present; if combined length exceeds a budget (e.g., 8k chars), truncate the app section last (app rules are the higher-value context) and log.
- **Related transactions / vendor matching:** unchanged; runbook tier only affects classification context.
- **Third-party hook payloads without `notif_pkg`:** gracefully fall back to global-only behavior (current behavior).

## Acceptance Criteria
- [x] An app notification with `notif_pkg=com.x` and an existing `runbook-app:com.x` document is classified with BOTH rule sets, app rules explicitly marked as overriding.
- [x] Same notification with no per-app runbook classifies exactly as before (byte-identical runbook context).
- [x] SMS/Email/Image pipelines show zero behavior change.
- [x] User can view/edit per-app runbooks from Settings > Runbook and via API.
- [x] Unit + endpoint tests pass; `spec.md` updated.
