# Better Confidence Rating System

## Background

Currently the AI returns `confidence: float (0.0-1.0)` with no guidance — it self-assesses arbitrarily and is systematically overconfident. This causes bad auto-confirms on ambiguous transfers (e.g., GCash to 09123456789 with no context).

**Core insight**: Split responsibility by *who has the data*:
- **AI** — can see the raw message text → fills **boolean facts** it can objectively verify
- **Python** — has real data from Cosmos → computes **numeric evidence** from actual records

---

## Architecture: Three-Track Scoring

```
AI fills (booleans)          Python: vendor_matches        Python: Transactions DB
─────────────────────        ──────────────────────        ──────────────────────────────
amount_extracted      ──┐    vendor_hit_score       ──┐    vendor_consistency  ──┐
accounts_resolved     ──┤    (total_hits)              │    (type + account mode  │
transaction_type_clear──┤                              │     from TX history)     │
date_extracted        ──┤    similarity_score    ──────┤    (NEW API call)        │
has_reference_number  ──┘    (similar_vectors)         │                          │
        │                              │                │                          │
        └──────────────────────────────┴────────────────┴──────────────────────────┘
                                       ▼
                              compute_confidence()
                              Weighted sum → float 0.0–1.0
```

### GCash transfer example walkthrough

| Signal | Source | Value |
|--------|--------|-------|
| Amount extracted (PHP 500) | AI bool | `true` → +0.20 |
| Transaction type clear (Transfer) | AI bool | `true` → +0.10 |
| Accounts resolved (null — no account for this number) | AI bool | `false` → +0.00 |
| Date extracted | AI bool | `false` → +0.00 |
| Reference number present | AI bool | `false` → +0.00 |
| Vendor has **18 past hits** | Python (hit_count) | 0.90 → +0.18 |
| TX history: 17/18 = "Transfer" + same debit/credit accounts | Python (TX history) | 0.94 → +0.09 |
| Top similar vector score = 0.91 | Python (similarity) | 0.91 → +0.09 |
| **Total confidence** | | **0.66** → Pending (accounts_resolved=false) |

Same — matched number, **mixed TX history** (10 Transfer, 8 Expense, different account pairs):
- `vendor_consistency = 0.40` → +0.04
- **Total ≈ 0.57** ❌ Pending — type/accounts unclear, human review needed

---

## `vendor_consistency` — from actual Transactions DB

**What we query**: `Transactions` container by `Vendor` name (available from `vendor_matches.vendor_name`). Each confirmed transaction also has linked `LedgerEntry` docs with `AccountId` + `Amount` sign → debit/credit pair.

### New method: `get_vendor_history_async()`

Add to `FinanceApiService`:

```python
async def get_vendor_history_async(
    self,
    user_id: str,
    vendor_name: str,
    limit: int = 30,
) -> list[dict]:
    """
    Fetch the last `limit` confirmed transactions for a vendor.
    Returns list of { "type": str, "debit_account_id": str|None, "credit_account_id": str|None }
    """
    db = self.client.get_database_client(self.db_name)
    tx_container = db.get_container_client("Transactions")

    query = (
        "SELECT TOP @limit c.Type, c.id "
        "FROM c WHERE c.UserId = @user_id AND c.Vendor = @vendor "
        "AND c['$type'] = 'Transaction' ORDER BY c.Date DESC"
    )
    params = [
        {"name": "@user_id", "value": user_id},
        {"name": "@vendor", "value": vendor_name},
        {"name": "@limit", "value": limit},
    ]
    results = []
    async for item in tx_container.query_items(query=query, parameters=params):
        tx_id = item.get("id")
        tx_type = item.get("Type") or ""

        # Fetch its two ledger entries to get debit (Amount>0) and credit (Amount<0)
        le_query = "SELECT c.AccountId, c.Amount FROM c WHERE c.TransactionId = @tx_id AND c['$type'] = 'LedgerEntry'"
        le_params = [{"name": "@tx_id", "value": tx_id}]
        debit_acc = credit_acc = None
        async for le in tx_container.query_items(query=le_query, parameters=le_params):
            if (le.get("Amount") or 0) >= 0:
                debit_acc = le.get("AccountId")
            else:
                credit_acc = le.get("AccountId")

        results.append({
            "type": tx_type,
            "debit_account_id": debit_acc,
            "credit_account_id": credit_acc,
        })
    return results
```

### `compute_vendor_consistency()` — now uses real TX history

```python
def compute_vendor_consistency(
    ai_transaction_type: str,
    ai_debit_id: str | None,
    ai_credit_id: str | None,
    vendor_history: list[dict],   # from get_vendor_history_async()
) -> float:
    """
    Score 0.0–1.0: how well the AI's classification matches
    the vendor's confirmed transaction history.
    """
    if not vendor_history:
        return 0.0

    n = len(vendor_history)

    # What % of past transactions share the same type?
    type_matches = sum(
        1 for tx in vendor_history
        if (tx.get("type") or "").lower() == (ai_transaction_type or "").lower()
    )

    # What % share at least one account (debit OR credit)?
    account_matches = sum(
        1 for tx in vendor_history
        if (ai_debit_id and tx.get("debit_account_id") == ai_debit_id)
        or (ai_credit_id and tx.get("credit_account_id") == ai_credit_id)
    )

    # Account consistency weighted higher — double-entry precision matters more
    return round(0.40 * (type_matches / n) + 0.60 * (account_matches / n), 4)
```

> [!NOTE]
> If no vendor match is found (brand-new vendor), `vendor_history = []` → `vendor_consistency = 0.0`. Naturally conservative.

---

## Proposed Changes

### [NEW] `services/confidence.py`

```python
WEIGHTS = {
    "amount_extracted":        0.20,
    "accounts_resolved":       0.20,
    "transaction_type_clear":  0.10,
    "date_extracted":          0.05,
    "has_reference_number":    0.05,
    "vendor_hit_score":        0.20,   # from VendorLookups.Hits
    "vendor_consistency":      0.10,   # from Transactions DB history
    "similarity_score":        0.10,   # from similar_vectors
}

MAX_HIT_COUNT = 20

def normalize_hit_count(total_hits: int) -> float:
    return min(1.0, total_hits / MAX_HIT_COUNT)

def compute_vendor_consistency(ai_transaction_type, ai_debit_id, ai_credit_id, vendor_history) -> float:
    if not vendor_history:
        return 0.0
    n = len(vendor_history)
    type_matches = sum(1 for tx in vendor_history if (tx.get("type") or "").lower() == (ai_transaction_type or "").lower())
    account_matches = sum(
        1 for tx in vendor_history
        if (ai_debit_id and tx.get("debit_account_id") == ai_debit_id)
        or (ai_credit_id and tx.get("credit_account_id") == ai_credit_id)
    )
    return round(0.40 * (type_matches / n) + 0.60 * (account_matches / n), 4)

def compute_confidence(ai_factors, vendor_hit_count=0, top_similarity=0.0, vendor_consistency=0.0) -> float:
    scores = {
        "amount_extracted":       1.0 if ai_factors.get("amount_extracted") else 0.0,
        "accounts_resolved":      1.0 if ai_factors.get("accounts_resolved") else 0.0,
        "transaction_type_clear": 1.0 if ai_factors.get("transaction_type_clear") else 0.0,
        "date_extracted":         1.0 if ai_factors.get("date_extracted") else 0.0,
        "has_reference_number":   1.0 if ai_factors.get("has_reference_number") else 0.0,
        "vendor_hit_score":       normalize_hit_count(vendor_hit_count),
        "vendor_consistency":     vendor_consistency,
        "similarity_score":       top_similarity,
    }
    return round(sum(WEIGHTS[k] * scores[k] for k in WEIGHTS), 4)
```

---

### [MODIFY] `services/finance_api_service.py`

Add `get_vendor_history_async()` (shown above).

---

### [MODIFY] `services/ingestion_service.py` (and `image_processing_service.py`)

After the AI call returns `ai_parsed`, before building `PendingIngestion`:

```python
# Fetch vendor TX history for consistency scoring
vendor_history = []
if vendor_matches and ai_parsed.vendor and ai_parsed.vendor.name:
    top_match = vendor_matches[0]
    vendor_history = await self._finance_api_service.get_vendor_history_async(
        hook.user_id, top_match["vendor_name"], limit=30
    )
ai_parsed = self._ai_service.apply_confidence(ai_parsed, vendor_matches, similar_vectors, vendor_history)
```

---

### [MODIFY] `services/ai_service.py`

```python
from services.confidence import compute_confidence, compute_vendor_consistency

def apply_confidence(self, ai_parsed, vendor_matches, similar_vectors, vendor_history) -> AiParsedData:
    factors = (ai_parsed.confidence_factors or ConfidenceFactors()).model_dump()
    top_hits = max((m.get("total_hits", 0) for m in (vendor_matches or [])), default=0)
    top_sim = max((s for _, s in (similar_vectors or [])), default=0.0)
    consistency = compute_vendor_consistency(
        ai_parsed.transaction_type or "",
        ai_parsed.debit_account_id,
        ai_parsed.credit_account_id,
        vendor_history,
    )
    ai_parsed.confidence = compute_confidence(factors, top_hits, top_sim, consistency)
    return ai_parsed
```

---

### [MODIFY] All 4 prompt system prompts

Replace `"confidence": number (0.0-1.0)` with:

```
"confidence_factors": {
  "amount_extracted": boolean (true if a clear numeric amount is present in the message),
  "accounts_resolved": boolean (true if you assigned BOTH non-null debit_account_id AND credit_account_id),
  "transaction_type_clear": boolean (true if the transaction type is unambiguous from the message text),
  "date_extracted": boolean (true if a transaction date/time is present in the message),
  "has_reference_number": boolean (true if a reference/trace/order number is present)
},
```

### [MODIFY] `models/pending_ingestion.py`

```python
class ConfidenceFactors(BaseModel):
    amount_extracted: bool = False
    accounts_resolved: bool = False
    transaction_type_clear: bool = False
    date_extracted: bool = False
    has_reference_number: bool = False

# On AiParsedData:
confidence_factors: Optional[ConfidenceFactors] = None
```

---

## Weight Rationale

| Factor | Weight | Source | Rationale |
|--------|--------|--------|-----------|
| `amount_extracted` | 20% | AI bool | No amount = can't confirm |
| `accounts_resolved` | 20% | AI bool | Both double-entry sides must be known |
| `vendor_hit_score` | 20% | VendorLookups.Hits | Historical lookup volume = familiarity |
| `transaction_type_clear` | 10% | AI bool | Ambiguous type = review needed |
| `vendor_consistency` | 10% | Transactions DB | Real TX history agrees on type + accounts |
| `similarity_score` | 10% | similar_vectors | Known semantic pattern |
| `date_extracted` | 5% | AI bool | Nice-to-have |
| `has_reference_number` | 5% | AI bool | Traceability signal |

---

## Open Questions

> [!IMPORTANT]
> **Q1 — Extra DB call cost**: `get_vendor_history_async()` adds a CosmosDB query per ingestion (only when a vendor match exists). The inner LedgerEntry fetch is N sub-queries per transaction (up to 30). Should we cap at `limit=10` to reduce RU cost, or is 30 acceptable?

> [!IMPORTANT]
> **Q2 — `vendor_consistency` inner weights**: Account agreement 60%, type 40%. Prefer 50/50?

> [!NOTE]
> **Q3 — `MAX_HIT_COUNT` cap**: 20 hits = full vendor_hit_score. Adjust?

> [!NOTE]
> **Q4 — Shopee multi-order path**: Hardcoded `confidence=0.95` unchanged. OK?

> [!NOTE]
> **Q5 — `confidence_factors` persistence**: Saved on `AiParsedData` in CosmosDB for analytics. OK?

---

## Verification Plan

### Automated Tests
- `tests/test_confidence.py` — all-true + full hits + perfect history → 1.0; brand-new vendor → ~0.30; known consistent GCash number → ~0.67.
- Mock `get_vendor_history_async()` in `test_ingestion_service.py`.
- Update `tests/test_image_processing.py` — swap `confidence=0.98` for `confidence_factors` dicts.

### Manual Verification
- Fire a test SMS, check `debug_prompts/` — confirm `confidence_factors` in AI JSON.
- Confirm computed `confidence` reflects real vendor TX history.
