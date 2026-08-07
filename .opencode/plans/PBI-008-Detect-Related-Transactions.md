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
1. **Reference Number Match**: Both have a non-empty `reference_number` and they are identical.
2. **Time and Amount Match**: Both have the exact same `amount` (absolute value) and their timestamps (`received_at` or parsed transaction `date`) are within **5 minutes** of each other.

### 3. Backend & Database Schema Updates
* Add `reference_number` to `AiParsedData` (and sync it to C# `AiParsedData.cs`).
* Add `related_ingestion_ids` (list of strings) and `related_transaction_ids` (list of strings) to `PendingIngestion` to track detected relationships.
* Update `IngestionService` in Python:
  * When processing a hook, query the database for other pending ingestions or recent transactions (e.g. within the last 15 minutes if doing amount/time checks, or any time if doing reference number checks) that match the criteria.
  * Populate `related_ingestion_ids` and `related_transaction_ids` on the new pending ingestion.
  * Optionally, back-port the relationship to the existing pending ingestions.

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
    related_ingestion_ids: List[str] = Field(default_factory=list)  # Definite matches (e.g. same Reference Number)
    related_transaction_ids: List[str] = Field(default_factory=list)
    possible_related_ingestion_ids: List[str] = Field(default_factory=list)  # Possible matches (e.g. same amount and time but no ref number)
    possible_related_transaction_ids: List[str] = Field(default_factory=list)
```

#### C# (`backend/Models/AiParsedData.cs` & `PendingIngestion.cs` equivalent)
Use the `model-syncer` skill to ensure the models are updated and aligned.

### Ingestion Pipeline Logic
In `IngestionService.process_hook_async`:
1. Extract `reference_number` and `amount` from the AI classification result.
2. Search CosmosDB `PendingIngestions` container for items:
   - PartitionKey = `user_id`
   - Status = `Pending`
3. Categorize relations:
   - **Definite Relation**: Both have the same non-empty `reference_number`.
   - **Possible Relation**: No matching `reference_number` (or one is missing), but `amount` is equal and `received_at` / transaction `date` is within **5 minutes**.
4. Link IDs accordingly.
5. Update matched pending ingestions to include the new ingestion's ID in their corresponding list.

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
