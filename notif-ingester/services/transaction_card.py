"""
transaction_card.py
-------------------
Canonical "transaction card" text builders used on BOTH sides of the embedding
space so query and document vectors live in the same representation:

  - Learning side (embed_and_learn_async): vendor + tx_type + account names +
    sender/recipient fields + application.
  - Query side (process_hook_async / reclassify): the same vocabulary derived
    from preprocessing output (potential vendor names, account names/numbers,
    application) since the resolved vendor/tx_type are not known yet.

Previously the query embedded hook.raw_msg (raw notification text) while the
stored vectors embedded the structured card — cosine similarity between the
two was near-noise and poisoned the "similar past transactions" context.
"""

from typing import List, Optional


def _clean_join(parts: list) -> str:
    return " ".join([str(p).strip() for p in parts if p and str(p).strip()])


def extract_vendor_name(parsed: dict) -> str:
    vendor_val = (parsed or {}).get("vendor", "")
    if isinstance(vendor_val, dict):
        return vendor_val.get("name") or ""
    if hasattr(vendor_val, "name"):
        return getattr(vendor_val, "name") or ""
    return str(vendor_val) if vendor_val else ""


def resolve_account_names(parsed: dict, accounts: Optional[List[dict]] = None) -> tuple:
    """Resolved '{Group} - {Name}' labels for debit/credit account IDs (empty string if unknown)."""
    accounts = accounts or []
    debit_id = (parsed or {}).get("debit_account_id")
    credit_id = (parsed or {}).get("credit_account_id")

    def _label(acc: dict) -> str:
        group = (acc.get("accountGroupName") or "").strip()
        name = (acc.get("name") or "").strip()
        if group and name:
            return f"{group} - {name}"
        return group or name

    debit_name = ""
    credit_name = ""
    for acc in accounts:
        if acc.get("id") == debit_id:
            debit_name = _label(acc)
        if acc.get("id") == credit_id:
            credit_name = _label(acc)
    return debit_name, credit_name


def build_query_card_text(extracted_info) -> str:
    """Build the canonical query-side card from preprocessing output."""
    if not extracted_info:
        return ""
    details: list = []
    details.extend(extracted_info.potential_vendor_names or [])
    details.extend(extracted_info.account_names or [])
    details.extend(extracted_info.account_numbers or [])
    details.append(extracted_info.application)
    return _clean_join(details)


def build_ocr_query_card_text(ocr_info: Optional[dict]) -> str:
    """Build the canonical query-side card from image OCR extraction output."""
    if not ocr_info:
        return ""
    details: list = []
    for key in ("potential_vendor_names", "vendor_names", "vendors"):
        val = ocr_info.get(key)
        if isinstance(val, list):
            details.extend(val)
    for key in ("vendor", "merchant"):
        val = ocr_info.get(key)
        if isinstance(val, str):
            details.append(val)
    for key in ("account_names",):
        val = ocr_info.get(key)
        if isinstance(val, list):
            details.extend(val)
    for key in ("account_numbers",):
        val = ocr_info.get(key)
        if isinstance(val, list):
            details.extend(val)
    details.append(ocr_info.get("application") or ocr_info.get("inferred_app") or "")
    return _clean_join(details)


def build_learning_card_text(parsed: dict, accounts: Optional[List[dict]] = None) -> str:
    """
    Build the canonical learning-side card from the confirmed/ai-parsed payload.
    `accounts` is the list returned by FinanceApiService.get_specific_accounts_async.
    """
    accounts = accounts or []
    vendor = extract_vendor_name(parsed or {})
    tx_type = (parsed or {}).get("transaction_type", "")

    debit_name, credit_name = resolve_account_names(parsed or {}, accounts)

    details = [
        vendor,
        tx_type,
        debit_name,
        credit_name,
        (parsed or {}).get("recipient_account_name", ""),
        (parsed or {}).get("recipient_account_number", ""),
        (parsed or {}).get("sender_account_name", ""),
        (parsed or {}).get("sender_account_number", ""),
        (parsed or {}).get("application", ""),
    ]
    return _clean_join(details)
