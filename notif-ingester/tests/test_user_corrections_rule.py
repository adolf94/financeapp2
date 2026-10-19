import pytest
import os
os.environ["GEMINI_API_KEY"] = "fake-test-key"
os.environ["CLASSIFICATION_AI"] = "openai:gpt-4o"
os.environ["CLASSIFICATION_APIKEY"] = "fake-key"

from unittest.mock import AsyncMock

from services.ai_service import AiService


ACCOUNTS = [
    {"id": "e-food-1", "name": "Groceries", "accountType": "Expense", "accountGroupName": "Food", "tags": ["grocery"]},
    {"id": "a-bpi-1", "name": "BPI Savings", "accountType": "Asset", "accountGroupName": "Asset", "tags": ["6642"]},
]


@pytest.fixture
def ai_service():
    return AiService()


# ---------------------------------------------------------------------------
# _format_user_corrections — code behavior, not prompt wording
# ---------------------------------------------------------------------------

def test_no_corrections_produce_no_prompt_injection(ai_service):
    assert ai_service._format_user_corrections(None) == ("", "")
    assert ai_service._format_user_corrections({}) == ("", "")


def test_correction_section_never_leaks_account_guids(ai_service):
    corrections = {
        "user_why": "This is groceries, not dining",
        "transaction_type": "Expense",
        "debit_account_id": "e-food-1",
        "credit_account_id": "a-bpi-1",
    }
    section, rule_field = ai_service._format_user_corrections(corrections, ACCOUNTS)

    assert "Food | Groceries" in section
    assert "Asset | BPI Savings" in section
    for guid in ("e-food-1", "a-bpi-1"):
        assert guid not in section
        assert guid not in rule_field


def test_user_comment_reaches_prompt_as_context(ai_service):
    section, _ = ai_service._format_user_corrections({"comment": "Put this under Groceries"}, ACCOUNTS)
    assert "Put this under Groceries" in section


# ---------------------------------------------------------------------------
# Review workflow plumbing — corrections (incl. user_why) actually reach the model
# ---------------------------------------------------------------------------

def _correction():
    return {
        "raw_msg": "GCash: You paid PHP 250.00 to Puregold",
        "ai_parsed": {"summary": "Purchase"},
        "user_confirmed": {"user_why": "Put this under Groceries"},
    }


async def _capture_review_prompt(ai_service, entry_point):
    captured = {}

    async def _fake_generate(provider, prompt, **kwargs):
        captured["prompt"] = prompt
        return ("{}", 0, 0, 0)

    ai_service._generate_stream_to_signalr = _fake_generate
    ai_service._debug_log = AsyncMock()

    if entry_point == "start":
        await ai_service.start_runbook_review_async(
            corrections=[_correction()], accounts=ACCOUNTS, vendors=[], current_runbook="# Runbook",
        )
    else:
        await ai_service.chat_runbook_review_async(
            chat_history=[], user_message="ok apply it", proposed_runbook="# Runbook v2",
            proposed_account_updates=[], proposed_vendor_updates=[],
            corrections=[_correction()], accounts=ACCOUNTS, vendors=[], current_runbook="# Runbook",
        )
    return captured["prompt"]


@pytest.mark.asyncio
async def test_review_session_receives_user_why(ai_service):
    prompt = await _capture_review_prompt(ai_service, "start")
    assert "Put this under Groceries" in prompt
    assert "INTENT" in prompt  # canary: the intent-only caveat ships with it


@pytest.mark.asyncio
async def test_review_chat_receives_user_why(ai_service):
    prompt = await _capture_review_prompt(ai_service, "chat")
    assert "Put this under Groceries" in prompt
    assert "INTENT" in prompt
