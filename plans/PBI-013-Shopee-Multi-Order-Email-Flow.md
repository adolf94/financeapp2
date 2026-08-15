---
github_issue: 13
github_url: https://github.com/adolf94/financeapp2/issues/13
status: open
---
# PBI 011: Shopee Multi-Order Email Ingestion Flow

## Problem Statement

Shopee payment confirmation emails contain **multiple orders in a single email**, each from a different seller with its own Order ID, items, subtotal, and `Total Payment`. The current email ingestion pipeline (`EmailProcessingService`) maps 1 email → 1 `PendingIngestion` → 1 transaction, which cannot model this structure.

Additionally, the Shopee email does **not** identify which credit card was used — only "Credit/Debit Card". The actual card can be inferred from a matching SMS or app notification (same total amount, within 5 minutes of the email).

---

## Goals

1. Detect multi-order emails at the preprocessing stage (no extra LLM call).
2. Split into N classified `PendingIngestion` records — one per order.
3. Resolve the source credit card account by cross-referencing recent SMS/app ingestions via PBI-008 criteria (amount + time window).
4. Link all sibling ingestions using PBI-008's existing relationship fields.

---

## Technical Requirements

### 1. Multi-Order Detection (LLM)

- Multi-order detection is **fully handled by the LLM** — no regex pre-check step.
- The email body is always passed to `SHOPEE_MULTI_ORDER_PROMPT`.
- The LLM determines whether the email contains 1 or N orders and returns either:
  - A **JSON array** of `AiParsedData` objects (N orders found, N ≥ 2), or
  - A **single `AiParsedData` JSON object** (1 order or no order detected).
- `EmailProcessingService` inspects the response: if it is an array → multi-order path; if object → standard single-ingestion path.
- No `is_multi_order` field or pre-classification step required.

### 2. Multi-Order Classification (AI)

- New `SHOPEE_MULTI_ORDER_PROMPT` instructs the LLM to return a **JSON array** of order objects.
- Each object maps to the full `AiParsedData` schema.
- Key prompt rules:
  - `amount` = `Total Payment` per order (post-discount, post-shipping) — not the raw `Price`.
  - `reference_number` = Order ID (e.g., `#260808R1R49PTC`).
  - `vendor` = seller name (e.g., `shottbeveragesph`).
  - `transaction_type` = `Expense`.
  - `credit_account_id` = `null` — card is unknown from email alone.

### 3. Sibling Ingestion Linking (PBI-008 Integration)

- N `PendingIngestion` records are created, one per order.
- Each sibling's ID is written into every other sibling's `related_ingestion_ids` (definite relation — same checkout session).
- Uses existing PBI-008 model fields — **no new fields introduced**.

### 4. Source Account Resolution

- After N ingestions are built, query the repository for a recent SMS/app `PendingIngestion` or confirmed transaction matching:
  - `user_id` = same user
  - `amount` = **total payment of the entire Shopee checkout** (sum of all order `Total Payment` values)
  - `received_at` within **5 minutes** of the email's `received_at`
- If a match is found:
  - Extract its `credit_account_id` (the credit card account).
  - Apply that `credit_account_id` to **all** Shopee order ingestions.
  - Link via `possible_related_ingestion_ids` on both sides (back-port to the SMS/notif ingestion).
- If no match is found:
  - `credit_account_id` remains `null`.
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

Ensure PBI-010 relation fields exist (add if not yet present — may already be added by PBI-010):

```python
class PendingIngestion(BaseModel):
    # ... existing fields ...
    related_ingestion_ids: List[str] = Field(default_factory=list)
    related_transaction_ids: List[str] = Field(default_factory=list)
    possible_related_ingestion_ids: List[str] = Field(default_factory=list)
    possible_related_transaction_ids: List[str] = Field(default_factory=list)
```

---

## Implementation Plan

| File/Component | Change |
|---|---|
| `services/email_processing_service.py` | Always call `classify_email_shopee_async()` for Shopee emails; inspect response — if array → `_process_multi_order_async()`, if object → standard single path |
| `services/email_processing_service.py` | Add `_process_multi_order_async(hook, orders: List[AiParsedData], accounts, runbook, vendors, vendor_matches)` — creates N ingestions with cross-linked `related_ingestion_ids`, calls `_resolve_source_account_async()` |
| `services/email_processing_service.py` | Add `_resolve_source_account_async(total_amount, received_at, user_id)` — queries repo, patches `credit_account_id` on all siblings, back-ports link to source ingestion |
| `repositories/ingestion_repository.py` | Add `find_by_amount_and_time_async(user_id, amount, around_time, window_minutes=5) -> List[PendingIngestion]` — reusable by PBI-010 general detection too |
| `services/ai_service.py` | Add `classify_email_shopee_async()` — uses `SHOPEE_MULTI_ORDER_PROMPT`, handles response as either `List[AiParsedData]` (multi) or `AiParsedData` (single) |
| `prompts/email_prompts.py` | Add `SHOPEE_MULTI_ORDER_PROMPT` — instructs LLM to detect order count and return array if N≥2, single object if N=1 |
| `models/pending_ingestion.py` | Ensure PBI-010 relation fields exist (see PBI-010) |
| `runbooks/shopee_email_runbook.md` *(new)* | Shopee-specific classification rules — always loaded when sender is Shopee |

---

## Source Account Resolution Logic

```
total_payment = sum of all order Total Payments parsed from email
candidates = repo.find_by_amount_and_time_async(user_id, total_payment, email.received_at, window=5)

if candidates:
    best = pick candidate with highest confidence / earliest received_at
    credit_account_id = best.ai_parsed.credit_account_id  # e.g., BPI Credit Card

    for each shopee_ingestion:
        shopee_ingestion.credit_account_id = credit_account_id
        shopee_ingestion.possible_related_ingestion_ids.append(best.id)

    best.possible_related_ingestion_ids.extend([i.id for i in shopee_ingestions])
    repo.update_async(best)  # back-port the link
```

---

## Relation to PBI-008

| PBI-008 Concept | Usage in This PBI |
|---|---|
| `related_ingestion_ids` | Shopee sibling orders (definite — same checkout session, cross-linked at creation) |
| `possible_related_ingestion_ids` | SMS/notif that revealed the card account |
| `related_transaction_ids` | Populated after each sibling is confirmed |
| `find_by_amount_and_time_async` | New shared repo method — reusable by PBI-008 general detection |
| Back-port linking | Source SMS/notif ingestion updated to link back to all Shopee siblings |

---

## Verification Plan

### Manual

1. Feed a Shopee 2-order payment confirmation email into the ingester.
2. Verify 2 `PendingIngestion` records are created, each with correct `amount` (Total Payment per order), `reference_number` (Order ID), `vendor` (seller name).
3. Verify each sibling's `related_ingestion_ids` contains the other sibling's ID.
4. Send a matching credit card charge SMS (same total amount, within 5 min).
5. Verify both Shopee ingestions have `credit_account_id` set to the matched card account.
6. Verify both Shopee ingestions and the SMS ingestion are cross-linked via `possible_related_ingestion_ids`.

### Automated Tests

- Unit test `classify_email_shopee_async()` response handling:
  - Single-order Shopee email → returns single `AiParsedData`, creates 1 ingestion.
  - Two-order Shopee email → returns `List[AiParsedData]` (length 2), creates 2 cross-linked ingestions.
  - Non-Shopee email (control) → not routed to this path.
- Unit test `_resolve_source_account_async()`: matching candidate found, no candidate, candidate outside 5-min window.
- Unit test for deduplication: same Order IDs already in DB → skip creating duplicate ingestions.
