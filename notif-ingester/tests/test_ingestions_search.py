import pytest
import os
os.environ.setdefault("GEMINI_API_KEY", "fake-test-key")
os.environ.setdefault("CLASSIFICATION_AI", "openai:gpt-4o")
os.environ.setdefault("CLASSIFICATION_APIKEY", "fake-key")

import json
from unittest.mock import AsyncMock, MagicMock, patch

from models.pending_ingestion import PendingIngestion, AiParsedData
from repositories.ingestion_repository import CosmosIngestionRepository

from test_ingestions_read_scope import FakeAsyncIterator, make_repo, make_doc


def make_amount_doc(id: str, user_id: str, amount, timestamp: str = "2026-01-02T00:00:00+00:00", received_at: str = "2026-01-02T00:00:00+00:00") -> dict:
    ing = PendingIngestion(
        id=id,
        UserId=user_id,
        hook_id=f"hook-{id}",
        received_at=received_at,
        raw_payload={"timestamp": timestamp},
        raw_msg="raw",
        ai_parsed=AiParsedData(amount=amount),
        month_key="2026-01",
    )
    return ing.model_dump(by_alias=True, mode="json")


# ── repository: search_by_amount_and_range_async ─────────────────────────────

@pytest.mark.asyncio
async def test_search_repo_scopes_to_user_when_user_id_given():
    kwargs = {}
    repo = make_repo([make_amount_doc("ing-1", "user-1", 250.0)], kwargs)

    results = await repo.search_by_amount_and_range_async(
        amount=250.0,
        start_time="2026-01-01T00:00:00+00:00",
        end_time="2026-01-03T00:00:00+00:00",
        user_id="user-1",
    )

    assert [r.id for r in results] == ["ing-1"]
    assert "c.UserId = @user_id" in kwargs["query"]
    assert "c.received_at >= @start_time" in kwargs["query"]
    assert "c.received_at <= @end_time" in kwargs["query"]
    assert {"name": "@user_id", "value": "user-1"} in kwargs["parameters"]


@pytest.mark.asyncio
async def test_search_repo_cross_partition_when_no_user_id():
    kwargs = {}
    repo = make_repo(
        [make_amount_doc("ing-1", "user-1", 100.0), make_amount_doc("ing-2", "user-2", 100.0)],
        kwargs,
    )

    results = await repo.search_by_amount_and_range_async(amount=100.0)

    assert {r.id for r in results} == {"ing-1", "ing-2"}
    assert "UserId" not in kwargs["query"]
    assert kwargs.get("partition_key") is None


@pytest.mark.asyncio
async def test_search_repo_matches_absolute_rounded_amount():
    kwargs = {}
    repo = make_repo(
        [
            make_amount_doc("ing-match", "user-1", -250.004),
            make_amount_doc("ing-other", "user-1", 99.99),
        ],
        kwargs,
    )

    results = await repo.search_by_amount_and_range_async(amount=250.0)

    assert [r.id for r in results] == ["ing-match"]


@pytest.mark.asyncio
async def test_search_repo_skips_docs_without_amount():
    kwargs = {}
    repo = make_repo([make_doc("ing-no-amount", "user-1")], kwargs)

    results = await repo.search_by_amount_and_range_async(amount=250.0)

    assert results == []


@pytest.mark.asyncio
async def test_search_repo_respects_skip_top():
    kwargs = {}
    repo = make_repo(
        [make_amount_doc(f"ing-{i}", "user-1", 50.0, timestamp=f"2026-01-0{i + 1}T00:00:00+00:00") for i in range(1, 5)],
        kwargs,
    )

    results = await repo.search_by_amount_and_range_async(amount=50.0, skip=1, top=2)

    assert [r.id for r in results] == ["ing-3", "ing-2"]


# ── route: GET /ingestion-search ───────────────────────────────────────────────

class FakeRequest:
    def __init__(self, params):
        self.params = params

    class _RouteParams(dict):
        pass

    route_params = _RouteParams()


async def run_search_route(params, scopes, sub="some-client", repo_return=None):
    import function_app

    payload = {"sub": sub, "scope": scopes}
    fake_repo = MagicMock()
    fake_repo.search_by_amount_and_range_async = AsyncMock(
        return_value=repo_return if repo_return is not None else []
    )

    with patch.object(function_app._auth_client, "validate", return_value=(payload, None)), \
         patch("function_app.CosmosIngestionRepository", return_value=fake_repo):
        resp = await function_app.SearchIngestionsFunction(FakeRequest(params))

    return resp, fake_repo


@pytest.mark.asyncio
async def test_route_user_scope_is_partition_scoped():
    resp, repo = await run_search_route(
        {"amount": "250", "startDate": "2026-01-01", "endDate": "2026-02-01"},
        "api://finance-app-api/user openid",
        sub="user-1",
    )

    assert resp.status_code == 200
    kwargs = repo.search_by_amount_and_range_async.call_args.kwargs
    assert kwargs["user_id"] == "user-1"
    # naive dates are normalized from Asia/Manila to UTC
    assert kwargs["start_time"] == "2025-12-31T16:00:00+00:00"
    assert kwargs["end_time"] is not None


@pytest.mark.asyncio
async def test_route_client_credentials_is_cross_partition():
    resp, repo = await run_search_route(
        {"amount": "250"},
        "api://finance-app-api/ingestions:read",
        sub="some-client",
    )

    assert resp.status_code == 200
    kwargs = repo.search_by_amount_and_range_async.call_args.kwargs
    assert kwargs["user_id"] is None


@pytest.mark.asyncio
async def test_route_requires_amount():
    resp, repo = await run_search_route({}, "api://finance-app-api/ingestions:read")

    assert resp.status_code == 400
    assert "amount" in json.loads(resp.get_body())["error"]
    repo.search_by_amount_and_range_async.assert_not_awaited()


@pytest.mark.asyncio
async def test_route_rejects_invalid_dates():
    resp, repo = await run_search_route(
        {"amount": "10", "startDate": "not-a-date"},
        "api://finance-app-api/ingestions:read",
    )

    assert resp.status_code == 400
    assert "startDate" in json.loads(resp.get_body())["error"]
    repo.search_by_amount_and_range_async.assert_not_awaited()


@pytest.mark.asyncio
async def test_route_returns_serialized_results():
    from models.pending_ingestion import PendingIngestion as PI

    ingestion = PI(
        id="ing-1",
        UserId="user-1",
        hook_id="hook-1",
        raw_payload={"timestamp": "2026-01-02T00:00:00+00:00"},
        raw_msg="raw",
        ai_parsed=AiParsedData(amount=250.0),
        month_key="2026-01",
    )
    resp, _ = await run_search_route(
        {"amount": "250"},
        "api://finance-app-api/ingestions:read",
        repo_return=[ingestion],
    )

    assert resp.status_code == 200
    body = json.loads(resp.get_body())
    assert body[0]["id"] == "ing-1"
