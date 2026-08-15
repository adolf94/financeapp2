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

No changes — `is_multi_order` field is **not needed**. Detection is done by the LLM.

### `PendingIngestion` (pending_ingestion.py)

Ensure PBI-010 relation fields exist (add if not yet present):

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
| `services/email_processing_service.py` | Add `_process_multi_order_async(hook, orders, total_amount, accounts, runbook)` — builds **1 PendingIngestion** with multi-order metadata embedded; calls `_resolve_source_account_async()` |
| `services/email_processing_service.py` | Add `_resolve_source_account_async(total_amount, received_at, user_id)` — queries pending ingestion repo (and optionally confirmed LedgerEntries), patches `credit_account_id`, back-ports link to matched SMS/app ingestion |
| `repositories/ingestion_repository.py` | Add `find_by_amount_and_time_async(user_id, amount, around_time, window_minutes=5) -> List[PendingIngestion]` — reusable by PBI-010 general detection too |
| `services/ai_service.py` | Add `classify_email_shopee_async()` — uses `SHOPEE_MULTI_ORDER_PROMPT`, handles response as either list (multi) or single object |
| `prompts/email_prompts.py` | Add `SHOPEE_MULTI_ORDER_PROMPT` — instructs LLM to extract each order separately; also extract `total_checkout_amount` |
| `models/pending_ingestion.py` | Ensure PBI-010 relation fields exist; add `multi_order_items: List[dict] = []` to `AiParsedData` for storing per-order breakdown |
| `runbooks/shopee_email_runbook.md` *(new)* | Shopee-specific classification rules — always loaded when sender is Shopee |

---

## Source Account Resolution Logic

```
# email.received_at = original send time from email Date header (not IMAP fetch time)
total_payment = sum of all order Total Payments parsed from email
candidates = repo.find_by_amount_and_time_async(user_id, total_payment, email.received_at, window=5)

if candidates:
    best = pick candidate with highest confidence / earliest received_at
    credit_account_id = best.ai_parsed.credit_account_id  # e.g., BPI Credit Card

    shopee_ingestion.ai_parsed.credit_account_id = credit_account_id  # applied to credit LedgerEntry on confirm
    shopee_ingestion.possible_related_ingestion_ids.append(best.id)

    best.possible_related_ingestion_ids.append(shopee_ingestion.id)
    repo.update_async(best)  # back-port the link
```

---

## Relation to PBI-010

| PBI-010 Concept | Usage in This PBI |
|---|---|
| `possible_related_ingestion_ids` | SMS/notif ingestion that revealed the card account, linked to the Shopee ingestion |
| `related_transaction_ids` | Populated after Shopee ingestion is confirmed (link to confirmed transaction) |
| `LedgerEntry.ReferenceNumber` | Stores Order ID per debit entry — enables per-order duplicate detection on re-ingestion |
| `find_by_amount_and_time_async` | New shared repo method — reusable by PBI-010 general detection |
| Back-port linking | Source SMS/notif ingestion updated to link back to the Shopee ingestion |
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
