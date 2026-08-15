"""
cost_calculator.py
------------------
Calculates estimated cost (in USD) for LLM API requests based on provider/model and token usage.
Prices are per 1,000,000 tokens (USD).
"""

from typing import Optional, Tuple

# Pricing table: (input_price_per_1m, output_price_per_1m) in USD
MODEL_PRICING: dict[str, Tuple[float, float]] = {
    # Qwen models (OpenRouter / Alibaba Cloud)
    "qwen/qwen3.7-flash": (0.07, 0.28),
    "qwen/qwen-2.5-72b-instruct": (0.12, 0.39),
    "qwen/qwen-2.5-coder-32b-instruct": (0.07, 0.16),
    "qwen-turbo": (0.05, 0.20),
    "qwen-plus": (0.40, 1.20),
    "qwen-max": (1.60, 6.40),

    # Google Gemini models
    "gemini-2.5-flash-lite": (0.075, 0.30),
    "gemini-3.1-flash-lite": (0.075, 0.30),
    "gemini-2.0-flash-lite": (0.075, 0.30),
    "gemini-2.5-flash": (0.10, 0.40),
    "gemini-2.0-flash": (0.10, 0.40),
    "gemini-1.5-flash": (0.075, 0.30),
    "gemini-1.5-pro": (1.25, 5.00),
    "gemini-2.5-pro": (1.25, 5.00),
    "gemini-embedding-2": (0.02, 0.0),
    "gemini-embedding-001": (0.02, 0.0),

    # OpenAI models
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4.1-mini": (0.15, 0.60),
    "gpt-4.1": (2.00, 8.00),
    "text-embedding-3-small": (0.02, 0.0),

    # DeepSeek models
    "deepseek/deepseek-chat": (0.14, 0.28),
    "deepseek-chat": (0.14, 0.28),
    "deepseek-v3": (0.14, 0.28),
    "deepseek/deepseek-r1": (0.55, 2.19),
    "deepseek-r1": (0.55, 2.19),

    # Anthropic models
    "claude-3-5-haiku": (0.80, 4.00),
    "claude-3-5-sonnet": (3.00, 15.00),
    "anthropic/claude-3.5-haiku": (0.80, 4.00),
    "anthropic/claude-3.5-sonnet": (3.00, 15.00),
}

# Fallback default: $0.10 / 1M input, $0.40 / 1M output
DEFAULT_PRICING: Tuple[float, float] = (0.10, 0.40)


def calculate_cost(
    provider_label: str,
    input_tokens: Optional[int],
    output_tokens: Optional[int]
) -> Optional[float]:
    """Calculate the estimated cost in USD for a given provider/model and token counts."""
    if input_tokens is None and output_tokens is None:
        return None

    in_tok = input_tokens or 0
    out_tok = output_tokens or 0

    # Extract model name from provider_label e.g. "openrouter:qwen/qwen3.7-flash" -> "qwen/qwen3.7-flash"
    label = provider_label.lower()
    model_name = label.split(":", 1)[-1] if ":" in label else label

    # Try exact match or substring match
    pricing = MODEL_PRICING.get(model_name)
    if not pricing:
        for key, price in MODEL_PRICING.items():
            if key in model_name or model_name in key:
                pricing = price
                break

    if not pricing:
        pricing = DEFAULT_PRICING

    in_price_per_m, out_price_per_m = pricing
    total_cost = (in_tok * in_price_per_m + out_tok * out_price_per_m) / 1_000_000.0

    return round(total_cost, 8)


def resolve_or_calculate_cost(
    provider_label: str,
    input_tokens: Optional[int],
    output_tokens: Optional[int],
    reported_cost: Optional[float] = None,
) -> Optional[float]:
    """Return the exact cost reported directly by OpenRouter/provider if available, otherwise calculate from pricing table."""
    if reported_cost is not None and reported_cost > 0:
        return round(float(reported_cost), 8)
    return calculate_cost(provider_label, input_tokens, output_tokens)
