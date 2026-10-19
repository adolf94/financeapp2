---
status: implemented
---
# PBI-024: Eliminate AI Hallucination of Debit/Credit Account IDs
## Overview
Replace the current "model returns raw account GUIDs" scheme with a **label-based account selection** mechanism: the model picks accounts by their human-readable **`Group | Name`** label from the provided account list, and application code resolves the label back to the real GUID. Add a **deterministic validation + bounded retry loop** around classification so an invalid selection is repaired with feedback instead of silently written to CosmosDB.

## Background & Rationale
1. **Hallucinated GUIDs currently reach the database.** All prompt files instruct the model "DO NOT hallucinate account IDs" (`notif-ingester/prompts/{app,sms,email,image}_prompts.py`), but `AiParsedData.debit_account_id` / `credit_account_id` are trusted as-is after `classify_async` (`ingestion_service.py:503`).
2. **Auto-confirm writes orphans.** `create_transaction_async` (`finance_api_service.py:456`) only checks the IDs are non-null, then writes `LedgerEntry` documents with `AccountId: <model-supplied string>`. A fabricated GUID creates ledger entries pointing at an account that does not exist — silent data corruption.
3. **Hallucinations propagate through the learning loop.** `embed_and_learn_async` (`ingestion_service.py:711`) embeds whatever IDs were confirmed into `TransactionVector`. A hallucinated ID that slips through becomes a "similar past transaction" and is re-fed into future prompts, where the model copies it — a self-reinforcing hallucination loop.
4. **GUIDs are hard to copy and semantically empty.** Long UUIDs invite transcription drift, and the model can't sanity-check whether a GUID "fits" the transaction. A `Group | Name` label (e.g. `Asset | BPI Savings`) is trivial to copy, easy for code to validate, and self-consistent — the model must pick a name that semantically matches the transaction, which is an extra hallucination brake in itself.

## Design

### 1. Label-Based Account Selection (primary fix)
- New helper `AccountLabelRegistry` (in `notif-ingester/services/`, single responsibility): given the `accounts` list, builds a lookup from **normalized `Group | Name` labels → account dict** (normalization: trim, collapse internal whitespace, case-insensitive) and exposes `resolve(label) -> account | None` plus `all_labels() -> list[str]`.
- `AiService._format_accounts` renders `Group | Name | Tags` rows — the GUID column is **removed entirely**; the model never sees an account ID. Grouping headers stay as-is.
- `AiService._build_context` (similar-past-transactions section) renders historical accounts as `Group · Name` (resolved from the stored account IDs via `get_specific_accounts_async`, which the learning flow already populates with denormalized names). Unresolvable IDs render as name-only.
- `AiService._format_user_corrections` renders correction accounts as `Group | Name` labels too.
- Prompt changes (all four pipelines: app, sms, email, image):
  - Schema fields become `debit_account_name` / `credit_account_name` holding the **exact `Group | Name` label** from the accounts list, or null.
  - Remove all "DO NOT hallucinate GUID" boilerplate — replaced by "copy the exact Group | Name line; if no account fits, use null + `suggested_account_creation`".
- After `_extract_json`, `AiService` resolves labels → real GUIDs via the registry and populates the existing `debit_account_id` / `credit_account_id` fields. Downstream code (`PendingIngestion`, `create_transaction_async`, learning) is unchanged.
- **Ambiguity handling (duplicate labels):** if two accounts share the same normalized `Group | Name`, the registry marks the label ambiguous. Options, in order:
  1. The prompt instructs the user (runbook author) that account names must be unique within a group — the registry logs a warning listing duplicates when built.
  2. At resolve time, an ambiguous label is treated as **invalid**; the retry feedback lists the conflicting accounts and asks the model to state which one it means via the existing `notes`/tags context. If still ambiguous after retries → terminal fail-safe (below). This is safe: ambiguity falls back to human review, never to a wrong account.

### 2. Validation Against the Fetched Accounts List (mandatory, every attempt)
- **Single source of truth:** the `AccountLabelRegistry` is built from the **same `accounts` list fetched via `get_accounts_async` in this request** (`ingestion_service.py:464` / `:618`) — the exact list injected into the prompt. Labels are NEVER validated against model-visible text, cached data, or remembered IDs; every classification re-validates against a freshly fetched list.
- New `AccountSelectionValidator` used by `IngestionService` after **every** classify attempt (first answer and each retry):
  - Each returned `Group | Name` pair (debit and credit independently) must resolve, after normalization (trim, collapse whitespace, case-insensitive), to an account in the fetched list. A pair that doesn't → invalid.
  - Label unknown (no match) → invalid.
  - Label ambiguous (duplicate match in the fetched list) → invalid, with `conflicts` detail for the retry feedback.
  - `suggested_account_creation` present with null labels → valid (no repair needed).
  - Even on a valid label match, the resolved GUID is cross-checked against the fetched list's IDs before it is written to `AiParsedData` — defense in depth against any registry/resolve bug.
- On invalid selection, **retry with feedback** (user decision: retry until valid, capped): re-issue the classify call with an appended section:
  > `Your previous answer referenced accounts {X, Y} which do not exist in the accounts list (or are ambiguous). Copy ONLY exact "Group | Name" lines from the list above, or use null + suggested_account_creation.`
- Retry loop is capped via env var `AI_ACCOUNT_SELECT_MAX_RETRIES` (default `3`). Each retry reuses the same context; only the feedback section is added. Repair attempts are debug-logged via the existing `_debug_log` channel with an attempt counter.

### 3. Fail-Safe Terminal Behavior
If the final attempt is still invalid (user decision: notes field + Pending status):
- Set both account IDs to `null`, cap `confidence` at `0.5`, set `is_auto_confirmed = False`.
- Prepend to `ai_parsed.notes`: `"AI could not select valid accounts after N attempts — please pick accounts manually."`
- Force `status = "Pending"` (never `AutoConfirmed`), so it appears in the existing review UI.
- Auto-confirm gating in `process_hook_async` (`ingestion_service.py:537`) additionally requires validated IDs — this is implied by (3) but enforced independently as a guard.

### 4. Write-Path Guard (last line of defense)
- `create_transaction_async` validates `debit_account_id` / `credit_account_id` against the `Accounts` container (point reads, partitioned by `/UserId`) before writing. On unknown ID: raise → existing auto-confirm fallback sets `Pending` with a note. No more orphan `LedgerEntry` documents.
- `embed_and_learn_async` refuses to learn when either ID is not in the fetched account set (`get_specific_accounts_async` already returns only existing accounts — check count), preventing poisoning of the retrieval loop.

### Out of Scope
- Validating user-confirmed data on the confirm endpoint (UI pickers already constrain selections to real accounts — per decision).
- Streamed SignalR failure events (feedback surfaces via the existing `notes` field + `Pending` status).

## Tasks & Scope
- [ ] `services/account_label_registry.py` — label normalization, duplicate/ambiguity detection, resolution; unit tested.
- [ ] `ai_service.py` — label-based `_format_accounts`, `_build_context` labels, `_format_user_corrections`, label→GUID resolution after `_extract_json` in all four `classify_*` methods (extract a shared `_resolve_account_labels(data, registry)` helper; consider a shared base to de-duplicate the four near-identical classify methods).
- [ ] `prompts/{app,sms,email,image}_prompts.py` — schema fields → `Group | Name` labels; remove GUID boilerplate.
- [ ] `ingestion_service.py` — validator + capped repair-retry loop shared by `process_hook_async` and `reclassify_ingestion_async`; terminal fail-safe (null IDs, confidence cap, notes, Pending).
- [ ] `finance_api_service.py` — `create_transaction_async` account existence check; `embed_and_learn_async` learning guard.
- [ ] Tests — registry normalization/ambiguity/resolution; validator; retry loop (mocked AI service returning invalid→valid→invalid sequences); write-path guard rejecting unknown IDs; regression: no prompt receives a raw GUID.
- [ ] Update `spec.md` AiService section and `notif-ingester/RUNBOOK.md` mapping note (Strict ID Handling rule can be simplified — IDs are no longer model-visible).

## Risks / Notes
- **Duplicate account names within a group** are the main new edge case (impossible with GUIDs). Handled by treating ambiguous labels as invalid → repair retry → human review. A long-term hygiene fix is enforcing unique names per group in the UI, noted as optional follow-up.
- **User renames an account between classification and confirm:** the stored `debit_account_id` is already resolved to a GUID at classification time, so confirm/learn is unaffected. Only in-flight reclassify calls use fresh labels.
- **Similar-context label drift:** historical accounts no longer in the user's list can't be resolved to a Group; rendered name-only. Acceptable — they're advisory context.
- **Label lookup is per-request** — no persistence needed; the registry is rebuilt from the accounts list each classification.
- **Cost:** repair retries are bounded (default 3) and reuse identical context; expected retry rate should be near zero once labels replace GUIDs.
- Follow-up (optional, later PBI): response-schema enforcement (structured output) to further constrain the model's JSON.
