"""
llm_provider.py
---------------
Abstraction layer for swappable LLM providers.

Configuration (env vars)
------------------------
Each AI role (CLASSIFICATION, REASONING, EMBEDDING) is controlled by:

  {ROLE}_AI      = "{provider}:{model}"   e.g. "gemini:gemini-2.5-flash-lite"
                                               "openai:gpt-4o-mini"
                                               "openrouter:google/gemini-2.5-flash-lite"
  {ROLE}_APIKEY  = "<api key for that provider>"

Supported providers
-------------------
  gemini        — Google GenAI SDK  (google-genai)
  openai        — OpenAI SDK; uses OPENAI_ENDPOINT if set, otherwise OpenAI default
  openrouter    — Shorthand for OpenAI SDK pointed at https://openrouter.ai/api/v1
  go            — OpenCode Go, OpenAI-shape endpoint
                  (https://opencode.ai/inference/go/openai/v1/chat/completions)
  go-anthropic  — OpenCode Go, Anthropic-shape endpoint (max_tokens is added
                  automatically; see GO_ANTHROPIC_MAX_TOKENS)
                  (https://opencode.ai/inference/go/anthropic/v1/messages)

Routing / failover (see plans/model-routing-plan.md)
----------------------------------------------------
A role can declare a backup provider with:

  {ROLE}_AI_BACKUP       = "{provider}:{model}"
  {ROLE}_APIKEY_BACKUP   = "<api key for the backup provider>"
  ROUTING_MAX_TRIES      = tries per provider (default 2)

When a backup is configured, ``make_provider`` returns a ``RoutedLlmProvider``
implementing the plan's policy: 2 tries primary → 2 tries backup → fail.
Only 429/5xx/timeout errors consume tries; other errors (e.g. 400) fail
immediately. On primary exhaustion the lane **latches** to the backup
(subsequent requests skip the primary entirely, zero tries); returning to the
primary is a manual ops action (``reset_circuits()`` / the routing HTTP route).
Failures on both providers are surfaced to the caller, which handles them
(out of band, e.g. manual reclassification).

Shared option
-------------
  OPENAI_ENDPOINT  — Override base_url for any openai/openrouter provider
                     (also works for Qwen, local Ollama, Azure OpenAI, etc.)

Backwards compatibility
-----------------------
If the new {ROLE}_AI / {ROLE}_APIKEY vars are NOT set, the factory falls back to
the legacy GEMINI_* vars so existing deployments are unaffected.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from abc import ABC, abstractmethod
from typing import Tuple, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class LlmProvider(ABC):
    """Minimal interface every provider must implement."""

    @property
    @abstractmethod
    def provider_label(self) -> str:
        """Human-readable label: ``"{provider}:{model}"`` — used in debug logs."""

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        system: str | None = None,
        json_mode: bool = False,
        temperature: float = 0.2,
        thinking_budget: Optional[int] = None,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ) -> Tuple[str, Optional[int], Optional[int], Optional[float]]:
        """Send a prompt (and optional image) and return the raw text response, input tokens, output tokens, and cost (if provided)."""

    @abstractmethod
    async def generate_stream(
        self,
        prompt: str,
        system: str | None = None,
        json_mode: bool = False,
        temperature: float = 0.2,
        include_reasoning: bool = False,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ):
        """Yield (chunk_type, text) tuples.
        
        chunk_type is one of:
          - ``"thinking"`` – reasoning / CoT tokens (before final answer)
          - ``"content"``  – final answer tokens
        """


    async def embed(self, text: str) -> list[float]:
        """Return a vector embedding for *text*.

        Providers that do not support embeddings should raise NotImplementedError.
        """
        raise NotImplementedError(
            f"{type(self).__name__} does not support embeddings."
        )



# ---------------------------------------------------------------------------
# Gemini provider
# ---------------------------------------------------------------------------

class GeminiProvider(LlmProvider):
    """Wraps the google-genai SDK."""

    def __init__(self, api_key: str, model: str) -> None:
        from google import genai
        from google.genai import types as genai_types  # noqa: F401

        self._genai = genai
        self._genai_types = genai_types
        self.client = genai.Client(api_key=api_key)
        self.model = model

    @property
    def provider_label(self) -> str:
        return f"gemini:{self.model}"

    async def generate(
        self,
        prompt: str,
        system: str | None = None,
        json_mode: bool = False,
        temperature: float = 0.2,
        thinking_budget: Optional[int] = None,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ) -> Tuple[str, Optional[int], Optional[int], Optional[float]]:
        config: dict = {"temperature": temperature}
        if json_mode:
            config["response_mime_type"] = "application/json"
        if system:
            config["system_instruction"] = system
        if thinking_budget is not None:
            config["thinking_config"] = self._genai_types.ThinkingConfig(
                thinking_budget=thinking_budget
            )

        contents = []
        if image_bytes and mime_type:
            contents.append(
                self._genai_types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
            )
        contents.append(prompt)

        response = self.client.models.generate_content(
            model=self.model,
            contents=contents if len(contents) > 1 else contents[0],
            config=config,
        )
        
        input_tokens = None
        output_tokens = None
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            input_tokens = getattr(response.usage_metadata, "prompt_token_count", None)
            output_tokens = getattr(response.usage_metadata, "candidates_token_count", None)

        return response.text, input_tokens, output_tokens, None

    async def generate_stream(
        self,
        prompt: str,
        system: str | None = None,
        json_mode: bool = False,
        temperature: float = 0.2,
        include_reasoning: bool = False,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ):
        config: dict = {"temperature": temperature}
        if json_mode:
            config["response_mime_type"] = "application/json"
        if system:
            config["system_instruction"] = system
        if not include_reasoning:
            config["thinking_config"] = self._genai_types.ThinkingConfig(
                thinking_budget=0
            )

        contents = []
        if image_bytes and mime_type:
            contents.append(
                self._genai_types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
            )
        contents.append(prompt)

        response_stream = self.client.models.generate_content_stream(
            model=self.model,
            contents=contents if len(contents) > 1 else contents[0],
            config=config,
        )
        for chunk in response_stream:
            if hasattr(chunk, "usage_metadata") and chunk.usage_metadata:
                in_tok = getattr(chunk.usage_metadata, "prompt_token_count", None)
                out_tok = getattr(chunk.usage_metadata, "candidates_token_count", None)
                if in_tok is not None or out_tok is not None:
                    yield ("usage", (in_tok, out_tok))
            if chunk.text:
                yield ("content", chunk.text)

    async def embed(self, text: str) -> list[float]:
        result = self.client.models.embed_content(
            model=self.model,
            contents=text,
        )
        return result.embeddings[0].values


# ---------------------------------------------------------------------------
# OpenAI-compatible provider  (openai / openrouter / Qwen / Ollama / …)
# ---------------------------------------------------------------------------

def _extract_usage_and_cost(usage_obj) -> Tuple[Optional[int], Optional[int], Optional[float]]:
    if not usage_obj:
        return None, None, None
    
    in_tok = getattr(usage_obj, "prompt_tokens", None)
    out_tok = getattr(usage_obj, "completion_tokens", None)
    
    cost = getattr(usage_obj, "cost", None)
    if cost is None:
        cost = getattr(usage_obj, "total_cost", None)
    if cost is None and hasattr(usage_obj, "model_extra") and isinstance(usage_obj.model_extra, dict):
        cost = usage_obj.model_extra.get("cost") or usage_obj.model_extra.get("total_cost")
    
    try:
        cost_float = float(cost) if cost is not None else None
    except (ValueError, TypeError):
        cost_float = None

    return in_tok, out_tok, cost_float


def _reasoning_effort() -> str:
    """Reasoning effort level for OpenAI-shape reasoning requests.

    Configurable via GO_REASONING_EFFORT (low | medium | high; default medium).
    GLM-5.x treats the levels as "thinking enabled" without a published token
    mapping, so this is an experiment knob: set "high" and watch
    reasoning_tokens in the usage chunk to see if the gateway honors it.
    """
    return os.environ.get("GO_REASONING_EFFORT", "medium").lower().strip() or "medium"


class OpenAICompatibleProvider(LlmProvider):
    """Wraps the openai SDK.

    Works with any OpenAI-compatible endpoint by setting *base_url*.
    JSON mode uses ``response_format={"type": "json_object"}``.
    """

    def __init__(self, api_key: str, model: str, base_url: str | None = None,
                 default_headers: dict | None = None) -> None:
        from openai import AsyncOpenAI

        self.model = model
        self._base_url = base_url

        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url or None,
            default_headers=default_headers or None,
        )

    @property
    def provider_label(self) -> str:
        if self._base_url and "opencode" in self._base_url:
            return f"opencode-go:{self.model}"
        if self._base_url and "openrouter" in self._base_url:
            return f"openrouter:{self.model}"
        return f"openai:{self.model}"

    async def generate(
        self,
        prompt: str,
        system: str | None = None,
        json_mode: bool = False,
        temperature: float = 0.2,
        thinking_budget: Optional[int] = None,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ) -> Tuple[str, Optional[int], Optional[int], Optional[float]]:
        import base64
        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})

        if image_bytes and mime_type:
            b64_img = base64.b64encode(image_bytes).decode("utf-8")
            messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64_img}"}}
                ]
            })
        else:
            messages.append({"role": "user", "content": prompt})

        kwargs: dict = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        if thinking_budget is not None and thinking_budget > 0:
            is_openrouter = bool(self._base_url and "openrouter" in self._base_url)
            if is_openrouter:
                kwargs["extra_body"] = {"reasoning": {"effort": _reasoning_effort()}}
            else:
                kwargs["reasoning_effort"] = _reasoning_effort()

        response = await self.client.chat.completions.create(**kwargs)
        
        input_tokens, output_tokens, cost = _extract_usage_and_cost(getattr(response, "usage", None))

        return response.choices[0].message.content, input_tokens, output_tokens, cost

    async def generate_stream(
        self,
        prompt: str,
        system: str | None = None,
        json_mode: bool = False,
        temperature: float = 0.2,
        include_reasoning: bool = False,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ):
        import base64
        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})

        if image_bytes and mime_type:
            b64_img = base64.b64encode(image_bytes).decode("utf-8")
            messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64_img}"}}
                ]
            })
        else:
            messages.append({"role": "user", "content": prompt})

        kwargs: dict = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        # When reasoning is requested, skip json_mode — some models drop CoT
        # with response_format=json_object. The caller must parse JSON from the
        # accumulated content instead.
        if json_mode and not include_reasoning:
            kwargs["response_format"] = {"type": "json_object"}

        # Pass the reasoning parameter. OpenRouter takes it in extra_body;
        # OpenAI-shape endpoints (including the Go gateway) take the standard
        # reasoning_effort. Without an explicit request, GLM skips CoT when
        # the prompt asks for JSON-only output (verified 2026-10-21: a
        # classification prompt streamed content but zero reasoning chunks).
        # NOTE: GLM-5.x docs say low/medium/high all just mean "thinking
        # enabled" with no token mapping — the effort level is a hint the
        # model/gateway may or may not honor; GO_REASONING_EFFORT lets you
        # experiment (e.g. "high") and observe reasoning_tokens in usage.
        is_openrouter = bool(self._base_url and "openrouter" in self._base_url)
        if include_reasoning:
            if is_openrouter:
                kwargs["extra_body"] = {"reasoning": {"effort": _reasoning_effort()}}
            else:
                kwargs["reasoning_effort"] = _reasoning_effort()

        kwargs["stream_options"] = {"include_usage": True}

        response_stream = await self.client.chat.completions.create(**kwargs)
        async for chunk in response_stream:
            if hasattr(chunk, "usage") and chunk.usage:
                in_tok, out_tok, cost = _extract_usage_and_cost(chunk.usage)
                if in_tok is not None or out_tok is not None or cost is not None:
                    yield ("usage", (in_tok, out_tok, cost))

            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta

            # ── Reasoning / thinking tokens ────────────────────────────────
            # OpenRouter surfaces these in delta.reasoning_details (list)
            # and also as a plain string in delta.reasoning (legacy)
            rd = getattr(delta, "reasoning_details", None)
            if rd:
                for item in rd:
                    text = (
                        item.get("text")
                        or item.get("summary")
                        if isinstance(item, dict)
                        else getattr(item, "text", None) or getattr(item, "summary", None)
                    ) or ""
                    if text:
                        yield ("thinking", text)

            # Legacy single-field reasoning (some OpenRouter models) and the
            # DeepSeek/Zhipu convention (reasoning_content) used by some GLM
            # deployments.
            legacy_reasoning = getattr(delta, "reasoning", None) or getattr(delta, "reasoning_content", None)
            if legacy_reasoning and not rd:
                yield ("thinking", legacy_reasoning)

            # ── Final content tokens ───────────────────────────────────────
            if delta.content:
                yield ("content", delta.content)


    async def embed(self, text: str) -> list[float]:
        response = await self.client.embeddings.create(
            model=self.model,
            input=text,
        )
        return response.data[0].embedding


# ---------------------------------------------------------------------------
# OpenCode Go — Anthropic-shape provider  (go-anthropic prefix)
# ---------------------------------------------------------------------------

_JSON_INSTRUCTION = (
    "Respond with ONLY a single valid JSON object. No markdown fences, "
    "no commentary, no text before or after the JSON."
)


def opencode_session_id() -> str:
    """Stable per-process session id for OpenCode Go's ``x-opencode-session``
    header (routing / prompt-caching optimization). Override with the
    OPENCODE_SESSION_ID env var for a fixed value across deployments."""
    return os.environ.get("OPENCODE_SESSION_ID", "").strip() or _OPENCODE_SESSION_ID


_OPENCODE_SESSION_ID: str = str(uuid.uuid4())


class GoAnthropicProvider(LlmProvider):
    """OpenCode Go endpoint speaking the Anthropic Messages API.

    Built directly on aiohttp (no anthropic SDK dependency). ``max_tokens``
    is required by the Messages API — defaults to GO_ANTHROPIC_MAX_TOKENS
    (8192). Reasoning/thinking streaming is supported and verified against
    the gateway (2026-10-21): when the caller passes include_reasoning=True,
    thinking is requested via the Messages API thinking parameter and
    ``thinking_delta`` SSE events are yielded as ("thinking", …) chunks.
    JSON mode is emulated with a system-prompt instruction since the
    Messages API has no response_format equivalent.
    """

    def __init__(self, api_key: str, model: str, endpoint: str | None = None,
                 max_tokens: int | None = None) -> None:
        self.model = model
        self._endpoint = endpoint or _OPENCODE_GO_ANTHROPIC_URL
        self._api_key = api_key
        self._max_tokens = max_tokens or int(os.environ.get("GO_ANTHROPIC_MAX_TOKENS", "8192"))
        self._session_header = opencode_session_id()

    def _thinking_budget(self) -> int:
        try:
            return max(0, int(os.environ.get("GO_ANTHROPIC_THINKING_BUDGET", "1024")))
        except ValueError:
            return 1024

    @staticmethod
    def _apply_thinking(body: dict, include_reasoning: bool, thinking_budget: Optional[int]) -> None:
        """Enable thinking on a Messages-API body in place. Anthropic requires
        temperature = 1 when thinking is on (we omit it entirely) and
        max_tokens strictly greater than the thinking budget."""
        budget = thinking_budget if (thinking_budget is not None and thinking_budget > 0) else 0
        if not include_reasoning and budget == 0:
            return
        if budget == 0:
            budget = 1024  # include_reasoning with no explicit budget → default
        body["thinking"] = {"type": "enabled", "budget_tokens": budget}
        if (body.get("max_tokens") or 0) <= budget:
            body["max_tokens"] = budget + 2048
        body.pop("temperature", None)

    @property
    def provider_label(self) -> str:
        return f"opencode-go:{self.model}"

    def _headers(self, stream: bool = False) -> dict:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-opencode-session": self._session_header,
            "User-Agent": "ar-finance-ingester/1.0",
        }
        if stream:
            headers["Accept"] = "text/event-stream"
        return headers

    @staticmethod
    def _build_body(model: str, prompt: str, system: str | None, json_mode: bool,
                    temperature: float, image_bytes: bytes | None, mime_type: str | None,
                    max_tokens: int, stream: bool) -> dict:
        if system and json_mode:
            system = f"{system}\n\n{_JSON_INSTRUCTION}"
        elif json_mode:
            system = _JSON_INSTRUCTION

        if image_bytes and mime_type:
            import base64
            b64_img = base64.b64encode(image_bytes).decode("utf-8")
            user_content = [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": mime_type, "data": b64_img},
                },
                {"type": "text", "text": prompt},
            ]
        else:
            user_content = prompt

        body: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": user_content}],
            "stream": stream,
        }
        if system:
            body["system"] = system
        return body

    @staticmethod
    def _raise_for_status(status: int, payload: dict | str) -> None:
        if status >= 400:
            raise RuntimeError(
                f"OpenCode Go Anthropic error {status}: "
                f"{payload if isinstance(payload, str) else str(payload)[:500]}"
            )

    async def generate(
        self,
        prompt: str,
        system: str | None = None,
        json_mode: bool = False,
        temperature: float = 0.2,
        thinking_budget: Optional[int] = None,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ) -> Tuple[str, Optional[int], Optional[int], Optional[float]]:
        import aiohttp

        body = self._build_body(
            model=self.model,
            prompt=prompt,
            system=system,
            json_mode=json_mode,
            temperature=temperature,
            image_bytes=image_bytes,
            mime_type=mime_type,
            max_tokens=self._max_tokens,
            stream=False,
        )
        self._apply_thinking(body, include_reasoning=False, thinking_budget=thinking_budget)
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=300)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                self._endpoint, headers=self._headers(), json=body
            ) as resp:
                if resp.status >= 400:
                    detail = await resp.text()
                    self._raise_for_status(resp.status, detail[:500])
                payload = await resp.json()

        text_parts = [
            block.get("text", "")
            for block in payload.get("content", [])
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        response_text = "".join(text_parts)

        usage = payload.get("usage") or {}
        in_tok = usage.get("input_tokens")
        out_tok = usage.get("output_tokens")
        # Cost is not reported by the Messages API — cost_calculator estimates
        # from token counts using the pricing table.
        return response_text, in_tok, out_tok, None

    async def generate_stream(
        self,
        prompt: str,
        system: str | None = None,
        json_mode: bool = False,
        temperature: float = 0.2,
        include_reasoning: bool = False,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
    ):
        """Yield ("content", text) chunks plus a final ("usage", (in, out, None)).

        SSE events consumed: message_start (input usage), content_block_delta
        (thinking_delta → ("thinking", …), text_delta → ("content", …)),
        message_delta (output usage). When include_reasoning is set, the
        thinking parameter is requested (budget GO_ANTHROPIC_THINKING_BUDGET,
        default 1024) and temperature is omitted (Messages API requires
        temperature=1 with thinking).
        """
        import aiohttp
        import json as _json

        body = self._build_body(
            model=self.model,
            prompt=prompt,
            system=system,
            json_mode=json_mode,
            temperature=temperature,
            image_bytes=image_bytes,
            mime_type=mime_type,
            max_tokens=self._max_tokens,
            stream=True,
        )
        self._apply_thinking(body, include_reasoning=include_reasoning, thinking_budget=None)
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=600)
        in_tok: Optional[int] = None
        out_tok: Optional[int] = None
        yielded = False
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                self._endpoint, headers=self._headers(stream=True), json=body
            ) as resp:
                if resp.status >= 400:
                    detail = await resp.text()
                    self._raise_for_status(resp.status, detail[:500])
                async for raw_line in resp.content:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if not data_str or data_str == "[DONE]":
                        continue
                    try:
                        event = _json.loads(data_str)
                    except _json.JSONDecodeError:
                        continue

                    event_type = event.get("type")
                    if event_type == "message_start":
                        usage = (event.get("message") or {}).get("usage") or {}
                        in_tok = usage.get("input_tokens", in_tok)
                    elif event_type == "content_block_delta":
                        delta = event.get("delta") or {}
                        delta_type = delta.get("type")
                        if delta_type == "thinking_delta" and delta.get("thinking"):
                            # Verified against the gateway (2026-10-21):
                            # thinking streams as thinking_delta before text.
                            yielded = True
                            yield ("thinking", delta["thinking"])
                        elif delta_type == "text_delta" and delta.get("text"):
                            yielded = True
                            yield ("content", delta["text"])
                        # signature_delta / citations_delta → ignored
                    elif event_type == "message_delta":
                        usage = event.get("usage") or {}
                        out_tok = usage.get("output_tokens", out_tok)
                    elif event_type == "error":
                        err = event.get("error") or {}
                        raise RuntimeError(
                            f"OpenCode Go Anthropic stream error: {err.get('message', event)}"
                        )
        if in_tok is not None or out_tok is not None:
            yield ("usage", (in_tok, out_tok, None))
        if not yielded:
            raise RuntimeError("OpenCode Go Anthropic stream produced no content")


# ---------------------------------------------------------------------------
# Routing / failover circuit  (see plans/model-routing-plan.md §3)
# ---------------------------------------------------------------------------

# Lane circuit state: lane name -> "backup" when latched. Absent key = primary.
# Latching is one-way by design; recovery is a manual ops action.
_CIRCUIT_STATE: dict[str, str] = {}


def _latch_to_backup(lane: str, failed_label: str, exc: Exception) -> None:
    if _CIRCUIT_STATE.get(lane) != "backup":
        _CIRCUIT_STATE[lane] = "backup"
        logger.warning(
            "[LLM ROUTING] lane=%s latched to backup after primary %s failed: %s",
            lane, failed_label, exc,
        )


def get_circuit_states() -> dict:
    """Effective circuit state per lane (absent key means primary)."""
    return dict(_CIRCUIT_STATE)


def reset_circuits(lane: str | None = None) -> dict:
    """Manual ops action: return a lane (or all lanes) to primary-first."""
    if lane:
        _CIRCUIT_STATE.pop(lane.upper(), None)
    else:
        _CIRCUIT_STATE.clear()
    return get_circuit_states()


class RouteExhaustedError(RuntimeError):
    """All configured providers exhausted their retry budgets."""


def _exception_status(exc: Exception) -> Optional[int]:
    for attr in ("status_code", "status", "code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    return None


_NON_RETRYABLE_EXC_TYPES = (ValueError, TypeError, AttributeError, KeyError, IndexError)


def _is_retryable(exc: Exception) -> bool:
    """Per plan §3: only 429 / 5xx / timeout consume tries. Malformed-request
    style errors (400) and programming errors fail immediately."""
    if isinstance(exc, _NON_RETRYABLE_EXC_TYPES):
        return False
    status = _exception_status(exc)
    if status is not None:
        return status == 429 or status >= 500
    exc_name = type(exc).__name__
    if "Timeout" in exc_name or "Connection" in exc_name:
        return True
    message = str(exc).lower()
    return "rate limit" in message or "timeout" in message or "connection" in message


class RoutedLlmProvider(LlmProvider):
    """Lane router implementing plans/model-routing-plan.md §3.

    Per request: ``tries`` attempts on the active provider, then (primary
    only, when still primary) the backup with ``tries`` attempts, then the
    error propagates. A latched lane skips the primary entirely (0 tries).
    Latching is one-way; ``reset_circuits`` restores primary-first manually.
    """

    def __init__(self, lane: str, primary: LlmProvider, backup: LlmProvider,
                 tries_per_provider: int | None = None, backoff_seconds: float = 0.5) -> None:
        self._lane = lane
        self._primary = primary
        self._backup = backup
        try:
            self._tries = max(1, int(tries_per_provider or os.environ.get("ROUTING_MAX_TRIES", "2")))
        except (TypeError, ValueError):
            self._tries = 2
        self._backoff = backoff_seconds
        self._last_provider = primary

    @property
    def lane(self) -> str:
        return self._lane

    @property
    def provider_label(self) -> str:
        # Reflects the provider that last served a request so cost logging
        # resolves against the model actually used.
        return self._last_provider.provider_label

    def _is_backup_active(self) -> bool:
        return _CIRCUIT_STATE.get(self._lane) == "backup"

    async def _attempt_all(self, provider: LlmProvider, method_name: str, **kwargs):
        last_exc: Exception | None = None
        for attempt in range(self._tries):
            try:
                if attempt == 0:
                    logger.info(
                        "[LLM ROUTING] lane=%s → %s (try 1/%d)%s",
                        self._lane,
                        provider.provider_label,
                        self._tries,
                        " [LATCHED to backup]" if provider is self._backup else "",
                    )
                else:
                    logger.info(
                        "[LLM ROUTING] lane=%s → %s (retry %d/%d) after: %s",
                        self._lane,
                        provider.provider_label,
                        attempt + 1,
                        self._tries,
                        last_exc,
                    )
                self._last_provider = provider
                return await getattr(provider, method_name)(**kwargs)
            except Exception as exc:
                if not _is_retryable(exc):
                    raise
                last_exc = exc
                if attempt + 1 < self._tries:
                    await asyncio.sleep(self._backoff * (attempt + 1))
        raise last_exc  # retry budget exhausted

    async def generate(self, **kwargs):
        active = self._backup if self._is_backup_active() else self._primary
        try:
            return await self._attempt_all(active, "generate", **kwargs)
        except Exception as exc:
            if active is self._backup or not _is_retryable(exc):
                raise  # latched backup failure, or fail-fast error (e.g. 400)
            _latch_to_backup(self._lane, self._primary.provider_label, exc)
            return await self._attempt_all(self._backup, "generate", **kwargs)

    async def generate_stream(self, **kwargs):
        if self._is_backup_active():
            async for chunk in self._attempt_stream(self._backup, **kwargs):
                yield chunk
            return

        produced = False
        try:
            async for chunk in self._attempt_stream(self._primary, **kwargs):
                produced = True
                yield chunk
        except Exception as primary_exc:
            # Mid-stream failures cannot be replayed into the SignalR
            # stream — propagate them as-is.
            if produced or not _is_retryable(primary_exc) or self._is_backup_active():
                raise
            _latch_to_backup(self._lane, self._primary.provider_label, primary_exc)
            async for chunk in self._attempt_stream(self._backup, **kwargs):
                yield chunk

    async def _attempt_stream(self, provider: LlmProvider, **kwargs):
        """Stream from one provider with the retry budget. A failure before
        the first chunk is retryable; a failure mid-stream propagates."""
        last_exc: Exception | None = None
        for attempt in range(self._tries):
            agen = provider.generate_stream(**kwargs)
            got_chunk = False
            if attempt == 0:
                logger.info(
                    "[LLM ROUTING] lane=%s → %s (stream, try 1/%d)%s",
                    self._lane,
                    provider.provider_label,
                    self._tries,
                    " [LATCHED to backup]" if provider is self._backup else "",
                )
            elif last_exc is not None:
                logger.info(
                    "[LLM ROUTING] lane=%s → %s (stream, retry %d/%d) after: %s",
                    self._lane,
                    provider.provider_label,
                    attempt + 1,
                    self._tries,
                    last_exc,
                )
            try:
                while True:
                    try:
                        chunk = await agen.__anext__()
                    except StopAsyncIteration:
                        self._last_provider = provider
                        return
                    got_chunk = True
                    self._last_provider = provider
                    yield chunk
            except Exception as exc:
                if got_chunk or not _is_retryable(exc):
                    raise
                last_exc = exc
                if attempt + 1 < self._tries:
                    await asyncio.sleep(self._backoff * (attempt + 1))
            finally:
                await agen.aclose()
        raise last_exc  # retry budget exhausted before first chunk


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
_OPENCODE_GO_OPENAI_URL = "https://opencode.ai/inference/go/openai/v1"
_OPENCODE_GO_ANTHROPIC_URL = "https://opencode.ai/inference/go/anthropic/v1/messages"

_LEGACY_GEMINI_DEFAULTS = {
    "CLASSIFICATION": ("gemini-2.5-flash-lite", "GEMINI_API_KEY"),
    "REASONING":      ("gemini-2.5-flash",      "GEMINI_API_KEY"),
    "EMBEDDING":      ("gemini-embedding-2",     "GEMINI_API_KEY"),
}

# Roles added for the model-routing plan. Roles listed here inherit the
# CLASSIFICATION lane configuration when their own {ROLE}_AI is not set,
# so preprocessing and reclassification ride the same routed lane by default.
_DERIVED_ROLES = {
    "RECLASSIFICATION": "CLASSIFICATION",
    "PREPROCESSING": "CLASSIFICATION",
}


def _build_provider(provider_prefix: str, model: str, api_key: str) -> LlmProvider:
    """Instantiate the concrete provider for a ``prefix:model`` pair."""
    if provider_prefix == "gemini":
        return GeminiProvider(api_key=api_key, model=model)

    if provider_prefix in ("openai", "openrouter"):
        if provider_prefix == "openrouter":
            base_url = _OPENROUTER_BASE_URL
        else:
            # Allow OPENAI_ENDPOINT override for any OpenAI-compatible API
            base_url = os.environ.get("OPENAI_ENDPOINT", "").strip() or None
        return OpenAICompatibleProvider(api_key=api_key, model=model, base_url=base_url)

    if provider_prefix == "go":
        return OpenAICompatibleProvider(
            api_key=api_key,
            model=model,
            base_url=os.environ.get("GO_OPENAI_ENDPOINT", "").strip() or _OPENCODE_GO_OPENAI_URL,
            default_headers={
                "x-opencode-session": opencode_session_id(),
                "User-Agent": "ar-finance-ingester/1.0",
            },
        )

    if provider_prefix == "go-anthropic":
        return GoAnthropicProvider(
            api_key=api_key,
            model=model,
            endpoint=os.environ.get("GO_ANTHROPIC_ENDPOINT", "").strip() or None,
        )

    raise ValueError(
        f"Unknown provider prefix '{provider_prefix}'. "
        "Supported: gemini, openai, openrouter, go, go-anthropic."
    )


def make_provider(role: str) -> LlmProvider:
    """Build an ``LlmProvider`` for *role* (e.g. ``"CLASSIFICATION"``).

    Resolution order
    ----------------
    1. ``{ROLE}_AI`` env var  →  ``"{provider}:{model}"``
       ``{ROLE}_APIKEY`` env var  →  API key for that provider.
       When ``{ROLE}_AI_BACKUP`` / ``{ROLE}_APIKEY_BACKUP`` are also set, the
       result is wrapped in a ``RoutedLlmProvider`` (2 tries primary →
       2 tries backup → fail, latching circuit).
    2. Derived roles (RECLASSIFICATION, PREPROCESSING) inherit the
       CLASSIFICATION lane configuration when their own vars are unset.
    3. Fallback: legacy ``GEMINI_*`` env vars (backwards-compatible).

    Raises
    ------
    ValueError
        If the role string is unrecognised or the provider prefix is unknown.
    """
    role = role.upper()
    if role not in _LEGACY_GEMINI_DEFAULTS and role not in _DERIVED_ROLES:
        raise ValueError(
            f"Unknown role '{role}'. Expected one of: "
            + ", ".join(sorted(set(_LEGACY_GEMINI_DEFAULTS) | set(_DERIVED_ROLES)))
        )

    def _resolve(config_role: str) -> tuple[str, str]:
        return (
            os.environ.get(f"{config_role}_AI", "").strip(),
            os.environ.get(f"{config_role}_APIKEY", "").strip(),
        )

    # Derived roles inherit the base role's lane configuration unless they
    # define their own.
    inherit_role = _DERIVED_ROLES.get(role)
    ai_var, apikey_var = _resolve(role)
    backup_ai_var = os.environ.get(f"{role}_AI_BACKUP", "").strip()
    backup_apikey_var = os.environ.get(f"{role}_APIKEY_BACKUP", "").strip()

    if not ai_var and inherit_role:
        ai_var, apikey_var = _resolve(inherit_role)
        backup_ai_var = backup_ai_var or os.environ.get(f"{inherit_role}_AI_BACKUP", "").strip()
        backup_apikey_var = backup_apikey_var or os.environ.get(
            f"{inherit_role}_APIKEY_BACKUP", ""
        ).strip()
    elif inherit_role and ai_var and not backup_ai_var:
        # Own primary but no backup declared — inherit only if the base role
        # has one AND the primary providers differ (same model would make
        # the backup a no-op clone of the primary).
        base_ai = os.environ.get(f"{inherit_role}_AI", "").strip()
        if backup_base := os.environ.get(f"{inherit_role}_AI_BACKUP", "").strip():
            if base_ai != ai_var or backup_base != ai_var:
                backup_ai_var = backup_base
                backup_apikey_var = os.environ.get(
                    f"{inherit_role}_APIKEY_BACKUP", ""
                ).strip()

    if ai_var:
        # ── New-style config ──────────────────────────────────────────────
        if ":" not in ai_var:
            raise ValueError(
                f"'{role}_AI' must be in the format 'provider:model', got: {ai_var!r}"
            )
        provider_prefix, model = ai_var.split(":", 1)
        provider_prefix = provider_prefix.lower()
        api_key = apikey_var  # may be empty for local / keyless providers

        logger.debug("[LLM] Role=%s  provider=%s  model=%s", role, provider_prefix, model)
        primary = _build_provider(provider_prefix, model, api_key)

        if backup_ai_var:
            if ":" not in backup_ai_var:
                raise ValueError(
                    f"'{role}_AI_BACKUP' must be in the format 'provider:model', "
                    f"got: {backup_ai_var!r}"
                )
            backup_prefix, backup_model = backup_ai_var.split(":", 1)
            backup = _build_provider(backup_prefix.lower(), backup_model, backup_apikey_var)
            return RoutedLlmProvider(lane=role, primary=primary, backup=backup)

        return primary

    # ── Legacy fallback ───────────────────────────────────────────────────
    legacy_role = inherit_role if inherit_role and not os.environ.get(f"GEMINI_{role}_MODEL") else role
    legacy_model_var = f"GEMINI_{legacy_role}_MODEL"
    default_model, legacy_key_var = _LEGACY_GEMINI_DEFAULTS.get(
        legacy_role, _LEGACY_GEMINI_DEFAULTS["CLASSIFICATION"]
    )

    model = os.environ.get(legacy_model_var, default_model)
    api_key = os.environ.get(legacy_key_var, "")

    logger.debug(
        "[LLM] Role=%s  provider=gemini (legacy fallback)  model=%s", role, model
    )
    return GeminiProvider(api_key=api_key, model=model)


