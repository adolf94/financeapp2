import pytest
import os
os.environ["GEMINI_API_KEY"] = "fake-test-key"
os.environ["CLASSIFICATION_AI"] = "openai:gpt-4o"
os.environ["CLASSIFICATION_APIKEY"] = "fake-key"

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta
from models.phone_hook import PhoneHookMessage
from models.pending_ingestion import PendingIngestion, AiParsedData, AiVendorInfo
from services.ingestion_service import IngestionService
from services.sms_processing_service import SmsProcessingService
from services.email_processing_service import EmailProcessingService
from services.image_processing_service import ImageProcessingService

@pytest.mark.asyncio
async def test_sms_processing_service_signature_and_call():
    mock_repo = AsyncMock()
    mock_embedding = AsyncMock()
    mock_vector = AsyncMock()
    mock_ai = AsyncMock()
    mock_ai._debug_repo = None
    mock_finance = AsyncMock()
    
    mock_ai.classify_sms_async.return_value = AiParsedData(
        is_financial=True,
        amount=100.0,
        vendor=AiVendorInfo(name="Coffee Shop", matched=True, is_recommendation=False)
    )

    service = SmsProcessingService(
        ingestion_repo=mock_repo,
        embedding_service=mock_embedding,
        vector_service=mock_vector,
        ai_service=mock_ai,
        finance_api_service=mock_finance
    )

    hook = PhoneHookMessage(
        id="sms-1",
        user_id="user-1",
        raw_msg="SMS: Paid PHP 100 at Coffee Shop",
        raw_payload={"sender": "GCash"},
        action="",
        status="",
        month_key="2026-08",
        partition_key="user-1",
        received_at=datetime.now(timezone.utc)
    )

    result = await service._classify_hook_async(
        hook=hook,
        similar_vectors=[],
        accounts=[],
        runbook_content="rules",
        vendors=[],
        vendor_matches=[],
        related_context="- [DEFINITE MATCH] Test Context",
        extracted_info=None
    )

    assert result.amount == 100.0
    mock_ai.classify_sms_async.assert_called_once()
    call_kwargs = mock_ai.classify_sms_async.call_args[1]
    assert call_kwargs.get("related_context") == "- [DEFINITE MATCH] Test Context"


@pytest.mark.asyncio
async def test_is_financial_gate_short_circuit():
    mock_repo = AsyncMock()
    mock_repo.add_async = AsyncMock(side_effect=lambda x: x)
    mock_embedding = AsyncMock()
    mock_vector = AsyncMock()
    mock_ai = AsyncMock()
    mock_ai._debug_repo = None
    mock_finance = AsyncMock()
    mock_finance.get_accounts_async.return_value = []
    mock_finance.get_vendors_async.return_value = []
    mock_finance.get_runbook_content_async.return_value = "rules"

    # Non-financial notification (e.g. OTP)
    mock_ai.is_financial_transaction_async.return_value = False

    service = IngestionService(
        ingestion_repo=mock_repo,
        embedding_service=mock_embedding,
        vector_service=mock_vector,
        ai_service=mock_ai,
        finance_api_service=mock_finance
    )

    hook = PhoneHookMessage(
        id="otp-1",
        user_id="user-1",
        raw_msg="Your OTP is 123456. Do not share.",
        raw_payload={"notif_pkg": "com.bank.app"},
        action="",
        status="",
        month_key="2026-08",
        partition_key="user-1",
        received_at=datetime.now(timezone.utc)
    )

    result = await service.process_hook_async(hook)

    assert result.status == "NonFinancial"
    assert result.ttl == 7 * 24 * 60 * 60
    assert result.ai_parsed.is_financial is False
    # Verify classify_async was NOT called
    mock_ai.classify_async.assert_not_called()


@pytest.mark.asyncio
async def test_email_and_image_bypass_is_financial_gate():
    mock_repo = AsyncMock()
    mock_embedding = AsyncMock()
    mock_vector = AsyncMock()
    mock_ai = AsyncMock()
    mock_ai._debug_repo = None
    mock_finance = AsyncMock()

    email_service = EmailProcessingService(
        ingestion_repo=mock_repo,
        embedding_service=mock_embedding,
        vector_service=mock_vector,
        ai_service=mock_ai,
        finance_api_service=mock_finance
    )
    assert email_service._use_is_financial_gate() is False
    assert email_service._get_relation_window_minutes() == 60.0

    image_service = ImageProcessingService(
        ingestion_repo=mock_repo,
        embedding_service=mock_embedding,
        vector_service=mock_vector,
        ai_service=mock_ai,
        finance_api_service=mock_finance
    )
    assert image_service._use_is_financial_gate() is False
    assert image_service._get_relation_window_minutes() == 1440.0


@pytest.mark.asyncio
async def test_raw_payload_persists_extracted_info():
    mock_repo = AsyncMock()
    mock_repo.add_async = AsyncMock(side_effect=lambda x: x)
    mock_embedding = AsyncMock()
    mock_vector = AsyncMock()
    mock_vector.find_similar_async.return_value = []
    mock_ai = AsyncMock()
    mock_ai._debug_repo = None
    mock_ai.is_financial_transaction_async.return_value = True
    mock_ai.classify_async.return_value = AiParsedData(
        is_financial=True,
        amount=50.0,
        vendor=AiVendorInfo(name="Shop", matched=True)
    )
    mock_finance = AsyncMock()
    mock_finance.get_accounts_async.return_value = []
    mock_finance.get_vendors_async.return_value = []
    mock_finance.get_runbook_content_async.return_value = "rules"
    mock_finance.search_all_vendor_matches_by_lookups_async.return_value = []
    mock_finance.search_confirmed_ledger_entries_async.return_value = []

    service = IngestionService(
        ingestion_repo=mock_repo,
        embedding_service=mock_embedding,
        vector_service=mock_vector,
        ai_service=mock_ai,
        finance_api_service=mock_finance
    )

    with patch.object(service._preprocessing_service, "process_hook") as mock_prep:
        from services.preprocessing_service import ExtractedAccountInfo
        mock_prep.return_value = ExtractedAccountInfo(
            account_numbers=["1234"],
            account_names=["John"],
            application="BankApp",
            potential_vendor_names=["Shop"],
            currency="PHP",
            reference_number="REF-001",
            amount=50.0,
            date="2026-08-19T00:00:00Z",
            is_multi_order=False
        )

        hook = PhoneHookMessage(
            id="hook-ext",
            user_id="user-1",
            raw_msg="Paid 50 to Shop",
            raw_payload={"notif_pkg": "com.bank.app"},
            action="",
            status="",
            month_key="2026-08",
            partition_key="user-1",
            received_at=datetime.now(timezone.utc)
        )

        result = await service.process_hook_async(hook)

        assert "extracted_info" in hook.raw_payload
        assert hook.raw_payload["extracted_info"]["currency"] == "PHP"
        assert hook.raw_payload["extracted_info"]["reference_number"] == "REF-001"
        assert hook.raw_payload["extracted_info"]["amount"] == 50.0
        assert hook.raw_payload["extracted_info"]["is_multi_order"] is False
