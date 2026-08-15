# Source: c/Models/Vendor.cs
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field

class Vendor(BaseModel):
    id: str = Field(alias="Id")
    user_id: str = Field(alias="UserId")
    name: str = Field(alias="Name")
    type: Optional[str] = Field(default=None, alias="Type")
    tags: List[str] = Field(default_factory=list, alias="Tags")
    last_used: Optional[datetime] = Field(default=None, alias="LastUsed")

    class Config:
        populate_by_name = True
