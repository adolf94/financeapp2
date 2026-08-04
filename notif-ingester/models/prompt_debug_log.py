from datetime import datetime, timezone
from typing import Any, Optional
from pydantic import BaseModel, Field
from uuid_extensions import uuid7


class PromptDebugLog(BaseModel):
    """CosmosDB document for PROMPT_DEBUG logs.

    Stored in the ``PromptDebugLogs`` container, partitioned by ``UserId``.
    TTL defaults to 30 days so logs auto-expire.
    """

    id: str = Field(default_factory=lambda: str(uuid7()))
    user_id: str = Field(default="default", alias="UserId")

    # When the call happened
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Which call this was (e.g. "classify", "is_financial", "desc", "review_start", "review_chat")
    call_type: str

    # Provider info  e.g. "gemini:gemini-2.5-flash-lite"
    provider: str

    # The full prompt sent to the model
    prompt: str

    # Optional system instruction
    system: Optional[str] = None

    # The raw response text returned by the model
    response: Optional[str] = None

    # Parsed JSON response (if applicable) — stored as a nested object for easy querying
    response_json: Optional[Any] = None

    # Token consumption
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None

    # Auto-expire after 30 days
    ttl: int = Field(default=30 * 24 * 60 * 60, alias="_ttl")

    class Config:
        populate_by_name = True
