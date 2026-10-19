---
status: open
---
# PBI-025: Hierarchical Path-Based Runbook System

## Overview
Replatform the runbook storage from flat, per-type documents (`runbook`, `runbook-sms`, `runbook-email`, `runbook-image`, `runbook-app:{pkg}`) into a **hierarchical path-keyed tree**:

```
rb                              → general rules for ALL channels (new: cross-channel tier)
rb/app/com.bpi.indivara         → rules for a specific app package
rb/sms                          → general SMS rules
rb/email                        → general email rules
rb/email/_multiple              → rules applied when multi-order/multi-item detected (action doc)
rb/email/shopee.ph              → rules for emails from shopee.ph (entity doc)
rb/image                        → general image rules
rb/image/_identify              → rules for the pre-classification "which source is this?" pass (action doc)
rb/image/gcash                  → rules for GCash screenshots/receipts (entity doc)
```

Two doc kinds live under each channel:
- **Entity docs** (plain segment, e.g. `shopee.ph`, `com.bpi.indivara`, `gcash`) — selected by matching the incoming item's identity (package id, sender domain, identified image source).
- **Action docs** (`_`-prefixed segment, e.g. `_multiple`, `_identify`) — selected by pipeline phase/mode flags, not by identity. The `_` prefix is reserved and may not be used for entity keys.

## Background & Rationale — Is This Applicable to Current Logic?
**Yes — nearly every node already exists in some form; three of them are currently hardcoded in Python and this design turns them into data.**

| Proposed path | Current equivalent | State |
|---|---|---|
| `rb` | *(none)* | **New capability** — cross-channel shared rules (e.g. Strict ID Handling) are currently duplicated/absent per channel |
| `rb/app` | `runbook` Settings doc (`IngestionService._get_runbook_id()`) | Rename/re-parent only |
| `rb/app/{pkg}` | `runbook-app:{pkg}` tier (PBI-020, `_compose_runbook_content_async`) | Rename/re-parent only |
| `rb/sms` | `runbook-sms` Settings doc | Rename only |
| `rb/email` | `runbook-email` Settings doc | Rename only |
| `rb/email/shopee.ph` | **Hardcoded** `_is_shopee_email()` in `email_processing_service.py` + bundled file `runbooks/shopee_email_runbook.md` (not even in Cosmos) | **Becomes data** |
| `rb/email/_multiple` | **Hardcoded** multi-order routing (`is_multi_order` → `classify_email_shopee_async` with combined runbook) — shopee-only today | **Becomes data, sender-agnostic** |
| `rb/image` | `runbook-image` Settings doc | Rename only |
| `rb/image/_identify` | **Hardcoded** filename heuristics (`PreprocessingService.extract_application_from_filename`) in image Pass-1 | **Becomes data** |
| `rb/image/gcash` | *(none)* | New capability |

Rationale:
1. Adding per-sender (email) or per-source (image) rules today requires code changes; with the tree they are just new documents created from the UI.
2. The per-app tier (PBI-020) proved the additive-two-tier model works; this generalizes it to N tiers and all channels.
3. `RunbookIndexService` (PBI-022) already chunks/retrieves per `runbook_id` — path-keyed ids slot in without changing the RAG mechanics.

## Design

### 1. Path Model & Validation
- Canonical path: `rb` or `rb/{channel}/{key}` (depth fixed at 2 for now; deeper paths can be added later without schema change).
- Channels: **`app`, `sms`, `email`, `image`** — deliberately matching the existing `?type=` API values to minimize churn (see Open Questions if you prefer `app_notif`/`emails`/`images`).
- Segment validation (generalizes `_normalize_package_id`): lowercase, trim, `1–64` chars, allowed `[a-z0-9._-]`, no leading dot, no `#?/\`, entity keys must not start with `_`.
- **Cosmos item ids cannot contain `/`, `#`, `?`, `\`** — the pretty path must be encoded. Encode `/` → `~`: doc id `rb~email~shopee.ph`, with the canonical pretty path stored in a `path` field for display/API use. (`~` is safe; prefix queries still work.)

### 2. Storage (CosmosDB `Settings` container, unchanged partition `/UserId`)
```jsonc
{
  "id": "rb~email~shopee.ph",       // encoded path (id-safe)
  "UserId": "<user>",                // partition key
  "path": "rb/email/shopee.ph",      // canonical, for API/UI
  "kind": "root | channel | entity | action",
  "channel": "email",                // null for root
  "label": "Shopee PH",              // optional, human-readable
  "content": "## Shopee-specific rules ...",
  "updated": "..."
}
```
- `get_runbook_by_path_async(user_id, path)` / `save_runbook_by_path_async(...)` replace the type/pkg-specific methods.
- `list_runbook_tree_async(user_id)`: one partition query `STARTSWITH(c.id, 'rb')` → return summaries `{path, kind, channel, label, updated, hasContent}`; the client builds the tree (doc count is small).
- Missing entity/action docs contribute nothing (existing PBI-020 principle — no bootstrapping, zero prompt cost).

### 3. Resolution Semantics (core change)
Each pipeline resolves an **ordered list of runbook paths** for a given hook, via one shared resolver:

```
rb                      ← always
rb/{channel}            ← always (app | sms | email | image)
rb/{channel}/{entity}   ← only when the entity key is known (see §4)
rb/{channel}/_{action}  ← only when the mode flag is set (e.g. is_multi_order)
```

- Replaces `_get_runbook_id()` + `_uses_app_runbooks()` + `_compose_runbook_content_async()` with a generic `_resolve_runbook_paths(raw_payload, phase_flags) -> List[str]` per pipeline, plus a generic multi-tier composer that wraps each doc in a section header stating precedence:
  **root < channel < entity; action docs are additive alongside; most-specific wins on direct conflict, everything else still applies.**
- Whole-doc composition keeps a per-doc cap (~4,000 chars) and total budget (~8,000–12,000), but **RAG retrieval stays primary** (as today: when chunks are indexed, `_get_rules_context_async` replaces whole-doc injection), which makes the budget concern mostly moot.

### 4. Entity Key Derivation per Channel
- **App**: `raw_payload.notif_pkg` → normalized package id (existing logic, unchanged).
- **Email**: derive **sender domain** deterministically from `raw_payload.sender`/`from` (strip display name, take the domain; last-two-labels for `mailer.shopee.ph` → `shopee.ph`), then exact-match against existing `rb/email/*` entity paths from the tree list.
- **Image**: derived by the new `_identify` pass (§5); the identified source key is persisted on the ingestion (`raw_payload.image_source`) so reclassify is deterministic and corrections map back to the right doc.

### 5. Action Docs
- **`rb/email/_multiple`** — appended whenever `extracted_info.is_multi_order` is true (selection stays deterministic; content becomes data). Multi-order prompt routing becomes **sender-agnostic**: it composes with whatever entity doc also matched, and the hardcoded shopee-only branch (`_is_shopee_email() and is_multi_order → classify_email_shopee_async`) is replaced by generic multi-order classification with `_multiple` + `shopee.ph` rules composed.
- **`rb/image/_identify`** — injected into the image **Pass-1 identify step** (today: filename heuristics only). The tree itself provides the controlled vocabulary: the identify prompt lists configured `rb/image/*` entity keys (excluding `_`-prefixed) plus `_identify` rules, and outputs `source_key | unknown` with confidence. Known key → fetch `rb/image/{key}` for the classification pass; unknown → channel doc only.

### 6. RAG / Rule IDs (`runbook_index_service.py`)
- `runbookId` becomes the canonical path; `_channel_code()` derives from the path: uppercase, non-alnum → `-`, strip leading `_` (e.g. `rb/email/shopee.ph` → `R-EMAIL-SHOPEE-PH-{hash6}`, `rb/email/_multiple` → `R-EMAIL-MULTIPLE-{hash6}`, root → `R-ROOT-{hash6}`).
- `get_rules_context_async` receives the resolved path list (replaces `[runbook, runbook-app:{pkg}]`); pinned rules from all tiers are injected first (existing behavior, now cross-tier).
- Reindex-on-save already replaces chunks wholesale per runbook — unchanged, keyed by path.

### 7. API (`function_app.py`) — with back-compat window
- `GET/PUT /runbook?path=rb/email/shopee.ph` — new primary form. Old `?type=...&pkg=...` keeps working (mapped through the same resolver as the migration) for one deprecation window.
- `GET /runbook/tree` — replaces/generalizes `GET /runbook/apps`; returns the full node list for the UI tree.
- Review endpoints (`/runbook/review/start|chat|session|approve`): body takes `path`; `RunbookReviewSession` gains `runbook_path` (replacing `runbook_type` + `pkg`). `GET /runbook/corrections` groups corrections by derived path (type + pkg/sender-domain/image_source from the ingestion).
- Corrections → runbook mapping in review prompts: AI proposes edits against the doc at the session's path (extends the PBI-021 per-app context mechanism).

### 8. Frontend
- `Settings > Runbook`: the four channel tabs become a **tree browser** (root node, four channel nodes, expandable children; action docs get a distinct icon/badge). `AppRunbookPicker` generalizes to a `RunbookPathPicker` fed by `/runbook/tree`.
- `useRunbookReview.ts`: queries keyed by path; `useAppRunbooks` → `useRunbookTree`. Corrections view filters by the selected path.

### 9. Migration (one-time, scripted)
| Old | New |
|---|---|
| `runbook` (Settings) | `rb/app` (content as-is) |
| `runbook-app:{pkg}` | `rb/app/{pkg}` |
| `runbook-sms` / `runbook-email` / `runbook-image` | `rb/sms` / `rb/email` / `rb/image` |
| bundled `runbooks/shopee_email_runbook.md` | `rb/email/shopee.ph` (moved into Cosmos) |
| multi-order prompt guidance (shopee prompts) | `rb/email/_multiple` |
| filename heuristics doc | `rb/image/_identify` (seeded from the heuristic rules as prompt text) |
| *(none)* | `rb` — seeded with the cross-channel preamble only (explicit-rules-override + Strict ID Handling); shared rules can be moved up from channel docs via Runbook Review later |

- Old ids remain readable during the deprecation window; `RunbookChunks` for old ids are deleted after each new path is reindexed (wholesale replace already handles this).
- Migration script: `notif-ingester/scripts/migrate_runbook_paths.py` (idempotent, per-user, logs the mapping).

## Tasks & Scope

### Phase 1 — Path model + storage (backend)
- [ ] `RunbookPath` helpers: `normalize_path`, `encode_id`/`decode_id`, `validate_segment`, kind detection (`root|channel|entity|action`)
- [ ] `finance_api_service.py`: `get/save_runbook_by_path_async`, `list_runbook_tree_async`; keep old methods as thin aliases during migration
- [ ] **Fix latent bug in `list_app_runbooks_async`** (`finance_api_service.py:708-714`): the query projects `c.id, c.packageId, c.label, c._ts` but **not** `c.UserId`, while line 713 filters `item.get("UserId") != user_id` — since `UserId` is never in the projection, the filter skips every item and the method returns `[]` against real Cosmos (the unit test mocks feed full dicts, masking it). Include `c.UserId` in the projection (same fix applies to the new `list_runbook_tree_async`).
- [ ] Migration script + seed of `rb` root

### Phase 2 — Resolution + composition + RAG
- [ ] Shared `_resolve_runbook_paths()` per pipeline (app/sms/email/image); delete `_get_runbook_id`/`_uses_app_runbooks`
- [ ] Generic multi-tier composer with precedence headers + budgets
- [ ] `runbook_index_service.py`: path-based `runbookId`/rule IDs; `_get_rules_context_async` over resolved path list
- [ ] `reclassify_ingestion_async` uses the same resolver (incl. persisted `image_source` for images)

### Phase 3 — Key derivation + action docs
- [ ] Email sender-domain extraction + match against tree
- [ ] `rb/email/_multiple`: sender-agnostic multi-order routing (remove `_is_shopee_email` + `classify_email_shopee_async` special case; shopee rules live at `rb/email/shopee.ph`)
- [ ] `rb/image/_identify`: identify pass with tree-derived vocabulary; persist `raw_payload.image_source`

### Phase 4 — API + review
- [ ] `?path=` on GET/PUT `/runbook`; `GET /runbook/tree`; back-compat for `?type&pkg`
- [ ] Review session `runbook_path`; corrections grouped by derived path

### Phase 5 — Frontend
- [ ] Tree browser + `RunbookPathPicker`; hooks re-keyed by path

### Phase 6 — Cleanup, tests, docs
- [ ] Remove deprecated aliases/params after the window; delete bundled shopee template
- [ ] Tests (via `finance-test-scaffold`): path normalization/encoding, resolver ordering, composition precedence, sender-domain derivation, `_multiple`/`_identify` selection, migration idempotency, rule-ID stability
- [ ] Update `spec.md` (via `spec-updater`): runbook section, endpoints, `Settings` schema, `RunbookChunks` keying

## Risks & Mitigations
- **Prompt budget with 3–4 composed docs** — RAG-first (already primary when chunks are indexed) + per-doc caps in fallback composition.
- **Sender-domain extraction edge cases** (display names, subdomains, `@` in aliases) — deterministic parser with tests; exact-match only (suffix/wildcard matching deferred).
- **`_`-prefix collision** — validation rejects entity keys starting with `_`; action names are a fixed, documented set (`_identify`, `_multiple`; extensible).
- **Migration mis-mapping** — idempotent script, dry-run mode, old ids kept during the window; rule IDs change format (hash input includes path) — acceptable, `RunbookChunks` are replaced wholesale.
- **Reclassify determinism for images** — persist `image_source`; reclassify re-uses it instead of re-running identification.

## Open Questions
1. **Channel segment naming** — plan assumes `app|sms|email|image` (matches existing `?type=` values). Alternative: your original `app_notif|sms|emails|images`. Either works; decision needed before Phase 1.
2. Should `rb` root content be **pinned wholesale** into every classification (like the override preamble today), or flow through normal retrieval? Recommend: pinned header only, retrieval for the rest.
3. Deeper nesting later (e.g. `rb/app/{pkg}/{feature}`)? Schema supports it; resolution stays depth-2 for now.
4. Should `GET /runbook/corrections` auto-suggest *creating* a missing entity doc (e.g. first shopee.ph email arrives)? Nice-to-have, defer.
