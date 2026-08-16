from enum import Enum

class AccountType(str, Enum):
    Cash = "Cash"
    Bank = "Bank"
    CreditCard = "CreditCard"
    Investment = "Investment"
    Asset = "Asset"
    Liability = "Liability"
    Equity = "Equity"
    Income = "Income"
    Expense = "Expense"
    Adjustment = "Adjustment"

class TransactionType(str, Enum):
    Income = "Income"
    Expense = "Expense"
    Transfer = "Transfer"
    Journal = "Journal"

class IngestionStatus(str, Enum):
    Pending = "Pending"
    AutoConfirmed = "AutoConfirmed"
    Confirmed = "Confirmed"
    Rejected = "Rejected"
    NonFinancial = "NonFinancial"
    Duplicate = "Duplicate"
    Merged = "Merged"

