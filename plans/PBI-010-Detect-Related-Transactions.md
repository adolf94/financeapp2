---
github_issue: 10
github_url: https://github.com/adolf94/financeapp2/issues/10
status: complete
---
# PBI 010: Detect Related Transactions Across Multiple Notification Types

## Problem Statement
When a user performs a financial transaction, they often receive multiple notifications for the exact same event across different channels (e.g., an SMS message, an app push notification, a confirmation email, or a transaction screenshot/image). Currently, these are ingested as separate independent pending ingestions. 

We need a system to:
1. Automatically detect when ingestions are related (either by sharing the same Reference Number, or having the same amount within a close time window).
2. Group or link these related ingestions together.
3. Present them clearly to the user in the UI so they can be managed together (e.g., confirming one auto-resolves/links the others to prevent duplicate transactions).

---

## Technical Requirements

### 1. Extraction of Reference Number
* Update the AI classification prompts and schemas to consistently extract a `reference_number` field from all notification types (SMS, app push, email, images).
* `AiParsedData` already has `reference_number` — ✅ no change needed.

### 2. Detection Criteria

Two ingestions (or an ingestion and an already confirmed transaction) are considered **related** if they belong to the same user and satisfy either of:

1. **Reference Number Match**: Both have a non-empty `reference_number` and they are identical. Lookup window: **past 30 days** (to avoid stale collision from old transactions with reused ref numbers).
2. **Time and Amount Match**: Both have the same `amount` (absolute value, rounded to 2 decimal places for normalization) and their effective timestamps (`date` from `ai_parsed.date`, `raw_payload.timestamp`, or fallback `received_at`) are within **5 minutes** of each other — even if reference numbers differ or are missing (e.g. merchant order ID vs banking trace number).

> **Confirmed Transaction Cross-Check**: When a new ingestion arrives, also check against already-confirmed transactions by querying **`LedgerEntry`** (JournalEntry) records in the C# backend:
> - **Reference Number Match**: Query `LedgerEntry` by `reference_number` within the past 30 days.
> - **Time + Amount Match**: Query `LedgerEntry` by `amount` and filter where parent `Transaction.Date` is within a 5-minute window.
>
> **Note on `LedgerEntry` date**: `LedgerEntry` does not carry its own `Date` field — the date lives on the parent `Transaction`. Time-window lookups must join through `Transaction.Date`. It is **not** necessary to add a date field at the journal/ledger entry level.
>
> If a match is found, add the confirmed transaction ID to `related_transaction_ids` and flag the ingestion with `has_possible_confirmed_match: true` so the UI can surface: *"A confirmed transaction for this amount already exists."*

### 3. Backend & Database Schema Updates
* Add `related_ingestion_ids`, `related_transaction_ids`, `possible_related_ingestion_ids`, `possible_related_transaction_ids` to `PendingIngestion`.
* Add `has_possible_confirmed_match: bool = False` to `PendingIngestion` — set `true` when a confirmed transaction match is found.
* Add `Duplicate` and `Merged` to the ingestion `status` enum (used when auto-rejecting duplicates on confirm).
* Update `IngestionService` in Python:
  * When processing a hook, query CosmosDB `PendingIngestions` for matching pending items.
  * **Also query the C# backend** for confirmed `LedgerEntry` records matching reference_number (within 30 days) or amount + parent `Transaction.Date` within 5-min window. If found: add the parent transaction ID to `related_transaction_ids`, set `has_possible_confirmed_match = true`.
  * Populate `related_ingestion_ids` / `possible_related_ingestion_ids` on the new pending ingestion.
  * **Back-port is mandatory**: always update matched existing pending ingestions to include the new ID in their list (not optional).

### 4. API Enhancements
* New C# endpoint: `GET /ledger-entries/search?userId=...&amount=...&referenceNumber=...&around=<ISO8601>&windowMinutes=5`
  * If `referenceNumber` provided: return matching `LedgerEntry` records by reference number (within 30-day window).
  * If `amount` + `around` provided: return matching `LedgerEntry` records where parent `Transaction.Date` is within the window.
  * Response includes `TransactionId` (for `related_transaction_ids` population).
* Extend `GET /ingestions` to return relationship context, ensuring the frontend can access linked items.
* Update the confirm/reject endpoints to handle related ingestions (e.g. when confirming a pending ingestion, flag related pending ingestions as "Duplicate" or "Merged" or auto-reject them to prevent double entry).

### 5. Frontend UI/UX
* Update the **Pending Ingestions List**:
  * If a pending ingestion has related items, display a "Related Transactions" badge/panel.
  * Show details of the related items (e.g., "SMS and Email notifications found for this amount").
  * Allow the user to "Merge & Confirm" (keeps one, auto-rejects/dismisses duplicates).

---

## Implementation Details

### Model Updates

#### Python (`notif-ingester/models/pending_ingestion.py`)
`PendingIngestion` relation fields are **already implemented** ✅:
```python
class PendingIngestion(BaseModel):
    # ... existing fields ...
    related_ingestion_ids: List[str] = Field(default_factory=list)  # Definite matches (same Reference Number)
    related_transaction_ids: List[str] = Field(default_factory=list)
    possible_related_ingestion_ids: List[str] = Field(default_factory=list)  # Possible matches (same amount and time within 5m)
    possible_related_transaction_ids: List[str] = Field(default_factory=list)
    has_possible_confirmed_match: bool = False
```

#### Python (`notif-ingester/services/preprocessing_service.py`)
Extend `ExtractedAccountInfo` and `EXTRACTION_PROMPT` to also capture raw transaction details so the **pre-classify relation lookup** can run without waiting for the LLM classifier:
```python
@dataclass
class ExtractedAccountInfo:
    account_numbers: List[str]
    account_names: List[str]
    application: str
    potential_vendor_names: List[str]
    currency: str = "PHP"
    reference_number: Optional[str] = None   # NEW — for definite relation matching
    amount: Optional[float] = None           # NEW — for possible relation matching
    date: Optional[str] = None               # NEW — ISO string; parsed to datetime for 5-min window
```
Update `EXTRACTION_PROMPT` to ask for these three additional fields (same AI call, just expanded schema).

#### C# (`backend/Models/LedgerEntry.cs`)
`LedgerEntry` already has `ReferenceNumber`. No new date field needed — date is inherited from parent `Transaction`. Use the `model-syncer` skill to ensure Python and C# models stay aligned.

### Ingestion Pipeline Logic

#### Revised step order in `IngestionService.process_hook_async`

```
1. Embed raw message
2. Vector search (similar past transactions)
3. Fetch accounts, vendors, runbook
3.5 Preprocess — extract account numbers, names, vendor hints,
     currency, AND reference_number, amount, date  ← extended
3.6 Early relation lookup (pre-classify)            ← NEW
4. Classify via LLM  (with related context injected) ← enriched
4.5 Vendor matching
5. Create PendingIngestion
6. Auto-confirm logic
6.5 detect_and_link_relations_async (post-classify, uses ai_parsed values)
7. Save
```

**Step 3.5 — Preprocessing (`PreprocessingService`)**
- Same single AI call, expanded schema.
- Extracts: `account_numbers`, `account_names`, `potential_vendor_names`, `currency`, `reference_number`, `amount`, `date`.
- `date` is returned as an ISO string; resolved to `datetime` in the pipeline using the same `_extract_effective_time` fallback chain (`date → raw_payload.timestamp → received_at`).

**Step 3.6 — Early relation lookup (new, pre-classify)**
- Uses `extracted_info.reference_number`, `extracted_info.amount`, and resolved `effective_time`.
- **Query 1 — Pending ingestions**: Search CosmosDB `PendingIngestions` (same user, Status=Pending, days_lookback=30).
- **Query 2 — Confirmed LedgerEntries**: Call C# `/ledger-entries/search` with ref number or amount + time window.
- Results are formatted as a **`related_context` string** (see below) — not yet persisted.
- No mutations at this stage; linking happens in step 6.5 after the ingestion object exists.

**Step 4 — Classify via LLM**
- **Input format: single-shot structured JSON — NOT chat/multi-turn.**
  - Classification always produces a deterministic JSON blob (`AiParsedData`). Chat format (role arrays) is reserved for conversational flows like the runbook editor (`RUNBOOK_CHAT_PROMPT`). Adding a context block to the existing prompt template is sufficient and keeps the output schema stable.
- Inject `related_context` as a new block in `CLASSIFICATION_PROMPT`:
  ```
  Related Transactions Found (context only — do NOT duplicate confirmed entries):
  {related_context}
  ```
  Example `related_context` value:
  ```
  - [DEFINITE] SMS notification matched ref# TXN20240815 — Amount: PHP 1,500.00 — GCash to Juan Dela Cruz
  - [POSSIBLE]  App notification same amount (PHP 1,500.00) within 5 min — Credit: GCash Wallet
  - [CONFIRMED] Ledger entry already confirmed for this amount — Transaction ID: abc-123
  ```
- The AI uses this to:
  - Adjust `confidence` downward if a confirmed duplicate is found.
  - Improve account mapping by reusing credit/debit accounts from related ingestions.
  - Populate `reference_number` if it wasn't in the raw text but matched a known ref.

**Step 6.5 — `detect_and_link_relations_async` (unchanged, post-classify)**
- Runs after `PendingIngestion` object is created.
- Uses final `ai_parsed.reference_number`, `ai_parsed.amount`, and `_extract_effective_time(ingestion)` — these are now richer because the classifier had related context.
- Categorizes and persists:
  - **Definite** (`related_ingestion_ids`): Same non-empty `reference_number` within 30 days.
  - **Possible** (`possible_related_ingestion_ids`): Same `amount` (2dp), effective time within 5 min.
  - **Confirmed match** (`related_transaction_ids` + `has_possible_confirmed_match = true`): LedgerEntry hit.
- **Back-port (mandatory)**: Updates all matched existing pending ingestions to include the new ID.

---

## Verification Plan

### Automated Tests
* Add python unit tests in `notif-ingester` to verify the detection logic with:
  * Matching reference numbers (definite relationship).
  * Matching amounts within the 5-minute window but no reference numbers (possible relationship).
  * Non-matching amounts or times outside the window.
* Add C# tests to verify `LedgerEntry` search endpoint and model parsing.

### Manual Verification
1. Send two mock hooks for the same transaction (e.g., one SMS and one app notification payload) with matching amount and timestamp.
2. Verify they are linked as possible relations in the database/API response.
3. Verify they are displayed as possibly related in the UI.
4. Confirm one ingestion and verify the other is auto-flagged as Duplicate.
