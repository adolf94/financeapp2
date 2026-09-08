import pytest
import os
os.environ.setdefault("GEMINI_API_KEY", "fake-test-key")
os.environ.setdefault("CLASSIFICATION_AI", "openai:gpt-4o")
os.environ.setdefault("CLASSIFICATION_APIKEY", "fake-key")

from unittest.mock import AsyncMock, MagicMock

from models.pending_ingestion import PendingIngestion, AiParsedData
from repositories.ingestion_repository import CosmosIngestionRepository


def make_doc(id: str, user_id: str, status: str = "Pending", timestamp: str = "2026-01-01T00:00:00+00:00") -> dict:
    ing = PendingIngestion(
        id=id,
        UserId=user_id,
        hook_id=f"hook-{id}",
        raw_payload={"timestamp": timestamp},
        raw_msg="raw",
        ai_parsed=AiParsedData(),
        month_key="2026-01",
        status=status,
    )
    return ing.model_dump(by_alias=True, mode="json")


class FakeAsyncIterator:
    def __init__(self, items):
        self._items = list(items)

    def __aiter__(self):
        self._it = iter(self._items)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


def make_repo(items, query_kwargs_capture):
    repo = CosmosIngestionRepository.__new__(CosmosIngestionRepository)
    container = MagicMock()

    def query_items(**kwargs):
        query_kwargs_capture.update(kwargs)
        return FakeAsyncIterator(items)

    container.query_items.side_effect = query_items
    repo._get_container = AsyncMock(return_value=container)
    return repo


# ── get_by_id_cross_partition_async ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_by_id_cross_partition_returns_item():
    kwargs = {}
    repo = make_repo([make_doc("ing-1", "user-1")], kwargs)

    result = await repo.get_by_id_cross_partition_async("ing-1")

    assert result is not None
    assert result.id == "ing-1"
    assert result.user_id == "user-1"
    assert kwargs.get("partition_key") is None
    assert "UserId" not in kwargs["query"]


@pytest.mark.asyncio
async def test_get_by_id_cross_partition_not_found_returns_none():
    kwargs = {}
    repo = make_repo([], kwargs)

    assert await repo.get_by_id_cross_partition_async("missing") is None
    assert kwargs.get("partition_key") is None


# ── get_by_status_cross_partition_async ──────────────────────────────────────

@pytest.mark.asyncio
async def test_get_by_status_cross_partition_returns_all_users_sorted_desc():
    kwargs = {}
    repo = make_repo(
        [
            make_doc("ing-old", "user-1", timestamp="2026-01-01T00:00:00+00:00"),
            make_doc("ing-new", "user-2", timestamp="2026-01-03T00:00:00+00:00"),
            make_doc("ing-mid", "user-3", timestamp="2026-01-02T00:00:00+00:00"),
        ],
        kwargs,
    )

    results = await repo.get_by_status_cross_partition_async("Pending")

    assert [r.id for r in results] == ["ing-new", "ing-mid", "ing-old"]
    assert kwargs.get("partition_key") is None
    assert "UserId" not in kwargs["query"]
    assert {"name": "@status", "value": "Pending"} in kwargs["parameters"]


@pytest.mark.asyncio
async def test_get_by_status_cross_partition_respects_skip_top():
    kwargs = {}
    repo = make_repo(
        [make_doc(f"ing-{i}", "user-1", timestamp=f"2026-01-0{i + 1}T00:00:00+00:00") for i in range(1, 5)],
        kwargs,
    )

    results = await repo.get_by_status_cross_partition_async("Pending", skip=1, top=2)

    assert [r.id for r in results] == ["ing-3", "ing-2"]


# ── get_by_status_async stays partition-scoped ───────────────────────────────

@pytest.mark.asyncio
async def test_get_by_status_async_filters_by_user_id():
    kwargs = {}
    repo = make_repo([make_doc("ing-1", "user-1")], kwargs)

    await repo.get_by_status_async("user-1", "Pending")

    assert "c.UserId = @user_id" in kwargs["query"]
    assert kwargs.get("partition_key") is None


# ── _has_user_scope (endpoint branch selector) ───────────────────────────────

def test_has_user_scope():
    from function_app import _has_user_scope

    assert _has_user_scope({"scope": "api://finance-app-api/user openid"}) is True
    assert _has_user_scope({"scope": ["api://finance-app-api/user"]}) is True
    assert _has_user_scope({"scope": "api://finance-app-api/ingestions:read"}) is False
    assert _has_user_scope({"scope": ["api://finance-app-api/ingestions:read", "api://finance-app-api/transactions:create"]}) is False
    assert _has_user_scope({}) is False
