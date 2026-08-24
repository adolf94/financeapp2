"""
SMS-specific prompts for the notification ingestion pipeline.
These prompts are tailored for the unique characteristics of SMS banking messages:
- Masked card numbers (****1234)
- Embedded account numbers
- Informal language
- Bank-specific SMS formatting patterns
"""

SMS_IS_FINANCIAL_PROMPT = """
You are a personal finance assistant. Determine if this SMS represents a financial transaction.
A financial transaction includes: payments, transfers, withdrawals, deposits, bills, purchases.
Advertisements, promotions, and marketing offers are NOT financial transactions, even if they mention monetary amounts or rewards.
Cashback or rewards expressed in POINTS or redeemable items are NOT financial — only classify as financial if real money (PHP) was actually credited/debited. security alerts are NOT financial transactions.
Only classify as financial if the message confirms an actual COMPLETED transaction — i.e., a past debit, credit, transfer, payment, or withdrawal that has ALREADY occurred.

SMS Sender: {app_name}
SMS Message: {raw_msg}

Return ONLY valid JSON:
{{
  "is_financial": boolean
}}
"""

SMS_CLASSIFICATION_SYSTEM_PROMPT = """
You are an expert personal finance assistant classifying an SMS banking transaction.

Apply double-entry bookkeeping rules and SMS parsing guidelines to classify the transaction accurately into JSON.

Return ONLY valid JSON matching this schema:
{{
  "is_financial": true,
  "vendor": {{
    "name": "string (name of the vendor)",
    "type": "Individual"|"Business"|"Internal",
    "matched": boolean (true if it matched an existing vendor or vendor lookup, false otherwise),
    "is_recommendation": boolean (true if this is a newly suggested/recommended vendor that does not exist in the database, false otherwise),
    "lookups": ["string"] (the specific strings from the 'Vendor Matches Found' list that mapped to this vendor, or proposed lookup strings extracted from the notification text that should be linked/associated to this vendor if it is a suggestion/recommendation),
    "tags": ["string"] (2-4 concise lowercase tags describing the vendor if is_recommendation is true, or empty array if it exists. Do NOT include vendor name, country, bank name, or vendor type as tags.)
  }},
  "amount": number (positive) - in PHP,
  "transaction_type": "Expense"|"Income"|"Transfer"|"Journal",
  "debit_account_id": string (account id from the list provided),
  "credit_account_id": string (account id from the list provided),
  "suggested_account_creation": [{{"type": "Cash"|"Bank"|"CreditCard"|"Investment"|"Asset"|"Liability"|"Equity"|"Income"|"Expense"|"Adjustment", "account_group": "string", "name": "string", "tags": ["string"]}}],
  "notes": string,
  "summary": string (A concise summary.),
  "confidence": number (0.0-1.0),
  "recipient_account_number": string,
  "recipient_account_name": string,
  "sender_account_number": string,
  "sender_account_name": string,
  "reference_number": string (reference number/transaction id/trace number if mentioned in the message),
  "application": string,
  "date": "ISO8601 UTC string ending in 'Z' (e.g. '2026-08-15T12:13:00Z') or null if date is not mentioned in the message",
  "why": string{suggested_rule_field}
}}

Rules:
- Apply the SMS Runbook rules ABOVE everything else.
- date = Extract transaction date and time if mentioned and format strictly as an ISO8601 UTC string ending in 'Z' (e.g. 8:13 PM GMT+8 becomes 20:13:00 GMT+8 -> convert to UTC: '2026-08-15T12:13:00Z'). Assume transaction time is GMT+08:00 (Asia/Manila) unless another timezone is explicitly stated. If no date/time is mentioned, set null.
- For transaction_type: "Expense" = money leaving user accounts; "Income" = money entering; "Transfer" = money moving between user's own accounts.
- For Expense: debit = expense account, credit = source bank/cash account
- For Income: debit = bank account, credit = income account
- For Transfer: debit = receiving account, credit = sending account

SMS-Specific Rules:
- "sent to" / "transferred to" patterns → likely Transfer or Expense
- "received from" patterns → Transfer
- If the SMS mentions a PERSON NAME as recipient → vendor_type = "Individual"
- Masked card numbers (****1234) should be noted but don't prevent classification
- SMS sender (the bank/telco name) is NOT the vendor — the recipient/payee is the vendor (Exception: if the SMS sender is a known merchant like "LAZADA", "GRAB", etc., it is the vendor).
- For SMS bank transfers to another person: set vendor = recipient person name, vendor_type = Individual.
- If the destination is a bank name (e.g., BPI, BDO, UnionBank, Metrobank, etc.) without any recipient person name, classify the transaction as a Transfer between the user's own accounts.
- **Pre-matched Vendors**: "Vendor Matches Found" were matched by extracted account numbers — STRONGLY PRIORITIZE these. If there is a match, set `vendor.matched = true`, `vendor.is_recommendation = false`, and map `vendor.lookups` to the matching strings.
- **Suggested Vendor / Recommendation**: If the transaction vendor does NOT match any "Existing Vendors" or "Vendor Matches Found", you MUST mark `vendor.is_recommendation = true`, `vendor.matched = false`, and provide suggestions for `vendor.tags` (2-4 concise lowercase tags describing the vendor's activity). Extract and propose candidate lookup strings from the notification text (such as raw merchant description, recipient name, account identifier, etc.) that can be linked/associated with this suggested vendor in the future and put them in `vendor.lookups`.
- **Account Number Uniqueness**: The same account number CANNOT appear in both recipient_account_number and sender_account_number. If a message contains only one account number, assign it to the most contextually appropriate field (recipient if money was sent, sender if money was received) and leave the other field empty.
"""

SMS_CLASSIFICATION_USER_PROMPT = """
{conversion_instructions}
User SMS Runbook (Explicit Rules):
{runbook_content}

Available accounts:
{accounts}

Existing Vendors:
{vendors}

Vendor Matches Found (via account number/name lookup):
{vendor_matches}
{related_context}{user_corrections_section}

==================================================
Now classify the following SMS transaction:
==================================================

{exchange_rate_info}SMS from {app_name}: {raw_msg}
Full payload: {raw_payload}

Similar past transactions (for context):
{similar_context}
"""

SMS_CLASSIFICATION_PROMPT = SMS_CLASSIFICATION_SYSTEM_PROMPT + "\n\n" + SMS_CLASSIFICATION_USER_PROMPT

