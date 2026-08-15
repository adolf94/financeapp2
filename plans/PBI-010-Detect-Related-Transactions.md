---
github_issue: 10
github_url: https://github.com/adolf94/financeapp2/issues/10
status: open
---
# PBI 008: Detect Related Transactions Across Multiple Notification Types

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
* Add a `reference_number` property to the `AiParsedData` model.

### 2. Detection Criteria

Two ingestions (or an ingestion and an already confirmed transaction) are considered **related** if they belong to the same user and satisfy either of:

1. **Reference Number Match**: Both have a non-empty `reference_number` and they are identical. Lookup window: **past 30 days** (to avoid stale collision from old transactions with reused ref numbers).
2. **Time and Amount Match**: Both have the same `amount` (absolute value, rounded to 2 decimal places for normalization) and their effective timestamps (`date` from `ai_parsed.date`, `raw_payload.timestamp`, or fallback `received_at`) are within **5 minutes** of each other — even if reference numbers differ or are missing (e.g. merchant order ID vs banking trace number).

> **Note**: Confirmed transaction cross-check is in scope for v1. When a new ingestion is processed, also query the C# backend `GET /transactions?userId=...&amount=...` for recent confirmed transactions matching criteria 2. If a match is found, add the confirmed transaction ID to `related_transaction_ids` **and** flag the ingestion with a `has_possible_confirmed_match: true` warning field so the UI can surface: *"A confirmed transaction for this amount already exists."*

### 3. Backend & Database Schema Updates
* Add `reference_number` to `AiParsedData` (already present — ✅ no change needed).
* Add `related_ingestion_ids`, `related_transaction_ids`, `possible_related_ingestion_ids`, `possible_related_transaction_ids` to `PendingIngestion`.
* Add `has_possible_confirmed_match: bool = False` to `PendingIngestion` — set `true` when a confirmed transaction match is found.
* Add `Duplicate` and `Merged` to the ingestion `status` enum (used when auto-rejecting duplicates on confirm).
* Update `IngestionService` in Python:
  * When processing a hook, query CosmosDB `PendingIngestions` for matching pending items.
  * **Also query the C# backend** for confirmed transactions matching the time+amount criteria. If found: add to `related_transaction_ids`, set `has_possible_confirmed_match = true`.
  * Populate `related_ingestion_ids` / `possible_related_ingestion_ids` on the new pending ingestion.
  * **Back-port is mandatory**: always update matched existing pending ingestions to include the new ID in their list (not optional).

### 4. API Enhancements
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
```python
class AiParsedData(BaseModel):
    # ... existing fields ...
    reference_number: Optional[str] = None

class PendingIngestion(BaseModel):
    # ... existing fields ...
    related_ingestion_ids: List[str] = Field(default_factory=list)  # Definite matches (same Reference Number)
    related_transaction_ids: List[str] = Field(default_factory=list)
    possible_related_ingestion_ids: List[str] = Field(default_factory=list)  # Possible matches (same amount and time within 5m, even with differing/missing ref numbers)
    possible_related_transaction_ids: List[str] = Field(default_factory=list)
```

#### C# (`backend/Models/AiParsedData.cs` & `PendingIngestion.cs` equivalent)
Use the `model-syncer` skill to ensure the models are updated and aligned.

### Ingestion Pipeline Logic
In `IngestionService.process_hook_async`:
1. Extract `reference_number`, `amount`, and effective timestamp (`resolved_time = ai_parsed.date or raw_payload.timestamp or received_at`) from the AI classification result and raw hook.
2. **Query 1 — Pending ingestions**: Search CosmosDB `PendingIngestions` (PartitionKey = `user_id`, Status = `Pending`) for matches.
3. **Query 2 — Confirmed transactions**: Call C# backend API for confirmed transactions matching user+amount within 5-minute window of `resolved_time`.
4. Categorize relations:
   - **Definite Relation** (`related_ingestion_ids`): Same non-empty `reference_number` (within 30 days).
   - **Possible Relation** (`possible_related_ingestion_ids`): Different or missing `reference_number`, but `amount` is equal (normalized to 2dp) and effective timestamp (`date` / `timestamp` / `received_at`) is within **5 minutes**.
   - **Confirmed Match** (`related_transaction_ids` + `has_possible_confirmed_match = true`): Confirmed transaction found matching amount + 5-minute effective time window.
5. Link IDs accordingly.
6. **Back-port (mandatory)**: Update all matched existing pending ingestions to append the new ingestion's ID to their corresponding relation list.

---

## Verification Plan

### Automated Tests
* Add python unit tests in `notif-ingester` to verify the detection logic with:
  * Matching reference numbers (definite relationship).
  * Matching amounts within the 5-minute window but no reference numbers (possible relationship).
  * Non-matching amounts or times outside the window.
* Add C# tests to verify model parsing.

### Manual Verification
1. Send two mock hooks for the same transaction (e.g., one SMS and one app notification payload) with matching amount and timestamp.
2. Verify they are linked as possible relations in the database/API response.
3. Verify they are displayed as possibly related in the UI.
3. Verify they are displayed as related in the UI.
