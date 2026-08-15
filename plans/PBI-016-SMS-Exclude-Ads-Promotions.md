---
github_issue: 16
github_url: https://github.com/adolf94/financeapp2/issues/16
status: closed
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
  - ✅ Financial: cashback **credited in real money** (e.g., "Your BDO cashback of ₱200 has been credited") — past tense, actual money
  - ❌ Non-financial: promotional offers, spending incentives, cashback **points/rewards** (not real money), OTPs
  - ❌ Non-financial: OTPs and security alerts (unless the same message also confirms a completed transaction)
- [ ] `APP_IS_FINANCIAL_PROMPT` is reviewed and confirmed to include the same cashback money vs. points distinction.
- [ ] No regression in detecting real financial transactions.

### Test Cases

| SMS Text | Expected `is_financial` |
|----------|------------------------|
| "Spend ₱150 via QR Ph using VYBE at But First, Coffee and enjoy a FREE drink." | `false` — spending incentive |
| "Earn 2x rewards points this weekend worth ₱200" | `false` — points, not real money |
| "Your BDO cashback of ₱200 has been credited to your account" | `true` — real money credited |
| "Your GCash cashback ₱50 is now available. Redeem now!" | `false` — points/promo |
| "BPI: Your payment of ₱1,500 to Meralco was successful." | `true` — completed payment |
| "Your OTP is 123456. Use within 5 minutes." | `false` — OTP only |

## Proposed Prompt Change

### `SMS_IS_FINANCIAL_PROMPT` (in `sms_prompts.py`)

Replace the ambiguous line:
> "Promotional messages, OTPs, security alerts, and balance inquiry replies ARE financial if they contain transaction amounts."

With:
```
Advertisements, promotions, and marketing offers are NOT financial transactions, even if they mention monetary amounts or rewards.
Cashback or rewards expressed in POINTS or redeemable items are NOT financial — only classify as financial if real money (PHP) was actually credited/debited.
OTPs and security alerts are NOT financial transactions.
Only classify as financial if the message confirms an actual COMPLETED transaction — i.e., a past debit, credit, transfer, payment, or withdrawal that has ALREADY occurred.
```

## Files Affected

- `notif-ingester/prompts/sms_prompts.py` — fix `SMS_IS_FINANCIAL_PROMPT` line 13
- `notif-ingester/prompts/app_prompts.py` — add cashback money vs. points distinction to `APP_IS_FINANCIAL_PROMPT`

## Out of Scope

- Changes to the preprocessing service extraction prompt
- Changes to the classification prompt
- Email ingestion pipeline
