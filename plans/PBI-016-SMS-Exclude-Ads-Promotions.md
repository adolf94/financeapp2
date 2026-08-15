---
github_issue: 16
github_url: https://github.com/adolf94/financeapp2/issues/16
status: open
---
# PBI: Exclude Advertisements and Promotions from SMS/Notification Processing

## Description

The `is_financial` prompt used in the SMS pipeline (`SMS_IS_FINANCIAL_PROMPT`) contains an instruction that incorrectly allows promotional messages to pass as financial transactions:

> "Promotional messages, OTPs, security alerts, and balance inquiry replies **ARE financial if they contain transaction amounts**."

This causes promotional SMS messages that mention money amounts (e.g., "Get ₱500 cashback on your next purchase!", "Earn 2x rewards this weekend worth ₱200") to be processed as real transactions, wasting AI classification resources and potentially creating false transaction records.

## Misclassification Example

The following promotional SMS was incorrectly classified as a financial transaction:

```
"Umaaraw, umuulan... ☀️🌧️☕: Kahit anong weather, coffee hits different. 🤎
Spend ₱150 via QR Ph using VYBE at But First, Coffee and enjoy a FREE drink.
T&Cs apply."
```

**Why it fails**: The prompt's rule `"Promotional messages... ARE financial if they contain transaction amounts"` triggers on `₱150`, even though the message is a spending incentive / promo offer — no actual transaction has occurred.

## Root Cause

File: `notif-ingester/prompts/sms_prompts.py`  
**`SMS_IS_FINANCIAL_PROMPT`** — line explicitly allows promotions/advertisements through if they contain an amount.

## Acceptance Criteria

- [ ] `SMS_IS_FINANCIAL_PROMPT` is updated to explicitly **exclude** advertisements and promotional messages, regardless of whether they mention monetary amounts.
- [ ] The updated prompt distinguishes between:
  - ✅ Financial: actual debit/credit/transfer/payment/withdrawal confirmations
  - ❌ Non-financial: promotional offers, cashback ads, reward notifications, OTPs (unless the OTP message also contains a completed transaction confirmation)
- [ ] `APP_IS_FINANCIAL_PROMPT` is reviewed — it already correctly excludes promotional messages but should be confirmed consistent.
- [ ] No regression in detecting real financial transactions.

## Proposed Prompt Change

### `SMS_IS_FINANCIAL_PROMPT` (in `sms_prompts.py`)

Replace the ambiguous line:
> "Promotional messages, OTPs, security alerts, and balance inquiry replies ARE financial if they contain transaction amounts."

With an explicit exclusion rule:
> "Advertisements, promotions, and marketing offers are NOT financial transactions even if they mention amounts or rewards. Only classify as financial if the message confirms an actual completed transaction (e.g., a debit, credit, transfer, payment, or withdrawal that has already occurred)."

## Files Affected

- `notif-ingester/prompts/sms_prompts.py` — fix `SMS_IS_FINANCIAL_PROMPT`
- `notif-ingester/prompts/app_prompts.py` — review/confirm `APP_IS_FINANCIAL_PROMPT` is already correct

## Out of Scope

- Changes to the preprocessing service extraction prompt
- Changes to the classification prompt
- Email ingestion pipeline
