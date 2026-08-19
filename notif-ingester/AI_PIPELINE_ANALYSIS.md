# AI Pipeline — Analysis, Decisions & Implementation Plan
> Last reviewed: 2026-08-17
> This document captures the pipeline flow analysis, open questions (answered),
> and the agreed implementation plan. Update this file as changes are made.

---

## 1. Ingestion Sources → Entry Points

| Source | Entry Function | Hook Type |
|--------|---------------|-----------|
| App Push Notification | `PhoneHookFunction` → `ClassifyNotificationFunction` | `notif_post` |
| SMS | `PhoneHookFunction` → `ClassifyNotificationFunction` | `sms_receive` |
| Image (receipt/screenshot) | `ImageHookFunction` → `ClassifyNotificationFunction` | `image_upload` |
| Email | `check_and_save_emails_async` → `ClassifyNotificationFunction` | `email_received` |

All sources converge at the **CosmosDB Change Feed trigger** (`ClassifyNotificationFunction`),
which routes to the appropriate pipeline via `NotificationTypeDetector`.

---

## 2. Current Pipeline Flow (per source type)

### A. App Notification (`IngestionService`)

```
[PhoneHookFunction] → save hook to CosmosDB
    ↓ (Change Feed)
[ClassifyNotificationFunction]
    → NotificationTypeDetector → "app"
    → IngestionService.process_hook_async()
        1. Embed raw_msg (EmbeddingService)
        2. Vector search top-5 similar transactions
        3. Fetch accounts + vendors + runbook
        3.5 PreprocessingService.process_hook()     ← AI Call #1 (fast, thinking_budget=0)
              extracts: account_numbers, account_names, vendor_names,
                        currency, reference_number, amount, date, is_multi_order
        3.6 _build_related_context_async()          ← DB lookup (no AI)
              uses preprocess ref/amount/date to find related pending/confirmed txns
        4. AiService.classify_async()                    ← AI Call #2 (full classification)
              inputs: runbook + accounts + vendors + vendor_matches + related_context
              returns: AiParsedData incl. is_financial, amounts, accounts, vendor, etc.
              ⚠️  4.5 _apply_vendor_matching() — PLANNED REMOVAL (post-classify, redundant)
                   AI already resolved vendor using pre-classify vendor_matches context.
                   Only unique value = ensure_vendor_and_lookups_async auto-create side-effect.
        5. Auto-confirm logic
        6.5 detect_and_link_relations_async()            ← DB lookup — stores relation IDs
        7. Save PendingIngestion
```

### B. SMS (`SmsProcessingService` extends `IngestionService`)

```
Same as App, with:
- Bootstrap SMS runbook on first use (runbook-sms CosmosDB doc)
- _classify_hook_async() → AiService.classify_sms_async() (SMS-specific prompt)
- Higher auto-confirm threshold via SMS_AUTO_CONFIRM_THRESHOLD env var
```

### C. Email (`EmailProcessingService` extends `IngestionService`)

```
Same as App base, with:
- Bootstrap Email runbook on first use (runbook-email CosmosDB doc)
- _classify_hook_async():
    → if Shopee + is_multi_order → classify_email_shopee_async() (dedicated prompt)
    → else → classify_email_async()
- Post-classify: _resolve_source_account_async() for Shopee (matches SMS/app by amount+time)
- raw_msg overwritten to "[EMAIL]: {ai_summary}" after classify (intentional — shown in UI)
- NO is_financial gate (emails are inherently financial)
```

### D. Image (`ImageProcessingService` extends `IngestionService`)

```
[ImageHookFunction] → upload to Blob Storage → save hook to CosmosDB
    ↓ (Change Feed)
[ClassifyNotificationFunction]
    → NotificationTypeDetector → "image"
    → ImageProcessingService.process_hook_async()
        → process_image_async()
            1. Download blob from Azure Storage
            2. Fetch runbook + accounts + vendors
            2.5 optimize_image_for_ai() (compress/resize — NO AI)
            3. _preprocess_image_and_find_vendor_matches_async()
                   AiService.extract_image_info_async()  ← AI Call #1 (OCR vision)
                   + filename heuristics (no AI)
                   + vendor DB lookup
            3.6 _build_related_context_async()           ← DB lookup (no AI)
            4. AiService.classify_image_async()          ← AI Call #2 (multimodal)
                   inputs: vendor_matches + related_context + runbook + accounts
              ⚠️  5. _apply_vendor_matching() — PLANNED REMOVAL (same issue as App)
            6. status always "Pending" (never auto-confirm — images too risky)
            7. detect_and_link_relations_async()
            8. Save + SignalR broadcast
            9. (PLANNED) embed_and_learn_async() — post-save image embedding
```

> **Note**: Image pipeline bypasses `IngestionService.process_hook_async()` entirely —
> it has its own `process_image_async()`. No embedding/vector search before classify
> (`similar_vectors=[]` hardcoded). Post-classify embedding is planned (see Change 2 below).

---

## 3. Two-Pass Design: Why Preprocessing + Classification are Separate

**Intentional — do not merge into one call.**

The two-pass exists because preprocess output is used BEFORE classification:

```
Preprocess (AI #1)
  └─ extracted: account_numbers, account_names, vendor_names, ref, amount, date, currency
         ↓
  Vendor DB Lookup     ← uses account_numbers + vendor_names → vendor_matches
  Related Txn Lookup   ← uses ref + amount + date → related_context
         ↓
  Both injected into Classify (AI #2) as context
```

Merging would lose the pre-classify vendor and relation context that helps the LLM make better decisions.

**Cost note:** Preprocess uses `thinking_budget=0` (cheap). Two calls is justified by accuracy gain.

### Vendor Matching — The Two-Step Problem (PLANNED FIX)

Currently there are **two** vendor DB operations per notification:

| Step | When | Input | What it does |
|------|------|-------|--------------|
| Pre-classify (3.6a) | Before AI classify | Preprocess-extracted lookups | `search_all_vendor_matches_by_lookups_async` → feeds into AI prompt as context |
| Post-classify (4.5) | After AI classify | AI-output vendor name + AI-built lookups | `_apply_vendor_matching` → SECOND DB lookup, overrides AI decision |

The post-classify step is **redundant** — the AI already received vendor_matches and made its decision.

**Planned fix (Change 7):** Remove `_apply_vendor_matching` entirely (App, SMS, Email, Image).
`ensure_vendor_and_lookups_async` auto-create is also **disabled for now** — vendors are created
manually by the user via the UI, not auto-created by the pipeline.
Vendor `matched`/`is_recommendation`/`lookups` flags are set by the AI (it has full context).

---

## 4. Preprocessing vs Classification Field Overlap

Both passes extract overlapping fields from the same raw text:

| Field | Preprocess (AI #1) | Classify (AI #2) | Conflict risk? |
|-------|-------------------|-----------------|----------------|
| `amount` | ✅ → used for relation lookup | ✅ → stored in `ai_parsed` | ⚠️ could mismatch |
| `reference_number` | ✅ → used for relation lookup | ✅ → stored in `ai_parsed` | ⚠️ could mismatch |
| `date` | ✅ → used for relation lookup | ✅ → stored in `ai_parsed` | ⚠️ could mismatch |
| `account_numbers` | ✅ → vendor DB lookup | ✅ → as sender/recipient fields | Low |
| `account_names` | ✅ → vendor DB lookup | ✅ → as sender/recipient name | Low |
| `vendor_names` | ✅ → vendor DB lookup | ✅ → as vendor.name | Low |
| `currency` | ✅ → exchange rate fetch | ❌ not extracted by classify | N/A |
| `is_multi_order` | ✅ → email routing decision | ❌ not extracted by classify | N/A |
| `is_financial` | ❌ not extracted | ✅ → in AiParsedData | N/A |

**Decision:** Keep duplication as-is. Preprocess serves a different purpose (lookups, routing).
Do NOT inject preprocess values as "hints" into the classify prompt — the transaction log stays
out of the prompt. Relation context is fed via the separate `related_context` block.

---

## 5. `is_financial` Gate — Current State & Fix

### Current state: Dead code (gate bypassed)

`AiService.is_financial_transaction_async()` exists with `thinking_budget=0` but is **never called**.
The `is_financial` flag is returned inline inside the classification response — meaning the full
classify call runs even for OTPs, promos, and marketing notifications.

### Decision: Restore the gate for App + SMS; skip for Email + Image

Implementation via an override hook:

```python
# IngestionService (base):
def _use_is_financial_gate(self) -> bool:
    return True  # App and SMS use the gate

# EmailProcessingService:
def _use_is_financial_gate(self) -> bool:
    return False  # Emails are inherently financial

# ImageProcessingService:
# Gate not applicable — process_image_async() is a completely separate path
```

Gate logic inserted in `IngestionService.process_hook_async()` between step 3 and 3.5:

```python
if self._use_is_financial_gate():
    is_fin = await self._ai_service.is_financial_transaction_async(hook)
    if not is_fin:
        ingestion = PendingIngestion(
            ...status="NonFinancial", ttl=7*24*60*60, ai_parsed=AiParsedData(is_financial=False)
        )
        return await self._repo.add_async(ingestion)
# else: continue to preprocess + classify
```

---

## 6. Cross-Type Related Transaction Matching

### Current state: Already works across all types

`find_candidates_for_relation_async` queries all pending ingestions regardless of type.
Match criteria:
- **Same `reference_number` within 30 days** → `DEFINITE MATCH`
- **Same `amount` within 5 minutes** → `POSSIBLE MATCH`

### Decision: Widen the time window for amount-only matching (no reference number)

Current 5-minute window is too narrow for cross-type scenarios where emails arrive
significantly later than the originating SMS/app notification (e.g., Shopee sends
order confirmation email hours after payment).

**Proposed time windows (amount-only match, no reference number):**
- App/SMS: keep 5 min (same-session near-duplicates between App and SMS)
- Email: widen to **60 minutes** (email confirmation lags behind payment)
- Image: widen to **24 hours** (receipt photo uploaded much later)

Implementation: Add `_get_relation_window_minutes() -> float` override per subclass.
Base returns 5.0. `EmailProcessingService` returns 60.0. `ImageProcessingService` returns 1440.0.

> [!NOTE]
> `_build_related_context_async` (pre-classify) and `detect_and_link_relations_async`
> (post-classify) both use the same window — both should use the override.

### App/SMS 5-min window — email-first gap

Scenario: GCash SMS arrives → email receipt arrives 30 min later.

```
T+00m  SMS processes → 5-min window → email doesn't exist yet → no link (expected)
T+30m  Email processes → 60-min window → FINDS the SMS → backports link to SMS ✅
```

The later-arriving pipeline backports the link bidirectionally. This works when SMS arrives first.

**Gap case:** Email arrives FIRST, gets confirmed → SMS arrives 30 min later.
SMS searches confirmed ledger entries with 5-min window → misses the email-confirmed transaction.
Email already processed so won't re-scan for the late-arriving SMS.

**Fix (Change 5b):** Widen `search_confirmed_ledger_entries_async` window to 60 min for App/SMS.
Confirmed entries are immutable reference points — wider lookback has low false-positive risk.

---

## 7. Dead Code

| Item | Location | Status |
|------|----------|--------|
| `is_financial_transaction_async()` | `ai_service.py:603` | Keep — will be wired up |
| `APP_IS_FINANCIAL_PROMPT` | `app_prompts.py:82` | Keep — used by above |
| `SMS_IS_FINANCIAL_PROMPT` | `sms_prompts.py:10` | Keep — used by above |
| `SMS_EXTRACTION_PROMPT` | `sms_prompts.py:27` | **Delete** — never called, subset of generic prompt |

**`SMS_EXTRACTION_PROMPT` vs generic `EXTRACTION_PROMPT`:**
- SMS version: only extracts `account_numbers`, `account_names`, `potential_vendor_names`
- Generic: extracts ALL of the above + `currency`, `reference_number`, `amount`, `date`, `is_multi_order`
- Generic is a strict superset. SMS version has no unique value.

---

## 8. Image Pipeline Gaps

| Gap | Decision |
|-----|---------|
| No vector search before classify (`similar_vectors=[]`) | Keep — text embeddings don't apply to images |
| No post-classify embedding for learning | **Add** — embed AI summary after save so future similar screenshots find past matches |
| No auto-confirm | **Keep always Pending** — blurry totals / partial receipts too risky |

**Adding post-classify embedding for images:**
After `saved_ingestion = await self._repo.add_async(ingestion)`:
```python
# Only embed if financial and has enough data to learn from
if saved_ingestion.ai_parsed and saved_ingestion.ai_parsed.is_financial is not False:
    if saved_ingestion.ai_parsed.vendor and saved_ingestion.ai_parsed.debit_account_id:
        try:
            await self.embed_and_learn_async(saved_ingestion)
        except Exception as e:
            logger.warning(f"[ImageProcessingService] Embed+learn failed: {e}")
```

---

## 9. `is_multi_order` Persistence

**Problem:** `is_multi_order` lives only in `ExtractedAccountInfo` (in-memory). On reclassify,
`EmailProcessingService._classify_hook_async` checks `extracted_info.is_multi_order` to decide
whether to use the Shopee multi-order prompt — but the reclassify path re-runs preprocess
anyway, so this is less critical. Still, persist for auditability.

**Decision:** Persist to `raw_payload["extracted_info"]["is_multi_order"]` immediately after
preprocess in `IngestionService.process_hook_async()`.

```python
# After extracted_info = await self._preprocessing_service.process_hook(hook)
if hook.raw_payload is not None:
    hook.raw_payload.setdefault("extracted_info", {})
    hook.raw_payload["extracted_info"]["is_multi_order"] = extracted_info.is_multi_order
    hook.raw_payload["extracted_info"]["currency"] = extracted_info.currency
```

The existing bypass path (when `extracted_info` already in `raw_payload`) already reads `is_multi_order` from there.

---

## 10. `SmsProcessingService` Signature Bug

`_classify_hook_async` override is missing `related_context` and `extracted_info` params:

```python
# Current (broken):
async def _classify_hook_async(
    self, hook, similar_vectors, accounts, runbook_content, vendors, vendor_matches,
    operation_id, connection_id, stream_reasoning, exchange_rate_info, user_corrections
) -> 'AiParsedData':

# Fix:
async def _classify_hook_async(
    self, hook, similar_vectors, accounts, runbook_content, vendors, vendor_matches,
    operation_id=None, connection_id=None, stream_reasoning=True,
    exchange_rate_info="", user_corrections=None,
    related_context="", extracted_info=None      # ← add these
) -> 'AiParsedData':
    return await self._ai_service.classify_sms_async(
        ..., related_context=related_context      # ← pass through
    )
```

`extracted_info` is intentionally NOT passed to `classify_sms_async` — only EmailProcessingService
uses it for multi-order routing.

---

## 11. Implementation Plan (Ordered)

| # | Change | File(s) | Status |
|---|--------|---------|--------|
| 1 | Fix `SmsProcessingService._classify_hook_async` signature (add `related_context`, `extracted_info`) | `sms_processing_service.py` | ✅ Done |
| 2 | Delete `SMS_EXTRACTION_PROMPT` dead code | `sms_prompts.py` | ✅ Done |
| 3 | Persist `is_multi_order` + `currency` to `raw_payload` after preprocess | `ingestion_service.py` | ✅ Done |
| 4 | Restore `is_financial` gate via `_use_is_financial_gate()` override | `ingestion_service.py`, `email_processing_service.py` | ✅ Done |
| 5 | Widen amount-only relation window per type (`_get_relation_window_minutes()`) | `ingestion_service.py` + subclasses | ✅ Done |
| 5b | Widen confirmed ledger search window for App/SMS to 60 min (email-first gap fix) | `ingestion_service.py` | ✅ Done |
| 6 | Add post-classify embedding for Image pipeline | `image_processing_service.py` | ✅ Done |
| 7 | Remove post-classify `_apply_vendor_matching()` entirely — no replacement, `ensure_vendor_and_lookups_async` auto-create disabled | `ingestion_service.py`, `image_processing_service.py` | ✅ Done |

---

## 12. Decisions Log

| Decision | Choice | Date |
|----------|--------|------|
| `is_financial` gate | Restore for App+SMS; skip Email+Image | 2026-08-17 |
| Gate for Email | Skip via `_use_is_financial_gate()` override returning False | 2026-08-17 |
| Image auto-confirm | Never — always Pending (too risky) | 2026-08-17 |
| Image vector search (pre-classify) | Keep as [] — text embeddings don't apply | 2026-08-17 |
| Image post-classify embedding | Add — repeated screenshots need similarity matching | 2026-08-17 |
| Two-pass preprocess keep | Yes — vendor lookup + relation context is the value | 2026-08-17 |
| Preprocess hints into classify | No — keep transaction log out of prompt | 2026-08-17 |
| Amount-only relation window | Widen: Email=60min, Image=24h, App/SMS=5min | 2026-08-17 |
| Confirmed ledger search window | App/SMS widen to 60min — catches email-first gap | 2026-08-17 |
| `SMS_EXTRACTION_PROMPT` | Delete — subset of generic, never called | 2026-08-17 |
| `is_multi_order` persistence | Persist to `raw_payload["extracted_info"]` | 2026-08-17 |
| Email `raw_msg` overwrite | Keep — summary shown in UI, full email is too long | 2026-08-17 |
| Post-classify `_apply_vendor_matching` | Remove entirely — redundant; AI resolves vendor from pre-classify context | 2026-08-17 |
| `ensure_vendor_and_lookups_async` auto-create | Disabled — vendors created manually via UI only | 2026-08-17 |
