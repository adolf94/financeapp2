---
github_issue: 21
github_url: https://github.com/adolf94/financeapp2/issues/21
status: open
---
# PBI-021: Per-App Runbook Context in App Runbook Review & Ad-Hoc Chat

## Overview
Extends PBI-020 (per-app runbooks keyed `runbook-app:{pkg}`) into the **Runbook Review** flow:

1. **Pending-corrections review (App):** when starting an App runbook review from pending corrections, group the corrections by `notif_pkg`, load each relevant per-app runbook as additional context, and let the AI propose edits routed to the correct per-app document — via a **new response key `app_runbook_updates`** alongside the existing `questions`, `proposed_runbook`, `account_description_updates`, and `vendor_updates`.
2. **Ad-hoc review (App):** capability to add one or more per-app runbooks to the context of an ad-hoc review (`context_pkgs`), so the user can discuss/refine app-specific rules even when there are no pending corrections, and the AI can propose `app_runbook_updates` for them during chat.

## Background
- `/runbook/review/start` (function_app.py ~L1202) already accepts `runbook_type` + `pkg`, but only ever targets ONE runbook document per session.
- Pending corrections from `GET /runbook/corrections?type=app` (function_app.py ~L1047) carry `raw_payload.notif_pkg`, so per-package grouping requires no schema change.
- `start_runbook_review_async` / `chat_runbook_review_async` (ai_service.py ~L1126/L1177) build the review prompt; the AI response object today has `message`, `questions`, `proposed_runbook`, `account_description_updates`, `vendor_updates`.

## Design

### New AI response / session key
Add `app_runbook_updates` to the review AI response object (alongside `vendor_updates` and `questions`):
```json
"app_runbook_updates": [
  {
    "package_id": "com.globe.gcash.android",
    "label": "GCash",
    "proposed_content": "<full proposed markdown for runbook-app:{pkg}>",
    "rationale": "<why these rules changed, which corrections drove it>"
  }
]
```
Persisted on the review session (`runbook-review-session` doc) next to `proposed_runbook`; updated across chat turns.

### Review start (pending corrections, type=app, no pkg)
- Resolve distinct `notif_pkg` values across the submitted corrections.
- Point-read each existing `runbook-app:{pkg}` and inject them into the prompt as clearly delimited per-app sections (with the same precedence semantics as classification: app rules override global).
- Corrections in the prompt are annotated with their `package_id` so the AI can attribute each correction to global vs app-specific rules.
- AI decides per proposed rule whether it belongs in the global `proposed_runbook` or in an `app_runbook_updates[pkg]` entry.

### Ad-hoc review (no corrections)
- `POST /runbook/review/start` accepts optional `context_pkgs: [pkg, ...]` for `runbook_type=app`.
- Selected per-app runbooks are loaded into the prompt context (existing `GET /runbook/apps` powers the picker).
- During ad-hoc chat the AI MAY propose `app_runbook_updates` for any package in context (relax the current "DO NOT propose any changes yet" instruction to allow edits once the user asks).

### Approve
- `POST /runbook/review/approve` persists: global runbook (or single `pkg` target, existing behavior) + each entry of `app_runbook_updates` via `save_app_runbook_content_async(user_id, pkg, content)` + account/vendor updates (unchanged), then marks corrections `runbook_synced` and deletes the session.
- Body may override `app_runbook_updates` (same pattern as `account_updates`/`vendor_updates` overrides today).

## Tasks & Scope

### 1. Backend — AI service (`ai_service.py`, prompts)
- [ ] Extend `RUNBOOK_REVIEW_PROMPT` / `RUNBOOK_CHAT_PROMPT` with `{app_runbooks}` context section and `app_runbook_updates` output schema; attribution rule guidance (global vs per-app).
- [ ] `start_runbook_review_async` / `chat_runbook_review_async`: accept `app_runbooks: dict[pkg, content]` + per-correction `package_id`; parse and return `app_runbook_updates`.
- [ ] Ad-hoc mode: allow proposals when user explicitly requests (adjust CRITICAL INSTRUCTION wording).

### 2. Backend — Endpoints (`function_app.py`)
- [ ] `/runbook/review/start`: accept `context_pkgs`; when corrections present and no explicit `pkg`, group by `notif_pkg` and load matching `runbook-app:{pkg}` docs; store `app_runbook_updates` + `context_pkgs` on session.
- [ ] `/runbook/review/chat`: pass session `app_runbooks` context through; persist updated `app_runbook_updates`.
- [ ] `/runbook/review/approve`: apply each `app_runbook_updates` entry (create-or-update `runbook-app:{pkg}`), then existing global/account/vendor logic.
- [ ] `/runbook/corrections`: include `package_id` (from `raw_payload.notif_pkg`) in each correction payload for frontend grouping.

### 3. Frontend (`frontend/`)
- [ ] `useRunbookReview.ts`: types + wiring for `app_runbook_updates`, `context_pkgs`.
- [ ] New `RunbookAppUpdatesPanel` component (via `modularizer` skill): per-package proposed runbook diff/view, approve/discard per entry.
- [ ] Settings > Runbook tab: corrections grouped by package; multi-select of per-app runbooks (from `GET /runbook/apps`) to add to ad-hoc context.
- [ ] All calls via configured axios clients (`pythonApiClient`/`ingesterClient`) — no direct fetch.

### 4. Tests — via `finance-test-scaffold` skill
- [ ] Unit: prompt composition with 0/1/N per-app runbooks; correction→pkg attribution; `app_runbook_updates` parsing.
- [ ] Endpoint: start with corrections spanning multiple pkgs; start ad-hoc with `context_pkgs`; chat updating `app_runbook_updates`; approve persisting multiple per-app docs + marking corrections synced.
- [ ] Regression: review with single `pkg` (PBI-020 behavior) and sms/email/image reviews unchanged (`app_runbook_updates` ignored/absent).

### 5. Spec update — via `spec-updater` skill
- [ ] Document review-flow per-app context, `app_runbook_updates` session key, `context_pkgs` param, approve behavior.

## Edge Cases & Decisions
- **Correction without `notif_pkg`:** attributed to global runbook only.
- **Pkg in `context_pkgs` with no stored runbook:** treated as blank/new; approve creates it.
- **Session size:** `app_runbook_updates` holds full proposed content per pkg; cap combined context (e.g. truncate global runbook before app sections, consistent with PBI-020 budget rule) and log.
- **Discard:** unchanged — whole session deleted; per-entry discard is frontend-only (removes entry via session PUT).

## Acceptance Criteria
- [ ] App review started from pending corrections across ≥2 packages loads each `runbook-app:{pkg}` and returns `app_runbook_updates` grouped per package alongside `questions`/`vendor_updates`.
- [ ] Approve persists global runbook AND each per-app runbook entry; corrections marked `runbook_synced`.
- [ ] Ad-hoc app review can include user-selected per-app runbooks via `context_pkgs` and propose edits to them during chat.
- [ ] Single-`pkg` review and sms/email/image review behavior unchanged.
- [ ] Unit + endpoint tests pass; `spec.md` updated.

## Dependencies
- Requires PBI-020 (#20) — per-app runbook storage, `GET /runbook/apps`, `save_app_runbook_content_async`.
