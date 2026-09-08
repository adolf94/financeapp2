import pytest
import os
os.environ["GEMINI_API_KEY"] = "fake-test-key"
os.environ["CLASSIFICATION_AI"] = "openai:gpt-4o"
os.environ["CLASSIFICATION_APIKEY"] = "fake-key"

from unittest.mock import AsyncMock, MagicMock
from services.ingestion_service import IngestionService
from services.sms_processing_service import SmsProcessingService
from services.email_processing_service import EmailProcessingService
from services.image_processing_service import ImageProcessingService
from services.finance_api_service import FinanceApiService


def make_service(cls=IngestionService):
    mock_finance = MagicMock()
    mock_finance.get_app_runbook_content_async = AsyncMock(return_value="")
    service = cls(
        ingestion_repo=AsyncMock(),
        embedding_service=AsyncMock(),
        vector_service=AsyncMock(),
        ai_service=MagicMock(_debug_repo=None),
        finance_api_service=mock_finance,
    )
    return service


def _normalize(pkg):
    return FinanceApiService._normalize_package_id(pkg)


# ── Package id normalization ─────────────────────────────────────────────────

def test_normalize_package_id_trim_and_lower():
    assert _normalize("  Com.GCASH.Android ") == "com.gcash.android"


def test_normalize_package_id_rejects_invalid():
    assert _normalize("") == ""
    assert _normalize(None) == ""
    assert _normalize("bad/id") == ""
    assert _normalize("bad#id") == ""
    assert _normalize(".starts-with-dot") == ""


# ── FinanceApiService app-runbook helpers ────────────────────────────────────

@pytest.mark.asyncio
async def test_get_app_runbook_uses_namespaced_id():
    svc = FinanceApiService.__new__(FinanceApiService)
    svc.client = None
    svc.db_name = "FinanceDb"
    svc.get_runbook_content_async = AsyncMock(return_value="app rules")

    content = await svc.get_app_runbook_content_async("user-1", "Com.Example.App")

    assert content == "app rules"
    svc.get_runbook_content_async.assert_awaited_once_with(
        "user-1", runbook_id="runbook-app:com.example.app"
    )


@pytest.mark.asyncio
async def test_get_app_runbook_invalid_pkg_returns_empty():
    svc = FinanceApiService.__new__(FinanceApiService)
    svc.client = None
    svc.get_runbook_content_async = AsyncMock()

    assert await svc.get_app_runbook_content_async("user-1", "bad/id") == ""
    svc.get_runbook_content_async.assert_not_awaited()


@pytest.mark.asyncio
async def test_save_app_runbook_upserts_namespaced_doc():
    svc = FinanceApiService.__new__(FinanceApiService)
    container = MagicMock()
    container.upsert_item = AsyncMock()
    db = MagicMock()
    db.get_container_client.return_value = container
    svc.client = MagicMock()
    svc.client.get_database_client.return_value = db
    svc.db_name = "FinanceDb"

    await svc.save_app_runbook_content_async("user-1", "com.example.app", "# Rules", label="Example")

    doc = container.upsert_item.await_args[0][0]
    assert doc["id"] == "runbook-app:com.example.app"
    assert doc["UserId"] == "user-1"
    assert doc["content"] == "# Rules"
    assert doc["packageId"] == "com.example.app"
    assert doc["label"] == "Example"


class _AsyncIter:
    def __init__(self, items):
        self.items = items

    def __aiter__(self):
        async def gen():
            for i in self.items:
                yield i
        return gen()


@pytest.mark.asyncio
async def test_list_app_runbooks_returns_sorted_summaries():
    svc = FinanceApiService.__new__(FinanceApiService)
    container = MagicMock()
    container.query_items.return_value = _AsyncIter([
        {"id": "runbook-app:com.zeta", "packageId": "com.zeta", "label": "Zeta", "UserId": "user-1", "_ts": 2},
        {"id": "runbook-app:com.alpha", "UserId": "user-1", "_ts": 1},
        {"id": "runbook-app:com.other", "packageId": "com.other", "UserId": "user-2", "_ts": 3},
    ])
    db = MagicMock()
    db.get_container_client.return_value = container
    svc.client = MagicMock()
    svc.client.get_database_client.return_value = db
    svc.db_name = "FinanceDb"

    apps = await svc.list_app_runbooks_async("user-1")

    assert [a["package_id"] for a in apps] == ["com.alpha", "com.zeta"]
    assert apps[0]["label"] == ""


# ── _compose_runbook_content_async ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_compose_no_pkg_returns_base_unchanged():
    service = make_service()

    result = await service._compose_runbook_content_async("user-1", "GLOBAL", {"nope": "x"})

    assert result == "GLOBAL"
    service._finance_api_service.get_app_runbook_content_async.assert_not_awaited()


@pytest.mark.asyncio
async def test_compose_missing_app_runbook_returns_base_unchanged():
    service = make_service()

    result = await service._compose_runbook_content_async("user-1", "GLOBAL", {"notif_pkg": "com.example.app"})

    assert result == "GLOBAL"
    service._finance_api_service.get_app_runbook_content_async.assert_awaited_once_with("user-1", "com.example.app")


@pytest.mark.asyncio
async def test_compose_appends_app_section_additively():
    service = make_service()
    service._finance_api_service.get_app_runbook_content_async = AsyncMock(return_value="App rule: treat X as Grab.")

    result = await service._compose_runbook_content_async("user-1", "GLOBAL RULES", {"notif_pkg": "com.example.app"})

    assert result.startswith("GLOBAL RULES")
    assert "## App-Specific Rules (com.example.app)" in result
    assert "ADDITIVE" in result
    assert "App rule: treat X as Grab." in result


@pytest.mark.asyncio
async def test_compose_respects_budget():
    service = make_service()
    service._finance_api_service.get_app_runbook_content_async = AsyncMock(return_value="x" * 20000)

    result = await service._compose_runbook_content_async("user-1", "GLOBAL", {"notif_pkg": "com.example.app"})

    assert len(result) <= 8000


@pytest.mark.asyncio
async def test_compose_fetch_failure_degrades_to_base():
    service = make_service()
    service._finance_api_service.get_app_runbook_content_async = AsyncMock(side_effect=RuntimeError("cosmos down"))

    result = await service._compose_runbook_content_async("user-1", "GLOBAL", {"notif_pkg": "com.example.app"})

    assert result == "GLOBAL"


# ── Pipeline gating ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_subclass_pipelines_never_fetch_app_runbook():
    for cls in (SmsProcessingService, EmailProcessingService, ImageProcessingService):
        service = make_service(cls)

        result = await service._compose_runbook_content_async("user-1", "BASE", {"notif_pkg": "com.example.app"})

        assert result == "BASE"
        service._finance_api_service.get_app_runbook_content_async.assert_not_awaited()


@pytest.mark.asyncio
async def test_app_pipeline_process_hook_composes_runbook_before_gate():
    service = make_service(IngestionService)
    service._finance_api_service.get_runbook_content_async = AsyncMock(return_value="GLOBAL")
    service._finance_api_service.get_accounts_async = AsyncMock(return_value=[])
    service._finance_api_service.get_vendors_async = AsyncMock(return_value=[])
    service._embedding_service.embed_async = AsyncMock(return_value=[0.0])
    service._vector_service.find_similar_async = AsyncMock(return_value=[])
    service._ai_service.is_financial_transaction_async = AsyncMock(return_value=False)
    service._compose_runbook_content_async = AsyncMock(return_value="COMBINED")

    service._repo.add_async = AsyncMock(side_effect=lambda x: x)

    from datetime import datetime, timezone
    from models.phone_hook import PhoneHookMessage
    hook = PhoneHookMessage(
        id="hook-1",
        user_id="user-1",
        raw_msg="Paid 100",
        raw_payload={"notif_pkg": "com.example.app"},
        action="",
        status="",
        month_key="2026-09",
        partition_key="user-1",
        received_at=datetime.now(timezone.utc),
        notification_type="app",
    )

    await service.process_hook_async(hook)

    service._compose_runbook_content_async.assert_awaited_once_with(
        "user-1", "GLOBAL", {"notif_pkg": "com.example.app"}
    )
