# Source: c/Models/Account.cs
from typing import Optional
from pydantic import BaseModel, Field
from models.enums import AccountType

class Account(BaseModel):
    id: str = Field(alias="Id")
    user_id: str = Field(alias="UserId")
    account_group_id: str = Field(alias="AccountGroupId")
    name: str = Field(alias="Name")
    starting_balance: float = Field(alias="StartingBalance")
    current_balance: float = Field(alias="CurrentBalance")
    account_type: AccountType = Field(alias="AccountType")
    description: Optional[str] = Field(default=None, alias="Description")
    tags: Optional[list[str]] = Field(default_factory=list, alias="Tags")
    credit_card_cycle_start_day: Optional[int] = Field(default=None, alias="CreditCardCycleStartDay")
    credit_card_payment_due_day: Optional[int] = Field(default=None, alias="CreditCardPaymentDueDay")

    class Config:
        populate_by_name = True
