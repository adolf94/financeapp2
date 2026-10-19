import pytest
import os
os.environ["GEMINI_API_KEY"] = "fake-test-key"
os.environ["CLASSIFICATION_AI"] = "openai:gpt-4o"
os.environ["CLASSIFICATION_APIKEY"] = "fake-key"

import json
from unittest.mock import AsyncMock

from models.phone_hook import PhoneHookMessage
from models.pending_ingestion import AiParsedData
from services.account_label_registry import (
    AccountLabelRegistry,
    AccountSelectionError,
    build_fail_safe_parsed_data,
    looks_like_uuid,
    resolve_parsed_accounts,
)
from services.ai_service import AiService


ACCOUNTS = [
    {"id": "a-asset-1", "name": "BPI Savings", "accountType": "Asset", "accountGroupName": "Asset", "tags": ["6642"]},
    {"id": "e-food-1", "name": "Groceries", "accountType": "Expense", "accountGroupName": "Food", "tags": ["grocery"]},
    {"id": "dup-1", "name": "Savings", "accountType": "Asset", "accountGroupName": "Asset", "tags": []},
    {"id": "dup-2", "name": "Savings", "accountType": "Asset", "accountGroupName": "Asset", "tags": []},
]


def _registry(accounts=None):
    return AccountLabelRegistry(ACCOUNTS if accounts is None else accounts)


# ---------------------------------------------------------------------------
# AccountLabelRegistry
# ---------------------------------------------------------------------------

def test_label_for_group_and_name():
    assert AccountLabelRegistry.label_for(ACCOUNTS[0]) == "Asset | BPI Savings"
    assert AccountLabelRegistry.label_for({"name": "Cash Only"}) == "Cash Only"
    assert AccountLabelRegistry.label_for({"accountGroupName": "Asset"}) == "Asset"
    assert AccountLabelRegistry.label_for({}) == ""


def test_registry_resolves_exact_and_normalized_labels():
    reg = _registry()
    acc, conflicts = reg.resolve("Asset | BPI Savings")
    assert acc["id"] == "a-asset-1" and conflicts == []

    # Case + whitespace drift
    acc, _ = reg.resolve("asset |  bpi   savings")
    assert acc["id"] == "a-asset-1"

    # Separator drift (model used " - " or unspaced pipe)
    acc, _ = reg.resolve("Asset - BPI Savings")
    assert acc["id"] == "a-asset-1"
    acc, _ = reg.resolve("asset|bpi savings")
    assert acc["id"] == "a-asset-1"


def test_registry_name_only_fallback_unique():
    reg = _registry()
    acc, conflicts = reg.resolve("BPI Savings")
    assert acc["id"] == "a-asset-1" and conflicts == []


def test_registry_detects_ambiguous_duplicate_labels():
    reg = _registry()
    acc, conflicts = reg.resolve("Asset | Savings")
    assert acc is None
    assert sorted(conflicts) == ["Asset | Savings", "Asset | Savings"]


def test_registry_unknown_label():
    acc, conflicts = _registry().resolve("Asset | Nonexistent Bank")
    assert acc is None and conflicts == []


def test_registry_valid_account_ids():
    assert _registry().valid_account_ids() == {"a-asset-1", "e-food-1", "dup-1", "dup-2"}


def test_registry_empty_accounts():
    reg = _registry([])
    assert reg.valid_account_ids() == set()
    acc, conflicts = reg.resolve("Asset | Anything")
    assert acc is None and conflicts == []


def test_looks_like_uuid():
    assert looks_like_uuid("018F3A3D-1234-7ABC-9DEF-0123456789AB")
    assert not looks_like_uuid("Asset | BPI Savings")
    assert not looks_like_uuid(None)


# ---------------------------------------------------------------------------
# resolve_parsed_accounts
# ---------------------------------------------------------------------------

def test_resolve_maps_labels_to_guids():
    data = {
        "is_financial": True,
        "transaction_type": "Expense",
        "debit_account_name": "Food | Groceries",
        "credit_account_name": "Asset | BPI Savings",
        "confidence": 0.9,
    }
    out = resolve_parsed_accounts(data, _registry())
    assert out["debit_account_id"] == "e-food-1"
    assert out["credit_account_id"] == "a-asset-1"
    assert "debit_account_name" not in out and "credit_account_name" not in out
    assert out["confidence"] == 0.9


def test_resolve_invalid_label_raises_with_fail_safe_snapshot():
    data = {
        "is_financial": True,
        "debit_account_name": "Asset | Made Up Bank",
        "credit_account_name": "Asset | BPI Savings",
        "confidence": 0.95,
    }
    with pytest.raises(AccountSelectionError) as exc:
        resolve_parsed_accounts(data, _registry())
    assert exc.value.invalid_labels == ["Asset | Made Up Bank"]
    # Fail-safe snapshot: invalid selection nulled, valid one kept, caps applied
    snap = exc.value.partial_data
    assert snap["debit_account_id"] is None
    assert snap["credit_account_id"] == "a-asset-1"
    assert snap["confidence"] == 0.5
    assert snap["is_auto_confirmed"] is False


def test_resolve_invalid_label_healed_by_suggested_account_creation():
    data = {
        "is_financial": True,
        "debit_account_name": "Asset | Made Up Bank",
        "credit_account_name": "Asset | BPI Savings",
        "suggested_account_creation": [{"type": "Bank", "account_group": "Asset", "name": "New Bank"}],
        "confidence": 0.9,
    }
    out = resolve_parsed_accounts(data, _registry())  # no raise
    assert out["debit_account_id"] is None
    assert out["credit_account_id"] == "a-asset-1"
    assert out["suggested_account_creation"]


def test_resolve_ambiguous_label_raises_with_conflicts():
    data = {
        "is_financial": True,
        "debit_account_name": "Asset | Savings",
        "credit_account_name": "Food | Groceries",
    }
    with pytest.raises(AccountSelectionError) as exc:
        resolve_parsed_accounts(data, _registry())
    assert "Asset | Savings" in exc.value.conflicts
    assert exc.value.conflicts["Asset | Savings"] == ["Asset | Savings", "Asset | Savings"]


def test_resolve_non_financial_skips_validation():
    data = {
        "is_financial": False,
        "debit_account_name": "Asset | Made Up Bank",
        "credit_account_id": "whatever-guid",
    }
    out = resolve_parsed_accounts(data, _registry())
    assert out["debit_account_id"] is None
    assert out["credit_account_id"] is None
    assert "debit_account_name" not in out


def test_resolve_treats_rogue_guid_answer_as_invalid_label():
    data = {
        "is_financial": True,
        "debit_account_id": "018f3a3d-1234-7abc-9def-0123456789ab",
        "credit_account_name": "Asset | BPI Savings",
    }
    with pytest.raises(AccountSelectionError) as exc:
        resolve_parsed_accounts(data, _registry())
    assert exc.value.invalid_labels == ["018f3a3d-1234-7abc-9def-0123456789ab"]
    # Feedback explicitly calls out GUIDs as rejected
    feedback = exc.value.build_feedback()
    assert "Group | Name" in feedback and "GUID" in feedback


def test_resolve_multi_order_items():
    data = {
        "is_multi_order": True,
        "is_financial": True,
        "orders": [
            {"amount": 100, "debit_account_name": "Food | Groceries"},
            {"amount": 200, "debit_account_name": "Asset | Made Up Bank"},
        ],
    }
    with pytest.raises(AccountSelectionError) as exc:
        resolve_parsed_accounts(data, _registry())
    assert any("orders[1]" in lbl for lbl in exc.value.invalid_labels)
    assert exc.value.partial_data["orders"][0]["debit_account_id"] == "e-food-1"
    assert exc.value.partial_data["orders"][1]["debit_account_id"] is None


def test_resolve_shopee_list_payload():
    payload = [
        {"amount": 100, "debit_account_name": "Food | Groceries"},
        {"amount": 200, "debit_account_name": "Food | Groceries"},
    ]
    out = resolve_parsed_accounts(payload, _registry())
    assert all(o["debit_account_id"] == "e-food-1" for o in out)


def test_resolve_null_labels_valid():
    data = {"is_financial": True, "debit_account_name": None, "credit_account_name": None}
    out = resolve_parsed_accounts(data, _registry())
    assert out["debit_account_id"] is None and out["credit_account_id"] is None


# ---------------------------------------------------------------------------
# Fail-safe builder
# ---------------------------------------------------------------------------

def test_build_fail_safe_adds_notes_and_caps():
    err = AccountSelectionError(
        invalid_labels=["Asset | Made Up Bank"],
        conflicts={},
        partial_data={"notes": "original", "confidence": 0.95, "debit_account_id": None, "credit_account_id": None},
    )
    out = build_fail_safe_parsed_data(err, attempts=4)
    assert "pick accounts manually" in out["notes"]
    assert "original" in out["notes"]
    assert out["confidence"] == 0.5
    assert out["is_auto_confirmed"] is False
    assert "Made Up Bank" in out["notes"]


# ---------------------------------------------------------------------------
# AiService: prompt rendering + repair loop
# ---------------------------------------------------------------------------

def test_format_accounts_for_classification_has_no_guids():
    ai = AiService()
    text = ai._format_accounts_for_classification(ACCOUNTS)
    assert "Asset | BPI Savings" in text
    assert "Food | Groceries" in text
    for guid in ("a-asset-1", "e-food-1", "dup-1"):
        assert guid not in text
    assert "Group | Name | Tags" in text


def test_format_accounts_keeps_ids_for_runbook_review_flow():
    ai = AiService()
    text = ai._format_accounts(ACCOUNTS)
    assert "a-asset-1" in text  # review flow needs IDs to key updates


def test_build_context_never_leaks_guids():
    ai = AiService()
    vec = {
        "vendor": "X", "category": "Y", "summary": "s",
        "debit_account_id": "018f3a3d-1234-7abc-9def-0123456789ab",
        "debit_account_name": "Food - Groceries",
        "credit_account_id": "a-asset-1",  # no name stored
    }
    text = ai._build_context([(vec, 0.9)])
    assert "018f3a3d" not in text
    assert "a-asset-1" not in text
    assert "Food - Groceries" in text
    assert "N/A" in text


def _make_hook():
    return PhoneHookMessage(
        id="h1", user_id="u1", raw_msg="msg", raw_payload={"notif_pkg": "com.test"},
        action="", status="", month_key="2026-10", partition_key="u1",
        received_at="2026-10-18T00:00:00Z"
    )


_VALID_RESPONSE = json.dumps({
    "is_financial": True,
    "vendor": {"name": "VendorX", "matched": False, "is_recommendation": True},
    "amount": 100.0,
    "transaction_type": "Expense",
    "debit_account_name": "Food | Groceries",
    "credit_account_name": "Asset | BPI Savings",
    "confidence": 0.9,
    "why": "test",
})

_INVALID_RESPONSE = json.dumps({
    "is_financial": True,
    "vendor": {"name": "VendorX", "matched": False, "is_recommendation": True},
    "amount": 100.0,
    "transaction_type": "Expense",
    "debit_account_name": "Asset | Hallucinated Bank",
    "credit_account_name": "Asset | BPI Savings",
    "confidence": 0.95,
    "why": "test",
})


@pytest.mark.asyncio
async def test_repair_retry_succeeds_on_second_attempt(monkeypatch):
    monkeypatch.setenv("AI_ACCOUNT_SELECT_MAX_RETRIES", "3")
    ai = AiService()
    ai._generate_stream_to_signalr = AsyncMock(
        side_effect=[(_INVALID_RESPONSE, 10, 10, 0.001), (_VALID_RESPONSE, 10, 10, 0.001)]
    )

    result = await ai.classify_async(
        hook=_make_hook(), similar_vectors=[], accounts=ACCOUNTS,
        runbook_content="rules", vendors=[], vendor_matches=[],
        stream_reasoning_to_client=False,
    )

    assert ai._generate_stream_to_signalr.await_count == 2
    assert result.debit_account_id == "e-food-1"
    assert result.credit_account_id == "a-asset-1"
    # Retry prompt carried corrective feedback
    retry_prompt = ai._generate_stream_to_signalr.call_args_list[1].kwargs["prompt"]
    assert "ACCOUNT SELECTION CORRECTION" in retry_prompt
    assert "Asset | Hallucinated Bank" in retry_prompt


@pytest.mark.asyncio
async def test_repair_retry_terminal_fail_safe(monkeypatch):
    monkeypatch.setenv("AI_ACCOUNT_SELECT_MAX_RETRIES", "2")
    ai = AiService()
    ai._generate_stream_to_signalr = AsyncMock(return_value=(_INVALID_RESPONSE, 10, 10, 0.001))

    result = await ai.classify_async(
        hook=_make_hook(), similar_vectors=[], accounts=ACCOUNTS,
        runbook_content="rules", vendors=[], vendor_matches=[],
        stream_reasoning_to_client=False,
    )

    # 1 initial + 2 retries
    assert ai._generate_stream_to_signalr.await_count == 3
    assert isinstance(result, AiParsedData)
    assert result.debit_account_id is None
    # The valid credit selection from the failed attempt is preserved —
    # the user only needs to fix the broken side.
    assert result.credit_account_id == "a-asset-1"
    assert result.confidence <= 0.5
    assert result.is_auto_confirmed is not True
    assert "pick accounts manually" in (result.notes or "")
    # Valid side preserved from the failed attempt's snapshot
    assert result.vendor.name == "VendorX"


@pytest.mark.asyncio
async def test_first_attempt_valid_no_retry():
    ai = AiService()
    ai._generate_stream_to_signalr = AsyncMock(return_value=(_VALID_RESPONSE, 10, 10, 0.001))

    result = await ai.classify_async(
        hook=_make_hook(), similar_vectors=[], accounts=ACCOUNTS,
        runbook_content="rules", vendors=[], vendor_matches=[],
        stream_reasoning_to_client=False,
    )

    assert ai._generate_stream_to_signalr.await_count == 1
    assert result.debit_account_id == "e-food-1"
    assert result.notes is None


@pytest.mark.asyncio
async def test_non_financial_answer_skips_account_validation():
    ai = AiService()
    resp = json.dumps({"is_financial": False, "debit_account_name": "Asset | Bogus"})
    ai._generate_stream_to_signalr = AsyncMock(return_value=(resp, 10, 10, 0.001))

    result = await ai.classify_async(
        hook=_make_hook(), similar_vectors=[], accounts=ACCOUNTS,
        runbook_content="rules", vendors=[], vendor_matches=[],
        stream_reasoning_to_client=False,
    )

    assert ai._generate_stream_to_signalr.await_count == 1
    assert result.is_financial is False
    assert result.debit_account_id is None


@pytest.mark.asyncio
async def test_repair_disabled_via_env(monkeypatch):
    monkeypatch.setenv("AI_ACCOUNT_SELECT_MAX_RETRIES", "0")
    ai = AiService()
    ai._generate_stream_to_signalr = AsyncMock(return_value=(_INVALID_RESPONSE, 10, 10, 0.001))

    result = await ai.classify_async(
        hook=_make_hook(), similar_vectors=[], accounts=ACCOUNTS,
        runbook_content="rules", vendors=[], vendor_matches=[],
        stream_reasoning_to_client=False,
    )

    assert ai._generate_stream_to_signalr.await_count == 1
    assert result.debit_account_id is None
    assert "pick accounts manually" in (result.notes or "")
