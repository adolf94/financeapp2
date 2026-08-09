# Source: c/Models/Transaction.cs
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field
from models.enums import TransactionType
from models.ledger_entry import LedgerEntry

class Transaction(BaseModel):
    id: str = Field(alias="Id")
    user_id: str = Field(alias="UserId")
    schedule_id: Optional[str] = Field(default=None, alias="ScheduleId")
    date: datetime = Field(alias="Date")
    note: str = Field(alias="Note")
    reference_number: Optional[str] = Field(default=None, alias="ReferenceNumber")
    vendor: Optional[str] = Field(default=None, alias="Vendor")
    transaction_type: TransactionType = Field(alias="Type")
    entries: List[LedgerEntry] = Field(default_factory=list, alias="Entries")

    class Config:
        populate_by_name = True
