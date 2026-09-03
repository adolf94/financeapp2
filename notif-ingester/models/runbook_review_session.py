# Source: Python (Original)
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from typing import List, Optional

class Question(BaseModel):
    Qid: str
    Q: str

class ChatMessage(BaseModel):
    role: str  # "user" | "ai"
    text: str
    questions: Optional[List[Question]] = Field(default_factory=list)

class RunbookReviewSession(BaseModel):
    id: str = "runbook-review-session"
    user_id: str = Field(default="default", alias="UserId")
    corrections: List[dict] = Field(default_factory=list)
    chat_history: List[ChatMessage] = Field(default_factory=list)
    proposed_runbook: str = ""
    account_description_updates: List[dict] = Field(default_factory=list)
    vendor_updates: List[dict] = Field(default_factory=list)
    runbook_type: str = "app"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    partition_key: str = "default"

    class Config:
        populate_by_name = True
