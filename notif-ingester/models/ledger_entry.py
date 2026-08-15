from typing import Optional
from pydantic import BaseModel, Field

class LedgerEntry(BaseModel):
    id: str = Field(alias="Id")
    user_id: str = Field(alias="UserId")
    transaction_id: str = Field(alias="TransactionId")
    account_id: str = Field(alias="AccountId")
    amount: float = Field(alias="Amount")
    note: Optional[str] = Field(default=None, alias="Note")
    reference_number: Optional[str] = Field(default=None, alias="ReferenceNumber")

    class Config:
        populate_by_name = True
