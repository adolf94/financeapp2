# Finance App - Pending Implementation Tasks

Based on the `spec.md`, the following features are pending implementation:

## 0. AI Knowledge Base Retrieval Upgrade (PBI-022)
**Description:** Fix retrieval fundamentals, add hybrid search + runbook RAG, and grounding hooks in `notif-ingester/` per `plans/PBI-022-AI-Knowledge-Base-Retrieval-Upgrade.md`.
- [x] **1.1 Unified embedding space:** `services/transaction_card.py` — query side embeds a "transaction card" (vendor candidates + accounts + app) matching the learning-side `embed_text`; store `raw_msg_summary` on `TransactionVector` (+ synced C# model).
- [x] **1.2/2 Hybrid retrieval:** `services/retrieval_service.py` — vector + in-process BM25 lexical channels fused via Reciprocal Rank Fusion; vendor-lookup signal as third channel; storage-agnostic (swappable `IVectorRepository`).
- [x] **3 Runbook RAG:** `services/runbook_index_service.py` — rule-atomic chunking (### / per-bullet for fat sections), section-title context carried, `pinned` rules always injected, stable rule IDs (`R-APP-xxxx`), hybrid retrieval per classification; `RunbookChunks` Cosmos container (partition `/UserId`); re-index on runbook save.
- [x] **Wiring:** preprocess-before-embed ordering in `ingestion_service.process_hook_async` + `reclassify_ingestion_async`; RetrievalService replaces raw vector search; rule chunks replace whole-runbook injection (fallback preserved); image pipeline retrieval (dropped hardcoded `similar_vectors=[]`); DI in `function_app.py` / `email_fetching_service.py`.
- [x] **4 Grounding (partial):** rule IDs injected with rules; abstention prompt hardening deferred to follow-up.
- [x] **Tests:** `tests/test_retrieval_upgrade.py` — 37 tests covering chunker, BM25/RRF, card alignment, wiring, pinned-rule retrieval, save-trigger reindex, account-name grounding in similar-transaction context.
- [ ] **Deployment:** provision the `RunbookChunks` Cosmos container (partition `/UserId`) in the target DB before deploying; do a one-time `reindex_runbook_async` pass (or save each runbook once) to populate chunks.
- [ ] **5 Eval harness + 4 full grounding/corrections loop + cross-encoder reranker:** deferred follow-up (Phase 4–5 of PBI-022).

## 1. Recurring Transactions (Section 2.3)
**Description:** Automate data entry for recurring schedules and auto-generate transactions on scheduled dates.
- [x] **Backend:** Create `RecurringTransaction` entity, DTOs, and interface.
- [x] **Backend:** Implement API endpoints (CRUD) for recurring schedules.
- [x] **Backend:** Implement background worker/cron job to automatically process and generate due transactions.
- [x] **Frontend:** Create UI in the "Add Transaction" modal (or a dedicated page) to set schedules (Daily, Weekly, Monthly, Yearly).
- [x] **Frontend:** Create a view to manage (pause/edit/cancel) active recurring transactions.

## 2. Category History View (Section 2.7)
**Description:** Drill-down view for transactions tied to a specific primary group or specific selection.
- [x] **Frontend:** Create a `CategoryDetails.tsx` page (similar to `AccountDetails.tsx`).
- [x] **Frontend:** Link to this page from the Analysis charts or a dedicated categories list.
- [x] **Backend:** Ensure `GET /transactions` supports filtering by `AccountGroupId` (if not already supported).

## 3. Custom Billing Cycles / Statement Cut-off (Section 2.7)
**Description:** Account History view should support custom billing cycles (Statement Cut-off Date) for credit cards.
- [x] **Backend:** Add `StatementCutoffDay` to the `Account` model.
- [x] **Frontend:** Update `AccountDetails.tsx` to group transactions by billing cycle rather than just standard chronological months for credit card accounts.

## 5. AI Account-ID Hallucination Elimination (PBI-024)
**Description:** Stop the AI from hallucinating `debit/credit_account_id` GUIDs (`notif-ingester/`), per `plans/PBI-024-Account-ID-Hallucination-Elimination.md`. The model picks accounts by `Group | Name` label; code resolves and validates labels against the fetched accounts list with a bounded repair-retry loop.
- [x] **1. Label registry:** `services/account_label_registry.py` — build normalized `Group | Name` → account lookup from the **fetched accounts list** (trim/collapse whitespace, case-insensitive, separator drift tolerated); duplicate-label ambiguity detection; `resolve(label)` + name-only fallback + `valid_account_ids()`; unit tested.
- [x] **2. Label-based prompt rendering:** `ai_service.py` — `_format_accounts_for_classification` drops the GUID column (renders `Group | Name | Tags`); `_build_context` renders historical accounts by name only (N/A when unknown — never the GUID); `_format_user_corrections` renders labels. **No classification prompt ever receives a raw GUID.** (`_format_accounts` keeps GUIDs for the runbook-review flow, which keys account-description updates by ID.)
- [x] **3. Label→GUID resolution:** shared `_classify_with_account_repair_async` executor in `ai_service.py` used by all four `classify_*` methods (+ `_finalize_shopee` for the multi-order branch) — resolves `debit/credit_account_name` labels to GUIDs after `_extract_json`, including `orders`/`multi_order_items` per-item labels, and cross-checks against the fetched list; de-duplicated the four classify call+log+parse blocks.
- [x] **4. Prompt schema updates:** `prompts/{app,sms,email,image}_prompts.py` — schema fields → `debit_account_name` / `credit_account_name` (exact `Group | Name` line, or null + `suggested_account_creation`); Shopee prompt per-order `debit_account_name` and `credit_account_name`; all "DO NOT hallucinate GUID" boilerplate removed.
- [x] **5. Validation + repair-retry loop:** implemented inside `AiService._classify_with_account_repair_async` (covers all pipelines incl. image/Shopee, which bypass `_classify_hook_async`) — every attempt's returned pairs validated against the fetched list (unknown → invalid, ambiguous → invalid with conflicts, unknown-with-`suggested_account_creation` → self-healed without retry); on invalid, re-classify with corrective feedback appended to the prompt; capped by `AI_ACCOUNT_SELECT_MAX_RETRIES` (default 3).
- [x] **6. Terminal fail-safe:** after final failed attempt — failed-side IDs nulled (valid side preserved), confidence capped at 0.5, `is_auto_confirmed = False`, notes = "AI could not select valid accounts after N attempt(s) (invalid: …) — please pick accounts manually."; auto-confirm gating in `process_hook_async` then routes to `Pending` review.
- [x] **7. Write-path guards:** `finance_api_service.create_transaction_async` verifies all referenced accounts (incl. multi-order debit IDs) exist via a single partitioned Accounts query before writing — raises on unknown IDs so auto-confirm falls back to Pending (no orphan LedgerEntries); `ingestion_service.embed_and_learn_async` refuses to learn when either ID doesn't resolve (stops retrieval-loop poisoning).
- [x] **8. Tests:** `tests/test_account_labels.py` (26 tests — registry normalization/ambiguity/resolution; validator incl. legacy GUID answers and multi-order payloads; retry loop with mocked streams: invalid→valid, terminal fail-safe, retries disabled); updated `test_retrieval_upgrade.py` context tests to label-based expectations; `test_shopee_multi_order.py` stubs account existence + new unknown-account rejection test; fixed pre-existing `test_image_classification_prompt_formatting` kwarg bug. Full suite: 121 passed.
- [x] **9. Docs:** `spec.md` AiService section updated; live runbook in `cosmos/settings.json` already uses the "Strict Account Selection" `Group | Name` rule (matches this design — no edit needed).

## 6. Goal Tracking (Section 2.8)
**Description:** Track progress towards savings goals.
- [ ] **Backend:** Create `Goal` entity (Name, Target Amount, Target Date, Linked Account IDs).
- [ ] **Backend:** Implement API endpoints to manage savings goals.
- [ ] **Frontend:** Build a UI to create and manage goals.
- [ ] **Frontend:** Update `useAnalysis.ts` to calculate real progress instead of using the hardcoded `goalProgress: 65` value.

## 7. Shopee Multi-Order Email Flow (Section 2.4 / PBI-013)
**Description:** Support multi-order Shopee checkout emails mapped to 1 ingestion, 1 transaction with N+1 ledger entries, and source account card resolution.
- [x] **Ingester:** Add `SHOPEE_MULTI_ORDER_PROMPT` and `classify_email_shopee_async` in AI service.
- [x] **Ingester:** Add `find_by_amount_and_time_async` in Cosmos repository for candidate resolution.
- [x] **Ingester:** Add `_resolve_source_account_async` and Shopee email handling in `EmailProcessingService`.
- [x] **Backend & Ingester:** Implement 1 Transaction with N+1 LedgerEntries in `TransactionFunctions.cs` and `FinanceApiService.cs`.
- [x] **Frontend:** Add multi-order chip breakdown in `PendingIngestionCard` and auto-prefill journal lines in `AddTransactionContext`.
