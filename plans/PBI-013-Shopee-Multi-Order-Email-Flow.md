---
github_issue: 13
github_url: https://github.com/adolf94/financeapp2/issues/13
status: open
---
# PBI 011: Shopee Multi-Order Email Ingestion Flow

## Problem Statement

Shopee payment confirmation emails contain **multiple orders in a single email**, each from a different seller with its own Order ID, items, subtotal, and `Total Payment`. The current email ingestion pipeline (`EmailProcessingService`) maps 1 email → 1 `PendingIngestion` → 1 transaction, which cannot model this structure.

Additionally, the Shopee email does **not** identify which credit card was used — only "Credit/Debit Card". The actual card can be inferred from a matching SMS or app notification (same total amount, within 5 minutes of the email).

> **Email Timestamp**: The `received_at` timestamp saved for email ingestions is the **original send time** from the email's `Date` header (extracted by `get_original_sent_time()`). This is the actual time the email was sent/received by the mail server — NOT the time we fetched it via IMAP. This is important for the 5-minute time-window matching against SMS/app notifications.

---

## Goals

1. Detect multi-order emails at the LLM classification stage (no regex pre-check).
2. Map **1 Shopee email → 1 `PendingIngestion` → 1 `Transaction`** with N+1 `LedgerEntry` rows:
   - **1 credit entry**: full checkout total, linked to the resolved credit card account.
   - **N debit entries**: one per Shopee order, each with `reference_number` = Order ID (e.g. `#260808R1R49PTC`) and `amount` = `Total Payment` per order.
3. Resolve the source credit card account by cross-referencing recent SMS/app ingestions via PBI-010 criteria (amount + time window).
4. Link the resolved SMS/app ingestion using PBI-010's existing relationship fields.

---

## Technical Requirements

### 1. Multi-Order Detection (LLM)

- Multi-order detection is **fully handled by the LLM** — no regex pre-check step.
- The email body is always passed to `SHOPEE_MULTI_ORDER_PROMPT`.
- The LLM determines whether the email contains 1 or N orders and returns either:
  - A **JSON array** of per-order objects (N orders found, N ≥ 2), or
  - A **single object** (1 order or no order detected).
- `EmailProcessingService` inspects the response: if it is an array → multi-order path; if object → standard single-ingestion path.
- No `is_multi_order` field or pre-classification step required.

### 2. Multi-Order Classification (AI)

- New `SHOPEE_MULTI_ORDER_PROMPT` instructs the LLM to extract each order as a separate object.
- Each object contains:
  - `amount` = `Total Payment` per order (post-discount, post-shipping) — not the raw `Price`.
  - `reference_number` = Order ID (e.g., `#260808R1R49PTC`).
  - `vendor` = seller name (e.g., `shottbeveragesph`).
- The prompt also extracts the **total checkout amount** (sum of all orders) for source account resolution.

### 3. Transaction Structure: 1 Ingestion → 1 Transaction, N+1 LedgerEntries

Instead of creating N separate `PendingIngestion` records, the multi-order path creates **a single `PendingIngestion`** that maps to **one `Transaction`** with multiple `LedgerEntry` rows:

| Entry | Type | Amount | Reference Number | Account |
|---|---|---|---|---|
| Credit entry | Credit | Total checkout amount | — | Resolved credit card (or null) |
| Debit entry × N | Debit | Per-order `Total Payment` | Order ID (e.g. `#260808R1R49PTC`) | Shopee / seller expense account |

- The `reference_number` on each debit `LedgerEntry` is the **Order ID** — this enables PBI-010 duplicate detection at the journal entry level.
- This approach uses the existing `LedgerEntry.ReferenceNumber` field already present in the model.
- **No new model fields required** for multi-order support.

### 4. Source Account Resolution

- After building the multi-order `PendingIngestion`, query the repository for a recent SMS/app `PendingIngestion` or confirmed `LedgerEntry` matching:
  - `user_id` = same user
  - `amount` = **total checkout amount** (sum of all order `Total Payment` values)
  - `received_at` within **5 minutes** of the email's send time (original `Date` header, not fetch time)
- If a match is found:
  - Extract its `credit_account_id` (the credit card account).
  - Apply that `credit_account_id` to the **credit `LedgerEntry`** of the Shopee transaction.
  - Link via `possible_related_ingestion_ids` on both sides (back-port to the SMS/notif ingestion).
- If no match is found:
  - `credit_account_id` remains `null` on the credit entry.
  - Status stays `Pending` for user to resolve manually.

### 5. Shopee Email Runbook

- New `runbooks/shopee_email_runbook.md` with Shopee-specific classification rules:
  - Always `Expense`.
  - Use `Total Payment` as `amount` — voucher discounts already reflected, do not deduct again.
  - Shipping fee = 0.00 is normal and should not be added.
  - Leave `credit_account_id` blank if card is unresolvable.

---

## Model Updates

### `ExtractedAccountInfo` (preprocessing_service.py)

`is_multi_order` is **not needed** — detection is done by the LLM. However, per PBI-010's updated preprocessing step, `ExtractedAccountInfo` now also carries:

```python
reference_number: Optional[str] = None   # extracted from raw text pre-classify
amount: Optional[float] = None           # extracted from raw text pre-classify
date: Optional[str] = None               # ISO string from raw text pre-classify
```

For Shopee emails, `amount` extracted here is the **total checkout amount** (what the preprocessing AI sees from the email body). This is the value used by step 3.6 (early relation lookup) to find the matching SMS/app notification — removing the need for a separate late-stage amount computation in `_resolve_source_account_async`.

### `PendingIngestion` (pending_ingestion.py)

Relation fields are **already implemented** ✅ (done in PBI-010):

```python
class PendingIngestion(BaseModel):
    # ... existing fields ...
    related_ingestion_ids: List[str] = Field(default_factory=list)
    related_transaction_ids: List[str] = Field(default_factory=list)
    possible_related_ingestion_ids: List[str] = Field(default_factory=list)
    possible_related_transaction_ids: List[str] = Field(default_factory=list)
```

### `LedgerEntry` (ledger_entry.py / LedgerEntry.cs)

Already has `ReferenceNumber` — ✅ no change needed. The Order ID per Shopee order is stored here.

### Transaction Structure (Python payload for C# backend)

When confirming a Shopee multi-order ingestion, the C# backend receives:

```json
{
  "Type": "Expense",
  "Note": "Shopee checkout",
  "Entries": [
    { "AccountId": "<credit-card-account-id>", "Amount": -1250.00, "Note": "Shopee total", "ReferenceNumber": null },
    { "AccountId": "<shopee-expense-account>", "Amount": 750.00, "Note": "shottbeveragesph", "ReferenceNumber": "#260808R1R49PTC" },
    { "AccountId": "<shopee-expense-account>", "Amount": 500.00, "Note": "anothersellerph",  "ReferenceNumber": "#260808XYZABC" }
  ]
}
```

---

## Implementation Plan

| File/Component | Change |
|---|---|
| `services/email_processing_service.py` | Always call `classify_email_shopee_async()` for Shopee emails; inspect response — if array → `_process_multi_order_async()`, if object → standard single path |
| `services/email_processing_service.py` | Add `_process_multi_order_async(hook, orders, total_amount, accounts, runbook)` — builds **1 PendingIngestion** with multi-order metadata embedded; uses `credit_account_id` resolved from step 3.6 `related_context` (see PBI-010 pipeline) |
| `services/email_processing_service.py` | `_resolve_source_account_async()` is now a **thin wrapper** over PBI-010's step 3.6 early relation lookup. It reads the pre-resolved candidate from `related_context` rather than running its own independent query. Falls back to direct repo query only if step 3.6 produced no candidates. |
| `repositories/ingestion_repository.py` | `find_by_amount_and_time_async(user_id, amount, around_time, window_minutes=5) -> List[PendingIngestion]` — already exists ✅; shared by PBI-010 step 3.6 and this PBI |
| `services/ai_service.py` | `classify_email_shopee_async()` — uses `SHOPEE_MULTI_ORDER_PROMPT`; also receives `related_context` block (same as all other classify methods per PBI-010 step 4) |
| `prompts/email_prompts.py` | `SHOPEE_MULTI_ORDER_PROMPT` — instructs LLM to extract each order separately; also extract `total_checkout_amount`; includes `{related_context}` placeholder |
| `models/pending_ingestion.py` | Relation fields already present ✅; `multi_order_items: List[dict] = []` on `AiParsedData` for per-order breakdown |
| `runbooks/shopee_email_runbook.md` *(new)* | Shopee-specific classification rules — always loaded when sender is Shopee |

---

## Source Account Resolution Logic

Per the updated PBI-010 pipeline, **source account resolution is now driven by step 3.6 (early relation lookup)** which runs before the LLM classify call. For Shopee emails:

```
# Step 3.5 — Preprocessing extracts total_checkout_amount and email send time
# (email.received_at = original send time from Date header, not IMAP fetch time)
extracted_info.amount = total_checkout_amount   # from preprocessing AI
extracted_info.date   = email send time (ISO)

# Step 3.6 — Early relation lookup (shared PBI-010 logic)
candidates = repo.find_by_amount_and_time_async(
    user_id, extracted_info.amount, resolved_effective_time, window=5
)
confirmed  = finance_api.search_confirmed_ledger_entries_async(...)

related_context = format_related_context(candidates, confirmed)
# → e.g. "[POSSIBLE] GCash SMS, PHP 1250.00, within 3 min — Credit: BPI Credit Card"

# Step 4 — Shopee classify receives related_context
classify_email_shopee_async(..., related_context=related_context)
# LLM uses this to infer credit_account_id from the matched SMS/app notification

# Post-classify (_resolve_source_account_async thin wrapper)
if not ai_parsed.credit_account_id and candidates:
    best = candidates[0]
    ai_parsed.credit_account_id = best.ai_parsed.credit_account_id

shopee_ingestion.possible_related_ingestion_ids.append(best.id)
best.possible_related_ingestion_ids.append(shopee_ingestion.id)
repo.update_async(best)  # back-port the link
# Full persist-and-link is handled by detect_and_link_relations_async in step 6.5
```

---

## Relation to PBI-010

| PBI-010 Concept | Usage in This PBI |
|---|---|
| `ExtractedAccountInfo.amount` / `.date` | Preprocessing extracts total checkout amount + send time — feeds directly into step 3.6 early lookup |
| Step 3.6 early relation lookup | Shared logic; finds matching SMS/app notification pre-classify; produces `related_context` |
| `CLASSIFICATION_PROMPT` `{related_context}` block | `SHOPEE_MULTI_ORDER_PROMPT` also includes this placeholder — LLM infers `credit_account_id` from matched SMS |
| `possible_related_ingestion_ids` | SMS/notif ingestion that revealed the card account, cross-linked to the Shopee ingestion |
| `related_transaction_ids` | Populated after Shopee ingestion is confirmed (link to confirmed transaction) |
| `LedgerEntry.ReferenceNumber` | Stores Order ID per debit entry — enables per-order duplicate detection on re-ingestion |
| `find_by_amount_and_time_async` | Shared repo method ✅ already implemented; used by both PBI-010 step 3.6 and this PBI |
| Back-port linking | Handled by `detect_and_link_relations_async` in step 6.5 (post-classify) |
| Email timestamp | `received_at` = original email send time (from `Date` header), not IMAP fetch time — ensures accurate 5-min window match |

---

## Verification Plan

### Manual

1. Feed a Shopee 2-order payment confirmation email into the ingester.
2. Verify **1** `PendingIngestion` record is created with `multi_order_items` containing both orders (correct `amount`, `reference_number` = Order ID, `vendor` = seller name).
3. Send a matching credit card charge SMS (same total amount, within 5 min of email send time).
4. Verify the Shopee ingestion has `credit_account_id` set to the matched card account.
5. Verify the Shopee ingestion and the SMS ingestion are cross-linked via `possible_related_ingestion_ids`.
6. Confirm the Shopee ingestion and verify 1 Transaction is created with:
   - 1 credit `LedgerEntry` (full amount, matched card account).
   - N debit `LedgerEntry` rows (one per order, each with Order ID as `ReferenceNumber`).

### Automated Tests

- Unit test `classify_email_shopee_async()` response handling:
  - Single-order Shopee email → returns single object, creates 1 standard ingestion.
  - Two-order Shopee email → returns array (length 2), creates 1 multi-order ingestion with 2 items in `multi_order_items`.
  - Non-Shopee email (control) → not routed to this path.
- Unit test `_resolve_source_account_async()`: matching candidate found, no candidate, candidate outside 5-min window.
- Unit test: confirm multi-order ingestion → verify correct N+1 LedgerEntry payload sent to C# backend.
