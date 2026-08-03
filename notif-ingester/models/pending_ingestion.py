# Source: Python (Original)
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from uuid_extensions import uuid7
from typing import Optional, List, Dict, Any, Literal

class SuggestedVendor(BaseModel):
    name: Optional[str] = None
    tags: Optional[List[str]] = None
    type: Optional[Literal["Individual", "Business", "Internal"]] = None
    is_created: Optional[bool] = False

class AiParsedData(BaseModel):
    is_financial: Optional[bool] = True
    vendor: Optional[str] = None
    vendor_type: Optional[str] = None
    amount: Optional[float] = None
    transaction_type: Optional[str] = None
    debit_account_id: Optional[str] = None
    credit_account_id: Optional[str] = None
    suggested_account_creation: Optional[List[dict]] = None
    notes: Optional[str] = None
    summary: Optional[str] = None
    confidence: Optional[float] = None
    recipient_account_number: Optional[str] = None
    recipient_account_name: Optional[str] = None
    sender_account_number: Optional[str] = None
    sender_account_name: Optional[str] = None
    application: Optional[str] = None
    why: Optional[str] = None
    user_why: Optional[str] = None
    vendor_matched: Optional[bool] = False
    is_auto_confirmed: Optional[bool] = False
    ingestion_id: Optional[str] = None
    date: Optional[datetime] = None
    suggested_vendor: Optional[SuggestedVendor] = None

class SuggestedAccountCreation(BaseModel):
    type: Optional[str] = None
    account_group: Optional[str] = None
    name: Optional[str] = None
    description: str = ""
    reason: str = ""

class PendingIngestion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid7()))
    user_id: str = Field(default="default", alias="UserId")
    hook_id: str
    received_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    raw_payload: dict
    raw_msg: str
    ai_parsed: AiParsedData
    user_confirmed: Dict[str, Any] = Field(default_factory=dict)
    similarity_score: float = 0.0
    top_matches: List[dict] = Field(default_factory=list)
    status: str = "Pending"
    transaction_id: Optional[str] = None
    month_key: str
    partition_key: str
    ttl: Optional[int] = Field(default=None, alias="_ttl")
    runbook_synced: bool = False

    class Config:
        populate_by_name = True
