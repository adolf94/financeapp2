---
github_issue: 18
github_url: https://github.com/adolf94/financeapp2/issues/18
status: open
---
# PBI: AI Pipeline Optimization and Gap Resolution

## Overview
Based on the architectural analysis and decisions documented in `notif-ingester/AI_PIPELINE_ANALYSIS.md`, this PBI resolves pipeline bugs, eliminates redundant operations, restores dead-code gates, and tunes relation-matching windows across all notification ingestion pipelines (App, SMS, Email, Image).

---

## Background & Rationale
1. **Broken Method Signatures**: `SmsProcessingService._classify_hook_async` is missing `related_context` and `extracted_info` arguments present in the base class, leading to runtime failures or lost relation context.
2. **Dead Code**: `SMS_EXTRACTION_PROMPT` is obsolete and unused (a strict subset of generic extraction prompt).
3. **Missing State Persistence**: `is_multi_order` and `currency` extracted in preprocessing are lost across reclassifications unless persisted to `raw_payload["extracted_info"]`.
4. **Bypassed `is_financial` Gate**: `AiService.is_financial_transaction_async()` (fast, budget=0) is currently bypassed, causing OTPs and promos to trigger expensive classification calls.
5. **Relation Matching Window Tuning**: Cross-source notifications (e.g. Email receipts arriving after SMS) require broader time windows for amount-only matches (Email: 60m, Image: 24h, App/SMS: 5m, Confirmed Ledger search: 60m).
6. **Image Pipeline Post-Classify Embedding**: Image receipts currently lack embedding after classification, preventing future image/screenshot similarity matches.
7. **Redundant Post-Classify Vendor Matching**: `_apply_vendor_matching()` overrides AI decisions with a secondary DB lookup; AI already receives pre-classify `vendor_matches`. Auto-creation is disabled in favor of manual user management.

---

## Tasks & Scope

### 1. Fix `SmsProcessingService._classify_hook_async` Signature
- Update `_classify_hook_async` signature in `sms_processing_service.py` to accept `related_context=""` and `extracted_info=None`.
- Pass `related_context=related_context` to `self._ai_service.classify_sms_async(...)`.

### 2. Cleanup Dead Code in SMS Prompts
- Remove `SMS_EXTRACTION_PROMPT` from `sms_prompts.py`.

### 3. Persist Extracted Info in Raw Payload
- In `IngestionService.process_hook_async()` (in `ingestion_service.py`), store `is_multi_order` and `currency` into `hook.raw_payload["extracted_info"]` immediately following preprocessing.

### 4. Restore `is_financial` Gate for App & SMS
- Add `_use_is_financial_gate(self) -> bool` method in `IngestionService` (returns `True`).
- Override `_use_is_financial_gate(self) -> bool` in `EmailProcessingService` to return `False`.
- In `IngestionService.process_hook_async()`, run `await self._ai_service.is_financial_transaction_async(hook)` if the gate is active. If false, save `PendingIngestion` with `status="NonFinancial"` and `ttl=7*24*60*60`.

### 5. Tune Cross-Type Relation Window
- Add `_get_relation_window_minutes(self) -> float` in `IngestionService` (default: `5.0`).
- Override `_get_relation_window_minutes()` in `EmailProcessingService` (`60.0`) and `ImageProcessingService` (`1440.0`).
- Widen `search_confirmed_ledger_entries_async` search window to `60` minutes for App/SMS to fix the email-first gap.

### 6. Add Post-Classify Embedding for Image Pipeline
- In `image_processing_service.py`, trigger `embed_and_learn_async(saved_ingestion)` after saving if `is_financial` is true and vendor/debit accounts are present.

### 7. Remove Redundant Post-Classify `_apply_vendor_matching()`
- Remove `_apply_vendor_matching()` calls from `ingestion_service.py` and `image_processing_service.py`.
- Rely directly on AI-resolved vendor details provided via pre-classify context.

---

## Acceptance Criteria
- [x] `SmsProcessingService._classify_hook_async` accepts and passes `related_context` correctly without TypeError.
- [x] Non-financial SMS and App notifications are classified quickly with status `NonFinancial` without running the full classification AI call.
- [x] Email and Image pipelines correctly relate to prior SMS/App notifications across wider time windows (60m and 24h).
- [x] Saved financial image ingestions generate embeddings for future similarity searches.
- [x] `raw_payload["extracted_info"]` retains `is_multi_order` and `currency`.
- [x] Redundant `_apply_vendor_matching` calls removed.
- [x] Automated tests covering the modified ingestion services pass.
