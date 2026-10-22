import pytest
import os

os.environ["GEMINI_API_KEY"] = "fake-test-key"
os.environ["CLASSIFICATION_AI"] = "openai:gpt-4o"
os.environ["CLASSIFICATION_APIKEY"] = "fake-key"

import asyncio
from typing import Tuple, Optional

from services.llm_provider import (
    LlmProvider,
    RoutedLlmProvider,
    _is_retryable,
    make_provider,
    get_circuit_states,
    reset_circuits,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

class FakeProvider(LlmProvider):
    """Scripted provider: per-call exception list, then success."""

    def __init__(self, label: str, failures: list = None, result: str = "ok"):
        self._label = label
        self.failures = list(failures or [])  # one entry consumed per call
        self.result = result
        self.calls = 0

    @property
    def provider_label(self) -> str:
        return self._label

    async def generate(self, prompt, system=None, json_mode=False, temperature=0.2,
                       thinking_budget=None, image_bytes=None, mime_type=None
                       ) -> Tuple[str, Optional[int], Optional[int], Optional[float]]:
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return self.result, 10, 5, None

    async def generate_stream(self, prompt, system=None, json_mode=False, temperature=0.2,
                              include_reasoning=False, image_bytes=None, mime_type=None):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        yield ("content", "he")
        yield ("content", "llo")
        yield ("usage", (10, 5, None))


class HttpError(Exception):
    """Mimics SDK HTTP errors carrying a status code."""

    def __init__(self, status: int, message: str = ""):
        super().__init__(message or f"http {status}")
        self.status_code = status


@pytest.fixture(autouse=True)
def clean_circuits():
    reset_circuits()
    yield
    reset_circuits()


def _router(**kwargs) -> RoutedLlmProvider:
    defaults = dict(
        lane="TESTLANE",
        primary=FakeProvider("primary:model", failures=[HttpError(429), HttpError(429)]),
        backup=FakeProvider("backup:model"),
        tries_per_provider=2,
        backoff_seconds=0.0,
    )
    defaults.update(kwargs)
    return RoutedLlmProvider(**defaults)


# ---------------------------------------------------------------------------
# _is_retryable policy (plan §3)
# ---------------------------------------------------------------------------

def test_429_and_5xx_are_retryable():
    assert _is_retryable(HttpError(429))
    assert _is_retryable(HttpError(500))
    assert _is_retryable(HttpError(503))


def test_4xx_and_programming_errors_are_not_retryable():
    assert not _is_retryable(HttpError(400))
    assert not _is_retryable(HttpError(401))
    assert not _is_retryable(ValueError("bad"))
    assert not _is_retryable(TypeError("nope"))


def test_timeout_and_connection_errors_are_retryable():
    class APITimeoutError(Exception):
        pass

    assert _is_retryable(APITimeoutError("timed out"))
    assert _is_retryable(ConnectionError("connection reset"))


# ---------------------------------------------------------------------------
# 2 tries primary → 2 tries backup → fail (plan §3)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_primary_retried_twice_then_backup_succeeds():
    router = _router()
    result, in_tok, out_tok, _ = await router.generate(prompt="hi")

    assert result == "ok"
    assert router._primary.calls == 2          # both primary tries consumed
    assert router._backup.calls == 1           # backup first try succeeded
    assert get_circuit_states()["TESTLANE"] == "backup"  # lane latched


@pytest.mark.asyncio
async def test_all_fail_raises_and_backup_gets_full_budget():
    primary = FakeProvider("primary:model", failures=[HttpError(429), HttpError(429)])
    backup = FakeProvider("backup:model", failures=[HttpError(500), HttpError(500)])
    router = _router(primary=primary, backup=backup)

    with pytest.raises(HttpError):
        await router.generate(prompt="hi")

    assert primary.calls == 2
    assert backup.calls == 2


@pytest.mark.asyncio
async def test_non_retryable_on_primary_fails_immediately_without_backup():
    primary = FakeProvider("primary:model", failures=[HttpError(400)])
    backup = FakeProvider("backup:model")
    router = _router(primary=primary, backup=backup)

    with pytest.raises(HttpError):
        await router.generate(prompt="hi")

    assert primary.calls == 1                  # no retry on 400
    assert backup.calls == 0                   # fail immediately, no backup
    assert "TESTLANE" not in get_circuit_states()  # no latch


@pytest.mark.asyncio
async def test_primary_success_never_touched_backup():
    primary = FakeProvider("primary:model")
    backup = FakeProvider("backup:model")
    router = _router(primary=primary, backup=backup)

    result, _, _, _ = await router.generate(prompt="hi")

    assert result == "ok"
    assert primary.calls == 1
    assert backup.calls == 0
    assert "TESTLANE" not in get_circuit_states()


# ---------------------------------------------------------------------------
# Latching (manual recovery only)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_latched_lane_skips_primary_entirely():
    router = _router()
    await router.generate(prompt="first")   # primary exhausts → latch → backup ok

    assert get_circuit_states()["TESTLANE"] == "backup"

    primary, backup = router._primary, router._backup
    result, _, _, _ = await router.generate(prompt="second")

    assert result == "ok"
    assert primary.calls == 2               # unchanged: no more primary tries
    assert backup.calls == 2                # one from first call, one direct


@pytest.mark.asyncio
async def test_manual_reset_restores_primary_first():
    router = _router()
    await router.generate(prompt="first")   # latch to backup (primary burns 2 tries)
    reset_circuits("TESTLANE")

    result, _, _, _ = await router.generate(prompt="second")

    assert result == "ok"
    # 2 failed tries before reset + 1 healthy success try after reset.
    # Had the primary still been failing, calls would be 4 and the call
    # would have fallen back to backup again.
    assert router._primary.calls == 3
    assert router._backup.calls == 1


@pytest.mark.asyncio
async def test_reset_all_lanes():
    router = _router()
    await router.generate(prompt="first")
    reset_circuits()
    assert "TESTLANE" not in get_circuit_states()


# ---------------------------------------------------------------------------
# provider_label reflects the model actually used
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_provider_label_follows_last_used_provider():
    router = _router()
    assert router.provider_label == "primary:model"

    await router.generate(prompt="hi")      # ends on backup
    assert router.provider_label == "backup:model"


# ---------------------------------------------------------------------------
# Streaming failover
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stream_failover_before_first_chunk():
    primary = FakeProvider("primary:model", failures=[HttpError(429), HttpError(429)])
    backup = FakeProvider("backup:model")
    router = _router(primary=primary, backup=backup)

    chunks = [chunk async for chunk in router.generate_stream(prompt="hi")]

    assert primary.calls == 2
    assert backup.calls == 1
    assert ("content", "he") in chunks and ("content", "llo") in chunks
    assert get_circuit_states()["TESTLANE"] == "backup"


@pytest.mark.asyncio
async def test_mid_stream_failure_propagates_without_backup():
    class MidStreamProvider(FakeProvider):
        async def generate_stream(self, prompt, **kwargs):
            self.calls += 1
            yield ("content", "par")
            raise HttpError(429, "mid-stream drop")

    primary = MidStreamProvider("primary:model")
    backup = FakeProvider("backup:model")
    router = _router(primary=primary, backup=backup)

    received = []
    with pytest.raises(HttpError):
        async for chunk in router.generate_stream(prompt="hi"):
            received.append(chunk)

    assert received == [("content", "par")]
    assert backup.calls == 0                # cannot replay mid-stream
    assert "TESTLANE" not in get_circuit_states()


# ---------------------------------------------------------------------------
# Factory wiring
# ---------------------------------------------------------------------------

def test_make_provider_returns_router_when_backup_configured(monkeypatch):
    reset_circuits()
    monkeypatch.setenv("CLASSIFICATION_AI", "go-anthropic:qwen3.7-plus")
    monkeypatch.setenv("CLASSIFICATION_APIKEY", "go-key")
    monkeypatch.setenv("CLASSIFICATION_AI_BACKUP", "openrouter:qwen/qwen3.7-flash")
    monkeypatch.setenv("CLASSIFICATION_APIKEY_BACKUP", "or-key")

    provider = make_provider("CLASSIFICATION")

    assert isinstance(provider, RoutedLlmProvider)
    assert provider.lane == "CLASSIFICATION"
    assert provider._primary.provider_label == "opencode-go:qwen3.7-plus"
    assert provider._backup.provider_label == "openrouter:qwen/qwen3.7-flash"


def test_derived_role_inherits_classification_lane(monkeypatch):
    reset_circuits()
    monkeypatch.setenv("CLASSIFICATION_AI", "go-anthropic:qwen3.7-plus")
    monkeypatch.setenv("CLASSIFICATION_APIKEY", "go-key")
    monkeypatch.setenv("CLASSIFICATION_AI_BACKUP", "openrouter:qwen/qwen3.7-flash")
    monkeypatch.setenv("CLASSIFICATION_APIKEY_BACKUP", "or-key")
    monkeypatch.delenv("RECLASSIFICATION_AI", raising=False)
    monkeypatch.delenv("RECLASSIFICATION_APIKEY", raising=False)

    provider = make_provider("RECLASSIFICATION")

    assert isinstance(provider, RoutedLlmProvider)
    assert provider.lane == "RECLASSIFICATION"          # own circuit
    assert provider._primary.provider_label == "opencode-go:qwen3.7-plus"
    assert provider._backup.provider_label == "openrouter:qwen/qwen3.7-flash"


def test_reclassification_lane_overrides(monkeypatch):
    reset_circuits()
    monkeypatch.setenv("CLASSIFICATION_AI", "openai:gpt-4o")
    monkeypatch.setenv("CLASSIFICATION_APIKEY", "key-b")
    monkeypatch.setenv("RECLASSIFICATION_AI", "go:glm-5.3-flash")
    monkeypatch.setenv("RECLASSIFICATION_APIKEY", "go-key")
    monkeypatch.setenv("RECLASSIFICATION_AI_BACKUP", "openrouter:qwen/qwen3.7-flash")
    monkeypatch.setenv("RECLASSIFICATION_APIKEY_BACKUP", "or-key")

    provider = make_provider("RECLASSIFICATION")

    assert isinstance(provider, RoutedLlmProvider)
    assert provider._primary.provider_label == "opencode-go:glm-5.3-flash"
    assert provider._backup.provider_label == "openrouter:qwen/qwen3.7-flash"


def test_preprocessing_inherits_classification_when_unset(monkeypatch):
    reset_circuits()
    monkeypatch.setenv("CLASSIFICATION_AI", "openai:gpt-4o")
    monkeypatch.setenv("CLASSIFICATION_APIKEY", "key-b")
    monkeypatch.delenv("PREPROCESSING_AI", raising=False)

    provider = make_provider("PREPROCESSING")
    assert provider.provider_label == "openai:gpt-4o"


def test_unknown_role_rejected():
    with pytest.raises(ValueError):
        make_provider("NONEXISTENT")


# ---------------------------------------------------------------------------
# go endpoint must explicitly request reasoning when streaming (GLM skips CoT
# on JSON-only prompts otherwise)
# ---------------------------------------------------------------------------

class _FakeStream:
    def __init__(self, chunks):
        self._chunks = chunks

    def __aiter__(self):
        async def _gen():
            for c in self._chunks:
                yield c
        return _gen()


def _fake_chunk(content="{\"ok\": true}"):
    from types import SimpleNamespace
    return SimpleNamespace(
        usage=None,
        choices=[SimpleNamespace(delta=SimpleNamespace(
            content=content, reasoning=None, reasoning_content=None, reasoning_details=None))],
    )


@pytest.mark.asyncio
async def test_go_stream_requests_reasoning_effort_when_included():
    from types import SimpleNamespace
    from services.llm_provider import OpenAICompatibleProvider

    p = OpenAICompatibleProvider(
        api_key="k", model="glm-5.3-flash",
        base_url="https://opencode.ai/inference/go/openai/v1",
    )
    p.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
        create=AsyncMock(return_value=_FakeStream([_fake_chunk(), SimpleNamespace(usage=None, choices=[])]))
    )))

    got = [c async for c in p.generate_stream(prompt="p", include_reasoning=True)]

    kwargs = p.client.chat.completions.create.call_args.kwargs
    assert kwargs["reasoning_effort"] == "medium"      # explicit CoT request
    assert "response_format" not in kwargs             # json_mode suppressed
    assert ("content", "{\"ok\": true}") in got


@pytest.mark.asyncio
async def test_go_reasoning_effort_configurable_via_env(monkeypatch):
    from types import SimpleNamespace
    from services.llm_provider import OpenAICompatibleProvider

    monkeypatch.setenv("GO_REASONING_EFFORT", "high")

    p = OpenAICompatibleProvider(
        api_key="k", model="glm-5.3-flash",
        base_url="https://opencode.ai/inference/go/openai/v1",
    )
    p.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
        create=AsyncMock(return_value=_FakeStream([_fake_chunk()]))
    )))

    await anext(p.generate_stream(prompt="p", include_reasoning=True), None)

    kwargs = p.client.chat.completions.create.call_args.kwargs
    assert kwargs["reasoning_effort"] == "high"


@pytest.mark.asyncio
async def test_go_stream_without_reasoning_keeps_json_mode():
    from types import SimpleNamespace
    from services.llm_provider import OpenAICompatibleProvider

    p = OpenAICompatibleProvider(
        api_key="k", model="glm-5.3-flash",
        base_url="https://opencode.ai/inference/go/openai/v1",
    )
    p.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
        create=AsyncMock(return_value=_FakeStream([_fake_chunk(), SimpleNamespace(usage=None, choices=[])]))
    )))

    await anext(p.generate_stream(prompt="p", json_mode=True, include_reasoning=False), None)

    kwargs = p.client.chat.completions.create.call_args.kwargs
    assert kwargs["response_format"] == {"type": "json_object"}
    assert "reasoning_effort" not in kwargs


@pytest.mark.asyncio
async def test_stream_parses_reasoning_content_field():
    """DeepSeek/Zhipu convention (delta.reasoning_content) also yields thinking."""
    from types import SimpleNamespace
    from services.llm_provider import OpenAICompatibleProvider

    p = OpenAICompatibleProvider(
        api_key="k", model="glm-5.3-flash",
        base_url="https://opencode.ai/inference/go/openai/v1",
    )
    reasoning_chunk = SimpleNamespace(
        usage=None,
        choices=[SimpleNamespace(delta=SimpleNamespace(
            content=None, reasoning=None, reasoning_content=" step 1", reasoning_details=None))],
    )
    p.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
        create=AsyncMock(return_value=_FakeStream([reasoning_chunk, _fake_chunk()])),
    )))

    got = [c async for c in p.generate_stream(prompt="p", include_reasoning=True)]

    assert ("thinking", " step 1") in got


# ---------------------------------------------------------------------------
# App-lane reasoning policy: change-feed classify never requests reasoning
# (json_mode priority); RECLASSIFY follows the UI's streamReasoning toggle.
# ---------------------------------------------------------------------------

import json as _json
from unittest.mock import AsyncMock
from models.phone_hook import PhoneHookMessage


def _make_hook():
    return PhoneHookMessage(
        id="h1", user_id="u1", raw_msg="msg", raw_payload={"notif_pkg": "com.test"},
        action="", status="", month_key="2026-10", partition_key="u1",
        received_at="2026-10-18T00:00:00Z"
    )


_VALID_RESPONSE = _json.dumps({
    "is_financial": True,
    "vendor": {"name": "VendorX", "matched": False, "is_recommendation": True},
    "amount": 100.0,
    "transaction_type": "Expense",
    "debit_account_name": "Food | Groceries",
    "credit_account_name": "Asset | BPI Savings",
    "confidence": 0.9,
    "why": "test",
})

ACCOUNTS = [
    {"id": "a-asset-1", "name": "BPI Savings", "accountType": "Asset", "accountGroupName": "Asset", "tags": ["6642"]},
    {"id": "e-food-1", "name": "Groceries", "accountType": "Expense", "accountGroupName": "Food", "tags": ["grocery"]},
]


@pytest.mark.asyncio
async def test_change_feed_classify_never_requests_reasoning():
    from services.ai_service import AiService

    ai = AiService()
    ai._generate_stream_to_signalr = AsyncMock(return_value=(_VALID_RESPONSE, 10, 10, 0.001))

    await ai.classify_async(
        hook=_make_hook(), similar_vectors=[], accounts=ACCOUNTS,
        runbook_content="rules", vendors=[], vendor_matches=[],
        stream_reasoning_to_client=False, lane="CLASSIFICATION",
    )

    assert ai._generate_stream_to_signalr.call_args.kwargs["include_reasoning"] is False


@pytest.mark.asyncio
async def test_reclassify_requests_reasoning_when_ui_streams():
    from services.ai_service import AiService

    ai = AiService()
    ai._generate_stream_to_signalr = AsyncMock(return_value=(_VALID_RESPONSE, 10, 10, 0.001))

    await ai.classify_async(
        hook=_make_hook(), similar_vectors=[], accounts=ACCOUNTS,
        runbook_content="rules", vendors=[], vendor_matches=[],
        stream_reasoning_to_client=True, lane="RECLASSIFICATION",
    )

    assert ai._generate_stream_to_signalr.call_args.kwargs["include_reasoning"] is True


@pytest.mark.asyncio
async def test_reclassify_without_ui_streaming_stays_json_mode():
    from services.ai_service import AiService

    ai = AiService()
    ai._generate_stream_to_signalr = AsyncMock(return_value=(_VALID_RESPONSE, 10, 10, 0.001))

    await ai.classify_async(
        hook=_make_hook(), similar_vectors=[], accounts=ACCOUNTS,
        runbook_content="rules", vendors=[], vendor_matches=[],
        stream_reasoning_to_client=False, lane="RECLASSIFICATION",
    )

    assert ai._generate_stream_to_signalr.call_args.kwargs["include_reasoning"] is False


# ---------------------------------------------------------------------------
# Thinking parameter (Lane B reasoning, verified against the gateway)
# ---------------------------------------------------------------------------

def test_apply_thinking_enabled_drops_temperature_and_bumps_max_tokens():
    body = {"model": "qwen3.7-plus", "max_tokens": 8192, "temperature": 0.2}
    from services.llm_provider import GoAnthropicProvider

    GoAnthropicProvider._apply_thinking(body, include_reasoning=True, thinking_budget=None)

    assert body["thinking"] == {"type": "enabled", "budget_tokens": 1024}
    assert "temperature" not in body        # Messages API requires temp=1 with thinking
    assert body["max_tokens"] == 8192       # unchanged: already above budget


def test_apply_thinking_bumps_max_tokens_when_below_budget():
    from services.llm_provider import GoAnthropicProvider

    body = {"model": "m", "max_tokens": 512}
    GoAnthropicProvider._apply_thinking(body, include_reasoning=True, thinking_budget=1024)

    assert body["thinking"] == {"type": "enabled", "budget_tokens": 1024}
    assert body["max_tokens"] > 1024        # must strictly exceed the budget


def test_apply_thinking_disabled_leaves_body_untouched():
    from services.llm_provider import GoAnthropicProvider

    body = {"model": "m", "max_tokens": 8192, "temperature": 0.2}
    GoAnthropicProvider._apply_thinking(body, include_reasoning=False, thinking_budget=0)

    assert "thinking" not in body
    assert body["temperature"] == 0.2
    assert body["max_tokens"] == 8192


def test_apply_thinking_explicit_budget_override():
    from services.llm_provider import GoAnthropicProvider

    body = {"model": "m", "max_tokens": 8192, "temperature": 0.2}
    GoAnthropicProvider._apply_thinking(body, include_reasoning=False, thinking_budget=2048)

    # thinking_budget>0 without include_reasoning still enables thinking
    assert body["thinking"] == {"type": "enabled", "budget_tokens": 2048}
    assert "temperature" not in body


# ---------------------------------------------------------------------------
# GoAnthropicProvider request shape
# ---------------------------------------------------------------------------

def test_go_anthropic_body_text_with_system_json():
    from services.llm_provider import GoAnthropicProvider, _JSON_INSTRUCTION

    provider = GoAnthropicProvider(api_key="go-key", model="qwen3.7-plus", max_tokens=8192)
    body = provider._build_body(
        model="qwen3.7-plus",
        prompt="classify this",
        system="You are a classifier.",
        json_mode=True,
        temperature=0.2,
        image_bytes=None,
        mime_type=None,
        max_tokens=8192,
        stream=False,
    )

    assert body["model"] == "qwen3.7-plus"
    assert body["max_tokens"] == 8192            # required by Messages API
    assert body["stream"] is False
    assert body["messages"] == [{"role": "user", "content": "classify this"}]
    assert body["system"] == f"You are a classifier.\n\n{_JSON_INSTRUCTION}"


def test_go_anthropic_body_image_content_blocks():
    from services.llm_provider import GoAnthropicProvider
    import base64

    provider = GoAnthropicProvider(api_key="go-key", model="qwen3.7-plus", max_tokens=1024)
    body = provider._build_body(
        model="qwen3.7-plus",
        prompt="read receipt",
        system=None,
        json_mode=False,
        temperature=0.2,
        image_bytes=b"fakepng",
        mime_type="image/png",
        max_tokens=1024,
        stream=True,
    )

    content = body["messages"][0]["content"]
    assert isinstance(content, list) and len(content) == 2
    image_block = content[0]
    assert image_block["type"] == "image"
    assert image_block["source"]["media_type"] == "image/png"
    assert base64.b64decode(image_block["source"]["data"]) == b"fakepng"
    assert content[1] == {"type": "text", "text": "read receipt"}
    assert "system" not in body
    assert body["stream"] is True
