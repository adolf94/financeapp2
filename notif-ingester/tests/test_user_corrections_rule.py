import pytest
import os
os.environ["GEMINI_API_KEY"] = "fake-test-key"
os.environ["CLASSIFICATION_AI"] = "openai:gpt-4o"
os.environ["CLASSIFICATION_APIKEY"] = "fake-key"

from services.ai_service import AiService


ACCOUNTS = [
    {"id": "e-food-1", "name": "Groceries", "accountType": "Expense", "accountGroupName": "Food", "tags": ["grocery"]},
    {"id": "a-bpi-1", "name": "BPI Savings", "accountType": "Asset", "accountGroupName": "Asset", "tags": ["6642"]},
]


@pytest.fixture
def ai_service():
    return AiService()


def test_no_corrections_returns_empty_sections(ai_service):
    assert ai_service._format_user_corrections(None) == ("", "")
    assert ai_service._format_user_corrections({}) == ("", "")


def test_correction_section_renders_user_context(ai_service):
    corrections = {
        "user_why": "This is groceries, not dining",
        "transaction_type": "Expense",
        "debit_account_id": "e-food-1",
        "credit_account_id": "a-bpi-1",
    }
    section, rule_field = ai_service._format_user_corrections(corrections, ACCOUNTS)

    assert "This is groceries, not dining" in section
    assert "Expected Transaction Type: Expense" in section
    # Accounts must be rendered as labels, never raw GUIDs
    assert "Asset | BPI Savings" in section
    assert "Food | Groceries" in section
    assert "e-food-1" not in section and "a-bpi-1" not in section


def test_suggested_rule_must_not_echo_user_comments(ai_service):
    corrections = {"comment": "Put this under Groceries"}
    section, rule_field = ai_service._format_user_corrections(corrections, ACCOUNTS)

    assert "Do NOT echo" in section
    assert "Must NOT restate" in rule_field
    assert "as if the user had never said anything" in section


def test_suggested_rule_is_a_runbook_draft(ai_service):
    corrections = {"comment": "Put this under Groceries"}
    section, rule_field = ai_service._format_user_corrections(corrections, ACCOUNTS)

    # The rule field must describe a durable RUNBOOK.md edit, not a restatement
    assert "RUNBOOK.md" in rule_field
    assert "WITHOUT any user correction" in rule_field
    assert "durable, reusable instruction" in rule_field
