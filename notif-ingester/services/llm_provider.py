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
  gemini      — Google GenAI SDK  (google-genai)
  openai      — OpenAI SDK; uses OPENAI_ENDPOINT if set, otherwise OpenAI default
  openrouter  — Shorthand for OpenAI SDK pointed at https://openrouter.ai/api/v1

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

import logging
import os
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


class OpenAICompatibleProvider(LlmProvider):
    """Wraps the openai SDK.

    Works with any OpenAI-compatible endpoint by setting *base_url*.
    JSON mode uses ``response_format={"type": "json_object"}``.
    """

    def __init__(self, api_key: str, model: str, base_url: str | None = None) -> None:
        from openai import AsyncOpenAI

        self.model = model
        self._base_url = base_url
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url or None,
        )

    @property
    def provider_label(self) -> str:
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
            effort = "medium"
            if is_openrouter:
                kwargs["extra_body"] = {"reasoning": {"effort": effort}}
            else:
                kwargs["reasoning_effort"] = effort

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

        # Pass the reasoning parameter only for OpenRouter endpoints
        is_openrouter = bool(self._base_url and "openrouter" in self._base_url)
        if include_reasoning and is_openrouter:
            kwargs["extra_body"] = {"reasoning": {"effort": "medium"}}

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

            # Legacy single-field reasoning (some OpenRouter models)
            legacy_reasoning = getattr(delta, "reasoning", None)
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
# Factory
# ---------------------------------------------------------------------------

_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

_LEGACY_GEMINI_DEFAULTS = {
    "CLASSIFICATION": ("gemini-2.5-flash-lite", "GEMINI_API_KEY"),
    "REASONING":      ("gemini-2.5-flash",      "GEMINI_API_KEY"),
    "EMBEDDING":      ("gemini-embedding-2",     "GEMINI_API_KEY"),
}


def make_provider(role: str) -> LlmProvider:
    """Build an ``LlmProvider`` for *role* (e.g. ``"CLASSIFICATION"``).

    Resolution order
    ----------------
    1. ``{ROLE}_AI`` env var  →  ``"{provider}:{model}"``
       ``{ROLE}_APIKEY`` env var  →  API key for that provider.
    2. Fallback: legacy ``GEMINI_*`` env vars (backwards-compatible).

    Raises
    ------
    ValueError
        If the role string is unrecognised or the provider prefix is unknown.
    """
    role = role.upper()
    if role not in _LEGACY_GEMINI_DEFAULTS:
        raise ValueError(
            f"Unknown role '{role}'. Expected one of: "
            + ", ".join(_LEGACY_GEMINI_DEFAULTS)
        )

    ai_var = os.environ.get(f"{role}_AI", "").strip()
    apikey_var = os.environ.get(f"{role}_APIKEY", "").strip()

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

        if provider_prefix == "gemini":
            return GeminiProvider(api_key=api_key, model=model)

        if provider_prefix in ("openai", "openrouter"):
            if provider_prefix == "openrouter":
                base_url = _OPENROUTER_BASE_URL
            else:
                # Allow OPENAI_ENDPOINT override for any OpenAI-compatible API
                base_url = os.environ.get("OPENAI_ENDPOINT", "").strip() or None
            return OpenAICompatibleProvider(
                api_key=api_key, model=model, base_url=base_url
            )

        raise ValueError(
            f"Unknown provider prefix '{provider_prefix}' in '{role}_AI'. "
            "Supported: gemini, openai, openrouter."
        )

    # ── Legacy fallback ───────────────────────────────────────────────────
    legacy_model_var = f"GEMINI_{role}_MODEL"
    default_model, legacy_key_var = _LEGACY_GEMINI_DEFAULTS[role]

    model = os.environ.get(legacy_model_var, default_model)
    api_key = os.environ.get(legacy_key_var, "")

    logger.debug(
        "[LLM] Role=%s  provider=gemini (legacy fallback)  model=%s", role, model
    )
    return GeminiProvider(api_key=api_key, model=model)

