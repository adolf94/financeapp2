# Source: c/Models/RecurringTransaction.cs
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field
from models.enums import TransactionType

class RecurringLedgerEntry(BaseModel):
    account_id: str = Field(alias="AccountId")
    amount: float = Field(alias="Amount")
    comment: Optional[str] = Field(default=None, alias="Comment")

    class Config:
        populate_by_name = True

class RecurringTransactionOccurrence(BaseModel):
    date: datetime = Field(alias="Date")
    occurrence_no: int = Field(alias="OccurrenceNo")
    status: str = Field(alias="Status")
    transaction_id: Optional[str] = Field(default=None, alias="TransactionId")

    class Config:
        populate_by_name = True

class RecurringTransaction(BaseModel):
    id: str = Field(alias="Id")
    user_id: str = Field(alias="UserId")
    frequency: str = Field(alias="Frequency")
    interval: int = Field(alias="Interval")
    start_date: datetime = Field(alias="StartDate")
    end_date: Optional[datetime] = Field(default=None, alias="EndDate")
    max_occurrences: Optional[int] = Field(default=None, alias="MaxOccurrences")
    next_occurrence_date: datetime = Field(alias="NextOccurrenceDate")
    template_type: TransactionType = Field(alias="TemplateType")
    template_note: str = Field(alias="TemplateNote")
    template_vendor: Optional[str] = Field(default=None, alias="TemplateVendor")
    template_entries: List[RecurringLedgerEntry] = Field(default_factory=list, alias="TemplateEntries")
    occurrences: List[RecurringTransactionOccurrence] = Field(default_factory=list, alias="Occurrences")

    class Config:
        populate_by_name = True
