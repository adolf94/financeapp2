import pytest
import os
os.environ["GEMINI_API_KEY"] = "fake-test-key"
os.environ["CLASSIFICATION_AI"] = "openai:gpt-4o"
os.environ["CLASSIFICATION_APIKEY"] = "fake-key"

import asyncio
from unittest.mock import AsyncMock, MagicMock
from models.pending_ingestion import AiParsedData, AiVendorInfo, PendingIngestion
from services.image_processing_service import ImageProcessingService
from prompts.image_prompts import IMAGE_CLASSIFICATION_PROMPT

def test_image_classification_prompt_formatting():
    formatted = IMAGE_CLASSIFICATION_PROMPT.format(
        filename="starbucks_receipt.jpg",
        description_section="User Note / Description: Coffee",
        inferred_app_section="Inferred App from filename: Grab",
        app_branding_section="",
        runbook_content="# Runbook Rules",
        accounts="Available accounts text",
        vendors="Existing vendors text",
        vendor_matches="Vendor matches text",
        similar_context="Similar context text",
        related_context="",
        user_corrections_section="",
        suggested_rule_field="",
    )
    assert "You are a financial parsing agent" in formatted
    assert "Image Filename: starbucks_receipt.jpg" in formatted
    assert "Inferred App from filename: Grab" in formatted
    assert "# Runbook Rules" in formatted
    assert "Available accounts text" in formatted



@pytest.mark.asyncio
async def test_image_processing_service_process_image():
    mock_repo = AsyncMock()
    mock_repo.add_async = AsyncMock(side_effect=lambda x: x)
    mock_embedding = AsyncMock()
    mock_vector = AsyncMock()
    mock_ai = AsyncMock()
    mock_ai._debug_repo = None
    mock_finance = AsyncMock()
    mock_finance.get_runbook_content_async.return_value = "Test Runbook"
    mock_finance.get_accounts_async.return_value = [{"id": "acc-1", "name": "Cash"}]
    mock_finance.get_vendors_async.return_value = [{"name": "Starbucks"}]
    mock_finance.search_vendors_by_lookups_async.return_value = (None, [])
    mock_finance.search_all_vendor_matches_by_lookups_async.return_value = []
    mock_ai.extract_image_info_async.return_value = {
        "account_numbers": ["09171234567"],
        "account_names": ["Starbucks"],
        "potential_vendor_names": ["Starbucks"],
        "application": "GCash",
        "currency": "PHP",
    }


    mock_blob = AsyncMock()
    mock_blob.upload_image_async.return_value = ("user-1/img1_receipt.png", "https://blob.example/img1_receipt.png")

    mock_ai.classify_image_async.return_value = AiParsedData(
        is_financial=True,
        vendor=AiVendorInfo(name="Starbucks", type="Business"),
        amount=195.0,
        transaction_type="Expense",
        debit_account_id="acc-1",
        credit_account_id="acc-1",
        summary="Coffee at Starbucks",
        confidence=0.98,
        why="Matched Starbucks receipt",
    )

    service = ImageProcessingService(
        ingestion_repo=mock_repo,
        embedding_service=mock_embedding,
        vector_service=mock_vector,
        ai_service=mock_ai,
        finance_api_service=mock_finance,
        blob_storage_service=mock_blob,
    )

    ingestion = await service.process_image_async(
        image_bytes=b"fake-image-bytes",
        mime_type="image/png",
        filename="starbucks_receipt.png",
        user_id="user-1",
        operation_id="op-1",
        stream_reasoning=True,
        description="Team Coffee Break",
    )

    assert ingestion.id is not None
    assert ingestion.user_id == "user-1"
    assert ingestion.notification_type == "image"
    assert ingestion.status == "Pending"
    assert ingestion.ai_parsed.amount == 195.0
    assert ingestion.raw_payload["blob_name"] == "user-1/img1_receipt.png"
    assert ingestion.raw_payload["image_url"] == "https://blob.example/img1_receipt.png"
    assert ingestion.raw_payload["description"] == "Team Coffee Break"
    assert "[IMAGE]: Coffee at Starbucks" in ingestion.raw_msg

@pytest.mark.asyncio
async def test_image_processing_service_process_hook():
    mock_repo = AsyncMock()
    mock_repo.add_async = AsyncMock(side_effect=lambda x: x)
    mock_embedding = AsyncMock()
    mock_vector = AsyncMock()
    mock_ai = AsyncMock()
    mock_ai._debug_repo = None
    mock_finance = AsyncMock()
    mock_finance.get_runbook_content_async.return_value = "Test Runbook"
    mock_finance.get_accounts_async.return_value = [{"id": "acc-1", "name": "Cash"}]
    mock_finance.get_vendors_async.return_value = [{"name": "Starbucks"}]
    mock_finance.search_vendors_by_lookups_async.return_value = (None, [])
    mock_finance.search_all_vendor_matches_by_lookups_async.return_value = []
    mock_ai.extract_image_info_async.return_value = {
        "account_numbers": ["09171234567"],
        "account_names": ["Starbucks"],
        "potential_vendor_names": ["Starbucks"],
        "application": "GCash",
        "currency": "PHP",
    }


    mock_blob = AsyncMock()
    mock_blob.download_image_async.return_value = (b"downloaded-bytes", "image/png")

    mock_ai.classify_image_async.return_value = AiParsedData(
        is_financial=True,
        vendor=AiVendorInfo(name="Starbucks", type="Business"),
        amount=250.0,
        transaction_type="Expense",
        debit_account_id="acc-1",
        credit_account_id="acc-1",
        summary="Starbucks meeting",
        confidence=0.95,
    )

    service = ImageProcessingService(
        ingestion_repo=mock_repo,
        embedding_service=mock_embedding,
        vector_service=mock_vector,
        ai_service=mock_ai,
        finance_api_service=mock_finance,
        blob_storage_service=mock_blob,
    )

    from models.phone_hook import PhoneHookMessage
    hook = PhoneHookMessage(
        id="hook-img-99",
        userId="user-1",
        action="image_upload",
        notification_type="image",
        status="received",
        raw_msg="receipt.png",
        month_key="2026-08",
        partition_key="user-1",
        raw_payload={
            "blob_name": "user-1/hook-img-99_receipt.png",
            "image_url": "https://blob.example/receipt.png",
            "filename": "receipt.png",
            "format": "image/png",
            "description": "Coffee with Team",
            "operation_id": "op-99",
        }
    )

    ingestion = await service.process_hook_async(hook)
    assert ingestion.id == "hook-img-99"
    assert ingestion.notification_type == "image"
    assert ingestion.ai_parsed.amount == 250.0
    mock_blob.download_image_async.assert_called_once_with("user-1/hook-img-99_receipt.png")

def test_extract_application_from_filename():
    from services.preprocessing_service import PreprocessingService
    assert PreprocessingService.extract_application_from_filename("Screenshot_20260815_com.globe.gcash.android.png") == "GCash"
    assert PreprocessingService.extract_application_from_filename("Screenshot_20260815_com.bpi.ng.app.jpg") == "BPI"
    assert PreprocessingService.extract_application_from_filename("Screenshot_20260815_com.bpi.vybe.jpg") == "Vybe"
    assert PreprocessingService.extract_application_from_filename("Vybe_payment_123.png") == "Vybe"
    assert PreprocessingService.extract_application_from_filename("Maya_receipt_123.png") == "Maya"
    assert PreprocessingService.extract_application_from_filename("Grab_order_456.png") == "Grab"
    assert PreprocessingService.extract_application_from_filename("Atome_receipt_789.png") == "Atome"
    assert PreprocessingService.extract_application_from_filename("random_receipt_098.png") is None



@pytest.mark.asyncio
async def test_image_processing_2pass_p2p_vendor_match():
    mock_repo = AsyncMock()
    mock_repo.add_async = AsyncMock(side_effect=lambda x: x)
    mock_embedding = AsyncMock()
    mock_vector = AsyncMock()
    mock_ai = AsyncMock()
    mock_ai._debug_repo = None
    mock_finance = AsyncMock()
    mock_finance.get_runbook_content_async.return_value = "Test Runbook"
    mock_finance.get_accounts_async.return_value = [{"id": "acc-1", "name": "Cash"}, {"id": "acc-rent", "name": "Rent Expense"}]
    mock_finance.get_vendors_async.return_value = [{"name": "Landlord"}]

    # Pass 1: returns extracted mobile number from GCash screenshot
    mock_ai.extract_image_info_async.return_value = {
        "account_numbers": ["09171234567"],
        "account_names": ["Juan Dela Cruz"],
        "potential_vendor_names": [],
        "application": "GCash",
        "currency": "PHP",
    }

    # DB lookup returns matching vendor for that number
    mock_finance.search_all_vendor_matches_by_lookups_async.return_value = [{
        "vendor_id": "v-landlord",
        "vendor_name": "Landlord",
        "matched_lookups": ["09171234567"],
        "total_hits": 15,
        "vendor_type": "Individual",
        "vendor_tags": ["rent", "housing"]
    }]
    mock_finance.search_vendors_by_lookups_async.return_value = ("Landlord", ["09171234567"])

    # Pass 2: multimodal classification uses the matched vendor
    mock_ai.classify_image_async.return_value = AiParsedData(
        is_financial=True,
        vendor=AiVendorInfo(name="Landlord", type="Individual", matched=True, lookups=["09171234567"]),
        amount=15000.0,
        transaction_type="Expense",
        debit_account_id="acc-rent",
        credit_account_id="acc-1",
        summary="Rent payment to Landlord via GCash",
        confidence=0.99,
        why="Matched vendor Landlord via mobile number 09171234567",
    )

    mock_blob = AsyncMock()
    mock_blob.upload_image_async.return_value = ("user-1/gcash_rent.png", "https://blob.example/gcash_rent.png")

    service = ImageProcessingService(
        ingestion_repo=mock_repo,
        embedding_service=mock_embedding,
        vector_service=mock_vector,
        ai_service=mock_ai,
        finance_api_service=mock_finance,
        blob_storage_service=mock_blob,
    )

    ingestion = await service.process_image_async(
        image_bytes=b"fake-gcash-bytes",
        mime_type="image/png",
        filename="Screenshot_20260815_com.globe.gcash.android.png",
        user_id="user-1",
        description="",
    )

    assert ingestion.ai_parsed.vendor.name == "Landlord"
    assert ingestion.ai_parsed.vendor.matched is True
    assert ingestion.ai_parsed.debit_account_id == "acc-rent"
    mock_ai.extract_image_info_async.assert_called_once()
    mock_finance.search_all_vendor_matches_by_lookups_async.assert_called_once()
    # Check that vendor_matches was passed into classify_image_async
    call_kwargs = mock_ai.classify_image_async.call_args.kwargs
    assert len(call_kwargs["vendor_matches"]) == 1
    assert call_kwargs["vendor_matches"][0]["vendor_name"] == "Landlord"
    assert call_kwargs["inferred_app"] == "GCash"





