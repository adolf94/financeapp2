from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel, Field
from uuid_extensions import uuid7

class PhoneHookMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid7()))
    user_id: str = Field(default="default", alias="UserId")
    received_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    action: str
    raw_payload: dict
    raw_msg: str
    status: str = "received"
    month_key: str
    partition_key: str
    ttl: int = Field(default=60 * 24 * 60 * 60, alias="_ttl")
    notification_type: str = Field(default="unknown")  # 'sms' | 'app' | 'unknown'
    error_detail: Optional[str] = None
    processing_metadata: dict = Field(default_factory=dict)

    class Config:
        populate_by_name = True
